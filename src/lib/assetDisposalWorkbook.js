/**
 * assetDisposalWorkbook - PURE builder (zero I/O) for the one download that
 * carries everything the Asset Disposal module knows.
 *
 * WHY ONE WORKBOOK. The module answers a single question - should this machine
 * go - out of five separate tables: what the committee proposed, what the fleet
 * register says is still true, how often the machine broke, what a new one
 * costs, and what the board should do about it. Downloading those one at a time
 * loses the connection between them, which is the only reason anyone is reading
 * them together.
 *
 * It reuses the export row builders each surface already has
 * (`disposalExportRows`, `reliabilityExportRows`, `replacementExportRows`)
 * rather than re-deriving the figures. A second derivation would eventually
 * disagree with the screen, and a spreadsheet that disagrees with the screen is
 * worse than no spreadsheet.
 *
 * TWO RULES CARRIED THROUGH FROM THE ENGINES:
 *
 *  - AN EMPTY SHEET IS STILL WRITTEN, with a line saying why it is empty. Drop
 *    it and "nothing to report" becomes indistinguishable from "this section was
 *    never exported", which is how a reader concludes there were no findings.
 *
 *  - THE LIMITS TRAVEL WITH THE NUMBERS. The Contents sheet states what the
 *    time-based figures rest on: that half these job cards carry no usable date,
 *    that parked machines are excluded from breakdown hours, and which prices
 *    were quoted for one machine rather than its class. A figure forwarded
 *    without its basis is the thing this module exists to avoid.
 *
 * ASCII only. Deterministic: `now` is injected.
 */
import { disposalExportRows, DISPOSITIONS } from './assetDisposal'
import { reliabilityExportRows, PARKED_CARD_HOURS } from './assetDisposalReliability'
import { replacementExportRows, replacementTotals } from './assetReplacement'

const txt = (v) => (v == null ? '' : String(v).trim())
const num = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Title Case a snake_case key for a spreadsheet header. */
export function headerFor(key) {
  return String(key)
    .replace(/_pct$/, ' %')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bNo\b/, 'No.')
    .replace(/\bKm\b/, 'km')
    .replace(/\bVat\b/, 'VAT')
    .replace(/\bMtbf\b/, 'MTBF')
}

/**
 * Build a sheet from either a bare array of objects, or the
 * `{head, columns, rows}` envelope the existing export builders return.
 *
 * Taking their `head` rather than deriving one keeps the spreadsheet's column
 * names identical to the on-screen table's, which is the whole point of reusing
 * those builders.
 */
function sheetFrom(name, input, note, emptyNote) {
  const env = input && !Array.isArray(input) && typeof input === 'object' ? input : null
  const rows = (env ? env.rows : input) || []
  const list = Array.isArray(rows) ? rows.filter(Boolean) : []
  const columns = env?.columns?.length
    ? env.columns
    : [...new Set(list.flatMap((r) => Object.keys(r || {})))]
  const headers = env?.head?.length === columns.length ? env.head : columns.map(headerFor)
  return { name, note, emptyNote, rows: list, columns, headers }
}

/** Flatten the register + reliability roll-up totals into label/value rows. */
export function summarySheetRows({ rows = [], totals = null, reliabilityTotals = null, replacement = null, currency = 'SAR' } = {}) {
  const out = []
  const add = (measure, value, basis = '') => out.push({ measure, value, basis })
  const money = (v) => (v == null ? 'Not measured' : `${currency} ${Math.round(v).toLocaleString('en-US')}`)
  const plain = (v, unit = '') => (v == null ? 'Not measured' : `${Math.round(v * 10) / 10}${unit}`)

  add('Machines on the list', rows.length)
  for (const d of Object.values(DISPOSITIONS)) {
    const n = rows.filter((r) => txt(r?.disposition).toLowerCase() === d.key).length
    add(`Proposed ${d.label.toLowerCase()}`, n)
  }
  add('Still Active in the fleet register', rows.filter((r) => txt(r?.fleet_status).toLowerCase() === 'active').length,
    'A machine proposed for disposal that is still Active has not been retired yet.')
  add('Not in the fleet register at all', rows.filter((r) => r?.in_register === false).length,
    'Proposed for disposal but never registered as an asset.')

  if (totals) {
    add('Maintenance spend on the list', money(num(totals.spend)), 'From the job card ledger, whole history.')
    add('Job cards on the list', num(totals.job_cards) ?? 'Not measured')
    add('Tyres still fitted', num(totals.tyres_active) ?? 'Not measured',
      'Tyres recorded as fitted to a machine proposed for disposal.')
  }

  if (reliabilityTotals) {
    const t = reliabilityTotals
    add('Failures recorded', num(t.failures) ?? 'Not measured',
      'A job card carrying breakdown hours above zero, not a card typed Emergency.')
    add('Breakdown hours', plain(num(t.breakdown_hours), ' h'),
      `Excludes cards open longer than ${Math.round(PARKED_CARD_HOURS / 24)} days - those are machines standing still.`)
    add('Parked hours', plain(num(t.parked_hours), ' h'),
      'Hours on long-open cards. A machine standing still, not a repair. Never added to breakdown hours.')
    add('Planned work share', plain(num(t.preventive_share_pct), ' %'),
      'Share of job cards that were planned servicing.')
    add('Job cards with a usable date', plain(num(t.date_coverage_pct), ' %'),
      'Everything measured per year, plus MTBF, idle days and availability, rests on this share.')
  }

  if (replacement) {
    add('Machines with a replacement price', replacement.coveredCount ?? 0,
      'A supplier quotation naming the machine, or its asset class.')
    add('Machines with no replacement price', replacement.uncoveredCount ?? 0,
      replacement.uncoveredTypes?.length ? `No quotation for: ${replacement.uncoveredTypes.join(', ')}` : '')
    const ex = replacement.exposure
    if (ex?.mixedCurrency) {
      add('Replacement exposure', 'Mixed currencies - see the Replacement sheet',
        'Quotations in more than one currency are never added together.')
    } else {
      add('Replacement exposure', money(ex?.total),
        'Covers the priced machines only. It is not the cost of replacing the list.')
    }
  }

  return out
}

/**
 * Every sheet of the module, in reading order, ready for exportSheetsToExcel.
 *
 * @param {object} ctx
 * @param {Array}  ctx.rows            merged register + reliability rows (already filtered as on screen)
 * @param {object} [ctx.totals]        register roll-up
 * @param {object} [ctx.reliabilityTotals]
 * @param {object} [ctx.benchmarks]    shaped replacement benchmarks
 * @param {Array}  [ctx.recommendations] board recommendations
 * @param {object} [ctx.baseline]      fleet comparison
 * @param {string} [ctx.currency]
 */
export function disposalWorkbookSheets({
  rows = [], totals = null, reliabilityTotals = null, benchmarks = null,
  recommendations = [], baseline = null, currency = 'SAR', now = Date.now(),
} = {}) {
  const list = Array.isArray(rows) ? rows : []
  const replacement = benchmarks ? replacementTotals(list, benchmarks, { now }) : null

  const sheets = []

  sheets.push(sheetFrom(
    'Summary',
    summarySheetRows({ rows: list, totals, reliabilityTotals, replacement, currency }),
    'Every headline figure with the basis it rests on.',
    'Nothing on the list for this selection.',
  ))

  sheets.push(sheetFrom(
    'Register',
    disposalExportRows(list, { now }),
    'What the committee proposed, beside what the fleet register and job card ledger still say.',
    'No machines on the disposal list for this selection.',
  ))

  sheets.push(sheetFrom(
    'Reliability',
    reliabilityExportRows(list),
    'Failures, MTBF, breakdown and parked hours, availability and idle days. Time based figures rest on the dated job cards only.',
    'No job card history could be read for these machines.',
  ))

  if (benchmarks) {
    sheets.push(sheetFrom(
      'Replacement',
      replacementExportRows(list, benchmarks, { now }),
      'What a new machine costs, and what has been spent against that price. Priced For says whether the quotation named the machine or its class.',
      'No supplier quotation is on file for any machine on the list.',
    ))

    const quotes = (benchmarks.list || []).map((b) => ({
      asset_no: b.assetNo || '(whole class)',
      asset_type: b.assetTypeLabel || b.assetType,
      label: b.label,
      supplier: b.supplier || '',
      model: b.model || '',
      spec: b.spec || '',
      unit_price_ex_vat: b.cost ?? '',
      vat_pct: b.vatPct ?? '',
      vat_amount: b.vatAmount ?? '',
      total_price: b.totalPrice ?? '',
      currency: b.currency,
      quote_ref: b.quoteRef || '',
      quote_date: b.quoteDate || '',
      valid_until: b.validUntil || '',
      status: b.status === 'current' ? 'Current' : b.status === 'expired' ? 'Lapsed' : 'No validity date',
      warranty: b.warrantyNote || '',
      source_document: b.sourceFile || '',
      notes: b.notes || '',
    }))
    sheets.push(sheetFrom(
      'Quotations',
      quotes,
      'The supplier quotations behind every replacement price. Ex-VAT is the cost basis because VAT is recoverable.',
      'No supplier quotations have been recorded yet.',
    ))
  }

  const recs = (Array.isArray(recommendations) ? recommendations : []).map((r) => ({
    priority: txt(r?.priority) || 'info',
    title: txt(r?.title),
    detail: txt(r?.detail),
    evidence: Array.isArray(r?.evidence) ? r.evidence.filter(Boolean).join(' | ') : txt(r?.evidence),
  }))
  sheets.push(sheetFrom(
    'Recommendations',
    recs,
    'Each point quantifies itself from figures on these sheets. No scrap value, resale price or saving if disposed is claimed anywhere.',
    'Nothing on this list met the threshold for a recommendation.',
  ))

  if (baseline?.onList && baseline?.rest) {
    const side = (label, o) => ({
      group: label,
      assets: num(o?.assets) ?? '',
      spend: num(o?.spend) ?? '',
      spend_per_asset: num(o?.spend_per_asset) ?? '',
      breakdown_hours: num(o?.breakdown_hours) ?? '',
      breakdown_hours_per_asset: num(o?.breakdown_hours_per_asset) ?? '',
      avg_failures_per_year: num(o?.avg_failures_per_year) ?? '',
      preventive_share_pct: num(o?.preventive_share_pct) ?? '',
    })
    sheets.push(sheetFrom(
      'Fleet comparison',
      [side('On the disposal list', baseline.onList), side('Rest of the fleet', baseline.rest)],
      'The list against the machines staying in service. Breakdown hours per asset is the measure idleness cannot flatter; failures per year reads backwards because a parked machine cannot fail.',
      'The fleet baseline could not be read.',
    ))
  }

  return sheets
}

/** The notes printed on the Contents sheet. Facts, not disclaimers. */
export function workbookNotes({ rows = [], benchmarks = null, baseline = null, now = Date.now() } = {}) {
  const notes = []
  const list = Array.isArray(rows) ? rows : []

  const dated = list
    .map((r) => num(r?.reliability?.date_coverage_pct))
    .filter((v) => v != null)
  if (dated.length) {
    const avg = Math.round((dated.reduce((a, b) => a + b, 0) / dated.length) * 10) / 10
    notes.push(`Job cards carrying a usable business date: ${avg}% on average. MTBF, failures per year, idle days and availability rest on that share only.`)
  }
  notes.push(`A job card open longer than ${Math.round(PARKED_CARD_HOURS / 24)} days is treated as a parked machine, not a breakdown. Those hours are reported separately and are never added to breakdown hours.`)
  notes.push('A failure is a job card carrying breakdown hours above zero, not a card typed Emergency - the ERP files most real breakdowns as Repair.')

  if (benchmarks) {
    const t = replacementTotals(list, benchmarks, { now })
    if (t.uncoveredCount) notes.push(t.unpricedNote)
    if (t.expiredCount) notes.push(`${t.expiredCount} replacement ${t.expiredCount === 1 ? 'price rests' : 'prices rest'} on a quotation whose validity has lapsed. It is the last price the supplier put in writing, not today's price.`)
    const perAsset = t.covered.filter((p) => p.basis === 'asset').length
    if (perAsset) notes.push(`${perAsset} ${perAsset === 1 ? 'price was' : 'prices were'} quoted for a named machine rather than its asset class, and applies to that machine only.`)
    notes.push('Replacement prices are ex-VAT, because VAT is recoverable and so is not a cost to the business. The VAT-inclusive total is on the Quotations sheet.')
  } else {
    notes.push('No supplier quotation is on file, so no machine on this list carries a replacement price.')
  }

  if (baseline?.idleConfound) {
    notes.push('Machines on the list record fewer failures a year than the rest of the fleet because many of them are parked, and a machine standing still cannot fail. Breakdown hours per asset is the measure that idleness does not flatter. Neither figure has been adjusted.')
  }
  notes.push('No scrap value, resale price or saving if disposed appears anywhere in this workbook. Nothing in the data supports one.')
  return notes
}
