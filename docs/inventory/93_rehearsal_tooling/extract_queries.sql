-- READ-ONLY extraction queries run on production (jhssdmeruxtrlqnwfksc) on 2026-11-20 through the
-- Supabase MCP execute_sql. SELECT only. Results were saved to files by the MCP client and never
-- committed. PII is replaced server-side before it leaves the database (profiles, report_schedules,
-- organisations) and secret-looking system_config keys are excluded.

-- 1. Function closure: every function the 16 migrations call or rewrite, the trigger functions of the
--    27 seed tables, functions named in their policies / defaults / checks / views, and everything
--    those functions call (word-level edges, recursive). 156 functions, 142 kB of source.
--    Output columns: fn, args, prosrc_md5, def_md5, acl, owner, def (pg_get_functiondef).
with recursive
fns as (select p.oid, n.nspname, p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private','approval_private','anum_integration','auth') and p.prokind in ('f','p')),
fname as (select distinct proname from fns),
edges as (select distinct f.oid src, w.word from fns f,
          lateral (select distinct lower(x) word from regexp_split_to_table(f.prosrc, '[^A-Za-z0-9_]+') x) w
          where w.word in (select proname from fname)),
seedt(t) as (select unnest(array['approval_policies','custom_roles','goods_receipts','material_issue_lines','material_issues',
  'material_master','materials','metric_registry','metric_versions','organisations','parts_consumption','profiles','purchase_orders',
  'report_schedules','requisitions','sites','stock','stock_entry_requests','stock_movements','stock_records','suppliers','tyre_records',
  'tyre_status_marks','work_order_stock_reservation_lines','work_order_stock_reservations','work_orders','workflow_instances',
  'v_stock_balance_reconcile'])),
seedtext(x) as (
  select coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||' '||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'')
    from pg_policy pol join pg_class c on c.oid=pol.polrelid where c.relnamespace='public'::regnamespace and c.relname in (select t from seedt)
  union all select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_class c on c.oid=d.adrelid
    where c.relnamespace='public'::regnamespace and c.relname in (select t from seedt)
  union all select pg_get_viewdef(c.oid) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in (select t from seedt) and c.relkind='v'
  union all select pg_get_constraintdef(co.oid) from pg_constraint co join pg_class c on c.oid=co.conrelid
    where c.relnamespace='public'::regnamespace and c.relname in (select t from seedt) and co.contype='c'),
seedwords as (select distinct lower(y) w from seedtext s, regexp_split_to_table(s.x,'[^A-Za-z0-9_]+') y),
seedf as (
  select f.oid from fns f where f.nspname||'.'||f.proname = any(array['anum_integration.apply_reader_policies','approval_private.context',
    'approval_private.document','approval_private.resolve','approval_private.validate_policy','auth.uid','auth.role','auth.jwt',
    'private.release_work_order_stock_internal','private.reserve_work_order_stock_internal','public.app_country_scope','public.app_current_org',
    'public.app_is_active','public.app_is_elevated','public.app_sees_all_countries','public.app_sees_all_sites','public.app_site_scope',
    'public.app_user_can','public.app_write_country_ok','public.currency_for_country','public.get_my_role','public.is_approved_and_unlocked',
    'public.is_super_admin','public.post_stock_movement','public.save_stock_entry','public.set_stock_count','public.transfer_stock_entry',
    'public.tyre_serial_is_strong','public.reserve_work_order_stock','public.release_work_order_stock','public.app_role'])
  union select t.tgfoid from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where not t.tgisinternal and c.relnamespace='public'::regnamespace and c.relname in (select t from seedt)
  union select f.oid from fns f join seedwords s on s.w=f.proname),
clos(oid) as (select oid from seedf union select f2.oid from clos c join edges e on e.src=c.oid join fns f2 on f2.proname=e.word)
select f.nspname||'.'||f.proname as fn, pg_get_function_identity_arguments(f.oid) args,
       md5(replace(f.prosrc,chr(13),'')) prosrc_md5, md5(replace(pg_get_functiondef(f.oid),chr(13),'')) def_md5,
       (select p.proacl::text from pg_proc p where p.oid=f.oid) acl, (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid=f.oid) owner,
       pg_get_functiondef(f.oid) def
  from clos c join fns f on f.oid=c.oid order by 1,2;

-- 2. Relation parts for the 27 seed relations plus the 46 support tables the closure functions read
--    (73 relations): columns (type, not null, default, generated, identity, column ACL), constraints,
--    indexes, policies, triggers, ACL, owner, RLS flags, view definition. Query text: see the
--    session log; it is a straight catalog read (pg_class, pg_attribute, pg_attrdef, pg_constraint,
--    pg_index, pg_policy, pg_trigger) emitting one json row per relation.

-- 3. Sanitized data (one json array per table): stock_records (43), stock_movements (78),
--    approval_policies (3), custom_roles, organisations (contact_email/logo/notes nulled),
--    profiles (username, full_name, employee_id, email replaced by md5-derived tokens; phone,
--    push token, recovery fields, notes nulled), module_permissions, user_access_grants, sites,
--    site_aliases, country_currency, store_site_map, settings, app_settings, organisation_settings,
--    modules, subscription_plans, org_subscriptions, metric_registry, metric_versions,
--    report_schedules (recipients replaced), system_config (keys matching key|secret|token|password|
--    dsn|webhook|smtp|email|phone|url excluded), tyre_status_marks (all), tyre_records (every row of a
--    serial that has a status mark: 1,029), parts_consumption (latest 500), material_master (400 by id),
--    workflow_instances, stock_entry_requests; plus anum_integration.reader_tables (28 names).

-- 4. Environment reads: version(), pg_extension, pg_roles + pg_auth_members, pg_db_role_setting,
--    pg_default_acl, pg_namespace ACLs, pg_database owner/ACL, pg_settings (search_path,
--    max_locks_per_transaction, statement_timeout, check_function_bodies).
