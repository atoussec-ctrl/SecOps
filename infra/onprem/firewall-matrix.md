# On-prem cluster firewall matrix

This matrix is a least-privilege starting point. Replace example CIDRs with approved datacenter objects and implement rules through the corporate firewall/IaC system. No Kubernetes node-management port is Internet-facing.

| Source | Destination | Protocol/port | Purpose | Required state |
| --- | --- | --- | --- | --- |
| admin/bastion CIDRs | API VIP | TCP/6443 | Kubernetes API administration | allow, restricted |
| all RKE2 nodes | API VIP | TCP/9345 | RKE2 supervisor/node registration | allow |
| all RKE2 nodes | server nodes | TCP/6443 | Kubernetes API | allow |
| server nodes | server nodes | TCP/2379 | etcd client | allow |
| server nodes | server nodes | TCP/2380 | etcd peer | allow |
| server nodes | server nodes | TCP/2381 | etcd metrics | allow only where monitoring requires it |
| RKE2 nodes | RKE2 nodes | TCP/10250 | kubelet/metrics | allow |
| Cilium nodes | Cilium nodes | UDP/8472 | VXLAN datapath | allow; never Internet |
| Cilium nodes | Cilium nodes | TCP/4240 | cilium-health | allow |
| Cilium nodes | Cilium nodes | ICMP echo request/reply | cilium-health | allow where policy permits |
| Hubble Relay | Cilium nodes | TCP/4244 | Hubble server gRPC/mTLS | allow |
| nodes | internal DNS | TCP+UDP/53 | DNS | allow |
| nodes | internal NTP | UDP/123 | time synchronization | allow |
| nodes | internal Harbor | TCP/443 | OCI image pull | allow |
| approved release runners | internal Harbor | TCP/443 | OCI image push | allow |
| nodes/controllers | Vault/secret service | TCP/8200 or corporate HTTPS endpoint | workload identity/secrets | allow only from approved identities/networks |
| control-plane nodes | internal S3-compatible backup endpoint | TCP/443 | etcd snapshot copy/restore | allow |
| Cilium nodes | BGP routers | TCP/179 | service VIP advertisement | **disabled until BGP design is approved** |

## Explicit deny expectations

- Internet -> 2379/2380/2381/4240/4244/6443/8472/9345/10250: deny.
- user LAN -> node SSH: deny except approved bastions/admin networks.
- DEV -> PROD node-management networks: deny by default.
- HOMOL -> PROD node-management networks: deny by default.
- application pods -> node-management CIDRs: deny unless a documented platform dependency requires it.
- NodePort 30000-32767: deny at perimeter; avoid relying on NodePort for north-south exposure.

## Operational validation

For every permitted flow, test both positive and negative cases. A firewall rule is accepted only when the intended peer succeeds and an unapproved peer fails. Store evidence with source, destination, timestamp, rule/change identifier and owner; do not store credentials or packet payload secrets.
