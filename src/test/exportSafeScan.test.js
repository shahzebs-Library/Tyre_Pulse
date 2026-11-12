// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import * as XLSX from 'xlsx'
import {
  sanitizeCell, sanitizeCsvText, csvCell, safeRows, safeAoa, safeJsonToSheet, safeAoaToSheet,
} from '../lib/csvSafe.js'
import { sanitizeCell as exportUtilsSanitizeCell } from '../lib/exportUtils.js'
import { escapeCsvValue, buildCsv } from '../lib/tableExport.js'

const TAB = String.fromCharCode(9)
const CR = String.fromCharCode(13)

describe('csvSafe: the one spreadsheet formula guard', () => {
  it('prefixes a string cell that starts with = + - @ TAB or CR', () => {
    for (const lead of ['=', '+', '-', '@', TAB, CR]) {
      expect(sanitizeCell(`${lead}HYPERLINK("http://x","y")`)).toBe(`'${lead}HYPERLINK("http://x","y")`)
    }
  })

  it('leaves real numbers, booleans, dates and blanks untouched', () => {
    expect(sanitizeCell(-45.2)).toBe(-45.2)
    expect(sanitizeCell(0)).toBe(0)
    expect(sanitizeCell(true)).toBe(true)
    expect(sanitizeCell(null)).toBe(null)
    expect(sanitizeCell(undefined)).toBe(undefined)
    expect(sanitizeCell('')).toBe('')
    const d = new Date('2026-01-02T00:00:00Z')
    expect(sanitizeCell(d)).toBe(d)
    expect(sanitizeCell('a=b')).toBe('a=b')
  })

  it('exportUtils re-exports the same function (one implementation)', () => {
    expect(exportUtilsSanitizeCell).toBe(sanitizeCell)
  })

  it('safeRows / safeAoa sanitise strings only and do not mutate the input', () => {
    const rows = [{ remarks: '=1+1', cost: -12.5, note: 'ok' }]
    const out = safeRows(rows)
    expect(out).toEqual([{ remarks: "'=1+1", cost: -12.5, note: 'ok' }])
    expect(rows[0].remarks).toBe('=1+1')
    expect(safeAoa([['@x', -3, 'y']])).toEqual([["'@x", -3, 'y']])
    expect(safeRows(null)).toEqual([])
  })

  it('a Work Orders style row lands in the sheet as text, and a negative number stays a number', () => {
    const ws = safeJsonToSheet(XLSX, [{ 'Work Order': 'WO-1', Remarks: '=HYPERLINK("http://x","y")', Cost: -250 }])
    expect(ws.B2.t).toBe('s')
    expect(ws.B2.v.startsWith("'=")).toBe(true)
    expect(ws.C2.t).toBe('n')
    expect(ws.C2.v).toBe(-250)
    const aoa = safeAoaToSheet(XLSX, [['h'], ['+cmd|x']])
    expect(aoa.A2.v).toBe("'+cmd|x")
  })

  it('CSV text: guards formulas incl. TAB / CR, keeps plain signed numbers', () => {
    expect(sanitizeCsvText('-12.5')).toBe('-12.5')
    expect(sanitizeCsvText('+966501234567')).toBe('+966501234567')
    expect(sanitizeCsvText('-1+1')).toBe("'-1+1")
    expect(sanitizeCsvText('+alert(1)')).toBe("'+alert(1)")
    expect(csvCell(`${TAB}=1+1`)).toBe(`'${TAB}=1+1`)
    expect(csvCell(`${CR}=1+1`)).toBe(`"'${CR}=1+1"`)
    expect(csvCell('=SUM(A1,B1)')).toBe(`"'=SUM(A1,B1)"`)
    expect(csvCell(['a', 'b'])).toBe('a;b')
    expect(csvCell(null)).toBe('')
    expect(csvCell(-42)).toBe('-42')
  })

  it('tableExport uses the shared guard (TAB / CR now covered)', () => {
    expect(escapeCsvValue(`${TAB}@cmd`)).toBe(`'${TAB}@cmd`)
    expect(escapeCsvValue('-12.5')).toBe('-12.5')
    expect(buildCsv(['h'], [['=x']])).toContain("'=x")
  })
})

// ── Source scan ─────────────────────────────────────────────────────────────
// Every Excel / CSV writer must go through csvSafe (directly, or via
// exportUtils / tableExport). A file that calls a SheetJS sheet builder itself,
// or produces a text/csv download without importing the shared helper, fails.

const SRC = join(process.cwd(), 'src')

// Files allowed to call XLSX.utils.*_to_sheet directly. Keep this short.
const SHEET_BUILDER_ALLOW = new Set([
  // The shared helper itself.
  'lib/csvSafe.js',
  // Sanitises with the csvSafe functions before each *_to_sheet call (pinned by exportSanitize.test.js).
  'lib/exportUtils.js',
  // Blank ERP upload templates: headers, one example row and a hint, all code-defined.
  // No user data; prefixing an example would corrupt a template the user re-imports.
  'lib/erpTemplates.js',
  // Blank upload workbook built from the static IMPORT_TARGETS table. No user data.
  'console/pages/ConsoleDuplicateControl.jsx',
])

// Files allowed to mention text/csv without importing the shared helper.
const CSV_ALLOW = new Set([
  // Only downloads text already built by aiTyreExpertLabels.labelledToCsv, which uses csvCell.
  'components/aiInspection/ExpertLabellingPanel.jsx',
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'test' || name === '__tests__' || name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

const FILES = walk(SRC).map((p) => ({ rel: relative(SRC, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }))
const SHEET_BUILDER = /\b(json_to_sheet|aoa_to_sheet|sheet_add_aoa|sheet_add_json|table_to_sheet)\s*\(/
const USES_SHARED = /from\s+['"][^'"]*(csvSafe|tableExport|exportUtils)(\.js)?['"]/

describe('export source scan: no writer bypasses the formula guard', () => {
  it('scans a real tree', () => {
    expect(FILES.length).toBeGreaterThan(400)
  })

  it('no file outside the allowlist calls a SheetJS sheet builder directly', () => {
    const offenders = FILES
      .filter((f) => !SHEET_BUILDER_ALLOW.has(f.rel) && SHEET_BUILDER.test(f.text))
      .map((f) => f.rel)
    expect(offenders, 'use safeJsonToSheet / safeAoaToSheet from src/lib/csvSafe.js').toEqual([])
  })

  it('every file that produces a text/csv download imports the shared helper', () => {
    const offenders = FILES
      .filter((f) => /text\/csv/.test(f.text) && !CSV_ALLOW.has(f.rel) && !USES_SHARED.test(f.text))
      .map((f) => f.rel)
    expect(offenders, 'build CSV cells with csvCell from src/lib/csvSafe.js').toEqual([])
  })

  it('no file hand-rolls a CSV quote-escape instead of csvCell', () => {
    // The tell-tale of a hand-built CSV cell: doubling quotes with replace(/"/g, '""').
    const offenders = FILES
      .filter((f) => f.rel !== 'lib/csvSafe.js' && /replace\(\/"\/g,\s*['"`]""['"`]\)/.test(f.text))
      .map((f) => f.rel)
    expect(offenders, 'use csvCell from src/lib/csvSafe.js').toEqual([])
  })

  it('the allowlists are honest: every entry still exists and still needs the exemption', () => {
    for (const rel of SHEET_BUILDER_ALLOW) {
      const f = FILES.find((x) => x.rel === rel)
      expect(f, `${rel} is allowlisted but missing`).toBeTruthy()
      if (rel !== 'lib/csvSafe.js') expect(SHEET_BUILDER.test(f.text), `${rel} no longer needs the exemption`).toBe(true)
    }
    for (const rel of CSV_ALLOW) {
      const f = FILES.find((x) => x.rel === rel)
      expect(f, `${rel} is allowlisted but missing`).toBeTruthy()
    }
  })
})
