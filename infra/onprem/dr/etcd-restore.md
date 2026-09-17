# RKE2 embedded-etcd disaster recovery

This is an operator runbook, not an automated CI action. Execute it only under an approved incident/change record with two-person review. The first proof must be against a disposable DEV recovery cluster.

## Security model

An RKE2 etcd snapshot contains cluster state, CA material and private keys. With secrets encryption enabled, sensitive resources remain protected by the RKE2 bootstrap encryption chain; possession of both a snapshot and the server join token is highly sensitive. Store snapshots and the backed-up server token under separate access paths where possible.

Never attach snapshots or the server token to tickets, chat, GitHub issues or CI artifacts.

## Required recovery material

Before declaring backups healthy, prove the DR team can obtain through approved custody:

- an accepted etcd snapshot name/file;
- the exact RKE2 server token associated with that cluster lineage;
- the pinned RKE2 version or an explicitly compatible higher minor version;
- internal RKE2 images/artifacts if operating without Internet;
- S3 endpoint/CA/recovery credentials when the snapshot is remote;
- node/IP/DNS/VIP inventory;
- RKE2 server configuration, audit policy and Pod Security Admission configuration from Git;
- Cilium configuration from Git;
- GitOps desired state and signing/admission trust configuration.

## Preconditions

1. Declare the incident/test and freeze normal cluster changes.
2. Record the last known-good Git revision and application digests.
3. Confirm the selected snapshot source, timestamp, expected cluster and chain of custody.
4. Confirm the server token without printing it into shell logs.
5. Confirm load-balancer/VIP ownership and DNS are stable.
6. Confirm at least one server has enough local disk to restore the datastore.
7. For a real incident, preserve the failed datastore/evidence before destructive recovery actions when incident-response policy requires it.

## Multi-server restore

Assume `cp01` is the recovery seed and `cp02/cp03` are peers.

### 1. Stop all RKE2 server services

On **every control-plane/server node**:

```bash
sudo systemctl stop rke2-server
```

Verify they are stopped before continuing.

### 2. Restore the snapshot on cp01

For a local snapshot:

```bash
sudo /var/lib/rancher/rke2/bin/rke2 server \
  --cluster-reset \
  --cluster-reset-restore-path=/ABSOLUTE/PATH/TO/SNAPSHOT
```

If the node's normal config enables S3 but the chosen recovery artifact is local, explicitly disable S3 for this restore invocation as documented by RKE2:

```bash
sudo /var/lib/rancher/rke2/bin/rke2 server \
  --cluster-reset \
  --etcd-s3=false \
  --cluster-reset-restore-path=/ABSOLUTE/PATH/TO/SNAPSHOT
```

For an S3-hosted snapshot, use the snapshot filename plus the approved S3 recovery configuration. The normal Kubernetes S3-config Secret is unavailable during this phase because the API server is not available; recovery credentials must come from the external DR secret process.

Do not proceed unless RKE2 reports that managed-etcd membership has been reset and the server is ready to restart normally.

### 3. Start cp01 normally

```bash
sudo systemctl start rke2-server
sudo systemctl status rke2-server --no-pager
```

Validate the API locally before rejoining peers.

### 4. Reset peer datastore directories

**Destructive step — cp02/cp03 only after cp01 restore is confirmed.** Preserve evidence first if required.

On each peer server:

```bash
sudo test ! -e /run/rke2-dr-do-not-delete || exit 1
sudo rm -rf /var/lib/rancher/rke2/server/db/
```

The sentinel example above is intentionally conservative; the change procedure should define its own operator guard. Never run datastore deletion across all servers in parallel.

### 5. Rejoin peers

On cp02, then cp03, one at a time:

```bash
sudo systemctl start rke2-server
sudo systemctl status rke2-server --no-pager
```

After each peer rejoins, check API health and etcd/member health before adding the next.

### 6. Recover agents/workers

Workers normally reconnect after the control plane returns. Investigate individually rather than deleting worker state in bulk.

```bash
kubectl get nodes -o wide
kubectl get pods -A -o wide
```

Wait for Cilium and critical system controllers to be healthy before restoring application traffic.

## Post-restore validation

At minimum:

```text
API /readyz                         PASS
3 server nodes present             PASS
etcd quorum healthy                PASS
Cilium status                      PASS
CoreDNS                            PASS
Pod Security Admission             PASS
Kyverno/admission trust            PASS when installed
Argo CD reconciliation             PASS when installed
expected namespaces                PASS
expected application digest        PASS
unexpected privileged workloads    NONE
```

Then validate:

- API audit logging is active;
- secrets-encryption status is healthy;
- default-deny policies are present;
- service VIPs/routes match the approved inventory;
- Harbor/Vault/storage dependencies are reachable;
- monitoring/logging resumes;
- no obsolete canary or revoked artifact has become desired state.

## GitOps reconciliation rule

A datastore restore may restore an older Kubernetes object set. Git remains the desired-state authority. Once the control plane/admission stack is trustworthy, allow Argo CD to reconcile from the reviewed Git revision. Do not manually recreate application resources that GitOps owns unless the incident commander explicitly invokes break-glass recovery.

## Acceptance drill

Quarterly or at the cadence defined by the operations SLO:

1. create a named snapshot;
2. copy it to the DR object store;
3. provision an isolated recovery environment with no production traffic;
4. restore using the real recovery procedure and separately custodied token;
5. rejoin two server peers;
6. validate Cilium and policies;
7. reconcile GitOps;
8. run application smoke tests against signed fixtures;
9. record RTO/RPO measurements and all deviations;
10. destroy the disposable recovery environment securely.

A snapshot job succeeding is not a backup SLO. The backup SLO is met only when restore evidence stays within the agreed RPO/RTO and all trust controls recover correctly.
