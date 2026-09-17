# Cilium BGP service-VIP design gate

BGP is **not enabled for routing in the DEV inventory yet**. Cilium's BGP controller is installed so the feature can be evaluated without reinstalling the datapath, but no `CiliumBGPClusterConfig`, `CiliumBGPPeerConfig` or `CiliumBGPAdvertisement` is applied until the network team approves this document with real values.

## Scope

The first BGP implementation will advertise only `LoadBalancerIP` service VIPs allocated from approved Cilium LB-IPAM pools. It will not advertise PodCIDRs, node-management networks, the RKE2 API VIP, default routes, or internal service ClusterIPs.

Services must opt in by:

1. using `spec.loadBalancerClass: io.cilium/bgp-control-plane`;
2. carrying the LB-IPAM pool selector label (for example `lb.secops.io/pool: dev-services`);
3. carrying a separate advertisement selector label (for example `bgp.secops.io/advertise: "true"`).

The advertisement policy selects only those services and only `LoadBalancerIP` addresses. Cilium advertises service VIPs as exact host routes (`/32` for IPv4, `/128` for IPv6).

## Required network-team inputs

Before creating any BGP CRD, record and approve:

- router vendor/model/software version;
- router/VRF name;
- peer addresses reachable from the selected Kubernetes nodes;
- datacenter ASN and Kubernetes local ASN(s);
- whether all workers peer or only a selected edge-node pool;
- BFD requirement, if any;
- MD5/TCP-AO/authentication policy and secret custody where supported;
- allowed prefix list containing only the reserved service-VIP pool;
- maximum-prefix limit;
- import policy from Kubernetes (normally deny everything except service VIP pool);
- export policy toward Kubernetes (normally no default route unless deliberately designed);
- ECMP path limit and expected number of advertising nodes;
- graceful-restart behavior;
- route dampening policy;
- maintenance and rollback procedure;
- monitoring/alert thresholds for session state and advertised-route count.

## Failure-domain recommendation

Do not automatically peer every worker with the physical network. Prefer a labelled edge-node pool once the traffic model is known, for example:

```text
node.secops.io/bgp-edge=true
```

The BGP cluster configuration should select only that pool. This bounds the number of ECMP paths and separates application compute scaling from router adjacency scaling.

## Route-policy invariant

The upstream router must have a prefix filter equivalent to:

```text
permit <APPROVED_LB_POOL>
deny any
```

The exact syntax belongs in the network-device configuration repository, not here. The Kubernetes side must independently select only approved `LoadBalancerIP` Services. Both sides must enforce the boundary; neither side is trusted as the sole protection.

## Validation sequence

1. Use a non-routable/lab VRF or DEV-only router peer first.
2. Establish one Cilium node peer and confirm `cilium bgp peers` reports `established`.
3. Confirm zero unexpected prefixes before creating a Service advertisement.
4. Create one disposable Service using the Cilium BGP load-balancer class and an IP from the approved DEV pool.
5. Confirm exactly one `/32` appears in the router RIB/FIB.
6. Confirm an unlabeled Service receives no advertised route.
7. Confirm a Service outside the approved LB pool cannot be advertised because of both LB-IPAM and router prefix filters.
8. Add a second edge node and verify the expected ECMP path count.
9. Stop Cilium/BGP on one edge node and measure withdrawal/failover behavior.
10. Delete the test Service and verify route withdrawal.
11. Trigger the maximum-prefix guard in an isolated test only if the network team has an approved procedure.
12. Preserve route/session metadata and timestamps as evidence; never capture BGP authentication secrets.

## Rollback

The fastest Kubernetes-side rollback is removal/disablement of the `CiliumBGPClusterConfig` or advertisement object. The network side must also have a documented neighbor shutdown or import-policy deny path. Rollback is accepted only after the test VIP disappears from the upstream FIB and traffic falls back to the previously approved exposure mechanism.

HOMOL/PROD BGP configuration is created only after DEV proves route filtering, withdrawal, ECMP, monitoring and rollback behavior.
