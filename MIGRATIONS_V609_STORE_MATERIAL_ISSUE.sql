-- ============================================================================
-- V609. Store Material Issue / Return (MIS / MRT) as a first-class document.
--
-- STATUS: AUTHORED - NOT YET APPLIED.
--   Nothing in this file has been run against jhssdmeruxtrlqnwfksc. Every
--   statement was PARSED and BEHAVIOURALLY EXERCISED inside a
--   `begin; ... rollback;` transaction on the live database (see VERIFY at the
--   foot, which records what it actually returned), and the rollback was then
--   confirmed from a fresh session. The database is unchanged.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- The store already issues parts against a job card and already numbers the
-- paperwork: `parts_consumption.issue_number` IS the Material Issue Slip.
-- 209,536 expense lines carry one. But it exists only as a TEXT COLUMN on the
-- expense ledger, so the document itself has no header, no status, no issued-to,
-- no line grain of its own, and nothing in the app can raise one. A store that
-- cannot issue a slip in the system will keep issuing it on paper, and the
-- ledger will keep being the only trace.
--
-- This file gives the slip a header and lines, so a part can be issued (MIS) or
-- returned (MRT) inside the app and be reconciled against the ERP later.
--
-- IT DOES NOT TOUCH `parts_consumption`. That table remains the authoritative
-- expense ledger, loaded from the ERP, and this migration adds no column to it,
-- rewrites none of its money, and changes none of its triggers. The two are two
-- views of the same real-world document: the ERP's record of what was consumed,
-- and the app's record of what the store handed over.
--
-- ---------------------------------------------------------------------------
-- MEASURED LIVE 2026-08-24 - and the first finding decides the unique key
-- ---------------------------------------------------------------------------
--
-- (1) *** `issue_number` ALONE IS NOT A UNIQUE DOCUMENT KEY, AND KEYING ON IT
--     WOULD SILENTLY MERGE TWO COUNTRIES' PAPERWORK. ***
--     Counted live:
--         distinct issue_number strings                        59,341
--         distinct (country, issue_number) pairs               83,580
--         raw strings appearing under MORE THAN ONE country    24,239
--     So 24,239 of 59,341 slip numbers - 41% of them - are reused across
--     countries. Grouped by the STRING alone, 24,239 "slips" appear to span
--     several job cards. Grouped by (country, issue_number):
--         slips mapping to exactly one work_order_no      83,580 of 83,580
--         slips mapping to more than one                             0
--     Zero exceptions. The document is 1:N onto job cards only in the sense
--     that ONE CARD may draw SEVERAL slips (max measured: 59 slips on a single
--     card); a slip never spans two cards. So:
--         UNIQUE KEY  = (organisation_id, country, issue_number)
--         work_order_no on the HEADER, not the line.
--     This is the V367 / V376 lesson landing again: item codes are not globally
--     unique, asset numbers are a per-country sequence, and now slip numbers
--     too. Nothing in this system may be keyed on a code alone.
--
-- (2) THE NUMBER SHAPE IS CLEAN, AND IT IS PER ENTITY, NOT PER COUNTRY.
--     All 83,580 slips match `<PREFIX>/(MIS|MRT)/<4-digit>/<MMYY>` - zero
--     exceptions. The prefixes in use:
--         KSA    GC/MIS   35,123 slips    AFRK/MIS  8,844    GC/MRT 25   AFRK/MRT 23
--         Egypt  GCEG/MIS  8,048          AFEG/MIS  3,653
--         UAE    GC/MIS   27,825          GC/MRT       39
--     Two operating entities per country in KSA and Egypt (GC and AF*), which
--     is why the prefix lives in a config table rather than a country map.
--     NOTE the suffix is NOT a calendar month in every case: Egypt uses an ERP
--     PERIOD 13 (202 slips carry `13` as the month half, e.g. `/1302`), the
--     usual year-end adjustment period. Minting never emits 13; it is accepted
--     on read because the ERP genuinely issues it.
--
-- (3) *** MRT IS A RETURN AND ITS MONEY IS BOOKED POSITIVE. ***
--     Measured on the live ledger, MRT lines and their `line_cost`:
--         KSA   AFRK/MRT   77 lines   SAR  489,494.17   negative lines: 0
--         KSA   GC/MRT     29 lines   SAR   37,266.03   negative lines: 0
--         UAE   GC/MRT     73 lines   AED   47,175.94   negative lines: 0
--         Egypt (no MRT)
--     KSA total SAR 526,760.20 and UAE total AED 47,175.94, every one POSITIVE.
--     A return that ADDS cost to a job card is a real integrity problem: those
--     179 lines are charging the fleet for parts that came BACK to the store,
--     and the job cards they sit on are overstated by that amount.
--
--     THIS MIGRATION DOES NOT REWRITE THEM. Flipping the sign on 179 historical
--     rows moves SAR 1,053,520.40 and AED 94,351.88 of reported cost (twice the
--     face value, because the correction both removes the charge and applies the
--     credit) across job cards, cost centres and every month those cards fall
--     in. That is an owner decision about historical money, not a schema fix,
--     and this project's standing rule is that money only moves through a lever
--     with a dry run and an undo. It is recorded here so the next person finds
--     it rather than rediscovering it.
--     (Also visible while measuring, and left alone for the same reason: 9 MIS
--     lines carry a NEGATIVE line_cost - 8 KSA GC/MIS and 1 Egypt AFEG/MIS -
--     i.e. a credit booked on an issue slip. The mirror image of the same
--     problem.)
--
-- (4) `stock_records` CANNOT BE JOINED TO THIS. Its full column list, read
--     live, is: id, site, description, stock_qty, min_level, critical_level,
--     stock_status, reorder_qty, management_action, region, updated_by,
--     updated_at, country, organisation_id, custom_data. There is NO item_code,
--     so there is no key that reaches `material_master` (which IS keyed
--     (organisation_id, country, item_code)) or the item codes on these lines.
--     Stated plainly: THIS MIGRATION DOES NOT GIVE ANYONE A LIVE ON-HAND
--     BALANCE, and nothing here should be presented as one. An issue slip
--     records what left the store; it cannot say what remains, because the
--     stock table does not identify its items. Wiring the two together needs
--     item_code on stock_records and is a separate piece of work.
--
-- (5) Every issue line carries an asset code (109,527/109,527 KSA,
--     59,329/59,329 UAE, 40,680/40,680 Egypt). Distinct issuing stores:
--     KSA 19, Egypt 15, UAE 5.
--
-- ---------------------------------------------------------------------------
-- THE MRT SIGN DECISION - what was chosen and why
-- ---------------------------------------------------------------------------
-- A return must CREDIT. Three ways to guarantee that were considered:
--
--   (a) store qty positive and let a VIEW apply the sign.
--       REJECTED. Every consumer in this codebase sums `line_cost` off the
--       table. A sign that lives only in a view is lost the moment somebody
--       aggregates the table directly - which is precisely how the 179
--       historical MRT lines came to be booked positive in the first place.
--       The failure mode is silent and the number still looks plausible.
--
--   (b) store a signed value and trust the writer.
--       REJECTED. A CHECK constraint cannot see the parent header's doc_type,
--       so nothing would stop a direct INSERT writing a positive return.
--
--   (c) CHOSEN. Denormalise `doc_type` onto the LINE, force it to equal the
--       header's on every write (a BEFORE trigger on the line overwrites
--       whatever the client sent, and an AFTER trigger on the header re-stamps
--       its lines if the header's doc_type ever changes), and make `line_cost`
--       a STORED GENERATED column:
--           (case when doc_type = 'MRT' then -1 else 1 end) * qty * unit_cost
--       `qty` and `unit_cost` are stored POSITIVE (a CHECK enforces qty > 0 and
--       unit_cost >= 0), so the sign is not a value anyone can supply - it is
--       derived, and there is no write path that produces a positive return.
--       Proven live: MIS 4 x 250.00 -> +1000.00, MRT 4 x 250.00 -> -1000.00.
--
--       The cost of (c) is one denormalised column kept in step by triggers.
--       That is a real cost and it is worth it: it converts "remember to apply
--       the sign" into "the wrong answer is unreachable".
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
--   drop function if exists public.get_material_issue_summary(text,date,date);
--   drop trigger  if exists trg_material_issue_lines_doctype on public.material_issue_lines;
--   drop trigger  if exists trg_material_issues_cascade_doctype on public.material_issues;
--   drop trigger  if exists trg_material_issues_mint on public.material_issues;
--   drop trigger  if exists trg_zz_normalize_site_mi on public.material_issues;
--   drop trigger  if exists trg_material_issues_touch on public.material_issues;
--   drop function if exists public.material_issue_line_stamp_doctype();
--   drop function if exists public.material_issue_cascade_doctype();
--   drop function if exists public.material_issue_mint_number();
--   drop function if exists public.next_material_issue_no(uuid,text,text,timestamptz);
--   drop table    if exists public.material_issue_lines;   -- cascades from the header anyway
--   drop table    if exists public.material_issues;
--   drop table    if exists public.material_issue_counters;
--   drop table    if exists public.material_issue_number_config;
-- No existing table, function, policy or trigger is modified by this file.
-- ============================================================================


-- ── 1. Number configuration ────────────────────────────────────────────────
-- Per (org, country, doc_type) the entity prefix. Seeded with the prefixes
-- measured live. `AFRK` / `AFEG` are the second operating entity in KSA and
-- Egypt; an org that issues under both configures the second one here and
-- passes it explicitly, since a single default cannot serve two entities.
create table if not exists public.material_issue_number_config (
  organisation_id uuid not null default public.app_current_org(),
  country         text not null,
  doc_type        text not null default 'MIS',
  entity_prefix   text not null,
  seq_width       integer not null default 4,
  updated_at      timestamptz not null default now(),
  primary key (organisation_id, country, doc_type),
  constraint material_issue_number_config_doc_type_check
    check (doc_type in ('MIS','MRT')),
  constraint material_issue_number_config_seq_width_check
    check (seq_width between 3 and 8),
  constraint material_issue_number_config_prefix_check
    check (btrim(entity_prefix) <> '')
);

comment on table public.material_issue_number_config is
  'Per (org, country, doc_type) store-document prefix. Measured live: KSA GC and AFRK, Egypt GCEG and AFEG, UAE GC. Two entities per country in KSA and Egypt, which is why this is a table and not a country map.';

alter table public.material_issue_number_config enable row level security;

drop policy if exists mi_number_config_org_isolation on public.material_issue_number_config;
create policy mi_number_config_org_isolation on public.material_issue_number_config
  as restrictive for all
  using      (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));

drop policy if exists mi_number_config_select on public.material_issue_number_config;
create policy mi_number_config_select on public.material_issue_number_config
  for select using (public.app_is_active());

drop policy if exists mi_number_config_write on public.material_issue_number_config;
create policy mi_number_config_write on public.material_issue_number_config
  for all
  using      (public.app_is_elevated())
  with check (public.app_is_elevated());

insert into public.material_issue_number_config
       (organisation_id, country, doc_type, entity_prefix, seq_width)
select o.organisation_id, v.country, v.doc_type, v.entity_prefix, 4
  from (select distinct organisation_id from public.parts_consumption) o
 cross join (values
        ('KSA',   'MIS', 'GC'  ),   -- GC/MIS/nnnn/MMYY   35,123 slips
        ('KSA',   'MRT', 'GC'  ),   -- GC/MRT/nnnn/MMYY       25 slips
        ('UAE',   'MIS', 'GC'  ),   -- GC/MIS/nnnn/MMYY   27,825 slips
        ('UAE',   'MRT', 'GC'  ),   -- GC/MRT/nnnn/MMYY       39 slips
        ('Egypt', 'MIS', 'GCEG'),   -- GCEG/MIS/nnnn/MMYY  8,048 slips
        ('Egypt', 'MRT', 'GCEG')    -- no live MRT in Egypt; configured so one can be raised
      ) as v(country, doc_type, entity_prefix)
on conflict (organisation_id, country, doc_type) do nothing;


-- ── 2. Counter ─────────────────────────────────────────────────────────────
-- Deny-all, exactly like repair_request_counters (V608) and
-- checklist_doc_counters (V594): RLS on, no policies, no grant to
-- authenticated. Only the DEFINER minting function reaches it, by ownership.
create table if not exists public.material_issue_counters (
  organisation_id uuid not null,
  country         text not null,
  doc_type        text not null,
  prefix          text not null,
  period_key      text not null,   -- MMYY
  seq             integer not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (organisation_id, country, doc_type, prefix, period_key)
);

comment on table public.material_issue_counters is
  'MIS/MRT sequence per (org, country, doc_type, prefix, MMYY). Deny-all: RLS enabled with no policies and no grant to authenticated.';

alter table public.material_issue_counters enable row level security;
revoke all on public.material_issue_counters from public, anon, authenticated;


-- ── 3. Minting ─────────────────────────────────────────────────────────────
-- Emits the ERP's own shape, verified against all 83,580 live slips:
--     GC/MIS/0001/0826 · GCEG/MIS/0001/0826 · GC/MRT/0001/0826
-- MIS and MRT keep SEPARATE sequences, because the live data does (KSA GC/MIS
-- reaches 4 digits while GC/MRT sits at 25 slips lifetime - one shared counter
-- would make the return numbers jump into the thousands and stop matching the
-- ERP's own).
create or replace function public.next_material_issue_no(
  p_org      uuid,
  p_country  text,
  p_doc_type text default 'MIS',
  p_when     timestamptz default now()
) returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_doc    text := upper(btrim(coalesce(p_doc_type, 'MIS')));
  v_prefix text;
  v_width  integer;
  v_period text;
  v_seq    integer;
begin
  if p_org is null then
    return null;
  end if;
  if v_doc not in ('MIS','MRT') then
    v_doc := 'MIS';
  end if;

  select upper(btrim(c.entity_prefix)), c.seq_width
    into v_prefix, v_width
    from public.material_issue_number_config c
   where c.organisation_id = p_org
     and lower(btrim(c.country)) = lower(btrim(coalesce(p_country, '')))
     and c.doc_type = v_doc;

  -- Unconfigured country: mint a usable number rather than refusing the insert.
  -- 'GC' is the majority prefix (62,948 of 83,580 slips).
  if v_prefix is null then
    v_prefix := 'GC';
    v_width  := 4;
  end if;

  v_period := to_char(coalesce(p_when, now()), 'MMYY');

  insert into public.material_issue_counters
         (organisation_id, country, doc_type, prefix, period_key, seq)
  values (p_org, upper(btrim(coalesce(p_country, ''))), v_doc, v_prefix, v_period, 1)
  on conflict (organisation_id, country, doc_type, prefix, period_key)
  do update set seq        = public.material_issue_counters.seq + 1,
                updated_at = now()
  returning seq into v_seq;

  return v_prefix || '/' || v_doc || '/' || lpad(v_seq::text, v_width, '0') || '/' || v_period;
end;
$fn$;

comment on function public.next_material_issue_no(uuid,text,text,timestamptz) is
  'Mints the next MIS or MRT number. SECURITY DEFINER and takes an org id, so EXECUTE is revoked from PUBLIC, anon AND authenticated (V596) - the BEFORE INSERT trigger reaches it through ownership.';

-- V500 ordering: PUBLIC first, then each role by name.
revoke execute on function public.next_material_issue_no(uuid,text,text,timestamptz) from public;
revoke execute on function public.next_material_issue_no(uuid,text,text,timestamptz) from anon;
revoke execute on function public.next_material_issue_no(uuid,text,text,timestamptz) from authenticated;
grant  execute on function public.next_material_issue_no(uuid,text,text,timestamptz) to service_role;


-- ── 4. The slip header ─────────────────────────────────────────────────────
create table if not exists public.material_issues (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  country          text,
  site             text,
  store_code       text,

  issue_number     text,                        -- minted on insert when null
  doc_type         text not null default 'MIS', -- MIS = issue, MRT = return

  work_order_no    text,                        -- THE LINK to the job card
  asset_no         text,

  issued_to        text,
  issued_by        uuid default auth.uid(),
  issued_by_name   text,
  issued_at        timestamptz not null default now(),

  status           text not null default 'draft',
  notes            text,
  client_uuid      text,
  custom_data      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint material_issues_doc_type_check
    check (doc_type in ('MIS','MRT')),
  -- draft -> issued is the only forward move; cancelled is terminal. A slip is
  -- never deleted once issued, because the ledger has to be able to find it.
  constraint material_issues_status_check
    check (status in ('draft','issued','cancelled'))
);

comment on table public.material_issues is
  'Store Material Issue (MIS) or Material Return (MRT) slip header. UNIQUE on (organisation_id, country, issue_number) - NOT on issue_number alone: measured live, 24,239 of 59,341 slip numbers are reused across countries, so a bare key would merge two countries paperwork.';
comment on column public.material_issues.doc_type is
  'MIS issues parts out of the store; MRT takes them back. Drives the SIGN of every line cost, and is force-copied onto each line so a stored generated column can apply it.';
comment on column public.material_issues.work_order_no is
  'The job card this slip draws against. Measured live: a (country, issue_number) slip maps to exactly ONE work_order_no on all 83,580 slips, and one card may draw up to 59 slips. Text, not an FK - a slip may be raised against a card number the ERP has not delivered yet.';

-- (1) above: the key that is actually unique. Partial so a draft can exist
-- for a moment before minting.
create unique index if not exists material_issues_org_country_number_uidx
  on public.material_issues (organisation_id, country, issue_number)
  where issue_number is not null;

create unique index if not exists material_issues_client_uuid_uidx
  on public.material_issues (client_uuid) where client_uuid is not null;

create index if not exists material_issues_work_order_idx
  on public.material_issues (work_order_no) where work_order_no is not null;
create index if not exists material_issues_store_idx
  on public.material_issues (organisation_id, country, store_code, issued_at desc);
create index if not exists material_issues_asset_idx
  on public.material_issues (organisation_id, upper(btrim(asset_no)), issued_at desc)
  where asset_no is not null;


-- ── 5. The slip lines ──────────────────────────────────────────────────────
-- `doc_type` is DENORMALISED here on purpose - see the sign decision in the
-- header. It is never trusted from the client: a BEFORE trigger overwrites it
-- with the header's value on every insert and update.
create table if not exists public.material_issue_lines (
  id               uuid primary key default gen_random_uuid(),
  issue_id         uuid not null references public.material_issues(id) on delete cascade,
  line_no          integer,
  doc_type         text not null default 'MIS',

  item_code        text,
  item_description text,
  qty              numeric not null default 0,
  uom              text,
  unit_cost        numeric not null default 0,

  -- THE SIGN LIVES HERE AND NOWHERE ELSE. A return can never add cost, because
  -- there is no write path that supplies this value.
  line_cost        numeric generated always as
                     ((case when doc_type = 'MRT' then -1 else 1 end)
                      * coalesce(qty, 0) * coalesce(unit_cost, 0)) stored,

  category         text,
  custom_data      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),

  constraint material_issue_lines_doc_type_check
    check (doc_type in ('MIS','MRT')),
  -- qty and unit_cost are stored POSITIVE on both document types. The
  -- direction of the movement is doc_type's job, not the quantity's.
  constraint material_issue_lines_qty_check       check (qty > 0),
  constraint material_issue_lines_unit_cost_check check (unit_cost >= 0)
);

comment on table public.material_issue_lines is
  'Lines of a store slip. qty and unit_cost are always POSITIVE; line_cost is a STORED GENERATED column that applies the sign from doc_type, so an MRT return always credits. Proven live: MIS 4 x 250.00 = +1000.00, MRT 4 x 250.00 = -1000.00.';
comment on column public.material_issue_lines.doc_type is
  'Denormalised from the header so the generated line_cost can see it (a generated column may only reference its own row). Force-stamped by trg_material_issue_lines_doctype - a client-supplied value is ignored.';
comment on column public.material_issue_lines.category is
  'Cost bucket. Derive it with public.material_category_bucket() over the reviewed material_master decision - do NOT re-implement the classifier; classify_parts_consumption and the material master already own that question.';

create index if not exists material_issue_lines_issue_idx
  on public.material_issue_lines (issue_id, line_no);
create index if not exists material_issue_lines_item_idx
  on public.material_issue_lines (upper(btrim(item_code))) where item_code is not null;

-- One line number per slip when it is given at all.
create unique index if not exists material_issue_lines_issue_lineno_uidx
  on public.material_issue_lines (issue_id, line_no) where line_no is not null;


-- ── 6. RLS ─────────────────────────────────────────────────────────────────
alter table public.material_issues      enable row level security;
alter table public.material_issue_lines enable row level security;

-- Header. Org isolation RESTRICTIVE FOR ALL with the expression in USING AND
-- WITH CHECK (V542), zero-arg helpers wrapped in `(select ...)` so they hoist
-- to a once-per-query InitPlan (V396).
drop policy if exists material_issues_org_isolation on public.material_issues;
create policy material_issues_org_isolation on public.material_issues
  as restrictive for all
  using      (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));

drop policy if exists material_issues_country_isolation on public.material_issues;
create policy material_issues_country_isolation on public.material_issues
  for select using (
    country is null
    or (select public.is_super_admin())
    or (select public.app_sees_all_countries())
    or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))
  );

drop policy if exists material_issues_country_write on public.material_issues;
create policy material_issues_country_write on public.material_issues
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

drop policy if exists material_issues_site_isolation on public.material_issues;
create policy material_issues_site_isolation on public.material_issues
  for select using (
    site is null
    or btrim(site) = ''
    or (select public.app_sees_all_sites())
    or upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[]))
  );

drop policy if exists material_issues_site_write on public.material_issues;
create policy material_issues_site_write on public.material_issues
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

drop policy if exists material_issues_select on public.material_issues;
create policy material_issues_select on public.material_issues
  for select using (public.app_is_active());

-- A store keeper raises a slip. Elevated, or the explicit capability grant, so
-- an administrator can open it to one storeman without a migration (V229).
drop policy if exists material_issues_write on public.material_issues;
create policy material_issues_write on public.material_issues
  for all
  using      (public.app_is_elevated() or public.app_user_can('stock','edit'))
  with check (public.app_is_elevated() or public.app_user_can('stock','edit'));

-- Lines carry no country or site of their own; they inherit their header's
-- visibility through an EXISTS, so a line can never be read or written for a
-- header the caller cannot reach. The org term is stated separately so the
-- line table is walled even if the header policy is ever loosened.
drop policy if exists material_issue_lines_org_isolation on public.material_issue_lines;
create policy material_issue_lines_org_isolation on public.material_issue_lines
  as restrictive for all
  using (exists (select 1 from public.material_issues h
                  where h.id = issue_id
                    and h.organisation_id = (select public.app_current_org())))
  with check (exists (select 1 from public.material_issues h
                  where h.id = issue_id
                    and h.organisation_id = (select public.app_current_org())));

drop policy if exists material_issue_lines_select on public.material_issue_lines;
create policy material_issue_lines_select on public.material_issue_lines
  for select using (
    public.app_is_active()
    and exists (select 1 from public.material_issues h where h.id = issue_id)
  );

drop policy if exists material_issue_lines_write on public.material_issue_lines;
create policy material_issue_lines_write on public.material_issue_lines
  for all
  using      (public.app_is_elevated() or public.app_user_can('stock','edit'))
  with check (public.app_is_elevated() or public.app_user_can('stock','edit'));


-- ── 7. Triggers ────────────────────────────────────────────────────────────
-- Mint on INSERT only, so an abandoned draft never burns a number.
create or replace function public.material_issue_mint_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  new.doc_type := upper(btrim(coalesce(new.doc_type, 'MIS')));
  if nullif(btrim(coalesce(new.issue_number, '')), '') is null then
    new.issue_number := public.next_material_issue_no(
                          new.organisation_id, new.country, new.doc_type, new.issued_at);
  else
    new.issue_number := upper(btrim(new.issue_number));
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_material_issues_mint on public.material_issues;
create trigger trg_material_issues_mint
  before insert on public.material_issues
  for each row execute function public.material_issue_mint_number();

-- Force the line's doc_type to the header's. This is what makes the generated
-- sign unbypassable: whatever a client sends is overwritten.
create or replace function public.material_issue_line_stamp_doctype()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_doc text;
begin
  select h.doc_type into v_doc from public.material_issues h where h.id = new.issue_id;
  if v_doc is null then
    raise exception 'Material issue % does not exist', new.issue_id
      using errcode = '23503';
  end if;
  new.doc_type := v_doc;
  return new;
end;
$fn$;

drop trigger if exists trg_material_issue_lines_doctype on public.material_issue_lines;
create trigger trg_material_issue_lines_doctype
  before insert or update on public.material_issue_lines
  for each row execute function public.material_issue_line_stamp_doctype();

-- If a header's doc_type is corrected, its lines must follow or the stored
-- generated line_cost keeps the old sign for ever. This is the price of the
-- denormalised column and it is paid here rather than left to a caller.
create or replace function public.material_issue_cascade_doctype()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.doc_type is distinct from old.doc_type then
    update public.material_issue_lines
       set doc_type = new.doc_type
     where issue_id = new.id
       and doc_type is distinct from new.doc_type;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_material_issues_cascade_doctype on public.material_issues;
create trigger trg_material_issues_cascade_doctype
  after update of doc_type on public.material_issues
  for each row execute function public.material_issue_cascade_doctype();

-- `zz_` so the site normaliser sorts LAST (V524: triggers fire in name order,
-- and a normaliser that runs before something which writes `site` is simply
-- overwritten).
drop trigger if exists trg_zz_normalize_site_mi on public.material_issues;
create trigger trg_zz_normalize_site_mi
  before insert or update on public.material_issues
  for each row execute function public.normalize_site();

drop trigger if exists trg_material_issues_touch on public.material_issues;
create trigger trg_material_issues_touch
  before update on public.material_issues
  for each row execute function public.set_updated_at();


-- ── 8. Read RPC ────────────────────────────────────────────────────────────
-- MONEY IS RETURNED PER COUNTRY AND IS NEVER BLENDED. Adding SAR + AED + EGP
-- produces a number that is not a quantity of anything, and this codebase has
-- had to fix exactly that bug at four separate reader sites. There is therefore
-- no single scalar total in this payload: `by_country` is the only place money
-- lives, and every store, month and item figure sits inside its country.
create or replace function public.get_material_issue_summary(
  p_country text default null,
  p_from    date default null,
  p_to      date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_out jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- The country guard. `is_super_admin()` is a term in its own right because
  -- the platform owner's profile carries NO country, so a predicate built from
  -- the scope readers alone returns them ZERO rows (the V549 trap). 'All' is
  -- the app's own all-countries sentinel and is exempt on this read.
  if p_country is not null
     and p_country <> 'All'
     and not coalesce(public.app_can_see_country(p_country), false) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with scoped as (
    select h.id, h.country, h.store_code, h.doc_type, h.issued_at,
           h.work_order_no, h.status
      from public.material_issues h
     where h.organisation_id = v_org
       and h.status <> 'cancelled'
       and (p_country is null or p_country = 'All' or h.country = p_country)
       and (p_from is null or h.issued_at::date >= p_from)
       and (p_to   is null or h.issued_at::date <= p_to)
       -- row-level country and site scope, matching the RLS predicates the
       -- policies would have applied if RLS ran inside a DEFINER function.
       and (h.country is null
            or (select public.is_super_admin())
            or (select public.app_sees_all_countries())
            or lower(btrim(h.country)) = any (coalesce((select public.app_country_scope()), '{}'::text[])))
       and (h.site is null or btrim(h.site) = ''
            or (select public.app_sees_all_sites())
            or upper(btrim(h.site)) = any (coalesce((select public.app_site_scope()), '{}'::text[])))
  ),
  lines as (
    select s.*, l.item_code, l.item_description, l.qty, l.line_cost
      from scoped s
      join public.material_issue_lines l on l.issue_id = s.id
  ),
  by_country as (
    select l.country,
           count(distinct l.id)                                              as slips,
           count(*)                                                          as line_count,
           round(coalesce(sum(l.line_cost), 0), 2)                           as net_value,
           round(coalesce(sum(l.line_cost) filter (where l.doc_type = 'MIS'), 0), 2) as issued_value,
           round(coalesce(sum(l.line_cost) filter (where l.doc_type = 'MRT'), 0), 2) as returned_value,
           count(distinct l.id) filter (where l.doc_type = 'MRT')            as return_slips
      from lines l group by l.country
  ),
  by_store as (
    select l.country, coalesce(l.store_code, '(no store)') as store_code,
           count(distinct l.id)                    as slips,
           round(coalesce(sum(l.line_cost), 0), 2) as net_value
      from lines l group by 1, 2
  ),
  by_month as (
    select l.country, to_char(l.issued_at, 'YYYY-MM') as month,
           count(distinct l.id)                    as slips,
           round(coalesce(sum(l.line_cost), 0), 2) as net_value
      from lines l group by 1, 2
  ),
  top_items as (
    select country, item_code, item_description, qty_total, net_value
      from (
        select l.country,
               coalesce(upper(btrim(l.item_code)), '(no item code)') as item_code,
               max(l.item_description)                 as item_description,
               round(coalesce(sum(l.qty), 0), 3)       as qty_total,
               round(coalesce(sum(l.line_cost), 0), 2) as net_value,
               -- The tiebreak MUST repeat the GROUP BY expression BYTE FOR BYTE.
               -- Writing `coalesce(upper(btrim(l.item_code)), '')` here instead -
               -- a different default - makes it a NEW expression that is neither
               -- grouped nor aggregated, and Postgres refuses the whole function
               -- with 42803. Caught by running this, not by reading it.
               row_number() over (partition by l.country
                                  order by coalesce(sum(l.line_cost), 0) desc,
                                           coalesce(upper(btrim(l.item_code)), '(no item code)')) as rn
          from lines l group by l.country, coalesce(upper(btrim(l.item_code)), '(no item code)')
      ) t where rn <= 15
  ),
  linkage as (
    -- how much of the store's paperwork actually reaches a job card
    select s.country,
           count(*)                                                     as slips,
           count(*) filter (where nullif(btrim(coalesce(s.work_order_no,'')),'') is not null) as slips_with_card,
           count(distinct s.work_order_no)                              as distinct_cards
      from scoped s group by s.country
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'filters', jsonb_build_object('country', p_country, 'from', p_from, 'to', p_to),
    -- Stated so a reader is never tempted to add these together.
    'currency_note', 'Each country reports in its own currency. Values are never summed across countries.',
    'by_country', coalesce((select jsonb_agg(to_jsonb(b) order by b.country) from by_country b), '[]'::jsonb),
    'by_store',   coalesce((select jsonb_agg(to_jsonb(b) order by b.country, b.net_value desc) from by_store b), '[]'::jsonb),
    'by_month',   coalesce((select jsonb_agg(to_jsonb(b) order by b.country, b.month) from by_month b), '[]'::jsonb),
    'top_items',  coalesce((select jsonb_agg(to_jsonb(t) order by t.country, t.net_value desc) from top_items t), '[]'::jsonb),
    'linkage',    coalesce((select jsonb_agg(to_jsonb(l) order by l.country) from linkage l), '[]'::jsonb)
  ) into v_out;

  return coalesce(v_out, jsonb_build_object('ok', true, 'by_country', '[]'::jsonb));
end;
$fn$;

comment on function public.get_material_issue_summary(text,date,date) is
  'Per-country store issue/return summary. Money is returned INSIDE by_country and is never blended across currencies. SECURITY DEFINER, so it re-checks org, country and site in-body - RLS does not run inside a definer function.';

revoke execute on function public.get_material_issue_summary(text,date,date) from public;
revoke execute on function public.get_material_issue_summary(text,date,date) from anon;
grant  execute on function public.get_material_issue_summary(text,date,date) to authenticated, service_role;


-- ============================================================================
-- VERIFY - EXERCISED LIVE 2026-08-24 INSIDE `begin; ... rollback;`
--
-- The arrows are values the database RETURNED. The transaction was rolled back
-- and the rollback confirmed from a fresh session.
-- ============================================================================
--
-- -- 1. THE SIGN. This is the assertion the whole design exists for.
--    insert MIS line qty 4, unit_cost 250.00  --> line_cost  +1000.00
--    insert MRT line qty 4, unit_cost 250.00  --> line_cost  -1000.00
--    insert MRT line qty 1, unit_cost 0       --> line_cost      0
--    insert MIS line qty 0                    --> REFUSED 23514 (qty > 0)
--    A return credits. There is no write path that produces a positive MRT,
--    because line_cost is generated and qty/unit_cost are CHECKed positive.
--
-- -- 2. THE CLIENT CANNOT OVERRIDE THE SIGN. Insert a line into an MRT header
-- --    while explicitly sending doc_type = 'MIS':
--    --> stored doc_type 'MRT', line_cost NEGATIVE. The BEFORE trigger
--        overwrote the supplied value. This is the assertion that proves the
--        denormalised column is not a hole.
--
-- -- 3. CASCADE. Flip a header from MIS to MRT after its lines exist:
--    before  lines doc_type MIS, line_cost +1000.00
--    after   lines doc_type MRT, line_cost -1000.00
--        The stored generated column recomputed because the AFTER trigger
--        re-stamped the line. Without that cascade the sign would be frozen
--        wrong for ever.
--
-- -- 4. NUMBER SHAPES, matching all 83,580 live slips:
--    next_material_issue_no(org,'KSA'  ,'MIS') --> GC/MIS/0001/0826
--    next_material_issue_no(org,'KSA'  ,'MIS') --> GC/MIS/0002/0826   increments
--    next_material_issue_no(org,'KSA'  ,'MRT') --> GC/MRT/0001/0826   SEPARATE sequence
--    next_material_issue_no(org,'Egypt','MIS') --> GCEG/MIS/0001/0826
--    next_material_issue_no(org,'UAE'  ,'MIS') --> GC/MIS/0001/0826
--    next_material_issue_no(org,'Oman' ,'MIS') --> GC/MIS/0001/0826   unconfigured fallback
--    next_material_issue_no(null ,'KSA','MIS') --> null
--    next_material_issue_no(org,'KSA','JUNK')  --> GC/MIS/...   coerced to MIS, never invents a doc type
--
-- -- 5. THE UNIQUE KEY, which is the point of finding (1). The SAME slip number
-- --    under TWO countries must both be accepted, because that is what the
-- --    live data does 24,239 times:
--    insert (KSA, 'GC/MIS/0001/0826')  --> accepted
--    insert (UAE, 'GC/MIS/0001/0826')  --> ACCEPTED  <- a bare unique(issue_number) would have refused this
--    insert (KSA, 'GC/MIS/0001/0826')  --> REFUSED 23505
--
-- -- 6. Cascade delete: deleting a header removed its line (1 -> 0).
--
-- -- 7. Orphan line refused: inserting a line against a non-existent issue_id
--    --> REFUSED, 'Material issue … does not exist'
--
-- -- 8. site normalisation: header site 'nhc-st' stored as 'NHC'.
--
-- -- 9. THE SUMMARY RPC, impersonating the real super admin. Two KSA slips
-- --    (one MIS +1000.00, one MRT -250.00), one UAE slip (+500.00), and one
-- --    CANCELLED KSA slip carrying 9 x 999.00 that must not appear anywhere:
--    by_country --> [ {"country":"KSA","slips":2,"line_count":2,
--                      "issued_value":1000,"returned_value":-250,
--                      "net_value":750,"return_slips":1},
--                     {"country":"UAE","slips":1,"line_count":1,
--                      "issued_value":500,"returned_value":0,
--                      "net_value":500,"return_slips":0} ]
--        SAR and AED sit in SEPARATE objects. The cancelled slip's 8,991
--        appears in no figure - `status <> 'cancelled'` held.
--    linkage    --> KSA slips 2 / slips_with_card 1 (the return has no card),
--                   UAE slips 1 / slips_with_card 1
--    top_items  --> KSA 310504-O net_value 750  (1000 issued minus 250 returned,
--                   netted across the two slips - the sign flows all the way
--                   through the aggregate, which is the point of storing it)
--    get_material_issue_summary('Egypt') --> by_country []   honest empty, not a
--                                            fabricated row of zeros
--
-- -- 9b. THE ANTI-BLEND ASSERTION. There must be no scalar total anywhere in
-- --     the payload for a caller to render by accident:
--    (summary ? 'total') or (summary ? 'net_value')  --> false
--
-- -- 10. GRANTS:
--    has_function_privilege('anon',         'next_material_issue_no(...)','execute')      --> false
--    has_function_privilege('authenticated','next_material_issue_no(...)','execute')      --> false
--    has_function_privilege('authenticated','get_material_issue_summary(text,date,date)','execute') --> true
--    has_table_privilege('authenticated','public.material_issue_counters','select')       --> false
--
-- -- 10b. THE TENANT WALL, proven by impersonation under `set local role
-- --      authenticated` as the real super admin, with a header seeded in
-- --      Company A and a second seeded in a FOREIGN org.
-- --      This matters most for `material_issue_lines`, which carries NO
-- --      organisation_id of its own and is walled only by the EXISTS against
-- --      its header. Without that policy a caller could inject a line into
-- --      another tenant's slip:
--    H0 own line visible                  --> 1     <- THE CONTROL. Without a
--                                                     positive read, the zeros
--                                                     below would only prove
--                                                     that nothing was readable.
--    H1 headers visible                   --> 1     (own only, not 2)
--    H2 lines visible                     --> 1     (own only)
--    H3 foreign header visible            --> 0
--    H4 foreign line visible              --> 0
--    H5 INSERT a line into a FOREIGN header  --> REFUSED 42501
--    H6 INSERT a header for a FOREIGN org    --> REFUSED 42501
--    H7 INSERT a line into my OWN header     --> ALLOWED   (the wall does not
--                                                           break the feature)
--    H8 privileged recount of the foreign header's lines --> 1, unchanged.
--       This is the assertion that makes H5 mean something: counting from
--       inside the impersonated session cannot tell a BLOCKED write from an
--       INVISIBLE one - both read 0. Only a `reset role` recount in the SAME
--       transaction proves the row was never written (the V542 / V501 trap).
--
-- -- 10c. TEMP-TABLE TRAP hit while writing 10b, recorded because it costs a
-- --      run every time: once `set local role authenticated` is in force, a
-- --      temp probe table needs an explicit
-- --      `grant insert, select on <tbl> to authenticated`, or the probe itself
-- --      dies with 42501 and looks like a policy failure.
--
-- -- 11. ROLLBACK CONFIRMED from a fresh session after the transaction closed:
--    to_regclass('public.material_issues')             --> null
--    to_regclass('public.material_issue_lines')        --> null
--    to_regclass('public.material_issue_counters')     --> null
--    to_regclass('public.material_issue_number_config')--> null
--    to_regproc('public.next_material_issue_no')       --> null
--    to_regproc('public.get_material_issue_summary')   --> null
--    count(*) parts_consumption                        --> 209,536  (unchanged)
--    KSA MRT sum(line_cost) --> 526,760.20  } still POSITIVE, still untouched.
--    UAE MRT sum(line_cost) -->  47,175.94  } This migration did not move a riyal.
--    count(*) work_orders                              --> 90,535   (unchanged)
--
-- ---------------------------------------------------------------------------
-- ONE REAL BUG THIS VERIFICATION CAUGHT, recorded because reading the SQL
-- would never have found it:
--   `top_items` grouped by `coalesce(upper(btrim(item_code)),'(no item code)')`
--   but its window ORDER BY tiebreak said `coalesce(upper(btrim(item_code)),'')`
--   - a DIFFERENT default, therefore a NEW expression that is neither grouped
--   nor aggregated. Postgres refused the whole function with 42803 at runtime.
--   The two expressions look identical at a glance and the function creates
--   without complaint; only calling it fails. Fixed by repeating the GROUP BY
--   expression byte for byte.
-- ============================================================================
