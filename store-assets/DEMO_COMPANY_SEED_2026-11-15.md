# Demo company sample data, 2026-11-15

Synthetic sample rows added to the store reviewer demo organisation only, with the owner's approval.
Supabase project `jhssdmeruxtrlqnwfksc`. Applied with `execute_sql` (INSERT only, no DDL, no UPDATE or DELETE statements).

- Demo organisation: **Tyre Pulse Demo Fleet**, id `a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7`
- Demo user: `demo.manager` (Manager), id `c2f9a806-1d9c-4c3a-9a38-0bd7fefb087e`
- Country `KSA`, sites `DEMO YARD` and `DEMO PLANT`, assets `DEMO-TM01`, `DEMO-TM02`, `DEMO-PM01`, `DEMO-PL01`
- Every inserted row has a fixed id starting `de300000-0000-4000-8000-0000000000`. All names are invented
  (Demo Manager, Demo Driver 1 to 3, Demo Technician 1 and 2, Demo Workshop, Demo Brand A to C).

## What was inserted

| Table | Rows | Ids (last 3 digits of `de300000-0000-4000-8000-000000000NNN`) | Content |
|---|---|---|---|
| `checklist_templates` | 2 | 101, 102 | Published: "Daily Vehicle Check" (prefix DVC, 16 fields), "Workshop Daily Checklist" (prefix DWC, 17 fields). No role restriction, no approval, no required signature |
| `checklist_submissions` | 3 | 201, 202, 203 | DVC-DEMO-TM01-2026-0001, DVC-DEMO-PL01-2026-0001, DWC-DEMO-PM01-2026-0001. Status submitted, approval not required, no "Not OK" answers |
| `stock_records` | 7 | 401 to 407 | 4 at DEMO YARD, 3 at DEMO PLANT. 3 OK, 2 Low, 2 Critical |
| `pm_programs` | 3 | 301, 302, 303 | DEMO-PM01 overdue (due 2026-10-20, 3,100 h), DEMO-TM01 due soon (2026-11-25), DEMO-PL01 fine (2027-03-10, 125,000 km) |
| `pm_service_records` | 2 | 311, 312 | Past services for plans 301 and 303 |
| `odometer_logs` | 12 | 501 to 512 | 3 readings per vehicle, 10, 12 and 14 Nov 2026, source Mobile, none flagged |
| `engine_hours_logs` | 9 | 601 to 609 | 3 readings each for DEMO-PM01, DEMO-TM01, DEMO-TM02, none flagged |
| `wash_records` | 5 | 701 to 705 | Completed washes 8 to 14 Nov 2026, cost 0 |
| `corrective_actions` | 3 | 801, 802, 803 | High Open (linked to demo inspection `25d08c3c-e021-4296-ae67-9794b1071415`), Medium In Progress, Low Open |

Total: 46 rows inserted directly.

## Rows the database created by itself (trigger side effects, all in the demo organisation)

- `checklist_template_revisions`: 2 rows (template_id 101 and 102, version 1).
- `checklist_doc_counters`: 3 rows (DVC / DEMO-TM01, DVC / DEMO-PL01, DWC / DEMO-PM01, year 2026).
- `action_items`: 3 rows mirroring the corrective actions, ids
  `4ca628d4-cc57-4576-98b2-ccffa0f2a7cd`, `c69050a3-2d3d-4f3e-92b5-be9af155177c`, `1e93c0e0-77e7-4448-bc1a-c4ca1e9983f8`
  (source `corrective:<corrective action id>`).
- `domain_events`: 3 `corrective_action.created` events for the demo organisation. No active workflow, rule or
  webhook listens to that event, so nothing was sent.
- `audit_log_v2`: audit rows for the stock, corrective action and fleet changes.
- `vehicle_fleet.current_km` of the 4 demo vehicles moved forward to the newest odometer reading, as the app
  does for any meter log:

| Asset | Before | After |
|---|---|---|
| DEMO-TM01 | 84210 | 84990 |
| DEMO-TM02 | 61350 | 62070 |
| DEMO-PM01 | 42800 | 43120 |
| DEMO-PL01 | 120400 | 121230 |

## Verification

- Row counts per organisation were taken before and after. Company A counts did not change on any table:
  checklist_templates 12, checklist_submissions 133, checklist_template_revisions 18, stock_records 36,
  odometer_logs 2550 (plus 371 with no organisation), engine_hours_logs 5713, wash_records 263,
  corrective_actions 177, action_items 177, vehicle_fleet 1618.
- `notifications` stayed at 17262 and `workflow_notifications` at 4965. `workflow_instances` stayed at 53.
- No fleet row outside the demo organisation was updated.
- Read as `demo.manager` (RLS on): 2 published templates, 3 submissions, 7 stock, 3 PM plans, 2 service
  records, 12 odometer, 9 engine hours, 5 washes, 3 corrective actions. Nothing from another organisation.
- Each insert was first run inside a transaction that was rolled back.

## Notes

- The hourly due-alert scan may raise in-app notices (low stock, PM due) for `demo.manager` only. It is the
  only user in the demo organisation.
- The two "Daily Vehicle Check" answers carry an odometer slightly below the later meter readings
  (84150 and 120380). Cosmetic only.
- Not added: `alerts` (the Flutter Alerts screen is built from tyre risk, not this table) and extra
  inspections (an inspection insert queues AI photo work and approval pushes).

## Undo SQL (NOT run, needs the owner's approval)

```sql
begin;

-- 1. Rows inserted directly
delete from public.corrective_actions      where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and id::text like 'de300000-0000-4000-8000-0000000008%';
delete from public.wash_records            where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and id::text like 'de300000-0000-4000-8000-0000000007%';
delete from public.engine_hours_logs       where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and id::text like 'de300000-0000-4000-8000-0000000006%';
delete from public.odometer_logs           where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and id::text like 'de300000-0000-4000-8000-0000000005%';
delete from public.stock_records           where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and id::text like 'de300000-0000-4000-8000-0000000004%';
delete from public.pm_service_records      where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and id::text like 'de300000-0000-4000-8000-00000000031%';
delete from public.pm_programs             where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and id::text like 'de300000-0000-4000-8000-00000000030%';
delete from public.checklist_submissions   where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and id::text like 'de300000-0000-4000-8000-0000000002%';

-- 2. Trigger side effects
delete from public.action_items            where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7'
  and id in ('4ca628d4-cc57-4576-98b2-ccffa0f2a7cd','c69050a3-2d3d-4f3e-92b5-be9af155177c','1e93c0e0-77e7-4448-bc1a-c4ca1e9983f8');
delete from public.checklist_doc_counters  where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and prefix in ('DVC','DWC') and year = 2026;
delete from public.checklist_template_revisions where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7'
  and template_id in ('de300000-0000-4000-8000-000000000101','de300000-0000-4000-8000-000000000102');
delete from public.checklist_templates     where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7'
  and id in ('de300000-0000-4000-8000-000000000101','de300000-0000-4000-8000-000000000102');

-- 3. Put the demo odometers back (only if they still hold the seeded value)
update public.vehicle_fleet set current_km = 84210  where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and asset_no = 'DEMO-TM01' and current_km = 84990;
update public.vehicle_fleet set current_km = 61350  where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and asset_no = 'DEMO-TM02' and current_km = 62070;
update public.vehicle_fleet set current_km = 42800  where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and asset_no = 'DEMO-PM01' and current_km = 43120;
update public.vehicle_fleet set current_km = 120400 where organisation_id = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7' and asset_no = 'DEMO-PL01' and current_km = 121230;

-- Check the counts, then commit or rollback
commit;
```

Undo cautions:
- Run it in a transaction and check the row counts (46 direct rows, 3 action items, 3 counters, 2 revisions, 2 templates) before commit.
- A delete on `checklist_template_revisions`, `action_items` or `corrective_actions` may be refused by a guard
  trigger or a history rule. If so, stop and review rather than disabling a trigger.
- A delete in the Supabase MCP asks for confirmation and times out at 60 seconds if nobody answers. Run it
  from the SQL editor.
- If the reviewer or the owner has added records against the two demo templates or plans since, delete those
  first or leave the parents in place.
- The 3 `domain_events` rows and the audit rows are history and are left as they are.
