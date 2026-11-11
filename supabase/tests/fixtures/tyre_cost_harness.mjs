// Shared PGlite harness for the tyre-cost-audit and ai-orchestrator-budget migration tests.
//
// It applies the REAL migrations over minimal stubs of the platform pieces they depend on,
// exactly the way fixtures/workforce_harness.mjs does. The stubs mirror production semantics:
//   app_current_org()   = the caller's profile org (profiles.organisation_id by auth.uid())
//   is_super_admin()     = profiles.is_super_admin
//   get_my_role()        = profiles.role, app_role() = lower(role)
//   app_is_elevated()    = super admin OR role in (admin, manager, director)
//   app_can_see_country()= true here (country ABAC is exercised by the live DB, not these tests)
//
// The warranty/repair line classifiers (tyre_price_is_warranty / tyre_price_is_repair) live in a
// live-only migration with no repo file, so they are RE-GENERATED here from the SAME word lists
// src/lib/tyrePriceRules.js uses, which keeps the SQL tyre_cost_line_kind a faithful mirror of the
// JS lineKind for the mirror test.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { WARRANTY_WORDS, REPAIR_WORDS, REPAIR_STEMS } from '../../../src/lib/tyrePriceRules.js'

export const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
export const ORG_A = id(900)
export const ORG_B = id(901)
export const U = {
  manager: id(1), admin: id(2), director: id(3), tyreman: id(4), superadmin: id(5),
  managerB: id(6), adminB: id(7),
}

const MIG = f => readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8')
export const migrationSql = {
  budget: MIG('20261112100000_ai_orchestrator_budget.sql'),
  costAudit: MIG('20261112106000_tyre_cost_audit.sql'),
  reviewFixes: MIG('20261112107000_ai_cost_review_fixes.sql'),
}

// POSIX-regex escape identical to tyrePriceRules.js hasWord(); the only special char in the
// word lists is the '.' in "f.o.c", which escapes the same way for Postgres as for JS.
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const warrantyRe = `(^|[^a-z0-9])(${WARRANTY_WORDS.map(esc).join('|')})([^a-z0-9]|$)`
const repairWordRe = `(^|[^a-z0-9])(${REPAIR_WORDS.map(esc).join('|')})([^a-z0-9]|$)`
const repairStemRe = `(^|[^a-z0-9])(${REPAIR_STEMS.map(esc).join('|')})[a-z]*([^a-z0-9]|$)`

// Platform stubs shared by both migration sets. Pass findingsStub/budgetStub for the migration set
// that does NOT create the real table (the orchestrator set never loads 106000; the cost-audit set
// never loads 100000), so the OTHER migration's CREATE OR REPLACE / policy still resolves.
async function buildPlatform (db, { findingsStub = false, budgetStub = false } = {}) {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;

    create table public.profiles(id uuid primary key, organisation_id uuid, role text,
      is_super_admin boolean default false, country text, approved boolean default true, locked boolean default false);
    create function public.app_current_org() returns uuid language sql stable security definer set search_path=public as $$
      select organisation_id from public.profiles where id = auth.uid() $$;
    create function public.is_super_admin() returns boolean language sql stable security definer set search_path=public as $$
      select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false) $$;
    create function public.get_my_role() returns text language sql stable security definer set search_path=public as $$
      select role from public.profiles where id = auth.uid() $$;
    create function public.app_role() returns text language sql stable security definer set search_path=public as $$
      select lower(coalesce(public.get_my_role(), '')) $$;
    create function public.app_is_elevated() returns boolean language sql stable security definer set search_path=public as $$
      select public.is_super_admin() or public.app_role() in ('admin', 'manager', 'director') $$;
    -- Country ABAC is a live-DB concern; here every caller can see every country.
    create function public.app_can_see_country(p text) returns boolean language sql stable set search_path=public as $$
      select true $$;
    create function public.currency_for_country(p text) returns text language sql immutable set search_path=public as $$
      select case upper(coalesce(p, '')) when 'KSA' then 'SAR' when 'UAE' then 'AED' when 'EGYPT' then 'EGP' end $$;
    -- Catalogue of tyre brand tokens used by the spec-mismatch check; a realistic subset.
    create function public.brain_tokens(p text) returns text[] language sql immutable set search_path=public as $$
      select case when p = 'tyre_brand'
        then array['TRIANGLE','BRIDGESTONE','MICHELIN','DOUBLE COIN','HANKOOK','PIRELLI','ERICLE'] else array[]::text[] end $$;

    -- Real body (from 20261109100000); only strong serials are reconciled across rows.
    create function public.tyre_serial_is_strong(p_serial text) returns boolean language sql immutable set search_path=public as $$
      select coalesce(
        length(btrim(p_serial)) >= 6
        and upper(btrim(p_serial)) !~ '^(DOT|NULL|N/?A|-)'
        and upper(btrim(p_serial)) !~ '^[0-9]{3}/'
        and upper(btrim(p_serial)) !~ '[0-9]{2,3}/[0-9]{2}\\s*R'
        and upper(btrim(p_serial)) !~ 'E\\+[0-9]+$', false) $$;

    -- Mirror of src/lib/tyrePriceRules.js, generated from the same word lists.
    create function public.tyre_price_is_warranty(p_text text) returns boolean language sql immutable set search_path=public as $$
      select coalesce($1 ~* '${warrantyRe}', false) $$;
    create function public.tyre_price_is_repair(p_text text) returns boolean language sql immutable set search_path=public as $$
      select coalesce($1 ~* '${repairWordRe}', false) or coalesce($1 ~* '${repairStemRe}', false) $$;

    create table public.tyre_records(id uuid primary key default gen_random_uuid(), organisation_id uuid, country text,
      cost_per_tyre numeric, job_card text, issue_date date, fitment_date date, size text, brand text, serial_no text,
      site text, asset_no text, km_at_fitment numeric, km_at_removal numeric, total_km numeric);
    create table public.parts_consumption(id uuid primary key default gen_random_uuid(), organisation_id uuid, country text,
      work_order_no text, item_code text, event_date date, item_description text, qty_n numeric, line_cost numeric, cost_category text);
    create table public.warranty_claims(id uuid primary key default gen_random_uuid(), serial_number text);
    create table public.tyre_price_backfill_log(id uuid primary key default gen_random_uuid(), tyre_id uuid, source text,
      new_cost numeric, created_at timestamptz default now());

    -- tyre_cost_corrections + undo (from 20261109090000), the real objects the apply RPC writes.
    create table public.tyre_cost_corrections(id bigserial primary key, organisation_id uuid, batch_id uuid not null,
      tyre_id uuid not null, country text, serial_no text, old_cost numeric, new_cost numeric, reason text not null,
      created_by uuid default auth.uid(), created_at timestamptz not null default now(), undone_at timestamptz);
    create function public.tyre_cost_correction_undo(p_batch uuid) returns jsonb language plpgsql security definer set search_path=public as $fn$
    declare v_n int;
    begin
      if not public.is_super_admin() then raise exception 'Only a super admin can undo a cost correction' using errcode = '42501'; end if;
      update public.tyre_records t set cost_per_tyre = c.old_cost from public.tyre_cost_corrections c
        where c.batch_id = p_batch and c.undone_at is null and t.id = c.tyre_id and t.cost_per_tyre is not distinct from c.new_cost;
      get diagnostics v_n = row_count;
      update public.tyre_cost_corrections set undone_at = now() where batch_id = p_batch and undone_at is null;
      return jsonb_build_object('ok', true, 'restored', v_n);
    end $fn$;

    -- AI tables the budget migrations read/write.
    create table public.ai_token_logs(id uuid primary key default gen_random_uuid(), user_id uuid, organisation_id uuid,
      model text, feature text, prompt_tokens int, completion_tokens int,
      total_tokens int generated always as (coalesce(prompt_tokens,0) + coalesce(completion_tokens,0)) stored,
      cost_usd numeric, status text, http_status int, error text, latency_ms int, created_at timestamptz not null default now(),
      provider_called_at timestamptz);
    create table public.ai_tyre_inspection_jobs(id uuid primary key default gen_random_uuid(), provider_called_at timestamptz,
      cost_usd numeric, reserved_usd numeric, budget_settled_at timestamptz, last_retry_at timestamptz, prior_billed_usd numeric);
    create table public.system_config(key text primary key, value text, category text, description text);
    -- Delegate stub for ai_tyre_reserve_budget_atomic (never exercised by these tests).
    create function public.ai_tyre_reserve_budget(p_job uuid, p_estimate numeric, p_daily numeric) returns jsonb
      language sql stable set search_path=public as $$ select jsonb_build_object('ok', true) $$;

    -- Knowledge base: 107000 part 3 replaces its guards and adds a delete trigger here.
    create table public.knowledge_documents(id uuid primary key default gen_random_uuid(), chunk_of uuid, status text,
      approved_by uuid, approved_at timestamptz, withdrawn_by uuid, withdrawn_at timestamptz, content text, title text,
      version text, effective_from date, chunk_count int, created_by uuid);
    create function public.kb_is_approver() returns boolean language sql stable set search_path=public as $$
      select public.app_is_elevated() $$;

    -- Anon reader policies hook (no-op here); every table-creating migration ends with it.
    create schema anum_integration;
    create function anum_integration.apply_reader_policies() returns void language sql as $$ select $$;

    grant usage on schema public, auth to authenticated, service_role;
    grant select on public.profiles, public.tyre_records, public.parts_consumption,
      public.warranty_claims, public.tyre_price_backfill_log to authenticated;

    insert into public.profiles(id, organisation_id, role, is_super_admin, country) values
      ('${U.manager}',    '${ORG_A}', 'Manager',  false, 'KSA'),
      ('${U.admin}',      '${ORG_A}', 'Admin',    false, 'KSA'),
      ('${U.director}',   '${ORG_A}', 'Director', false, 'KSA'),
      ('${U.tyreman}',    '${ORG_A}', 'Tyre Man', false, 'KSA'),
      ('${U.superadmin}', '${ORG_A}', 'Admin',    true,  null),
      ('${U.managerB}',   '${ORG_B}', 'Manager',  false, 'KSA'),
      ('${U.adminB}',     '${ORG_B}', 'Admin',    false, 'KSA');
  `)

  if (budgetStub) {
    // The cost-audit set loads 107000 (which replaces the settle fn whose DECLARE needs this
    // composite type) but never loads 100000, so stub the reservation table here.
    await db.exec(`
      create table public.ai_budget_reservations(id uuid primary key, feature text default 'orchestrator',
        organisation_id uuid, user_id uuid, reserved_usd numeric, actual_usd numeric, status text default 'reserved',
        token_log_id uuid, error text, created_at timestamptz default now(), settled_at timestamptz);`)
  }
  if (findingsStub) {
    // The orchestrator set loads 107000 part 2 (tcaf_insert policy + apply fn) but never loads
    // 106000, so stub the findings table with the columns the policy references.
    await db.exec(`
      create table public.tyre_cost_audit_findings(id uuid primary key default gen_random_uuid(),
        organisation_id uuid not null default public.app_current_org(), tyre_id uuid, country text, site text, asset_no text,
        serial_no text, job_card text, month text, class text, original_cost numeric, proposed_cost numeric, currency text,
        item_code text, source_line_id text, confidence text, reasons jsonb default '[]'::jsonb, status text default 'proposed',
        decided_by uuid, decided_at timestamptz, decision_note text, applied_batch uuid, applied_at timestamptz,
        first_seen timestamptz default now(), last_seen timestamptz default now(), dedupe_key text);
      alter table public.tyre_cost_audit_findings enable row level security;
      grant select, insert on public.tyre_cost_audit_findings to authenticated;`)
  }
}

/** Platform + the tyre cost audit migrations (106000 then its review fixes 107000). */
export async function createCostAuditDb () {
  const db = new PGlite()
  await buildPlatform(db, { budgetStub: true })
  await db.exec(migrationSql.costAudit)
  await db.exec(migrationSql.reviewFixes)
  return db
}

/**
 * Platform + the ai-orchestrator budget migrations (100000 then its review fix 107000).
 * `mutate` can rewrite the 107000 SQL to prove an assertion is load-bearing.
 */
export async function createBudgetDb ({ mutate = s => s } = {}) {
  const db = new PGlite()
  await buildPlatform(db, { findingsStub: true })
  await db.exec(migrationSql.budget)
  await db.exec(mutate(migrationSql.reviewFixes))
  return db
}

/** Run fn as `uid` under the authenticated role (RLS applies). */
export async function asClient (db, uid, fn) {
  await db.exec(`set test.uid = '${uid}'; set role authenticated`)
  try { return await fn() } finally { await db.exec('reset role; reset test.uid') }
}

/** Run fn impersonating `uid` as the owner (SECURITY DEFINER RPCs; auth.uid() still set). */
export async function asUser (db, uid, fn) {
  await db.exec(`set test.uid = '${uid}'`)
  try { return await fn() } finally { await db.exec('reset test.uid') }
}
