# Implementation Log

One entry per completed backlog task, recording the evidence required by
[`01-operating-manual.md`](01-operating-manual.md), "Quality evidence in
handoff". Do not record a check that was not run.

## E1-007 — Typed adapter registry

Status: **implemented**. Depends on: E1-005. Phase 1.

### There is no command string anywhere

`04-orchestrator-spec.md` asks for a fixed entrypoint, a typed argument array
and no user input through a shell. That is shape here rather than policy: the
contract has no field that holds a command line, and `build_invocation` is the
only function that produces an argument vector.

It takes a pinned target, an output path and approved budgets — **not a
command**. A caller has nothing to concatenate because no parameter would let
it.

Argument kinds are `literal`, `target`, `output-path` and `budget`. There is no
free-text kind, so an operator cannot supply an argument at all: every
substitution comes from something already authorised elsewhere — the target from
the addresses E1-002 pinned, the budget from the signed scope.

### Three refusals a caller could otherwise reach by accident

- an adapter that is not registered, so a run cannot name a tool nobody
  reviewed;
- a target outside the pinned addresses, so an invocation cannot reach somewhere
  the resolution never authorised;
- a profile the scope did not allow, so a bounded-active adapter cannot run
  under a passive authorisation.

### The synthetic adapter exists because nothing is pinned

Every image in this repository is still unselected, so a container adapter
cannot run. A synthetic adapter has no image, runs in process and reaches no
network, which makes the run plane exercisable end to end today rather than
after E1-015.

That distinction is a rule the schema cannot state on its own — "required here,
forbidden there" needs conditional keywords the validator does not implement —
so it lives in the loader with a test on each side.

### Vocabularies that must not drift

Three documents now decide what an adapter may do: the scope record, the grant
and the registry. A profile permitted by only two of them would be a way around
the third, so a test asserts all three enums are equal rather than similar.

`zapImage` was added to the version manifest as **unselected**, blocked by
E1-015. The registry names a manifest entry rather than an image, so an adapter
cannot pin an unreviewed one, and a test requires every named entry to exist and
to carry a blocking task while it is unpinned.

### Six catalogue anchors written with the wrong indentation

The mutation check reported them rather than running against unmutated code,
which is the fail-closed behaviour it was built for. They were then regenerated
**from the source file** instead of retyped, which removes the class of mistake
rather than the instance.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 326 Node tests, 219 Python tests,
112/112 mutants killed, exit 0. Fourteen mutants added.

### A defect found while reviewing this task

`build_invocation` took `pinned_addresses: Sequence[str]`, and **`str` satisfies
`Sequence[str]`**. Membership on a string is substring containment, so a caller
passing one pinned address as a string turned the pin check into a fragment
match: the target `56.1` was authorised against a pin of `192.168.56.10`.

The same applied to `allowed_profiles`. Both now refuse a bare string and
compare against a set built from an explicit sequence, and a test walks four
fragments of a pinned address to show none is accepted.

The annotation was correct and useless. That is worth remembering: a type hint
names a shape and `str` genuinely is a sequence of strings, so the check that
looked right answered a different question.

### Known limitations and remaining risk

- **Nothing executes an invocation.** Producing the vector and running it are
  separate on purpose, and the runner belongs with the container lifecycle.
- The synthetic adapter is registered but has no implementation yet; the
  registry describes it and nothing runs it.
- The registry is not yet wired to the supervisor, so budgets and the kill
  switch are not consulted on an invocation path that does not exist.

## Revision — the sweep moved a leak instead of closing it

### Defect fixed

The previous entry claimed the sweep closed the monitor leak. It closed half of
it:

```
monitor watching after sweep : 0
supervisor.runs after sweep  : 200
```

The monitor was cleared and every `Run` object was kept. The registry that
replaced the leaking dictionary leaked in exactly the same way.

Every sweep now reaps runs that reached a terminal state — however they got
there. Reaping only what the sweep itself stopped would have left the registry
growing for the common case, which is a run that finishes normally.

### What is deliberately still held

A swept run sits in `cancelling`, which is **not** terminal: teardown has not
happened, and dropping it there would lose the thing that still has work to do.
It is reaped when it reaches `cancelled`. Both halves are tested, because the
difference between "still tearing down" and "leaked" is the whole question.

### The third leak of one shape

Idempotency store, heartbeat monitor, supervisor registry. Three modules, one
pattern: **a collection that grows on the way in and has no rule for the way
out.**

The same worth naming as the time-of-check pattern, and for the same reason —
predictable enough to look for on purpose. Every store in this service now
either has a derived retention bound or a defined reaping rule, and the ones
with a bound assert it at construction.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 317 Node tests, 198 Python tests,
98/98 mutants killed, exit 0. Two mutants added, one for the reaping and one for
the terminal-only condition, so dropping a run mid-teardown fails too.

## E1-006 — The sweep, and the asymmetry it turns on

Status: **complete**. Depends on: E1-005. Phase 1.

`HeartbeatMonitor.stale` named the runs that should be stopped and stopped
nothing. `runs/supervisor.py` acts on that list: engage the switch, move the
state machine, write the audit entry, stop watching.

### A kill is not privileged execution

Everywhere else here, a decision that cannot be recorded does not take effect —
`04-orchestrator-spec.md` requires audit-store failure to block privileged
execution, and `audit.recorder.guard` enforces it.

**A kill is the opposite case.** It is not privileged execution; it is the
cessation of it. Refusing to stop a run because the stop could not be written
down would leave a run executing that nobody wanted executing — the outcome the
audit requirement exists to prevent, caused by the requirement itself.

So the stop happens and the record is attempted after. A failed record is
returned in the report rather than raised, so an operator learns the store is
broken *and* that the dangerous work has already ended.

### One broken run does not abandon the sweep

Failures are collected per run rather than raised. A sweep that gave up half-way
would leave exactly the runs it had not reached still going, which is the worst
possible subset to leave running.

The switch is engaged **before** the state machine is asked to move, so a run
whose move fails is still refused by every other caller.

### Forgetting is part of stopping

The monitor leak recorded in the previous entry is closed here rather than in
the monitor: whoever kills a stale run is who knows it has ended.

### `assert_permitted` asks both questions

The switch may have stopped a run and the adapter may have gone silent. Both are
asked in one place so neither is forgotten by a caller who only knew about one.

### A test bug worth keeping the comment for

The helper read `chain or AuditChain(...)`. `AuditChain` defines `__len__`, so
an empty chain is **falsy**, and a deliberately broken store was silently
replaced by a working one — the two asymmetry tests passed against the wrong
object. Truthiness on a container that defines `__len__` is a trap, and the
comment stays where the mistake was made.

### `check:mutation` was taking over ten minutes

It copied the whole module tree once per mutant. Ninety-six copies dominated the
runtime and bought nothing: each mutant edits one file, and the original is
written back in a `finally` before the next runs, so the copy only ever holds
one deliberate defect at a time. One copy for the catalogue, restore between
mutants. **10+ minutes to 62 seconds.** The working tree is still never touched,
which is the property that mattered.

### An unexplained edit to a contract sample

`check:contracts` failed on
`packages/contracts/findings/samples/finding/verified-sql-injection.json`:
`exploit_evidence` read `demonsztrated`. `main` has `demonstrated`, and the file
had been modified during this session at 20:47:21. Nothing run here writes to
that path.

Restored byte-for-byte from `main` and verified. Recorded rather than quietly
corrected, because a one-character edit to a contract sample that nothing
accounts for is worth someone knowing about — and because the check caught it,
which is what it is for.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 317 Node tests, 194 Python tests,
96/96 mutants killed, exit 0. Seven mutants added.

## Revision — a late heartbeat revived a run that should have been killed

### Defect fixed

The heartbeat had a time-of-check to time-of-use race, and it was the third of
that shape in this service:

```
sweep sees stale : ['run.0001']
after a late beat: []
assert_alive     : ALIVE (the kill never happens)
```

A sweep observes a run past its timeout. Before it acts, the adapter reports
again. The run now looks healthy and nothing stops it. An adapter that is
**intermittently** silent — silent past the timeout, then reporting, then silent
again — evades the control indefinitely, which is the shape a misbehaving
adapter would actually have.

Staleness now latches. Breaching the timeout is the adapter's doing; whether the
run continues is the operator's, so a late report is refused and only `forget`,
which means the run ended and was accounted for, clears the latch.

The breach is detected in `beat` as well as in the sweep, because that is the
earliest moment it is visible and the sweep may not run first.

### The pattern, named

Grant nonce consumed before the acceptance was recorded. DNS answer trusted
after the check rather than pinned at it. Heartbeat staleness observed and then
discarded. Three separate modules, one shape: **a safety decision and the action
it authorises separated in time, with nothing holding the decision still in
between.**

Worth writing down because it is now predictable enough to look for on purpose,
rather than something that turns up.

### Also found

`HeartbeatMonitor` grows without bound if `forget` is never called — 5000
registrations retained. Unlike the idempotency store this one is bounded by the
number of runs an engagement has, and the fix belongs with the sweep wiring
rather than with the monitor: whoever kills a stale run is who knows it has
ended. Recorded rather than patched here, and the wiring is the next commit.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 317 Node tests, 181 Python tests,
89/89 mutants killed, exit 0. Four mutants added; two existing ones were
restated after their anchors moved.

## E1-006 — Global kill and adapter heartbeat

Status: **implemented**. Depends on: E1-005. Phase 1.

### A gap recorded before it was filled

[`08-observability.md`](../05-devsecops/08-observability.md) lists "kill switch
or audit store unavailable" among the conditions that raise an immediate alert.
For the audit store, `04-orchestrator-spec.md:117` also states that failure
blocks privileged execution. **For the kill switch there is no such statement**,
so an alert is all the specification asks for — and an alert is something a
person reads later.

Recorded as conflict 19. The stricter reading is applied, because a run that
cannot be stopped is the definition of unsafe.

### A boolean cannot carry "cannot tell"

`is_revoked` returning `False` from an unreachable switch reads exactly like
`False` from a healthy one, and the caller proceeds. So the question is not
asked that way. `assert_permitted` raises for a revoked run **and** for a
switch that cannot answer, and `SwitchUnavailable` is a subclass of `RunStopped`
so a caller that stops for one stops for the other without having to know about
both.

A test asserts there is no `is_revoked` at all. The absence is the design.

### A global kill covers runs that do not exist yet

Stopping only known runs would let one started a moment later proceed, which is
the case an operator is reaching for the switch to prevent.

### Absence of a heartbeat is a stop signal, not a neutral state

The classic mistake is treating "has never beaten" as healthy, because there is
no previous beat to compare against. Registration is therefore itself the first
beat: an adapter that never reports goes stale on exactly the same schedule as
one that stopped reporting. An unwatched run is refused rather than assumed
alive.

A beat dated before the previous one is refused too. That is a clock problem or
a replayed message, and accepting it would extend the silence window backwards.

### The timeout is bounded from both sides

Ten-second interval, thirty-second timeout, and both bounds asserted at
construction rather than commented:

- **at least two intervals**, or one lost beat stops a healthy run;
- **under the 300-second grant maximum**, or a lost adapter outlives its own
  authorisation before anyone notices, and the heartbeat adds nothing the grant
  window was not already doing.

The interval itself is a choice, not a derivation. Conflict 4 still records that
kill-switch latency is measured without an objective, so the number is
provisional and the relationships around it are not.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 317 Node tests, 176 Python tests,
85/85 mutants killed, exit 0. Eleven mutants added.

### Known limitations and remaining risk

- **Nothing calls the sweep.** `stale()` returns every run that should be
  stopped; connecting that to `Run.kill` and an audit entry is the next commit.
- Revocation still reaches the grant verifier as a `frozenset` argument rather
  than from the switch. That substitution is small and deliberate to keep this
  change reviewable.
- Both stores are in memory. Durability is E1-008.

## Revision — the idempotency store never forgot anything

### Defect fixed

Ten thousand completed operations left ten thousand records, and there was no
method that would ever remove one:

```
keys retained after 10000 completed operations: 10000
any expiry method?: none
```

Two problems in one. An unbounded store is a leak in a service meant to run for
the length of an engagement. And a record kept forever answers a key reused much
later with a **stale result**, which is the opposite of what the fingerprint
check exists to prevent.

The uncomfortable part is that this is the same class of defect the replay cache
gets right two modules away, with an asserted invariant and a derived TTL — and
the research that shaped this module listed "an expiration timestamp" among the
fields a standard idempotency record carries. It was written down and not built.

### The bound is derived, not chosen

The scope contract caps `max_duration_seconds` at 3600, so a run cannot last
longer than an hour. Retention is twice that, and `IdempotencyStore` refuses a
TTL shorter than the longest run a scope may authorise — because a record that
expires while its run is alive lets a repeated start begin a second one, which
is precisely the failure the key exists to prevent.

Same shape as the ADR-012 replay-cache invariant: a number that follows from the
contract rather than from taste, asserted at construction rather than commented.

### Two of my own test mistakes

The bound test claimed two thousand records at one-second intervals, all of
which fit inside a two-hour window, so it asserted nothing. They are now spread
across five hours. And the appended class landed after `if __name__ ==
"__main__"`, which ran but read badly.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 317 Node tests, 154 Python tests,
74/74 mutants killed, exit 0.

## Revision — the rate budget could be doubled

### Defect fixed

The requests-per-second budget was a fixed-window counter keyed on the current
second. A fixed window passes up to **twice** its limit across the edge, and the
budget measured here did exactly that:

```
requests issued within 1 ms: 10  (budget says 5 per second)
```

Five requests at `12:00:00.999`, five more at `12:00:01.000`. The scope contract
caps `max_requests_per_second` at 50, so an operator authorising 50 could get
100 — against a budget whose stated purpose (TM-D-001) is stopping a scanner
from exhausting a target.

### Sliding window log, and why not a token bucket

Current guidance sorts the algorithms by use: token bucket for most per-user API
limits, sliding window counter where boundary bursts matter, and **sliding window
log for sensitive, low-volume security controls**. That is this case exactly.

A token bucket would be the wrong choice for the opposite reason: it permits
controlled bursts *by design*, and the authorised rate is precisely what must not
be exceeded.

The usual objection to a log is memory, and it does not apply here. The scope
contract caps the rate, so the window holds at most that many timestamps however
long the run lasts. A test walks 500 seconds of requests and asserts the window
never exceeds the limit.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 317 Node tests, 149 Python tests,
72/72 mutants killed, exit 0.

One catalogued mutant stopped matching, which is the stale-anchor check working
again. It was restated, and a second mutant added for the sliding boundary
itself: reverting the window to a fixed one now fails.

## E1-005 — Budgets, and the task is complete

Status: **complete**. Depends on: E1-004. Phase 1.

### Defect fixed first

A `Run` accepted any string as its state. Nothing validated it, so a run
restored from storage with a state the contract no longer declares — after a
rename, or from a corrupted row — became **silently unkillable**: every
transition lookup missed, nothing was permitted, and the refusal blamed the
transition rather than the data. The state is now checked at construction and an
undeclared one is refused by name.

That matters more for E1-008 than it does today: restoring runs from PostgreSQL
is exactly when a stale state string arrives.

### Charge on issue, not on completion

A request is paid for before it leaves and a concurrency slot is taken before
the adapter starts. Charging on the response means a request that hangs, times
out or is never read costs nothing — and the scanner exhausting a target is
precisely the one whose responses stop arriving. Current rate-limiting guidance
says the same: reserve capacity at ingress rather than egress.

Response bytes are charged incrementally for the same reason, so a response
cannot exceed its bound by arriving slowly.

### Exceeding is a refusal, and it is final

`TM-D-001` asks for budgets against a scanner exhausting the host or the target.
A budget that logs and continues describes what happened rather than limiting
it, so the first refusal closes the run: every other budget refuses afterwards
with "already exhausted". A limit that only slows work down is not a limit.

### Three ways a budget stops being one, each with a test

- **A negative measurement.** Reporting minus five hundred bytes would buy
  budget back, so a negative count is refused as not a measurement.
- **A double release.** Releasing a concurrency slot more often than acquiring
  it would manufacture capacity the scope never granted, so the counter floors
  at zero.
- **Negative remaining time.** An overrun reported as spare time is worse than
  no answer, so `remaining_seconds` floors at zero too.

### Wall time, including pauses

The run lifecycle already said budgets keep accruing while paused. The duration
budget is measured against wall time from the start, because the engagement
window an operator authorised does not pause when the adapter does.

### No way to raise a budget

The limits are read once from the signed scope and there is no method that
changes them. Raising one mid-run would mean spending authority the scope did
not grant. A test asserts the absence, since an absence is what someone adds a
setter to without noticing.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 317 Node tests, 147 Python tests,
71/71 mutants killed, exit 0. Twelve mutants added.

### E1-005 is complete

Run state machine, idempotency and budgets, with the audit chain and fail-closed
recording that conflict 15 had to be answered for first.

### Known limitations and remaining risk

- Nothing calls the budget yet. It is enforced by whoever invokes an adapter,
  and the adapter registry is E1-007.
- Revocation still reaches the grant verifier as a `frozenset` argument rather
  than being read from run state. That wiring is E1-006, with the heartbeat.
- Everything in the run plane is in memory. Durability is E1-008.

## E1-005 (part) — Run state machine

Status: **implemented**. Depends on: E1-004. Phase 1.

### A conflict inside one document

[`04-orchestrator-spec.md`](../03-applications/04-orchestrator-spec.md) lists
**"Kill during every run state"** among its required safety tests at line 115.
The state diagram in the same document, at lines 60 to 78, draws only
`Running --> Cancelling`.

A paused run would therefore have to be **resumed before it could be stopped**,
which is the opposite of what a kill switch is for, and a run in `Draft`,
`Validating` or `Ready` could not be stopped at all.

Recorded as conflict 18. The stricter reading is applied: `cancelling` is
reachable from every non-terminal state except `finalizing`, which stops into
`incomplete` instead, because execution is already over there and what a kill
costs is the acknowledgement rather than the work. The tests name the extra
edges so they are not mistaken for an accident.

### The table is the machine

The transitions live in
`packages/contracts/security/samples/run-lifecycle/orchestrator.json` and are
loaded, not restated. A diagram cannot be executed, and a second copy of the
rules drifts from the first.

### Only completed means success

The specification says an exit code of zero is insufficient, so the transition
into `completed` demands an `ingestion-receipt` and nothing else opens that
door. A run whose adapter exited cleanly and whose results were never
acknowledged ends `incomplete`, which is a different word on purpose. Three
tests hold it: the receipt requirement, the single route in, and `succeeded`
written as an equality rather than as "not failed".

### Terminal means terminal here

Unlike the finding lifecycle — where a terminal state is a resting place new
evidence can leave — a run that finished is finished. Starting again means a new
run with a new grant. The two machines use the same word for different things,
so both are asserted rather than assumed.

### A kill switch that punishes being used is a bad kill switch

The first implementation raised when a kill arrived at a run that was already
`cancelling`, because no such transition exists. That is correct as table
lookup and wrong as a safety control: an operator pressing it twice under
pressure would get an exception.

A kill is now idempotent toward its goal. Pressing it on a run that is already
stopping or already stopped succeeds and changes nothing. The single exception
is a run that already **completed**: stopping it is no longer possible, and the
operator needs to be told rather than reassured.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 317 Node tests, 127 Python tests,
59/59 mutants killed, exit 0. Eight mutants added.

### Known limitations and remaining risk

- **Budgets are not built.** They are the last piece of E1-005: the scope
  contract bounds them, and nothing enforces them during a run.
- Revocation still reaches the grant verifier as a `frozenset` argument. Wiring
  it to run state is E1-006, together with the heartbeat.
- The machine is in memory and carries no history. Durability is E1-008.

## Revision — an audit outage could destroy valid grants

### Defect fixed

Wiring `guard` into grant acceptance exposed an ordering defect that neither
module had alone.

`verify_grant` consumed the nonce as part of verification. `guard` runs the
check, then writes the record, then lets the caller act. Compose them and an
audit-store failure produced this:

1. the check runs and **burns the nonce**;
2. the record fails;
3. the operation is refused — correctly, per "audit-store failure blocks
   privileged execution";
4. the grant can **never be presented again**, because its nonce is spent.

An outage in the store that exists to describe work became a way to prevent it.
Demonstrated before fixing: after a failed acceptance, re-presenting the same
valid grant returned `nonce ... has already been used`.

Verification now has no side effect. `ReplayCache.assert_unused` checks,
`consume` commits, and `verify_grant` returns the nonce rather than spending it.
`grants/authorisation.py` composes the three steps in the order that is correct
and not obvious: **verify, record, commit**.

### Two tests changed, and they were right to fail

`test_a_grant_is_single_use` and the last-instant replay test both broke,
because single use is a property of **acceptance**, not of verification. They
now exercise the full path, and a new test asserts the distinction directly:
verifying twice consumes nothing, and accepting once does.

### The window that remains

Between the check and the commit the nonce is unclaimed, so two concurrent
acceptances of one grant could both verify. Nothing here is concurrent and the
in-memory store makes it unreachable, but the durable implementation will not.
The audit append and the nonce consumption belong in one transaction, which is
what [ADR-005](../../adrs/005-postgresql-outbox.md) already chose PostgreSQL
for. Recorded in the module rather than left for someone to find.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 307 Node tests, 104 Python tests,
51/51 mutants killed, exit 0.

One catalogued mutant no longer matched its source, which is the stale-anchor
check doing its job: the property it described had moved from the verifier to
the composition. It was restated rather than deleted.

## E1-005 (part) — Fail-closed recording and idempotent operations

Status: **partial**. Depends on: E1-004. Phase 1.

### Audit-store failure blocks privileged execution

[`04-orchestrator-spec.md`](../03-applications/04-orchestrator-spec.md) lists
that among its safety tests, and
[`08-observability.md`](../05-devsecops/08-observability.md) names an
unavailable audit store among the conditions that stop work. Nothing satisfied
either: the previous entry built a chain that nothing wrote to.

`audit/recorder.py` runs the check, writes the record, and only then lets the
caller act. The direction that matters is an **allowed** decision whose record
cannot be written: the check passed, and the operation is still refused, because
a privileged action nobody can later account for is worse than one that did not
happen. `guard` raises rather than returning, so there is no code path where a
caller holds a result and no record of it — asserted by a test that fails if
`guard` ever returns in that case.

A refusal whose record fails is refused twice over and needs no argument, so the
refusal is re-raised unchanged rather than converted into a store error. Hiding
why an operation stopped behind "the audit store is broken" would be a worse
answer than the true one.

`UnrecordableDecision` is deliberately a different type from `AuditRefused`. Both
stop the operation; only one of them means the store is broken, and an operator
needs to tell those apart.

### A reason is not a free-text field

Refusal reasons are written for a person and carry addresses, identifiers and
quoted values. The audit contract has no free-text type and bounds a fact at 200
characters, so the reason is truncated on the way in rather than allowed to
become the field the contract deliberately lacks. A test pins the truncation.

### Idempotency: the second request is the hard one

Retrying a start after a timeout must not begin a second run, and that is the
easy half. The hard half is the same key arriving with a **different** request.

Current guidance is unambiguous, and it is a security property rather than a
correctness one: store a fingerprint of the request beside the key and **refuse**
a mismatch, because serving the cached answer is how a payload substitution
succeeds without anything looking wrong. A key here binds to exactly one request.

The fingerprint is a digest over the same canonical form the scope digest and the
audit chain use, so key order cannot change it and two descriptions of one
request agree across languages.

Three refusals that are easy to get wrong in the permissive direction:

- a claim still **in flight** is refused rather than answered; saying "done"
  would be a lie and running it again would defeat the key;
- a **completed** claim is never released, so a failed-work release cannot let
  one key run its operation twice;
- a key shorter than eight characters is refused, because a key that can collide
  by accident makes every guarantee above coincidental.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 307 Node tests, 95 Python tests,
48/48 mutants killed, exit 0. Nine mutants added.

### Known limitations and remaining risk

- **The call sites are still not wired.** `guard` exists and is tested; the
  grant verifier and the resolver do not call it yet. That is deliberate: the
  wiring changes their signatures, and doing it in the same commit as the
  recorder would have made both harder to review.
- The idempotency store is in memory, like the audit chain. Durability is
  E1-008.
- The run state machine and budgets — the rest of E1-005 — are not built.

## E1-005 (part) — Tamper-evident audit chain

Status: **implemented against a proposed ADR**. Depends on: E1-004. Phase 1.

### The conflict came first, again

Conflict 15 blocked E1-005: the observability document requires the audit store
to be "append-only" and specifies no tamper evidence, writers, readers, time
source or segregation from deletable evidence.

Research settled the shape of the gap in one sentence: **append-only is not
tamper evident.** Append-only describes an interface that offers no delete. It
says nothing about someone reaching past the interface to the file or table
underneath — and that person is exactly the one the audit record would otherwise
describe. Current guidance is an HMAC hash chain over a canonical schema, with
external anchoring.

[ADR-013](../../adrs/013-audit-chain.md) is that proposal, marked **Proposed**.

### What the chain proves, and what it does not

Each entry chains from the digest of the one before it, so editing, removing or
reordering an entry breaks verification at the following entry. That locates
tampering rather than merely suspecting it.

**Truncation of the tail is undetectable from the chain alone.** Removing the
last *n* entries leaves a chain that verifies perfectly. That is a property of
hash chains, not an oversight, and it is asserted as a test rather than left in
prose: a truncated export verifies on its own and fails only against an anchored
head digest.

Two things narrow it, both required rather than assumed: a monotonic `sequence`
makes a gap between retained entries visible, and `head_digest` is meant to be
anchored outside the store. Anchoring is what turns "the chain verifies" into
"the chain verifies and is as long as it should be".

A second limit is stated by a test that **passes**: someone holding the chaining
key can rebuild the whole chain end to end and it will verify. That is why the
chaining key is not the grant key — a compromised grant key must not let its
holder rewrite the record of what it did.

### Audit and evidence are separate stores, structurally

Fact types are declared by name and the vocabulary has no free-text or binary
member, the same restriction the event catalogue uses. Values are bounded at 200
characters so a reason code cannot become a smuggling channel.

This is what makes the retention rule work. Evidence is redacted, retained for a
bounded window and deleted. Audit is never deleted. A store that is never
deleted must never receive anything that would eventually have to be, and the
cheapest way to guarantee that is to make it inexpressible.

### Cross-language verification, and what it caught

The point of a chained export is that someone never trusted to write can verify
it, so `tests/foundation/audit-chain.test.mjs` recomputes every digest in
JavaScript from the sample alone.

The first version disagreed with the Python writer at the second entry. The
cause was mine: `JSON.stringify` with a replacer array filters keys
**recursively**, so the nested `facts` objects lost every field. Rewritten to
use the repository's own `canonicalize` from
[ADR-011](../../adrs/011-canonical-scope-serialization.md), it agrees — which
also turns the test into a check of the ADR-013 claim that the chain uses that
form, rather than only a check of the digests.

### Contract shape

The validator refuses cross-file `$ref`, which surfaced while wiring the schema
and is the fail-closed rule working. The entry definition therefore lives inside
the chain schema rather than in a second file: an entry on its own is not a
document anyone exchanges, and two schemas defining one shape would be a
divergence waiting to happen.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 307 Node tests, 73 Python tests,
39/39 mutants killed, exit 0. Nine mutants added for this module.

### Known limitations and remaining risk

- **ADR-013 is Proposed.** Backup and key rotation are named as unresolved:
  rotating mid-chain means either re-chaining history, which defeats the
  purpose, or accepting segmented verification, and that needs a decision before
  a second key exists.
- The store is in memory. Durability belongs with the PostgreSQL schema
  (E1-008).
- **Nothing writes to it yet.** The grant and resolution modules produce reason
  strings built for this, and the action vocabulary names their events, but the
  call sites are not wired. That is the next commit, not a claim of this one.
- The rest of E1-005 — run state machine, idempotency, budgets — is not built.

## Revision — a signature is not a well-formedness proof

### Defect fixed

The grant contract states that destructive tooling has no representation and
that a pinned address is a resolved literal, never a name. Both were true of the
JSON Schema and neither was true of the code.

A JSON Schema constrains documents that are validated against it. Nothing
validated a grant on the runtime path, so the guarantees held only for documents
that happened to pass through a validator. Demonstrated rather than reasoned
about:

- `issue_grant` minted a grant that the schema rejected on **eight fields at
  once**, including `profile: "destructive"` and a hostname in
  `pinned_addresses`.
- `verify_grant` then **accepted that grant**, because it was signed by a
  trusted key.

The second is the serious half. A signature says who wrote a document; it never
says the document is well formed. The verifier was treating provenance as
validity.

Both paths now assert the contract shape. In `verify_grant` the check sits
immediately after the signature, which keeps the stated ordering honest: nothing
reads fields to make a decision before knowing who wrote them.

### Why the contract is restated in Python

Two statements of one rule drift, and the drift is silent in the dangerous
direction. `tests/foundation/execution-grant-differential.test.mjs` runs both
over the same 54 documents — each one field bent in one direction, valid cases
included so a restatement that refused everything could not pass — and requires
identical verdicts.

One assertion is stated separately, as with the address policy: **the verifier
must never accept what the contract rejects.** Verified to bite by weakening the
profile check, which produces
`profile = "destructive": contract rejects, verifier accepts`.

### The CRLF source, finally identified

Line endings drifted again, and this time the cause is worth recording:
`pathlib.Path.write_text` translates `\n` to `\r\n` on Windows unless
`newline="\n"` is passed. Earlier entries blamed the editor; the Python helper
scripts were doing it too. The hygiene test caught it both times, and a
multi-line mutant anchor failed to match as a second symptom.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 299 Node tests, 57 Python tests,
30/30 mutants killed, exit 0. Six mutants added for the shape checks.

## E1-004 — Execution grants and replay protection

Status: **implemented against a proposed ADR**. Depends on: E1-003. Phase 1.

### The conflict came first

Conflict 12 blocked this task: the threat model requires signed, short-lived,
audience-bound, nonce-protected grants (TM-S-001) and no grant contract,
clock-skew rule, signer trust, revocation or key lifecycle existed.

[`01-operating-manual.md`](01-operating-manual.md) permits two responses to a
conflict — request a decision, or create a proposed ADR — and forbids only the
third, choosing silently. [ADR-012](../../adrs/012-execution-grants.md) is that
proposal, and it is marked **Proposed** rather than Accepted so the
implementation is visibly standing on an unreviewed decision.

### Decisions, with the reasoning that produced the numbers

**Lifetime 300 seconds, skew 30 seconds.** Current guidance for signed tokens
puts skew at 30–60 seconds and warns that tolerance beyond five minutes accepts
replays long after issuance. Both ends here are machines on a private network
with no human latency to absorb, so the interactive 5–15 minute range does not
apply. The schema refuses a longer window, so an over-long grant is
unrepresentable rather than discouraged.

**The replay-cache invariant.** A nonce entry must outlive every moment its
grant could still be accepted:

```
cache_ttl >= lifetime + 2 * skew
```

This is the one arithmetic relationship in the design that is silent when wrong,
so `ReplayCache` refuses a shorter TTL at construction rather than documenting
the requirement.

**Verification order is a security property**, not a style choice. Key and
signature first, because everything after reads fields and reading fields from
an unsigned document is how a forged grant influences a decision. Revocation
after the signature, so an unsigned document cannot probe which runs exist.
Nonce consumption last of all, because it is the only step with a side effect —
a grant refused earlier must not burn its nonce, or a verifier could be made to
invalidate grants it never accepted.

### Defect found by the boundary test

The first run failed one test: a replay presented at the last acceptable
instant was **not** caught.

The widest gap between two acceptable presentations of one grant is exactly
`lifetime + 2 * skew`, which is exactly the cache TTL. Eviction used a strict
`>` comparison, so an entry aged precisely that much was dropped one instant
before the replay it existed to stop. The comparison is now inclusive.

The test was written for that instant and found a real off-by-one there. A
looser test would have passed over it.

### Fail-closed behavior

- A grant with no lifetime, a lifetime over the maximum, or no pinned address
  cannot be issued.
- An unknown `key_id` is a refusal, never a fallback to a default key.
- `hmac.compare_digest` keeps the signature comparison constant-time.
- Every signed field is covered by the canonical form; a test edits each one in
  turn and requires the signature to break.

### Tests executed

`node tools/repo.mjs check:all` — 9 checks, 296 Node tests, 57 Python tests,
24/24 mutants killed, exit 0.

Eleven mutants were added for this module, including one for the off-by-one
above, so the eviction comparison cannot silently revert.

### Known limitations and remaining risk

- **ADR-012 is Proposed, not Accepted.** The numbers and the trust model need
  review. Nothing else in the backlog depends on that review, but this module
  should not be treated as settled until it happens.
- Signing is symmetric HMAC. That is right for two processes in one private
  environment and wrong the moment a third party has to verify without being
  able to sign. The ADR records this as the alternative considered.
- Revocation is an in-memory set. Durable revocation belongs with the run state
  machine (E1-005) and the audit store (conflict 15, still open).
- Nothing emits an audit event yet. Every refusal carries a reason string built
  for that purpose, and a test asserts each reason is substantive, but the
  append-only store does not exist.

## E1-002 — DNS resolution, pinning and redirect revalidation

Status: **implemented**. Depends on: E1-001. Phase 1.

### What the module is for

`address_policy` answers a question about a literal. This answers the harder
one: what a name resolves to, and whether that answer may still be trusted at
the moment a socket is opened.

The gap between those two moments is the whole problem.
[`01-threat-model.md`](../04-security/01-threat-model.md) MU-001 names a
"rebinding domain" among the destinations Scope Guard must reject, and
[`04-orchestrator-spec.md`](../03-applications/04-orchestrator-spec.md) requires
that DNS answers are pinned for the execution and that validation repeats for
redirects and secondary hosts.

A defence that resolves a hostname, checks the answer and then hands the
*hostname* back to an HTTP client is not a defence: the client resolves again
and may connect elsewhere. That is time-of-check to time-of-use, and it is how
CVE-2026-27826 defeated an SSRF fix that had already been written and reviewed.
The check has to move to the layer that opens the socket, so resolution produces
a `PinnedTarget` and nothing else. A caller that wants to connect asks the pin,
never the name.

### Decisions worth recording

**The resolver is injected.** The tests describe answers instead of depending on
the machine's DNS, which is the only way a rebinding domain can be tested at
all: a real resolver cannot be asked to change its mind between two calls.

**Every answer is checked, not the first.** A name can return several records
and a client may pick any of them, so one denied address poisons the set.

**An empty answer is a refusal.** A name that resolves to nothing has given no
permission to connect anywhere.

**Connect-permitted is not scope-eligible.** The scope record is IPv4-only, but
`localhost` resolves to `::1` on most machines and that is a safe destination.
What a signed scope may *contain* and what a resolved answer may *be* are
different questions with different answers, and conflating them would either
break every loopback target or let the IPv4-only property be bypassed at
runtime.

**A redirect is a new authorization decision.** It is resolved and pinned again
from scratch. If the same name answers differently within one execution, that is
the rebinding signal and the redirect is refused.

## Revision — mutation testing, and the three defects it found

### Why

[`02-tdd-coverage-mutation.md`](../06-testing/02-tdd-coverage-mutation.md) has
required ≥80% mutation for security-critical modules since the specification was
written, and nothing measured it. Coverage says a line ran; it does not say a
test would have noticed the line being wrong.

### What was built

`check:mutation` applies each catalogued defect to a **copy** of the module tree
and requires the suite to fail. Nothing is mutated in place, so an interrupted
run cannot leave a deliberate defect in the working tree.

The catalogue is a contract under
`packages/contracts/testing/`, so `check:contracts` validates it and its schema
refuses a `threshold_percent` below the standard — the number can be raised and
not lowered. Each mutant names the property it removes, so a survivor reads as a
sentence rather than a line number.

It fails closed in both directions a mutation run can lie. A suite that fails
before any mutation would make every mutant look killed, so the baseline runs
first. An anchor that no longer matches its source would run the suite against
unmutated code and record a kill, so a stale anchor is a failure.

### The first run scored 76%

Three survivors, three different causes.

**Two untested rules.** The case-folding refusals in `address_policy` were
killed only by the Node differential suite; the Python module had no test of its
own for them. One of the two turned out to be unreachable: an uppercase hostname
was already refused as `malformed` by the lowercase-only pattern. That was the
wrong classification — DNS is case-insensitive, so `WEB.LAB.TEST` names the same
host as `web.lab.test` and is not malformed. Classification now folds case and
eligibility decides the spelling, which is the same split the trailing dot
already used. `LOCALHOST` classified as `public` until the fold was moved ahead
of the loopback comparison.

**One equivalent mutant.** Replacing the final private-range test with
`is_private` changed nothing, because every range where they differ is named
above it. An equivalent mutant cannot be killed and pretending otherwise would
mean writing a test that asserts nothing. It was replaced with the mistake
someone actually makes: reaching for `is_private` *first*.

**One real gap.** `192.0.0.0/24` — IETF protocol assignments, including the
NAT64/DNS64 discovery pair — is `is_private=True` in Python and classified
`public` here, and no vector distinguished them. Falling through to `public`
denied it for the wrong reason, and a reason that happens to be right is not a
rule. It is now named `reserved` with two vectors.

The catalogue now scores 13/13.

### Repository hygiene, found by the same work

A multi-line catalogue anchor failed to match, and the cause was that three
files written on this machine had CRLF line endings in a repository where the
other 167 were LF. One had already been merged. All are normalised, and
`tests/foundation/repository-hygiene.test.mjs` now asserts LF endings and a
trailing newline across every text file, with a guard that the sweep found the
repository at all.

### Verification

`node tools/repo.mjs check:all` — 9 checks, 288 Node tests, 31 Python tests,
13/13 mutants killed, exit 0.

## Revision — the runtime was wider than the contract

### Why this was looked for

E1-001 landed with two implementations agreeing on 70 stated vectors. Agreement
on the cases someone thought of is weaker than it looks, so the two were run
against inputs nobody wrote down.

### Defects fixed

**Control characters were normalised, then trusted.** `urlsplit` follows the
WHATWG rule and silently removes ASCII tab, carriage return, newline and leading
C0 controls before parsing, so it answers about a string the caller never
supplied. `http://local\nhost:8081/` became a loopback URL and was judged
eligible, while the scope contract rejected the literal. The runtime was
admitting a target the authorisation boundary never contained.

This is not a hypothesis. It is the mechanism behind CVE-2022-0391 and
CVE-2023-24329 in Python itself, and behind CVE-2026-44889 in WebOb, where
`/\tattacker.com` survived a filter and reappeared as `//attacker.com` — a
bypass of an earlier fix for the same bug. Both parsers here now refuse a
control character or space before parsing rather than after.

**A port outside the range was classified by its host.** `urlsplit.hostname`
tolerates what `urlsplit.port` refuses, and nothing called `port`, so
`http://localhost:99999/` classified as loopback. The contract agreed, because
its URL pattern allowed five digits. Both were wrong in the same direction, so
the vectors could not catch it. The pattern now expresses the real range and the
runtime reads the port.

**Case folding widened the runtime.** A scheme and a host are case-insensitive,
so `urlsplit` lowercases them and reported `http://LOCALHOST/` as loopback. The
scope patterns are lowercase-only, so that spelling cannot appear in a signed
scope. Case folding belongs to whoever canonicalises a target before signing,
not to the check that reads the signature.

### Differential conformance

`tests/foundation/address-policy-differential.test.mjs` mutates every vector
into the shapes that historically defeat URL and host filters — whitespace and
control characters at both edges and in the middle, case folding of the whole
input and of the authority alone, a trailing dot — and requires the JSON Schema
patterns and the Python classifier to reach the same verdict on all 690.

One assertion is stated separately because it is the one that matters: the
runtime must never admit what the contract rejects. A runtime stricter than the
contract is a usability problem; a runtime looser than the contract is an
authorisation boundary with a hole in it.

The suite was verified to bite. Weakening the host-case comparison produces
`url uppercased authority: "http://LOCALHOST:8081/" — contract rejects, runtime
says eligible`.

Two of my own mistakes were found while writing it. The embedded-character
mutations were anchored to `[a-z]`, so they were silent no-ops on every numeric
input, and the null-byte mutation appended a space. Mutations now splice into
the middle of the input and a mutation that changed nothing is dropped rather
than asserted on.

### Verification

`node tools/repo.mjs check:all` — 8 checks, 284 Node tests, 13 Python tests,
exit 0. 75 conformance vectors, 690 mutated inputs.

## E1-001 — Special-range address policy, Python implementation

Status: **implemented**. Depends on: E0-004. Phase 1.

Python 3.12.10 was installed, which retired the blocker every Phase 1 task
carried. The prerequisite entry was pinned only after `python3 --version`
answered — the Microsoft Store stub that preceded it resolves on PATH and prints
nothing, which is why presence was never accepted as evidence.

### Changed files

- `services/orchestrator/scope/address_policy.py` — the classifier.
- `services/orchestrator/tests/test_address_policy.py` — 13 tests.
- `tools/repo.mjs` — `check:orchestrator`, added to the bootstrap order.
- `tools/workflows.mjs` — runtime-version agreement generalized beyond Node.
- `.github/workflow-set.json`, `.github/workflows/pr.yml` — Python in CI.
- `version-manifest.json` — `python`, `pythonPackageManager`,
  `actionsSetupPython` pinned.

### What this closes

The repository has claimed since ADR-011 that a language-neutral contract keeps
a Python service and a TypeScript console honest. Until now only one side
existed. Both sides are now tested against the same vectors, so a
cross-language disagreement is a test failure rather than a production surprise.

### Divergences the second implementation found

Neither was visible with one implementation.

**A trailing dot.** `web.lab.test.` is a legal absolute name and safe to reach,
so the classifier calls it `reserved-domain`. The scope pattern admits no
trailing dot, so it could never appear in a signed scope. Classification and
eligibility are therefore different questions: the runtime refuses the absolute
form even though it classifies as safe, because admitting it would accept a
spelling the signed scope never contained. Two vectors now pin this.

**A prefix minimum.** `0.0.0.0/0` is well formed; what is wrong with it is that
it covers every address. The first draft returned `malformed`, which hid the
reason. It classifies as `unspecified` and the prefix minimum applies at
eligibility instead.

### The standard library is not the policy

`ipaddress.ip_address("169.254.169.254").is_private` returns **`True`**. That is
the cloud metadata endpoint —
[`09-tool-safety-guardrails.md`](../04-security/09-tool-safety-guardrails.md)
denies it independently of scope, and it is the target of WEB-SSRF-001. The same
call returns `True` for the documentation TEST-NETs, the benchmarking range,
`240.0.0.0/4`, `0.0.0.0/8` and the broadcast address, and **`False`** for
carrier-grade NAT.

An implementation using `is_private` as its safety test would admit the single
address the threat model cares most about, and would read as correct. Eligibility
comes from an explicit allowlist of four ranges. A test asserts the trap still
exists in the standard library, so the reasoning survives the next reader.

### Fail-closed behavior

`unittest discover` exits 0 when it finds no test, so `check:orchestrator` would
otherwise report a pass over an empty suite. The task test asserts a parsed test
count of at least ten, not merely `OK`. A second test runs the task with
`PYTHON` pointed at an interpreter that does not exist and requires exit 1: a
missing runtime fails the check rather than skipping it.

### A digest that did its job

Moving a sample scope off one address changed its canonical digest and
`check:foundation` refused the record, naming both the declared and the expected
hash. That is the E1-003 contract working: a signed scope cannot be edited
quietly. The digest was recomputed with `tools/scope-hash.mjs`.

### Tests executed

`node tools/repo.mjs check:all` — 8 checks, 280 Node tests, 13 Python tests,
exit 0 at the time this entry was written; see the revision above for the
current figures.

### Known limitations and remaining risk

- The classifier is pure. DNS resolution, address pinning and redirect
  revalidation are E1-002 and are where a correct classifier still loses if the
  answer changes after the grant is issued.
- No mutation testing exists for the Python module. It is a security-critical
  module under
  [`02-tdd-coverage-mutation.md`](../06-testing/02-tdd-coverage-mutation.md) and
  the ≥80% requirement is unmeasured.
- Python coverage is not measured either; the threshold is still conflict 4.
- `pythonPackageManager` is pinned but nothing is installed through it. The
  hashed lock file has no entries because the module is standard library only.

## Revision — the address policy had no IPv6

### Gap found

[`04-orchestrator-spec.md`](../03-applications/04-orchestrator-spec.md), "Safety
tests", requires **public IPv4/IPv6 rejection** and **encoded or alternate
address representation rejection**. The conformance vectors covered the IPv4
alternate forms well — zero-padded octets, decimal, hexadecimal, trailing
whitespace, out-of-range octet — and contained **no IPv6 at all**.

That matters because the scope record cannot express an IPv6 target, so an IPv6
destination reaches the runtime only through DNS resolution or a redirect. That
is precisely the path the Scope Guard has to police, and it was the path with no
table to be tested against.

### The absence that was doing the work, unguarded

The scope record is IPv4-only by construction: no `ipv6` field under `targets`,
`additionalProperties: false`, and none of `private_ipv4`, `private_cidr`,
`lab_hostname` or `lab_url` accepts an IPv6 literal or a bracketed host. Each was
verified by probe rather than by reading.

Nothing asserted any of it. Widening `lab_url` to accept `http://[::1]/` would
have passed every test in the repository. A test now checks every IPv6 vector
against all four scope patterns and requires each to reject it, and asserts the
`ipv6` field is still absent. Both halves were confirmed to fail against a
deliberately widened URL pattern before being kept.

### Vectors added

`samples/address-policy/ipv6-vectors.json`, 21 vectors: loopback in both
spellings, unspecified, link-local with and without a zone identifier,
unique-local, global unicast, documentation, multicast, two malformed literals
and a prefix over 128 — and the group that motivated the work, **IPv4-mapped
IPv6**.

`::ffff:8.8.8.8` is a public address that an implementation reading only the
IPv4 text form never sees. `::ffff:192.168.56.10` is the subtler one: unwrapping
the mapping and then trusting the result admits a private address by a spelling
the signed scope never authorized. `64:ff9b::8.8.8.8` carries a public IPv4
address behind the NAT64 well-known prefix.

Eight IPv4 vectors were added for ranges the registry reserves and the policy had
no name for: carrier-grade NAT `100.64.0.0/10`, the three documentation
TEST-NETs, benchmarking `198.18.0.0/15`, reserved `240.0.0.0/4` and `0.0.0.0/8`.
Reserved is not the same as available — a range assigned to nobody cannot be an
owned lab target — so all eight are denied.

### Contract changes

`kind` gained `ipv6` and `ipv6-cidr`. `classification` gained `unique-local`,
`carrier-grade-nat`, `documentation`, `benchmarking`, `reserved` and
`ipv4-mapped`. A new test requires every value in that enum to be exercised by
at least one vector, so a classification cannot be added as a word with no rule
behind it.

### Verification

`node tools/repo.mjs check:all` — 7 checks, 278 tests, exit 0.
68 address vectors: 47 IPv4, CIDR, hostname and URL; 21 IPv6.

## Revision — review pass over the whole repository

### Verification before changing anything

`node tools/repo.mjs check:all` — 7 checks, 273 tests, exit 0. The working tree
was compared file by file against `main` using Git blob hashes: 157 files on
each side, no file missing, no file extra, no content drift.

### Defect fixed — a terminal state that was not terminal

`finding-lifecycle.schema.json` said of `terminal`: "A finding never leaves a
terminal state without new evidence, so no transition may originate from one."
Both states flagged terminal in the sample violated the second half.
`false-positive` transitions to `triaged` and `verified` transitions to
`reopened`.

The test that should have caught it did not. It computed the outgoing
transitions of each state and then, for a terminal state, discarded them and
skipped — so a state could claim to be a resting place while the table beneath
it said otherwise, and the suite read green.

The data was right and the description was wrong. Both exits require
`redacted-evidence`, which is exactly the first half of the rule: a resting
state may be left, but only on new evidence. The description now states that,
and the test asserts it — every transition out of a terminal state must demand
new evidence. An unconditional exit is what makes the flag a label with nothing
behind it.

### Tightening — an unconditional transition is no longer expressible

`requires` had `maxItems` and no `minItems`, so a transition demanding nothing
was a legal document. Every transition in the table already requires at least
one item, so `minItems: 1` costs nothing and removes a state change that an
audit could not reconstruct afterwards. `check:contracts` now rejects it before
the tests run.

### Correction — a blocker that was no longer real

E0-007 recorded its two action pins as blocked because "resolving the SHA for
the chosen release needs network access to the action repository". That was
true when written and is no longer true: the environment has an authenticated
`gh`. Both are now pinned to the commit their release tag resolves to, read
from the action repository:

- `actions/checkout` v7.0.1 → `3d3c42e5aac5ba805825da76410c181273ba90b1`
- `actions/setup-node` v7.0.0 → `820762786026740c76f36085b0efc47a31fe5020`

The earlier note in this repository suggested resolving `v5`. Both actions are
now at v7, so following that note would have pinned two major versions of stale
code. The tag was resolved rather than assumed.

With the pins in place the PR workflow renders and `.github/workflows/pr.yml`
exists. `check:workflows` stopped reporting a deferral and started verifying a
file byte-for-byte against its descriptor.

The four image digests were **not** pinned. Each waits on a selection its own
task owns — which Python runtime, which Java LTS, which base image the Console
ships on, which PostgreSQL the topology runs — so pinning one now would decide
that task's design from outside it. Only the network half of their blocking
reason was resolved.

### Second defect — a test that pinned a state instead of a property

Rendering the workflow made `repository-task-interface.test.mjs` fail. It
asserted the literal string "actions not yet pinned", which described the
repository on the day it was written rather than the behavior being tested. It
now asserts the property: the check reports **either** a deferral **or** a
rendered workflow, never both and never neither. Silence would let an unpinned
action read as a verified workflow.

### Not changed

The remaining audit found nothing to fix. Every keyword used by the ten
contracts is in the validator's supported set, so no contract is enforced by a
rule that is silently ignored. The safety claims made in schema prose are
carried by structure rather than by comment: `synthetic_data_only` is
`const: true`, `risk_signals` has no aggregate score field to collapse into,
`evidence_ids` holds identifiers so bytes cannot be inlined, and `context` is
bounded. Seventeen tests in `scope-record.test.mjs` appear to assert nothing
until read: they call a helper that asserts both rejection and the JSON path the
rejection came from, which is stronger than asserting rejection alone.

### Verification

`node tools/repo.mjs check:all` — 7 checks, 274 tests, exit 0.
Coverage over `tools/`: 95.63% line, 98.06% branch, 96.83% function.

Both new lifecycle invariants were confirmed to fail on the previous data before
the fix was applied: removing `redacted-evidence` from the `verified` exit
produces "verified is terminal but leaves to reopened without new evidence", and
emptying a `requires` list is rejected by `check:contracts` at
`/transitions/4/requires`.

## Revision — root README rewritten against the built repository

### Why

The root README described the specification and said nothing about the
foundation that now verifies it. A reader arriving at the repository could not
learn the bootstrap command, what the seven checks enforce, which tasks are
built, which are blocked, or what a contributor is expected to run before
opening a pull request. It also stated the 95% coverage requirement without
saying what the repository currently measures.

### What was added

Repository layout with the purpose of every directory; the nine tasks of
`tools/repo.mjs` with what each enforces and the exit-code contract; the design
principles the tooling actually implements (fail closed, make the unsafe state
inexpressible, generate rather than parse, canonical serialization, one producer
per aggregate, zero dependencies in the verification path); the ten contracts
and what each holds; the version-manifest selection rule and current pins; the
ADR index; the four conflicts that block ready work and the two inputs needed
from a human; and the commit, branch and pull-request conventions.

### Measurement recorded rather than gated

Coverage over `tools/` with the foundation suite is 95.72% line, 98.41% branch,
96.83% function. Two hazards are stated alongside it rather than left for a
reader to trip over:

- Passing a **directory** to `node --test --experimental-test-coverage` produces
  a report naming zero files and an aggregate of 100%. This is the same
  false-green shape as the `NODE_TEST_CONTEXT` defect found in E0-001: a
  measurement that ran nothing reads as a perfect result.
- `tools/repo.mjs` measures 73.99% line because its task bodies run in
  subprocesses, which V8 coverage in the parent cannot attribute. The behavior
  is tested; the attribution is missing.

No coverage gate was added to `check:all`. The threshold is entry 4 of
[`08-specification-conflicts.md`](08-specification-conflicts.md), still open, and
[`01-operating-manual.md`](01-operating-manual.md) forbids resolving a conflict
silently by implementing one reading. Both hazards are recorded on that entry so
whoever decides it inherits them.

### Verification

`node tools/repo.mjs check:all` — 7 checks, 273 tests, exit 0.

Three links in the first draft did not resolve; `check:docs` reported all three
by path before the file was committed, which is the check doing its job.

## Revision — two producers writing one event aggregate

### Defect fixed

`ingestion.accepted.v1` is produced by the Finding Hub and was catalogued
against the `run` aggregate, which the orchestrator already writes with
`run.started`, `run.budget_warning`, `run.cancelled` and `run.completed`. Two
services were therefore incrementing one `aggregate_version` counter.

[`04-event-contracts.md`](../07-data-api/04-event-contracts.md) makes that
counter the only ordering the outbox guarantees, and tells a consumer that sees
a gap to rebuild from the source API. With two independent writers the sequence
either collides — two events claiming the same version, so a consumer
deduplicating on order drops one — or opens gaps that are not losses, so every
receipt triggers a rebuild that finds nothing missing. Neither shows up as a
failure; both degrade quietly under load, which is when a run is most likely to
be waiting on its ingestion receipt.

The receipt now versions its own `ingestion` aggregate. It keeps `run_id` in the
payload, which is what lets the orchestrator correlate the receipt back to the
run it completes — the correlation was never the problem, the shared counter
was.

### Why the contract did not catch it

The suite checked that every aggregate type in the catalog is expressible in the
envelope. Both `run` and `finding-hub` were legal values, so a legal event
described an illegal arrangement. Single-writer ownership was an assumption the
prose relied on and no contract stated.

Two tests now state it: each aggregate type has exactly one producer, and an
event type is named for the aggregate it versions. The first is the invariant;
the second is the readable form of it, and is what makes a violation visible at
the name instead of after tallying producers. Both were confirmed to fail on the
previous catalog before the fix was applied, and the first names the two
producers in its message.

### Verification

`node tools/repo.mjs check:all` — 7 checks, 273 tests, exit 0.

## E1-013 — Domain event contracts (preparation)

Status: **partial**. Depends on: E1-008. Phase 1.

### Changed files

- `packages/contracts/events/event-envelope.schema.json`
- `packages/contracts/events/event-catalog.schema.json`
- `packages/contracts/events/samples/**`, `packages/contracts/events/README.md`
- `tests/foundation/event-contracts.test.mjs`

### What the shape enforces

Three rules from
[event contracts](../07-data-api/04-event-contracts.md) became structural rather
than advisory.

A version is part of the type: `event_type` must end in `.vN`, so removing or
redefining a field means publishing a new type instead of silently breaking a
consumer. Deduplication and ordering are required fields: `event_id` is the
idempotency key and `aggregate_version` gives per-aggregate order.

Most usefully, a payload cannot carry evidence. Payload fields are declared by
name and type, and the type vocabulary has no free-text or binary member. An
event that wanted to carry a request body or a token has no way to express it,
which is stronger than a rule saying it must not.

### Cross-checks

The envelope and the catalog are separate documents, so the tests check they
agree: every producer and aggregate type in the catalog must be expressible in
the envelope, and every catalogued type must match the envelope's pattern. The
catalog is asserted to carry exactly the fourteen mandatory events the
specification lists. No event may be consumed by its own producer, which would
feed the relay back into the service that emitted it.

### Tests executed

`node tools/repo.mjs check:all` — 7 checks, 271 tests, exit 0.

### Known limitations and remaining risk

- The outbox, relay, delivery records and poison queue need Python and
  PostgreSQL. This is the contract both sides publish and consume against, not
  the mechanism.
- Payload fields are declared but not individually validated at ingestion. That
  belongs with the relay.

## E1-010 — Canonical finding model and lifecycle (preparation)

Status: **partial**. Depends on: E1-008. Phase 1.

### Changed files

- `packages/contracts/findings/occurrence.schema.json`
- `packages/contracts/findings/finding.schema.json`
- `packages/contracts/findings/finding-lifecycle.schema.json`
- `packages/contracts/findings/samples/**`, `packages/contracts/findings/README.md`
- `tests/foundation/finding-model.test.mjs`

### What is delivered

The canonical model existed only as prose and a state diagram. It is now three
contracts with a worked example: one Semgrep occurrence raised, confirmed,
remediated and verified.

Occurrence and finding are separate because SARIF is an interchange format, not
the domain model. The occurrence carries what a tool observed; the finding owns
identity, state and human decisions. That separation is what lets a scanner be
replaced without touching the workflow, and it is why `source_severity` sits on
the occurrence while `priority` sits on the finding with a rationale and a named
decider. Collapsing them is what
[vulnerability management](../04-security/07-vulnerability-management.md)
forbids, so the finding schema has no `severity` field at all and a test asserts
its absence.

The lifecycle is a contract rather than a diagram because the Finding Hub is
Python and the console is TypeScript, and both need the same answer to whether a
transition is allowed, who may perform it and what must exist first.

### Cross-checks rather than schema validation alone

Validation would let the state machine and the record drift apart, so the tests
tie them together: the two state sets must be identical, every transition must
name declared states, every state must be reachable from `new`, and every
non-terminal state must have an exit so a finding cannot strand.

The confirmation transition is asserted to demand exactly the ten evidence items
the [Finding Hub specification](../03-applications/05-finding-hub-spec.md)
lists, so weakening confirmation means changing a test that cites the source.
The sample's audit trail is asserted to be a legal path through the lifecycle,
chronological, and to end in the state the record claims.

### Correction made during implementation

The first sample finding carried a 65-character fingerprint. The contract check
caught it before the tests did, which is the intended order: a sample that no
longer matches its contract is how an unusable template reaches a reader.

### Tests executed

`node tools/repo.mjs check:all` — 7 checks, 257 tests, exit 0.

### Known limitations and remaining risk

- Nothing computes a fingerprint. The preference order is recorded per
  occurrence as `fingerprint_inputs.strategy`, but deduplication is E1-011.
- SARIF ingestion is not implemented. `source.format` records provenance so the
  mapping can be tested against real documents once a parser exists.
- Evidence redaction, quarantine and the ingestion receipt belong to the Finding
  Hub and need Python.
- The lifecycle is data, not an enforced state machine. Enforcement arrives with
  E1-012.

## E1-003 — Canonical scope serialization and digest (preparation)

Status: **partial**. Depends on: E0-004. Phase 1.

### Changed files

- `tools/scope-hash.mjs`
- `packages/contracts/security/canonical-form.schema.json`
- `packages/contracts/security/samples/canonical-form/canonical-vectors.json`
- `packages/contracts/security/samples/scope-record/*.json` — real digests.
- `packages/contracts/security/README.md`
- `adrs/011-canonical-scope-serialization.md`, `adrs/000-index.md`
- `docs/08-agent/08-specification-conflicts.md` — entry 12 partially addressed.
- `tests/foundation/scope-hash.test.mjs`

### What this closes

E0-004 left `approval.scope_hash` as a row of zeros in both sample scopes, with
a note that the serialization it covers was still undefined. That placeholder
was a hole: nothing verified the samples, and the field that makes a scope
tamper-evident carried no meaning.

The canonical form is now defined, implemented and pinned by vectors, and both
samples carry a real digest that is verified on every run. A scope edited
without re-approval is now detectable.

Recorded as [ADR-011](../../adrs/011-canonical-scope-serialization.md). The form
is deliberately narrower than JSON: sorted keys, preserved array order, no
insignificant whitespace, and integers only. Floating point has no single
textual form across languages and a scope has no use for one, so a non-integer
is an error rather than a value that would encode differently in Python.

### Correction made during implementation

The first generated vector file recorded `1e999` as a rejected input. It had
become `null` in the file, because `JSON.stringify` writes infinity as null, and
`null` is perfectly canonicalizable. Rejected cases are now held as JSON text
and parsed by the consumer, so an overflowing exponent survives intact.

### Tests executed

`node tools/repo.mjs check:all` — 7 checks, 238 tests, exit 0.
Coverage over the eleven unit suites: 99.78% line, 99.25% branch, 100% function.
`tools/scope-hash.mjs` is at 100% line, branch and function.

### Known limitations and remaining risk

- This is the serialization and digest only. The immutable snapshot store, the
  approval workflow and the state model of E1-003 need the Python orchestrator,
  which cannot be built here.
- Nothing signs the digest yet. Signer trust, key lifecycle and revocation are
  still open in the conflict register, entry 12.
- A future budget needing a fraction must use integer units, or the form changes
  deliberately with a new `form_version` and new vectors, invalidating every
  existing digest.

## E1-001 — Special-range policy conformance vectors (preparation)

Status: **partial — blocked**. Depends on: E0-004. Phase 1.

### Changed files

- `packages/contracts/security/address-policy.schema.json`
- `packages/contracts/security/samples/address-policy/ipv4-and-host-vectors.json`
- `tests/foundation/address-policy.test.mjs`

### What blocks completion

E1-001 implements canonicalization in `services/orchestrator`, which is Python.
Python is not installed on this workstation and its runtime and package manager
are still unselected in the version manifest, so the implementation and its
tests cannot be written or run here.

### What is delivered

The language-neutral half. The scope contract decides which targets may be
written down, and the Python canonicalizer will decide the same question at
runtime. Two implementations of one rule drift unless they share a definition,
so the definition is now a contract: 39 vectors giving an input, its
classification and whether it may appear in a scope record at all.

A test asserts that every vector agrees with the pattern the scope contract
already enforces, so the two cannot diverge silently. The vectors cover RFC 1918
boundaries on both sides, loopback, the cloud metadata address, the wildcard and
broadcast addresses, multicast, alternate encodings of loopback, an out-of-range
octet, a CIDR prefix below the policy minimum, reserved and public domains, and
URL userinfo used to disguise a public host as loopback.

When Python arrives, the canonicalizer is tested against the same file. Runtime
concerns that a static vector cannot express — DNS resolution and pinning,
answer drift and rebinding, redirect revalidation — remain E1-002.

## Revision — cross-language hazards in the canonical form

### Defect fixed

[ADR-011](../../adrs/011-canonical-scope-serialization.md) claims byte-exact
agreement between a TypeScript console and a Python orchestrator, and the form
as first written had two ways to break that claim silently.

**Key ordering.** JavaScript sorts by UTF-16 code unit and Python by code point.
The two agree across the basic multilingual plane and disagree above it, so a
key outside the BMP would have produced a different digest in each language with
nothing reporting a problem. Object keys are now restricted to
`[A-Za-z0-9_.-]`, which removes the divergence rather than relying on it never
being reached.

**String escaping.** Non-ASCII text is emitted literally. Python's `json.dumps`
escapes to `\uXXXX` by default, so an implementation written the obvious way
would disagree on every scope containing an accented character. The rule is now
stated in the ADR and in the contract README: serialize with
`ensure_ascii=False`.

An unpaired surrogate is also refused outright. It has no UTF-8 encoding, so no
two languages agree on its bytes.

### Why this mattered

Neither hazard would have surfaced as a failure. Both produce a digest that is
merely different, and a scope whose digest does not verify reads as tampering.
The failure would have appeared during Phase 1 integration as an authorization
boundary that intermittently refuses valid scopes.

### Verification

Existing digests are unchanged, so the hardening is backward compatible and both
sample scopes still verify. Three rejected vectors were added to the conformance
file so a second implementation is held to the same rules.

`node tools/repo.mjs check:all` — 7 checks, 242 tests, exit 0.
`tools/scope-hash.mjs` is at 100% line, branch and function coverage.

## Revision — review pass over Phase 0

### Defect fixed

`tools/schema.mjs` compiled `pattern` with the unicode flag at validation time.
Unicode mode rejects identity escapes that are legal in an ordinary ECMA-262
pattern, so a schema using `\-` would have thrown a `SyntaxError` out of the
middle of a validation run instead of reporting a problem, and the expression
was recompiled for every array element. Patterns are now compiled once during
the schema walk, cached, and an invalid one is a `SchemaError` like any other
schema fault. Four tests cover it, including a pattern that is only reachable
when no instance visits it.

### Simplification

Three near-identical reporters in `tools/repo.mjs` became one. Every check now
returns `{problems, deferred?, note?}` and shares the same output shape and
exit-code meaning, and deferred work is reported as `{id, blockedBy}` by both
the topology and workflow checks rather than in two different shapes.

### Added

`check:all` runs every check in bootstrap order and stops at the first failure.
This is the single documented bootstrap command the root README calls for and
the "clean bootstrap invokes smoke tests" criterion in the Phase 0 exit.

It is verified by running it, not by a test: `check:all` runs
`check:foundation`, so a test that executed it would recurse into the suite that
contains the test. Its parts are individually covered.

### Verification

`node tools/repo.mjs check:all` — 7 checks, 223 tests, exit 0.
Coverage over the nine unit suites: 99.77% line, 99.19% branch, 100% function.

## E0-007 — Create base PR workflow with minimal permissions

Status: **partial — blocked**. Depends on: E0-002, E0-003. Phase 0.

The descriptor, contract, policy, renderer and check are complete and tested.
No workflow file exists, and the task is not done.

### Changed files

- `packages/contracts/ci/workflow-set.schema.json`
- `.github/workflow-set.json`
- `tools/workflows.mjs`, `tools/repo.mjs` — adds `check:workflows`.
- `tools/prerequisites.mjs` — actions now carry a pinned or unselected status.
- `adrs/010-generated-ci-workflows.md`, `adrs/000-index.md`
- `tests/foundation/workflow-policy.test.mjs`
- `version-manifest.json`, `tests/foundation/version-manifest.test.mjs`

### What blocks completion

**Action SHAs cannot be resolved here.** The CI architecture requires
third-party actions pinned to immutable commit SHAs, and a workflow cannot check
out the repository without `actions/checkout`. Resolving a real SHA needs
network access to the action repository. Writing a plausible-looking SHA would
fabricate a supply-chain pin, so the manifest records both actions as
`unselected` and rendering fails closed. To finish this part, pin
`actionsCheckout` and `actionsSetupNode` in `version-manifest.json`, then run
`node tools/repo.mjs check:workflows`.

**Four normative conflicts remain open**, all in
[the conflict register](08-specification-conflicts.md): required-tool error
semantics (entry 1), coverage and triage thresholds (entry 4), protected policy
independence (entry 8) and PR active-profile terminology (entry 9). Those govern
the security-gate behaviour of the workflow, not the base job, so the base job
is specified here and the gate stages wait for a decision.

### What is enforced now

The descriptor is validated and the policy runs today, so the rules are live
before the first workflow file exists. Recorded as
[ADR-010](../../adrs/010-generated-ci-workflows.md), applying the same
generate-rather-than-parse decision as ADR-009.

Structure removes several problems entirely: `pull_request_target` is not a
trigger, only the permission scopes this project uses exist, a job must declare
`timeout_minutes`, and an action is named by manifest identifier so no
repository and tag can be written inline.

Policy adds what structure cannot express: no write permission on a
pull-request workflow, no `${{ }}` interpolation reaching a `run` command or an
action input, and a runtime version that must agree with the version manifest.

The injection rule matters most. A `run` step containing
`${{ github.event.pull_request.title }}` is the standard GitHub Actions remote
execution path, because the expression is substituted before the shell sees the
script. It is covered by test.

### Tests executed

`node tools/repo.mjs check:workflows` — policy clean, 2 actions pending, exit 0.
`node tools/repo.mjs check:foundation` — 211 tests, 211 passed, exit 0.

Coverage over the nine unit suites: 99.76% line, 99.17% branch, 100% function.

### Change to the version manifest contract

Actions previously had to carry a 40-character commit SHA, which left no way to
record an action that is known but not yet pinned. An action now declares
`pinned` with a repository and SHA, or `unselected` with the task that must pin
it, matching how runtime and image entries already work. The invariant is
unchanged: a tag is never accepted in place of a pin, and there is no third
state.

Without this the workflow check would have been permanently red with no way to
make it green, which teaches people to ignore it.

## E0-006 — Add architecture dependency fitness tests

Status: complete. Depends on: E0-001. Phase 0.

### Changed files

- `tools/architecture-check.mjs`
- `tools/repo.mjs` — adds `check:architecture`.
- `tests/foundation/architecture-check.test.mjs`

### What is enforced

Dependency edges are default deny. Every module declares the modules it may
import, and an edge that is not declared is a violation, so a new coupling has
to be added deliberately rather than appearing by accident.

Three of the fitness functions in
[architecture quality](../02-architecture/07-architecture-quality.md) are now
executable: prohibited dependency edges, no import from an insecure target into
a secure one, and no process execution outside orchestrator adapters. The other
listed fitness functions are already covered elsewhere — public port mapping and
non-root containers by `check:exposure`, and contract examples by
`check:contracts`.

A secure module importing `apps/web-lab-insecure` is reported with its own
message rather than the generic edge message, because
[security gates](../05-devsecops/03-security-gates.md) makes that an
unconditional gate failure rather than an ordinary boundary breach.

Process execution is detected across JavaScript, Python and Java, so the rule
holds for the orchestrator and Java API before either exists. Repository tooling
under `tools/` and its tests are declared as permitted process starters, since
they run the checks themselves.

### Tests executed

`node tools/repo.mjs check:architecture` — no problems across 16 source files.
`node tools/repo.mjs check:foundation` — 179 tests, 179 passed, exit 0.

Coverage over the eight unit suites: 99.70% line, 99.24% branch, 100% function.

Two tests exist to stop the check passing vacuously. One asserts it analyses at
least ten real files including `tools/repo.mjs`. The other parses the layout
table in
[module boundaries](../02-architecture/03-monorepo-module-boundaries.md) and
asserts every documented module is declared in the enforced graph, so a module
added to the specification cannot stay unenforced.

### Correction made during implementation

The first version of the secure-imports-insecure test reported no violation. The
checker was right and the fixture was wrong: the relative specifier used three
parent steps, which escapes `apps/` entirely and resolves outside any module.
Worth recording because a looser assertion would have accepted the empty result
and left the most important gate untested.

### Known limitations and remaining risk

- Only relative specifiers are resolved. Once workspace package names exist,
  bare specifiers such as `@seclab/ts-domain` need mapping too, or an intended
  edge will pass unchecked.
- Imports are found by pattern, not by parsing. A specifier inside a comment or
  string literal would be treated as real.
- The dependency graph is analysed for JavaScript and TypeScript only. Python
  and Java need their language-native tooling, and the module boundaries
  document expects that where possible.
- The graph lives in `tools/architecture-check.mjs` rather than in a validated
  contract. It is coupled to the specification by test instead.

## E0-005 — Create private Compose topology and exposure assertion

Status: complete. Depends on: E0-001. Phase 0.

### Changed files

- `packages/contracts/infra/lab-topology.schema.json`
- `infra/compose/lab-topology.json`, `infra/compose/README.md`
- `tools/topology.mjs` — exposure policy and Compose rendering.
- `tools/repo.mjs` — adds `check:exposure`.
- `tools/schema.mjs` — adds byte-order-mark tolerant JSON parsing.
- `adrs/009-generated-lab-topology.md`, `adrs/000-index.md`
- `tests/foundation/lab-topology.test.mjs`
- `version-manifest.json` — adds container image entries.

### Decision: generated, not hand-written

Enforcing the exposure invariants against hand-written Compose YAML would mean
parsing YAML, and a partial parser that misreads a construct silently
under-checks a safety file. Adding a YAML dependency is a supply-chain decision
Phase 0 is not ready to make. The topology is therefore a validated JSON
descriptor, and the Compose file is rendered from it. Recorded as
[ADR-009](../../adrs/009-generated-lab-topology.md).

The strongest property is that unsafe configuration is not representable. The
schema has no field for a wildcard bind address, privileged mode, host
networking, added capabilities or bind mounts, and container hardening uses
`const true`, so `read_only` cannot be switched off. There is nothing to reject
because there is nothing to write.

### Tests executed

`node tools/repo.mjs check:foundation` — 161 tests, 161 passed, exit 0.
`node tools/repo.mjs check:exposure` — no problems, 4 images deferred, exit 0.

Coverage over the seven unit suites: 99.82% line, 99.43% branch, 100% function.
`schema.mjs`, `docs-check.mjs`, `contracts-check.mjs` and `topology.mjs` are at
100% line and branch.

Tests cover a target that publishes a host port, a target attached to the
ingress network, a second ingress network, duplicate host ports, undeclared
network and service references, an image outside the manifest, an image pinned
by tag instead of digest, and a hand-edited Compose file that swaps
`127.0.0.1` for `0.0.0.0`.

### Correction made during implementation

The topology first referenced the `node`, `python` and `java` version-manifest
entries directly. The exposure check rejected that, correctly: those entries pin
a host runtime, which is not the same artifact as a container base image. The
manifest now carries separate `nodeImage`, `pythonImage` and `javaImage`
entries, and image resolution requires an immutable sha256 digest rather than a
tag, per [ADR-007](../../adrs/007-pinned-artifacts.md).

### Known limitations and remaining risk

- No Compose file is generated yet. Every container image is unselected because
  a digest cannot be resolved without registry access, and rendering fails
  closed rather than emitting a tag-pinned file. The check asserts that no
  unverified Compose file exists in the meantime.
- The schema cannot express volumes, so the datastore services are not yet
  runnable. Adding volumes is a reviewed schema change on purpose: a bind mount
  is how a Docker socket reaches a container.
- This is a static assertion over a definition. Probing actually listening
  sockets, verifying routes and confirming closed ports after teardown need
  running containers and arrive with the first real service in E2-001.
- Egress denial is expressed only as network `internal: true`. Per-service
  egress allowlists remain open in the conflict register, entry 10.

## E0-004 — Define scope JSON Schema and safe sample scopes

Status: complete. Depends on: E0-001. Phase 0.

### Changed files

- `packages/contracts/security/scope-record.schema.json`
- `packages/contracts/security/samples/scope-record/lab-loopback.json`
- `packages/contracts/security/samples/scope-record/lab-private-network.json`
- `packages/contracts/security/README.md`
- `tests/foundation/scope-record.test.mjs`

### What the contract makes impossible

The schema carries every mandatory scope field from
[the Rules of Engagement](../04-security/02-rules-of-engagement.md) and the
[orchestrator specification](../03-applications/04-orchestrator-spec.md), and it
turns several rules from prose into structure. Address and hostname patterns
admit only loopback, RFC 1918 space and RFC 2606 reserved domains, so a public
target cannot be expressed. `allowed_profiles` has no value that authorizes
destructive tooling. Every budget is bounded above. `synthetic_data_only` must
be `true`. Unknown properties are rejected everywhere.

### Tests executed

`node tools/repo.mjs check:foundation` — 134 tests, 134 passed, exit 0.

The Phase 0 exit criterion that deliberate public and out-of-scope fixtures are
rejected is covered by tests that feed the contract public addresses
(`8.8.8.8`, `93.184.216.34`, `172.32.0.1`), the cloud metadata address
`169.254.169.254`, the wildcard `0.0.0.0`, alternate encodings of loopback
(`127.000.000.001`, `2130706433`, `0x7f.0.0.1`, `::ffff:127.0.0.1`), public
hostnames and URLs, non-http schemes, a destructive profile, real-data handling,
over-ceiling budgets and a missing approval. Unsafe fixtures are built inside the
test rather than stored as files, so an out-of-scope document can never be
mistaken for a usable template.

### Known limitations and remaining risk

- This is a static check on a document, not the Scope Guard. Canonicalizing a
  requested target, pinning DNS answers, revalidating redirects and rejecting
  hostnames that only resolve into private space at runtime remain E1-001 to
  E1-004.
- IPv6 targets are not expressible. The lab topology is IPv4 for now, and adding
  IPv6 needs the same private-range treatment plus the dual-stack exposure tests
  named in the conflict register, entry 10.
- The sample `scope_hash` is a placeholder. The canonical serialization it
  covers is defined with the immutable scope snapshot in E1-003.
- The schema cannot express "at least one address family is present", because
  that needs a keyword the validator deliberately does not support. Requiring a
  non-empty application and port list is the closest structural equivalent.

## E0-003 — Implement documentation/contract validation jobs

Status: complete. Depends on: E0-001. Phase 0.

### Changed files

- `tools/schema.mjs` — JSON Schema subset validator.
- `tools/docs-check.mjs`, `tools/contracts-check.mjs`
- `tools/repo.mjs` — adds `check:docs` and `check:contracts`.
- `tests/foundation/schema-validator.test.mjs`
- `tests/foundation/documentation-check.test.mjs`
- `tests/foundation/contracts-check.test.mjs`

### Design note: a validator that fails closed

`tools/schema.mjs` implements a subset of JSON Schema draft 2020-12 and throws
on any keyword it does not implement. A validator that ignores an unknown
keyword would report a security contract as valid while enforcing less than the
contract states, which is the same class of false pass as a missing scanner
result. Unsupported input is therefore an error, not a silent allowance.

This is why the repository has no JSON Schema dependency. Selecting one is a
supply-chain decision that needs registry access and review, and the subset here
is small enough to test exhaustively.

### Tests executed

`node tools/repo.mjs check:docs` — no problems across 104 Markdown files.
`node tools/repo.mjs check:contracts` — no problems.
`node tools/repo.mjs check:foundation` — 134 tests, 134 passed, exit 0.

Coverage, measured over the six unit suites with
`node --test --experimental-test-coverage`: 99.63% line, 98.93% branch, 100%
function. Per module: `contracts-check.mjs` and `docs-check.mjs` at 100%,
`schema.mjs` at 99.69% line, `prerequisites.mjs` at 99.18% line.

The documentation suite asserts that the checker actually reads more than fifty
Markdown files before reporting success, so a checker that inspected nothing
cannot pass as clean.

### Known limitations and remaining risk

- Only repository-relative links are verified. External URLs and heading
  anchors are not resolved.
- Fence checking counts fences rather than parsing Mermaid. A syntactically
  invalid diagram still passes.
- The validator supports no combinator keywords (`oneOf`, `anyOf`, `allOf`,
  `if`/`then`), so a contract needing one will fail to compile rather than be
  half-enforced. Adding one is a deliberate change with its own tests.

## E0-002 — Add version manifest, exact lockfiles and prerequisite verifier

Status: complete. Depends on: E0-001. Phase 0.

### Changed files

- `version-manifest.json` — version manifest covering every field required by
  [`07-assumptions-version-policy.md`](../00-overview/07-assumptions-version-policy.md).
- `package.json`, `package-lock.json` — private root manifest with exact
  `engines` pins and a lockfile.
- `tools/prerequisites.mjs` — manifest validation and prerequisite evaluation.
- `tools/repo.mjs` — adds the `check:prerequisites` task.
- `tests/foundation/version-manifest.test.mjs`
- `tests/foundation/prerequisite-verifier.test.mjs`
- `tests/foundation/repository-task-interface.test.mjs` — task wiring and
  fail-closed manifest handling.
- `MANIFEST.md`, `docs/09-operations/01-local-development-runbook.md`

### Pinned versions

`node` 24.18.1, `npm` 11.16.0 and `containerRuntime` (Docker Engine) 29.6.2.
Each was verified on this workstation on 2026-08-03 by running its version
command, not by assuming presence.

Every other required field is present but recorded as `unselected` with the
backlog task that must decide it. Selecting them means choosing currently
maintained releases, which needs registry access and, for the Python package
manager and signing toolchain, a decision that is still open. The manifest
schema forbids a prerequisite required by the active phase from staying
unselected, so an unpinned tool cannot slip through: it fails the check.

### Tests executed

`node tools/repo.mjs check:foundation` — 61 tests, 61 passed, exit 0.
`node tools/repo.mjs check:prerequisites` — 3 satisfied, 20 deferred, exit 0.

Coverage of `tools/prerequisites.mjs`, measured with
`node --test --experimental-test-coverage` over the two unit suites: 99.10%
line, 97.26% branch, 100% function. This meets the 95% threshold in
[`02-tdd-coverage-mutation.md`](../06-testing/02-tdd-coverage-mutation.md). The
only uncovered lines are the `resolveNpmCli` fallback that returns `null`, which
is unreachable while a bundled npm exists.

### Design note: presence is not evidence

The verifier accepts a tool only when its version command produces output
matching the expected pattern. The workstation demonstrates why: `python` and
`python3` both resolve on PATH to Microsoft Store stubs that exit without
printing a version. A presence check would have reported Python as installed.

The npm probe runs npm's CLI through the current Node binary rather than the
`npm.cmd` shim, because Node refuses to spawn `.cmd` without a shell and the
secure coding standard prohibits shell execution.

### Known limitations and remaining risk

- Coverage is measured but not enforced. A repository-wide gate cannot be set
  honestly yet: `tools/repo.mjs` runs only as a subprocess, so its coverage
  reads as zero, and the exclusion policy that would fix this belongs to the
  quality-gate task rather than to an ad-hoc decision here.
- The lockfile has no dependencies to lock. It fixes the root manifest only.
- `postgresql` needs an image digest rather than a host version, so the
  verifier has no probe for it. That is recorded on the entry and must be
  resolved with the Compose topology in E0-005.
- No mutation testing exists yet.

## E0-001 — Create polyglot monorepo and repository task interface

Status: complete. Depends on: none. Phase 0.

### Changed files

- `tools/repo.mjs` — repository task interface.
- `apps/{console-web,web-lab-insecure,web-lab-secure,api-java-lab,mobile-lab}/README.md`
- `services/{orchestrator,finding-hub,report-generator}/README.md`
- `packages/{contracts,ts-domain}/README.md`
- `security/{rules,profiles}/README.md`
- `infra/{compose,terraform}/README.md`
- `tests/capstone/README.md`
- `tests/foundation/repository-task-interface.test.mjs`
- `MANIFEST.md`

Each module directory carries a README stating its purpose, its authoritative
specification and the boundary rules from
[`03-monorepo-module-boundaries.md`](../02-architecture/03-monorepo-module-boundaries.md).

### Tests executed

`node tools/repo.mjs check:foundation` — 15 tests, 15 passed, exit 0.

The suite covers the prescribed module boundaries, physical separation of the
insecure and secure Web targets, the task interface contract, and the
fail-closed behavior of the foundation check.

### Defect found and fixed during implementation

The foundation check initially reported success while its own tests failed. A
nested `node --test` that inherits `NODE_TEST_CONTEXT` skips every file and
exits 0, so any invocation from inside a Node test context produced a green
result that ran nothing — the "scanner reports zero issues but its output is
missing" case from [`04-definition-of-done.md`](04-definition-of-done.md).
`tools/repo.mjs` now clears `NODE_TEST_CONTEXT` and `NODE_TEST_WORKER_ID`
before spawning the runner, and two regression tests cover it.

### Versions

Node.js v24.18.1 on Windows 10. No third-party dependencies were introduced.

### Known limitations and remaining risk

- Coverage and mutation thresholds are not yet measured. The tooling arrives
  with E0-002 and E0-003; the current suite exercises every branch of
  `tools/repo.mjs` except two defensive paths (spawn failure, missing error
  code).
- The workspace is not a Git repository and `git` is not installed, so no
  commit, diff review or history exists yet.
- `python` and `java` are not installed. Both are prerequisites for
  `services/*` (E1) and `apps/api-java-lab` (E3) and belong in the E0-002
  prerequisite verifier.
- Only `check:foundation` exists. Lint, type, coverage and security tasks are
  added by their own backlog tasks rather than stubbed here.
