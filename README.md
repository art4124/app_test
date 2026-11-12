# Vune — Privacy-First Period Tracker (Web Prototype)

**Status:** Functional browser-testing prototype, **not a production or clinical app**. This repository is currently named `app_test`; the product name is **Vune**.

**Browser prototype:** https://art4124.github.io/app_test/

> **Testing only:** Use fictional information. This build is not medical advice, is not a substitute for clinical software, and should not be used for real patient records. Security features described below are implemented in a prototype, not independently audited or certified.

## What Vune demonstrates

A local-first cycle and wellness-tracking experience, with deliberate attention to privacy, visual consistency, and iterative QA.

**Prototype features implemented:**

- Encrypted local vault using Web Crypto (AES-GCM and PBKDF2-derived key).
- Passcode and inactivity auto-lock, with privacy masking in the tab background.
- **Multiple check-ins on the same date:** period, flow, mood, and symptom entries are retained individually in daily history.
- Cycle history, calendar, period forecasts, and locally calculated patterns.
- Encrypted personal journal (Bloom Notes).
- Browser-based insights for cycle, symptom, and mood history.
- Simulated subscription/plan preview, local rule-based assistant experience, and supporter health-summary export.
- Recovery Key backup and local restoration.
- Offline-capable progressive web app shell.
- No advertising/analytics SDKs, external AI requests, or health-data backend in this browser prototype.

## Known issue — consent must not be bypassed

[Issue #5: Opening Terms & Conditions bypasses the required agreement](https://github.com/art4124/app_test/issues/5) was reported by a user and is **not yet confirmed fixed**.

**Expected behavior:** Reading the terms must never be treated as agreeing to them. Continuing must require a separate affirmative consent action. The onboarding/consent flow needs a regression test before the prototype is presented as release-ready.

## Quick start

Run on HTTPS or `localhost` because the Web Crypto API requires a secure context.

```sh
python3 -m http.server 8000
```

Open http://localhost:8000/. You can also use a local static server such as `npx serve .`.

## Automated checks

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

See `tests/browser-smoke.mjs` for browser-based coverage and `tests/runtime-logic.mjs` for selected runtime logic checks. The validation workflows run in GitHub Actions; their passing does **not** establish that the consent bug or all security concerns are solved.

## Repository guide

| Path | Purpose |
| --- | --- |
| `index.html` | Main application shell and screens |
| `vune-runtime.js` | Main client-side application behavior |
| `vune.css` | Responsive UI and visual design |
| `terms.html`, `privacy.html` | Terms and privacy information |
| `public-theme.js`, `service-worker.js` | Shared visual settings and offline shell |
| `manifest.webmanifest`, `icon.svg` | Installable web-app metadata and icon |
| `audit-check.mjs`, `tests/` | Validation scripts and tests |
| `.github/workflows/` | Automated validation and deployment |
| `SECURITY.md` | Security design, limitations, and reporting |
| `package.json`, `package-lock.json` | Test dependencies |

Keeping this compact static web prototype at the root preserves existing relative paths. Refactoring into `src/` or `public/` should happen only with a matching deployment and regression-test update.

## Security boundaries and roadmap

The local encrypted browser vault is not equivalent to a production native-iOS architecture. A future native implementation may use Keychain, device authentication, secure local storage, native backup handling, and StoreKit entitlements; those are **targets**, not features of this browser build.

See [SECURITY.md](SECURITY.md) for fuller limitations. The browser's local recovery and vault data can still be affected by device access, browser storage behavior, and an untested migration. Always test with fictional data.

## My role

I directed product requirements, user experience, feature priorities, privacy decisions, reproduction of bugs, and iterative testing with AI-assisted implementation support. This description is not a claim to have independently written or security-audited every component.

**Repository visibility:** This source repository is public. The app is under development and should not be treated as a published health product. No general reuse license is granted by this README.
