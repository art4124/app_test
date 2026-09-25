# Vune — Web Testing Prototype

A privacy-first, local-only web prototype for testing the Vune period tracker before the native iOS/TestFlight phase.

## What is implemented

- Encrypted local vault using Web Crypto (AES-GCM + PBKDF2-derived key)
- Passcode lock and inactivity auto-lock
- Privacy curtain when the tab is hidden
- Daily period / flow / mood / symptom check-ins
- Local cycle-length calculations and next-period estimate
- Calendar history and predicted dates
- Encrypted journal
- Local insights for cycles, symptoms, and moods
- Supporter-plan simulation
- Local Vune Assistant UX prototype (rule-based, no network calls)
- Local clinician-friendly Vune Health Summary with Print / Save as PDF
- Encrypted backup export/import
- Plan-preview controls for Free, Essential, Plus, Complete, and Supporter
- Offline-capable PWA app shell
- No ad SDKs, analytics SDKs, external AI calls, or health-data backend

## Future product ideas

- Vune Garden — a gentle plant-growth experience tied to check-ins may be reconsidered in a future update after the core tracker is stable. It is not part of the current beta.

## Testing safety

**Use fictional health information in the web prototype.**

The browser build validates the product experience and local-encryption flow. It is not a substitute for the final iOS architecture using Keychain, native authentication, native storage protections, and the planned security review.

## Run locally

Because Web Crypto requires a secure context, use HTTPS or localhost rather than opening index.html directly from the filesystem.

With Python:

    python -m http.server 8080

Then open:

    http://localhost:8080

With Node:

    npx serve .

## Hosting

The site is static and can be hosted with GitHub Pages once Pages is enabled for the repository. A Pages workflow is included.

For a private repository, GitHub plan limitations may affect Pages availability. Keeping the source private is preferred while Vune is in product-development testing.

## Security design notes

See SECURITY.md and privacy.html.

## Native mapping

| Web prototype | Native iOS target |
|---|---|
| Browser passcode-derived key | Keychain-protected application key |
| Browser localStorage ciphertext | Encrypted native application database |
| Privacy curtain | Native app-switcher privacy protection |
| Manual passcode | Face ID / device authentication |
| Encrypted JSON backup | Optional encrypted iCloud/CloudKit sync |
| Rule-based local Assistant | On-device model where supported |
| Browser print-to-PDF | Native local Health Summary generation |
| Plan simulation | StoreKit subscription entitlements |

## Status

Prototype only. Not medical advice and not intended for real patient records.