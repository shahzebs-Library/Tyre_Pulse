# Security rollout - status 2026-11-08

Reviewed against the live database and rolled out where still needed:

| Item | Status |
|---|---|
| `20260907075433_serialize_accident_closure_and_claim_registration.sql` | Already applied live (2026-09-07). |
| `20260909074840_atomic_recovery_limits.sql` | APPLIED 2026-11-08 as `supabase/migrations/20261108143000_atomic_recovery_limits.sql`. Verified: 5 attempts per code, 5 codes per requester/destination per 15 min, service-role only. |
| `functions/account-recovery` | DEPLOYED 2026-11-08 (v9, verify_jwt=false). Copied to `supabase/functions/account-recovery`. |
| `functions/billing-webhook` | DEPLOYED 2026-11-08 (v12, verify_jwt=false). Copied to `supabase/functions/billing-webhook`. Returns 503 until STRIPE_WEBHOOK_SECRET is set (billing not live). |
| `20260909075034_enforce_fleet_capabilities_and_chunk_scope.sql` | NOT APPLIED on purpose: superseded. Since 2026-09-30 `vehicle_fleet` writes are allowed only by the capability policies (`vehicle_fleet_cap_*`), and `document_chunks` has no read policy at all (deny-all), so both guards would be no-ops. |

Anonymous `get_email_by_identifier` was narrowed on 2026-11-08 (20261108130000) to return only
`@users.tyrepulse.app` addresses; real-email sign-in goes through the `sign-in` edge function.
