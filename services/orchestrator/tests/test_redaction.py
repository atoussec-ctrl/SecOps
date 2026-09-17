from __future__ import annotations

import unittest

from evidence.redaction import MAX_TEXT_CHARS, RedactionError, redact_text


class EvidenceRedactionTests(unittest.TestCase):
    def test_redacts_authorization_cookie_jwt_and_key_values(self) -> None:
        jwt = "eyJhbGciOiJIUzI1NiJ9." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0." + "VeryLongSignatureValue"
        source = "\n".join(
            [
                "Authorization: Bearer super-secret-bearer",
                "Cookie: session=super-secret-cookie; other=value",
                f"token={jwt}",
                'client_secret="corporate-secret-value"',
                "password: dont-store-this",
            ]
        )

        result = redact_text(source)

        for secret in (
            "super-secret-bearer",
            "super-secret-cookie",
            jwt,
            "corporate-secret-value",
            "dont-store-this",
        ):
            self.assertNotIn(secret, result.text)
        self.assertIn("[REDACTED:AUTHORIZATION]", result.text)
        self.assertIn("[REDACTED:COOKIE]", result.text)
        self.assertIn("[REDACTED:SECRET]", result.text)
        self.assertGreaterEqual(result.total, 5)

    def test_redacts_private_key_and_uri_password(self) -> None:
        source = (
            "postgresql://service:plain-text-password@db.internal/app\n"
            "-----BEGIN PRIVATE KEY-----\n"
            "very-sensitive-material\n"
            "-----END PRIVATE KEY-----"
        )
        result = redact_text(source)

        self.assertNotIn("plain-text-password", result.text)
        self.assertNotIn("very-sensitive-material", result.text)
        self.assertIn("service:[REDACTED:URI_CREDENTIAL]@", result.text)
        self.assertIn("[REDACTED:PRIVATE_KEY]", result.text)

    def test_redacts_common_prefixed_tokens_without_context(self) -> None:
        github_token = "gh" + "p_" + "abcdefghijklmnopqrstuvwxyz1234567890"
        aws_key = "AK" + "IA" + "ABCDEFGHIJKLMNOP"
        slack_token = "xox" + "b-" + "1234567890-abcdefghijklmnopqrstuvwxyz"
        source = f"{github_token} {aws_key} {slack_token}"
        result = redact_text(source)

        for secret in (github_token, aws_key, slack_token):
            self.assertNotIn(secret, result.text)
        self.assertIn("[REDACTED:GITHUB_TOKEN]", result.text)
        self.assertIn("[REDACTED:AWS_ACCESS_KEY]", result.text)
        self.assertIn("[REDACTED:SLACK_TOKEN]", result.text)

    def test_plain_identifiers_are_not_treated_as_secret_values(self) -> None:
        source = "client_id: public-client\nuser_id: 123\nrequest_id: abc"
        result = redact_text(source)
        self.assertEqual(source, result.text)
        self.assertEqual({}, result.counts)

    def test_redaction_is_text_idempotent(self) -> None:
        first = redact_text("Authorization: Bearer secret-value").text
        second = redact_text(first).text
        self.assertEqual(first, second)

    def test_does_not_persist_secret_derived_digest(self) -> None:
        result = redact_text("password=correct-horse-battery-staple")
        self.assertNotIn("correct-horse-battery-staple", result.text)
        self.assertEqual({"KEY_VALUE_SECRET": 1}, result.counts)

    def test_rejects_non_text_and_unbounded_evidence(self) -> None:
        with self.assertRaises(RedactionError):
            redact_text(b"secret")  # type: ignore[arg-type]
        with self.assertRaises(RedactionError):
            redact_text("x" * (MAX_TEXT_CHARS + 1))


if __name__ == "__main__":
    unittest.main()
