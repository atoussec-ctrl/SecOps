# Assumptions and Technology Version Policy

## Closed assumptions

- The core platform is local-first and not a public SaaS.
- Linux is the reference CI runner.
- macOS/Xcode is available for full iOS implementation/testing.
- GitHub Actions and Terraform are the requested delivery/IaC technologies.
- PostgreSQL is available locally through containers.
- The learner owns all runtime targets and Mobile test devices/profiles.
- TypeScript, Python and Java are mandatory implementation languages; Kotlin and
  Swift are used for platform-specific Mobile adapters.

## Version selection

The implementing agent must select currently maintained releases at Phase 0,
prefer LTS runtimes, pin exact versions and record them in a version manifest.
This specification intentionally avoids floating exact version numbers that may
be stale when implementation begins.

Selection criteria:

1. Actively maintained and security-supported.
2. Compatible with required analyzers and build runners.
3. Stable release, not preview, unless an ADR justifies otherwise.
4. Reproducible installation and exact lock support.
5. License compatible with the project.

## Required version manifest fields

- Node, package manager and TypeScript.
- Python and dependency manager/lock format.
- Java, build tool and Spring Boot.
- React, React Native, Android Gradle/SDK and Xcode/Swift.
- PostgreSQL and container runtime expectations.
- Every scanner/tool image/version/digest.
- SBOM/signing/provenance tools.
- GitHub Actions pins.

## Update rule

Automated tooling may propose updates, but it cannot merge them solely because a
newer version exists. The update must pass relevant scenario, compatibility,
security and artifact-diff checks. Tool upgrades also require normalization and
false-positive fixture comparison.

## Decisions deferred to Phase 0

- Exact supported runtime versions.
- Node/Python/Java package-manager choices among maintained options.
- React UI framework details that do not change the application contract.
- Mobile dependency manager choice for iOS if more than one is viable.
- Specific open-source policy engine, provided repository-owned policy remains
  portable and testable.

These choices require short ADRs only when they materially affect architecture,
security, portability or operations.

