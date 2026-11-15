-- ROLLBACK for 20261115141500_wo_cost_approval_not_collector.sql
--
-- STATUS: AUTHORED, NOT APPLIED. Rehearsed on a local copy of the staging database (tp_runbook):
--         apply, verify, this rollback, then a fingerprint (pg_get_functiondef md5 and ACL of
--         approval_private.person_eligible) equal to the one taken before the apply. See
--         docs/commercial-readiness/RELEASE_RUNBOOK_519_520.md, step 5.
-- EFFECT: the exact reverse of the anchored replacement: the work_order branch is removed, so a
--         Tyre Data Collector is again an eligible approver for work orders. No row is touched.
-- Contains neither "drop" nor "delete".

begin;

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
  if position(v_new in v_def) = 0 then
    raise notice 'approval_private.person_eligible does not carry the work_order branch; nothing to change';
    return;
  end if;
  v_count := (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new);
  if v_count <> 1 then
    raise exception 'Rollback aborted: work_order branch found % times; nothing changed', v_count;
  end if;
  execute replace(v_def, v_new, v_old);
end
$do$;

commit;
