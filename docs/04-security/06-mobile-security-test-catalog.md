# Mobile Security Test Catalog

## General method

Use source review, artifact inspection and runtime observation. Run tests only
against owned lab builds. Tool output is evidence for review, not a conclusive
security verdict.

## MASVS-aligned catalog

| Group | Static tests | Dynamic tests |
| --- | --- | --- |
| STORAGE | Storage APIs, logs, backup flags, hardcoded data | Generate data, inspect sandbox, logout/reinstall lifecycle |
| CRYPTO | Algorithms, modes, key generation/storage, random sources | Observe key lifecycle and failure behavior |
| AUTH | Session handling, biometrics, local authorization code | Logout, step-up, enrollment change and offline behavior |
| NETWORK | ATS/Network Security Configuration, TLS code, endpoints | Proxy only lab traffic, invalid certificate and timeout behavior |
| PLATFORM | Permissions, components, entitlements, links, WebViews | Exercise deep links, IPC, clipboard, screenshot and notifications |
| CODE | SDK targets, debug flags, dependency inventory, native code | Runtime errors, update behavior and safe exception handling |
| RESILIENCE | Symbols, debug artifacts, obfuscation and integrity checks | Observe owned build under debugger/instrumentation |
| PRIVACY | Permissions, manifests, collection declarations | Consent, revocation, minimization and deletion flows |

## Android checks

- APK signature and certificate metadata.
- Manifest exports, permissions, backup/debug/cleartext configuration.
- Deep/App Link verification and parameter validation.
- Keystore and biometric key binding.
- SharedPreferences, databases, files, cache and logs.
- Content Provider and Intent authorization.
- WebView origin, bridge, file/content access and debugging.
- Screenshot, notification, clipboard and accessibility exposure.
- Native library hardening and dependency inventory.

## iOS checks

- Bundle signature, provisioning and entitlements.
- `Info.plist`, URL schemes, Universal Links and ATS exceptions.
- Keychain accessibility and file Data Protection.
- LocalAuthentication and server-side transaction authorization.
- `WKWebView`, navigation and message handlers.
- Pasteboard, background snapshots, notifications and logs.
- Debug symbols, build flags and framework inventory.
- Privacy manifests, permissions, consent and deletion behavior.

## Test-device rules

- Use a dedicated emulator/simulator snapshot or owned test device.
- Install only lab certificates and profiles; remove them after the engagement.
- Do not use personal accounts, backups or notifications.
- Capture tool/device version and architecture with evidence.
- Revert snapshot or factory-reset the dedicated profile after capstone.

## Mobile scenario completion

- Artifact diff identifies the intended insecure configuration/code.
- Runtime proof uses the lab API and synthetic data.
- Secure build prevents the same proof.
- Manifest/entitlement/permission regression runs in CI.
- Finding maps to MASVS, MASWE and a relevant MASTG test or technique.

