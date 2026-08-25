-- ============================================================================
-- V608. Repair Request (RFR) - the request a driver or operator raises BEFORE
--       a job card exists, and the governed conversion into one.
--
-- STATUS: AUTHORED - NOT YET APPLIED.
--   Nothing in this file has been run against jhssdmeruxtrlqnwfksc. Every
--   statement below was PARSED and BEHAVIOURALLY EXERCISED inside a
--   `begin; ... rollback;` transaction on the live database (see the VERIFY
--   block at the foot for what was proven and what the rollback confirmed),
--   but the database is unchanged. Apply deliberately.
--
-- ---------------------------------------------------------------------------
-- WHY THIS TABLE EXISTS
-- ---------------------------------------------------------------------------
-- The workshop flow starts one step EARLIER than anything the system models.
-- Somebody in the field says "this machine has a fault"; that is the Repair
-- Request. Only after somebody in the workshop accepts it does a job card get
-- raised. Today the app can only record the SECOND half of that: `work_orders`
-- carries `rfr_no` (V381) and `custom_data.raised_by` / `custom_data.raised_at`
-- (V385), which is the ERP telling us, after the fact, that a request once
-- existed. There is nowhere to FILE one, nowhere for it to sit unanswered, and
-- no way to see how long a machine waited before anybody opened a card.
--
-- That gap is exactly the one the availability flow already exposes (V605):
-- Production Out -> Workshop In is a SCHEDULING gap, and a request nobody
-- actioned is the most common reason for it. Measuring it needs the request.
--
-- ---------------------------------------------------------------------------
-- MEASURED LIVE 2026-08-24 (jhssdmeruxtrlqnwfksc) - read this before changing
-- the minting format, because three of the obvious assumptions are WRONG.
-- ---------------------------------------------------------------------------
-- `work_orders` holds 90,535 job cards; 57,192 carry an `rfr_no`, and all
-- 57,192 are distinct. `custom_data.raised_by` / `raised_at` coverage is also
-- 57,192, so every recorded RFR carries who raised it and when.
--
-- (1) THE ENTITY PREFIX IS NOT ONE PER COUNTRY, AND IT IS NOT `GCEG`.
--     Counted over the 57,192:
--         KSA    GC   53,877   Gc  2,031   gc  36   gC  2      AK  185
--         UAE    RM      786
--         Egypt  EG      275
--     So the operating entity, not the country, owns the prefix: GC in KSA,
--     RM in UAE, EG in Egypt, plus a second KSA entity `AK` whose 185 cards
--     are all `AK/RFR/nnnn/0122`. Note also 2,069 KSA cards carry the prefix in
--     mixed case (Gc / gc / gC) - the V245/V246 casing-split class, live in
--     this column today. Minting therefore UPPER-cases the prefix, and the
--     prefix comes from a config table, not from a hard-coded country map.
--
-- (2) THE PERIOD SUFFIX IS NOT ALWAYS MMYY, AND THE SEQUENCE DOES NOT ALWAYS
--     RESET MONTHLY. KSA is `GC/RFR/0948/1225` = 4-digit MMYY, and the
--     sequence genuinely restarts each month (measured: 0322 runs 1..143,
--     0422 runs 1..96, 0522 runs 1..162, 1222 runs 1..316 - twelve consecutive
--     months each starting at or near 1). Egypt and UAE do NOT: they are
--     `EG/RFR/1985/26` and `RM/RFR/5809/26` - a 2-digit YEAR - and their
--     sequences run straight through the month boundary (Egypt 1985 -> 2261
--     and UAE 5809 -> 6617, both spanning 2026-07 and 2026-08 under the single
--     suffix `26`). A single hard-coded MMYY would mint Egypt and UAE numbers
--     in a shape their own ERP does not use, and would reset a counter their
--     ERP does not reset. Hence `period_mode` ('month' | 'year') per config row.
--
-- (2b) CASE-FOLDING `rfr_no` IS PROVABLY SAFE - MEASURED, NOT ASSUMED, so
--     whoever decides to clean the historical column has the evidence rather
--     than re-deriving it. Over the 57,192 job cards that carry an rfr_no:
--         distinct raw values                    57,192
--         distinct upper(btrim(...)) values      57,192
--         collision groups created by folding         0
--     Folding therefore CANNOT merge two real RFRs - there is not one pair of
--     values that differ only by case. Rows a fold would rewrite: **2,084**,
--     every one KSA, every one PURE CASE (rows differing by whitespace: 0).
--
--     CORRECTION TO THE FIGURE THAT WAS CIRCULATING (2,069): counting by the
--     ENTITY PREFIX alone misses 15 rows, because the `RFR` token itself is
--     also mis-cased. The real breakdown:
--         Gc/RFR 1,990 · gc/rfr 23 · Gc/Rfr 13 · gc/RFR 13 · Gc/rfr 13
--         Gc/RfR 8 · Gc/RFr 7 · gC/RFR 2                      = 2,069  (prefix wrong)
--         GC/RfR 8 · GC/Rfr 3 · GC/rfr 2 · GC/RFr 2           =    15  (prefix RIGHT,
--                                                                       token wrong)
--                                                             = 2,084  total
--     A backfill keyed on the prefix would leave those 15 behind. Fold the
--     WHOLE string.
--
--     NO BACKFILL IS APPLIED HERE. This migration does not touch
--     `work_orders.rfr_no`; the note exists so the decision is informed.
--     Going forward the split cannot GROW: `next_rfr_no` builds the number from
--     `upper(btrim(entity_prefix))` and a literal uppercase '/RFR/', and the
--     mint trigger UPPER-cases any client-supplied rfr_no, so both write paths
--     are canonical.
--
-- (3) NOTHING IS BACKFILLED, AND THAT IS DELIBERATE.
--     It is tempting to mint 57,192 historical `repair_requests` rows from the
--     job cards that carry an `rfr_no`. It is not honest. All the ERP gave us
--     is a NUMBER plus a name and a date string; we never observed the fault
--     text, the site, the meter reading, the photographs, or the moment the
--     request was acknowledged. Manufacturing rows would fabricate a submission
--     nobody made, and every "time from request to card" figure computed off
--     them would be an artefact of this migration rather than a measurement.
--     Historical RFRs stay exactly where they are - readable on the job card
--     via `work_orders.rfr_no` - and this table governs NEW requests only.
--     `jobCard.js` already surfaces rfr_no / raised_by / raised_at read-only,
--     so nothing is lost from the existing screens.
--
-- ---------------------------------------------------------------------------
-- THE TRAP THIS FILE AVOIDS
-- ---------------------------------------------------------------------------
-- `next_rfr_no` takes a `p_org` argument and is SECURITY DEFINER. That is the
-- V596 shape exactly: when `next_checklist_document_no` shipped with the
-- Supabase default PUBLIC EXECUTE grant, any signed-in user could increment
-- ANOTHER tenant's counter. So this file REVOKES EXECUTE on the minting
-- function from PUBLIC, then from anon, then from authenticated, BY NAME and
-- IN THAT ORDER (V500: a revoke from anon is a no-op against a PUBLIC grant,
-- and revoking PUBLIC alone also strips authenticated). Minting still works,
-- because the BEFORE INSERT trigger is itself SECURITY DEFINER owned by
-- postgres and reaches the function through OWNERSHIP, not through a grant -
-- the same mechanism V596 measured and relied on. `checklist_doc_counters`
-- was checked live and is the model: RLS enabled, ZERO policies, and grants to
-- postgres and service_role only. The counter table here is identical.
--
-- The second trap is `work_orders.opened_at`. It is NOT NULL with a `now()`
-- default, and a column default does NOT apply when the client sends an
-- explicit NULL - that is the V419 defect that aborted whole CSV batches at
-- zero rows. `convert_repair_request_to_job_card` therefore always passes
-- `coalesce(r.reported_at, now())`, never a bare column reference.
--
-- The third is `work_orders.total_cost`, which is a GENERATED column. It never
-- appears in any insert here.
--
-- ---------------------------------------------------------------------------
-- TIME TO ACKNOWLEDGE - why it needs its own column, and why the server owns it
-- ---------------------------------------------------------------------------
-- "How long did a request sit before anybody picked it up" is the headline SLA
-- for this module, and it is NOT derivable from anything else on the row:
--   * `updated_at` moves on EVERY later edit, so a request acknowledged in ten
--     minutes and edited a week later would report a week. That is not a
--     slower number, it is a WRONG one, and it flatters or damns at random.
--   * `converted_at` measures a different thing (time to raise a job card) and
--     is null for everything still open.
-- So `acknowledged_at` / `acknowledged_by` are real columns, and the reading is
-- honestly absent rather than approximated when nobody has acknowledged yet.
--
-- THE SERVER STAMPS THEM. `trg_repair_requests_ack` derives both from `now()`
-- and `auth.uid()` on the transition INTO 'acknowledged' and DISCARDS whatever
-- the client sent, exactly as `convert_repair_request_to_job_card` derives
-- converted_at/by. An SLA a client can backdate is not an SLA. The client's own
-- `REPAIR_REQUEST_EDITABLE_COLS` already omits both, so this makes the database
-- agree with the contract the app is already written to.
--
-- FIRST ACKNOWLEDGEMENT WINS. Once `acknowledged_at` is set the trigger carries
-- the old value forward on every subsequent update, so a re-acknowledge, a
-- bounce back to 'submitted' and forward again, or any unrelated later edit
-- cannot move it. Without that rule the figure silently improves every time
-- somebody touches the row.
--
-- *** A DIRECT submitted -> converted DOES NOT STAMP AN ACKNOWLEDGEMENT. ***
-- This is a deliberate decision, and it reverses what the first draft of this
-- file did (it coalesced acknowledged_at to now() inside the conversion, which
-- would have manufactured an acknowledgement that never happened and made
-- time-to-acknowledge equal time-to-convert for every such row - a fabricated
-- measurement, which is worse than a missing one). The conversion leaves both
-- columns null. Consequence, stated so nobody reads it as a bug: for a request
-- converted straight from 'submitted', time-to-acknowledge is UNKNOWN and the
-- client reports it as unmeasured, while time-to-convert still measures fine.
-- `medianHoursToAcknowledge` in src/lib/repairRequests.js is already null-safe
-- and publishes `acknowledgeMeasured` alongside it, so a partial denominator is
-- visible rather than hidden.
--   NOTE the server is deliberately MORE permissive than the client here: the
--   engine's STATUS_FLOW only offers submitted -> acknowledged|rejected|
--   cancelled, so the app will not normally convert straight from submitted;
--   the RPC still allows it because a supervisor raising and immediately
--   carding a breakdown is real, and refusing it would block a genuine action.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
--   drop trigger  if exists trg_repair_requests_ack on public.repair_requests;
--   drop function if exists public.repair_request_stamp_acknowledged();
--   drop function if exists public.convert_repair_request_to_job_card(uuid,text,text,timestamptz);
--   drop trigger  if exists trg_repair_requests_mint_rfr   on public.repair_requests;
--   drop trigger  if exists trg_repair_requests_touch      on public.repair_requests;
--   drop trigger  if exists trg_zz_normalize_site_rr       on public.repair_requests;
--   drop function if exists public.repair_request_mint_rfr();
--   drop function if exists public.next_rfr_no(uuid,text,timestamptz);
--   drop table    if exists public.repair_requests;
--   drop table    if exists public.repair_request_counters;
--   drop table    if exists public.repair_request_number_config;
-- Nothing outside these objects is touched: no existing table gains a column,
-- no existing function is replaced, no existing policy is dropped. The blast
-- radius of applying this file is entirely new objects.
-- ============================================================================


-- ── 1. Number configuration ────────────────────────────────────────────────
-- Per (org, country) the entity prefix and whether the sequence resets monthly
-- or annually. A row is CONFIGURATION, not a guess: the three seeded rows are
-- the shapes measured in the live data above. A country with no row falls back
-- to the defaults in `next_rfr_no`, so an unconfigured fourth country still
-- mints a usable number instead of failing the insert.
create table if not exists public.repair_request_number_config (
  organisation_id uuid not null default public.app_current_org(),
  country         text not null,
  entity_prefix   text not null,
  period_mode     text not null default 'month',
  seq_width       integer not null default 4,
  updated_at      timestamptz not null default now(),
  primary key (organisation_id, country),
  constraint repair_request_number_config_period_mode_check
    check (period_mode in ('month','year')),
  constraint repair_request_number_config_seq_width_check
    check (seq_width between 3 and 8),
  constraint repair_request_number_config_prefix_check
    check (btrim(entity_prefix) <> '')
);

comment on table public.repair_request_number_config is
  'Per (org, country) RFR number shape. entity_prefix is the operating entity (GC in KSA, RM in UAE, EG in Egypt - measured live over 57,192 job cards, not assumed). period_mode says whether the sequence resets monthly (KSA, suffix MMYY) or annually (UAE and Egypt, suffix YY).';

alter table public.repair_request_number_config enable row level security;

-- Readable by any active member of the org so a client can show the shape it
-- is about to mint; writable only by elevated roles. RESTRICTIVE org isolation
-- carries the expression in BOTH clauses (V542: a SELECT-only restrictive
-- policy governs reads and says nothing whatever about a row being written).
drop policy if exists rr_number_config_org_isolation on public.repair_request_number_config;
create policy rr_number_config_org_isolation on public.repair_request_number_config
  as restrictive for all
  using      (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));

drop policy if exists rr_number_config_select on public.repair_request_number_config;
create policy rr_number_config_select on public.repair_request_number_config
  for select using (public.app_is_active());

drop policy if exists rr_number_config_write on public.repair_request_number_config;
create policy rr_number_config_write on public.repair_request_number_config
  for all
  using      (public.app_is_elevated())
  with check (public.app_is_elevated());

-- Seed the three measured shapes for every organisation that already holds
-- job cards, so the config is never empty on a database that has data.
insert into public.repair_request_number_config
       (organisation_id, country, entity_prefix, period_mode, seq_width)
select o.organisation_id, v.country, v.entity_prefix, v.period_mode, 4
  from (select distinct organisation_id from public.work_orders) o
 cross join (values
        ('KSA',   'GC', 'month'),   -- GC/RFR/0948/1225, sequence restarts each month
        ('UAE',   'RM', 'year' ),   -- RM/RFR/5809/26,   sequence runs through the year
        ('Egypt', 'EG', 'year' )    -- EG/RFR/1985/26,   sequence runs through the year
      ) as v(country, entity_prefix, period_mode)
on conflict (organisation_id, country) do nothing;


-- ── 2. Counter ─────────────────────────────────────────────────────────────
-- Deny-all by construction: RLS on with NO policies and no grant to
-- authenticated, exactly like `checklist_doc_counters` (verified live: its only
-- grants are postgres and service_role). The only thing that ever touches it is
-- the DEFINER minting function, reached by ownership.
create table if not exists public.repair_request_counters (
  organisation_id uuid not null,
  country         text not null,
  prefix          text not null,
  period_key      text not null,   -- 'MMYY' when period_mode='month', 'YY' when 'year'
  seq             integer not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (organisation_id, country, prefix, period_key)
);

comment on table public.repair_request_counters is
  'RFR sequence per (org, country, prefix, period). Deny-all: RLS enabled with no policies and no grant to authenticated - only next_rfr_no() reaches it, and only through ownership. Mirrors checklist_doc_counters (V594).';

alter table public.repair_request_counters enable row level security;
revoke all on public.repair_request_counters from public, anon, authenticated;


-- ── 3. The minting function ────────────────────────────────────────────────
-- Emits the ERP's own shape: <PREFIX>/RFR/<zero-padded seq>/<period>.
--   KSA    period_mode 'month' -> 'GC/RFR/0949/1225'
--   UAE    period_mode 'year'  -> 'RM/RFR/6618/26'
--   Egypt  period_mode 'year'  -> 'EG/RFR/2262/26'
-- The prefix is UPPER-cased on the way out because the live column already
-- carries 2,069 mixed-case KSA values (Gc / gc / gC) and a new number must not
-- add to that split.
create or replace function public.next_rfr_no(
  p_org     uuid,
  p_country text,
  p_when    timestamptz default now()
) returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_prefix text;
  v_mode   text;
  v_width  integer;
  v_period text;
  v_seq    integer;
begin
  if p_org is null then
    return null;
  end if;

  select upper(btrim(c.entity_prefix)), c.period_mode, c.seq_width
    into v_prefix, v_mode, v_width
    from public.repair_request_number_config c
   where c.organisation_id = p_org
     and lower(btrim(c.country)) = lower(btrim(coalesce(p_country, '')));

  -- No configuration row: fall back to a usable default rather than refusing
  -- the insert. 'GC' + monthly is the majority shape (53,877 of 57,192).
  if v_prefix is null then
    v_prefix := 'GC';
    v_mode   := 'month';
    v_width  := 4;
  end if;

  v_period := case when v_mode = 'year'
                   then to_char(coalesce(p_when, now()), 'YY')
                   else to_char(coalesce(p_when, now()), 'MMYY')
              end;

  insert into public.repair_request_counters
         (organisation_id, country, prefix, period_key, seq)
  values (p_org, upper(btrim(coalesce(p_country, ''))), v_prefix, v_period, 1)
  on conflict (organisation_id, country, prefix, period_key)
  do update set seq        = public.repair_request_counters.seq + 1,
                updated_at = now()
  returning seq into v_seq;

  return v_prefix || '/RFR/' || lpad(v_seq::text, v_width, '0') || '/' || v_period;
end;
$fn$;

comment on function public.next_rfr_no(uuid,text,timestamptz) is
  'Mints the next RFR number for an org+country. SECURITY DEFINER and takes an org id, so EXECUTE is revoked from PUBLIC, anon AND authenticated (V596): the BEFORE INSERT trigger reaches it through ownership, not a grant.';

-- V500 ordering. A revoke from anon is a no-op against a PUBLIC grant, and
-- revoking PUBLIC alone would also strip authenticated - so revoke PUBLIC
-- first, then each role by name. Nothing but the trigger needs to call this.
revoke execute on function public.next_rfr_no(uuid,text,timestamptz) from public;
revoke execute on function public.next_rfr_no(uuid,text,timestamptz) from anon;
revoke execute on function public.next_rfr_no(uuid,text,timestamptz) from authenticated;
grant  execute on function public.next_rfr_no(uuid,text,timestamptz) to service_role;


-- ── 4. The request itself ──────────────────────────────────────────────────
create table if not exists public.repair_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null default public.app_current_org(),
  country           text,
  site              text,

  rfr_no            text,                       -- minted on insert when null

  -- what is broken
  asset_no          text not null,
  plate_no          text,
  asset_description text,
  odometer          numeric,
  engine_hours      numeric,
  fault_category    text,
  description       text not null,              -- the complaint. The reason the request exists.
  priority          text not null default 'Medium',
  status            text not null default 'submitted',

  -- who said so
  reported_by       uuid default auth.uid(),
  reported_by_name  text,
  reported_at       timestamptz not null default now(),
  photos            jsonb not null default '[]'::jsonb,
  signature         text,

  -- what happened to it
  -- Server-stamped by trg_repair_requests_ack; a client-supplied value is
  -- discarded. First acknowledgement wins - see the header.
  acknowledged_at   timestamptz,
  acknowledged_by   uuid,
  work_order_no     text,                       -- THE LINK: the job card it became
  converted_at      timestamptz,
  converted_by      uuid,
  rejected_reason   text,

  client_uuid       text,                       -- mobile offline idempotency
  custom_data       jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Status ladder. Deliberately small: these are the only five states a
  -- request can genuinely be in. `converted` is terminal-with-a-link,
  -- `rejected` and `cancelled` are terminal-without-one.
  constraint repair_requests_status_check
    check (status in ('submitted','acknowledged','converted','rejected','cancelled')),

  -- MUST stay a SUBSET of work_orders_priority_check (verified live:
  -- Low / Medium / High / Critical) and of JOB_CARD_PRIORITIES in
  -- src/lib/jobCard.js, or a converted request hands the card a priority the
  -- CHECK refuses and the conversion dies on a raw 23514.
  constraint repair_requests_priority_check
    check (priority in ('Low','Medium','High','Critical')),

  -- A converted request must carry the card it became; an unconverted one
  -- must not claim a conversion. This is what stops "converted" becoming a
  -- status somebody sets by hand with nothing on the other end of it.
  constraint repair_requests_converted_link_check
    check (
      (status = 'converted' and work_order_no is not null and converted_at is not null)
      or
      (status <> 'converted')
    ),

  constraint repair_requests_rejected_reason_check
    check (status <> 'rejected' or nullif(btrim(coalesce(rejected_reason,'')),'') is not null),

  -- A row sitting AT 'acknowledged' must carry the moment it happened, or the
  -- SLA denominator is quietly wrong. The trigger guarantees this; the
  -- constraint states the invariant in the schema so a bulk load that runs
  -- with the trigger disabled is refused rather than silently unmeasurable.
  -- Deliberately NOT extended to 'converted': a request converted straight
  -- from 'submitted' legitimately has no acknowledgement (see the header).
  -- `acknowledged_by` is NOT required - auth.uid() is null for an import, and
  -- a known time with an unknown actor is honest (the V499 actor lesson).
  constraint repair_requests_acknowledged_stamp_check
    check (status <> 'acknowledged' or acknowledged_at is not null)
);

comment on table public.repair_requests is
  'Repair Request (RFR): the fault report raised BEFORE a job card exists. Converts into exactly one work_orders row via convert_repair_request_to_job_card(). Historical RFRs from the ERP are NOT backfilled here - they stay on work_orders.rfr_no, because all the ERP gave us was a number.';
comment on column public.repair_requests.work_order_no is
  'The job card this request became. Text rather than an FK because work_orders.work_order_no is globally unique and a request may be filed against a card number the ERP has not yet delivered.';
comment on column public.repair_requests.description is
  'The complaint as the operator reported it. Maps to work_orders.description (ERP column "Production Complaint") on conversion.';
comment on column public.repair_requests.client_uuid is
  'Mobile offline idempotency key. A replayed insert upserts on this instead of creating a second request.';
comment on column public.repair_requests.acknowledged_at is
  'When somebody first picked this request up. SERVER-STAMPED on the transition into status acknowledged; a client-supplied value is discarded, and once set it is never moved (first acknowledgement wins). Null means nobody has acknowledged it, including a request converted straight from submitted - time to acknowledge is then honestly unknown, never approximated from updated_at.';
comment on column public.repair_requests.acknowledged_by is
  'Who first acknowledged it, from auth.uid(). May be null while acknowledged_at is set (an import has no auth.uid()) - a known time with an unknown actor is honest.';

-- Idempotency for the offline queue. Partial so historical/desktop rows
-- (client_uuid null) coexist freely. Mirrors wash_records (V271) and
-- tech_activity_events (V292).
create unique index if not exists repair_requests_client_uuid_uidx
  on public.repair_requests (client_uuid) where client_uuid is not null;

-- One RFR number per org+country. Partial because a request may legitimately
-- exist for a moment before minting (and because a rejected draft may carry
-- none at all).
create unique index if not exists repair_requests_org_country_rfr_uidx
  on public.repair_requests (organisation_id, country, rfr_no) where rfr_no is not null;

-- Read paths. The queue is "open requests, newest first, for my scope", and
-- the per-asset history is "everything ever raised against this machine".
create index if not exists repair_requests_open_idx
  on public.repair_requests (organisation_id, country, status, reported_at desc);
create index if not exists repair_requests_asset_idx
  on public.repair_requests (organisation_id, upper(btrim(asset_no)), reported_at desc);
create index if not exists repair_requests_work_order_idx
  on public.repair_requests (work_order_no) where work_order_no is not null;


-- ── 5. RLS ─────────────────────────────────────────────────────────────────
alter table public.repair_requests enable row level security;

-- Org isolation: RESTRICTIVE FOR ALL, expression in USING **and** WITH CHECK.
-- Zero-argument helpers wrapped in `(select ...)` so they are hoisted to a
-- once-per-query InitPlan instead of running per row (V396 - that one change
-- took work_orders from 11,994 ms to 141 ms).
drop policy if exists repair_requests_org_isolation on public.repair_requests;
create policy repair_requests_org_isolation on public.repair_requests
  as restrictive for all
  using      (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));

-- Country and site. Both a SELECT-only isolation policy and a FOR ALL write
-- policy, byte-mirroring the newest comparable table in the schema
-- (wash_records, read live). A country-NULL or site-blank row stays visible to
-- everyone, which is the convention every other policy here uses, and
-- is_super_admin() is a term in its own right because the platform owner's
-- profile carries no country - without it they would read ZERO rows (the trap
-- recorded against V549).
drop policy if exists repair_requests_country_isolation on public.repair_requests;
create policy repair_requests_country_isolation on public.repair_requests
  for select using (
    country is null
    or (select public.is_super_admin())
    or (select public.app_sees_all_countries())
    or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))
  );

drop policy if exists repair_requests_country_write on public.repair_requests;
create policy repair_requests_country_write on public.repair_requests
  as restrictive for all
  using (
    country is null
    or (select public.is_super_admin())
    or (select public.app_sees_all_countries())
    or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))
  )
  with check (
    country is null
    or (select public.is_super_admin())
    or (select public.app_sees_all_countries())
    or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))
  );

drop policy if exists repair_requests_site_isolation on public.repair_requests;
create policy repair_requests_site_isolation on public.repair_requests
  for select using (
    site is null
    or btrim(site) = ''
    or (select public.app_sees_all_sites())
    or upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[]))
  );

drop policy if exists repair_requests_site_write on public.repair_requests;
create policy repair_requests_site_write on public.repair_requests
  as restrictive for all
  using (
    site is null
    or btrim(site) = ''
    or (select public.app_sees_all_sites())
    or upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[]))
  )
  with check (
    site is null
    or btrim(site) = ''
    or (select public.app_sees_all_sites())
    or upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[]))
  );

-- Any active member of the org reads the queue.
drop policy if exists repair_requests_select on public.repair_requests;
create policy repair_requests_select on public.repair_requests
  for select using (public.app_is_active());

-- A DRIVER must be able to raise one. That is the whole point of the table:
-- the person who finds the fault is rarely elevated. Mirrors how V271 widened
-- wash_records INSERT to include 'driver' - write-only, with no UPDATE or
-- DELETE grant, so a driver can file a request and can never edit or remove
-- one afterwards. Also admits anyone holding an explicit create grant, so an
-- administrator can open it to one person without a migration (V229).
drop policy if exists repair_requests_insert on public.repair_requests;
create policy repair_requests_insert on public.repair_requests
  for insert with check (
    public.app_is_active()
    and (
      public.app_is_elevated()
      or public.get_my_role() in ('driver','Driver','Inspector','Tyre Man','Mechanic',
                                  'Electrician','Maintenance Supervisor','Workshop Supervisor')
      or public.app_user_can('work_orders','create')
    )
  );

-- Deciding a request is a supervisory act.
drop policy if exists repair_requests_update on public.repair_requests;
create policy repair_requests_update on public.repair_requests
  for update
  using      (public.app_is_elevated() or public.app_user_can('work_orders','edit'))
  with check (public.app_is_elevated() or public.app_user_can('work_orders','edit'));

drop policy if exists repair_requests_delete on public.repair_requests;
create policy repair_requests_delete on public.repair_requests
  for delete using (public.app_is_elevated() or public.app_user_can('work_orders','delete'));


-- ── 6. Triggers ────────────────────────────────────────────────────────────
-- Mint the number on INSERT, and only on INSERT, so an abandoned draft can
-- never burn one and a replayed offline row cannot mint a second (V594's
-- reasoning for minting the checklist document number at insert time).
create or replace function public.repair_request_mint_rfr()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if nullif(btrim(coalesce(new.rfr_no, '')), '') is null then
    new.rfr_no := public.next_rfr_no(new.organisation_id, new.country, new.reported_at);
  else
    new.rfr_no := upper(btrim(new.rfr_no));   -- never add to the mixed-case split
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_repair_requests_mint_rfr on public.repair_requests;
create trigger trg_repair_requests_mint_rfr
  before insert on public.repair_requests
  for each row execute function public.repair_request_mint_rfr();

-- Stamp the acknowledgement, server-side, and never let it move.
--
-- BOTH INSERT AND UPDATE, deliberately. Guarding only UPDATE leaves the
-- backdating hole wide open: `status` is in the client's own
-- REPAIR_REQUEST_EDITABLE_COLS, so a client could simply INSERT a row already
-- at 'acknowledged' carrying whatever acknowledged_at it liked and the SLA
-- would be whatever it said.
create or replace function public.repair_request_stamp_acknowledged()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if tg_op = 'INSERT' then
    -- A request may legitimately be filed already acknowledged (a supervisor
    -- raising and accepting in one action). The time is still SERVER-derived.
    if new.status = 'acknowledged' then
      new.acknowledged_at := now();
      new.acknowledged_by := auth.uid();
    else
      -- Not acknowledged: the columns are cleared, so a client cannot arrive
      -- with a pre-filled acknowledgement for a request nobody has seen.
      new.acknowledged_at := null;
      new.acknowledged_by := null;
    end if;
    return new;
  end if;

  -- UPDATE.
  -- FIRST ACKNOWLEDGEMENT WINS. Once set, the old value is carried forward on
  -- every later write whatever the client sent - a re-acknowledge, a bounce
  -- back to 'submitted' and forward again, or an unrelated edit months later
  -- all leave it exactly where it was. Without this the number silently
  -- improves every time somebody touches the row.
  if old.acknowledged_at is not null then
    new.acknowledged_at := old.acknowledged_at;
    new.acknowledged_by := old.acknowledged_by;
    return new;
  end if;

  if new.status = 'acknowledged' and old.status is distinct from 'acknowledged' then
    new.acknowledged_at := now();
    new.acknowledged_by := auth.uid();
  else
    -- Any other update: the client may not set these by hand. (old.* is null
    -- on this branch, so this is a clear, not a carry-forward.)
    new.acknowledged_at := old.acknowledged_at;
    new.acknowledged_by := old.acknowledged_by;
  end if;
  return new;
end;
$fn$;

-- Named so it sorts BEFORE the other repair_requests triggers. Ordering is not
-- load-bearing here (they touch disjoint columns) but it keeps the sequence
-- readable: acknowledge -> mint -> touch -> normalise site.
drop trigger if exists trg_repair_requests_ack on public.repair_requests;
create trigger trg_repair_requests_ack
  before insert or update on public.repair_requests
  for each row execute function public.repair_request_stamp_acknowledged();

-- `zz_` so the site normaliser sorts LAST. Triggers fire in NAME order, and a
-- normaliser that runs before something which writes `site` is simply
-- overwritten - the defect V524 spent a whole migration discovering.
drop trigger if exists trg_zz_normalize_site_rr on public.repair_requests;
create trigger trg_zz_normalize_site_rr
  before insert or update on public.repair_requests
  for each row execute function public.normalize_site();

drop trigger if exists trg_repair_requests_touch on public.repair_requests;
create trigger trg_repair_requests_touch
  before update on public.repair_requests
  for each row execute function public.set_updated_at();


-- ── 7. Conversion ──────────────────────────────────────────────────────────
-- The one governed path from a request to a job card. Idempotent: calling it
-- twice returns the card that already exists and never creates a second.
create or replace function public.convert_repair_request_to_job_card(
  p_id                uuid,
  p_work_order_no     text        default null,
  p_work_type         text        default null,
  p_target_completion timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  r      public.repair_requests%rowtype;
  v_org  uuid := public.app_current_org();
  v_no   text;
  v_id   uuid;
  v_type text;
begin
  -- A SECURITY DEFINER function runs as its owner and RLS never runs inside
  -- one, so every question the policies would have asked has to be asked again
  -- here by hand: org, country, and permission. That is the single root cause
  -- behind the whole V545-V576 sweep.
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not (public.app_is_elevated() or public.app_user_can('work_orders','create')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into r from public.repair_requests where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if r.organisation_id is distinct from v_org then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  -- coalesce to false so an indeterminate answer refuses rather than admits.
  -- This is a WRITE gate; failing open here would let a caller raise a job
  -- card in a country they cannot see.
  if r.country is not null
     and not coalesce(public.app_can_see_country(r.country), false) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- Already done. Return the existing link rather than raising, so a lost
  -- response or a double-tap is harmless.
  if r.status = 'converted' and r.work_order_no is not null then
    select w.id into v_id from public.work_orders w
     where w.work_order_no = r.work_order_no and w.organisation_id = v_org;
    return jsonb_build_object('ok', true, 'already_converted', true,
                              'work_order_no', r.work_order_no,
                              'work_order_id', v_id,
                              'rfr_no', r.rfr_no);
  end if;

  if r.status in ('rejected','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'not_convertible',
                              'message', 'This request was ' || r.status || ' and cannot become a job card.');
  end if;

  -- work_type must satisfy work_orders_work_type_check. 'Repair' is the
  -- majority value (73,560 of 90,535) and the honest default for a fault report.
  v_type := coalesce(nullif(btrim(coalesce(p_work_type,'')), ''), 'Repair');

  v_no := nullif(btrim(coalesce(p_work_order_no, '')), '');

  if v_no is not null then
    -- Linking to a card that may already exist. work_order_no is GLOBALLY
    -- unique, so the lookup must be global and the org check comes AFTER -
    -- searching within the org first would miss a collision and abort on 23505
    -- (the V415 lesson).
    select w.id into v_id from public.work_orders w where w.work_order_no = v_no;

    if v_id is not null then
      if (select w.organisation_id from public.work_orders w where w.id = v_id) is distinct from v_org then
        return jsonb_build_object('ok', false, 'reason', 'forbidden',
                                  'message', 'That job card number belongs to another organisation.');
      end if;
      -- Stamp the RFR onto the card only when the card does not already name one.
      update public.work_orders
         set rfr_no      = coalesce(nullif(btrim(coalesce(rfr_no,'')), ''), r.rfr_no),
             custom_data = coalesce(custom_data, '{}'::jsonb)
                           || jsonb_strip_nulls(jsonb_build_object(
                                'raised_by', r.reported_by_name,
                                'raised_at', to_char(r.reported_at, 'YYYY-MM-DD HH24:MI'),
                                'repair_request_id', r.id::text))
       where id = v_id;
    end if;
  end if;

  if v_id is null then
    v_no := coalesce(v_no, public.generate_work_order_no());

    -- opened_at is NOT NULL. A column default does NOT apply to an explicit
    -- NULL, which is what aborted whole import batches in V419, so it is
    -- coalesced here rather than trusted.
    insert into public.work_orders (
      work_order_no, organisation_id, country, site,
      asset_no, plate_no, asset_description,
      status, priority, work_type,
      description, odometer,
      rfr_no, opened_at, target_completion,
      created_by, custom_data
    ) values (
      v_no, v_org, r.country, r.site,
      r.asset_no, r.plate_no, r.asset_description,
      'New', coalesce(r.priority, 'Medium'), v_type,
      r.description, r.odometer,
      r.rfr_no, coalesce(r.reported_at, now()), p_target_completion,
      auth.uid(),
      jsonb_strip_nulls(jsonb_build_object(
        'raised_by', r.reported_by_name,
        'raised_at', to_char(r.reported_at, 'YYYY-MM-DD HH24:MI'),
        'repair_request_id', r.id::text))
    )
    returning id into v_id;
  end if;

  -- acknowledged_at / acknowledged_by are DELIBERATELY NOT TOUCHED HERE.
  -- Coalescing them to now() - which an earlier draft of this file did - would
  -- manufacture an acknowledgement that never happened and make
  -- time-to-acknowledge equal time-to-convert for every request carded straight
  -- from 'submitted'. A fabricated measurement is worse than a missing one, so
  -- a request that was never acknowledged keeps a null and the client reports
  -- that row as unmeasured. A request that WAS acknowledged already carries its
  -- own stamp from trg_repair_requests_ack and keeps it untouched.
  update public.repair_requests
     set status        = 'converted',
         work_order_no = v_no,
         converted_at  = now(),
         converted_by  = auth.uid()
   where id = r.id;

  return jsonb_build_object('ok', true, 'already_converted', false,
                            'work_order_no', v_no,
                            'work_order_id', v_id,
                            'rfr_no', r.rfr_no);
end;
$fn$;

comment on function public.convert_repair_request_to_job_card(uuid,text,text,timestamptz) is
  'Turns a repair request into a job card, or links it to an existing one. Idempotent - a second call returns the card already linked and never creates a duplicate. Re-checks org, country and permission in-body because RLS does not run inside a SECURITY DEFINER function.';

-- This one IS meant to be called from the app, so authenticated keeps EXECUTE.
-- It takes no org argument - the org is resolved from the session - so it does
-- not carry the V596 hazard that next_rfr_no does.
revoke execute on function public.convert_repair_request_to_job_card(uuid,text,text,timestamptz) from public;
revoke execute on function public.convert_repair_request_to_job_card(uuid,text,text,timestamptz) from anon;
grant  execute on function public.convert_repair_request_to_job_card(uuid,text,text,timestamptz) to authenticated, service_role;


-- ============================================================================
-- VERIFY - EXERCISED LIVE 2026-08-24 INSIDE `begin; ... rollback;`
--
-- Everything below actually ran against jhssdmeruxtrlqnwfksc and the arrows are
-- the values it RETURNED, not the values it was expected to return. The
-- transaction was rolled back and the rollback was then confirmed from a fresh
-- session (see the last block). Re-run this after applying.
-- ============================================================================
--
-- -- 1. NUMBER SHAPES. Each one matches the shape measured in the live column.
--    next_rfr_no(org,'KSA'  ,'2025-12-14')  --> GC/RFR/0001/1225   4-digit MMYY
--    next_rfr_no(org,'UAE'  ,'2026-08-24')  --> RM/RFR/0001/26     2-digit YY
--    next_rfr_no(org,'Egypt','2026-08-24')  --> EG/RFR/0001/26     2-digit YY
--
-- -- 2. THE SEQUENCE RULE, and this is the assertion that earns `period_mode`
-- --    its place. If KSA and UAE behaved identically the column would be dead
-- --    weight; they do not.
--    next_rfr_no(org,'KSA','2025-12-15')  --> GC/RFR/0002/1225   increments
--    next_rfr_no(org,'KSA','2026-01-02')  --> GC/RFR/0001/0126   RESETS on a new month
--    next_rfr_no(org,'UAE','2026-09-02')  --> RM/RFR/0002/26     does NOT reset on a new month
--
-- -- 3. Degradation. An unconfigured country still mints; a null org refuses.
--    next_rfr_no(org,'Oman','2026-08-24') --> GC/RFR/0001/0826   falls back, does not fail the insert
--    next_rfr_no(null ,'KSA','2026-08-24') --> null
--
-- -- 4. THE TRIGGER MINTS ON INSERT, and every CHECK bites. Each of these four
-- --    was attempted inside a DO block that RAISES if the row is accepted, so
-- --    a silent pass would have failed the run:
--    priority 'Urgent'                    --> REFUSED 23514  (not in the job-card priority set)
--    status 'converted', no work_order_no --> REFUSED 23514  (converted with nothing on the other end)
--    status 'rejected', no reason         --> REFUSED 23514
--    status 'nonsense'                    --> REFUSED 23514
--
-- -- 5. client_uuid idempotency, and the partial index really is partial:
--    second insert with client_uuid 'abc' --> REFUSED 23505
--    two inserts with client_uuid NULL    --> BOTH ACCEPTED
--    end state: 4 rows, 4 distinct rfr_no (no number issued twice)
--
-- -- 6. site normalisation. Inserting site 'nhc-st' stored 'NHC' - the zz_
-- --    trigger ran last and the V395 alias applied.
--
-- -- 7. CONVERSION, impersonating the real super admin
-- --    (set_config('request.jwt.claims','{"sub":"d2d43a5f-...","role":"authenticated"}',true)):
--    convert(<id>,'ZZ-V608-A')  --> {"ok":true,  "already_converted":false, "work_order_id":"622f8b1b-…"}
--    convert(<id>,'ZZ-V608-A')  --> {"ok":true,  "already_converted":true,  "work_order_id":"622f8b1b-…"}
--                                   ^ THE SAME work_order_id. Idempotent.
--    select count(*) from work_orders where work_order_no='ZZ-V608-VERIFY' --> 1
--                                   ^ two conversion calls, ONE card.
--    convert(<rejected id>)     --> {"ok":false,"reason":"not_convertible",
--                                    "message":"This request was rejected and cannot become a job card."}
--    convert('0000…00ff')       --> {"ok":false,"reason":"not_found"}
--
-- -- 8. LINKING TO A CARD THAT ALREADY EXISTS, against a REAL live UAE row:
--    convert(<uae request>, 'RM/RMJC/0316/0826')
--      --> {"ok":true,"already_converted":false,"work_order_no":"RM/RMJC/0316/0826",
--           "rfr_no":"RM/RFR/0001/26"}
--    The existing card was found globally (work_order_no is globally unique),
--    the org check passed, and the RFR was stamped onto it.
--
-- -- 9. THE CARD THE CONVERSION BUILT carries everything it should:
--    rfr_no      GC/RFR/0001/1225        (from the request)
--    status      New                     (in work_orders_status_check)
--    work_type   Repair                  (in work_orders_work_type_check)
--    priority    High                    (carried from the request, in the CHECK)
--    opened_at   2025-12-14 00:00:00+00  <- the REQUEST's reported_at, not now().
--                                           This is the V419 coalesce doing its job:
--                                           NOT NULL satisfied without a bare column ref.
--    custom_data raised_by='M.SALEH', repair_request_id set
--
-- -- 10. NOT EXERCISED, DELIBERATELY: the auto-number branch
-- --     (`v_no := generate_work_order_no()`). `nextval` is NOT transactional, so
-- --     calling it would have left a permanent gap in work_order_seq on a
-- --     database this migration is not supposed to touch. Every conversion test
-- --     above passed an explicit p_work_order_no instead.
-- --     `generate_work_order_no()` is an existing, in-production function
-- --     (`'WO-' || YYYY || '-' || lpad(nextval('work_order_seq'),5,'0')`),
-- --     already used by the Workshop Live job creator.
--
-- -- 10b. THE ACKNOWLEDGEMENT SLA. Every one of these ran live; the timestamps
-- --      quoted are the values the database actually stored.
--    I1  insert plain 'submitted'                     --> acknowledged_at NULL
--    I2  INSERT already 'acknowledged' carrying a
--        client-supplied acknowledged_at of 2001-01-01 --> STAMPED now().
--                                                         The backdate was
--                                                         DISCARDED. This is why
--                                                         the trigger covers
--                                                         INSERT and not just
--                                                         UPDATE: `status` is a
--                                                         client-editable column,
--                                                         so a row could
--                                                         otherwise arrive
--                                                         pre-acknowledged.
--    I2b acknowledged_by                               --> auth.uid(). The
--                                                         client-supplied actor
--                                                         '0000…aa' was discarded.
--    I3  UPDATE submitted -> acknowledged              --> STAMPED
--    I4  UPDATE setting acknowledged_at = 2001-01-01
--        alongside an unrelated description edit       --> UNCHANGED
--    I5  bounce acknowledged -> submitted -> acknowledged:
--          before  2026-08-24 14:06:50.657369+00
--          after   2026-08-24 14:06:50.657369+00       --> BYTE IDENTICAL.
--                                                          First acknowledgement
--                                                          wins.
--    I7  convert straight from 'submitted'             --> ok:true
--    I7b   acknowledged_at after that conversion       --> NULL - not invented
--    I7c   converted_at after that conversion          --> SET, so
--                                                          time-to-convert still
--                                                          measures for this row
--                                                          even though
--                                                          time-to-acknowledge
--                                                          cannot.
--    I8  convert a request that WAS acknowledged       --> ok:true
--    I8b   acknowledged_at survived the conversion     --> 2026-08-24
--                                                          14:06:50.657369+00,
--                                                          unchanged.
--
-- -- 10c. THE CHECK IS A REAL BACKSTOP, not decoration:
--    J1 trigger ON, insert status 'acknowledged'   --> ACCEPTED (trigger stamps it)
--    J2 trigger DISABLED (simulating a bulk load),
--       insert 'acknowledged' with no timestamp    --> REFUSED 23514
--    J3 trigger re-enabled, tgenabled              --> 'O'
--       (the disable/enable dance always ends with this assertion - a trigger
--        left disabled by a migration is the quiet kind of damage)
--
-- -- 11. GRANTS - the minting function must be unreachable from a client:
--    has_function_privilege('anon',         'next_rfr_no(uuid,text,timestamptz)','execute')  --> false
--    has_function_privilege('authenticated','next_rfr_no(uuid,text,timestamptz)','execute')  --> false
--    has_function_privilege('authenticated','convert_repair_request_to_job_card(...)','execute') --> true
--    has_table_privilege('authenticated','public.repair_request_counters','select')          --> false
--
-- -- 12. ROLLBACK CONFIRMED from a FRESH session after the transaction closed.
-- --     This is the control that makes "AUTHORED, NOT APPLIED" a fact:
--    to_regclass('public.repair_requests')              --> null
--    to_regclass('public.repair_request_counters')      --> null
--    to_regclass('public.repair_request_number_config') --> null
--    to_regproc('public.next_rfr_no')                   --> null
--    to_regproc('public.convert_repair_request_to_job_card') --> null
--    count(*) work_orders where work_order_no like 'ZZ-V608%'  --> 0
--    count(*) work_orders                                     --> 90,535  (unchanged)
--
-- ONE MEASUREMENT ARTEFACT WORTH RECORDING, because it is the "0 ms trap" class
-- this project has been bitten by before: a `union all` of volatile function
-- calls does NOT guarantee branch evaluation order, so a count placed in a
-- later UNION branch read 0 while an earlier branch had already inserted the
-- row. Assert a count in its OWN statement, after the calls - which is what
-- item 7's `select count(*)` above does, and why it reads 1.
-- ============================================================================
