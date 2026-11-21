-- =============================================================================
-- 20261121100000_inv_reconcile_multi_balance.sql
-- STATUS: APPLIED to production 2026-11-21 05:48:59 UTC on the owner's approval (ledger
--         20261121100000 inv_reconcile_multi_balance; executed body = this file at commit
--         fd85a466, sha256 5b7ea51349d0b2d8b53d5fa72decbe6d405790020ed27940ead43e88f6c9f6a1,
--         i.e. before this header edit). Evidence: docs/inventory/96 section 9.
-- Requires 20261120100000..115000 (applied in production 2026-11-20).
-- Rollback: supabase/rollbacks/20261121100000_inv_reconcile_multi_balance_ROLLBACK.sql
--
-- Defect (Codex review on PR #569, confirmed in code): _inv_audit_reconcile ties a
-- count line that names no stock balance (no stock_id: Flutter scans, web "found
-- item" lines) to ONE snapshot balance with `limit 1` when the item/location holds
-- several balances (condition / ownership splits). The whole count is credited to
-- an arbitrary balance; the others read `not_counted` or as false shortages, and
-- the excess lands on the arbitrary one.
-- Production impact on 2026-11-20 (read-only): 0 item/location groups with more than
-- one balance (no stock_records row carries an item_id yet), 0 audits.
--
-- Fix (non-serial branch only; serial audits unchanged):
--   * a count line without stock_id is tied to a balance ONLY when its item/location
--     has exactly one snapshot balance;
--   * when an item/location has several balances and at least one count line for it
--     names none, the item/location is reconciled ONCE: expected = sum of the
--     balances' expectations, cutoff = sum of their post-cutoff movements, counted =
--     sum of every line of the latest round for that item/location; any discrepancy
--     is recorded at item/location level (stock_id NULL, like unexpected items),
--     with a unit cost only when every balance carries the same cost and currency;
--   * everything else behaves exactly as before.
-- Method: patched IN PLACE from the live definition (md5 guard of the live body,
-- read from production 2026-11-20: ba9845b1df32d899ff58bd87d8372bf0, and one
-- anchored replace that must occur exactly once). Original kept in
-- _bak.inv_121100_snapshot; the rollback executes it verbatim. CREATE OR REPLACE
-- keeps owner, SECURITY DEFINER, search_path and ACL. No data row is written.
-- =============================================================================
begin;

create schema if not exists _bak;
create table if not exists _bak.inv_121100_snapshot (
  obj text primary key,
  def text not null,
  captured_at timestamptz not null default now()
);
revoke all on _bak.inv_121100_snapshot from public;

do $do$
declare
  v_sig constant text := 'public._inv_audit_reconcile(uuid)';
  v_md5_expected constant text := 'ba9845b1df32d899ff58bd87d8372bf0';
  v_anchor constant text := $anc$      with keyed as (
        select coalesce(c.stock_id, s.stock_id) as stock_id, c.location_id, c.item_id, c.round, c.counted_qty, c.confirmed_zero,
               c.counted_at, c.unexpected
          from public.inventory_count_lines c
          left join lateral (select sl.stock_id from public.inventory_audit_snapshot_lines sl
                              where sl.audit_id = c.audit_id and c.stock_id is null and sl.item_id = c.item_id
                                and sl.location_id is not distinct from c.location_id limit 1) s on true
         where c.audit_id = v.id and c.serial is null),
      maxround as (select stock_id, location_id, item_id, max(round) as rnd from keyed group by 1, 2, 3),
      counted as (select k.stock_id, k.location_id, k.item_id, sum(coalesce(k.counted_qty, 0)) as qty, max(k.counted_at) as at
                    from keyed k join maxround m on m.stock_id is not distinct from k.stock_id
                     and m.location_id is not distinct from k.location_id and m.item_id is not distinct from k.item_id
                     and m.rnd = k.round
                   group by 1, 2, 3)
      select s.stock_id, s.location_id, s.item_id, s.site, s.expected_qty, s.unit_cost, s.currency,
             c.qty as counted, c.at as counted_at, (c.stock_id is not null or c.item_id is not null) as was_counted,
             coalesce((select sum(m.qty_change) from public.stock_movements m
                        where m.stock_id = s.stock_id and m.movement_seq > v.cutoff_seq
                          and m.posted_at <= coalesce(c.at, v.counting_completed_at, clock_timestamp())), 0) as cutoff_adj,
             false as unexpected
        from public.inventory_audit_snapshot_lines s
        left join counted c on c.stock_id = s.stock_id
       where s.audit_id = v.id and s.serial is null
      union all
      select c.stock_id, c.location_id, c.item_id, v.site, 0, null, null, c.qty, c.at, true, 0, true
        from counted c
       where c.stock_id is null or not exists (select 1 from public.inventory_audit_snapshot_lines s
                                                where s.audit_id = v.id and s.stock_id = c.stock_id)$anc$;
  v_repl constant text := $rep$      with snap as (
        select sl.stock_id, sl.location_id, sl.item_id, sl.site, sl.expected_qty, sl.unit_cost, sl.currency
          from public.inventory_audit_snapshot_lines sl where sl.audit_id = v.id and sl.serial is null),
      bal_n as (select sn.item_id, sn.location_id, count(*) as n from snap sn group by 1, 2),
      keyed as (
        -- A count line that names no balance is tied to a balance ONLY when its
        -- item/location has exactly one balance in the snapshot (no guessing).
        select coalesce(c.stock_id, s.stock_id) as stock_id, c.location_id, c.item_id, c.round, c.counted_qty, c.confirmed_zero,
               c.counted_at, c.unexpected
          from public.inventory_count_lines c
          left join lateral (select sl.stock_id from snap sl
                              where c.stock_id is null and sl.item_id = c.item_id
                                and sl.location_id is not distinct from c.location_id
                                and (select b.n from bal_n b where b.item_id = c.item_id
                                       and b.location_id is not distinct from c.location_id) = 1
                              limit 1) s on true
         where c.audit_id = v.id and c.serial is null),
      -- item/locations held in several balances AND counted without naming one:
      -- reconciled ONCE for the whole item/location (sum of expectations).
      amb as (select distinct k.item_id, k.location_id from keyed k
                join bal_n b on b.item_id = k.item_id and b.location_id is not distinct from k.location_id
               where k.stock_id is null and b.n > 1),
      amb_round as (select k.item_id, k.location_id, max(k.round) as rnd from keyed k
                      join amb a on a.item_id = k.item_id and a.location_id is not distinct from k.location_id group by 1, 2),
      amb_counted as (select k.item_id, k.location_id, sum(coalesce(k.counted_qty, 0)) as qty, max(k.counted_at) as at
                        from keyed k join amb_round m on m.item_id = k.item_id
                         and m.location_id is not distinct from k.location_id and m.rnd = k.round
                       group by 1, 2),
      plain as (select k.* from keyed k
                 where not exists (select 1 from amb a where a.item_id = k.item_id and a.location_id is not distinct from k.location_id)),
      maxround as (select stock_id, location_id, item_id, max(round) as rnd from plain group by 1, 2, 3),
      counted as (select k.stock_id, k.location_id, k.item_id, sum(coalesce(k.counted_qty, 0)) as qty, max(k.counted_at) as at
                    from plain k join maxround m on m.stock_id is not distinct from k.stock_id
                     and m.location_id is not distinct from k.location_id and m.item_id is not distinct from k.item_id
                     and m.rnd = k.round
                   group by 1, 2, 3)
      select s.stock_id, s.location_id, s.item_id, s.site, s.expected_qty, s.unit_cost, s.currency,
             c.qty as counted, c.at as counted_at, (c.stock_id is not null or c.item_id is not null) as was_counted,
             coalesce((select sum(m.qty_change) from public.stock_movements m
                        where m.stock_id = s.stock_id and m.movement_seq > v.cutoff_seq
                          and m.posted_at <= coalesce(c.at, v.counting_completed_at, clock_timestamp())), 0) as cutoff_adj,
             false as unexpected
        from snap s
        left join counted c on c.stock_id = s.stock_id
       where not exists (select 1 from amb a where a.item_id = s.item_id and a.location_id is not distinct from s.location_id)
      union all
      select null::uuid, a.location_id, a.item_id, min(s.site), sum(s.expected_qty),
             case when count(s.unit_cost) = count(*) and count(distinct s.unit_cost) = 1 and count(distinct s.currency) = 1
                  then min(s.unit_cost) end,
             case when count(distinct s.currency) = 1 then min(s.currency) end,
             max(ac.qty), max(ac.at), true,
             coalesce((select sum(m.qty_change) from public.stock_movements m
                        join snap s2 on s2.stock_id = m.stock_id
                       where s2.item_id = a.item_id and s2.location_id is not distinct from a.location_id
                         and m.movement_seq > v.cutoff_seq
                         and m.posted_at <= coalesce(max(ac.at), v.counting_completed_at, clock_timestamp())), 0),
             false
        from amb a
        join snap s on s.item_id = a.item_id and s.location_id is not distinct from a.location_id
        join amb_counted ac on ac.item_id = a.item_id and ac.location_id is not distinct from a.location_id
       group by a.location_id, a.item_id
      union all
      select c.stock_id, c.location_id, c.item_id, v.site, 0, null, null, c.qty, c.at, true, 0, true
        from counted c
       where c.stock_id is null or not exists (select 1 from public.inventory_audit_snapshot_lines s
                                                where s.audit_id = v.id and s.stock_id = c.stock_id)$rep$;
  v_def text; v_md5 text; v_n int;
begin
  if to_regprocedure(v_sig) is null then
    raise exception '121100: % is missing; apply 20261120100000..115000 first.', v_sig;
  end if;
  v_def := pg_get_functiondef(to_regprocedure(v_sig));
  if position('amb_counted' in v_def) > 0 then
    raise notice '121100: % already reconciles multi-balance item/locations; left as is.', v_sig;
    return;
  end if;
  v_md5 := md5(replace(v_def, chr(13), ''));
  if v_md5 <> v_md5_expected then
    raise exception '121100: % differs from the reviewed definition (md5 % expected %); refusing to patch.',
      v_sig, v_md5, v_md5_expected;
  end if;
  v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_n <> 1 then
    raise exception '121100: anchor found % times in %; refusing to patch.', v_n, v_sig;
  end if;
  insert into _bak.inv_121100_snapshot(obj, def) values (v_sig, v_def) on conflict (obj) do nothing;
  execute replace(v_def, v_anchor, v_repl);
  if position('amb_counted' in pg_get_functiondef(to_regprocedure(v_sig))) = 0 then
    raise exception '121100: patch did not take effect.';
  end if;
end $do$;

commit;

-- VERIFY:
-- select position('amb_counted' in pg_get_functiondef('public._inv_audit_reconcile(uuid)'::regprocedure)) > 0;  -- t
-- select has_function_privilege('authenticated', 'public._inv_audit_reconcile(uuid)', 'EXECUTE');            -- f
-- select count(*) from _bak.inv_121100_snapshot;                                                             -- 1
