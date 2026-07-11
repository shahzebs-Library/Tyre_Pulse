-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V121 — Stop silently misfiling UNKNOWN countries into 'KSA'
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem (latent data-integrity trap):
--   public.normalize_country(raw) ended in `else 'KSA'`, so ANY value it did
--   not recognise — a typo, or a genuinely new country such as 'Qatar' — was
--   silently rewritten to 'KSA' on every INSERT/UPDATE of tyre_records (via the
--   BEFORE trigger tyre_records_master_process). New-country rows would be
--   misfiled into KSA instead of surfacing, a real risk before any 4th-country
--   expansion.
--
--   Two further implicit KSA injections existed:
--     • the trigger's blank-country fallback  coalesce(new.region, 'KSA')
--     • the tyre_records.country column DEFAULT 'KSA'
--
-- Fix — make country handling TRUTHFUL (never invent 'KSA'):
--   • known aliases  -> canonical  KSA | UAE | Egypt
--   • unknown value  -> preserved verbatim (trimmed), NEVER forced to 'KSA'
--   • null / blank   -> null       (no invented country)
--
-- Notes:
--   • Existing rows are NOT rewritten — past KSA coercions are unrecoverable and
--     a blind backfill could not distinguish a real KSA row from a coerced one.
--   • Canonical writes are unaffected: the app + import RPC always stamp a
--     canonical activeCountry (KSA/UAE/Egypt), which still normalises to itself.
--   • Country-scoped analytics use `.eq('country', activeCountry)`; a genuinely
--     unknown/null country now correctly falls OUTSIDE those filters (and appears
--     under the 'All' view) instead of masquerading as KSA.
--
-- Idempotent: CREATE OR REPLACE + ALTER ... DROP DEFAULT are safe to re-run.
-- Reversible: re-add `else 'KSA'`, restore `coalesce(new.region,'KSA')`, and
--             `ALTER TABLE public.tyre_records ALTER COLUMN country SET DEFAULT 'KSA';`
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 1. Truthful country normalisation ------------------------------------------------
create or replace function public.normalize_country(raw text)
returns text language sql immutable as $$
  select case
    when raw is null or btrim(raw) = '' then null
    else case upper(btrim(raw))
      when 'KSA'                    then 'KSA'
      when 'SA'                     then 'KSA'
      when 'SAUDI'                  then 'KSA'
      when 'SAUDI ARABIA'           then 'KSA'
      when 'UAE'                    then 'UAE'
      when 'AE'                     then 'UAE'
      when 'UNITED ARAB EMIRATES'   then 'UAE'
      when 'DUBAI'                  then 'UAE'
      when 'ABU DHABI'              then 'UAE'
      when 'EGYPT'                  then 'Egypt'
      when 'EG'                     then 'Egypt'
      when 'CAIRO'                  then 'Egypt'
      else btrim(raw)  -- preserve unknown country verbatim; never force 'KSA'
    end
  end
$$;

-- 2. Trigger: drop the `coalesce(new.region,'KSA')` blank fallback -----------------
--    (full function re-created verbatim except the country block)
create or replace function public.tyre_records_master_process()
returns trigger language plpgsql as $$
declare
  v_default_cost numeric;
begin

  -- ── Country: normalise; keep region if country blank; never inject 'KSA' ──
  if new.country is null or trim(new.country) = '' then
    new.country := public.normalize_country(new.region);
  else
    new.country := public.normalize_country(new.country);
  end if;

  -- ── Qty: must be at least 1 ─────────────────────────────────
  if new.qty is null or new.qty < 1 then
    new.qty := 1;
  end if;

  -- ── Cost: never null or zero; fall back to global setting ───
  if new.cost_per_tyre is null or new.cost_per_tyre <= 0 then
    select value::numeric into v_default_cost
      from public.settings where key = 'cost_per_tyre' limit 1;
    new.cost_per_tyre := coalesce(v_default_cost, 1200);
  end if;

  -- ── KM sanity: zero means "not provided" ───────────────────
  if new.km_at_fitment = 0 then new.km_at_fitment := null; end if;
  if new.km_at_removal = 0 then new.km_at_removal := null; end if;

  -- ── KM order: swap silently if fitment > removal ───────────
  if new.km_at_fitment is not null
  and new.km_at_removal is not null
  and new.km_at_fitment > new.km_at_removal then
    declare tmp numeric;
    begin
      tmp := new.km_at_fitment;
      new.km_at_fitment := new.km_at_removal;
      new.km_at_removal := tmp;
    end;
  end if;

  return new;
end;
$$;

-- 3. Remove the column-level DEFAULT 'KSA' on tyre_records.country -----------------
--    (an omitted country now stores NULL, not a silent 'KSA')
alter table public.tyre_records alter column country drop default;

commit;

-- ── Post-apply verification (run manually) ───────────────────────────────────────
-- select public.normalize_country('Saudi Arabia') as ksa,      -- KSA
--        public.normalize_country('dubai')        as uae,      -- UAE
--        public.normalize_country('Qatar')        as unknown,  -- Qatar (preserved)
--        public.normalize_country('  ')           as blank,    -- (null)
--        public.normalize_country(null)           as nil;      -- (null)
