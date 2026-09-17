# Pipeline self-tests

These tests verify security properties of the delivery configuration itself. They are intentionally dependency-free in this first increment so every pull request can execute them without installing an unpinned package.

Current checks cover digest pinning, workload hardening, bounded rollback history, repeated canary evidence, Argo CD self-healing, restricted Argo project use, current Kyverno CEL APIs, fail-closed image verification, and fail-closed vulnerability/supply-chain gates.

This is a structural gate, not a substitute for Kubernetes schema validation. The next increment should pin Kustomize, Kyverno CLI, and Kubeconform (or equivalent) by reviewed versions/checksums and run mutation fixtures for mutable tags, invalid signatures/provenance, expired exceptions, unsafe security contexts, and canary regressions.
