# Tyre Pulse OEM Parts Catalog: Complete Implementation Plan

**Status:** Architecture and delivery plan  
**Owner:** Tyre Pulse product and engineering  
**Scope:** Multi-brand fleet parts identification by chassis/VIN, model generation, assembly illustration, and OEM part number.

## 1. Product goal

Build an OEM-style electronic parts catalog (EPC) inside Tyre Pulse. A user should be able to identify a fleet asset, open the correct product configuration, browse assemblies, click a real callout on an illustration, and immediately see the corresponding OEM part record. Users who already know a part number must also be able to search directly.

The catalog must preserve the OEM’s source, revision, applicability, part-number text, descriptions, quantities, variants, and illustration-to-list relationship. It must make uncertainty visible. A plausible make/model match must never be presented as a confirmed chassis fitment.

This module is an **OEM reference catalog**. It is separate from warehouse stock, purchasing price, and tyre inventory. A user may add a selected item to a parts request or link it to an internal stock item, but that action must not create stock or cost without an explicit inventory transaction.

## 2. Research findings and the OEM pattern

EPCs use structured product and parts data connected to 2D or 3D figures. The figure is not simply a document page: each callout/hotspot is associated with one or more parts-list entries. Catalog content is filtered using the vehicle/product configuration, such as VIN, serial number, optional equipment, and date or serial effectiveness. PTC describes configuration-specific filtering and interactive illustration-linked parts lists; Snap-on describes VIN filtering at illustration and part level. See [PTC electronic parts catalogs](https://www.ptc.com/en/technologies/service-lifecycle-management/electronic-parts-catalog-software) and [Snap-on EPC 5](https://sbs.snapon.com/construction-agriculture/epc/epc/).

Typical user interaction:

1. Identify the product using VIN/chassis, equipment serial number, or manual model selection.
2. Resolve the applicable catalog edition, model generation, market, options, and serial/date range.
3. Browse a product hierarchy such as vehicle system → assembly → figure.
4. Show an illustration with interactive callouts beside a parts list.
5. Clicking a callout selects the mapped line or alternatives; clicking a line highlights the callout.
6. Add the selected OEM item to a job, quote, or request list. An optional integration can transfer it into a dealer or inventory system.

A callout number is a **figure index**, not an orderable part number. One callout may return a base part plus variants, left/right options, quantities, or serial-range alternatives. The data model must preserve this one-to-many relationship.

### Free catalog source finding

There is no single verified free source with complete, current, downloadable catalogs for all vehicle and equipment brands. Some OEMs provide free lookup tools or selected public PDFs; others provide access through a customer/dealer portal, serial-number login, subscription, or licensed feed. Free access to view information does not automatically grant the right to bulk download, copy, or redistribute its database.

| Source | What the official source says | Tyre Pulse use |
|---|---|---|
| [Cat SIS2GO](https://www.cat.com/sis2go) and [Cat free parts reference guides](https://www.cat.com/en_US/support/maintenance/parts-reference-guides.html) | Cat offers parts information/operation and maintenance information at no charge in SIS2GO and offers selected free parts reference guides. These are not evidence of a universal downloadable full catalog for every model. | Use for manual verification. Import a PDF only where the OEM makes it downloadable and its terms allow this use. |
| [Bobcat official parts catalog](https://www.bobcat.com/na/en/parts-service/parts-catalog) | Official online parts diagrams/lists with searches such as serial or model. | Use as a reference lookup. Do not assume the portal provides a reusable PDF or bulk-data feed. |
| [Hitachi Selected Parts](https://www.hitachicm.com/global/en/products/parts-service/parts/selected-parts/) | Selected parts catalog material is offered as PDF. | Good source for those published selections, not a complete universal EPC feed. |
| [SANY MySANY](https://www.sanyglobal.com/mysany/) and [SANY support](https://www.sanyglobal.com/india/Maintenance-Support/index.html) | MySANY advertises equipment and parts-manual access. SANY support directs users needing spare-parts books to the distributor or SANY. | Check account/market access with the relevant distributor. Import only authorized PDFs. |

For VIN structure, use the vehicle’s actual identity and an authorized, market-appropriate decoder or OEM dataset. ISO 3779 specifies the VIN content and structure; it does not provide a universal parts-fitment database. Heavy equipment often uses manufacturer-specific serial/equipment numbers rather than a road-vehicle VIN. See [ISO 3779](https://www.iso.org/standard/52200.html).

## 3. Current preview and important boundary

The current preview PR contains the foundation:

- Import a PDF once, extract selectable-text parts rows, and store the original in a private bucket.
- Search by part number/description or browse from a fleet chassis/VIN to a saved manual.
- Select an assembly/illustration and show the drawing with its matched parts rows in one catalog screen.
- Model generation and year range can be entered with the manual metadata.
- A part-number result routes to the matching illustration view instead of opening a separate PDF-page dialog.

The current diagram view renders a page from the stored PDF in the app and uses the PDF text layer to propose clickable callout positions. That is a useful preview, but it is not yet the final EPC hotspot system. It can fail on scanned/image-only figures, unusual callout typography, duplicate numbers, and figures where a callout’s text position is not the true clickable region. A final implementation needs verified, stored hotspot geometry mapped to part-entry IDs. Until reviewed, such inferred hotspots must be shown as unverified and must not claim exact OEM fitment.

## 4. User workflows

### A. Chassis/VIN or equipment-serial lookup (primary)

- Search Tyre Pulse assets by full chassis/VIN/equipment serial, fleet number, registration, or asset number.
- Display matched asset identity and the reason for each catalog match.
- Prefer an exact chassis/serial-range match. Then apply model code, generation, year, market, and configuration filters.
- If multiple manuals or variants remain, ask the user to choose or show a clear “confirm configuration” state. Never silently select a weak match.
- Show the assembly tree and the illustration/parts list in the same responsive screen.

### B. Model and generation lookup (when chassis is unknown)

- Select manufacturer → product family → model → generation/series → model code/variant → year or serial range → market/configuration.
- Enter generation and applicability when importing the manual. Do not require a VIN to browse a known manual.
- Show the fitment scope in the header so the user knows whether this is an exact serial match or a model-level reference.

### C. Part-number lookup

- Search exact and normalized OEM numbers, superseded numbers, description, model, assembly, and source.
- Result action opens the in-app interactive figure and selects the matching callout/row. It must not open the source PDF viewer.
- If the part appears in multiple models/figures, list all matches and their fitment scopes.

### D. Add a selected part

- Users can collect parts from multiple figures and manuals in one selection table without losing each item’s own catalog/model, fitment metadata, assembly/figure, callout/index, source pages, OEM quantity, and requested quantity.
- The selection table supports quantity edits, duplicate prevention, removal, and clearing. Each chosen OEM row becomes its own line in the existing Parts Requests workflow so request status and approval continue to use the current lifecycle.
- Store the OEM number, description, catalog/model/generation, applicability fields, assembly/figure, callout/index, source PDF/list pages, and any variant note in the request details. Keep the inventory item link separate; do not invent an internal SKU or mutate stock when creating an OEM request.
- If the user associates the batch with a work order, verify its asset matches the selected parts’ asset before creating the request lines. Support an unlinked general request when there is no matching work order.
- “Link to inventory item” is an authorized catalog cross-reference action. It does not adjust stock, price, or tyre data.
- Actual stock receipt/issue remains in the existing inventory workflow with its normal authorization and audit trail.

## 5. Data model

Keep catalog reference data separate from operational inventory. Use tenant-scoped, revision-aware records. The existing `oem_parts_manuals` and `oem_parts_entries` tables are a starting point; evolve them with additive migrations after schema review.

### 5.1 Required entities

| Entity | Important fields | Purpose |
|---|---|---|
| `oem_catalog_sources` | brand, source name, official URL, source type, access/rights note, owner, active status | Track where a catalog came from and the permitted use. |
| `oem_product_models` | manufacturer, family, model, generation/series, model code, market, year range | Normalize model identity across manual revisions. |
| `oem_catalog_editions` | product/model IDs, revision/effective date, source file/hash, source URL, page count, extraction status, import summary, reviewer/status | One uploaded or authorized catalog edition. Preserve original file hash and revision. |
| `oem_applicability` | edition/product ID, chassis/serial prefix/range, VIN range or decoder key, year/date range, market, engine/option/configuration predicates | Define which assets and parts the edition covers. |
| `oem_assemblies` | edition ID, parent assembly, assembly code/title, sort order | Build the OEM navigation hierarchy. |
| `oem_illustrations` | assembly ID, figure number, image asset path, source page, width/height or SVG viewBox, revision, image status | Store an in-app diagram independent of the PDF viewer. |
| `oem_parts` | OEM number as printed, normalized number, description, unit, quantity-per-assembly, notes, item type | Store the searchable OEM part row without losing source wording. |
| `oem_illustration_items` | illustration ID, parts-row ID, callout/index, variant/parent relation, fitment condition, sort order | Link a callout to one or more part rows. |
| `oem_hotspots` | illustration-item ID, normalized x/y or SVG polygon/path, source figure dimensions, mapping method, confidence, verification state, reviewer and timestamp | Define the actual clickable region on the illustration. |
| `oem_part_supersessions` | old number, new number, direction, effective date, source | Track replacements without overwriting historical source rows. |
| `oem_inventory_crosswalk` | OEM part ID, internal parts-catalog item ID, conversion/unit, status, reviewer | Connect the OEM identity to internal inventory without conflating the records. |
| `oem_import_jobs` | edition ID, stage, progress, per-page result, errors, retry count, review queue | Make large imports resumable and auditable. |

### 5.2 Data integrity rules

- Preserve the exact OEM part-number string and store a separate normalized search key. Never normalize away the displayed original.
- A catalog edition is immutable after approval. Corrections create a new edition or a reviewed change record.
- Keep `figure callout`, `OEM part number`, internal SKU, and requested quantity as separate fields.
- Allow a callout to map to multiple parts and allow a part to appear in multiple figures.
- Store serial/date/market applicability at the correct level: edition, assembly, figure, and/or line. Do not assume one fitment rule applies to every page.
- Preserve supersession, alternate, variant, left/right, quantity, notes, and source page references.
- Store extraction confidence and review status. Do not silently discard rows/pages that could not be parsed.
- Retain source provenance on every imported edition and every reviewed hotspot.

## 6. Catalog ingestion and illustration pipeline

### 6.1 Authorized source intake

1. User selects a manufacturer, model, generation, market, and catalog revision.
2. User uploads an authorized PDF or a supported structured OEM dataset. Record source name/URL and rights/access note.
3. Validate MIME, file signature, size, page count, hash, and tenant quota. Keep the source private.
4. Deduplicate exact files by tenant + hash, but allow one source file to be associated with multiple separately reviewed model/serial applicability records if the OEM book covers them.
5. Create a resumable import job so large manuals do not restart from page one after a browser interruption.

### 6.2 Parts-list extraction

- First parse selectable PDF text and layout using table/column boundaries.
- Identify page type: cover, contents, illustration, parts list, notes, or unclassified.
- Extract source page, printed page, assembly title, index, parent index, OEM number, description, remark, quantity, unit, `SEE`/figure reference, variants, and source text.
- Keep original string values and row position for audit.
- Use OCR only for scanned pages. OCR output is a draft, not approved data. Keep image coordinates and confidence for review.
- Show per-page counts, unparsed page warnings, duplicate detection, missing indexes, malformed numbers, and extraction coverage before commit.
- Allow a reviewer to correct fields in a review grid and compare against the source image.

### 6.3 Illustration preparation and hotspot authoring

- Extract each illustration figure as a high-resolution image or supported vector graphic asset. The UI displays only the figure, not a PDF page/document viewer.
- Preserve original aspect ratio and coordinate system. Store width/height or SVG `viewBox`, plus figure revision.
- Create hotspot records with normalized coordinates (0–1) or SVG paths/polygons so positions remain correct under zoom, responsive scaling, and high-DPI displays.
- Link each hotspot to a callout and one or more part rows. Store whether it came from OEM structured data, an imported mapping, OCR suggestion, or a human reviewer.
- Provide a visual admin tool: choose figure → select an existing part-list index → click/outline the actual location → save → preview hover/click behavior → mark verified.
- Support multiple points for one callout and multiple part alternatives on one callout.
- For imported PDFs, OCR/text detection may suggest callout labels/positions. Require visual confirmation before marking the figure verified.
- Include figure versioning and a diff/re-review path when a revised catalog changes illustration dimensions or callout placement.

## 7. Vehicle and fitment resolution

### Match priority

1. Exact chassis/VIN/equipment serial match to a known asset and catalog applicability record.
2. Exact OEM model code + generation + market + serial/year range.
3. Exact make/model/generation but no serial-range confirmation, clearly labeled as model-level.
4. Make/model-only match, shown as unverified and requiring user confirmation.
5. No match: show available manuals and request the missing model code, generation, serial range, or OEM manual.

### Rules

- Do not treat generic VIN decoding as sufficient to determine every OEM option or parts configuration. Use an OEM-authorized/contracted decoder or validated fleet data when exact build codes/options are needed.
- Heavy equipment serial/equipment numbers use manufacturer-specific formats; do not force them into passenger-car VIN rules.
- Store chassis/serial ranges as strings with manufacturer-aware comparison rules. Do not lexicographically compare arbitrary serial formats unless the OEM defines that ordering.
- Make country/market, build date, engine, transmission, attachments, and option codes available as fitment filters where the OEM provides them.
- When data is absent or ambiguous, display the reason and request confirmation rather than guessing.

## 8. Interactive catalog user interface

### Main catalog screen

- Persistent vehicle identity strip: fleet asset, chassis/serial, make/model, generation, market, and fitment confidence.
- Assembly tree/list and filters on one side; interactive figure in the main panel; searchable parts table alongside or below it on narrow screens.
- Clicking a verified hotspot selects/highlights its row and shows OEM part number, description, quantity, variants, notes, fitment, and source citation inline.
- Clicking a table row highlights/scrolls to the matching hotspot; hover provides the same link.
- Support pan, zoom, reset, full-screen figure, touch, keyboard focus, and accessible labels.
- Show visible selected-state styling, highlight all alternatives/variants tied to the callout, and do not hide the rest of the parts list.
- The app must not open the PDF when a user selects a callout or part search result. A separate “view source document” action may be available to authorized reviewers only.
- If a figure is not mapped or is not verified, label it and offer the parts table/source reference instead of displaying fake hotspots.

### Search

- Exact OEM number first, then normalized number and supersession lookup.
- Description and assembly full-text search.
- Filters for brand, model, generation, year/serial range, market, catalog edition, and verified fitment.
- Search results always show the source edition and fitment scope.

## 9. Application and backend architecture

### Front end

- React catalog route with diagram renderer, SVG/canvas hotspot layer, synchronized parts table, fitment summary, and reviewer mode.
- Keep image rendering and hotspot geometry separate from source-document viewing.
- Lazy-load the selected illustration and relevant parts rows; do not load every image for every manual at once.

### Backend/data access

- Supabase Postgres for tenant-scoped product, edition, fitment, assembly, part, illustration, hotspot, and inventory crosswalk data.
- Supabase Storage private bucket for original PDFs and derived illustration assets. Use short-lived signed URLs or authenticated downloads; do not expose source manuals in a public bucket. Supabase documents that private buckets enforce access control and signed URLs are time-limited: [Storage bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals).
- RLS on every table and object path by organization; admin/manager roles control imports and hotspot approval; normal users can read approved catalogs allowed for their organization.
- Import Edge Function/worker for long-running extraction if browser-side processing is unreliable. Use idempotent batches, per-page checkpoints, retry limits, and audit events.
- API routes for asset fitment, manual search, assembly/figure retrieval, part search, hotspot selection, import progress, and reviewer actions.
- Keep order/stock operations in their existing services; catalog references must not bypass inventory business rules.

### Performance targets

- First usable catalog view under 2 seconds after the manual is selected on a typical office connection, excluding initial source-file fetch where applicable.
- Search response p95 under 500 ms for a tenant catalog of 100,000 part rows, using indexes and bounded result pages.
- Load only the selected figure and its part list; use a thumbnail for assembly browsing.
- Use CDN caching only for derived, non-sensitive public assets. Keep private manual assets access-controlled.
- Paginate large lists, virtualize long part tables, and cache the current manual/figure per user session.

## 10. Security, rights, and audit

- Only store catalogs that Tyre Pulse/company is authorized to use. Respect OEM/customer portal terms and license limits; do not scrape authenticated or protected EPC portals or redistribute their data without permission.
- Keep every customer’s catalog records and files tenant-isolated with RLS and private object paths.
- Validate uploaded files and keep extraction in a sandboxed worker with size/page/time limits.
- Never log full chassis/VIN values unnecessarily. Mask identifiers in routine logs and retain full values only where operationally required under company policy.
- Audit imports, metadata edits, extraction corrections, hotspot reviews, fitment overrides, and internal-item links with actor, timestamp, before/after values, and source edition.
- Provide an export/deletion process that follows the catalog license and customer data-retention requirements.

## 11. Quality assurance and test plan

### Data tests

- Exact part number and normalized search preserve leading zeros and punctuation in the displayed OEM number.
- Every approved hotspot maps to at least one part row; every mapped row has a valid figure/callout reference or an explicit exception.
- Variants, parent indices, quantity, left/right notes, supersessions, and repeated callouts remain linked correctly.
- Serial/year/date range boundaries include/exclude the correct catalog editions.
- No cross-tenant catalog, part, manual, image, or signed URL access.

### UI and integration tests

- Chassis lookup → exact asset → correct manual → assembly → click hotspot → matching row/details inline.
- Reverse direction: click row → hotspot highlights; search part number → matching figure opens in the app and row is selected; no PDF viewer/modal appears.
- Ambiguous vehicle/manual returns explicit choices and does not claim exact fitment.
- Image-only/scanned figure displays as unverified until reviewed; fallback parts table remains usable.
- Zoom/responsive resize does not shift hotspots from their targets; test desktop, tablet, and mobile/touch.
- Unauthorized user cannot import, alter fitment, review hotspots, or link inventory.
- Large PDF import survives refresh/retry and reports partial failures accurately.

### Operational acceptance metrics

- At least 99% of the pilot’s manually verified hotspot selections open the intended part-list row.
- At least 99% of part rows in the pilot sample preserve the exact source OEM number and description.
- Zero silent “exact fit” results when only make/model-level evidence exists.
- Every catalog edition has source, revision/hash, import status, and fitment scope.
- The user can complete both primary tasks: find by chassis and find by part number, without opening a PDF.

## 12. Delivery roadmap

| Phase | Deliverables | Exit criteria |
|---|---|---|
| 0. Preview correction | Keep part details inline; part search routes to in-app diagram; generation/year metadata and source references remain visible. | User can review the flow on preview; no PDF popup during ordinary selection. |
| 1. Fitment schema | Normalized model/generation/market/serial ranges, editions, applicability and confidence; tenant RLS and audit. | Migrations reviewed; exact-vs-model-level matching works with fixtures. |
| 2. Import pipeline | Resumable PDF/structured-data import, page classification, extraction summary, review queue, source provenance. | No unreported page/row loss; duplicate/manual revision handling is deterministic. |
| 3. Native illustrations | Derived image/vector figures, normalized hotspot coordinate format, synchronized part list. | Hotspots remain aligned under zoom/responsive layout. |
| 4. Hotspot review studio | Visual callout annotation, validation, reviewer approval, version/diff workflow. | No inferred hotspot is treated as verified before human/OEM validation. |
| 5. Fleet fitment and search | Chassis/serial lookup, generation/configuration filters, exact/ambiguous result handling, part-number/description search. | Pilot assets resolve to their intended catalog or clearly report missing fitment data. |
| 6. Parts requests and inventory crosswalk | Add selected parts to a request/job; optional reviewed link to internal parts master. | No stock/cost changes occur from catalog browsing. Existing stock transactions remain authoritative. |
| 7. Multi-brand pilot and expansion | Pilot with representative manuals from each active brand; source permissions, data quality metrics, user training, monitoring. | Sign-off for each brand/model family before claiming coverage. Add authorized OEM feeds/API contracts as available. |

## 13. Required inputs and decisions

### Needed from the company

- The list of active vehicle/equipment brands and priority models/generations.
- For each pilot model: one known chassis/serial number, model code/generation, market, and a manual/catalog edition confirmed by the dealer/OEM.
- Confirmation that each uploaded PDF/data source may be stored and used by Tyre Pulse for internal parts identification.
- A small set of known-good examples: chassis → expected assembly → callout → OEM part number, including variants and serial breaks.
- Which roles may import manuals, approve OCR/hotspots, link internal inventory items, and add request lines.
- Whether initial output should create a parts request only or later connect to purchasing/work orders.

### Defaults until decided

- Chassis/serial search and part-number search are both supported.
- The OEM catalog is reference data, not stock.
- Each import is associated with brand/model/generation/year/serial applicability and a source revision.
- Users see an explicit warning when fitment is model-level or unverified.
- Only authorized public, customer-provided, or licensed source data is ingested.
- The preview remains isolated until the user approves production release.

## 14. Research references

- [PTC: Electronic Parts Catalog Software](https://www.ptc.com/en/technologies/service-lifecycle-management/electronic-parts-catalog-software) — configuration filters, interactive illustration-linked itemization, 2D/3D figures.
- [Snap-on: EPC 5 for construction/agriculture](https://sbs.snapon.com/construction-agriculture/epc/epc/) — VIN filtering at illustration and part level, searches, integration.
- [Snap-on: GM Global EPC Quick Reference Guide](https://sbs.snapon.com/wp-content/uploads/2020/09/GM_EPC_QRG_en.pdf) — illustration, parts list, VIN, shopping-list, and parts-transfer workflow.
- [PTC Illustrate documentation](https://support.ptc.com/help/visualization/illustrate/r2027.0/en/illustrate/visualization/illustrate/gxy1.html) — linking service-BOM parts to figures and generating callouts/item lists from CAD data.
- [ISO 3779](https://www.iso.org/standard/52200.html) — VIN content/structure standard; not a parts-fitment dataset.
- [Supabase Storage fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals) and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) — private buckets, RLS, signed URLs.
