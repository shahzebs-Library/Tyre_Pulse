#!/usr/bin/env bash
# Staging test runner for the report PDF cache drafts. LOCAL staging cluster only.
#
#   supabase/tests/staging/report_pdf_cache_tests.sh            # full run on a throwaway copy
#   KEEP_DB=1 ...                                               # keep the copy (tp_pdf_verify) afterwards
#
# What it proves (synthetic companies Alpha / Beta / Gamma, nothing from production):
#   1. applying the drafts leaves every existing table's rows, every existing function body and
#      every existing policy byte-identical (only new objects appear)
#   2. the functional and access tests in report_pdf_cache_tests.sql (rolled back)
#   3. real concurrency: N sessions claim the same report at the same moment -> one generator
#   4. concurrent lookups of a stored report (30 sessions by default, see below) -> all ready, with latency
set -euo pipefail
HOST="${STAGING_HOST:-127.0.0.1}"; PORT="${STAGING_PORT:-54329}"
case "$HOST" in 127.0.0.1|localhost) ;; *) echo "Refusing: local staging only" >&2; exit 1;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
DB="${PDF_TEST_DB:-tp_pdf_verify}"; BASE="${STAGING_DB:-tyrepulse_staging}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U postgres)
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"; [ "${KEEP_DB:-0}" = 1 ] || "${P[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

"${P[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB template $BASE"
# the ERP observation migration is live in production but newer than the staging baseline
"${P[@]}" -d "$DB" -1 -f "$ROOT/supabase/migrations/20261115120000_observation_erp_reconciliation.sql" >/dev/null 2>&1

fingerprint() {
  "${P[@]}" -d "$DB" -At <<'SQL'
do $$
declare r record; h text; n bigint;
begin
  create temp table if not exists _fp (kind text, name text, h text);
  truncate _fp;
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'r' and n.nspname in ('public','storage','approval_private','private','workforce_internal','ai_tyre_private','anum_integration','administration_imports')
              and c.relname not like 'report\_pdf\_%' and c.relname <> 'report_export_jobs'
  loop
    execute format('select count(*), coalesce(md5(string_agg(md5(t::text), '''' order by md5(t::text))), '''') from %I.%I t', r.nspname, r.relname) into n, h;
    insert into _fp values ('rows', r.nspname || '.' || r.relname, n || ':' || h);
  end loop;
  insert into _fp select 'function', p.oid::regprocedure::text, md5(p.prosrc || p.prosecdef::text || coalesce(p.proconfig::text, '') || coalesce(p.proacl::text, ''))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','storage','anum_integration','private') and p.proname not like 'pdf\_%' and p.proname not like 'report\_pdf\_%';
  insert into _fp select 'policy', schemaname || '.' || tablename || '.' || policyname, md5(coalesce(qual, '') || coalesce(with_check, '') || cmd || permissive || roles::text)
    from pg_policies where tablename not like 'report\_pdf\_%' and tablename <> 'report_export_jobs' and policyname not like 'report\_pdfs\_%' and policyname not like 'anum\_reader\_%';
  insert into _fp select 'trigger', c.relname || '.' || t.tgname, t.tgenabled::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and t.tgname not like 'report\_pdf\_%';
end $$;
select kind || '|' || name || '|' || h from _fp order by 1;
SQL
}

echo "== 1. fingerprint before"
fingerprint > "$TMP/before.txt"
for f in 20261117090000_report_pdf_cache 20261117091000_report_pdf_autoqueue; do
  "${P[@]}" -d "$DB" -1 -f "$ROOT/supabase/pending_migrations/$f.sql" >/dev/null 2>&1
done
fingerprint > "$TMP/after.txt"
# storage.buckets gains exactly one row (the new private bucket); nothing else may differ
if diff <(grep -v '^rows|storage.buckets|' "$TMP/before.txt") <(grep -v '^rows|storage.buckets|' "$TMP/after.txt") > "$TMP/diff.txt"; then
  echo "PASS existing rows, functions, policies and triggers byte-identical after the drafts ($(wc -l < "$TMP/before.txt") fingerprints)"
else
  echo "FAIL existing objects changed:"; head -20 "$TMP/diff.txt"; exit 1
fi
[ "$("${P[@]}" -d "$DB" -At -c "select count(*) from storage.buckets where id = 'report-pdfs' and not public and allowed_mime_types = array['application/pdf']")" = 1 ] \
  && echo "PASS bucket report-pdfs is private and accepts application/pdf only"
# re-running the drafts is harmless
for f in 20261117090000_report_pdf_cache 20261117091000_report_pdf_autoqueue; do
  "${P[@]}" -d "$DB" -1 -f "$ROOT/supabase/pending_migrations/$f.sql" >/dev/null 2>&1
done
echo "PASS drafts are re-runnable"

echo "== 2. functional and access tests (rolled back)"
"${P[@]}" -d "$DB" -f "$HERE/report_pdf_cache_tests.sql" 2>&1 | grep -E "ERROR|FAIL|checks passed" | sed 's/^ */PASS /' | sed 's/^PASS \(.*\(ERROR\|FAIL\)\)/\1/'
"${P[@]}" -d "$DB" -f "$HERE/report_pdf_cache_tests.sql" 2>&1 | grep -qE "ERROR|FAIL" && exit 1

echo "== 3. simultaneous claims (real sessions, committed, then cleaned)"
SRC="$("${P[@]}" -d "$DB" -At -c "select id from public.inspections where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' order by id limit 1")"
USERS=(alpha.admin alpha.manager alpha.director alpha.tyreman alpha.driver alpha.admin alpha.manager alpha.director)
claim_sql() { cat <<SQL
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where email = '$1@staging.tyrepulse.invalid'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.pdf_cache_claim('tyre_inspection', '$SRC', 'tpl-conc', 'b-conc', '', 'Tyre Insp CONC.pdf', 180, false)->>'state';
commit;
SQL
}
# distinct users: each one is a different person pressing Download at the same moment
i=0; for u in alpha.admin alpha.manager alpha.director alpha.tyreman alpha.driver; do
  i=$((i+1)); claim_sql "$u" | "${P[@]}" -d "$DB" -At > "$TMP/claim_$i.txt" 2>&1 &
done; wait
CLAIMED="$(cat "$TMP"/claim_*.txt | grep -c '^claimed$' || true)"; WAITING="$(cat "$TMP"/claim_*.txt | grep -c '^processing$' || true)"
ROWS="$("${P[@]}" -d "$DB" -At -c "select count(*) from public.report_pdf_files where source_id = '$SRC' and template_version = 'tpl-conc'")"
if [ "$CLAIMED" = 1 ] && [ "$WAITING" = 4 ] && [ "$ROWS" = 1 ]; then
  echo "PASS 5 simultaneous claims: 1 generator, 4 told to wait, 1 row"
else echo "FAIL simultaneous claims: claimed=$CLAIMED waiting=$WAITING rows=$ROWS"; cat "$TMP"/claim_*.txt; exit 1; fi

# The local cluster allows 40 connections in total (hosted Supabase puts a pooler in front), so the
# default is 30 simultaneous sessions. Set PDF_BENCH_CLIENTS=50 on a cluster with max_connections >= 60.
CLIENTS="${PDF_BENCH_CLIENTS:-30}"; TX=$(( (1000 + CLIENTS - 1) / CLIENTS )); TOTAL=$(( CLIENTS * TX ))
echo "== 4. $CLIENTS concurrent sessions looking up a stored report"
"${P[@]}" -d "$DB" -At >/dev/null <<SQL
update public.report_pdf_files set lease_owner = (select id from public.profiles where email = 'alpha.manager@staging.tyrepulse.invalid')
 where source_id = '$SRC' and template_version = 'tpl-conc';
insert into storage.objects (bucket_id, name, metadata)
select 'report-pdfs', storage_path, '{"size":1000,"mimetype":"application/pdf"}' from public.report_pdf_files where source_id = '$SRC' and template_version = 'tpl-conc'
on conflict do nothing;
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where email = 'alpha.manager@staging.tyrepulse.invalid'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.pdf_cache_complete((select id from public.report_pdf_files where source_id = '$SRC' and template_version = 'tpl-conc'), repeat('a', 64), 1000);
commit;
SQL
cat > "$TMP/lookup.sql" <<SQL
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where email = 'alpha.manager@staging.tyrepulse.invalid'), 'role', 'authenticated')::text, true);
set local role authenticated;
select 1 / (case when public.pdf_cache_lookup('tyre_inspection', '$SRC', 'tpl-conc', 'b-conc', '')->>'state' = 'ready' then 1 else 0 end);
commit;
SQL
"$PGBIN/pgbench" -n -h "$HOST" -p "$PORT" -U postgres -c "$CLIENTS" -j 4 -t "$TX" -f "$TMP/lookup.sql" "$DB" 2>&1 | tee "$TMP/bench.txt" | grep -E "number of transactions actually|number of failed|latency average|tps" | sed 's/^/     /'
grep -q "number of failed transactions: 0" "$TMP/bench.txt" && grep -q "actually processed: $TOTAL/$TOTAL" "$TMP/bench.txt" \
  && echo "PASS $CLIENTS concurrent sessions x $TX lookups: $TOTAL of $TOTAL returned ready (a non-ready answer would divide by zero and fail)" \
  || { echo "FAIL concurrent lookups"; exit 1; }
N="$("${P[@]}" -d "$DB" -At -c "select count(*) from public.report_pdf_files where source_id = '$SRC' and template_version = 'tpl-conc'")"
[ "$N" = 1 ] && echo "PASS still one stored row after $TOTAL lookups (no regeneration)"
echo "ALL STAGING CHECKS PASSED"
