# OEM Parts Catalog Agent Work Rules

These instructions apply to tasks that change files under `docs/oem-parts-catalog/`. Repository-root `AGENTS.md` rules still apply everywhere else.

## Source of truth

- Treat [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) as the product and architecture source of truth.
- Read only the plan sections needed for the assigned issue, plus these local rules and the repository-root `AGENTS.md`.
- Continue from the current `main` state. The chassis-first preview is already merged; do not rebuild it as if it were absent.
- The implementation is not complete just because the preview route exists. The plan distinguishes preview behavior from verified OEM EPC behavior.

## Work-package boundaries

Use one GitHub issue and one focused PR per work package. Do not take overlapping packages without coordinating in their issues first.

| Package | Scope | Depends on |
|---|---|---|
| A. Catalog and fitment data model | Product/model generations, catalog editions, applicability/effectivity, assemblies, parts, illustration items, hotspot records, tenant RLS and additive migrations. | None |
| B. Authorized catalog ingestion | Source provenance, upload validation, resumable import jobs, extraction/page review, OCR review states, duplicate/revision behavior. | A’s reviewed data contract |
| C. Native illustration and hotspot review | Derived figure assets, stable coordinate system, hotspot annotation/verification UI, mapping provenance and figure revision handling. | A’s illustration/hotspot data contract; may use fixtures while B is in progress |
| D. Fitment and interactive EPC browser | Chassis/VIN/serial/model-generation resolution, assembly navigation, synchronized diagram and parts rows, direct part-number search, verified/ambiguous states. | A, plus B/C contracts; use approved fixtures until those packages land |
| E. Parts request and inventory crosswalk | Add-to-request behavior and reviewed OEM-to-internal-item mapping; no stock/price mutation from catalog browsing. | A and D |

An issue can be split further if it is too large, but preserve these dependencies and keep one owner per shared migration or API contract.

## Required behavior in every package

- A callout is an illustration index, not an OEM orderable part number. Preserve the distinction and allow one callout to map to multiple parts/variants.
- Normal users must not be sent to a PDF page when selecting a part. The diagram, hotspots, and matched parts list belong in the catalog screen. Source-document viewing is a separate reviewer-only action if implemented.
- Never mark OCR/text-derived hotspot positions as verified until reviewed against the actual diagram.
- Never claim exact fitment from make/model alone. Expose exact chassis/serial, model-generation, model-only, and unresolved match states.
- Do not scrape authenticated/protected OEM portals or import data without documented authorization. Record the source and catalog revision.
- Keep OEM reference data separate from internal stock, pricing, and tyre inventory. Linking an OEM item must not create stock transactions.
- Preserve organization isolation, role checks, auditability, signed/private file access, and existing app conventions.

## PR and handoff requirements

Every agent PR must:

1. Name the exact work package and issue; list the plan sections it implements.
2. State what is complete, what remains, and any unsupported OEM data formats or fitment cases.
3. Include focused tests for changed behavior and migration/RLS coverage when database behavior changes.
4. Provide a screenshot or short screen recording for diagram/hotspot UI changes, including a verified click selecting the correct parts row.
5. Avoid unrelated refactors, generated-file edits, fabricated catalog data, or placeholder controls.
6. Remain unmerged unless the user has explicitly authorized merging that PR.

## Definition of done for the complete EPC

The catalog is not ready to call complete until a pilot catalog can pass the plan’s acceptance criteria: reviewed callout-to-part mapping, exact/ambiguous fitment handling, bidirectional figure/list selection, direct part-number lookup, authorized source/revision provenance, tenant isolation, and zero ordinary-user PDF-page popups.
