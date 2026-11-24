# Workshop <-> warehouse: job card materials (database change proposed, NOT applied)

Migration: `supabase/migrations/20261124131000_wms_workshop_job_materials.sql`. Apply only on the owner's yes,
after WP4 (20261124090000) and WP5 (20261124091000). It refuses to run if WP5 is missing.

## Flow and where each step is enforced

| Step | How | Enforced in the database by |
|---|---|---|
| Request | Store checked first; free stock reserved for the job card (`inv_reserve`) | `_inv_reserve` (issue capability, scope, shortage) |
| Shortage | Only the uncovered quantity becomes a requisition (`requisitions.job_card_no`, item_id) | requisitions RLS (own insert, draft/submitted, org/country/site) |
| Issue | One MIS slip (job card, asset, receiver, stock line, reservation) posted by `inv_issue_slip` | WP5 slip posting (idempotent per line) + this file: the line's reservation must be an open reservation of the slip's job card on the same stock line |
| Install | `inv_confirm_installation` | new table `job_material_installations`, no client write grant; scope, capability (stock issue or work_orders edit or elevated), no self-certification, bounded by issued - returned - installed, idempotent |
| Return | `inv_post_movement` issue_return against the job card | WP5 bound + new trigger: cannot return parts confirmed installed; an issue with installations cannot be reversed |
| Cost | Issue movements per currency, unvalued shown as unvalued | ledger values (WP5 returns at issued cost) |

`unreconciled = issued - returned - installed` per job card and stock line; both writers take the same advisory lock.

## Proof (rolled back, 2026-11-24)

Recorded in the migration header (19 cases, all as expected; nothing persisted, checked afterwards).
Limits of the run: WP4 and the WP5 transfer / D3 / D7 sections were not included (they do not touch these objects);
the reversal guard was not reached (the Store Keeper lacked `adjustment_approve`, which refused first); the
signature column was renamed `signature_image` and widened to accept a PNG data URL after the run.

## Open

- Photo evidence: the RPC accepts a storage path in `photo_path`, but no upload bucket/policy is wired for it.
- `work_order_stock_reservations` (0 rows, no writer) is still not consumed; job cards use `stock_reservations`.
- Installation by role: technicians need `work_orders` edit or stock issue; plain Reporters are refused.
