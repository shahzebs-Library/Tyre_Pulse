-- V393 + V393b: two classifier corrections the new decisions view found within
-- minutes of existing, which is the point of that view.
--
-- ── V393: "GEARBOX OIL" is oil ───────────────────────────────────────────────
-- V390 added a guard so a named mechanical assembly beats the item code, and
-- 'gearbox' is one of its tokens. The lubricant test runs FIRST and knows
-- 'transmission oil', 'gear oil' and 'engine oil' - but NOT 'gearbox oil'. So
-- the asymmetry: TRANSMISSION OIL correctly reads as a lubricant while GEARBOX
-- OIL 140 fell past it into the assembly guard and was filed as a mechanical
-- part at 0.92 confidence. That is worse than the 0.30 'default' it had before
-- V390, because it is confidently wrong instead of honestly unsure.
--
-- MEASURED FIRST, per the 42%-that-was-really-2.6% rule: 10 lines, about 23,100
-- across KSA and Egypt, all sitting in spare via the fallback. One axle oil line
-- was already reviewed by a human as oil, which confirms the intended answer
-- rather than assuming it.
--
-- SAFE because brain_is_lubricant already refuses a description that also names
-- a PART: ENGINE OIL FILTER, GEAR OIL SEAL and HYDRAULIC OIL HOSE all stay
-- spare, and GEARBOX OIL SEAL still lands on the V390 assembly guard. Each was
-- verified before applying.
--
-- ── V393b: "COOLING HOSES" is a hose ─────────────────────────────────────────
-- The oil_part list is what stops a description that merely NAMES an oil from
-- being read as oil. Every token in it was singular, and the matcher is
-- deliberately whole-word (the 'Shell RIMula matched rim' lesson - substring
-- matching is never used here). So "MERCEDES - GEAR BOX OIL COOLING HOSES"
-- matched no part word and was filed as oil by the fix above. A hose is a hose
-- whether the export writes one or two.
--
-- MEASURED: exactly one line mis-filed, EGP 1,100. The value is not that row,
-- it is that the next export carrying plural part names will not quietly move
-- parts into oil spend. Deliberately NOT touched: "ENGINE OIL & FILTERS NISSAN"
-- in UAE is a genuinely mixed line a human reviewed as oil, and a reviewed
-- decision outranks every token - which is the correct precedence.
--
-- RESULT after both, applied live and re-derived on the 11 affected rows:
--   7 lines moved spare -> oil (gearbox / cooling / refrigerant oils)
--   the seal, the hoses and the axle oil seal correctly stayed spare
--   the human-reviewed differential oil was untouched
--   every country TOTAL unchanged, variance 0.00
--   Egypt 79,341,428.04 / KSA 40,608,349.65 / UAE 18,493,541.38
-- Pre-change rows kept in public._bucket_snapshot_v393 (deny-all).
--
-- MIRROR: src/lib/classificationBrain.js LUBRICANT_TOKENS / OIL_PART_TOKENS.
-- The two must change together.
--
-- brain_rules_version bumped 4 -> 5 (V393) -> 6 (V393b). That is what retires
-- the cached answers; forgetting it is the only way the cache can lie.
create or replace function public.brain_tokens(p_kind text)
returns text[] language sql immutable parallel safe set search_path to 'public' as $fn$
  select case p_kind
    when 'accessory' then array[
      'patch','patches','valve','glue','cement','fender','flap','inflat','gauge','soap',
      'chalk','rim','wheel nut','wheel bolt','wheel stud','wheel clamp','wheel set',
      'balanc','weight','spanner','remover','tool','paste','marker','protector','foam',
      'puncture','nozzle','welding machine','wheel barrow','kilomitter','spill',
      'inner tube','tube and flap','tube flap','spacer ring','spider hub','repair kit']
    when 'non_tyre_part' then array[
      'gear box','gearbox','transmission','steering pump','water pump',
      'hydraulic pump','radiator','alternator','starter motor','cylinder head',
      'oring','o ring','o-ring','rubber roll']
    when 'lubricant' then array[
      'engine oil','gear oil','hydraulic oil','compressor oil','transmission oil',
      'brake oil','brake fluid','atf','grease','lubricant','delvac','rimula','voyager',
      'gear fluid','hydraulic fluid',
      -- the fluids the assembly guard would otherwise swallow, plus their
      -- siblings from the same exports
      'gearbox oil','gear box oil','axle oil','differential oil','diff oil',
      'cooling oil','refrigerant oil',
      'coolant','cooliant','antifreeze','anti freeze','radiator fluid',
      'lubricating','adblue','ad blue','diesel exhaust fluid','def fluid']
    when 'oil_part' then array[
      'filter','seal','gasket','pump','cooler','line','hose','pipe','gauge','sensor',
      'switch','cap','tank','strainer','separator','baffle','injection',
      -- plurals: the matcher is whole-word by design, so these are not implied
      'filters','seals','gaskets','pumps','coolers','lines','hoses','pipes','gauges',
      'sensors','switches','caps','tanks','strainers','separators']
    when 'tyre_brand' then array[
      'roadx','longmarch','long march','rockholder','roadwest','mac royal','drive master',
      'drivemaster','cachland','taiho','v-glory','v glory','fortune','allround','tanova',
      'bossway','ecostar','transking','transtone','double star','wildpeak','priny',
      'roadking','firemax','montana','maxam','tracmax','trackmax','skyfire','sky fire',
      'infinity','tegrys','ericle','zeetex','prille','techking','blackhawk','doublecoin',
      'double coin','westlake','westlike','jinyu','triangle','advance','nison','century',
      'wellplus','formula','aosen','gold dove','superway','kunlun','fulda','rock buster',
      'diamond back','aget','allianz','firestone','bridgestone','michelin','goodyear',
      'dunlop','hankook','kumho','yokohama','pirelli','continental','apollo','mrf','ceat',
      'bkt','otani','annaite','sailun','windforce','joyroad','roadlux','chaoyang','mitas',
      'alliance','itr','tvs','linglong','aeolus']
    else array[]::text[] end;
$fn$;

create or replace function public.brain_rules_version()
returns integer language sql immutable parallel safe set search_path to 'public'
as $fn$ select 6 $fn$;

-- Re-derive only the affected rows. The classify trigger is BEFORE INSERT OR
-- UPDATE, so touching any column re-runs classification - deliberate for a
-- correction pass, a trap for anything else.
-- update public.parts_consumption
--    set classify_confidence = classify_confidence
--  where organisation_id = '00000000-0000-0000-0000-000000000001'
--    and item_description ~* '\y(gear ?box oil|axle oil|differential oil|diff oil|cooling oil|refrigerant oil)\y';
