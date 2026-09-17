// Deterministic release-gate evaluation for one immutable OCI artifact.
//
// Tool-specific output is normalized into release-gate-input.schema.json before
// reaching this module. This evaluator consumes only bounded facts and the
// machine-readable gate policy; it never parses scanner log text.

const HARD_GATE_SIGNAL = Object.freeze({
  malware_detected: (signals) => signals.malware_detected === true,
  secret_detected: (signals) => signals.secret_detected === true,
  invalid_signature: (signals) => signals.signature_valid !== true,
  invalid_provenance: (signals) => signals.provenance_valid !== true,
  missing_sbom: (signals) => signals.sbom_present !== true,
  cisa_kev_affected: (signals) => signals.cisa_kev_affected > 0,
  critical_reachable: (signals) => signals.critical_reachable > 0,
  unsigned_image: (signals) => signals.unsigned_image === true,
});

function assertPolicy(policy) {
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    throw new TypeError("release policy must be an object");
  }
  if (typeof policy.schema_version !== "string") {
    throw new TypeError("release policy requires schema_version");
  }
  if (policy.hard_gates === null || typeof policy.hard_gates !== "object") {
    throw new TypeError("release policy requires hard_gates");
  }
}

function hardGateReasons(signals, policy) {
  const reasons = [];

  for (const [gate, decision] of Object.entries(policy.hard_gates)) {
    if (decision !== "block") {
      continue;
    }

    const predicate = HARD_GATE_SIGNAL[gate];
    if (predicate === undefined) {
      throw new Error(`unsupported hard gate: ${gate}`);
    }

    if (predicate(signals)) {
      reasons.push(gate);
    }
  }

  return reasons;
}

function riskGateReasons(signals, policy) {
  const reasons = [];
  const high = policy.risk_gates?.high;

  if (
    high?.decision === "block" &&
    high.reachable === true &&
    signals.high_reachable_count > 0 &&
    signals.high_reachable_max_epss >= high.minimum_epss
  ) {
    reasons.push("high_reachable_epss");
  }

  return reasons;
}

export function evaluateReleaseEvidence(input, policy) {
  assertPolicy(policy);

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("release evidence must be an object");
  }

  const signals = input.signals;
  if (signals === null || typeof signals !== "object" || Array.isArray(signals)) {
    throw new TypeError("release evidence requires normalized signals");
  }

  const reasons = [
    ...hardGateReasons(signals, policy),
    ...riskGateReasons(signals, policy),
  ].sort();

  return {
    receipt_version: "1.0.0",
    artifact: structuredClone(input.artifact),
    source: structuredClone(input.source),
    evidence: {
      sbom_digest: input.evidence.sbom_digest,
      vulnerability_scan_digest: input.evidence.vulnerability_scan_digest,
      malware_scan_digest: input.evidence.malware_scan_digest,
      signature_verified: signals.signature_valid === true,
      provenance_verified: signals.provenance_valid === true,
    },
    policy_version: policy.schema_version,
    decision: reasons.length === 0 ? "promote" : "block",
    reasons,
  };
}
