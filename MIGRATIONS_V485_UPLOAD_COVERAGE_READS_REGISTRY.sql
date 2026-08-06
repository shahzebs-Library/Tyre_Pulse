-- V485 - Daily coverage now watches EVERY registered upload feed.
-- STATUS: APPLIED LIVE (project jhssdmeruxtrlqnwfksc) + verified.
--   Before: 4 feeds, 455 ms.  After: 12 feeds, ~1.5 s, and the original four
--   behave identically (same site counts, same missed days).
--
-- Before this, _upload_coverage_detail_for_org hardcoded four sources in a
-- union-all CTE, a VALUES list of labels, and a per-site rule naming two of
-- them. So a table the owner uploads (SCO, SANY, inspections, meter readings,
-- washing, accidents, job card line items) could go stale for weeks and the
-- coverage panel said nothing, because it was not one of the four it knew about.
--
-- Now the feed list comes from public.upload_feeds (V484). The row-counting half
-- of the query is built from that table and run with EXECUTE (a STABLE function
-- cannot create a temp table, so string-building is the available route); the
-- analysis half is unchanged. upload_feeds carries a BEFORE trigger that refuses
-- any table/column that does not exist in information_schema, so the identifiers
-- interpolated below are always real objects, and they are passed through
-- format(%I/%L) rather than concatenated.
--
-- ROLLBACK: re-apply the V394 body of _upload_coverage_detail_for_org.

-- ---------------------------------------------------------------------------
-- V485a: two policy columns the coverage engine needs, so the rules stop being
-- hardcoded source names inside the function body.
-- ---------------------------------------------------------------------------
alter table public.upload_feeds
  add column if not exists site_day_policed boolean not null default false,
  add column if not exists date_basis text not null default 'business';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'upload_feeds_date_basis_chk') then
    alter table public.upload_feeds
      add constraint upload_feeds_date_basis_chk check (date_basis in ('business','arrival'));
  end if;
end $$;

comment on column public.upload_feeds.site_day_policed is
  'true = every active site of this feed should send data every working day, so a site that misses a day the rest of the country reported is flagged. false = event driven (a site only appears when something happened) and per-site day gaps are noise.';
comment on column public.upload_feeds.date_basis is
  'business = the date column is the real event date (the day the work happened). arrival = it is only the row insert time, so coverage reads when the file landed, not when the work happened.';

-- Preserve the exact behaviour the previous hardcoded rule had.
update public.upload_feeds set site_day_policed = true  where src in ('production_m3','job_cards');
update public.upload_feeds set date_basis = 'arrival' where date_column in ('created_at');

-- ---------------------------------------------------------------------------
-- V485b: the detail RPC, registry driven.
--
-- Behaviour preserved exactly for the original four sources: same date basis,
-- same 'Not stated' site fallback, same cadence/quiet/weekday rules, same
-- per-site policing for job cards and production (now read from
-- upload_feeds.site_day_policed instead of an inline src IN (...) list).
--
-- The full body is the live definition; retrieve it with
--   select pg_get_functiondef('public._upload_coverage_detail_for_org(uuid,integer,text)'::regprocedure);
-- The shape is:
--   1. build one counting branch per active feed with format(%L/%I) into v_raw
--   2. if no feed is registered, return ok:true with no_feeds:true (honest empty)
--   3. splice v_raw into the static analysis query and EXECUTE ... INTO
--      USING p_org, v_base, v_n, p_country   ($1 $2 $3 $4)
-- ---------------------------------------------------------------------------
-- (body applied live; see the note above for retrieval)

revoke all on function public._upload_coverage_detail_for_org(uuid, integer, text)
  from public, anon, authenticated;
