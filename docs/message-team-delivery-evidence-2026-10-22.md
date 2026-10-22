# Message the Team — delivery, evidence and deep-link implementation (2026-10-22)

## Scope
Production mobile application: Flutter only. Web reporting: existing Message the Team panel. Supabase: existing Tyre_pulse project.

## Implemented in this branch
1. Per-user mobile-observed FCM events in `team_push_device_events`. The signed-in Flutter client records `received_foreground` when an FCM message reaches the active app and `opened_by_user` on notification tap. Conflict key makes repeats idempotent. RLS restricts insertion to self, and broadcast sender may see events only for their own broadcast. Manager engagement panel displays distinct employee counts for observed foreground and opened events. **Not an OS delivery guarantee**: FCM HTTP v1 acceptance, a background notification shown by OS, and an actual tap are three different stages. Offline devices do not report receipt until they communicate with the backend; currently an offline event can be lost.
2. Task evidence remains in the private Supabase bucket `team-action-evidence` with employee/action-aware RLS and 10MB MIME allowlist. Flutter now lists uploaded evidence and obtains 60-second signed URLs to open attachments via `url_launcher`. Existing Flutter image picker uploads compressed gallery JPG images. **PDF and arbitrary document picking is not yet implemented**, because the current Flutter dependency set does not include a cross-platform document-picker plugin. This branch does not misrepresent that as complete.
3. Flutter push tap for `broadcast.sent` or `action.assigned` now carries target type/UUID as route query parameters to the signed-in notifications inbox. The inbox matches an authorized notification row, then opens the exact broadcast acknowledgment dialog or assigned-task dialog. Broadcast send SQL now includes `entity_id` in the push payload. Unknown/unmatched notifications still show the inbox instead of an unauthorized/blank record.
4. Added `team_message_push_routing_test.dart` to cover type and entity ID resolution to the inbox. Full CI suite and device tests have not been run by this connector-only session.

## Live Supabase migrations executed
- `team_push_device_events` (audit table + RLS)
- `broadcast_push_target_entity_id` (broadcast sender RPC includes entity_id)
- `team_broadcast_sender_push_event_visibility` (sender read policy)
All migration SQL files are included under `supabase/migrations/` in this branch.

## Distinguish status accurately
- **Provider accepted**: FCM HTTP v1 returned success; does not guarantee displayed to device.
- **Foreground received**: app called listener on signed-in device and later persisted event.
- **Opened**: app handled notification tap and later persisted event.
- **Read/acknowledged**: employee performed a separate action inside the app.
- **OS background displayed**: cannot be independently guaranteed by FCM HTTP v1; no invented delivered state.

## Operator checks after merge
- Send broadcast and task assignment to a signed-in Flutter test user.
- Verify `team_push_device_events` rows after foreground receipt and notification tap; manager web dashboard displays counts.
- Verify killed/background app opens correct message/task via push and auth redirects.
- Upload JPG, reopen the evidence attachment using temporary signed URL, test a different employee and another org for access denial.
- Device iOS configuration/APNs and full Flutter/web test suite are separate owner-side checks.
