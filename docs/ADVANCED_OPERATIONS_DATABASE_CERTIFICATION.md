# Advanced Operations database certification

Migration: `supabase/migrations/20260830181348_advanced_operational_workflow.sql`

Do not certify this workflow from source review alone. Apply it first to an isolated
Supabase branch or staging project, then run the checks below with two real test
organisations and three users: operator A, supervisor A, and operator B.

## Required deployment checks

1. Run `npx supabase db push --dry-run` and review the generated plan.
2. Apply to staging, refresh PostgREST's schema cache, and run Database advisors.
3. Confirm `action_items`, `action_item_history`, and `shift_handovers` appear in
   `supabase_realtime`, without adding objects to the locked `realtime` schema.
4. Subscribe as operator A with an `organisation_id` filter. Confirm an update in
   organisation A arrives and one in organisation B does not.
5. Run the tenant and transition matrix below. Every forbidden operation must fail,
   not merely return an unexpected row count.

## SQL inventory checks (database owner)

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('action_items','action_item_history','shift_handovers','shift_handover_items');

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('action_items','action_item_history','shift_handovers','shift_handover_items')
order by tablename, policyname;

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('action_items','action_item_history','shift_handovers');

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('action_items','action_item_history','shift_handovers','shift_handover_items')
order by tablename, indexname;
```

## Authenticated certification matrix

Use normal Supabase clients carrying each user's access token; never use the
service-role key for these tests.

| Test | Expected |
|---|---|
| Operator A selects organisation A items/history/handovers | Rows visible |
| Operator B selects known IDs from organisation A | Zero rows |
| Operator B updates or links an organisation A item | Rejected/zero rows |
| Anonymous role selects or mutates any workflow table | Rejected |
| Client inserts directly into `action_item_history` | Permission denied |
| Operator moves `open -> resolved` | Constraint/transition error |
| Operator moves `open -> acknowledged -> in_progress -> resolved` with resolution | Success; one history event per transition |
| Operator blocks without a reason | Constraint error |
| Operator escalates without a reason | Constraint error |
| Operator resolves a `pending_approval` item | Permission denied |
| Manager/Admin/Director resolves a `pending_approval` item | Success; approver and timestamp recorded |
| Operator changes `organisation_id` | Permission denied |
| Operator adds an organisation B item to organisation A handover | Permission denied |
| Non-owner edits a draft handover | Permission denied unless supervisor |
| History row update/delete | Permission denied |
| Operator deletes an action item | Permission denied; dismiss it instead |

## Integrity and performance checks

```sql
-- Must return zero.
select count(*) as invalid_links
from public.shift_handover_items hi
join public.shift_handovers h on h.id = hi.handover_id
join public.action_items a on a.id = hi.action_item_id
where h.organisation_id is distinct from a.organisation_id;

-- Must return zero after workflow traffic.
select count(*) as missing_history
from public.action_items a
where not exists (
  select 1 from public.action_item_history h where h.action_item_id = a.id
);

-- Inspect plans: tenant + active filters should use the new partial indexes.
explain (analyze, buffers)
select id, status, priority_score, sla_due_at
from public.action_items
where organisation_id = '<staging-org-uuid>'::uuid
  and assigned_user_id = '<staging-user-uuid>'::uuid
  and status not in ('resolved','dismissed')
order by sla_due_at nulls last
limit 50;
```

Certification is complete only after recording the staging project, migration
hash, tester identities/roles, date, query output, advisor output, and evidence
that cross-tenant reads, writes, Realtime events, and handover links are blocked.

## Stock reservation concurrency certification

Create one work order and stock row in organisation A, then use two authenticated
clients to call `reserve_work_order_stock` concurrently for more than the available
combined quantity. Exactly one call may succeed; stock must never become negative.
Repeat the successful call with the same idempotency key: it must return the same
reservation with `idempotent: true` and must not deduct stock twice. Confirm that:

- a user from organisation B cannot reserve organisation A's work order or stock;
- a second active reservation for the same work order is rejected;
- `release_work_order_stock` restores each line exactly once;
- a repeated release returns `released: false` and does not increase stock;
- authenticated clients can read their tenant's reservations but cannot directly
  insert, update, or delete reservation headers or lines.
