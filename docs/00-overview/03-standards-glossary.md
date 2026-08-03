# Standards, Taxonomies and Glossary

## Canonical standards

| Reference | Use in this project | Canonical source |
| --- | --- | --- |
| OWASP Top 10:2025 | Awareness categories and portfolio coverage | <https://owasp.org/Top10/2025/> |
| OWASP ASVS 5.0 | Verifiable Web/application requirements | <https://owasp.org/www-project-application-security-verification-standard/> |
| OWASP WSTG | Web test procedures and identifiers | <https://owasp.org/www-project-web-security-testing-guide/stable/> |
| OWASP API Top 10:2023 | API risk scenarios | <https://owasp.org/www-project-api-security/> |
| OWASP MASVS | Mobile control groups | <https://mas.owasp.org/MASVS/> |
| OWASP MASTG | Mobile test techniques and tools | <https://mas.owasp.org/MASTG/> |
| OWASP MASWE | Mobile weakness taxonomy | <https://mas.owasp.org/MASWE/> |
| NIST SP 800-115 | Assessment planning, execution and reporting | <https://csrc.nist.gov/pubs/sp/800/115/final> |
| NIST SSDF 1.1 | Secure development practices | <https://csrc.nist.gov/pubs/sp/800/218/final> |
| CWE | Root-cause weakness identifiers | <https://cwe.mitre.org/> |
| CVSS v4.0 | Technical severity characteristics | <https://www.first.org/cvss/v4.0/specification-document> |
| EPSS | Public exploitation probability signal | <https://www.first.org/epss/> |
| CISA KEV | Evidence of known exploitation | <https://www.cisa.gov/known-exploited-vulnerabilities-catalog> |
| SARIF | Static-analysis result interchange | <https://docs.oasis-open.org/sarif/sarif/v2.1.0/> |
| CycloneDX | SBOM and related supply-chain data | <https://cyclonedx.org/> |
| SLSA | Build integrity and provenance model | <https://slsa.dev/> |
| PenTest+ PT0-003 | Certification-domain coverage | <https://assets.ctfassets.net/82ripq7fjls2/WwSjgXdEMdpoQEYJX3j9C/8f9487dde95a10b50f59c3923011110c/CompTIA_Pentest__PT0-003_exam_objectives.pdf> |

## Versioning policy

- Store the exact version or retrieval date for every imported checklist.
- Do not silently remap identifiers when a standard changes.
- Preserve the original mapping and add a migration mapping.
- Pin tool container images by digest in release workflows.
- Generate a version manifest for each capstone run.
- Treat draft standards as informative unless an ADR explicitly adopts them.

## Required mapping fields

Every confirmed finding contains, when applicable:

- one primary CWE;
- zero or more secondary CWEs;
- OWASP Top 10 category;
- WSTG test identifier or API category;
- ASVS requirement identifiers;
- MASVS/MASWE/MASTG identifiers for Mobile;
- CVSS v4 vector and score;
- EPSS and KEV data only when a CVE exists;
- internal asset criticality and business impact.

## Glossary

| Term | Definition in this project |
| --- | --- |
| Active test | A request that intentionally changes behavior or supplies attack-like input |
| Asset | A scoped application, API, device, service, repository or artifact |
| Canary data | Synthetic marker data used to prove impact without exposing real data |
| Confirmed finding | Reproducible weakness with evidence and defined impact |
| DAST | Testing a running application from its externally visible behavior |
| Evidence | Redacted, hashed artifact that supports a finding or retest |
| Finding fingerprint | Stable identity derived from rule, asset and normalized location |
| Lab target | An owned, isolated application or system in the signed scope |
| Passive test | Observation that does not inject an attack payload or mutate state |
| Retest | Verification performed against the intended fix and original conditions |
| SAST | Analysis of source or compiled code without exercising the deployed behavior |
| SCA | Identification and evaluation of third-party software components |
| Scope | Explicit targets, techniques, time window, budgets and exclusions |
| Security scenario | Vulnerable behavior, secure behavior and associated learning materials |
| Tool adapter | Guarded integration that validates scope before invoking a security tool |

## Severity is not risk

CVSS describes technical characteristics. EPSS supplies a population-level
likelihood signal for CVEs. KEV supplies evidence of exploitation. Actual
priority also depends on reachability, asset value, data sensitivity, existing
controls, confidence and business impact. The Finding Hub must preserve these
signals separately and show the decision rationale.

