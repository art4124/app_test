# Vune Web Prototype Security

## Purpose

This repository is a product-testing prototype. It intentionally has no health-data server and no third-party analytics or advertising integration.

## Prototype security model

Sensitive state is serialized, encrypted with AES-GCM, and stored as ciphertext in browser local storage. The encryption key is derived at unlock time from the user's passcode using PBKDF2-SHA-256 with a random salt.

The passcode and derived CryptoKey are not stored in local storage.

## Data-flow rules

1. No cycle, symptom, journal, or Assistant content is transmitted by application code.
2. No analytics SDK is present.
3. No advertising SDK is present.
4. No external AI endpoint is present.
5. User-authored strings are escaped or inserted with textContent when rendered.
6. The page Content Security Policy blocks remote scripts and outbound connect-src requests.
7. The service worker caches only the static application shell, not user health records.
8. Encrypted backups contain the salt and ciphertext payload, not plaintext Vune state.

## Browser prototype limitations

This is not the final iOS key architecture. A browser cannot reproduce the complete protection available from Apple Keychain, Secure Enclave-backed operations, native biometric authentication, iOS Data Protection, or app-level entitlement controls.

Use fictional data while testing.

## Planned native replacement

Before TestFlight / production:

- Replace browser local storage with the final encrypted native data layer.
- Protect key material through Apple Keychain and appropriate access-control policy.
- Add Face ID / device-authentication flow.
- Validate app-switcher and notification privacy.
- Implement secure optional iCloud/CloudKit synchronization.
- Verify on-device AI boundaries.
- Perform OWASP MASVS-based review and targeted security testing.
- Verify App Store privacy disclosures match real data flows.
- Conduct an independent security assessment before scaling public use.

## Reporting

Do not place real user health data, journal text, credentials, passcodes, or encryption keys in GitHub issues, pull requests, logs, screenshots, or test fixtures.