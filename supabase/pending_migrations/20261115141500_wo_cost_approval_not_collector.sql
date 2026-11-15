-- WO-4: a Tyre Data Collector is not an approver of work order scope and cost.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-15 from the LIVE body of
--         approval_private.person_eligible (read only). Applied only to a private copy of the local
--         staging database (tp_wo3, synthetic companies) by
--         supabase/tests/staging_work_order_permissions.sh. NEEDS THE OWNER'S YES.
--
-- DEPENDS ON: nothing (independent of 20261115140000 / 140500 / 141000; kept in that series
--   because it is the same owner decision). Apply after 20261115141000.
--
-- OWNER DECISION (2026-11-15, round 2)
--   Tyre Data Collectors may create, update, document and perform assigned quality checks on work
--   orders, but must NOT have unrestricted cost approval, record deletion or final closure.
--   Deletion and final closure are enforced in 20261115140000 / 140500. This file is the cost
--   approval part.
--
-- WHAT WAS FOUND ON PRODUCTION (read only)
--   approval_private.person_eligible(user, company, type, country, site) decides who MAY be an
--   approver in the approval engine. Its role list for every type except inspections is written
--   inside the function and includes 'Tyre Data Collector'. So an approval policy for work orders
--   could name a collector (or resolve to one by role) and that person could approve a work
--   order's scope and cost. Today nothing does: approval_policies holds 3 drafts and none is
--   published, approval_execution_requests is empty, and no work order carries an approval.
--   The Access Control switch "work_orders approve = on" stored for the role in every company is
--   only read as a per-user REVOKE check (app_cap_revoked); it grants nothing by itself.
--
-- WHAT THIS CHANGES
--   For p_type = 'work_order' the eligible role list no longer contains 'Tyre Data Collector'.
--   Inspections, checklists and tyre changes are untouched (not part of this decision; the
--   collector stays eligible there). Admin, super admin and the supervisor roles are untouched.
--   The live function text is read with pg_get_functiondef and ONE list is replaced; the migration
--   aborts unless that exact list is found exactly once, so a newer body is never overwritten.
--   No stored row is changed: no approval, no decision, no cost. (There are none to change.)
--
-- VERIFY (rolled back, after applying)
--   begin;
--   select position('WHEN p_type=''work_order'' THEN ARRAY[''Admin''' in prosrc) > 0
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'approval_private' and p.proname = 'person_eligible';              -- t
--   -- for an approved Tyre Data Collector <id> of company <org>:
--   --   select approval_private.person_eligible('<id>', '<org>', 'work_order', null, null);   -- f
--   --   select approval_private.person_eligible('<id>', '<org>', 'checklist', null, null);    -- as before
--   rollback;
--
-- ROLLBACK
--   Run this file's DO block with the two strings swapped (v_new for v_old), or re-create the
--   function from the body kept in _bak.wo4_person_eligible_20261115 (column def).

begin;

create schema if not exists _bak;
create table if not exists _bak.wo4_person_eligible_20261115 as
  select now() as saved_at, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'approval_private' and p.proname = 'person_eligible';
revoke all on _bak.wo4_person_eligible_20261115 from public, anon, authenticated;

do $do$
declare
  v_def text;
  v_old constant text :=
    $s$ELSE ARRAY['Admin','Maintenance Supervisor','Workshop Supervisor','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector'] END$s$;
  v_new constant text :=
    $s$WHEN p_type='work_order' THEN ARRAY['Admin','Maintenance Supervisor','Workshop Supervisor','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager']
   ELSE ARRAY['Admin','Maintenance Supervisor','Workshop Supervisor','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector'] END$s$;
  v_count int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'approval_private' and p.proname = 'person_eligible';
  if v_def is null then
    raise exception 'approval_private.person_eligible was not found; nothing changed';
  end if;
  if position($s$WHEN p_type='work_order' THEN ARRAY['Admin'$s$ in v_def) > 0 then
    raise notice 'approval_private.person_eligible already excludes the collector for work orders';
    return;
  end if;
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'approval_private.person_eligible is not the body this draft was written against (role list found % times); nothing changed', v_count;
  end if;
  execute replace(v_def, v_old, v_new);
end
$do$;

commit;
