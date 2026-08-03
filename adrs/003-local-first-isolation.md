# ADR-003: Local-first Private Isolation

Status: Accepted

## Context

Intentionally vulnerable targets create unacceptable public-hosting risk and do
not need public reachability for the learning goals.

## Decision

Core operation runs on an owned workstation or isolated CI runner. Vulnerable
targets bind only to loopback/private host-only networks, deny egress by default
and have no public persistent environment.

## Consequences

- Lower third-party risk and simpler data model.
- Remote collaboration requires sharing sanitized artifacts/specs rather than a
  public vulnerable instance.
- iOS/device workflows require dedicated local/dedicated runners.

## Rejected alternative

Public multi-tenant lab SaaS: materially expands isolation, abuse and legal
requirements beyond scope.

