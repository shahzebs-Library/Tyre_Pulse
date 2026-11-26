-- ERP Stores Ledger: an open stock audit covering the whole site also blocks a post (review round 3b).
-- STATUS: APPLIED LIVE 2026-11-26.
--   An audit with no locations listed covers its whole site (the same rule as inv_blind_hides_balance).
--   finish checks for an open audit too, and compares item codes upper-case and trimmed on both sides.
-- The three functions are patched in place from their live text; each patch must match exactly once.

create or replace function public._inv_erp_audit_open(p_org uuid, p_loc uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select exists (
    select 1 from public.inventory_audits au join public.inventory_locations l on l.id = p_loc
     where au.organisation_id = p_org
       and au.status in ('in_progress','counting_completed','reconciliation','recount','investigation','approval')
       and (au.location_ids @> array[p_loc]
            or (cardinality(coalesce(au.location_ids, '{}'::uuid[])) = 0
                and (au.site is null or upper(btrim(au.site)) = upper(btrim(coalesce(l.site, ''))))
                and (au.country is null or l.country is null or lower(btrim(au.country)) = lower(btrim(l.country))))))
$function$;
revoke all on function public._inv_erp_audit_open(uuid, uuid) from public, anon, authenticated;

do $do$
declare d text; n int; v_pat text := 'exists \(select 1 from public\.inventory_audits au\s+where au\.organisation_id = v_org and au\.location_ids @> array\[(v_loc\.id|v\.location_id)\]\s+and au\.status in \([^)]*\)\)';
  v_msg text := $m$
  if public._inv_erp_audit_open(v_org, v.location_id) then
    raise exception 'A stock audit is open at this store. Close it before posting an ERP ledger.' using errcode = '22023';
  end if;
$m$;
begin
  -- begin and apply: replace the location-only test with the shared one.
  foreach d in array array['inv_erp_ledger_begin', 'inv_erp_ledger_apply'] loop
    select pg_get_functiondef(('public.' || d || '(jsonb)')::regprocedure) into d;
    n := (select count(*) from regexp_matches(d, v_pat, 'g'));
    if n <> 1 then raise exception 'audit test found % times', n; end if;
    d := regexp_replace(d, v_pat, 'public._inv_erp_audit_open(v_org, \1)');
    execute d;
  end loop;
  -- finish: audit check before zeroing; normalised codes in the zero loop.
  d := pg_get_functiondef('public.inv_erp_ledger_finish(jsonb)'::regprocedure);
  if (select count(*) from regexp_matches(d, '\n  if v\.zero_missing then', 'g')) <> 1 then raise exception 'finish anchor'; end if;
  d := regexp_replace(d, '\n  if v\.zero_missing then', v_msg || E'\n  if v.zero_missing then');
  if (select count(*) from regexp_matches(d, 'select s\.id, s\.qty_on_hand, s\.qty_reserved, m\.item_code,', 'g')) <> 1 then raise exception 'finish select anchor'; end if;
  d := replace(d, 'select s.id, s.qty_on_hand, s.qty_reserved, m.item_code,', 'select s.id, s.qty_on_hand, s.qty_reserved, upper(btrim(m.item_code)) item_code,');
  execute d;
end $do$;
