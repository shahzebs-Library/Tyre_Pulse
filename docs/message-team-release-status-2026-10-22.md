# Message the Team — release and verification register
Updated: 2026-10-22. Source: GitHub `main` after merged PRs #426, #428 and #431.

## Production direction
- Web: existing Message the Team module and Action Center.
- **iOS and Android: Flutter only** (`tyre_pulse_flutter/`). Expo is legacy, not the production mobile implementation.
- Database/auth/storage: existing Tyre Pulse Supabase project.
- No new sidebar or duplicate messaging module.

## Implemented and merged
| Area | Code / backend implementation | Verification |
| --- | --- | --- |
| Broadcast messaging | Broadcast composer, audience selection, existing in-app/queued push workflow | Real device delivery not verified |
| Manager engagement | Read/acknowledgment counts and replies panel | End-to-end account-role tests not run |
| Employee message handling | Flutter notification dialog with read, acknowledgment and replies | Flutter device tests outstanding |
| Task-assignment notifications | Database trigger creates in-app notification and workflow push queue | FCM acceptance/device delivery not confirmed |
| Assigned task actions | Flutter task dialog with accept, start, block, completion states | Employee transition integration tests outstanding |
| Employee permissions | Supabase `tp_employee_action_transition` checks auth/organization/assignment and state transitions | Cross-tenant negative tests outstanding |
| Evidence storage | Private `team-action-evidence` bucket, metadata and Storage RLS; Flutter gallery photo upload | Photo upload/download/access tests outstanding |
| Push notification navigation | Flutter coordinator supports foreground/background tap and initial message; broadcast/action routing to notification inbox | Killed-app/background-device tests outstanding |
| iOS Firebase support | Initialization and APNs token guard in Flutter code | iOS Firebase plist/APNs configuration and iOS build unverified |

## Outstanding before production acceptance
1. **FCM delivery reporting**: current push send is provider acceptance/queue reporting, not proof of device delivery. Add per-device telemetry/acknowledgments with explicit states `queued`, `accepted_by_fcm`, `opened`, `failed`. Never label FCM acceptance as OS delivery.
2. **Evidence**: verify signed access/download, authorized uploader, unauthorized users, cross-organization denial, size/type rejection and upload recovery; Flutter file/PDF picker and attachment list still need completion.
3. **Notification deep links**: routed notifications currently open the inbox where the employee can act. Automatic direct open of *the exact* task/message from killed/background states requires further implementation and device tests.
4. **iOS push provisioning**: `tyre_pulse_flutter/ios/Runner/GoogleService-Info.plist` was not found in the repository. Confirm build-time secure injection, Firebase app setup, APNs token/key, signing, capabilities and physical iPhone receipt.
5. **Build and regression**: obtain passing Flutter analyze, Flutter tests, Android APK/AAB build, iOS no-codesign build/archive as appropriate, web lint/Vitest/Vite build, and auth/RLS integration tests. Do not describe the module as production verified until those results exist.
6. **CI/deployment**: last observed Vercel checks reported a private-organization-repo/plan restriction, not a passing web build. Investigate separately from Flutter builds.

## Merge inventory
- PR #426: merged.
- PR #428: merged.
- PR #431: merged, confirmed at commit `ab2bdf3150899d2ef12108a2d31ec823dce7776b`.
- These statuses report **implementation**, not successful production testing.

## Owner device test checklist
- Android: receive FCM in foreground, background and terminated; tap opens intended inbox; read/ack/reply persisted; accept/complete task; photo evidence upload and later retrieval.
- iPhone: APNs authorization/token, FCM registration, foreground/background/terminated receipt; same task and message flows.
- Permission negatives: a different employee and a different organization's member cannot open/update task, receipt, reply or evidence.

## Release decision
**Merged code: yes. End-to-end production acceptance: not yet.** Keep all next changes in one cohesive Flutter + Supabase release branch rather than multiple small PRs.
