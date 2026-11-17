# OEM catalog backlog (not done in this change)

- Reviewer screen for the stored `import_summary.reviewQueue` (approve, edit, re-publish rows). The queue is capped at 500 rows per import; larger queues need a table.
- Real columns on `oem_parts_entries`: `assembly_area`, `assembly_group`, `confidence`, `review_status`. Today the area per figure lives in `oem_parts_manuals.import_summary.figures`. Draft migration to place under `supabase/pending_migrations/` only when approved, with a ROLLBACK.
- Per-OEM part-number patterns (SANY and others) to tighten `validateRow`.
- Truck overview map for the "where on the machine" thumbnail (needs authored data).
- OCR route for image-only parts lists (tesseract.js baseline, review required).
- Supersession and serial-range applicability tables (plan sections 5.1 and 5.2).
- Unrelated finding: `OemPartsCatalogPreview.jsx` still carries several English-only strings in its import form and the request modal; only the page chrome and all table or viewer text are localised so far.
- `designSystemRatchet` counts raw tables only under `src/pages`; the new tables live in `src/components/oemCatalog` as semantic tables with sticky headers, not EnterpriseTable, because the mockup needs row-highlight selection linked to the drawing.
