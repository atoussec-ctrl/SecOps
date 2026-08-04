"""Special-range address policy for the Scope Guard (backlog E1-001).

This is the Python half of a cross-language contract. The JSON Schema in
``packages/contracts/security/scope-record.schema.json`` decides what an
operator may write into a signed scope; this module decides what the runtime
does with a destination that arrives another way, through DNS resolution or a
redirect. The two are held together by the conformance vectors under
``packages/contracts/security/samples/address-policy/``, which both sides are
tested against.

Standard library only. A supply-chain lab that pulled a third-party address
parser to enforce its own network boundary would be arguing against itself.

.. warning::

   ``ipaddress`` is used to *parse*, never to decide. Its ``is_private`` is far
   broader than RFC 1918 and returns ``True`` for addresses this policy must
   deny, including ``169.254.169.254`` — the cloud metadata endpoint that
   ``docs/04-security/09-tool-safety-guardrails.md`` denies independently of
   scope, and the target of the WEB-SSRF-001 scenario. It also returns ``True``
   for the documentation TEST-NETs, the benchmarking range, ``240.0.0.0/4``,
   ``0.0.0.0/8`` and the broadcast address, while returning ``False`` for
   carrier-grade NAT. Eligibility here comes from an explicit allowlist of four
   ranges and nothing else.
"""

from __future__ import annotations

import ipaddress
import re
from typing import Final
from urllib.parse import urlsplit

__all__ = [
    "Classification",
    "Kind",
    "classify",
    "is_scope_eligible",
    "MINIMUM_IPV4_PREFIX",
]

Kind = str
Classification = str

# The only ranges a lab target may occupy. RFC 1918 plus loopback: nothing else
# is an owned, isolated address, and every other range is denied by name below.
_LAB_IPV4: Final = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
)
_LOOPBACK_IPV4: Final = ipaddress.ip_network("127.0.0.0/8")

# Ranges denied by name. Order matters: several overlap with what ipaddress
# reports as private, and the first match below wins.
_THIS_NETWORK: Final = ipaddress.ip_network("0.0.0.0/8")
_LINK_LOCAL_IPV4: Final = ipaddress.ip_network("169.254.0.0/16")
_MULTICAST_IPV4: Final = ipaddress.ip_network("224.0.0.0/4")
_CGNAT: Final = ipaddress.ip_network("100.64.0.0/10")
_BENCHMARKING_IPV4: Final = ipaddress.ip_network("198.18.0.0/15")
_RESERVED_IPV4: Final = ipaddress.ip_network("240.0.0.0/4")
_BROADCAST: Final = ipaddress.ip_address("255.255.255.255")
_DOCUMENTATION_IPV4: Final = (
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
)

_LINK_LOCAL_IPV6: Final = ipaddress.ip_network("fe80::/10")
_UNIQUE_LOCAL_IPV6: Final = ipaddress.ip_network("fc00::/7")
_MULTICAST_IPV6: Final = ipaddress.ip_network("ff00::/8")
_DOCUMENTATION_IPV6: Final = ipaddress.ip_network("2001:db8::/32")
_NAT64: Final = ipaddress.ip_network("64:ff9b::/96")

# A prefix shorter than this covers space no engagement owns, so the scope
# contract refuses to express one and this module refuses to accept one.
MINIMUM_IPV4_PREFIX: Final = 8

# RFC 2606 reserves these for testing and documentation, so they resolve
# nowhere by design.
_RESERVED_TLDS: Final = ("test", "example", "invalid")
_HOSTNAME = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$")

_PERMITTED_SCHEMES: Final = ("http", "https")


def _parse_ipv4(value: str) -> ipaddress.IPv4Address | None:
    """Parse a dotted quad, rejecting every alternate spelling.

    ``ipaddress`` already refuses zero-padded octets, the bare decimal form,
    hexadecimal octets and surrounding whitespace. The explicit version check
    is what stops an IPv6 literal being accepted where IPv4 was asked for.
    """
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return None

    return address if isinstance(address, ipaddress.IPv4Address) else None


def _parse_ipv6(value: str) -> ipaddress.IPv6Address | None:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return None

    return address if isinstance(address, ipaddress.IPv6Address) else None


def _classify_ipv4(address: ipaddress.IPv4Address) -> Classification:
    if address == _BROADCAST:
        return "broadcast"
    if address in _THIS_NETWORK:
        return "unspecified"
    if address in _LOOPBACK_IPV4:
        return "loopback"
    if address in _LINK_LOCAL_IPV4:
        return "link-local"
    if address in _MULTICAST_IPV4:
        return "multicast"
    if address in _CGNAT:
        return "carrier-grade-nat"
    if any(address in network for network in _DOCUMENTATION_IPV4):
        return "documentation"
    if address in _BENCHMARKING_IPV4:
        return "benchmarking"
    if address in _RESERVED_IPV4:
        return "reserved"
    if any(address in network for network in _LAB_IPV4):
        return "private"
    return "public"


def _classify_ipv6(address: ipaddress.IPv6Address) -> Classification:
    # Checked first: an IPv4 address wearing an IPv6 spelling is the case an
    # implementation reading only the dotted-quad form never sees.
    if address.ipv4_mapped is not None or address in _NAT64:
        return "ipv4-mapped"
    if address == ipaddress.ip_address("::"):
        return "unspecified"
    if address == ipaddress.ip_address("::1"):
        return "loopback"
    if address in _LINK_LOCAL_IPV6:
        return "link-local"
    if address in _MULTICAST_IPV6:
        return "multicast"
    if address in _UNIQUE_LOCAL_IPV6:
        return "unique-local"
    if address in _DOCUMENTATION_IPV6:
        return "documentation"
    return "public"


def _classify_hostname(value: str) -> Classification:
    if value == "localhost":
        return "loopback"

    # A single trailing dot is the DNS root label and makes the name absolute,
    # not malformed. Classifying it as malformed would suggest the hazard in
    # "localhost.example.com." is its syntax, when the hazard is that a public
    # name can begin with a word that looks like loopback.
    name = value[:-1] if value.endswith(".") else value

    if not _HOSTNAME.match(name):
        return "malformed"

    labels = name.split(".")
    if len(labels) >= 2 and labels[-1] in _RESERVED_TLDS:
        return "reserved-domain"
    return "public"


def _classify_url(value: str) -> Classification:
    try:
        parts = urlsplit(value)
    except ValueError:
        return "malformed"

    if parts.scheme not in _PERMITTED_SCHEMES:
        return "malformed"

    # Userinfo lets a public host hide behind a private-looking prefix, which
    # is a named safety test in the orchestrator specification.
    if "@" in parts.netloc:
        return "malformed"

    try:
        host = parts.hostname
    except ValueError:
        return "malformed"

    if not host:
        return "malformed"

    if host.startswith("[") or ":" in host:
        # urlsplit strips the brackets, so a colon here means an IPv6 literal
        # that was bracketed correctly.
        address = _parse_ipv6(host)
        return _classify_ipv6(address) if address is not None else "malformed"

    address = _parse_ipv4(host)
    if address is not None:
        return _classify_ipv4(address)

    return _classify_hostname(host)


def classify(value: str, kind: Kind) -> Classification:
    """Return the policy classification of ``value`` read as ``kind``."""
    if kind == "ipv4":
        address = _parse_ipv4(value)
        return _classify_ipv4(address) if address is not None else "malformed"

    if kind == "ipv6":
        address = _parse_ipv6(value)
        return _classify_ipv6(address) if address is not None else "malformed"

    if kind in ("ipv4-cidr", "ipv6-cidr"):
        return _classify_cidr(value, kind)

    if kind == "hostname":
        return _classify_hostname(value)

    if kind == "url":
        return _classify_url(value)

    raise ValueError(f"unknown address kind: {kind!r}")


def _classify_cidr(value: str, kind: Kind) -> Classification:
    try:
        network = ipaddress.ip_network(value, strict=True)
    except ValueError:
        return "malformed"

    if kind == "ipv4-cidr":
        if not isinstance(network, ipaddress.IPv4Network):
            return "malformed"
        # The prefix minimum is an eligibility rule, not a parsing one.
        # 0.0.0.0/0 is perfectly well formed; what is wrong with it is that it
        # covers every address, and calling it malformed would hide that.
        return _classify_ipv4(network.network_address)

    if not isinstance(network, ipaddress.IPv6Network):
        return "malformed"
    return _classify_ipv6(network.network_address)


# Only these two classifications describe an address an engagement can own. A
# classification is added to this set by a decision, never by a default.
_ELIGIBLE_CLASSIFICATIONS: Final = frozenset({"loopback", "private", "reserved-domain"})

# The scope record has no IPv6 target field and its URL pattern admits no
# bracketed host, so an IPv6 destination is ineligible whatever it classifies
# as. Keeping that here means the runtime agrees with the contract rather than
# relying on a reader to notice the absence.
_IPV6_KINDS: Final = frozenset({"ipv6", "ipv6-cidr"})


def is_scope_eligible(value: str, kind: Kind) -> bool:
    """Whether ``value`` may appear in a signed scope record at all.

    Eligibility is necessary and never sufficient: an eligible target must also
    be listed in the signed scope and covered by an unexpired grant.
    """
    if kind in _IPV6_KINDS:
        return False

    classification = classify(value, kind)

    if classification not in _ELIGIBLE_CLASSIFICATIONS:
        return False

    # A prefix this short covers space no engagement owns. The scope contract
    # refuses to express one, so the runtime refuses to accept one.
    if kind == "ipv4-cidr":
        network = ipaddress.ip_network(value, strict=True)
        if network.prefixlen < MINIMUM_IPV4_PREFIX:
            return False

    # Everything below keeps this module agreeing with the scope contract on
    # forms it classifies as safe but cannot write down. A divergence here is
    # the failure the shared vectors exist to catch: the runtime admitting a
    # spelling the signed scope could never have contained.
    if kind == "hostname":
        return not value.endswith(".")

    if kind == "url":
        parts = urlsplit(value)
        host = parts.hostname or ""
        if ":" in host:
            return False
        return not host.endswith(".")

    return True
