# Deployment gate policy

This policy is deliberately machine-readable. CVSS alone is not a deployment decision. A finding may combine severity with CISA KEV status, EPSS, reachability, runtime exposure, asset criticality, and VEX evidence.

Hard supply-chain failures fail closed. Risk-based findings can be reviewed, but exceptions are time-bounded and must identify an owner, evidence, and a compensating control. Expired exceptions reactivate the original gate automatically.

The initial `high` threshold (`EPSS >= 0.5` when reachable) is a bootstrap default, not a universal risk constant. It must be calibrated against service exposure, asset criticality, historical incident data, and false-positive rates before becoming an organization-wide production policy.
