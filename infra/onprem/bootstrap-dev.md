# secops-dev bootstrap runbook

This runbook brings up the first provider-owned Kubernetes cluster. It deliberately stops before application deployment. All IPs/domains below are documentation examples from `inventory.example.json` and must be replaced with approved datacenter allocations.

## 0. Preconditions

Required hosts:

- `secops-dev-lb01` and `secops-dev-lb02`: external HAProxy/Keepalived nodes on different physical failure domains.
- `secops-dev-cp01..03`: three RKE2 server/control-plane nodes on different physical failure domains.
- `secops-dev-w01..03`: at least three workers.

Required datacenter services:

- internal DNS and NTP;
- internal PKI/CA distribution;
- Vault or equivalent secret-management system;
- internal S3-compatible endpoint for etcd snapshots;
- an approved path to fetch/mirror RKE2 and Cilium artifacts;
- bastion/admin network allowed to reach the API VIP on TCP/6443.

Before installation, verify there is no CIDR overlap among node, Pod, Service, LoadBalancer, VPN, management, storage, DEV/HOMOL/PROD networks.

## 1. OS preparation on every Kubernetes node

Use a supported minimal Linux distribution with kernel >= 5.10. The exact OS release and package versions must be pinned by the datacenter build image rather than by this application repository.

Check unique hostname and time:

```bash
hostnamectl
getent hosts "$(hostname -f)" || true
timedatectl status
```

Ensure NetworkManager does not manage CNI interfaces when NetworkManager is installed. Apply the company's CIS/OS baseline, disable interactive root SSH, use SSH keys/MFA through the bastion, and send system/auth logs to the central SIEM.

Validate required reachability from a node before installation:

```bash
nc -vz 10.20.0.10 9345
nc -vz 10.20.0.10 6443 || true   # expected to fail until the first server is up
```

## 2. Control-plane load balancers

Install the corporate-pinned HAProxy and Keepalived packages on both LB nodes. Copy the templates under `infra/onprem/loadbalancer/` and replace interface name, VRRP password, IPs and DNS with values from the approved inventory.

The same VIP serves both:

- `10.20.0.10:9345` -> RKE2 supervisor on cp01/cp02/cp03;
- `10.20.0.10:6443` -> Kubernetes API on cp01/cp02/cp03.

Start HAProxy, then Keepalived. Confirm exactly one owner of the VIP:

```bash
ip addr show
systemctl status haproxy --no-pager
systemctl status keepalived --no-pager
```

Failure test before Kubernetes exists:

1. record the active LB node;
2. stop Keepalived on it;
3. verify the VIP appears on the peer;
4. start the original service;
5. repeat by stopping HAProxy and verify the tracking script reduces priority/fails over;
6. preserve only operational metadata, not credentials, as test evidence.

Do not proceed until VIP failover is deterministic.

## 3. Install the first RKE2 server

The cluster version is pinned in `platform-versions.json` to `v1.36.4+rke2r1`.

On `secops-dev-cp01` create the configuration directory and install the security files before starting RKE2:

```bash
sudo install -d -m 0700 /etc/rancher/rke2
sudo install -m 0600 server-bootstrap.yaml.example /etc/rancher/rke2/config.yaml
sudo install -m 0600 audit-policy.yaml /etc/rancher/rke2/audit-policy.yaml
sudo install -m 0600 pod-security-admission.yaml /etc/rancher/rke2/pod-security-admission.yaml
```

Replace only documented placeholders. Obtain the RKE2 join token from Vault at provisioning time; never place the real token in Git, shell history, tickets or CI logs.

For DEV, the official installation wrapper may be downloaded separately and run with an exact RKE2 version:

```bash
curl -fsSLo /tmp/install-rke2.sh https://get.rke2.io
chmod 0700 /tmp/install-rke2.sh
sudo env INSTALL_RKE2_VERSION='v1.36.4+rke2r1' /tmp/install-rke2.sh
sudo systemctl enable --now rke2-server
```

Before HOMOL/PROD, mirror the installer and RKE2 release artifacts into an internally controlled repository and verify their checksums/signatures according to the supply-chain runbook; production bootstrap must not depend on a live `curl | sh` path.

Inspect without printing secret material:

```bash
sudo systemctl status rke2-server --no-pager
sudo journalctl -u rke2-server --since '-10 min' --no-pager
sudo ss -lntp | grep -E ':(6443|9345|2379|2380)\b'
```

RKE2 is intentionally configured with `cni: none` and `disable-kube-proxy: true`, so nodes may remain `NotReady` until Cilium is installed.

## 4. Configure kubectl on the administration workstation

On cp01, RKE2 writes an admin kubeconfig to `/etc/rancher/rke2/rke2.yaml`. Copy it only through the approved admin channel, restrict it to the operator account, and change the server address to the API VIP/DNS rather than a single control-plane node.

Validate:

```bash
kubectl cluster-info
kubectl get --raw='/readyz?verbose'
kubectl get nodes -o wide
```

The kubeconfig is an administrative credential. Do not commit it and do not put it into GitHub Actions secrets.

## 5. Join cp02 and cp03

On each additional server copy `server-join.yaml.example`, the same audit policy and the same Pod Security Admission file. Replace the token from Vault and start the exact same RKE2 version:

```bash
sudo env INSTALL_RKE2_VERSION='v1.36.4+rke2r1' /tmp/install-rke2.sh
sudo systemctl enable --now rke2-server
```

After each join:

```bash
kubectl get nodes -o wide
sudo /var/lib/rancher/rke2/bin/rke2 etcd-snapshot ls || true
```

Do not add a fourth control-plane node merely for HA. Three gives an odd etcd membership and tolerates one failed server while maintaining quorum.

## 6. Join workers

On each worker install RKE2 as an agent with the exact version:

```bash
sudo install -d -m 0700 /etc/rancher/rke2
sudo install -m 0600 agent.yaml.example /etc/rancher/rke2/config.yaml
sudo env INSTALL_RKE2_VERSION='v1.36.4+rke2r1' INSTALL_RKE2_TYPE='agent' /tmp/install-rke2.sh
sudo systemctl enable --now rke2-agent
```

Set topology/failure-domain labels per individual host from the datacenter inventory; do not copy the same rack/hypervisor label to every node.

## 7. Install Cilium 1.20.2

Cilium uses Kubernetes IPAM, full kube-proxy replacement and VXLAN tunnelling. The localhost API endpoint is intentional on RKE2: server nodes reach their local kube-apiserver and workers reach the RKE2 client-side API proxy on localhost.

Use an internally mirrored Helm chart for HOMOL/PROD. For DEV, after verifying the chart source:

```bash
helm repo add cilium https://helm.cilium.io/
helm repo update
helm show chart cilium/cilium --version 1.20.2
helm install cilium cilium/cilium \
  --version 1.20.2 \
  --namespace kube-system \
  --values infra/onprem/cilium/values.yaml
```

Wait for the datapath:

```bash
cilium status --wait
kubectl get nodes -o wide
kubectl -n kube-system get pods -o wide
```

All expected nodes should transition to `Ready`.

## 8. Network validation

VXLAN requires UDP/8472 between Cilium nodes. Hubble Relay needs TCP/4244 to the Hubble server on each node. Cilium health uses TCP/4240 and optionally ICMP.

Run the upstream Cilium connectivity suite in its own namespace:

```bash
cilium connectivity test
```

Do not mix the connectivity-test namespace with application default-deny policies.

Validate kube-proxy replacement:

```bash
cilium status
kubectl -n kube-system get ds kube-proxy
```

`kube-proxy` should not be running in this cluster design.

## 9. LoadBalancer IPAM

Do not apply the example pool until the network team confirms the subnet/range is reserved exclusively for Kubernetes service VIPs.

Once approved:

```bash
kubectl apply -f infra/onprem/cilium/loadbalancer-pool.example.yaml
kubectl get ciliumloadbalancerippools
```

Because `defaultLBServiceIPAM: none`, a Service must opt into a Cilium load-balancer class and match the pool selector before it can receive an address. This prevents an arbitrary `type: LoadBalancer` object from silently consuming the corporate VIP pool.

BGP advertisement remains disabled at this stage. First prove local allocation, policy and service health; then add BGP in a separately reviewed change with router ASN, peer, route maps/filters, ECMP capacity and rollback procedure.

## 10. Pod Security and namespaces

The cluster-wide admission baseline enforces `baseline` by default while auditing/warning at `restricted`. Application namespaces must raise enforcement to Restricted explicitly:

```bash
kubectl create namespace app-dev
kubectl label namespace app-dev \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/audit-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/warn-version=latest \
  --overwrite
```

Platform namespaces are reviewed individually; do not globally exempt arbitrary controllers.

## 11. Network-policy default deny

Application namespaces begin with default-deny ingress and egress. Add explicit DNS, telemetry, database/queue and approved external-service egress afterward. Test the denied path as well as every allowed path.

## 12. Audit verification

Verify that the API server uses the custom policy and that Kubernetes Secret bodies do not appear in audit output:

```bash
sudo grep -E -- '--audit-policy-file|--admission-control-config-file' /proc/$(pgrep -f 'kube-apiserver' | head -1)/cmdline | tr '\0' '\n' || true
sudo test -s /var/lib/rancher/rke2/server/logs/audit.log
```

Generate a disposable Secret and confirm audit records contain metadata/identity but not the Secret value. Destroy the disposable Secret afterward.

## 13. Secrets encryption verification

Check the configured provider without printing Kubernetes Secret contents:

```bash
sudo /var/lib/rancher/rke2/bin/rke2 secrets-encrypt status
```

Record provider/state only. Key rotation is a separate controlled operation and must be tested in DEV first.

## 14. etcd snapshots

The server templates schedule compressed snapshots every six hours with local retention 28. Configure internal S3-compatible replication only after the bucket, CA, retention and credentials are provisioned.

Prefer RKE2's S3 configuration Secret during normal operation rather than static S3 credentials in `/etc/rancher/rke2/config.yaml`. The restore runbook must separately provide recovery credentials because the Kubernetes API is unavailable during restore.

Manual smoke test:

```bash
sudo /var/lib/rancher/rke2/bin/rke2 etcd-snapshot save --name pre-platform-smoke
sudo /var/lib/rancher/rke2/bin/rke2 etcd-snapshot ls
```

A snapshot is not accepted as a backup until a disposable-cluster restore drill succeeds. The server join token must be backed up through the secret-management/DR process separately from the snapshot.

## 15. HA acceptance tests

Run one failure at a time and restore healthy state before continuing:

1. stop HAProxy/Keepalived on active LB -> VIP fails over; API stays reachable;
2. power off cp01 -> API remains available and etcd retains quorum;
3. restore cp01 and wait for healthy membership;
4. power off one worker -> stateless test workload reschedules;
5. block VXLAN/8472 on one test node -> connectivity test detects degradation and alerting fires;
6. restore networking and verify Cilium recovery;
7. stop access to GitHub -> running workloads remain healthy;
8. later, after Harbor exists, stop Internet egress -> a pod using a mirrored image can be rescheduled from the internal registry.

Do not combine chaos cases during the initial acceptance run.

## 16. Go/no-go

The cluster is ready for the next platform layer only after:

```text
VIP failover                 PASS
3-member etcd quorum         PASS
all nodes Ready              PASS
Cilium connectivity          PASS
kube-proxy absent            PASS
Pod Security test            PASS
default-deny test            PASS
API audit test               PASS
secrets encryption status    PASS
etcd snapshot                PASS
restore drill                PASS
central logging/alerting     PASS
```

Only then install cert-manager, Vault/External Secrets integration, Kyverno, Argo CD/Rollouts, Harbor integration and the observability stack. The first deployed workload must be a signed non-production fixture, not the real application.
