"""Deterministic fail-closed redaction for scanner/log evidence.

This module intentionally redacts known secret-bearing structures before any
text can leave the orchestrator boundary. It does not attempt to classify every
possible secret on earth; adapters may add richer detections later, but raw
credentials must never be persisted merely because a detector does not know
their vendor-specific shape.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

MAX_TEXT_CHARS = 1_000_000


class RedactionError(ValueError):
    """Evidence cannot be represented safely."""


@dataclass(frozen=True)
class RedactionResult:
    text: str
    counts: dict[str, int]

    @property
    def total(self) -> int:
        return sum(self.counts.values())


# Marker text is deliberately constant. We do not store a raw-secret hash: a
# plain hash of a low-entropy password becomes an offline guessing oracle.
def _marker(kind: str) -> str:
    return f"[REDACTED:{kind}]"


PRIVATE_KEY = re.compile(
    r"-----BEGIN (?P<label>(?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY)-----"
    r".*?"
    r"-----END (?P=label)-----",
    re.IGNORECASE | re.DOTALL,
)
JWT = re.compile(
    r"(?<![A-Za-z0-9_-])"
    r"[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"
    r"(?![A-Za-z0-9_-])"
)

# Horizontal whitespace is intentional here. ``\s`` would also match a newline
# and could merge one HTTP header with the next before redaction.
AUTHORIZATION = re.compile(
    r"(?im)^(?P<prefix>[ \t]*(?:proxy-)?authorization[ \t]*:[ \t]*)"
    r"(?P<scheme>bearer|basic|token)[ \t]+[^\r\n]+$"
)
COOKIE = re.compile(
    r"(?im)^(?P<prefix>[ \t]*(?:cookie|set-cookie)[ \t]*:[ \t]*)[^\r\n]+$"
)
URI_CREDENTIAL = re.compile(
    r"(?P<scheme>[A-Za-z][A-Za-z0-9+.-]*://)"
    r"(?P<user>[^/@:\s]+):(?P<secret>[^/@\s]+)@"
)

# JSON, env, YAML and loose key/value logs. Quoted and unquoted values are
# deliberately separate expressions. A single optional quote expression can
# ambiguously consume an opening quote and then fail to redact the value.
_SECRET_KEY = (
    r"(?:password|passwd|pwd|secret|client_secret|api[_-]?key|access[_-]?token|"
    r"refresh[_-]?token|auth[_-]?token|private[_-]?key)"
)
_SECRET_PREFIX = rf"(?P<prefix>(?:[\"']?{_SECRET_KEY}[\"']?)[ \t]*(?:=|:)[ \t]*)"
SECRET_DOUBLE_QUOTED = re.compile(
    rf"(?i){_SECRET_PREFIX}\"(?P<value>[^\"\r\n]{{1,4096}})\""
)
SECRET_SINGLE_QUOTED = re.compile(
    rf"(?i){_SECRET_PREFIX}'(?P<value>[^'\r\n]{{1,4096}})'"
)
SECRET_UNQUOTED = re.compile(
    rf"(?i){_SECRET_PREFIX}(?P<value>[^\s,;\}}\]\r\n\"']{{1,4096}})"
)

# Common vendor token prefixes. These are supplemental to key/value redaction
# and allow safe handling when a scanner prints a token without its field name.
PREFIX_TOKENS = [
    ("GITHUB_TOKEN", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,255}\b")),
    ("GITHUB_PAT", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,255}\b")),
    ("SLACK_TOKEN", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,255}\b")),
    ("AWS_ACCESS_KEY", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
]


def _sub(pattern: re.Pattern[str], text: str, kind: str, counts: Counter[str], replacement) -> str:
    def repl(match: re.Match[str]) -> str:
        counts[kind] += 1
        return replacement(match)

    return pattern.sub(repl, text)


def redact_text(text: str) -> RedactionResult:
    """Redact secrets from bounded text without preserving secret-derived hashes."""

    if not isinstance(text, str):
        raise RedactionError("evidence must be text")
    if len(text) > MAX_TEXT_CHARS:
        raise RedactionError(f"evidence exceeds the {MAX_TEXT_CHARS}-character redaction limit")

    counts: Counter[str] = Counter()
    result = text

    result = _sub(
        PRIVATE_KEY,
        result,
        "PRIVATE_KEY",
        counts,
        lambda _match: _marker("PRIVATE_KEY"),
    )
    result = _sub(
        AUTHORIZATION,
        result,
        "AUTHORIZATION",
        counts,
        lambda match: f"{match.group('prefix')}{match.group('scheme')} {_marker('AUTHORIZATION')}",
    )
    result = _sub(
        COOKIE,
        result,
        "COOKIE",
        counts,
        lambda match: f"{match.group('prefix')}{_marker('COOKIE')}",
    )
    result = _sub(
        URI_CREDENTIAL,
        result,
        "URI_CREDENTIAL",
        counts,
        lambda match: (
            f"{match.group('scheme')}{match.group('user')}:{_marker('URI_CREDENTIAL')}@"
        ),
    )
    result = _sub(
        JWT,
        result,
        "JWT",
        counts,
        lambda _match: _marker("JWT"),
    )

    for kind, pattern in PREFIX_TOKENS:
        result = _sub(
            pattern,
            result,
            kind,
            counts,
            lambda _match, token_kind=kind: _marker(token_kind),
        )

    result = _sub(
        SECRET_DOUBLE_QUOTED,
        result,
        "KEY_VALUE_SECRET",
        counts,
        lambda match: f"{match.group('prefix')}\"{_marker('SECRET')}\"",
    )
    result = _sub(
        SECRET_SINGLE_QUOTED,
        result,
        "KEY_VALUE_SECRET",
        counts,
        lambda match: f"{match.group('prefix')}'{_marker('SECRET')}'",
    )
    result = _sub(
        SECRET_UNQUOTED,
        result,
        "KEY_VALUE_SECRET",
        counts,
        lambda match: f"{match.group('prefix')}{_marker('SECRET')}",
    )

    return RedactionResult(text=result, counts=dict(sorted(counts.items())))
