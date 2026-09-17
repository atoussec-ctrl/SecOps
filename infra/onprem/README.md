# On-premises Kubernetes platform

This directory defines the provider-owned datacenter baseline for SecOps. GitHub remains the source-control and CI system; Kubernetes, registry, secrets, networking, observability, and runtime controls stay inside the company datacenter.

## Trust boundary

GitHub must not require inbound access to the Kubernetes API, SSH, etcd, or private node networks. Cluster-side components initiate outbound HTTPS connections when they need Git or public metadata. Production deployment is GitOps pull-based.

The intended path is:

```text
GitHub PR/CI
  -> signed immutable artifact
  -> internal registry
  -> GitOps desired state
  -> Argo CD pull
  -> admission policy
  -> progressive rollout
```

No GitHub secret may contain a production kubeconfig or long-lived cluster-admin credential.

## Cluster layout

The target topology uses separate Kubernetes failure domains:

- `secops-mgmt`: shared management services such as Harbor/Vault/object storage if the datacenter team chooses to host them on Kubernetes.
- `secops-dev`: integration and development validation.
- `secops-homol`: production-like acceptance, load, migration and rollback tests.
- `secops-prod`: production workloads only.

A minimal HA application cluster has two external load-balancer nodes, three RKE2 server/control-plane nodes, and at least three workers. Control-plane VMs must be anti-affined across physical hypervisors.

## Control-plane endpoint

The baseline is an external pair of HAProxy + Keepalived nodes. They expose one stable VIP and proxy:

- TCP/6443 -> Kubernetes API on all server nodes.
- TCP/9345 -> RKE2 supervisor/registration service on all server nodes.

kube-vip is intentionally not the baseline. Keeping the control-plane VIP outside Kubernetes removes a bootstrap dependency on the API and makes cold-start recovery independent from cluster scheduling.

## Kubernetes/CNI compatibility

`platform-versions.json` pins RKE2 `v1.36.4+rke2r1` and upstream Cilium `1.20.2`. RKE2 1.37.0 is newer, but Cilium 1.20.2 guarantees e2e compatibility only through Kubernetes 1.36. Upgrade to 1.37 only after the selected Cilium release includes 1.37 in its guaranteed matrix and the upgrade has passed DEV/HOMOL soak tests.

RKE2 is configured with `cni: none` and `disable-kube-proxy: true`; Cilium is installed from the upstream chart with kube-proxy replacement. Nodes being `NotReady` before Cilium is installed is expected.

## Networking

Every environment must use non-overlapping node, Pod, Service, management, storage and LoadBalancer ranges. `inventory.example.json` contains documentation-only RFC1918 examples; they are not production allocations.

Cilium provides:

- pod networking;
- kube-proxy replacement;
- Kubernetes and Cilium network policy;
- Hubble observability;
- LoadBalancer IPAM;
- optional BGP service advertisement.

BGP is disabled in the example until the network team supplies approved ASN/peer data and validates route policy, ECMP limits, authentication, filters and rollback. Until then, service exposure remains a separate network-team-controlled operation.

## Security baseline

RKE2 servers use the generic `cis` profile, secrets encryption at rest, a custom API audit policy and a Pod Security Admission configuration. Application namespaces are expected to enforce the Restricted Pod Security Standard through namespace labels and Kyverno.

The cluster join token and snapshot credentials are secrets. They must come from Vault or an equivalent internal secret-management system and must never be committed.

## Backup/DR

Embedded etcd is the RKE2 HA datastore. Scheduled compressed snapshots must be copied to an internal S3-compatible object store with access control, retention and server-side encryption. The server join token must be backed up separately because it participates in protecting sensitive snapshot material.

A backup is not accepted until a restore drill has rebuilt a disposable cluster and verified API state, admission policy, GitOps reconciliation and application recovery.

## Bootstrap order

1. Reserve IPs, DNS, NTP and VLAN/firewall policy.
2. Provision two load-balancer nodes, three control-plane nodes and three workers on distinct physical failure domains.
3. Apply OS hardening and time synchronization.
4. Configure HAProxy + Keepalived and prove VIP failover before RKE2.
5. Install the pinned RKE2 version on the first server using the bootstrap configuration.
6. Join the remaining servers through the VIP on TCP/9345.
7. Join workers through the same VIP.
8. Install Cilium 1.20.2 before expecting nodes to become Ready.
9. Run Cilium connectivity tests and network-policy negative tests.
10. Configure etcd snapshot replication and perform a restore drill.
11. Install cert-manager, Kyverno, External Secrets/Vault integration, Argo CD/Rollouts and observability.
12. Deploy only a signed fixture first; production applications come later.

## Go/no-go gates

Do not promote this design to HOMOL/PROD until DEV proves all of the following:

- loss of either load-balancer VM keeps API registration available;
- loss of one control-plane node keeps etcd quorum and API availability;
- loss of one worker reschedules stateless workloads;
- Cilium connectivity tests pass;
- default-deny network policy blocks unapproved traffic;
- unsigned/untrusted images are denied;
- etcd snapshot save, off-node copy and restore work;
- GitHub outage does not stop running workloads;
- public Internet outage does not prevent restart of already mirrored production images;
- operational logs and alerts reach the company observability/SIEM systems.

The templates in this directory are deliberately examples. Replace addresses, interface names, DNS suffixes, storage endpoints and network peer information only after infrastructure review.
