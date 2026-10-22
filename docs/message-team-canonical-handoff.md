# Message the Team — canonical implementation and agent handoff
Updated 2026-10-22. Applies to **Tyre Pulse**. This file is the durable project context for subsequent coding agents.

## Non-negotiable product decisions
- **Flutter (`tyre_pulse_flutter/`) is the ONLY future iOS and Android production mobile app.** Do not add new work under legacy `mobile/` Expo unless explicitly requested.
- Keep existing web route `/broadcast`, navigation, shell, design tokens, Action Center and Supabase project. No duplicate module, extra sidebar or second communications backend.
- Complete coherent functionality, tests and review in as few PRs as possible. Never say a push was delivered to a phone merely because FCM returned a successful HTTP response.
- Owner takes responsibility for physical device test execution and final iOS APNs provisioning; code authors must still run CI/builds and negative access tests where available.

## Already merged into main (do not rebuild)
- **#426:** web messaging and follow-up Action Center task creation, notification/read/reply backend integration.
- **#428:** web manager engagement panel, Flutter broadcast read/acknowledge/reply dialog, existing in-app messaging improvements. Note that an earlier temporary Expo addition was not the future production target.
- **#431:** Flutter assigned-action dialog (accept, start, block, resolve), employee-scoped `tp_employee_action_transition` RPC, private `team-action-evidence` bucket, photo upload, task routing, Firebase iOS initialization code.
- **#433:** observed FCM foreground/open events (`team_push_device_events`) with offline queue, manager delivery-observation metrics, exact broadcast entity ID in push payload, Flutter targeted inbox/dialog handoff, PDF/image file picker (10 MB), private signed evidence listing/opening, orphan cleanup, routing tests and backend RLS migrations. In-app observation/open is distinct from device OS delivery.
- Dependency lockfile correction later committed to `main`: `0c0b6f8c`. Check latest CI rather than assuming the entire suite passed.
- Older reference documents: `docs/message-team-release-status-2026-10-22.md` and `docs/message-team-delivery-evidence-2026-10-22.md`.

## Current PR #435 — outstanding web composer UX
Branch `feature/message-team-audience-ux-20261022` from `main`; **do not merge until reviewed/tested**.
- Existing `src/pages/Broadcast.jsx` edited in place; same Supabase RPC contract.
- Replace overflowing role/country/site chips shown in the screenshot with compact searchable multi-select dropdowns.
- Each dropdown has checkbox options, search, clear/all selection, select matching, removable selected chips, compact count, Done button, Escape/outside-click dismissal.
- Country-aware site option narrowing is visual convenience; server still resolves audience. Preserve chosen sites when country changes instead of silently dropping them.
- Immediately invalidate stale preview after filter changes. Disable Send until the **latest** `broadcast_audience` server preview succeeded, is nonempty, and form validation passes.
- Keep responsive writing fields, optional Arabic, country role and site meaning, push toggle, follow-up tasks, engagement metrics, message history, exports.
- Zero selected roles/countries/sites intentionally means **all** in that category (do not interpret as nobody). Beware high-impact accidental Everyone sends; visible audience summary and server preview mandatory.

## Current web form specifics that need product-quality follow-through
1. Job role choices should be sourced from actual assignable roles/custom roles; **job titles and access-control roles may not be interchangeable**. Validate the RPC targets intended `profiles.role` values before renaming them to job titles.
2. Site list should be sourced from active registered sites, not stale/demo aliases. Prefer organization and country-qualified sites; avoid name collisions for two sites sharing a name. RPC currently accepts name strings, so any change requires coordinated API migration.
3. Country picker should reflect tenant-visible countries rather than assuming all static countries are valid. Preserve zero-selection/all semantics.
4. Add explicit preview state, count of people with a registered phone and targeted-country/site summary. Never fabricate real-time phone online/delivery status.
5. The follow-up task's site/person selection should use the exact same active directory and canonical site IDs/names as Action Center. Existing free-text site is a known inconsistency to remove with tests.
6. Existing `src/pages/Broadcast.jsx` includes a **hand-built follow-up task table** while the project has `EnterpriseTable`. Design-system ratchet tests have previously flagged new raw tables and overlays; inspect/fix regressions before merging.
7. Keyboard and screen-reader verification: labels, role semantics, focus after close, tab order, search, checkbox selection, and dropdown clipping within ancestor containers.

## Backend and data security
- Broadcast sends: `broadcast_audience` preview and `broadcast_send` are the server authority; client audience filters are not an authorization boundary.
- Receipts: `broadcast_recipient_receipts`; replies: `broadcast_replies`, tenant/recipient RLS.
- Action tasks: `action_items` and `tp_employee_action_transition`; no client-only permission checks.
- Evidence: `team_action_evidence` and private `team-action-evidence` bucket. Time-limited signed URLs. Type/size restrictions; negative tests for another employee, another tenant, orphan removal, and expired URL are still required if not evidenced by CI.
- App push telemetry: `team_push_device_events` reports `received_foreground` / `opened_by_user`, not guaranteed FCM OS display. Account for duplicate event IDs and offline flush.

## Verification register — never treat implementation as proof
| Area | Implemented | Validation still required |
| --- | --- | --- |
| Web broadcast composer, audience RPC and send | Yes | Latest web lint/tests/build; test zero/one/many targets, stale preview, authorization |
| Web manager receipts/replies and observed push counts | Yes | Sender/recipient/other-org RLS integration tests |
| Flutter broadcast read/ack/reply | Yes | Android/iOS build, account-based regression and owner devices |
| Flutter task status, photo/PDF evidence | Yes | Builds, permission-denial, storage/recovery, attachment opening |
| Flutter exact-record notification routing | Yes | Cold-start/background device test, missing/unknown message fallback |
| Push received/opened tracking | Yes for app observations | Validate device event path; no OS-delivered guarantee |
| Apple APNs configuration and actual iPhone delivery | Not verified | Owner |
| Web tests previously reported non-module failures | Not cleared by these changes | `designSystemRatchet.test.js` table/overlay checks and `washPage.render.test.jsx` record lookup; inspect fresh CI because main evolves quickly |

## Next agent operating instructions
1. Read this file, `Broadcast.jsx`, `MessageEngagement.jsx`, `src/lib/api/broadcast.js`, and latest PR/CI state before coding.
2. Work **on PR #435's branch**, not scattered branches. If newer main commits arrive, reconcile first.
3. Make the audience selectors production-grade: no broad all-audience send via stale preview, no dynamic role mislabeling, avoid site duplication; resolve screenshot's cramped and overlong rows.
4. Review tests and keep the PR mergeable; use CI logs, not guessed results. Write exact failures and fixes here.
5. Merge to `main` only once requested acceptance is met or explicitly approved despite clearly stated blockers. Update this document after each release.

## Final integration checkpoint (2026-10-22)
- PR #435 has web selector code and message-recipient safeguards; run web lint/tests/build and review failures before merge.
- User explicitly authorizes merging after completion and asks for updates to this *same* repository handoff document. Preserve this document in any subsequent updates; do not create another independent status file.
- Device/APNs work remains owner-managed and is not an acceptance criterion for the web-only PR #435.

## Merge overview at this checkpoint
Earlier code PRs #426/#428/#431/#433: merged based on previous GitHub checks and discussion. **PR #435 is pending**, includes new audience UI work; no claim of passing CI or production acceptance at this checkpoint.

## Audience completion (2026-10-23, branch `feature/broadcast-audience-complete-20261023`, from `main` 2e0b56f3)
Code only. No live DB, no device, no CI run was available; everything below was verified with local eslint/vitest/vite build only.

What changed (items 1-7 of "Current web form specifics" above):
- **Pickers are now built from real data, never static lists** (`src/lib/broadcastAudience.js`, loaded by `loadAudienceDirectory()` in `src/lib/api/broadcast.js`):
  - *Job roles* = distinct `profiles.role` of approved, unlocked people in the caller's organisation + that organisation's active `custom_roles`. Values keep the EXACT stored case/spelling because `broadcast_send`/`broadcast_audience` filter with `p.role = any(p_roles)`. Option hints show how many eligible people hold the role. `ASSIGNABLE_BUILTIN_ROLES` is no longer used here (it listed roles nobody holds).
  - *Countries* = countries of the organisation's active sites + countries held by its eligible people (server test is `p.country && p_countries`). The static `COUNTRIES` constant is no longer used on this page.
  - *Sites* = active sites of the caller's organisation, normalised like the DB (`normalize_site`: upper, trim, collapse spaces, `site_aliases`, trailing `-ST`/`_ST` strip), de-duplicated on the canonical value, narrowed by selected countries. Canonical values are what `profiles.sites` stores, which is what the server overlaps with (`p.sites && (p_sites || ['ALL'])`). A site chosen earlier stays on offer/as a chip after the country filter changes. Foreign-organisation and inactive sites are dropped client-side (RLS is still the boundary; super admins can read other orgs, hence the explicit filter).
  - After the directory loads, selections that are not in it are pruned. The first preview is not requested until the directory is ready.
- **Zero selection still means ALL.** When nothing narrows the audience the page shows a warning checkbox ("No filter is selected ... Tick to confirm") that must be ticked before Send; ticking resets on every audience change. Send additionally needs the latest server preview to have succeeded with a non-zero total (unchanged).
- **New reusable `src/components/ui/MultiCombobox.jsx`** (ARIA editable combobox + `role=listbox` `aria-multiselectable`, `aria-activedescendant`, option `aria-setsize/posinset`, portalled via `useAnchoredPopover` so `.card` does not clip it). Keys: ArrowUp/Down (wrap), Home/End (list open and search empty, or Ctrl), Enter and Space (empty search) toggle, Escape closes and keeps focus (second Escape clears search), typing filters and highlights the first match (type-ahead), Tab closes. Chips with named remove buttons, `+N more`, live count, "Select all N matching" and "Clear" as real buttons. Search is case/diacritic/Arabic-letter-variant insensitive and every token must match.
- **Follow-up assignment**: employee picker is a multi-select over the same component, searchable by name, username, employee ID, role, site, country and Arabic names. One Action Center task is created per person with source key `broadcast:<messageId>:<userId>` (retry creates only the missing ones; per-person success/failure is shown). The free-text site input is replaced by a dropdown of the registered, canonical site directory.
- **Follow-up table** is now `EnterpriseTable` (hand-built `<table>` removed from `Broadcast.jsx`).
- Old `AudienceSelect` (non-ARIA checkbox popover) was deleted.

Tests added (all passing locally): `src/test/broadcastAudience.test.js` (roles/countries/sites against server-predicate mirrors, dedupe, foreign org, Arabic search), `src/test/multiCombobox.test.jsx` (ARIA + keyboard), `src/test/broadcastPage.render.test.jsx` (page: options from data, everyone confirmation, stale preview invalidation, zero recipients block, per-person tasks).

Known limits / not verified:
- The server predicates are mirrored in `serverRoleMatch/serverCountryMatch/serverSiteMatch` from the committed migration `20261022115000_broadcast_push_target_entity_id.sql` (broadcast_send). The `broadcast_audience` body itself is not in the repo (live definition only); it is assumed to use the same predicate, as V569 documents. Re-check against the live function.
- Site values carry no country (the RPC takes names only), so a name that exists in two countries is one option labelled with both. A country-qualified site ID would need an RPC change.
- `profiles` is read org-wide, up to 20,000 rows; a truncated or failed read is reported on the page ("Could not load the complete list of ...") rather than shown as a short list. `site_aliases` read failure silently falls back to suffix-only normalisation (existing `listSiteAliases` behaviour).
- `designSystemRatchet.test.js` currently FAILS on this base (raw `<table>` and `fixed inset-0` count 0 -> 1). The only offender is `src/pages/AiTyreInspection.jsx`, which this change does not touch; `Broadcast.jsx` contributes none.
- No screen-reader or real mobile-browser pass was done; layout uses responsive grids (1/2/3 columns) but was only checked by tests and build.
- CI has not been run on this branch; PR not opened.
