# Secure Coding Standard

## General rules

### Input and output

- Parse at the boundary into typed commands.
- Validate syntax, semantics, length, cardinality and authorization context.
- Prefer allowlists for identifiers, protocols, destinations and file types.
- Encode output for its exact HTML, JavaScript, URL, CSS, SQL or log context.
- Do not reuse a sanitizer across incompatible contexts.

### Identity and access

- Use platform/framework security libraries.
- Authenticate the caller and authorize every protected operation.
- Enforce tenant, role, action and object checks server-side.
- Rotate session identifiers at authentication and privilege change.
- Invalidate sessions/tokens on logout and security events.
- Never place authorization decisions only in the client.

### Data and cryptography

- Classify and minimize data before storing it.
- Use platform CSPRNG and vetted authenticated encryption where required.
- Store keys in platform secret stores/Keystore/Keychain, not source or config
  committed to the repository.
- Do not invent algorithms or protocols.
- Define rotation, revocation and failure behavior.

### Files, URLs and processes

- Never concatenate request data into shell commands.
- Prefer direct library APIs and fixed typed arguments.
- Canonicalize paths and verify containment after resolution.
- Generate server-side file names and store uploads outside executable roots.
- URL fetches use registered schemes/hosts, DNS pinning and denied-by-default
  egress.

### Errors and logging

- Return stable generic external errors and correlation IDs.
- Log structured internal diagnostics without tokens, passwords or sensitive
  bodies.
- Security-relevant denials and state changes generate audit/security events.
- Exceptional conditions fail closed for authorization and integrity controls.

### Dependencies and builds

- Use exact versions and lockfiles.
- Verify dependency integrity and licenses.
- Build from reviewed source with reproducible steps.
- Generate SBOM and provenance.
- Remove debug endpoints, source maps and verbose logs from secure releases
  unless explicitly justified.

## TypeScript rules

- Enable strict compiler options and no unchecked indexed access where feasible.
- Avoid `any` at trust boundaries.
- Do not use `eval`, dynamic code generation or request-derived module loading.
- Treat DOM sinks such as raw HTML insertion as security-critical wrappers.
- Parameterize database access.
- Do not pass request values to `child_process` shells.
- Use schema validation for external JSON.

## Python rules

- Avoid `shell=True` and build typed argument lists.
- Do not deserialize untrusted `pickle` or unsafe YAML.
- Validate URLs, archives and paths before access.
- Use parameterized queries and explicit Pydantic/dataclass boundaries.
- Keep debug servers and interactive tracebacks disabled outside local tests.
- Pin dependencies with hashes.

## Java/Kotlin rules

- Use request/command DTO allowlists; do not bind persistence entities directly.
- Parameterize queries and avoid dynamic expression evaluation.
- Do not deserialize untrusted native Java object streams.
- Avoid request-derived `Runtime.exec` or process invocation.
- Centralize Spring Security configuration and test method/object authorization.
- Use current TLS and cryptographic platform APIs.
- Treat reflection and dynamic class loading as privileged functionality.

## Swift/iOS rules

- Store appropriate secrets in Keychain with a documented accessibility class.
- Minimize entitlements, URL schemes and inter-process data exposure.
- Use App Transport Security without broad exceptions.
- Validate deep-link and WebView inputs and origins.
- Avoid sensitive logging, pasteboard persistence and background snapshots.

## Review rule

Any exception to these rules requires a code comment referencing an approved,
expiring risk acceptance or an accepted ADR. Suppression without rationale is a
pipeline failure.

