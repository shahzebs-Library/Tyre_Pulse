-- V394 — stamp the country on the 55,606 job cards that were imported without one
--
-- WHY
-- 64% of work_orders (55,606 of 86,539) carry country = NULL. They came from the
-- V381 "Format job card" export, which never stamped the column. Because
-- listWorkOrdersPage filters with a strict .eq('country', ...), selecting ANY
-- country on the Work Orders page hides every one of them. That is the
-- "my data is not linked" symptom.
--
-- HOW THE COUNTRY WAS DETERMINED — the job card number itself carries it.
-- Measured across all 86,539 rows, the work_order_no prefix maps 1:1 to a
-- country wherever a country is already known, with ZERO conflicts:
--
--     prefix   country     rows
--     AFKR     KSA         4,493      (+185 unlabelled)
--     EG       Egypt      12,250
--     RM       UAE        14,190
--     GCKR     unknown    55,421      (all unlabelled)
--
-- GCKR is the only prefix with no labelled example, so it was confirmed by two
-- further INDEPENDENT signals, both pointing the same way:
--
--   1. SITE. Of GCKR job cards whose site also appears on a labelled job card,
--      25,999 rows across 5 sites resolve to KSA and *ZERO* resolve to UAE or
--      Egypt. The remaining sites are absent from the fleet register entirely
--      (absence of evidence, not evidence of another country) and every one is
--      a Saudi location: NHC, AMAALA, KSP (King Salman Park), MALHAM, RUMAH,
--      DIRIYAH, MISK, QIDDIYA, NEOM, DAHBAN, JEDDAH, JIZAN, YANBU, RIY-MET.
--   2. ASSET REGISTRATION. 55,418 of 55,421 GCKR job cards name an asset that
--      is registered in the KSA fleet.
--
-- WHY NOT asset_no ALONE — this is the important part.
-- A first pass keyed only on asset_no reported 7,241 rows as "ambiguous"
-- because the asset code existed in more than one country's register. That
-- signal is WRONG here: V376 established that asset numbers are a PER-COUNTRY
-- sequence per asset class (BP/GN/MP/TM), so the same code in two countries is
-- usually a different machine. The UAE (6,796) and Egypt (442) asset matches
-- seen for GCKR rows are exactly that collision artifact. The job card number
-- is the reliable key; the asset code is not.
--
-- SCOPE: both remaining unlabelled prefixes resolve to KSA, so all 55,606 rows
-- are stamped KSA. No row of any other country is touched.
--
-- AFTER THIS RUNS the KSA job card count moves 4,493 -> 60,099. That is the
-- correction, not a regression: those cards were always Saudi, they were simply
-- invisible whenever a country was selected.
--
-- AUDIT: work_orders carries trg_audit_row (AFTER UPDATE), which writes a full
-- before/after image per row. This will add ~55,606 rows to audit_log_v2
-- (443 MB / 261,243 rows before). That is deliberate - a correction of this size
-- SHOULD be audited, and suppressing the trigger would alter the audit contract,
-- which is a decision that needs sign-off rather than a side effect of a
-- backfill. Expect the statement to take a few minutes: trg_audit_row_change
-- does a per-row profiles lookup on auth.uid(), which is NULL outside a session.

begin;

-- Reversible record of exactly which rows are touched, plus the evidence.
create table if not exists public._wo_country_snapshot_v394 as
select id, work_order_no, split_part(work_order_no, '/', 1) as wo_prefix,
       site, asset_no, country as country_before, now() as snapshot_at
from public.work_orders
where country is null;

revoke all on public._wo_country_snapshot_v394 from authenticated, anon;

-- Guard: refuse to run if an unexpected prefix appeared since the snapshot was
-- measured. Only GCKR and AFKR were ever evidenced as KSA.
do $$
declare v_other int;
begin
  select count(*) into v_other
  from public._wo_country_snapshot_v394
  where wo_prefix not in ('GCKR', 'AFKR');
  if v_other > 0 then
    raise exception 'V394 aborted: % snapshot rows carry an unevidenced prefix', v_other;
  end if;
end $$;

update public.work_orders w
   set country = 'KSA'
  from public._wo_country_snapshot_v394 s
 where w.id = s.id
   and w.country is null
   and s.wo_prefix in ('GCKR', 'AFKR');

commit;

-- VERIFY (expect: KSA 60,099 · UAE 14,190 · Egypt 12,250 · no NULL row left)
--   select coalesce(country,'(NULL)') as country, count(*)
--   from public.work_orders group by 1 order by 2 desc;
--
-- UNDO (restores the exact prior state - every touched row was NULL)
--   update public.work_orders set country = null
--   where id in (select id from public._wo_country_snapshot_v394);
