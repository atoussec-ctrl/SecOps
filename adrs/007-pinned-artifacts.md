# ADR-007: Pin Inputs and Attest Outputs

Status: Accepted

## Context

Mutable versions, tags and third-party actions prevent reproducibility and can
introduce supply-chain drift between test and release.

## Decision

Use exact dependency versions/lockfiles, pin third-party actions and tool images
immutably, build candidates once, address artifacts by digest, generate SBOM,
sign approved secure digests and produce provenance.

## Consequences

- Updates happen through explicit reviewed PRs.
- Cache and maintenance effort increases.
- Release claims can be verified against exact materials and outputs.

## Rejected alternative

Floating `latest`/major tags in protected workflows: non-reproducible and
unsafe.

