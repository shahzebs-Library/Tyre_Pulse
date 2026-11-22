-- =============================================================================
-- supabase/fixtures/demo_fleet_inventory_accounts.sql
-- Purpose : bind the three acceptance-test sign-ins to "Tyre Pulse Demo Fleet",
--           give the two Store Keepers their stock capabilities, and start the
--           three fixture audits with Store Keeper A as the counter.
-- Run     : AFTER demo_fleet_inventory_acceptance.sql, and AFTER the owner has
--           created the three sign-ins (docs/inventory/92 "Test accounts"):
--             demo.storekeeper.a@users.tyrepulse.app   -> Store Keeper A
--             demo.storekeeper.b@users.tyrepulse.app   -> Store Keeper B
--             demo.nostock@users.tyrepulse.app         -> account WITHOUT stock
--           No password is in this file; the owner sets them.
-- Safety  :
--   * Refuses unless ALL three sign-ins exist. Each must be either a brand-new,
--     never-approved sign-up (role Reporter, approved = false, username = the
--     email name, created in the last 30 days) or already bound to the Demo
--     company by an earlier run. An approved account in any other company is
--     never moved.
--   * Adds a Demo-company "Store Keeper" custom role and copies the global Store
--     Keeper module rows (web + phone) to the Demo company (a custom role in a
--     non-legacy company reads only its own company's matrix).
--   * Profile changes are made as the platform owner (super admin claim) so the
--     privileged-column guard trigger stays ENABLED.
--   * Stock grants and audits are Demo-only; the same exact in-progress-row
--     guard as the fixture rolls everything back if a row outside the Demo
--     company was written.
-- Idempotent: re-running changes nothing.
-- =============================================================================
do $acc$
declare
  c_org   constant uuid := 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7';
  c_mgr   constant uuid := 'c2f9a806-1d9c-4c3a-9a38-0bd7fefb087e';
  c_owner constant uuid := 'd2d43a5f-0906-4f7a-9577-e36d89164914';
  c_run   constant text := 'r1';
  c_tag   constant text := 'demo_fleet_inventory_acceptance';
  k       text := 'demo-inv-acc:' || c_run || ':';
  r record; v_p public.profiles%rowtype; v_ska uuid; v_skb uuid; v_nos uuid; v_missing text := '';
  v_aud record; v_t text; v_col text; v_n int; v_bad text := '';
  v_epoch bigint := (txid_current() >> 32) * 4294967296;
  v_xid0  bigint := txid_current() % 4294967296;
begin
  if (select name from public.organisations where id = c_org) is distinct from 'Tyre Pulse Demo Fleet' then
    raise exception 'Demo company not found - refusing.';
  end if;

  for r in select * from (values
      ('demo.storekeeper.a@users.tyrepulse.app', 'demo.storekeeper.a', 'Demo Store Keeper A', 'Store Keeper'),
      ('demo.storekeeper.b@users.tyrepulse.app', 'demo.storekeeper.b', 'Demo Store Keeper B', 'Store Keeper'),
      ('demo.nostock@users.tyrepulse.app',       'demo.nostock',       'Demo user without stock', 'Reporter')) x(email, uname, fname, role) loop
    select p.* into v_p from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = r.email;
    if v_p.id is null then v_missing := v_missing || r.email || ' '; continue; end if;
    if not (v_p.organisation_id = c_org and v_p.org_id = c_org) then
      -- must be an untouched, never-approved self sign-up
      if v_p.approved or coalesce(v_p.is_super_admin, false) or v_p.role is distinct from 'Reporter'
         or (select created_at from auth.users where id = v_p.id) < now() - interval '30 days' then
        raise exception '% exists but is not a fresh pending sign-up (approved=%, role=%) - refusing to move it.',
          r.email, v_p.approved, v_p.role;
      end if;
    end if;
    if r.uname = 'demo.storekeeper.a' then v_ska := v_p.id;
    elsif r.uname = 'demo.storekeeper.b' then v_skb := v_p.id; else v_nos := v_p.id; end if;
    v_p := null;
  end loop;
  if v_missing <> '' then
    raise exception 'Create these sign-ins first (Authentication > Add user, auto-confirm): %', v_missing;
  end if;

  -- the Store Keeper role is a per-company custom role; the Demo company needs its own row,
  -- or normalize_profiles_role() silently turns the role into Reporter
  insert into public.custom_roles(organisation_id, name, description, active)
  select c_org, 'Store Keeper', 'Stores and stock counting (Demo company, acceptance tests).', true
   where not exists (select 1 from public.custom_roles where organisation_id = c_org and lower(btrim(name)) = 'store keeper');
  -- a custom role in a non-legacy company reads only ITS company's module matrix
  -- (_global_matrix_applies), so copy the global Store Keeper web + phone module rows to the Demo company
  insert into public.module_permissions(module_key, role, org_id, enabled, updated_at)
  select g.module_key, g.role, c_org, g.enabled, now()
    from public.module_permissions g
   where g.role = 'Store Keeper' and g.org_id is null
     and not exists (select 1 from public.module_permissions d where d.role = g.role
                       and d.module_key = g.module_key and d.org_id = c_org);

  -- profile changes as the platform owner (keeps trg_guard_profile_privileged enabled)
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', c_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  if not public.is_super_admin() then raise exception 'Owner super-admin claim not accepted - refusing.'; end if;
  update public.profiles p set org_id = c_org, organisation_id = c_org, role = x.role, username = x.uname,
         full_name = x.fname, country = array['KSA'], sites = array['DEMO YARD','DEMO PLANT'], approved = true
    from (values (v_ska, 'demo.storekeeper.a', 'Demo Store Keeper A', 'Store Keeper'),
                 (v_skb, 'demo.storekeeper.b', 'Demo Store Keeper B', 'Store Keeper'),
                 (v_nos, 'demo.nostock', 'Demo user without stock', 'Reporter')) x(id, uname, fname, role)
   where p.id = x.id
     and (p.org_id, p.organisation_id, p.role, p.username, p.full_name, p.country, p.sites, p.approved)
         is distinct from (c_org, c_org, x.role, x.uname, x.fname, array['KSA'], array['DEMO YARD','DEMO PLANT'], true);
  perform set_config('request.jwt.claims', '', true);

  -- stock capabilities: Store Keepers receive/issue/transfer/count; no-stock account explicitly revoked
  insert into public.user_access_grants(org_id, user_id, module_key, capability, effect, granted_by, note)
  select c_org, u, 'stock', cap, 'grant', c_owner, c_tag
    from unnest(array[v_ska, v_skb]) u, unnest(array['receive','issue','transfer','count']) cap
  on conflict (user_id, module_key, capability, effect) do nothing;
  insert into public.user_access_grants(org_id, user_id, module_key, capability, effect, granted_by, note)
  select c_org, v_nos, m, 'view', 'revoke', c_owner, c_tag
    from unnest(array['stock','mobile:stock','mobile:stockManage']) m
  on conflict (user_id, module_key, capability, effect) do nothing;

  -- assign Store Keeper A and start the fixture audits, as demo.manager (counter may not start own audit)
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', c_mgr, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if public.app_current_org() is distinct from c_org then raise exception 'demo.manager session not in Demo - refusing.'; end if;
  for v_aud in select id, status, substr(instructions, length('[demo-acceptance ' || c_run || '] ') + 1, 1) letter
                 from public.inventory_audits
                where organisation_id = c_org and instructions like '[demo-acceptance ' || c_run || '] _ %'
                order by instructions loop
    if v_aud.status = 'draft' then
      perform public.inv_audit_schedule(jsonb_build_object('idempotency_key', k || 'sched:' || v_aud.letter,
        'audit_id', v_aud.id, 'counter_id', v_ska, 'due_at', (now() + interval '14 days')::text));
    end if;
    if (select status from public.inventory_audits where id = v_aud.id) in ('assigned','scheduled') then
      perform public.inv_audit_start(jsonb_build_object('idempotency_key', k || 'start:' || v_aud.letter,
        'audit_id', v_aud.id));
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);

  -- FINAL GUARD: nothing written by this transaction outside the Demo company
  for v_t, v_col in select * from (values
      ('stock_records','organisation_id'), ('stock_movements','organisation_id'), ('inventory_audits','organisation_id'),
      ('inventory_audit_snapshot_lines','organisation_id'), ('inventory_rpc_requests','organisation_id'),
      ('inventory_locations','organisation_id'), ('tyre_items','organisation_id'),
      ('profiles','organisation_id'), ('profiles','org_id'), ('user_access_grants','org_id'),
      ('custom_roles','organisation_id'), ('module_permissions','org_id')) x(t, c) loop
    execute format('select count(*) from public.%I where %I is distinct from $1
                     and (case when xmin::text::bigint >= $3
                               then pg_xact_status(($2 + xmin::text::bigint)::text::xid8) end) = %L',
                   v_t, v_col, 'in progress')
       into v_n using c_org, v_epoch, v_xid0;
    if v_n > 0 then v_bad := v_bad || v_t || '.' || v_col || '=' || v_n || ' '; end if;
  end loop;
  if v_bad <> '' then
    raise exception 'Isolation guard: rows written outside the Demo company (%). Rolled back.', v_bad;
  end if;
end
$acc$;
