-- =====================================================================
-- V400 - THE CLASSIFICATION BRAIN LEARNS FROM HUMAN CORRECTIONS
-- Applied live 2026-07-28 (V400, V400b, V400c, V400d, V400e, V400f,
-- V400g, V400h, V400i, V400j). This file is the record of all ten.
-- =====================================================================
--
-- User: "How we are deciding what needs to keep where, like tyres needs to
-- move, so this much be machine learning and each time it should improve with
-- my changes and learn these things."
--
-- MEASURED BEFORE BUILDING ANYTHING:
--   * 131,436 lines - 61% of all spend - across 15,470 item codes are filed by
--     the DEFAULT at 0.30 confidence. Nothing identifies them.
--   * 646 item codes have been reviewed by a human.
--   * Of those 646, the classifier had ALREADY agreed on 597 = 92.4%.
--     So the 49 disagreements are the entire learning signal, and any design
--     that does not concentrate on them is measuring its own echo.
--
-- =====================================================================
-- THE CLASS-IMBALANCE TRAP, AND WHY SCORING IS ON LIFT
-- =====================================================================
-- 89.6% of reviewed items are spare_part (579 spare / 50 lubricant / 17 tyre).
-- Mining words by how OFTEN they appear beside a category therefore relearns the
-- majority class and calls it knowledge. Measured directly, a frequency-scored
-- run proposed `with`, `water`, `rear` and `fuel` all claiming spare_part - every
-- one at lift 1.12, i.e. no better than guessing the most common answer.
--
-- Scoring is on LIFT = precision / base rate, floored at 1.5. The same run then
-- produced exactly one candidate: `petrol -> lubricant`, precision 100% against a
-- 7.7% base rate, lift 12.92. The floor is what separates signal from noise, and
-- it was chosen after seeing both numbers, not before.
--
-- =====================================================================
-- THE FIRST PROPOSAL WAS RIGHT ABOUT THE EVIDENCE AND WRONG ABOUT THE WORLD
-- =====================================================================
-- `petrol -> lubricant` had 4 supporting reviewed items, 100% precision, lift
-- 12.92. Every number was correct. The rule was still wrong, because all three
-- rows it would have moved name a PART:
--     PETROL WATER PUMP 900 L/MIN     PETROL HOSE     PETROL GUN
-- A fluid word inside a part name describes what the part CARRIES. This is the
-- repo's own V393b finding ("GEAR BOX OIL COOLING HOSES") reproduced by the
-- learner within minutes of it existing.
--
-- Hence two guards, and the second is the one the user actually asked for:
--   1. VETO (V400d) - a fluid rule may not claim a description that names a part.
--      It reuses the EXISTING brain_tokens('oil_part') list rather than starting a
--      second one, so the veto and the classifier can never drift apart. Measured
--      effect on that proposal: impact fell from 3 lines / 7,539.89 to 1 / 28.57,
--      because `pump` and `hose` are already in that list.
--   2. MEMORY (V400d) - a token a human REJECTED is never proposed again.
--      `gun` is not in the oil_part list, so the veto catches two of those three
--      and the human catches the third exactly ONCE, forever.
--
-- =====================================================================
-- WHY `gun` WAS **NOT** ADDED TO THE VETO - the data refused it
-- =====================================================================
-- The obvious move after seeing PETROL GUN was to add `gun` to oil_part. The
-- reviewed data forbids it. Humans have reviewed three gun rows and DISAGREE:
--     GREASE GUN                      -> spare_part   (reviewed)
--     LUBRI-HIGH PRESSURE GREASE GUN  -> lubricant    (reviewed)
--     TYRE INFLATION GUN              -> spare_part   (reviewed)
-- A `gun` veto would overrule a decision a human deliberately made. Across the
-- 63 unreviewed gun rows the ERP is itself inconsistent (14 filed lubricant,
-- the rest spare). So `gun` is genuinely ambiguous in this business, and the
-- honest system behaviour is to put it in front of a person, not to guess.
-- DO NOT add `gun` to oil_part without new evidence.
--
-- =====================================================================
-- WHERE AN ACCEPTED RULE IS APPLIED - the master, never brain_classify
-- =====================================================================
-- apply_learned_rule stamps matched item codes into material_master as REVIEWED
-- rows. It does not touch brain_classify and bumps NO rules version. Reasons:
--   * the classifier ALREADY ranks a reviewed master row above every token
--     (V368), so precedence is inherited rather than re-invented;
--   * brain_classify is IMMUTABLE and cached - reading a rules table from it
--     would break both. brain_cache's key already contains `reviewed`, so a newly
--     reviewed item invalidates exactly its own entry and nothing else;
--   * money moves only through reclassify_from_master, the ONE existing lever,
--     which has a dry run and is undoable by batch;
--   * every learned decision lands as a per-item row a human can see and override
--     individually, instead of an invisible global regex.
-- A learned rule also skips any item a human has ALREADY reviewed: a reviewed
-- decision outranks every token, including one the machine learned.
--
-- =====================================================================
-- WHAT THE LEDGER IMMEDIATELY FOUND (V400j weak spots)
-- =====================================================================
-- A single "92.4% agreement" is not actionable. Broken down by which layer fired:
--   description-tyre  tyre -> spare   22 items  = WRONG 56.4% OF THE TIME IT FIRES
--                                     ("DUAL TYRE CHUCK W/RUBBER" is a tool)
--   default           spare -> oil    16 items  (the default under-finds lubricants)
--   code-range        tyre -> spare    7 items
-- The tyre detector over-claims and the default under-identifies oil. That is a
-- specific, fixable statement. "92.4%" is not.
--
-- =====================================================================
-- BUGS CAUGHT BY TESTING, NOT BY READING
-- =====================================================================
-- 1. V400b's propose_classification_rules TIMED OUT AT 60s for a real user. Its
--    per-candidate subqueries ran a regex over 217k rows once per candidate,
--    roughly 3M evaluations. V400c collapses the unidentified spend to 15,416
--    distinct descriptions ONCE and tokenises that. Returns in well under a second.
--    (It also returned empty in an MCP session for a mundane reason worth knowing:
--    app_current_org() is NULL there. Always impersonate a real user to test it.)
-- 2. V400e wrote status 'accepted' into a column whose CHECK from V400 allows
--    proposed | active | rejected. V400f aligns the RPCs to the existing
--    vocabulary; widening the constraint would leave two words for one state.
-- 3. apply_learned_rule used `on commit drop` for its temp table, so a dry run
--    followed by an apply INSIDE ONE TRANSACTION failed with "relation
--    _learn_apply already exists". This is the V368a bug verbatim. V400g drops
--    the table first. Each PostgREST call is its own transaction so production
--    would not have seen it - but every test does, and the repo has already paid
--    for this lesson once.
--
-- =====================================================================
-- VERIFIED LIVE, ROLLED BACK, AS A REAL AUTHENTICATED USER
-- =====================================================================
--   proposed before any decision ....... 1
--   apply before accept ................ refused
--   human rejects ...................... rejected
--   proposed after reject .............. 0        <- the memory holds
--   human accepts ...................... active
--   dry run items/lines/value .......... 1 / 1 / 28.57
--   dry run wrote nothing .............. 0        <- dry run is truly read-only
--   applied ............................ 1 item
--   master row stamped ................. UAE 316838-O -> lubricant reviewed=true
--   human disagreement logged .......... spare (default) -> oil, agreed=false
--   learned stamp added feedback rows .. 0        <- no self-echo
--
-- =====================================================================

-- ---------------------------------------------------------------------
-- V400 - the feedback ledger and the rule store
-- ---------------------------------------------------------------------
create table if not exists public.classification_feedback (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text,
  item_code text not null,
  description text,
  machine_said text,
  machine_source text,
  machine_conf numeric,
  human_said text not null,
  -- generated, so agreement can never be recorded inconsistently with the pair
  agreed boolean generated always as (not (machine_said is distinct from human_said)) stored,
  source text not null default 'master_review',
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists classification_feedback_org_idx
  on public.classification_feedback (organisation_id, created_at desc);
create index if not exists classification_feedback_item_idx
  on public.classification_feedback (organisation_id, country, item_code);

alter table public.classification_feedback enable row level security;

drop policy if exists classification_feedback_org on public.classification_feedback;
create policy classification_feedback_org on public.classification_feedback
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

drop policy if exists classification_feedback_read on public.classification_feedback;
create policy classification_feedback_read on public.classification_feedback
  for select to authenticated using (public.app_is_active());

-- The ledger is written by the DEFINER trigger, which bypasses RLS, so this
-- policy governs only a direct client insert. Elevated-only: a feedback row is
-- evidence about the classifier and must not be forgeable by an ordinary user.
drop policy if exists classification_feedback_write on public.classification_feedback;
create policy classification_feedback_write on public.classification_feedback
  for insert to authenticated with check (public.app_is_elevated());

create table if not exists public.classification_learned_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  token text not null,
  category text not null,
  support integer,
  precision_pct numeric,
  lift numeric,
  status text not null default 'proposed'
    check (status in ('proposed', 'active', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (organisation_id, token, category)
);

alter table public.classification_learned_rules enable row level security;

drop policy if exists learned_rules_org on public.classification_learned_rules;
create policy learned_rules_org on public.classification_learned_rules
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

drop policy if exists learned_rules_read on public.classification_learned_rules;
create policy learned_rules_read on public.classification_learned_rules
  for select to authenticated using (public.app_is_active());

drop policy if exists learned_rules_write on public.classification_learned_rules;
create policy learned_rules_write on public.classification_learned_rules
  for all to authenticated
  using (public.app_is_elevated()) with check (public.app_is_elevated());

-- Words that carry no category signal. Mining them produces noise that LOOKS
-- like a rule because they are common, which is exactly the trap above.
create or replace function public.brain_stopwords()
returns text[]
language sql immutable
set search_path to 'public'
as $$
  select array[
    'with','for','and','the','from','type','size','set','kit','new','used','item',
    'part','parts','assy','assembly','unit','pcs','each','high','low','left','right',
    'front','rear','upper','lower','inner','outer','small','large','main','sub',
    'model','series','grade','black','white','blue','green','red','yellow'
  ];
$$;

-- ---------------------------------------------------------------------
-- V400d - the part-noun veto
-- ---------------------------------------------------------------------
create or replace function public.learned_rule_vetoed(p_text text, p_category text)
returns boolean
language sql immutable parallel safe
set search_path to 'public'
as $$
  select case
    when p_category in ('lubricant', 'oil', 'fuel')
      then public.brain_has_any_word(p_text, public.brain_tokens('oil_part'))
    else false
  end;
$$;

comment on function public.learned_rule_vetoed(text, text) is
  'V400d: a fluid rule may not claim a description that names a part. Reuses brain_tokens(''oil_part'') so the veto cannot drift from the classifier.';

-- ---------------------------------------------------------------------
-- V400c/d - propose, scored on lift, vetoed, and with rejection memory
-- ---------------------------------------------------------------------
create or replace function public.propose_classification_rules(
  p_min_support integer default 4,
  p_min_precision numeric default 0.85,
  p_min_lift numeric default 1.5,
  p_limit integer default 40)
returns table(token text, category text, support integer, precision_pct numeric,
              base_rate_pct numeric, lift numeric, affects_lines bigint,
              affects_value numeric, sample text)
language sql stable security definer
set search_path to 'public'
as $$
with org as (select public.app_current_org() as id),
reviewed as (
  select item_code, category, lower(coalesce(item_name, '')) as descr
  from public.material_master
  where organisation_id = (select id from org)
    and reviewed is true and category is not null
),
base as (
  select category, count(*)::numeric / nullif((select count(*) from reviewed), 0) as rate
  from reviewed group by category
),
words as (
  select r.category, w.token
  from reviewed r,
       lateral unnest(regexp_split_to_array(regexp_replace(r.descr, '[^a-z0-9 ]', ' ', 'g'), '\s+')) as w(token)
  where length(w.token) >= 4
    and w.token <> all (public.brain_stopwords())
    and w.token !~ '^[0-9]+$'
),
per_token     as (select token, count(*) as n from words group by token),
per_token_cat as (select token, category, count(*) as n from words group by token, category),
scored as (
  select ptc.token, ptc.category, ptc.n::int as support,
         round(100.0 * ptc.n / pt.n, 1) as precision_pct,
         round(100.0 * b.rate, 1) as base_rate_pct,
         round((ptc.n::numeric / pt.n) / nullif(b.rate, 0), 2) as lift
  from per_token_cat ptc
  join per_token pt using (token)
  join base b on b.category = ptc.category
  where ptc.n >= p_min_support
    and (ptc.n::numeric / pt.n) >= p_min_precision
    and (ptc.n::numeric / pt.n) / nullif(b.rate, 0) >= p_min_lift
),
fresh as (
  -- A token already decided - accepted OR REJECTED - never comes back. The
  -- rejection half is what makes this learn from the user rather than nag them.
  select s.* from scored s
  where not exists (
    select 1 from public.classification_learned_rules lr
    where lr.organisation_id = (select id from org)
      and lr.token = s.token and lr.category = s.category)
),
-- ONE pass. Per-candidate subqueries over 217k rows timed out at 60s.
unidentified as materialized (
  select lower(coalesce(item_description, '')) as descr,
         count(*) as lines, coalesce(sum(line_cost), 0) as value,
         min(item_description) as sample
  from public.parts_consumption
  where organisation_id = (select id from org) and classified_by = 'default'
  group by 1
),
uni_tokens as materialized (
  select w.token, u.descr, u.lines, u.value, u.sample
  from unidentified u,
       lateral unnest(regexp_split_to_array(regexp_replace(u.descr, '[^a-z0-9 ]', ' ', 'g'), '\s+')) as w(token)
  where length(w.token) >= 4
),
-- Impact counts only rows the rule may actually claim. A vetoed row is not
-- impact; counting it would advertise a saving the rule will never make.
impact as (
  select t.token, f.category,
         sum(t.lines) as lines, sum(t.value) as value, min(t.sample) as sample
  from uni_tokens t
  join fresh f on f.token = t.token
  where not public.learned_rule_vetoed(t.descr, f.category)
  group by t.token, f.category
)
select f.token, f.category, f.support, f.precision_pct, f.base_rate_pct, f.lift,
       i.lines as affects_lines, round(i.value, 2) as affects_value, i.sample
from fresh f
join impact i on i.token = f.token and i.category = f.category
order by i.value desc nulls last, f.lift desc
limit p_limit;
$$;

create or replace function public.preview_learned_rule(p_token text, p_category text,
                                                       p_limit integer default 50)
returns table(item_code text, item_description text, country text,
              lines bigint, value numeric)
language sql stable security definer
set search_path to 'public'
as $$
  select pc.item_code, min(pc.item_description) as item_description, pc.country,
         count(*) as lines, round(coalesce(sum(pc.line_cost), 0), 2) as value
  from public.parts_consumption pc
  where pc.organisation_id = public.app_current_org()
    and pc.classified_by = 'default'
    and public.brain_has_any_word(pc.item_description, array[lower(btrim(p_token))])
    and not public.learned_rule_vetoed(pc.item_description, p_category)
  group by pc.item_code, pc.country
  order by value desc
  limit greatest(1, coalesce(p_limit, 50));
$$;

-- ---------------------------------------------------------------------
-- V400e/f - the human decision
-- ---------------------------------------------------------------------
create or replace function public.decide_classification_rule(
  p_token text, p_category text, p_action text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_org uuid := public.app_current_org();
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_row public.classification_learned_rules;
begin
  if v_org is null then
    raise exception 'No organisation in session' using errcode = '42501';
  end if;
  if public.app_role() not in ('admin', 'manager', 'director')
     and not public.is_super_admin() then
    raise exception 'You do not have permission to decide classification rules'
      using errcode = '42501';
  end if;
  if v_token = '' or coalesce(p_category, '') = '' then
    raise exception 'A token and a category are required' using errcode = '22023';
  end if;
  if v_action not in ('accept', 'reject') then
    raise exception 'Action must be accept or reject' using errcode = '22023';
  end if;

  insert into public.classification_learned_rules
         (organisation_id, token, category, status, decided_by, decided_at, note)
  values (v_org, v_token, p_category,
          case when v_action = 'accept' then 'active' else 'rejected' end,
          auth.uid(), now(), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (organisation_id, token, category) do update
     set status = excluded.status,
         decided_by = excluded.decided_by,
         decided_at = excluded.decided_at,
         note = coalesce(excluded.note, public.classification_learned_rules.note)
  returning * into v_row;

  return jsonb_build_object('ok', true, 'token', v_row.token,
                            'category', v_row.category, 'status', v_row.status);
end $$;

-- ---------------------------------------------------------------------
-- V400e/g - apply an accepted rule THROUGH THE MASTER
-- ---------------------------------------------------------------------
create or replace function public.apply_learned_rule(
  p_token text, p_category text, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_org uuid := public.app_current_org();
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_status text;
  v_items int := 0;
  v_lines bigint := 0;
  v_value numeric := 0;
begin
  if v_org is null then
    raise exception 'No organisation in session' using errcode = '42501';
  end if;
  if public.app_role() not in ('admin', 'manager', 'director')
     and not public.is_super_admin() then
    raise exception 'You do not have permission to apply classification rules'
      using errcode = '42501';
  end if;

  select status into v_status
    from public.classification_learned_rules
   where organisation_id = v_org and token = v_token and category = p_category;

  if v_status is distinct from 'active' then
    raise exception 'This rule has not been accepted' using errcode = '42501';
  end if;

  -- V368a lesson: `on commit drop` fires at COMMIT, so dry-run-then-apply in one
  -- transaction collides. Drop first.
  drop table if exists _learn_apply;

  -- WHOLE WORD only (the 'Shell RIMula matched rim' lesson), veto applied, and
  -- never an item a human has already reviewed - that decision outranks a token.
  create temp table _learn_apply as
  select pc.country, pc.item_code,
         min(pc.item_description) as item_name,
         count(*) as lines,
         coalesce(sum(pc.line_cost), 0) as value
  from public.parts_consumption pc
  where pc.organisation_id = v_org
    and pc.classified_by = 'default'
    and public.brain_has_any_word(pc.item_description, array[v_token])
    and not public.learned_rule_vetoed(pc.item_description, p_category)
    and not exists (
      select 1 from public.material_master mm
      where mm.organisation_id = v_org
        and mm.country = pc.country
        and mm.item_code = pc.item_code
        and mm.reviewed is true)
  group by pc.country, pc.item_code;

  select count(*), coalesce(sum(lines), 0), coalesce(sum(value), 0)
    into v_items, v_lines, v_value from _learn_apply;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dry_run', true, 'token', v_token, 'category', p_category,
      'items', v_items, 'lines', v_lines, 'value', round(v_value, 2),
      'preview', coalesce((
        select jsonb_agg(jsonb_build_object('country', country, 'item_code', item_code,
                                            'item_name', item_name, 'lines', lines,
                                            'value', round(value, 2))
                          order by value desc)
        from (select * from _learn_apply order by value desc limit 25) t), '[]'::jsonb));
  end if;

  insert into public.material_master
         (organisation_id, country, item_code, item_name, category,
          reviewed, reviewed_by, reviewed_at, proposed_from)
  select v_org, country, item_code, item_name, p_category,
         true, auth.uid(), now(), 'learned:' || v_token
  from _learn_apply
  on conflict (organisation_id, country, item_code) do update
     set category = excluded.category,
         reviewed = true,
         reviewed_by = excluded.reviewed_by,
         reviewed_at = excluded.reviewed_at,
         proposed_from = excluded.proposed_from
   where public.material_master.reviewed is not true;

  return jsonb_build_object(
    'ok', true, 'dry_run', false, 'token', v_token, 'category', p_category,
    'items', v_items, 'lines', v_lines, 'value', round(v_value, 2),
    'next', 'Run reclassify_from_master to move the loaded money.');
end $$;

-- ---------------------------------------------------------------------
-- V400h - capture every human correction, from every surface
-- ---------------------------------------------------------------------
-- A trigger rather than a call in each caller: items get reviewed from the
-- Material Master page, the Decisions panel and apply_learned_rule, and asking
-- each to also log feedback guarantees one eventually forgets - after which the
-- accuracy figure quietly flatters itself.
create or replace function public.capture_classification_feedback()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_machine record;
begin
  if NEW.reviewed is not true or NEW.category is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE'
     and OLD.reviewed is true
     and OLD.category is not distinct from NEW.category then
    return NEW;                       -- nothing about the decision changed
  end if;
  if coalesce(NEW.proposed_from, '') like 'learned:%' then
    return NEW;                       -- the machine's own echo, not a human
  end if;

  select b.bucket, b.decided_by, b.confidence into v_machine
    from public.brain_classify(NEW.item_code, NEW.item_name, null, false) b;

  insert into public.classification_feedback
         (organisation_id, country, item_code, description,
          machine_said, machine_source, machine_conf, human_said, source)
  values (NEW.organisation_id, NEW.country, NEW.item_code, NEW.item_name,
          v_machine.bucket, v_machine.decided_by, v_machine.confidence,
          public.material_category_bucket(NEW.category), 'master_review');

  return NEW;
exception when others then
  -- Feedback is a measurement, never a gate.
  return NEW;
end $$;

drop trigger if exists trg_capture_classification_feedback on public.material_master;
create trigger trg_capture_classification_feedback
  after insert or update on public.material_master
  for each row execute function public.capture_classification_feedback();

-- ---------------------------------------------------------------------
-- V400b/j - is it improving, and which layer is wrong
-- ---------------------------------------------------------------------
create or replace function public.classification_accuracy()
returns table(period text, corrections bigint, agreed bigint, agreement_pct numeric)
language sql stable security definer
set search_path to 'public'
as $$
  select to_char(date_trunc('month', created_at), 'YYYY-MM') as period,
         count(*) as corrections,
         count(*) filter (where agreed) as agreed,
         round(100.0 * count(*) filter (where agreed) / nullif(count(*), 0), 1) as agreement_pct
  from public.classification_feedback
  where organisation_id = public.app_current_org()
  group by 1 order by 1;
$$;

create or replace function public.classification_weak_spots(p_limit integer default 20)
returns table(machine_source text, machine_said text, human_said text,
              items bigint, share_of_source_pct numeric, sample text)
language sql stable security definer
set search_path to 'public'
as $$
with mine as (
  select * from public.classification_feedback
  where organisation_id = public.app_current_org()
),
per_source as (select machine_source, count(*) as n from mine group by machine_source)
select m.machine_source, m.machine_said, m.human_said,
       count(*) as items,
       round(100.0 * count(*) / nullif(ps.n, 0), 1) as share_of_source_pct,
       min(m.description) as sample
from mine m
join per_source ps on ps.machine_source is not distinct from m.machine_source
where m.agreed is false
group by m.machine_source, m.machine_said, m.human_said, ps.n
order by items desc
limit greatest(1, coalesce(p_limit, 20));
$$;

-- ---------------------------------------------------------------------
-- V400i - seed the ledger from the reviews already made
-- ---------------------------------------------------------------------
-- Without this the accuracy chart starts empty and the first correction reads as
-- "0% agreement", the opposite of the truth. created_at comes from reviewed_at,
-- NOT now(): stamping every historical review with today would compress days of
-- decisions into one point and make the trend a fiction.
insert into public.classification_feedback
       (organisation_id, country, item_code, description,
        machine_said, machine_source, machine_conf, human_said, source, note, created_at)
select mm.organisation_id, mm.country, mm.item_code, mm.item_name,
       b.bucket, b.decided_by, b.confidence,
       public.material_category_bucket(mm.category),
       'master_review',
       'baseline from reviews made before the ledger existed',
       coalesce(mm.reviewed_at, mm.updated_at, mm.created_at, now())
from public.material_master mm
cross join lateral public.brain_classify(mm.item_code, mm.item_name, null, false) b
where mm.reviewed is true
  and mm.category is not null
  and coalesce(mm.proposed_from, '') not like 'learned:%'
  and not exists (
    select 1 from public.classification_feedback cf
    where cf.organisation_id = mm.organisation_id
      and cf.country is not distinct from mm.country
      and cf.item_code = mm.item_code);

-- ---------------------------------------------------------------------
-- Grants - every entry point takes NO org argument and resolves it from the
-- session (the V378 cross-tenant lesson).
-- ---------------------------------------------------------------------
revoke all on function public.propose_classification_rules(integer, numeric, numeric, integer) from public, anon;
revoke all on function public.preview_learned_rule(text, text, integer) from public, anon;
revoke all on function public.learned_rule_vetoed(text, text) from public, anon;
revoke all on function public.decide_classification_rule(text, text, text, text) from public, anon;
revoke all on function public.apply_learned_rule(text, text, boolean) from public, anon;
revoke all on function public.classification_accuracy() from public, anon;
revoke all on function public.classification_weak_spots(integer) from public, anon;
-- V400k: a trigger function cannot usefully be called directly and anon holds no
-- table grants since V281, but a DEFINER function executable by anon is the shape
-- of the V378 cross-tenant hole and must not be left around to be copied.
revoke all on function public.capture_classification_feedback() from public, anon;

grant execute on function public.propose_classification_rules(integer, numeric, numeric, integer) to authenticated;
grant execute on function public.preview_learned_rule(text, text, integer) to authenticated;
grant execute on function public.learned_rule_vetoed(text, text) to authenticated;
grant execute on function public.decide_classification_rule(text, text, text, text) to authenticated;
grant execute on function public.apply_learned_rule(text, text, boolean) to authenticated;
grant execute on function public.classification_accuracy() to authenticated;
grant execute on function public.classification_weak_spots(integer) to authenticated;

-- =====================================================================
-- UNDO
--   drop trigger trg_capture_classification_feedback on public.material_master;
--   drop function public.capture_classification_feedback();
--   drop function public.propose_classification_rules(integer, numeric, numeric, integer);
--   drop function public.preview_learned_rule(text, text, integer);
--   drop function public.decide_classification_rule(text, text, text, text);
--   drop function public.apply_learned_rule(text, text, boolean);
--   drop function public.classification_weak_spots(integer);
--   drop function public.classification_accuracy();
--   drop function public.learned_rule_vetoed(text, text);
--   drop table public.classification_learned_rules;
--   drop table public.classification_feedback;
-- Rows already stamped by a learned rule keep proposed_from = 'learned:<token>'
-- and are found with:
--   select * from material_master where proposed_from like 'learned:%';
-- =====================================================================
