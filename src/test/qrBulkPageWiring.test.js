/**
 * Source-scan guard for the QR page's bulk intake.
 *
 * QrLabels.jsx has no exported seam - the bulk flow lives inside the component -
 * so these read the file and pin the decisions that are invisible in a diff and
 * would each fail silently in the browser.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'pages', 'QrLabels.jsx'), 'utf8')

describe('QR bulk intake wiring', () => {
  it('matches against the whole loaded set, not the filtered view', () => {
    // Against `filtered`, a code would be reported "not found" purely because a
    // site filter was left on - the worst possible answer to give somebody
    // holding the asset in their hand.
    expect(src).toMatch(/matchCodes\(codes,\s*data\b/)
    expect(src).not.toMatch(/matchCodes\(codes,\s*filtered\b/)
  })

  it('clears the filters on every bulk run, not only when something matched', () => {
    // The preview grid and BOTH exports read `filtered`, so a match hidden by a
    // filter would be selected, generated, and then absent from the printed sheet.
    const body = src.slice(src.indexOf('async function runBulk'), src.indexOf('async function handleBulkPaste'))
    const clear = body.indexOf("setSearch(''); setFilterSite('all')")
    const guard = body.indexOf('if (result.ids.length)')
    expect(clear).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(-1)
    expect(clear).toBeLessThan(guard)
  })

  it('generates from the matched rows rather than waiting on selection state', () => {
    // setSelected is not readable in the same tick, so generating off
    // `filtered.filter(selected)` would produce nothing on the first press.
    expect(src).toMatch(/await handleGenerate\(rows\)/)
    expect(src).toMatch(/async function handleGenerate\(items\)/)
  })

  it('does not hand the click event to handleGenerate as a row list', () => {
    expect(src).toMatch(/onClick=\{\(\) => handleGenerate\(\)\}/)
    expect(src).not.toMatch(/onClick=\{handleGenerate\}/)
  })

  it('reads uploaded sheets raw, so a headerless column keeps its first code', () => {
    expect(src).toMatch(/parseWorkbookRaw/)
    expect(src).not.toMatch(/import\(['"]\.\.\/lib\/import\/parseWorkbook['"]\)\s*\n?\s*const \{ parseWorkbook \}/)
  })

  it('destructures the parser result, which is { sheets }, not a bare array', () => {
    // Read as an array it is undefined.flatMap and every upload dies inside the
    // catch as "could not read that file" - correct-looking code, no uploads.
    expect(src).toMatch(/const \{ sheets \} = await parseWorkbookRaw/)
  })

  it('reports the codes it could not find', () => {
    expect(src).toMatch(/bulkResult\.unmatched/)
    expect(src).toMatch(/Not found/)
  })

  it('says when a partial read could be the reason a code was not found', () => {
    // Otherwise "not in the register" reads as a fact when the row simply was
    // never loaded.
    expect(src).toMatch(/truncated &&/)
  })

  it('never auto-selects an ambiguous code', () => {
    // Enforced by the engine (matchCodes puts only single hits in `ids`); this
    // pins that the page selects from `result.ids` and nothing wider.
    expect(src).toMatch(/new Set\(\[\.\.\.prev, \.\.\.result\.ids\]\)/)
    expect(src).not.toMatch(/result\.ambiguous\.flatMap/)
  })
})

describe('QR detail spreadsheet', () => {
  it('carries the vehicle details, not just the code', () => {
    for (const col of ['registration_no', 'chassis_no', 'make', 'model', 'current_km', 'ops_status']) {
      expect(src).toContain(`'${col}'`)
    }
  })

  it('selects those columns from the register, or every cell would be blank', () => {
    // PostgREST returns only what is asked for: an export column with no
    // matching select renders an empty sheet that looks like missing data.
    const select = src.slice(src.indexOf("from('vehicle_fleet')"), src.indexOf("from('vehicle_fleet')") + 700)
    for (const col of ['registration_no', 'chassis_no', 'make', 'model', 'current_km', 'ops_status', 'country']) {
      expect(select).toContain(col)
    }
  })

  it('exports the selected rows so labels and details describe the same set', () => {
    const body = src.slice(src.indexOf('async function exportExcel'), src.indexOf('async function exportExcel') + 400)
    expect(body).toMatch(/filtered\.filter\(r => selected\.has\(r\.id\)\)/)
  })

  it('names the download without underscores or a raw ISO stamp', () => {
    expect(src).toMatch(/reportFileName\('TyrePulse QR/)
    expect(src).not.toMatch(/TyrePulse_QR_/)
  })
})

describe('QR label branding', () => {
  it('loads the company logo once, not per label', () => {
    // Per-export fetch is fine (one run), but the preview must not re-request
    // the logo on every render, and the PDF must not fetch it per label.
    expect(src).toMatch(/getCompanyLogo\(\)\.then/)
    expect(src).toMatch(/useEffect\(\(\) => \{[\s\S]*?getCompanyLogo/)
  })

  it('embeds the logo in the PDF via a data URL, once per run', () => {
    // A signed storage URL cannot be handed to jsPDF, and fetching per label
    // would be N round trips.
    expect(src).toMatch(/const logoData = await fetchLogoDataUrl\(logoUrl\)/)
    const body = src.slice(src.indexOf('async function exportPDF'), src.indexOf('doc.save'))
    // fetch happens before the per-item loop
    expect(body.indexOf('fetchLogoDataUrl')).toBeLessThan(body.indexOf('readyItems.forEach'))
  })

  it('fits the logo without stretching it', () => {
    expect(src).toMatch(/fitLogoBox\(logo\.w, logo\.h/)
  })

  it('falls back to a wordmark when no logo is set, never a blank header', () => {
    // Both surfaces (preview and print) keep a text stand-in.
    expect(src).toMatch(/logoUrl\s*\n?\s*\?\s*<img/)
    expect(src).toContain('TYRE PULSE')
  })

  it('does not print the old TYREPULSE text name when a logo is present', () => {
    // The owner asked for the logo instead of the name. The wordmark that
    // remains is only the fallback branch, spelt "TYRE PULSE".
    expect(src).not.toMatch(/doc\.text\('TYREPULSE'/)
    expect(src).not.toMatch(/>\s*TYREPULSE\s*</)
  })

  it('never lets a bad logo frame cost the sheet', () => {
    // getImageProperties and addImage are both wrapped - a corrupt image must
    // degrade to the wordmark, not throw out of the whole export.
    const body = src.slice(src.indexOf('async function exportPDF'), src.indexOf('doc.save'))
    expect(body).toMatch(/try \{ props = doc\.getImageProperties/)
    expect(body).toMatch(/doc\.addImage\(logo\.data[\s\S]*?catch/)
  })
})
