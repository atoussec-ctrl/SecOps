# Vulnerable-target Exposure Incident Runbook

## Trigger

Use this runbook if a vulnerable target or scanner is reachable outside the
approved private/loopback boundary, sends traffic out of scope or may have
processed non-synthetic data.

## Immediate containment

1. Activate the global kill switch.
2. Disable affected container/device network interface or stop the target.
3. Revoke execution grants and synthetic credentials.
4. Block public ingress/egress at the nearest owned control.
5. Do not continue active investigation against any third-party destination.

## Preserve bounded facts

- Engagement/run IDs and scope hash.
- Target, image and configuration digests.
- Bind addresses, routes and network-policy state.
- Start/stop timestamps.
- Redacted destination metadata and request counters.
- Actor/action audit events.

Do not collect broad packet captures or unrelated host data without separate
authorization.

## Assess

- Was the service actually reachable externally?
- Did any external address connect?
- Did the target make out-of-scope requests?
- Was real data or credential material present?
- Which invariant/test/configuration failed?
- Are other environments built from the same artifact/configuration affected?

## Eradicate and recover

- Destroy affected disposable environment.
- Rotate any potentially exposed non-production secrets.
- Fix root cause in configuration/code/policy.
- Add a regression/fitness test.
- Rebuild from reviewed source and pinned artifacts.
- Repeat exposure assertions from inside and outside the lab boundary.
- Resume only with explicit owner approval.

## Notify and document

Notify the named stop contact immediately. If any third party or real data may
be affected, follow the organization's incident/legal process rather than this
lab document alone. Produce an incident record, timeline, root cause,
containment, corrective actions and verification evidence.

## Post-incident rule

Do not classify the incident as resolved merely because the target was stopped.
Closure requires root-cause fix, regression test and review of similar paths.

