-- PR #375 review fixes.
--
-- 1. admin_data_cleanup_run_with_reason: the console now asks for a reason
--    before a cleanup, but the reason was written by a separate best-effort
--    client call after the delete. If that call failed, rows were gone with no
--    reason on record. This wrapper runs the existing guarded cleanup and writes
--    the console audit row in the SAME transaction, without swallowing errors,
--    so the delete and its reason commit together or not at all.
--    Dual control and the IP guard still run inside admin_data_cleanup_run.
--
-- 2. admin_set_flutter_version: two super admins saving min and latest at the
--    same moment could each validate against the old pair and together leave
--    min > latest (a gate that locks every phone out). A transaction advisory
--    lock now serialises the read-check-write of the pair. Applied by inserting
--    one statement into the live definition, so nothing else changes.
--
-- Rollback: drop function public.admin_data_cleanup_run_with_reason(text, date, text);
--           remove the pg_advisory_xact_lock line from admin_set_flutter_version.

create or replace function public.admin_data_cleanup_run_with_reason(p_key text, p_before date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'super admin only' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Give a short reason for this cleanup' using errcode = '22023';
  end if;

  v_res := public.admin_data_cleanup_run(p_key, p_before);

  perform public.log_console_event('data_cleanup', null, p_key,
    jsonb_build_object('before', p_before, 'deleted', v_res->'deleted',
                       'snapshot', v_res->'snapshot', 'reason', btrim(p_reason)));

  return v_res;
end
$$;

revoke all on function public.admin_data_cleanup_run_with_reason(text, date, text) from public;
revoke all on function public.admin_data_cleanup_run_with_reason(text, date, text) from anon;
grant execute on function public.admin_data_cleanup_run_with_reason(text, date, text) to authenticated;

do $mig$
declare
  v_def text := pg_get_functiondef('public.admin_set_flutter_version(text, text, text)'::regprocedure);
  v_anchor text := 'select btrim(btrim(coalesce(value, '''')), ''"'') into v_min';
  v_new text;
begin
  if position('pg_advisory_xact_lock' in v_def) > 0 then
    return;  -- already applied
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'admin_set_flutter_version: anchor not found exactly once, aborting';
  end if;
  v_new := replace(v_def, v_anchor,
    'perform pg_advisory_xact_lock(hashtext(''flutter_version_pair''));' || chr(10) || '  ' || v_anchor);
  execute v_new;
end
$mig$;
