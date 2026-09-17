# Linux host baseline for RKE2/Cilium

This document defines operating-system invariants for Kubernetes nodes. The datacenter team may implement them through image templates, Ansible, Puppet, Salt, Packer or another approved configuration-management system. This repository does not contain administrator passwords, SSH private keys or host enrollment secrets.

## Supported-image principle

Choose one corporate Linux image for an environment and keep control-plane and worker nodes on the same OS family/minor wherever practical. The selected image must be supported by the pinned RKE2 release and provide:

- systemd;
- cgroup v2;
- kernel >= 5.10 for the selected Cilium baseline;
- required eBPF/kernel networking features;
- a supported container SELinux/AppArmor setup;
- centrally managed package repositories and security updates.

Do not use desktop/server images with unrelated GUI packages, developer toolchains or interactive applications.

## Identity and remote administration

- Administrators reach nodes only through approved bastion/VPN management paths.
- Disable direct Internet SSH exposure.
- Disable SSH password authentication after emergency-access design is tested.
- Disable direct root SSH login; use named privileged identities and audited elevation.
- Require MFA at the upstream VPN/bastion/identity provider.
- Centralize authorized-key/certificate lifecycle; do not copy permanent personal keys into machine images.
- Keep break-glass credentials outside normal operator credentials, protected and tested under the incident procedure.

## Host naming and failure domains

Every node has a unique, stable hostname. Record physical placement separately:

```text
cluster
rack
hypervisor / physical host
power domain
network leaf / failure domain
```

Do not schedule all control-plane VMs or all workers on one hypervisor, rack, UPS or top-of-rack switch when the infrastructure allows separation.

## Time

All nodes use the same approved internal NTP sources. Monitoring alerts when synchronization is lost or clock offset exceeds the operations threshold. Correct time is required for TLS, OIDC, audit correlation, distributed tracing and incident forensics.

## Memory and cgroups

The first baseline uses cgroup v2 and no swap. Kubernetes can support intentionally configured Linux swap, but that is not enabled implicitly in this platform. If a future workload needs `LimitedSwap`, introduce it as a tested design change with kubelet configuration, observability and eviction/load testing.

## Mandatory access control

On RHEL/Rocky/Alma-family hosts where SELinux is the supported default:

- keep SELinux `Enforcing`;
- install the RKE2 SELinux policy module appropriate to the chosen installation method;
- enable RKE2 SELinux support explicitly when required by the installation method;
- treat any transition to Permissive/Disabled as a security incident or approved maintenance exception.

On Ubuntu-family hosts:

- keep AppArmor available/enabled when supported by the image;
- ensure `apparmor-parser` is installed before RKE2 when the kernel supports AppArmor;
- version custom profiles and exceptions through the infrastructure configuration system.

Do not disable a mandatory-access-control system merely to make a workload start; fix the workload/profile or document an approved exception.

## Network manager behavior

If NetworkManager is active, configure it not to interfere with CNI-created interfaces and routes. Validate after Cilium installation that routes, VXLAN interfaces and pod connectivity survive a NetworkManager restart and a host reboot.

The corporate host firewall may remain enabled if it is explicitly tested with RKE2 and Cilium. Do not blindly flush iptables/nftables/firewalld rules. The authoritative required flows are documented in `firewall-matrix.md`.

## Kernel/network controls

The datacenter image must support the Cilium eBPF datapath and VXLAN. Do not expose UDP/8472 outside the Kubernetes node networks. Node-to-node MTU must be measured before production; VXLAN adds encapsulation overhead, so an incorrect underlay MTU can create intermittent fragmentation/PMTU problems.

Record and test:

```text
underlay MTU
Cilium effective MTU
jumbo-frame policy, if any
ICMP/PMTU behavior
NIC offload settings
bond/VLAN configuration
```

Do not enable XDP/native acceleration until the NIC/driver path is tested in DEV and HOMOL.

## Filesystem and disks

- Use SSD/NVMe-quality storage for embedded etcd/control-plane state.
- Monitor latency, IOPS, disk fullness and filesystem errors, not only capacity.
- Separate or reserve sufficient capacity for `/var/lib/rancher/rke2` and container image/storage growth according to the server build standard.
- Do not put etcd data on unreliable shared filesystems.
- Encrypt physical/virtual disks according to the datacenter threat model and key-management standard.

## Logging and audit

Forward at least the following to central observability/SIEM:

- system journal relevant to RKE2 server/agent;
- authentication/sudo/SSH events;
- OS security/audit events;
- Kubernetes API audit logs;
- Cilium/Hubble security events;
- critical kernel/storage/network errors.

The central pipeline must redact credentials and secret payloads. Kubernetes Secret bodies are deliberately not recorded by the API audit policy in this repository.

## Package/update lifecycle

Nodes are cattle, not pets. Avoid untracked manual package installation. Security updates follow:

```text
image/package update
  -> DEV node replacement/rolling validation
  -> soak
  -> HOMOL
  -> soak/load/failure tests
  -> PROD maintenance window / rolling update
```

Kernel or container-runtime updates that require reboot must prove one-node-at-a-time HA behavior first. For control planes, never take enough etcd members down to lose quorum.

## Reboot acceptance

For every node class, a clean reboot must prove:

- time sync returns healthy;
- required mounts/storage return;
- RKE2 service starts automatically;
- Cilium becomes healthy;
- node returns `Ready`;
- network policies remain enforced;
- no unexpected route/firewall drift occurs;
- central logs/metrics resume.

## Read-only preflight

Run `infra/onprem/scripts/node-preflight.sh` before installing RKE2. It intentionally changes nothing. If the fixed registration endpoint already exists, add it to the check:

```bash
RKE2_REGISTRATION_ENDPOINT=10.20.0.10:9345 \
  bash infra/onprem/scripts/node-preflight.sh
```

A warning requires review; a failure blocks node admission until remediated through the normal datacenter configuration-management process.
