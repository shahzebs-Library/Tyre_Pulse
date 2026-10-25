-- Enforce the per-module 'approve' capability on the approval writers.
-- STATUS: APPLIED LIVE 2026-10-25. Idempotent (re-run is a no-op).
-- NOTE: decide_inspection_approval's live body has CRLF line endings, so the BEGIN pattern allows an optional \r.
--
-- Semantics (additive / compatible, follows V242):
--   * REVOKE: an active user_access_grants row (capability='approve', effect='revoke')
--     for the module BLOCKS the decision (42501). Admin / super admin are never blocked
--     (app_cap_revoked already returns false for them).
--   * GRANT : an active 'grant' row for 'approve' ADDS the first-rung role gate of the
--     two legacy direct writers (decide_inspection_approval, decide_checklist_approval).
--     It does NOT bypass org isolation, the signature rule, the sign-off ladder (a
--     two-stage checklist still needs an area manager for the final rung) or the
--     governed decide_approval eligibility (approval_private.person_eligible).
--   * DEFAULT: nobody has an approve revoke today, and the existing role gates are
--     untouched, so no current approver loses access.
-- Guards are inserted into the LIVE function bodies by anchored replace of
-- pg_get_functiondef (nothing retyped); the run ABORTS if an anchor is not found
-- exactly once. Rolling back: see the bottom of this file.
set check_function_bodies = off;

create or replace function public.app_cap_granted(p_key text, p_cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when exists (select 1 from public.user_access_grants g
                  where g.user_id = auth.uid() and g.module_key = p_key and g.capability = p_cap
                    and g.effect = 'revoke' and (g.expires_at is null or g.expires_at > now())) then false
    else exists (select 1 from public.user_access_grants g
                  where g.user_id = auth.uid() and g.module_key = p_key and g.capability = p_cap
                    and g.effect = 'grant' and (g.expires_at is null or g.expires_at > now()))
  end;
$$;
revoke all on function public.app_cap_granted(text, text) from public, anon;
grant execute on function public.app_cap_granted(text, text) to authenticated;

do $do$
declare
  r record; v_oid oid; def text; nd text; n int; marker constant text := 'cap-guard:approve';
begin
  for r in select * from (values
    -- sig, module key SQL expression, optional role-gate anchor, replacement, required?
    ('public.decide_inspection_approval(uuid,text,text,text)', '''inspections''',
       'IF NOT public.is_super_admin() AND (',
       'IF NOT public.is_super_admin() AND NOT public.app_cap_granted(''inspections'',''approve'') AND (', true),
    ('public.decide_checklist_approval(uuid,text,text,text)', '''checklists''',
       'if not public.checklist_is_supervisor() then',
       'if not (public.checklist_is_supervisor() or public.app_cap_granted(''checklists'',''approve'')) then', true),
    ('approval_private.execution_decide(text,uuid,text,text,text)',
       'CASE WHEN p_type=''work_order'' THEN ''work_orders'' ELSE ''tyre_records'' END', null, null, true),
    ('public.approve_accident_closure(uuid)', '''accidents''', null, null, true),
    ('public.reject_accident_closure(uuid,text)', '''accidents''', null, null, true),
    ('public.accident_decide_closure(uuid,text,text,uuid,text,jsonb)', '''accidents''', null, null, false)
  ) as t(sig, keyexpr, anchor, repl, required)
  loop
    v_oid := to_regprocedure(r.sig);
    if v_oid is null then
      if r.required then raise exception 'approve-capability: % not found', r.sig; end if;
      raise notice 'approve-capability: optional % not present, skipped', r.sig;
      continue;
    end if;
    def := pg_get_functiondef(v_oid);
    if position(marker in def) > 0 then continue; end if;
    nd := def;
    if r.anchor is not null then
      n := (length(nd) - length(replace(nd, r.anchor, ''))) / length(r.anchor);
      if n <> 1 then
        raise exception 'approve-capability: anchor for % found % times (expected 1)', r.sig, n;
      end if;
      nd := replace(nd, r.anchor, r.repl);
    end if;
    -- first top-level BEGIN of the body: block a REVOKED approver before anything else runs
    nd := regexp_replace(nd, E'(\\n[ \\t]*)(begin)([ \\t]*\\r?\\n)',
      E'\\1\\2\\3  -- ' || marker || E'\n  if public.app_cap_revoked(' || r.keyexpr
        || E',''approve'') then\n    raise exception ''You are not permitted to approve or decide this record.'' using errcode = ''42501'';\n  end if;\n',
      'i');
    if position(marker in nd) = 0 or nd = def then
      raise exception 'approve-capability: could not place guard in %', r.sig;
    end if;
    execute nd;
  end loop;
end
$do$;

-- ROLLBACK: re-apply the previous bodies (MIGRATIONS_V602 / V606 for the inspection and
-- checklist writers, 20260910185625 for execution_decide, 20260907075433 for the accident
-- closure writers, docs/accident-module/10 for accident_decide_closure), then
--   drop function public.app_cap_granted(text, text);
