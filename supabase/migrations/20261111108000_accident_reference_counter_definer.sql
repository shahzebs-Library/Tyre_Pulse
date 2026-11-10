-- 20261111108000_accident_reference_counter_definer
-- Codex review on PR #482 (correct): accident_derive_fields() is SECURITY INVOKER and accidents
-- carry RESTRICTIVE country isolation, so the max(reference_no) a country-scoped user computed
-- only saw their own country. They could pick a number another country already holds, and the
-- new (organisation_id, reference_no) unique index would refuse their report.
-- Fix: the number comes from public.next_accident_reference(), SECURITY DEFINER with a pinned
-- search_path, which reads every case of the org. It returns only an integer, takes the
-- per-org-per-year advisory lock itself, and refuses to number another organisation for a
-- signed-in caller who is not a super admin. Authorization of the accident INSERT is unchanged.
-- Rollback: re-run 20261111103000's body (inline max) and drop the function.
create or replace function public.next_accident_reference(p_org uuid, p_year text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v int;
begin
  if p_year !~ '^\d{4}$' then
    raise exception 'invalid year' using errcode = '22023';
  end if;
  if auth.uid() is not null and not public.is_super_admin()
     and p_org is distinct from public.app_current_org() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('accident_ref|' || coalesce(p_org::text, '') || '|' || p_year));
  select coalesce(max(substring(reference_no from '^ACC-' || p_year || '-(\d+)$')::int), 0) + 1
    into v
    from public.accidents
   where organisation_id is not distinct from p_org
     and reference_no like 'ACC-' || p_year || '-%';
  return v;
end $$;
revoke execute on function public.next_accident_reference(uuid, text) from public, anon;
grant execute on function public.next_accident_reference(uuid, text) to authenticated, service_role;

do $$
declare
  def text := pg_get_functiondef('public.accident_derive_fields()'::regprocedure);
  pat text := 'PERFORM\s+pg_advisory_xact_lock\(hashtext\(''accident_ref\|''.*?LIKE\s+''ACC-''\s*\|\|\s*v_year\s*\|\|\s*''-%'';';
  n int;
begin
  n := (select count(*) from regexp_matches(def, pat, 'g'));
  if n <> 1 then raise exception 'anchor found % times', n; end if;
  execute regexp_replace(def, pat, 'v_seq := public.next_accident_reference(NEW.organisation_id, v_year);');
end $$;
