# Finding contracts

The tool-neutral security record, as contracts rather than prose.

| Path | Content |
| --- | --- |
| `occurrence.schema.json` | A single tool result after normalization |
| `finding.schema.json` | The canonical finding that groups occurrences |
| `finding-lifecycle.schema.json` | The state machine, its roles and the evidence each transition demands |
| `samples/` | A worked example: one Semgrep occurrence raised, confirmed, remediated and verified |

## Why three contracts and not one

SARIF is an interchange format, not the domain model. A `result` becomes an
occurrence and carries only what the tool observed; the finding owns identity,
state and the decisions a person made. Keeping them apart is what lets a scanner
be replaced without touching the workflow, and it is why `source_severity` lives
on the occurrence while `priority` lives on the finding with a rationale and a
named decider. The vulnerability management specification is explicit that these
inputs are never collapsed into one opaque score.

The lifecycle is a third contract because the Finding Hub is Python and the
console is TypeScript. Both need the same answer to "may this finding move from
here to there, who may do it, and what must exist first", and a diagram cannot
be executed by either.

## What the tests hold together

Schema validation alone would let the state machine and the record drift apart,
so the suite cross-checks them:

- the lifecycle states and the finding schema's `state` enum are the same set;
- every transition names declared states and actually changes state;
- every state is reachable from `new`, and every non-terminal state has a way
  out, so a finding cannot strand;
- the confirmation transition demands exactly the evidence set listed in the
  Finding Hub specification;
- verification requires an independent reviewer, a retest and the digest of the
  artifact retested;
- the sample finding's audit trail is a legal path through the lifecycle, is
  chronological, and ends in the state the record claims to hold.

## Not yet covered

Fingerprint computation is specified as an ordered preference of strategies and
recorded on each occurrence as `fingerprint_inputs.strategy`, but nothing here
computes one. Deduplication, evidence redaction and the ingestion receipt belong
to the Finding Hub and arrive with E1-008 through E1-011.

SARIF ingestion itself is not implemented. `source.format` records where an
occurrence came from so the mapping can be tested against real documents later.
