# ADR-004: Use SARIF for Interchange, Not the Full Workflow Model

Status: Accepted

## Context

Many static/security tools emit SARIF, but a professional finding workflow needs
occurrences, evidence, risk decisions, remediation, retest and acceptance.

## Decision

Accept and export SARIF where appropriate, preserve raw documents immutably and
normalize results into a separate canonical Finding domain model.

## Consequences

- Tool integrations are easier and Git-hosting code scanning is supported.
- Mapping/fingerprint logic must be versioned and tested.
- Raw tool severity never silently becomes business priority.

## Rejected alternative

Store only SARIF: insufficient workflow and domain guarantees.

