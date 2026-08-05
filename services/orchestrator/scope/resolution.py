"""DNS resolution, address pinning and redirect revalidation (backlog E1-002).

`address_policy` answers a question about a literal. This answers the harder
one: what a name resolves to, and whether that answer may still be trusted at
the moment a socket is opened.

The gap between those two moments is the whole problem.
`docs/04-security/01-threat-model.md` MU-001 names a "rebinding domain" among
the destinations Scope Guard must reject, and
`docs/03-applications/04-orchestrator-spec.md` requires that "DNS answers are
pinned for the execution" and that "validation repeats for redirects, proxy
CONNECT targets and any secondary host".

A defence that resolves a hostname, checks the answer and then hands the
*hostname* back to an HTTP client is not a defence: the client resolves again
and may connect somewhere else entirely. That is a time-of-check to time-of-use
bug, and it is how CVE-2026-27826 defeated an SSRF fix that had already been
written and reviewed. The check has to move to the layer that opens the socket.

So resolution here produces a `PinnedTarget` and nothing else. It carries the
addresses a connection may use. A caller that wants to connect asks the pin,
never the name.

Standard library only, and no network: the resolver is injected, so the tests
describe answers rather than depend on the machine's DNS.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Final, Sequence
from urllib.parse import urlsplit

from .address_policy import classify, is_scope_eligible

__all__ = [
    "PinnedTarget",
    "ResolutionRefused",
    "Resolver",
    "assert_pinned",
    "resolve_and_pin",
    "revalidate_redirect",
]

# A resolver answers with the addresses a name maps to. Injected rather than
# imported so a test can describe a rebinding answer without a network.
Resolver = Callable[[str], Sequence[str]]


class ResolutionRefused(Exception):
    """A destination was refused. The reason is meant to reach an audit record."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class PinnedTarget:
    """The result of a resolution that was allowed, and the only way to connect.

    ``hostname`` is kept for the Host header and TLS server name. It must never
    be handed to a connect call: that would resolve a second time and reopen the
    gap this class exists to close. ``addresses`` is what a socket may use.
    """

    hostname: str
    addresses: tuple[str, ...]
    port: int | None = None


# What a resolved address may be, which is not the same question as what a
# scope may contain. The scope record is IPv4-only by construction, but
# "localhost" resolves to ::1 on most machines and that is a safe destination.
# Everything else is denied by the network denylist in
# docs/04-security/09-tool-safety-guardrails.md, independently of scope.
_CONNECT_PERMITTED: Final = frozenset({"loopback", "private"})


def _address_kind(address: str) -> str:
    return "ipv6" if ":" in address else "ipv4"


def _refuse_unless_permitted(hostname: str, addresses: Sequence[str]) -> None:
    for address in addresses:
        classification = classify(address, _address_kind(address))

        if classification not in _CONNECT_PERMITTED:
            # Named individually. "One of the answers was bad" is not something
            # an operator can act on at three in the morning.
            raise ResolutionRefused(
                f"{hostname} resolves to {address}, classified {classification}, "
                "which the network denylist refuses independently of scope",
            )


def resolve_and_pin(
    target: str,
    resolver: Resolver,
    *,
    port: int | None = None,
) -> PinnedTarget:
    """Resolve ``target`` once and pin every address a connection may use.

    ``target`` is a hostname or an IP literal that the scope contract could
    contain. An IP literal is pinned without asking the resolver, because there
    is nothing to look up and no second answer to disagree with.
    """
    if not is_scope_eligible(target, "hostname") and not is_scope_eligible(
        target, "ipv4"
    ):
        raise ResolutionRefused(
            f"{target!r} is not a destination the signed scope could contain",
        )

    if is_scope_eligible(target, "ipv4"):
        return PinnedTarget(hostname=target, addresses=(target,), port=port)

    answers = tuple(resolver(target))

    # An empty answer is not permission to proceed. Everywhere else in this
    # repository a missing result is a failure, and a name that resolves to
    # nothing is exactly that.
    if not answers:
        raise ResolutionRefused(f"{target} resolved to no address")

    # Every answer, not the first. A name can return several records and a
    # client may pick any of them, so one denied address poisons the set.
    _refuse_unless_permitted(target, answers)

    return PinnedTarget(hostname=target, addresses=answers, port=port)


def resolve_url_and_pin(url: str, resolver: Resolver) -> PinnedTarget:
    """Pin the destination of a URL the scope contract could contain."""
    if not is_scope_eligible(url, "url"):
        raise ResolutionRefused(f"{url!r} is not a URL the signed scope could contain")

    parts = urlsplit(url)

    return resolve_and_pin(parts.hostname or "", resolver, port=parts.port)


def revalidate_redirect(
    previous: PinnedTarget,
    location: str,
    resolver: Resolver,
) -> PinnedTarget:
    """Re-run the whole check on a redirect target and pin it again.

    A redirect is a new authorization decision, not a continuation of the old
    one. Carrying the previous pin forward is what "validation repeats for
    redirects" exists to forbid, and reusing it because the host looks familiar
    is how a rebinding domain wins: the name is the same and the answer is not.
    """
    pinned = resolve_url_and_pin(location, resolver)

    if pinned.hostname == previous.hostname and set(pinned.addresses) != set(
        previous.addresses
    ):
        raise ResolutionRefused(
            f"{pinned.hostname} answered differently within one execution: "
            f"pinned {previous.addresses}, now {pinned.addresses}",
        )

    return pinned


def assert_pinned(pinned: PinnedTarget, address: str) -> None:
    """Raise unless ``address`` is one the pin authorised.

    The connection layer calls this immediately before opening a socket. It is
    the last place the check can still be true, which is the only place it
    counts.
    """
    if address not in pinned.addresses:
        raise ResolutionRefused(
            f"refusing to connect to {address}: not among the addresses pinned "
            f"for {pinned.hostname} ({', '.join(pinned.addresses)})",
        )
