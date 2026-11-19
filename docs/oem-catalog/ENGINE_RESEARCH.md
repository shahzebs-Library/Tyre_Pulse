# OEM parts catalog: engine research and plan

Date: 2026-11-17. Scope: how professional electronic parts catalogs (EPC) are structured, how a parts-book PDF can be turned into clean records automatically, and what that means for Tyre Pulse. Research was done with live web searches; the searches mostly returned vendor, reseller and tutorial pages, not schemas or standards text. Where a claim is not backed by a source it is marked **unverified**.

## 1. What the research found

1. **EPC shape.** An EPC pairs exploded-view illustrations with a parts list; numbered callouts or hot-spots link the two, and the list gives part number and quantity per callout ([drven history of the EPC](https://drven.io/content/blog/history-of-the-electronic-parts-catalogue), [What is an EPC catalog](https://vinsearch.online/guides/what-is-an-epc-catalog/)).
2. **Fitment is a separate layer.** Applicability limits a part to a serial, VIN, build date, market or option set; two otherwise identical lines differ only by that note (same sources). Supersession is a chain from the obsolete number to the current one, with history kept ([autopartscatalogue EPC pages](https://autopartscatalogue.net/mercedes-benz-epc-online/) are marketing-grade; treat as behaviour, not schema). A "where used" reverse lookup is a many-to-many view worth supporting.
3. **S1000D** is the open standard closest to this problem. Information code 941 is "illustrated parts data"; each IPD data module carries a labelled illustration plus its parts list, and each catalog sequence number has its own table ([Twinworks glossary](https://www.twinworks.com/glossary/s1000d.html), [Adobe FrameMaker S1000D pack](https://help.adobe.com/en_US/framemaker/pdfs/Fm-application-pack-for-s1000d.pdf), [Docuneering sample IPD](https://www.docuneering.com/s1000d/demo/html5/DMC-S1000DBIKE-AAA-D00-00-00-01AA-941A-D_007-00_EN-US.htm)). I could not confirm its figure/item numbering rules from these pages (**unverified**; the specification chapter 7 is the authority).
4. **Caterpillar SIS 2.0 / SIS2GO** (desktop and mobile/offline) offers exploded views with part numbers, system > component navigation, and a drawer you can slide to see more drawing or more detail on mobile ([Fabick SIS](https://www.fabickcat.com/online-tools/sis), [SIS 2.0 quick start](https://www.fabickcat.com/wp-content/uploads/SIS-2.0-Customer-Quick-Start-Guide.pdf)). I found nothing usable on Komatsu or Volvo CE interfaces (**not verified**). Breadcrumbs, hotspots and thumbnails are not described by name in what I read; they are standard UI patterns, not sourced facts.
5. **PDF extraction without paid AI.** pdf.js returns positioned text fragments (x, y in a transform), not tables. Standard approach: group fragments into lines by y within a tolerance, cluster x into column anchors, keep empty cells in place ([Gary Sieling](https://www.garysieling.com/blog/extracting-tables-from-pdfs-in-javascript-with-pdf-js/), [pdf-text-position-table-extract](https://github.com/Kein-chronicle/pdf-text-position-table-extract), [pdf.js-extract](https://github.com/ffalt/pdf.js-extract), [pdfplumber](https://github.com/jsvine/pdfplumber)). None of these cover parts-book specifics such as callout-to-row matching; that is our own logic.
6. **OCR.** tesseract.js (WebAssembly, free) does not read PDFs itself and does not improve Tesseract accuracy; render pages with pdf.js to canvas first, preprocess, and expect weaker results on tables, multi-column layouts and low-quality scans ([tesseract.js README mirror](https://www.gitlink.org.cn/mirrors/tesseract.js), [dev.to walkthrough](https://dev.to/helloashish99/ocr-in-the-browser-how-tesseractjs-makes-pdf-text-extraction-free-5ab2)). No benchmark on parts books was found (**unverified accuracy**).
7. **Layout classification.** For documents with consistent, repeated headings, rule-based or hybrid classification is practical and interpretable; deep models (LayoutLM, Detectron2) need labelled data ([LlamaIndex overview](https://www.llamaindex.ai/glossary/document-layout-analysis), [hybrid DLA paper](https://arxiv.org/html/2404.17888v2), [rule-based vs ML on newspapers](https://arxiv.org/html/2202.08125)). Nothing specific to heavy-equipment books was found.

## 2. What exists in the codebase today

`src/lib/oemPartsExtractor.js` reads selectable-text pages (header row INDEX / PART NO / DESCRIPTION / REMARK / QTY / SEE, printed page like `2-14`, caption heading) and links each row to an illustration page. Tables: `oem_parts_manuals`, `oem_parts_entries` (migration `20261117130000`). This work adds the layer above it.

## 3. Engines we can build (and built) in the tool

| Engine | Input | Output | Algorithm | Limits | Cost |
|---|---|---|---|---|---|
| E1 Page reader (existing, extended) | pdf.js text items | rows, printed page, heading, illustration page, **callout numbers per figure** | positional column anchors, nearest-baseline row assignment | text-layer PDFs only; layouts that differ from the SANY column order need new anchors | free |
| E2 Figure classifier (`src/lib/oemCatalog/classifier.js`) | figure heading, chapter, descriptions | group, area (chassis / upper / other), confidence, reason | weighted keyword stems, explicit area words beat system words, **chapter-majority consensus** settles generic headings and flags conflicts | keyword table is tuned for truck mixers; a new machine class needs new stems; generic "Electrical" stays unassigned unless the chapter decides | free |
| E3 Row validator (`validate.js`) | row, optional callout set | issues (error / warn) and score | part-number length and digit count, qty range, description sanity, orphan index, duplicate index | cannot prove a number is a real OEM number; no per-OEM pattern yet | free |
| E4 Dedupe and revision diff (`dedupe.js`) | rows, older rows | clean rows, added / removed / changed, content fingerprint | key = printed page + index + normalised part number | supersession chains not inferred | free |
| E5 Pipeline and review queue (`pipeline.js`) | extraction | publish rows, review rows with reasons, figure map, orphan callouts | confidence = row score blended with figure confidence; publish at >= 0.70 and no error | threshold is a judgement, not calibrated on real books | free |
| E6 Callout hotspot linking (in `OemFigure.jsx`) | rendered page text items | clickable markers | digit-only text items equal to a row index become markers | image-only figures have no text callouts; positions are text-derived and stay "unverified" per the plan | free |

Idempotency: upload is keyed by file SHA-256 (existing) and rows by `(manual, page, row_order)` (existing unique key); the content fingerprint in E4 lets a re-parse be recognised as identical.

## 4. Not possible without paid services or new work (said plainly)

- **Scanned, image-only parts books.** Needs OCR. tesseract.js is a free baseline but untested on these books; expect a mandatory human review step. Table reconstruction from OCR is a separate, harder problem.
- **Callout positions on image-only drawings**, i.e. detecting numbered bubbles inside raster art, needs computer vision or a vision model (paid or self-hosted).
- **Reading serial-range applicability and supersession from prose notes** reliably needs a language model or per-OEM rules.
- **Truck overview thumbnail with the assembly highlighted** (as in the owner's mockup) needs a position map of each assembly on the whole machine. No source in the PDF gives it; the viewer instead shows an overview of the current figure with the visible region boxed. A real machine map needs authored data.
- **Exact fitment** needs the OEM's serial ranges per figure or line; make and model alone is only "model match" and the UI says so.

## 5. Phased plan

1. **Done in this change:** E1 callouts, E2 to E5, review queue stored in `import_summary` (`reviewQueue`, `figures`, `pipeline`), viewer UI, tests on synthetic fixtures.
2. **Next:** reviewer screen to approve or fix queued rows and re-publish; per-OEM part-number patterns; `assembly_area` / `confidence` as real columns (draft in `BACKLOG.md`).
3. **Later, optional and paid:** OCR path for scanned books; model-assisted callout detection; machine overview map authoring.

All of it respects the agent guide: callouts are not part numbers, no PDF popup for ordinary users, text-derived positions are not marked verified, nothing is fabricated.
