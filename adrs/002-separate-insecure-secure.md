# ADR-002: Separate Insecure and Secure Deployable Units

Status: Accepted

## Context

A runtime vulnerability flag can be enabled accidentally and may allow unsafe
code to enter a secure release artifact.

## Decision

Build insecure and secure Web/Mobile targets as separate modules, artifacts and
application identifiers. They may share stable external contracts and safe
domain primitives, but insecure implementations cannot be imported by secure
build graphs. Insecure artifacts are non-releaseable.

## Consequences

- Stronger safety and clearer comparison.
- Some feature duplication and synchronization tests are required.
- CI must validate equivalent intended external behavior and prohibited imports.

## Rejected alternative

One artifact with `VULNERABLE_MODE`: too easy to misconfigure or publish.

