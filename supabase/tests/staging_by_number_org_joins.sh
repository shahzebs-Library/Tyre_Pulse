#!/usr/bin/env bash
# 20261117110000_by_number_org_joins: two companies holding the SAME job card number / asset
# code must not move each other's data. Runs on a PRIVATE COPY of the LOCAL staging mirror only
# (127.0.0.1, synthetic companies Alpha/Beta/Gamma). Nothing here touches production.
#
#   supabase/tests/staging_by_number_org_joins.sh
#   TEMPLATE_DB=tp_mirror2 TEST_DB=tp_bno_test ...   # optional names
#
# Order: hash single-company outputs + the 9 object definitions -> leak cases (expected FAIL) ->
# migration -> leak cases (expected PASS) -> single-company outputs identical -> re-run is a
# no-op -> rollback restores all 9 objects byte-identical -> re-apply identical.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PENDING="$HERE/../pending_migrations"
export PGHOST=127.0.0.1 PGPORT="${STAGING_PORT:-54329}" PGUSER=postgres
TEMPLATE_DB="${TEMPLATE_DB:-tp_mirror2}"
TEST_DB="${TEST_DB:-tp_bno_test}"
case "$TEST_DB" in tp_*) ;; *) echo "TEST_DB must start with tp_"; exit 2;; esac
MIG=20261117110000_by_number_org_joins.sql
RB=20261117110000_by_number_org_joins_ROLLBACK.sql

q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$TEST_DB" "$@"; }
cases() { psql -X -q -At -d "$TEST_DB" -f "$HERE/staging_by_number_org_joins.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p;/ERROR/p'; }
apply() { if q -f "$PENDING/$1" >/dev/null 2>&1; then echo "applied: $1"; else echo "FAILED: $1"; q -f "$PENDING/$1" 2>&1 | grep -m3 -E 'ERROR|FATAL'; exit 1; fi; }

# The 9 objects, one md5 each (view: its definition plus reloptions).
defs() { q <<'SQL'
select string_agg(n || '=' || h, ' ' order by n) from (
  select p.sig as n, md5(pg_get_functiondef(p.sig::regprocedure)) as h
  from unnest(array[
    'public.classify_parts_consumption()',
    'public.get_site_operating_cost(text,date,date)',
    'public.get_asset_disposal_register(text)',
    'public.process_stg_complaints()',
    'public.process_stg_monthly_tyres()',
    'public.convert_repair_request_to_job_card(uuid,text,text,timestamp with time zone)',
    'public.owner_data_audit()',
    'public.tyre_cost_audit_classify(text,date,date)']) as p(sig)
  union all
  select 'v_tyre_fitment_evidence', md5(pg_get_viewdef('public.v_tyre_fitment_evidence'::regclass) || coalesce(array_to_string(c.reloptions, ','), ''))
  from pg_class c where c.oid = 'public.v_tyre_fitment_evidence'::regclass) s;
SQL
}

# Company A's outputs from every changed object, on the mirror's own data (no shared numbers).
# One rolled-back transaction; the disposal row uses fixed values so the hash is stable.
outputs() { q <<'SQL' | grep -v '^$'
begin;
insert into public.asset_disposals (id, organisation_id, country, asset_no, disposition, status, created_at, updated_at)
values ('dddddddd-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'KSA', 'TM010', 'scrap', 'proposed',
        '2026-01-01 00:00+00', '2026-01-01 00:00+00');
select set_config('request.jwt.claims', '{"sub":"af52a86f-2c24-5ce2-a00d-7ac6ca5d715f","role":"authenticated"}', true) \g /dev/null
select 'site_operating_cost(all)  ' || md5(public.get_site_operating_cost()::text);
select 'site_operating_cost(KSA)  ' || md5(public.get_site_operating_cost('KSA')::text);
select 'disposal_register(all)    ' || md5(public.get_asset_disposal_register(null)::text);
select 'repair_request_convert    ' || md5((select string_agg(work_order_no, ',' order by work_order_no) from public.work_orders
                                              where organisation_id = '00000000-0000-0000-0000-000000000001'));
select set_config('request.jwt.claims', '{"sub":"5eacf3d3-29af-5995-bc52-bcef51b82c38","role":"authenticated"}', true) \g /dev/null
select 'owner_data_audit          ' || md5((public.owner_data_audit() - 'generated_at')::text);
select set_config('request.jwt.claims', '', true) \g /dev/null
select 'tyre_cost_audit_classify  ' || md5(coalesce(string_agg(to_jsonb(c)::text, '' order by c.tyre_id), ''))
  from public.tyre_cost_audit_classify(null, '2018-01-01', '2027-12-31') c
  join public.tyre_records t on t.id = c.tyre_id where t.organisation_id = '00000000-0000-0000-0000-000000000001';
select 'v_tyre_fitment_evidence   ' || md5(coalesce(string_agg(to_jsonb(v)::text, '' order by v.id), ''))
  from public.v_tyre_fitment_evidence v where v.organisation_id = '00000000-0000-0000-0000-000000000001';
rollback;
SQL
}

t0=$(date +%s)
psql -X -q -d postgres -c "drop database if exists $TEST_DB" >/dev/null
psql -X -q -d postgres -c "create database $TEST_DB template $TEMPLATE_DB" >/dev/null
echo "copy: $TEST_DB from $TEMPLATE_DB"

orig_defs="$(defs)"
out_before="$(outputs)"

echo "--- leak cases before the migration (FAIL expected)"
before="$(cases)"; echo "$before"
n_fail_before=$(echo "$before" | grep -c '^FAIL' || true)
[ "$n_fail_before" -eq 10 ] || { echo "expected 10 FAIL lines before the migration, got $n_fail_before"; exit 1; }
if echo "$before" | grep -q 'error'; then echo "a case errored before the migration"; exit 1; fi

apply "$MIG"
echo "--- leak cases after the migration (PASS expected)"
after="$(cases)"; echo "$after"
if echo "$after" | grep -q '^FAIL'; then echo "assertions failed"; exit 1; fi
n_pass=$(echo "$after" | grep -c '^PASS' || true)
[ "$n_pass" -eq 15 ] || { echo "expected 15 PASS lines, got $n_pass"; exit 1; }

echo "--- company A outputs (no shared numbers): before vs after"
out_after="$(outputs)"
echo "$out_after"
[ "$out_before" = "$out_after" ] && echo "single-company outputs identical: yes" || { echo "single-company outputs changed"; diff <(echo "$out_before") <(echo "$out_after"); exit 1; }

patched_defs="$(defs)"
[ "$patched_defs" != "$orig_defs" ] || { echo "migration changed nothing"; exit 1; }
apply "$MIG"
[ "$(defs)" = "$patched_defs" ] && echo "re-run is a no-op: yes" || { echo "re-run changed an object"; exit 1; }

apply "$RB"
[ "$(defs)" = "$orig_defs" ] && echo "rollback restores all 9 objects byte-identical: yes" || { echo "rollback mismatch"; diff <(echo "$orig_defs" | tr ' ' '\n') <(defs | tr ' ' '\n'); exit 1; }
rb_cases="$(cases)"
[ "$(echo "$rb_cases" | grep -c '^FAIL' || true)" -eq 10 ] && echo "after rollback the leaks are back (10 FAIL): yes" || { echo "unexpected case results after rollback"; echo "$rb_cases"; exit 1; }

apply "$MIG"
[ "$(defs)" = "$patched_defs" ] && echo "re-apply after rollback: identical" || { echo "re-apply mismatch"; exit 1; }
[ "$(echo "$(cases)" | grep -c '^PASS')" -eq 15 ] && echo "leak cases after re-apply: 15 PASS" || { echo "re-apply cases failed"; exit 1; }

psql -X -q -d postgres -c "drop database if exists $TEST_DB" >/dev/null
echo "elapsed: $(( $(date +%s) - t0 ))s"
echo "ALL OK"
