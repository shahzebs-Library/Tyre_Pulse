# PDF timing and equivalence harness

Measures how long the real report generators take and proves the stored-PDF service does not change the documents.
Synthetic inspections and synthetic photos only. It bundles the real generator, renderer hook, diagram components
and cache service, and replaces only `src/lib/supabase.js` with an in-memory stand-in, so it cannot reach any project.

```
export PDF_HARNESS_OUT=/a/folder/outside/the/repository
node e2e/pdf/make_photos.mjs "$PDF_HARNESS_OUT/photos"     # 14 synthetic 1280 px photos, about 250 KB each
npx vite build --config e2e/pdf/vite.config.mjs            # harness bundle, written to $PDF_HARNESS_OUT/dist
node e2e/pdf/run.mjs                                       # prints and writes $PDF_HARNESS_OUT/results.json
```

It exits non-zero when: the inspection or observation document differs with caching on, two simultaneous requests
produce more than one generation, or a repeat download is not served from the stored copy.

Limits: photos come from the same machine, so Chromium network throttling stands in for a real connection; the
`pdf_cache_*` functions are a stand-in here (the SQL is tested by `supabase/tests/staging/report_pdf_cache_tests.sh`).
Results of the 2026-11-15 run are in `docs/pdf/PDF_ARCHITECTURE_AUDIT.md`, section 2.
