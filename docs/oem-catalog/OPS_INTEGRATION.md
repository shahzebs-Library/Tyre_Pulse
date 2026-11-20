# Operational integration: what exists, what the catalog uses, what is missing

Inspected read-only in the repo (no production access).

| Flow | Exists | Where | What the OEM catalog does |
|---|---|---|---|
| Spare-parts request tied to a work order | yes | `parts_requests` (V296), `src/lib/api/partsRequests.js` (`createPartsRequest`, `listOpenJobs`), statuses requested, approved, issued, fulfilled, rejected, cancelled | "Add selected part to work order" and the Selected tab create ONE request per part through this service. OEM part number, description, figure, callout, source page and fitment go into `notes`. RLS (requester or elevated) and country/site scoping are unchanged |
| Internal parts / stock | yes | `parts_catalog` (`on_hand_qty`, `uom`), `src/lib/api/partsCatalog.js`, `stock_records`, `stock.js` | Basket shows `on_hand_qty` only when the SAME part number exists in `parts_catalog`, labelled "identical part number, not a verified link" |
| Requisition, purchase order, goods receipt | yes (separate modules) | `requisitions.js`, `purchaseOrders.js`, `goodsReceipts.js`, `procurement.js` | Not linked from the catalog. Requests are raised through Parts Requests; procurement follows its existing process |
| Stock reservation | no | `parts_catalog` has no reserved quantity | Shown as "not tracked". No reservation is faked |
| Ordered / partially received / received / installed / returned lifecycle per OEM part | no | `parts_requests` stops at fulfilled; goods receipts carry no link to a parts request or OEM part | Not shown. The drawer says no stock or work-order status exists for OEM parts yet |
| OEM-to-internal item crosswalk (agent guide package E) | no | none | Not built. Needs a reviewed mapping table; until then no stock link is claimed |

## Duplicate prevention
The basket key is `manual id + entry id`, so the same OEM row cannot be added twice, and different parts are never merged. Parts sent to Parts Requests leave the basket one by one, and a failure keeps the remaining ones selected (existing behaviour).

## Traceability today
OEM part number, equipment, work order and request are traceable through the request `notes` text and `parts_requests.job_id`. A structured link (columns on `parts_requests`, or a crosswalk table) is the next step and needs owner approval.
