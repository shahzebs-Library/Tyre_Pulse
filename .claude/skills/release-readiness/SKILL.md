---
name: release-readiness
description: Go/no-go checklist for shipping Tyre Pulse - web app (Vercel project tyre-pulse), marketing site (Vercel tyre-pulse-eezl), Flutter Android (com.shahzebrahman.tyrepulse, Play closed testing), Expo Android (com.shahzebrahman.tyrepulseinspector, retired workflows) and iOS. Use for "test release", "ready to ship", "go live", "Play Store", "App Store", "production check".
---

# Release readiness

Owner rules that override everything here: mobile builds and store releases happen only when the owner asks;
the Flutter workflow publishes only to the Play **closed testing** track of its own package; production promotion
is the owner's call. Expo build workflows are retired (they exit 1 on purpose).

## Web app (Vite, repo root, Vercel project `tyre-pulse`, domains tyrepulse.app + www)
- `npm run lint && npm run test:run && npm run test:database && npx vite build` green.
- Production deploy verified by reading Vercel deployments: newest `target: "production"` on the exact sha,
  state READY. A merged PR is not a deploy.
- Env vars present on Vercel (names only; never print values): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  (a missing one paints a config error page), optional Sentry/PostHog/Turnstile keys.
- Headers in `vercel.json`: CSP (`script-src 'self'`, connect-src includes Supabase, Sentry, PostHog), HSTS,
  X-Content-Type-Options, frame policy; SPA rewrites; cache rules; `ignoreCommand` skip list.
- PWA: prompt-mode update, `skipWaiting:false`; open tabs keep the old build until reload.
- Anonymous pages work: `/login`, `/report/:token`, `/workshop-tv/:token`, `/accident-portal/:token`,
  `/data-deletion`.
- 404 route, robots, manifest, favicon; no source maps with secrets; no debug flags.
- Database: migrations referenced by the release are applied (`list_migrations`), security advisors show no new
  ERROR, backups job healthy (`backups.snapshots` last run), `system_config.maintenance_mode` off.

## Marketing (Next.js, `marketing/`, Vercel project `tyre-pulse-eezl`, Root Directory `marketing`)
- `npm --prefix marketing run lint && npm --prefix marketing test && npm --prefix marketing run build`.
- Every page: title <= 60 chars, description <= 160, canonical, `openGraph.images` present (a page-level
  openGraph replaces the layout's), JSON-LD valid, `robots.ts`/`sitemap.ts` list every page, 404 is noindex.
- `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` correct for the domain it is served on (no custom domain yet -
  canonical URLs point at www.tyrepulse.app which serves the app).
- Visual QA at the standard viewports (visual-regression skill); no horizontal overflow; WhatsApp number correct.

## Android - Flutter (`tyre_pulse_flutter/`)
- `applicationId` com.shahzebrahman.tyrepulse; `version:` in pubspec bumped (name + build number) before release;
  `--dart-define=APP_VERSION` passed by the workflow; set `flutter_min_version` only after the build is live.
- Signing: upload keystore from secrets, never committed; `key.properties` not in git.
- `google-services.json` present (committed on purpose for FCM); Supabase URL/anon key are production values;
  no test endpoints, `debugShowCheckedModeBanner` false, logging reduced.
- Permissions in AndroidManifest match features (camera, location foreground, notifications); no unused
  sensitive permission; `targetSdk` meets the current Play deadline.
- Store: privacy policy URL, Data safety (crash logs via Sentry shared; location; photos; no ads/tracking), account
  deletion URL `https://tyrepulse.app/data-deletion` + in-app request, reviewer test login, screenshots, icon (still
  the default Flutter logo - blocker until replaced), feature graphic 1024x500.
- Crash reporting, push (FCM token registration via `register_user_device`), deep links verified on device.

## iOS (not shipped yet)
Bundle ID, version/build, signing + provisioning, `Info.plist` permission strings, privacy manifest
(`PrivacyInfo.xcprivacy`), `GoogleService-Info.plist`, APNs, universal links, App Store privacy labels, account
deletion, screenshots. Report each as present / missing; the CI iOS job builds `--no-codesign` only.

## Output
A table: item -> PASS / FAIL / NOT APPLICABLE / NOT VERIFIED, with evidence. Any FAIL on signing, secrets,
production URLs, account deletion, privacy policy or crash-free startup is a **release blocker**.
