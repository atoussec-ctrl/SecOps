# ADR-006: Progressive Evidence-based Security Gates

Status: Accepted

## Context

Blocking on every raw scanner warning creates noise and encourages broad
suppressions. Allowing all warnings creates unbounded risk.

## Decision

Use unconditional safety gates plus progressive gates based on newness,
confidence, reachability, artifact class, finding state and valid expiring risk
acceptance. Required-tool failure is not a zero-finding pass.

## Consequences

- Findings require normalization and triage state.
- Policy decisions are explainable and auditable.
- Baselines and exceptions require maintenance.
- Safety invariants remain non-bypassable.

## Rejected alternatives

- Severity-only blocking: tool-specific and noisy.
- Advisory-only scanning: insufficient for protected release.

