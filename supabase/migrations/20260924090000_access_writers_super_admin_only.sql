-- Access and user-management writers are super-admin only.
--
-- WHY: four SECURITY DEFINER writers admitted any plain `Admin` as well as a
-- super admin. The worst was set_module_permissions / save_access_control_matrix:
-- they write the GLOBAL (org_id IS NULL) role matrix that every organisation
-- reads, so an Admin in one company could change what "Manager" may do in every
-- company. Owner instruction (2026-09-24): all administration stays under the
-- super-admin console. Measured before applying: 0 approved users hold a plain
-- Admin role (both Admins are super admins), so nobody loses access today.
--
-- METHOD: each guard is replaced by anchored text on the LIVE definition and the
-- migration ABORTS unless the anchor is found exactly once, so a half-applied
-- boundary cannot ship. SECURITY DEFINER, search_path and grants are preserved
-- by CREATE OR REPLACE.
--
-- ROLLBACK: re-run with the replacement pairs swapped.

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_hits int;
  v_pat text;
begin
  for r in
    select * from (values
      ('set_module_permissions',
       $a$IF v_role IS DISTINCT FROM 'Admin' AND v_super IS NOT TRUE THEN RAISE EXCEPTION 'Only an Admin can change module access.'$a$,
       $b$IF v_super IS NOT TRUE THEN RAISE EXCEPTION 'Only a Super Admin can change module access.'$b$),
      ('save_access_control_matrix',
       $a$if v_role is distinct from 'Admin' and v_super is not true then raise exception 'Only an Admin can change access control.'$a$,
       $b$if v_super is not true then raise exception 'Only a Super Admin can change access control.'$b$),
      ('admin_mobile_user_action',
       $a$NOT coalesce(v_is_super OR v_caller_role = 'Admin',false)$a$,
       $b$NOT coalesce(v_is_super,false)$b$),
      ('admin_update_profile',
       $a$IF v_caller_role IS DISTINCT FROM 'Admin' AND NOT v_is_super THEN$a$,
       $b$IF NOT coalesce(v_is_super, false) THEN$b$)
    ) t(fn, anchor, repl)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_def is null then raise exception 'function % not found', r.fn; end if;

    -- whitespace-tolerant anchor: escape regex metacharacters, then let any
    -- run of whitespace in the anchor match any run of whitespace in the body
    v_pat := regexp_replace(regexp_replace(r.anchor, '([.()*+?\[\]{}|^$\\])', '\\\1', 'g'), '\s+', '\\s+', 'g');
    select count(*) into v_hits from regexp_matches(v_def, v_pat, 'g');
    if v_hits <> 1 then
      raise exception 'anchor for % found % times, expected 1', r.fn, v_hits;
    end if;
    v_new := regexp_replace(v_def, v_pat, r.repl);
    execute v_new;
  end loop;
end $$;
