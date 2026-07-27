-- V390. A gearbox is not a tyre, whatever its item code says.
--
-- REPORTED FROM THE FLOOR: a non-tyre item was sitting in the tyre column.
-- Verified on live data - all in the TYRE bucket at confidence 0.95 via
-- 'code-range':
--     TI-GE-0050  Power Steering Pump for the trailer   12,000.00 EGP
--     TI-GE-0036  NISSAN PICK UP TRANSMISSION GEAR BOX  10,300.00 EGP
--     TI-GE-0049  RUBBER ROLL                              353.75 EGP
--     310180-O    ORING 23.5*25                             47.62 AED
--
-- WHY THE EXISTING GUARDS MISSED THEM. The ERP code range is the strongest
-- machine signal and is trusted at 0.95, but it only means "someone filed this
-- under tyres". The accessory guard would have caught the o-ring except that it
-- has a deliberate escape hatch - code-says-tyre AND the text carries a size -
-- which exists so a real tyre whose description mentions a rim or flap is not
-- demoted. "ORING 23.5*25" satisfies both halves of that hatch.
--
-- So this is a SEPARATE guard with NO escape hatch: a size in the text does not
-- make a gearbox a tyre, it is the size of the thing the part fits.
--
-- ORDER MATTERS: checked AFTER the lubricant test, so "COMPRESSOR OIL 68" and
-- "TRANSMISSION OIL" stay lubricants rather than being caught here as
-- assemblies. Getting that order wrong would move Egypt's oil spend into spare.
--
-- Deliberately TIGHT. The 42%-that-was-really-2.6% lesson applies: a broad
-- pattern would move genuine tyres - BLACK HAWK, ROADWEST, APLUS, TAIHO,
-- ALLIANZ, SPEEDWAY and ALLIANCE all live in this same code range and are real.
--
-- MIRROR: src/lib/classificationBrain.js NON_TYRE_PART_TOKENS / isNonTyrePart.
-- The two must change together.
--
-- APPLIED LIVE 2026-07-27 as v390_non_tyre_part_guard. Result: 7 rows moved out
-- of the tyre bucket, every country TOTAL unchanged (Egypt 79,341,428.04 /
-- KSA 40,608,349.65 / UAE 18,493,541.38, variance 0.00), 602 coolant/oil lines
-- untouched. Pre-change buckets kept in _bucket_snapshot_v390.
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
      'coolant','cooliant','antifreeze','anti freeze','radiator fluid',
      'lubricating','adblue','ad blue','diesel exhaust fluid','def fluid']
    when 'oil_part' then array[
      'filter','seal','gasket','pump','cooler','line','hose','pipe','gauge','sensor',
      'switch','cap','tank','strainer','separator','baffle','injection']
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

create or replace function public.brain_classify(
  p_item_code text, p_description text,
  p_reviewed_category text default null, p_on_tyre_jobcard boolean default false)
returns table(category text, bucket text, confidence numeric, decided_by text)
language plpgsql immutable parallel safe set search_path to 'public' as $fn$
declare
  v_code_cat text;
  v_says_tyre boolean;
begin
  if p_reviewed_category is not null
     and p_reviewed_category in ('tyre','spare_part','filter','lubricant','fuel',
                                 'consumable','service','labour','capital','unclassified') then
    return query select p_reviewed_category,
                        public.material_category_bucket(p_reviewed_category),
                        1.00::numeric, 'reviewed-master';
    return;
  end if;

  v_code_cat := public.brain_code_category(p_item_code);

  -- coalesce: v_code_cat is NULL for most codes, and NULL = 'tyre' would make this
  -- whole guard NULL rather than false.
  if public.brain_has_any_word(p_description, public.brain_tokens('accessory')) then
    if not (coalesce(v_code_cat,'') = 'tyre'
            and public.brain_has_tyre_size(p_description)) then
      return query select 'spare_part', 'spare', 0.90::numeric, 'accessory';
      return;
    end if;
  end if;

  if public.brain_is_lubricant(p_description) then
    return query select 'lubricant', 'oil', 0.90::numeric, 'description-lubricant';
    return;
  end if;

  -- A named mechanical assembly beats the code range. No size escape hatch:
  -- the size belongs to whatever the part fits, not to a tyre.
  if public.brain_has_any_word(p_description, public.brain_tokens('non_tyre_part')) then
    return query select 'spare_part', 'spare', 0.92::numeric, 'non-tyre-part';
    return;
  end if;

  if v_code_cat is not null then
    return query select v_code_cat, public.material_category_bucket(v_code_cat),
                        0.95::numeric, 'code-range';
    return;
  end if;

  v_says_tyre := coalesce(p_description,'') ~* '\y(tyre|tire)\y';
  if v_says_tyre or (public.brain_has_any_word(p_description, public.brain_tokens('tyre_brand'))
                     and public.brain_has_tyre_size(p_description)) then
    return query select 'tyre', 'tyre', 0.85::numeric,
                        case when v_says_tyre then 'description-tyre' else 'brand-and-size' end;
    return;
  end if;

  if coalesce(p_on_tyre_jobcard, false) and public.brain_has_tyre_size(p_description) then
    return query select 'tyre', 'tyre', 0.70::numeric, 'job-card';
    return;
  end if;

  return query select 'spare_part', 'spare', 0.30::numeric, 'default';
end $fn$;

-- MUST be bumped in the SAME migration as any brain_* rule change. This is what
-- retires the cached answers; forgetting it is the only way the cache can lie.
create or replace function public.brain_rules_version()
returns integer language sql immutable parallel safe set search_path to 'public'
as $fn$ select 4 $fn$;
