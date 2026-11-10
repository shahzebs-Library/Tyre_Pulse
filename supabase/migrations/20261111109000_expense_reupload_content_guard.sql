-- Expense re-upload guard keyed on CONTENT, not on the `#` column.
--
-- Owner, 2026-11-10: the `#` column is only the row counter of each downloaded
-- file. It restarts in every export, so the same ERP issue line carries a
-- different `#` in two overlapping files and import_uid (built from it) never
-- matched. That let 2,191 lines (KSA SAR 369,786.07, Egypt EGP 585,375.71) land
-- twice; they were removed the same day (_bak.parts_reupload_dup_20261110).
--
-- Rule: a freshly inserted line is skipped when the same line was already stored
-- by an EARLIER upload (older than 20 minutes). Same line = org, country, issue
-- number, job card, item code, event date, qty, value, store code, cost centre.
-- Multiplicity-aware: if the earlier upload stored a line twice and the new file
-- carries it three times, two are skipped and one lands (per-transaction counter).
-- Rows within one upload are never compared with each other, so two genuinely
-- identical lines in one file both land.
--
-- Not touched: rows carrying an old created_at (restores from backup / Duplicate
-- Control undo) and any session that sets tp.allow_dup_expense = 'on'.
-- Runs AFTER trg_classify_parts_consumption (name order) so event_date is set.
-- Skipped lines are logged to expense_import_rejects (reason 'already_stored').
--
-- Rollback: drop trigger trg_dedupe_expense_reupload on public.parts_consumption;
--           drop function public.expense_reupload_guard();

create or replace function public.expense_reupload_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior int;
  v_key   text;
  v_seen  int;
begin
  if coalesce(current_setting('tp.allow_dup_expense', true), '') = 'on' then
    return new;
  end if;
  -- only fresh uploads; restored rows keep their original created_at
  if new.created_at is not null and new.created_at < now() - interval '1 minute' then
    return new;
  end if;

  select count(*) into v_prior
  from public.parts_consumption p
  where p.organisation_id is not distinct from new.organisation_id
    and p.country is not distinct from new.country
    and p.event_date is not distinct from new.event_date
    and p.issue_number is not distinct from new.issue_number
    and p.work_order_no is not distinct from new.work_order_no
    and p.item_code is not distinct from new.item_code
    and p.qty is not distinct from new.qty
    and p.value_amount is not distinct from new.value_amount
    and p.store_code is not distinct from new.store_code
    and p.cost_center is not distinct from new.cost_center
    and p.created_at < now() - interval '20 minutes';

  if v_prior = 0 then
    return new;
  end if;

  v_key := 'tp_expdup.k' || md5(concat_ws('|', new.organisation_id, new.country, new.event_date,
            new.issue_number, new.work_order_no, new.item_code, new.qty, new.value_amount,
            new.store_code, new.cost_center));
  v_seen := coalesce(nullif(current_setting(v_key, true), ''), '0')::int;

  if v_seen >= v_prior then
    return new;               -- earlier copies already matched; this one is extra in the file
  end if;

  perform set_config(v_key, (v_seen + 1)::text, true);
  begin
    insert into public.expense_import_rejects
      (organisation_id, uploaded_country, detected_country, work_order_no, item_code,
       item_description, value_amount, source_row, reject_reason)
    values (new.organisation_id, new.country, new.country, new.work_order_no, new.item_code,
            new.item_description, new.value_amount::numeric, new.source_row::text, 'already_stored');
  exception when others then null;  -- logging must never block the import
  end;
  return null;
end;
$$;

revoke all on function public.expense_reupload_guard() from public;
revoke all on function public.expense_reupload_guard() from anon, authenticated;

drop trigger if exists trg_dedupe_expense_reupload on public.parts_consumption;
create trigger trg_dedupe_expense_reupload
  before insert on public.parts_consumption
  for each row execute function public.expense_reupload_guard();
