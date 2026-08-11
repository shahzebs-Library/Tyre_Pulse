-- V517 - price an expense line that arrived with no value at all
-- STATUS: APPLIED LIVE 2026-08-11 (as V517 / V517b / V517c)
--
-- The owner's rule: "where it has code matching take it from other item codes,
-- match zero cost add there, unless it's warranty".
--
-- WHAT IT DOES
--   A line with no amount is priced from the MEDIAN unit cost of the SAME item
--   code in the SAME country, times its own quantity. A median, not the nearest
--   row, so one mistyped price cannot become the answer for a whole item code.
--
-- WHY A NEW COLUMN INSTEAD OF WRITING line_cost
--   classify_parts_consumption is a BEFORE INSERT OR UPDATE trigger that
--   RE-DERIVES line_cost from the raw ERP text columns on every write. Writing
--   line_cost directly is silently reverted to 0 the next time the row is
--   touched, and writing value_amount would rewrite what the ERP actually sent.
--   filled_cost is a separate, clearly-labelled LAST rung on the amount ladder:
--   the raw columns stay exactly as delivered and every estimated figure can be
--   told apart from a real one.
--
-- THREE RULES THAT ARE LOAD-BEARING
--   1. A row this process priced is NEVER evidence for another (filled_cost is
--      null in the evidence CTE), or one estimate seeds the next and the
--      numbers drift away from anything anyone paid.
--   2. Warranty lines stay at zero - a free replacement genuinely cost nothing.
--      parts_cost_is_warranty owns that test in ONE place. V517c widened it to
--      the ERP's OWN spellings after finding two live KSA lines reading
--      "TIRE -WARRENTY -315/80 R 22.5"; a plain 'warrant' test misses those, and
--      they only stayed at zero because no other line shares their item code -
--      luck, not a rule. Same class as the KSA 'cooliant' spelling.
--   3. Money is reported per country and never blended.
--
-- MEASURED ON APPLY: 1,068 lines priced - KSA 1,066 (SAR 31,972.98),
--   Egypt 1 (EGP 12), UAE 1 (AED 600). 14 KSA lines are left honestly at zero:
--   every one has NO priced sibling anywhere, so there is nothing to copy from.
--   Batch a97352f4-fd21-4d9e-b02d-d60c2987f0a2.
--
-- UNDO: select parts_cost_fill_undo('<batch>');  (verified round trip)

alter table public.parts_consumption
  add column if not exists filled_cost numeric,
  add column if not exists filled_cost_basis text;

comment on column public.parts_consumption.filled_cost is
  'Machine-estimated line value used ONLY when the ERP sent no amount. Never overwrites a real amount.';

-- classify_parts_consumption: the amount ladder gains one final rung, AFTER
-- every real ERP amount, plus a unit_cost recompute (a filled row already
-- carries unit_cost 0, so the old "only when null" guard would never refresh it).
-- Full body is in the applied migration; the change is:
--   v_line := coalesce(nullif(v_val,0), nullif(v_tot,0), nullif(greatest(...),0));
--   if v_line is null and NEW.filled_cost > 0 then v_line := NEW.filled_cost; v_filled := true; end if;
--   v_line := coalesce(v_line, 0);
--   ... if (NEW.unit_cost is null or v_filled) and NEW.qty_n > 0 then recompute

create table if not exists public.parts_cost_fill_log (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  line_id uuid not null,
  organisation_id uuid,
  country text,
  item_code text,
  filled_amount numeric,
  basis text,
  sample_size int,
  filled_at timestamptz not null default now(),
  filled_by uuid default auth.uid()
);
create index if not exists parts_cost_fill_log_batch_idx on public.parts_cost_fill_log(batch_id);
create index if not exists parts_cost_fill_log_line_idx on public.parts_cost_fill_log(line_id);
alter table public.parts_cost_fill_log enable row level security;

drop policy if exists parts_cost_fill_log_read on public.parts_cost_fill_log;
create policy parts_cost_fill_log_read on public.parts_cost_fill_log
  for select to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

create or replace function public.parts_cost_is_warranty(p_desc text)
 returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(p_desc, '') ~*
    '(warrant|warrent|warent|waranty|gaurantee|guarantee|free of charge|free issue|foc\M|no charge|zero charge|complimentary)'
$$;

-- parts_cost_fill(p_country, p_dry_run default true) -> jsonb
--   {ok, dry_run, batch, lines, by_country:[{country, lines, value, currency}]}
--   elevated-gated, org-scoped, dry run touches nothing.
--   NOTE: percentile_cont returns double precision - the median MUST be cast to
--   numeric or round(value, 2) raises 42883 (fixed in V517b).
-- parts_cost_fill_undo(p_batch uuid) -> jsonb {ok, reverted}
--   clears filled_cost, and the trigger returns the line to 0 by itself.
--
-- Both are SECURITY DEFINER. Grants follow the V500 order: grant the roles that
-- need it, revoke PUBLIC, THEN revoke anon by name - a revoke from anon is a
-- no-op against a PUBLIC grant, and revoking PUBLIC alone would also strip
-- authenticated. Verified after apply: anon_exec false, auth_exec true on all three.
