# Linking an unmatched stock line to its item: proposed database change (NOT APPLIED)

Written 2026-11-24. Read-only checks only; nothing here has been applied.

## Why a database change is needed

The Controls > Unmatched items screen proposes a Material Master item for each stock line whose `item_id` is
empty. Confirming a proposal means setting `stock_records.item_id`. No existing server path does that:

| Existing function | What it does | Sets `stock_records.item_id`? |
|---|---|---|
| `inv_material_link_item(p_payload)` | Links an ERP item (`material_master`) to a catalogue item (`material_canonical_items`) | No |
| `stock_entry_resolve(...)` | Read-only lookup used by quick entry | No |
| `save_stock_entry(...)` | Quick count/receipt; writes `custom_data.stock_item` | No |
| `_inv_post`, `set_stock_count`, `_inv_opening_batch_decide` | Post quantity | No |
| `inv_pi_capture_map(p_payload)` | Maps a physical-inventory capture | No |

Signed-in users have no direct write on `stock_records`, and the `inv_balance_guard` trigger refuses any change
of `item_id` unless `inv.posting` is on. So the link must be a SECURITY DEFINER function.

`inv_material_link_item` does not help either: the 28 coded lines point to 17 distinct ERP items, 16 of which are
already catalogue-linked; the 17th has no catalogue SKU at all.

## Live facts (2026-11-24)

- 43 stock lines have `item_id` NULL; 0 of them have a `location_id`, so the
  `stock_records_item_balance_uq` index (which needs both `item_id` and `location_id`) cannot collide.
- 28 carry a code in `custom_data->stock_item->code`; every one has exactly one KSA `material_master` row.
- 15 carry no code: 7 demo-org lines, 8 real tyres (e.g. "315/80R22.5 Double coin" at NHC,
  "315/80R22.5 Eracle" at RIY-MET / QIDDIYA-LOWER PLATEAU).
- 78 `stock_movements` rows belong to those 43 lines and also have `item_id` NULL.

## Proposed function

Confirm-only: the caller names the stock line and the item; nothing is guessed server-side. Exact-code lines
and suggestion lines go through the same call, because a person confirms both.

```sql
create or replace function public.inv_stock_link_item(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r jsonb;
  v_org uuid := public.app_current_org();
  v_stock public.stock_records%rowtype;
  v_item  public.material_master%rowtype;
  v_basis text := coalesce(nullif(p_payload->>'basis', ''), 'manual');
begin
  r := public._inv_req_begin('inv_stock_link_item', p_payload);
  if r is not null then return r; end if;

  -- Same right as linking an ERP SKU to the catalogue: a master-data decision.
  if not public._inv_pi_can_master() then
    raise exception 'Linking a stock line needs stock:engineering_approve or an elevated role.' using errcode = '42501';
  end if;
  if v_basis not in ('exact_code', 'confirmed_suggestion', 'manual') then
    raise exception 'Invalid basis.' using errcode = '22023';
  end if;

  select * into v_stock from public.stock_records where id = (p_payload->>'stock_id')::uuid for update;
  if not found or v_stock.organisation_id is distinct from v_org then
    raise exception 'Stock line not found in your company.' using errcode = 'P0002';
  end if;
  if not public.app_write_country_ok(v_stock.country)
     or not (coalesce(public.app_sees_all_sites(), false)
             or upper(btrim(v_stock.site)) = any(coalesce(public.app_site_scope(), '{}'::text[]))) then
    raise exception 'Stock line is outside your scope.' using errcode = '42501';
  end if;
  if v_stock.item_id is not null then
    raise exception 'This stock line is already linked. Use a correction request to move it.' using errcode = '23505';
  end if;
  if (p_payload->>'expected_updated_at')::timestamptz is distinct from v_stock.updated_at then
    raise exception 'The stock line changed. Refresh and review again.' using errcode = 'PT409';
  end if;

  select * into v_item from public.material_master where id = (p_payload->>'item_id')::uuid;
  if not found or v_item.organisation_id is distinct from v_org or v_item.country is distinct from v_stock.country then
    raise exception 'Item not found in this company and country.' using errcode = 'P0002';
  end if;
  -- An exact-code confirmation must really be the same code.
  if v_basis = 'exact_code'
     and upper(btrim(coalesce(v_stock.custom_data->'stock_item'->>'code', ''))) is distinct from upper(btrim(v_item.item_code)) then
    raise exception 'The code on the stock line does not match this item.' using errcode = '22023';
  end if;

  perform set_config('inv.posting', 'on', true);
  update public.stock_records
     set item_id = v_item.id, updated_at = clock_timestamp(), updated_by = auth.uid()
   where id = v_stock.id;
  -- Ledger rows of this line carry the item too, so item-level history is complete.
  -- (Only if stock_movements allows it under inv.posting; drop this statement if movements are immutable.)
  update public.stock_movements set item_id = v_item.id where stock_id = v_stock.id and item_id is null;
  perform set_config('inv.posting', '', true);

  perform public.record_audit_event('stock_line_linked', 'stock_records', v_stock.id::text,
    jsonb_build_object('item_id', null),
    jsonb_build_object('item_id', v_item.id, 'item_code', v_item.item_code, 'basis', v_basis,
                       'note', nullif(p_payload->>'note', '')));

  return public._inv_req_end('inv_stock_link_item', p_payload,
    jsonb_build_object('stock_id', v_stock.id, 'item_id', v_item.id, 'basis', v_basis));
end $function$;

revoke all on function public.inv_stock_link_item(jsonb) from public;
revoke all on function public.inv_stock_link_item(jsonb) from anon;
grant execute on function public.inv_stock_link_item(jsonb) to authenticated, service_role;
```

Payload: `{ idempotency_key, stock_id, item_id, basis, expected_updated_at, note }`.

## Checks before applying

1. Confirm `_inv_req_begin` / `_inv_req_end` accept a new action name (they key idempotency on it).
2. Confirm whether `stock_movements` has an immutability trigger. If it does, remove the movements update; the
   stock line link alone is enough for the register.
3. Rolled-back test as a Store Keeper (refused), as an engineering approver (allowed), on a coded line
   (`basis = exact_code`), on a no-code line (`basis = confirmed_suggestion`), a second call (refused, already
   linked), and a replay with the same idempotency key (returns the first result).
4. Verify `anon` cannot execute it (`has_function_privilege('anon', ..., 'EXECUTE') = false`).

## Client wiring after it is applied

`src/components/inventory/UnmatchedItemsPanel.jsx` renders a disabled "Confirm link" button per proposal.
Enable it for users with the master-data right, call the function with the proposal's item id and the line's
`updated_at`, then reload the list. The demo lines should not be linked; they are test data.
