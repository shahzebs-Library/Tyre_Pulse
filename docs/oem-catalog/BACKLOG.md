# OEM catalog backlog (not done)

Done items are tracked in the PR #565 checklist. What is left, stated plainly:

## Needs owner approval before it can be built or enabled
- Apply `supabase/pending_migrations/20261118100000_oem_catalog_advanced.sql` (rollback and reconciliation plan beside it). Until then: review queue is capped at 500 rows inside `import_summary`, figures live in `import_summary.figures`, and import is admin-only only in the UI and service layer, not yet in RLS.
- Decision: Manager and Director lose catalog import and edit (today they have it).
- OEM-to-internal item crosswalk and structured request links (see `OPS_INTEGRATION.md`).

## Engine
- No real OEM manual exists in the repo; all accuracy numbers are on synthetic PDFs (`src/test/oemGeometryAccuracy.test.js`). Re-measure on a real, hand-verified sample before trusting them. Real books will score lower.
- Image-only (scanned) pages: only detected and counted. OCR (tesseract.js, WebAssembly, free) was researched, not built: it needs page rendering, preprocessing and always a human review, and table reconstruction from OCR is unsolved here.
- Raster drawings: figures made only of images are separated by image extent, callouts inside raster art are not detected.
- Rotated pages: handled through PDF user-space crops and `getViewport`; not exercised on a real rotated manual.
- Manual tools: crop boundary edit, category correction, re-assign parts to another figure, merge two figures (same PDF page only) and split a figure are in the review tab (Figure tools). They call three admin-only functions in the pending migration (`oem_reassign_entries`, `oem_figure_merge`, `oem_figure_split`) and are audited; they cannot be exercised against the database until the migration is approved.
- Reprocess: the review tab has a Reprocess preview panel. It re-reads the stored PDF, compares with stored parts and writes nothing; only genuinely new parts can be queued for review. Admin-corrected and work-order-referenced parts are shown as protected.
- Manual deletion is admin-only in the manuals tab. A manual that holds admin-corrected parts is refused by the database (protected rows).
- Per-OEM part-number patterns, unit-of-measure column, revision and document reference capture from the cover page.

## Viewer
- Truck overview thumbnail with the assembly boxed needs authored machine maps. The thumbnail shows the visible part of the current figure.
- Nav list is windowed above 80 figures per group; the parts table is paged (40 rows). Full virtualisation of the parts table for thousands of rows in one figure is not needed by the data seen so far.
- English-only strings remain in the request modal and the import form labels of `OemPartsCatalogPreview.jsx` (import errors are now translated).
- Real OEM manuals are not in the repo or the dev environment, so accuracy and the viewer were only verified on synthetic PDFs. This is a testing blocker for real-manual accuracy.
