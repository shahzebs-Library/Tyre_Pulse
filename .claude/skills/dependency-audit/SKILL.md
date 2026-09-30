---
name: dependency-audit
description: Audit Tyre Pulse dependencies across the four JS packages (root web app, marketing/, mobile/, services report engine) and the Flutter pubspec - vulnerabilities, outdated and deprecated packages, lockfile consistency, duplicates, licences - and produce an impact report before any upgrade. Use for "npm audit", "dependabot", "upgrade packages", "outdated", "vulnerabilities".
---

# Dependency audit

**Never perform a major-version upgrade automatically.** Produce the impact report first; upgrade only what the
report shows is safe, one package family per commit, with the full check suite green.

## Packages in this repo
| Path | Lockfile | Checks |
|---|---|---|
| `/` (Vite app) | package-lock.json | `npm run lint`, `npm run test:run`, `npx vite build` |
| `marketing/` | marketing/package-lock.json | lint, `npm test`, `npm run build` |
| `mobile/` (Expo SDK 54, builds frozen) | mobile/package-lock.json | `npm run typecheck`, `npm test` |
| `services/` report engine / analytics (Python) | pyproject | `python -m pytest -q` |
| `tyre_pulse_flutter/` | pubspec.lock | see flutter-qa |

## Commands (read-only)
```bash
npm audit --omit=dev --json          # production exposure first
npm audit --json                     # then everything
npm outdated --long
npm ls <pkg> --all                   # who pulls a vulnerable package in
npm ls --all 2>&1 | grep -E "deduped|invalid|UNMET"   # duplicates / broken trees
# repeat with --prefix marketing and --prefix mobile
flutter pub outdated                 # in tyre_pulse_flutter/, if an SDK is available
```

## For each finding, record
package, current, fixed/latest, severity, **reachability** (is the vulnerable code path used at runtime, in the
browser, only at build time?), dependency path, breaking changes (read the changelog), affected files, and the
proposed action.

## Known decisions (do not re-open without new evidence)
- `npm audit fix --force` is forbidden: it un-hoisted a chain and made the count worse (6 -> 10).
- `brace-expansion@^5` override breaks `minimatch@5` (CJS export change).
- `image-size` via `pptxgenjs`: pptxgenjs never imports it; an override to ^2.0.4 is in place.
- Mobile-only advisories (expo/metro/image-size, query-string via expo-router) need an Expo major and are deferred
  while mobile builds are frozen.
- jsPDF 4 + jspdf-autotable: resolve through `src/lib/pdfEngine.js` (`loadAutoTable`), never import autotable
  directly.

## Lockfile hygiene
Commit only lockfile changes that come from the intended upgrade. A plain `npm install` on some npm versions
strips `libc` fields across the lockfile - do not commit that churn. Use `npm ci` to verify the lockfile installs.

## Licences
Flag GPL/AGPL/unknown licences in runtime dependencies (`npx license-checker --production --summary` if available).

## Output
Impact report table + list of safe upgrades applied (with checks run) + list deferred with reason.
PASS: no CRITICAL/HIGH reachable-at-runtime vulnerability without a documented mitigation or plan.
