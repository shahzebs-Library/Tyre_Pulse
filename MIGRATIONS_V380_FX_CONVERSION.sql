-- V380 - currency conversion: the mechanism, with no invented rates.
--
-- Applied live 2026-07-27 (v380, v380b). This file is the record.
--
-- WHY IT WAS OPEN
-- Every combined-country total in this system has been blocked on two things:
-- nobody had chosen a rate policy, and `currency_rates` was empty (0 rows).
-- V366 added `parts_consumption.fx_rate_to_base` for exactly this moment and
-- left it null. The standing rule has been to NEVER invent a rate, because a
-- wrong one reads as authoritative and is worse than three honest per-country
-- figures.
--
-- WHAT THIS DOES
-- Builds the whole path and leaves it INERT. With no approved rate it converts
-- nothing, `fx_coverage` reports `complete: false`, and callers say the total is
-- not available. Per-country figures are untouched. The moment an administrator
-- enters and approves three rates it starts working, with no code change.
--
-- THE POLICY IS A STORED CHOICE, not a hardcoded one, because all three answers
-- are legitimate and only the customer's finance function can pick:
--   transaction  - the rate on the day the cost was incurred. Most faithful to
--                  each line; a month's total then mixes many rates.
--   monthly_avg  - one rate per calendar month. The usual management-reporting
--                  choice: months stay comparable, one volatile day cannot move
--                  a total. DEFAULT, because this is a management system.
--   closing      - the rate at period end applied to everything in it. Matches
--                  a balance-sheet translation.

insert into public.system_config (key, value, description)
values ('fx_policy', 'monthly_avg',
        'How costs are converted between currencies: transaction, monthly_avg or closing. Inert until currency_rates holds approved rates.')
on conflict (key) do nothing;

-- fx_rate_for(org, from, to, on_date, policy) -> numeric
--   Returns the APPROVED rate under the stored policy, or NULL. Never guesses,
--   never falls back to 1.0. Same currency returns 1, the one rate that needs
--   no data. monthly_avg falls back to the most recent earlier approved rate
--   rather than failing a whole report for one missing month, but it will not
--   extrapolate BACKWARDS past the first rate on record.
--
-- fx_convert(org, amount, from, to, on_date, policy) -> numeric
--   amount * fx_rate_for(...). NULL in, NULL out; no rate, NULL out.
--
-- fx_coverage(target, from, to) -> jsonb
--   { ok, policy, target, currencies:[{currency, rate}], complete }
--   The question a UI must ask BEFORE offering a combined total, so a total is
--   never built from partial coverage and silently missing a country.
--
-- See the live database for the full bodies. All three are SECURITY DEFINER with
-- pinned search_path; only fx_coverage is granted to `authenticated`, and it
-- takes no org argument (org comes from app_current_org()). fx_rate_for and
-- fx_convert are revoked from authenticated entirely - they accept an org id, and
-- the V378 lesson is that a DEFINER helper taking an org id must never be
-- callable by a user role.
--
-- =========================================================================
-- V380b. An FX rate rescales reported money across the whole company, so
-- `currency_rates_write` allowing "any approved, unlocked user" was too loose.
-- Two levels, matching the distinction the service makes:
--   ENTER   - elevated (Admin, Manager, Director). Lands unapproved, used by
--             nothing.
--   APPROVE - Admin or super-admin only. Approval is the act that lets a rate
--             move money, so approval is what is restricted.
-- =========================================================================
drop policy if exists currency_rates_write on public.currency_rates;
create policy currency_rates_write on public.currency_rates
  for all to authenticated
  using ((select public.app_is_elevated()))
  with check ((select public.app_is_elevated()));

create or replace function public.guard_currency_rate_approval()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- only a change TO approved is guarded; withdrawing approval is a safety
  -- action and stays available to any elevated user
  if coalesce(NEW.approved, false) = true
     and coalesce(OLD.approved, false) is distinct from true then
    if not (public.is_super_admin() or public.get_my_role() = 'Admin') then
      raise exception 'Only an administrator can approve an exchange rate'
        using errcode = '42501';
    end if;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  end if;
  return NEW;
end $$;

drop trigger if exists trg_guard_currency_rate_approval on public.currency_rates;
create trigger trg_guard_currency_rate_approval
  before insert or update on public.currency_rates
  for each row execute function public.guard_currency_rate_approval();

-- =========================================================================
-- VERIFIED LIVE, every check in a rolled-back transaction
--
-- With the table empty:
--   fx_coverage('SAR', ...) -> complete:false, AED null, EGP null, SAR 1
--
-- With two test rates inserted (rolled back, table still 0 rows):
--   AED to SAR on 2026-06-15          -> 1.0211
--   EGP to SAR on 2026-06-15          -> 0.0777
--   USD to SAR (no rate on record)    -> NULL
--   convert 1000 AED                  -> 1021.10
--   SAR to SAR                        -> 1
--   AED to SAR on 2025-01-15 (before
--   any rate exists)                  -> NULL   (no backwards extrapolation)
--
-- Approval guard, impersonating real users:
--   Admin   enter unapproved          -> allowed
--   Admin   approve                   -> allowed
--   Manager enter unapproved          -> allowed
--   Manager approve                   -> BLOCKED "Only an administrator can approve"
--   Manager insert a row already
--   flagged approved                  -> BLOCKED (the guard runs on INSERT too,
--                                        so the obvious bypass is closed)
--
-- CLIENT SIDE
--   src/lib/api/currencyRates.js               list / add / approve / delete / coverage
--   src/console/pages/config/FxRatesPanel.jsx  mounted on Console System Configuration
--
-- WHAT REMAINS, and it is not code: an administrator must enter AED to SAR and
-- EGP to SAR (or whichever base is chosen) and approve them. Until then the
-- system correctly declines to show a combined total.
-- =========================================================================
