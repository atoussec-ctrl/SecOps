# security/rules

Tested Semgrep, CodeQL and policy rules. Reserved by backlog task E0-001;
custom rule packs are authored at E5-002.

## Specification

- `docs/05-devsecops/04-static-supply-chain.md`
- `docs/05-devsecops/03-security-gates.md`

## Boundary rules

- Every rule ships with positive, negative and near-miss fixtures. An untested
  rule is not a gate.
- Rules are versioned with the repository so a gate decision can be traced to
  the exact rule revision that produced it.
- Suppressions are exact and expiring, and are justified by an approved risk
  acceptance or ADR. Unexplained suppression fails the pipeline
  (`docs/04-security/03-secure-coding-standard.md`).
- Safety gates must resolve from a protected source outside untrusted pull
  request control.
