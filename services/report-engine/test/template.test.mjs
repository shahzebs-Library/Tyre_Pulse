// Pure template + schema tests — run with `node --test`, no Chromium needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReportHtml, footerTemplate } from '../src/templates/reportTemplate.js'
import { parseReportDefinition } from '../src/reportSchema.js'

const base = {
  title: 'Fleet Master',
  company: 'Readymix',
  columns: [
    { key: 'asset_no', header: 'Asset No' },
    { key: 'cpk', header: 'CPK', align: 'right' },
  ],
  rows: [
    { asset_no: 'RMX-1', cpk: 0.42 },
    { asset_no: 'RMX-2', cpk: 0.38 },
  ],
  kpis: [{ label: 'Avg CPK', value: '0.40' }],
  filtersSummary: { Site: 'Riyadh', 'Sorted by': 'cpk ↓' },
}

test('parseReportDefinition applies defaults', () => {
  const def = parseReportDefinition(base)
  assert.equal(def.locale, 'en')
  assert.equal(def.currency, 'SAR')
  assert.equal(def.exportMode, 'filtered')
  assert.equal(def.orientation, 'landscape')
})

test('parseReportDefinition rejects a definition with no columns', () => {
  assert.throws(() => parseReportDefinition({ ...base, columns: [] }))
})

test('buildReportHtml renders headers, rows, KPIs and filter chips', () => {
  const html = buildReportHtml(parseReportDefinition(base))
  assert.match(html, /Fleet Master/)
  assert.match(html, /RMX-1/)
  assert.match(html, /Avg CPK/)
  assert.match(html, /Site:/)
  assert.match(html, /dir="ltr"/)
})

test('buildReportHtml switches to RTL for Arabic', () => {
  const html = buildReportHtml(parseReportDefinition({ ...base, locale: 'ar' }))
  assert.match(html, /dir="rtl"/)
})

test('buildReportHtml escapes HTML in cell values (no injection)', () => {
  const html = buildReportHtml(
    parseReportDefinition({ ...base, rows: [{ asset_no: '<script>x</script>', cpk: 1 }] }),
  )
  assert.doesNotMatch(html, /<script>x<\/script>/)
  assert.match(html, /&lt;script&gt;/)
})

test('buildReportHtml shows an empty state when there are no rows', () => {
  const html = buildReportHtml(parseReportDefinition({ ...base, rows: [] }))
  assert.match(html, /No records for the selected filters/)
})

test('reportChart rejects a non-image string', () => {
  assert.throws(() => parseReportDefinition({ ...base, charts: [{ image: 'not-an-image' }] }))
})

test('footerTemplate includes page-number placeholders', () => {
  const f = footerTemplate(parseReportDefinition(base))
  assert.match(f, /class="pageNumber"/)
  assert.match(f, /class="totalPages"/)
})
