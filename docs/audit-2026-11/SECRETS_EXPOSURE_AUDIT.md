# Secrets exposure and supply-chain audit - 2026-11-12

Scope: committed tree and all locally reachable git history (2,766 commits, oldest 2026-06-04), 11 workflows,
18 edge functions, `npm audit` in 4 packages. Read-only. No secret value is printed in this document.
Status words: see [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

Method: history search over 20 secret families (JWT, Supabase secret and personal tokens, mail, AI, Stripe,
Google, GitHub, Sentry, Twilio, PEM keys, database URLs, Slack, Expo, AWS); JWT payloads decoded; add / delete
history of sensitive file types; generic literal sweep of HEAD.

## Result in one line

No privileged key was found in the tree or in reachable history, with one exception: an Android signing
keystore and its password (SEC-1).

## Findings

### SEC-1 (P1; P0 if the repository is public or the key signs the Flutter app) Keystore in git history - OPEN
- Evidence: `tyre_pulse_app/release.jks` was committed by a CI step on 2026-08-20 and deleted on 2026-09-09.
  Its password and alias `tyre-pulse-key` were literal fallbacks in `.github/workflows/build-native-android.yml`
  at that time. The blob still opens with that password (private key entry confirmed with `keytool`). It is
  reachable from several remote branches. The current workflow file itself says the key still needs rotation.
- SUSPECTED escalation: the Flutter release workflow reads the same keystore secrets, introduced one week
  after the keystore was generated. Whether the secret holds this same key is NOT VERIFIED.
- NOT VERIFIED: repository visibility; whether either Play listing trusts this key as upload or app-signing key.
- Owner action: Play Console > App integrity > App signing. Compare each app's upload certificate SHA-256 with
  the leaked key's fingerprint (begins `4C:26`; full value in the audit working notes). Where it matches,
  request an upload-key reset with a new key held only in GitHub secrets. If an app is not enrolled in Play App
  Signing and uses this key as its signing key, the key cannot be rotated: treat as P0.
- Acceptance: both listings show an upload certificate that differs from the leaked one.

### SEC-2 (P2) `screenshots.yml` took a real password as a plain input - STAGED
- Evidence: workflow inputs are not masked and are stored with the run.
- Fix: commit d5764687; the workflow now reads `secrets.SCREENSHOT_EMAIL` / `secrets.SCREENSHOT_PASSWORD`.
  Confirmed in source at HEAD. Takes effect on merge.
- NOT VERIFIED: whether the workflow was ever run. If it was, the owner should change that account's password
  and delete the runs.

### SEC-3 (P2) Actions and CLIs pinned by mutable tag - STAGED / OPEN
- Evidence at HEAD: `r0adkll/sign-android-release@v1`, `r0adkll/upload-google-play@v1`,
  `expo/expo-github-action@v8`, `subosito/flutter-action@v2`, `vercel@latest`, `eas-version: latest`,
  `supabase/setup-cli` with `version: latest`. These run with signing, store and deploy credentials.
- STAGED: `.github/dependabot.yml` (commit d5764687) adds weekly github-actions updates.
- OPEN: no action is pinned to a commit SHA and no CLI is pinned to a version.

### SEC-4 (P2) Workflows without a `permissions:` block - STAGED
- Evidence: 8 of 11 workflows had none; `flutter-ci.yml` gave `contents: write` on every trigger.
- Fix: commit d5764687. At HEAD every workflow declares permissions and the golden regeneration job is a
  separate dispatch-only job with `contents: write`.
- NOT VERIFIED: the repository default token permission.

### SEC-5 (P3) Expo package advisories - OPEN
- Evidence: `npm audit --omit=dev` in `mobile/`: 4 high, 16 moderate, 1 low, 0 critical. Runtime-reachable
  item: `decode-uri-component` through `expo-router` (denial of service on the user's own device).
- Reason open: the fix is an Expo major upgrade; mobile builds are frozen by the owner.

### SEC-6 (P3) Shared-secret comparisons not constant-time - STAGED
- Evidence: `embed-worker`, `send-scheduled-reports`, `ai-tyre-inspection` compared with `!==`.
- Fix: commit d5764687 (constant-time helper). Source grep at HEAD is clean. Not deployed.

### SEC-7 (P3) Secrets expanded in shell text; signing files left on the runner - STAGED
- Fix: commit d5764687. Secrets pass through `env:`, a cleanup step runs under `always()`, and the
  `eas-update.yml` message input goes through `env:`.

### SEC-8 (P3) Dev tooling fetched unpinned - OPEN
- Evidence: `.mcp.json` runs an `@latest` package with an API key in its environment; `marketing/.npmrc` has
  `audit=false`.

### DEP-9 (P3) Supply chain small items - OPEN
- No lockfile for `services/analytics` (CI installs unpinned). SBOM produced for the root package only
  (CycloneDX 1.5, 130 production components). Local development origins remain in production CORS defaults.

## Checked and clean

| Item | Result |
|---|---|
| Supabase secret keys, personal tokens, mail, Stripe, GitHub, Sentry, Twilio, Slack, Expo, AWS, service-account keys | 0 real hits (test fixtures only) |
| The one real JWT in history (migration files) | Decodes to role `anon`: publishable |
| Supabase publishable key, Firebase Android client key, Sentry DSN in app config | Publishable by design |
| Database URLs in history | Placeholders only |
| Cron and webhook shared secrets | Generated in the database, never literal in SQL |
| Client bundles (web, marketing, Expo, Flutter) | Read public values only; server mail keys are server-side |
| Source maps | Off for the app; default off for marketing |
| Env-dump routes | None |
| Edge functions | Secrets from environment or the deny-all config table; no response echoes an error stack; all fail closed when a secret is missing |
| Workflows | No `pull_request_target`; store credentials removed under `always()` in the Expo and iOS workflows |
| `.gitignore` | Covers env files, key and keystore types, service-account JSON |
| `npm audit` (production) | root 0, marketing 0, report engine 0 |

## NOT VERIFIED

1. History before the shallow boundary, and any ref not fetched. A full scan on an unshallowed mirror is needed.
2. Repository visibility and who has read access.
3. Play Console key registration (SEC-1).
4. GitHub settings: default token permission, secret scanning, push protection, branch protection, log retention.
5. Vercel environment variables for both projects.
6. Supabase: edge-function secret values, deployed source versus repo, whether the legacy anon JWT is still enabled.
7. Google Cloud restriction on the Firebase Android API key.
8. Scope of the stored Sentry token and the Expo token.
9. Python and Flutter dependency advisories; licence compatibility.
10. No production bundle was built and searched for secrets in this pass.
