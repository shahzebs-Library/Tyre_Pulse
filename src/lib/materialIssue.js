/**
 * materialIssue.js - the Material Issue Slip (MIS) engine.
 *
 * WHAT A MIS IS, AND WHY THIS MODULE EXISTS
 * -----------------------------------------
 * A Material Issue Slip is the document the STORE raises when it issues parts
 * against a job card. It is not a new idea in this data - it has been there the
 * whole time and nobody had ever surfaced it:
 *
 *   `parts_consumption.issue_number` IS the slip number, formatted
 *   `<entity>/<doc type>/<sequence>/<MMYY>` e.g. `GC/MIS/0547/1125`.
 *
 * MEASURED ON THE LIVE DATA (2026-08, and the reason this module is real rather
 * than speculative):
 *   - 209,536 expense lines, and EVERY one carries an issue_number.
 *   - 83,580 distinct slips: Egypt 11,701 / KSA 44,015 / UAE 27,864.
 *   - EVERY slip maps to exactly ONE work_order_no - 83,580 of 83,580, zero
 *     exceptions. So a slip to a job card is 1:N and never many-to-many. That
 *     one-to-one link is what makes the store document join the workshop.
 *   - Entity prefixes in use: KSA `GC` and `AFRK`, Egypt `GCEG` and `AFEG`,
 *     UAE `GC`. NOTE `GC` is used by BOTH KSA and UAE, so a slip is identified
 *     by (country, issue_number) and NEVER by the number alone.
 *
 * THE SECOND DOCUMENT TYPE NOBODY HAD SURFACED: MRT
 * ------------------------------------------------
 * The same column also carries `MRT` - a material RETURN, the store taking
 * parts back off a job. KSA 106 lines / 48 slips / SAR 526,760.20 and UAE 73
 * lines / 39 slips / AED 47,175.94.
 *
 * EVERY MRT LINE IS BOOKED POSITIVE. A return therefore currently ADDS cost to a
 * job card instead of crediting it. That is a real integrity finding and this
 * engine REPORTS it; it does not quietly rewrite it. Both figures are published
 * side by side and named for what they are:
 *
 *   bookedValue   - what the ledger actually holds. This is the primary figure,
 *                   because it is what every other cost surface in the app is
 *                   already reporting. Changing it here alone would make this
 *                   page disagree with Expenses and CPK.
 *   creditedValue - what the same slips would total if a return credited. Shown
 *                   as an explicit alternative, never as "the" number.
 *
 * Re-signing 179 historical lines is an owner decision about money, not a
 * display fix, so nothing in this module mutates or assumes it.
 *
 * MONEY IS NEVER BLENDED
 * ----------------------
 * KSA reports in SAR, UAE in AED, Egypt in EGP. Adding them is not a quantity of
 * anything, and this repo has already fixed exactly that defect at four separate
 * reader sites. So this engine returns money in a map KEYED BY CURRENCY and
 * exposes no cross-country scalar total at all - the same by-construction guard
 * `governedCost` uses. The country -> currency decision is imported from
 * `governedCost`, never restated here.
 *
 * PURITY
 * ------
 * No I/O, no Supabase, no `Date.now()`. Every function that needs the clock takes
 * `now` explicitly, so every result is reproducible in a test.
 *
 * @module materialIssue
 */
import { currencyForCountry, MIXED_CURRENCY } from './governedCost'
import { costBucketFor } from './materialMaster'

/* ------------------------------------------------------------------ *
 * Small shared helpers                                                *
 * ------------------------------------------------------------------ */

/** Finite number or 0. Never NaN, so a bad cell can never poison a total. */
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Trimmed string, or '' - never null/undefined leaking into a key or a label. */
const str = (v) => String(v ?? '').trim()

/** A finite number, or null when the value is genuinely absent. */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 'YYYY-MM-DD' from a date-ish value, or '' when it cannot be read. */
function isoDay(v) {
  const s = str(v)
  if (!s) return ''
  // Already an ISO day or timestamp: take the day part without constructing a
  // Date, which would shift the day across a timezone offset.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  if (m) return m[1]
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 'YYYY-MM' from a date-ish value, or '' when it cannot be read. */
function isoMonth(v) {
  const day = isoDay(v)
  return day ? day.slice(0, 7) : ''
}

/** Whole days between two ISO days, or null when either is unreadable. */
function daysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const a = Date.parse(`${fromIso}T00:00:00Z`)
  const b = Date.parse(`${toIso}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

/* ------------------------------------------------------------------ *
 * Document types                                                      *
 * ------------------------------------------------------------------ */

/**
 * The two store document types that live in `issue_number`.
 *
 * `credits` is the ACCOUNTING intent, not what the stored rows currently do -
 * see the module note. A return should credit the job; today every MRT line is
 * booked positive, and that gap is reported rather than applied.
 */
export const DOC_TYPES = Object.freeze([
  Object.freeze({ key: 'MIS', label: 'Material issue', short: 'Issue', credits: false }),
  Object.freeze({ key: 'MRT', label: 'Material return', short: 'Return', credits: true }),
])

/** Just the keys, for validation and filter lists. */
export const DOC_TYPE_KEYS = Object.freeze(DOC_TYPES.map((d) => d.key))

const DOC_TYPE_BY_KEY = Object.freeze(Object.fromEntries(DOC_TYPES.map((d) => [d.key, d])))

/**
 * The display label for a document type. An unrecognised type renders as
 * "Unknown document" rather than being folded into MIS - a slip whose number we
 * cannot read is a fact about our parsing, not evidence that it is an issue.
 * @param {string} key
 * @returns {string}
 */
export function docTypeLabel(key) {
  const k = str(key).toUpperCase()
  return DOC_TYPE_BY_KEY[k]?.label || 'Unknown document'
}

/**
 * True when a document type is a RETURN (MRT). Unknown types are not returns:
 * treating an unreadable number as a credit would be inventing money movement.
 * @param {string} docType
 * @returns {boolean}
 */
export function isReturn(docType) {
  return str(docType).toUpperCase() === 'MRT'
}

/* ------------------------------------------------------------------ *
 * The slip number                                                     *
 * ------------------------------------------------------------------ */

// `<entity>/<MIS|MRT>/<sequence>/<MMYY>`. The sequence is 4 digits in every
// observed value; the range is kept a little wider so a store that rolls past
// 9999 still parses instead of silently becoming unreadable.
const ISSUE_RE = /^([A-Z0-9]{1,10})\/(MIS|MRT)\/(\d{1,6})\/(\d{4})$/

/**
 * Read a slip number into its parts.
 *
 * RETURNS NULL RATHER THAN GUESSING. A number we cannot read is reported as
 * unparseable and counted; it is never coerced into a document type, a period or
 * a sequence. Inventing a type here would put a return in the issue register.
 *
 * The trailing block is MMYY, not YYMM: `1125` is November 2025 (a leading `25`
 * would be month 25, which does not exist, and the month check below is what
 * enforces that reading). The two-digit year is expanded as 2000+YY - correct
 * for a data set spanning 2018 to 2026 and stated here as the assumption it is.
 *
 * @param {string} value e.g. 'GC/MIS/0547/1125'
 * @returns {{entity:string, docType:string, seq:number, seqText:string,
 *            mmyy:string, docMonth:string, raw:string}|null}
 */
export function parseIssueNumber(value) {
  const raw = str(value).toUpperCase().replace(/\s+/g, '')
  if (!raw) return null
  const m = ISSUE_RE.exec(raw)
  if (!m) return null
  const [, entity, docType, seqText, mmyy] = m
  const mm = Number(mmyy.slice(0, 2))
  const yy = Number(mmyy.slice(2))
  // A month outside 1..12 means this is not the MMYY shape we think it is, so
  // the whole number is unreadable rather than partly trusted.
  if (!(mm >= 1 && mm <= 12)) return null
  const year = 2000 + yy
  return Object.freeze({
    entity,
    docType,
    seq: Number(seqText),
    seqText,
    mmyy,
    docMonth: `${year}-${String(mm).padStart(2, '0')}`,
    raw,
  })
}

/**
 * The document type carried by a slip number, or null when it cannot be read.
 * @param {string} issueNumber
 * @returns {string|null}
 */
export function docTypeOf(issueNumber) {
  return parseIssueNumber(issueNumber)?.docType ?? null
}

/* ------------------------------------------------------------------ *
 * Line values and the return sign                                     *
 * ------------------------------------------------------------------ */

/**
 * The amount a line carries AS THE LEDGER HOLDS IT.
 *
 * `line_cost` is the authoritative amount stamped by the classify trigger; the
 * fallbacks cover an in-app line that has not been through it yet.
 *
 * @param {object|number} line
 * @returns {number}
 */
export function bookedValue(line) {
  if (typeof line === 'number') return num(line)
  const v = line?.line_cost ?? line?.value_amount ?? line?.value ?? line?.amount
  return num(v)
}

/**
 * THE ONE PLACE THE RETURN SIGN IS DECIDED. A MRT credits, so its accounting
 * amount is negative regardless of how the row is stored.
 *
 * This is deliberately idempotent (`-Math.abs`), so applying it to a line that
 * is already negative cannot flip it back to a charge.
 *
 * IMPORTANT: this is the ACCOUNTING sign, not the stored one. Nothing in this
 * module writes it back, and the register leads with `bookedValue` so this page
 * agrees with Expenses and CPK. Use this only where a credited view is what the
 * reader asked for, and label it as such.
 *
 * @param {object|number} line
 * @param {string} docType
 * @returns {number}
 */
export function signedValue(line, docType) {
  const booked = bookedValue(line)
  return isReturn(docType) ? -Math.abs(booked) : booked
}

/**
 * True when a slip is a RETURN whose booked value is a positive charge - the
 * live integrity finding this module exists to surface. Reported, never fixed
 * here.
 * @param {{docType?:string, bookedValue?:number}} slip
 * @returns {boolean}
 */
export function returnBookedPositive(slip) {
  return isReturn(slip?.docType) && num(slip?.bookedValue) > 0
}

/* ------------------------------------------------------------------ *
 * Folding expense lines into slips                                    *
 * ------------------------------------------------------------------ */

/**
 * The identity of a slip: COUNTRY plus the number.
 *
 * Never the number alone. `GC/MIS/...` is issued by both KSA and UAE, so keying
 * on the number would merge two different countries' documents - the same
 * cross-boundary merge the expense identity and the material master were both
 * hardened against.
 */
function slipKey(country, issueNumber) {
  return `${str(country).toUpperCase()}\u0000${str(issueNumber).toUpperCase()}`
}

/**
 * Fold flat `parts_consumption` lines into the store's document register.
 *
 * This is what turns a 209,536-row expense table into 83,580 slips a storekeeper
 * would recognise. Lines with NO issue_number are skipped (they are not part of
 * any slip) - `countUnslipped` reports how many, so a gap is stated rather than
 * silently dropped.
 *
 * Every slip carries its own lines so the register can expand without a second
 * query, and defensive counters (`workOrderCount`, `mixedCurrency`) so a row
 * that contradicts the measured 1:1 job-card rule is VISIBLE instead of being
 * quietly folded away.
 *
 * @param {Array<object>} rows parts_consumption rows
 * @returns {Array<object>} slips, newest document date first
 */
export function groupLinesIntoSlips(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()

  for (const r of list) {
    const issueNumber = str(r?.issue_number)
    if (!issueNumber) continue
    const country = str(r?.country)
    const key = slipKey(country, issueNumber)

    let slip = map.get(key)
    if (!slip) {
      const parsed = parseIssueNumber(issueNumber)
      slip = {
        key,
        issueNumber,
        country,
        currency: str(r?.currency) || currencyForCountry(country) || null,
        docType: parsed?.docType ?? null,
        docTypeKnown: Boolean(parsed),
        entity: parsed?.entity ?? null,
        seq: parsed?.seq ?? null,
        docMonth: parsed?.docMonth ?? '',
        workOrderNo: str(r?.work_order_no) || '',
        assetCode: str(r?.asset_code) || '',
        assetDescription: str(r?.asset_description) || '',
        site: str(r?.site) || '',
        storeCode: str(r?.store_code) || '',
        costCenter: str(r?.cost_center) || '',
        date: '',
        month: '',
        lineCount: 0,
        qty: 0,
        bookedValue: 0,
        tyreValue: 0,
        spareValue: 0,
        oilValue: 0,
        mixedCurrency: false,
        workOrderCount: 0,
        _workOrders: new Set(),
        _currencies: new Set(),
        lines: [],
      }
      map.set(key, slip)
    }

    const day = isoDay(r?.event_date) || isoDay(r?.txn_date)
    // The document date is the EARLIEST line date: a slip is one document raised
    // on one day, and a later-dated line is a correction, not a new document.
    if (day && (!slip.date || day < slip.date)) {
      slip.date = day
      slip.month = day.slice(0, 7)
    }
    if (!slip.workOrderNo && str(r?.work_order_no)) slip.workOrderNo = str(r.work_order_no)
    if (!slip.assetCode && str(r?.asset_code)) slip.assetCode = str(r.asset_code)
    if (!slip.assetDescription && str(r?.asset_description)) slip.assetDescription = str(r.asset_description)
    if (!slip.site && str(r?.site)) slip.site = str(r.site)
    if (!slip.storeCode && str(r?.store_code)) slip.storeCode = str(r.store_code)
    if (!slip.costCenter && str(r?.cost_center)) slip.costCenter = str(r.cost_center)
    if (str(r?.work_order_no)) slip._workOrders.add(str(r.work_order_no))
    if (str(r?.currency)) slip._currencies.add(str(r.currency))

    slip.lineCount += 1
    slip.qty += num(r?.qty)
    slip.bookedValue += bookedValue(r)
    slip.tyreValue += num(r?.tyre_cost)
    slip.spareValue += num(r?.spare_cost)
    slip.oilValue += num(r?.oil_cost)
    slip.lines.push(r)
  }

  const out = []
  for (const slip of map.values()) {
    slip.workOrderCount = slip._workOrders.size
    slip.mixedCurrency = slip._currencies.size > 1
    if (slip._currencies.size === 1) slip.currency = [...slip._currencies][0]
    else if (slip._currencies.size > 1) slip.currency = MIXED_CURRENCY
    // The accounting view of the same slip, decided in exactly one place.
    slip.creditedValue = isReturn(slip.docType) ? -Math.abs(slip.bookedValue) : slip.bookedValue
    slip.returnSignAnomaly = returnBookedPositive(slip)
    slip.linkedToJobCard = Boolean(slip.workOrderNo)
    delete slip._workOrders
    delete slip._currencies
    out.push(slip)
  }

  // Newest document first, then by slip number so the order is stable when two
  // slips share a date (a plain date sort would shuffle between renders).
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.issueNumber < b.issueNumber ? 1 : -1
  })
  return out
}

/**
 * How many lines carried NO slip number. Measured live as zero, so a non-zero
 * result here is new information worth showing rather than a rounding detail.
 * @param {Array<object>} rows
 * @returns {number}
 */
export function countUnslipped(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let n = 0
  for (const r of list) if (!str(r?.issue_number)) n += 1
  return n
}

/* ------------------------------------------------------------------ *
 * Bucketing - reuses the server's own split, never a second one       *
 * ------------------------------------------------------------------ */

/**
 * Tyre / spare / oil totals for a set of lines.
 *
 * NO SECOND BUCKETING IS INVENTED. A `parts_consumption` line already carries
 * `tyre_cost` / `spare_cost` / `oil_cost`, stamped by the classify trigger, and
 * `governedCost` names those columns as the authoritative split - so they are
 * summed directly. A line raised IN APP has no split columns yet, only the
 * material-master `category`, so it goes through `costBucketFor` - the existing
 * mapper the master and the SQL `material_category_bucket` already share.
 *
 * @param {Array<object>} lines
 * @returns {{tyre:number, spare:number, oil:number}}
 */
export function bucketTotals(lines = []) {
  const list = Array.isArray(lines) ? lines : []
  const out = { tyre: 0, spare: 0, oil: 0 }
  for (const l of list) {
    const hasSplit = l?.tyre_cost != null || l?.spare_cost != null || l?.oil_cost != null
    if (hasSplit) {
      out.tyre += num(l.tyre_cost)
      out.spare += num(l.spare_cost)
      out.oil += num(l.oil_cost)
    } else {
      out[costBucketFor(l?.category)] += bookedValue(l)
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Summary                                                             *
 * ------------------------------------------------------------------ */

/** Top-N rollup of slips by a key, ranked on booked value then count. */
function topBy(slips, keyOf, limit = 8) {
  const map = new Map()
  for (const s of slips) {
    const k = str(keyOf(s))
    if (!k) continue
    const row = map.get(k) || { key: k, slips: 0, lines: 0, value: 0 }
    row.slips += 1
    row.lines += num(s.lineCount)
    row.value += num(s.bookedValue)
    map.set(k, row)
  }
  return [...map.values()]
    .sort((a, b) => (b.value - a.value) || (b.slips - a.slips))
    .slice(0, Math.max(0, limit))
}

/** Top-N items across a set of slips, from their own lines. */
function topItems(slips, limit = 8) {
  const map = new Map()
  for (const s of slips) {
    for (const l of s.lines || []) {
      const code = str(l?.item_code) || str(l?.item_description)
      if (!code) continue
      const row = map.get(code) || {
        key: code,
        description: str(l?.item_description),
        lines: 0,
        qty: 0,
        value: 0,
      }
      row.lines += 1
      row.qty += num(l?.qty)
      row.value += bookedValue(l)
      if (!row.description && str(l?.item_description)) row.description = str(l.item_description)
      map.set(code, row)
    }
  }
  return [...map.values()]
    .sort((a, b) => (b.value - a.value) || (b.lines - a.lines))
    .slice(0, Math.max(0, limit))
}

/**
 * Summarise a set of slips.
 *
 * MONEY IS RETURNED PER COUNTRY AND PER CURRENCY, and there is deliberately NO
 * cross-country scalar total on the result - not "we chose not to show one", but
 * no such field exists, so a template cannot render a blend by accident.
 *
 * Every figure that could be unmeasurable returns null rather than 0:
 * `avgLinesPerSlip` with no slips, `linkageRate` with no slips, and
 * `daysSinceLastSlip` when no slip carries a readable date. Zero would read as a
 * real measurement of "none", which is a different claim from "we cannot tell".
 *
 * @param {Array<object>} slips from `groupLinesIntoSlips`
 * @param {{now?: Date|string}} [opts] `now` is explicit so results are reproducible
 */
export function summarizeIssues(slips = [], { now } = {}) {
  const list = Array.isArray(slips) ? slips : []
  const nowIso = isoDay(now) || ''

  const byCountryMap = new Map()
  const byCurrencyMap = new Map()
  const docTypeSplit = { MIS: 0, MRT: 0, unknown: 0 }

  let lines = 0
  let qty = 0
  let unparseable = 0
  let returnSignAnomalies = 0
  let linkedSlips = 0
  let mixedCurrencySlips = 0
  let latestDate = ''

  for (const s of list) {
    lines += num(s.lineCount)
    qty += num(s.qty)
    if (!s.docTypeKnown) unparseable += 1
    if (s.returnSignAnomaly) returnSignAnomalies += 1
    if (s.linkedToJobCard) linkedSlips += 1
    if (s.mixedCurrency) mixedCurrencySlips += 1
    if (s.date && s.date > latestDate) latestDate = s.date

    const dt = s.docTypeKnown ? s.docType : 'unknown'
    docTypeSplit[dt] = (docTypeSplit[dt] || 0) + 1

    const country = str(s.country) || 'Unknown'
    let c = byCountryMap.get(country)
    if (!c) {
      c = {
        country,
        currency: s.currency && s.currency !== MIXED_CURRENCY
          ? s.currency
          : currencyForCountry(country),
        slips: 0,
        lines: 0,
        qty: 0,
        bookedValue: 0,
        creditedValue: 0,
        mis: { slips: 0, lines: 0, value: 0 },
        mrt: { slips: 0, lines: 0, value: 0 },
        unknownDoc: { slips: 0, lines: 0, value: 0 },
        linkedSlips: 0,
        returnSignAnomalies: 0,
        _slips: [],
      }
      byCountryMap.set(country, c)
    }
    c.slips += 1
    c.lines += num(s.lineCount)
    c.qty += num(s.qty)
    c.bookedValue += num(s.bookedValue)
    c.creditedValue += num(s.creditedValue)
    if (s.linkedToJobCard) c.linkedSlips += 1
    if (s.returnSignAnomaly) c.returnSignAnomalies += 1
    const bucket = s.docTypeKnown ? (isReturn(s.docType) ? c.mrt : c.mis) : c.unknownDoc
    bucket.slips += 1
    bucket.lines += num(s.lineCount)
    bucket.value += num(s.bookedValue)
    c._slips.push(s)

    // Currency rollup: keyed by the slip's OWN currency, so nothing is added
    // across currencies. A slip whose lines disagree is excluded from the money
    // map entirely and counted as mixed instead of being assigned a currency.
    const cur = s.currency
    if (cur && cur !== MIXED_CURRENCY) {
      const cc = byCurrencyMap.get(cur) || {
        currency: cur, slips: 0, lines: 0, bookedValue: 0, creditedValue: 0,
      }
      cc.slips += 1
      cc.lines += num(s.lineCount)
      cc.bookedValue += num(s.bookedValue)
      cc.creditedValue += num(s.creditedValue)
      byCurrencyMap.set(cur, cc)
    }
  }

  const byCountry = [...byCountryMap.values()].map((c) => {
    const own = c._slips
    delete c._slips
    return {
      ...c,
      avgLinesPerSlip: c.slips ? c.lines / c.slips : null,
      linkageRate: c.slips ? c.linkedSlips / c.slips : null,
      topStores: topBy(own, (s) => s.storeCode),
      topSites: topBy(own, (s) => s.site),
      topItems: topItems(own),
      buckets: bucketTotals(own.flatMap((s) => s.lines || [])),
    }
  }).sort((a, b) => (b.slips - a.slips) || a.country.localeCompare(b.country))

  const byCurrency = Object.fromEntries([...byCurrencyMap.entries()])

  return {
    generatedAt: nowIso || null,
    slips: list.length,
    lines,
    qty,
    docTypeSplit,
    unparseable,
    returnSignAnomalies,
    mixedCurrencySlips,
    linkedSlips,
    linkageRate: list.length ? linkedSlips / list.length : null,
    avgLinesPerSlip: list.length ? lines / list.length : null,
    latestDate: latestDate || null,
    daysSinceLastSlip: nowIso && latestDate ? daysBetween(latestDate, nowIso) : null,
    byCountry,
    byCurrency,
    // True when the scope spans more than one currency, so a reader is told the
    // money must be read per country rather than shown one wrong total.
    mixedCurrency: Object.keys(byCurrency).length > 1,
  }
}

/* ------------------------------------------------------------------ *
 * Filtering                                                           *
 * ------------------------------------------------------------------ */

/**
 * Filter slips for the register. Every filter is optional; 'All' and blank both
 * mean "no filter" so a select and an empty input behave identically.
 *
 * @param {Array<object>} slips
 * @param {{country?:string, site?:string, store?:string, docType?:string,
 *          from?:string, to?:string, search?:string, anomaliesOnly?:boolean}} [f]
 */
export function filterSlips(slips = [], f = {}) {
  const list = Array.isArray(slips) ? slips : []
  const country = str(f.country)
  const site = str(f.site)
  const store = str(f.store)
  const docType = str(f.docType).toUpperCase()
  const from = isoDay(f.from)
  const to = isoDay(f.to)
  const q = str(f.search).toLowerCase()
  const anomaliesOnly = Boolean(f.anomaliesOnly)
  // Case-insensitive on purpose: `docType` is upper-cased above so it can be
  // compared to a document key, which would otherwise make the literal 'All'
  // sentinel arrive here as 'ALL' and filter everything out. A select set to
  // "All" must mean no filter whatever case it carries.
  const all = (v) => !v || String(v).toLowerCase() === 'all'

  return list.filter((s) => {
    if (!all(country) && str(s.country) !== country) return false
    if (!all(site) && str(s.site) !== site) return false
    if (!all(store) && str(s.storeCode) !== store) return false
    if (!all(docType)) {
      const own = s.docTypeKnown ? str(s.docType).toUpperCase() : 'UNKNOWN'
      if (own !== docType) return false
    }
    // A slip with no readable date cannot be proved inside a window, so a window
    // filter excludes it rather than quietly keeping it.
    if (from && (!s.date || s.date < from)) return false
    if (to && (!s.date || s.date > to)) return false
    if (anomaliesOnly && !s.returnSignAnomaly) return false
    if (q) {
      const hay = [
        s.issueNumber, s.workOrderNo, s.assetCode, s.assetDescription,
        s.site, s.storeCode, s.costCenter,
      ].map((v) => str(v).toLowerCase()).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * The distinct values a filter can offer, derived from the slips ON SCREEN.
 *
 * Derived rather than queried on purpose: offering a store that has no slip in
 * the loaded window is a choice that returns nothing, and a second read of a
 * 209,536-row table to populate a dropdown is not worth it.
 *
 * @param {Array<object>} slips
 */
export function slipFilterOptions(slips = []) {
  const list = Array.isArray(slips) ? slips : []
  const sites = new Set()
  const stores = new Set()
  const countries = new Set()
  for (const s of list) {
    if (str(s.site)) sites.add(str(s.site))
    if (str(s.storeCode)) stores.add(str(s.storeCode))
    if (str(s.country)) countries.add(str(s.country))
  }
  const sort = (set) => [...set].sort((a, b) => a.localeCompare(b))
  return { sites: sort(sites), stores: sort(stores), countries: sort(countries) }
}

/* ------------------------------------------------------------------ *
 * Trends                                                              *
 * ------------------------------------------------------------------ */

/**
 * Monthly issue trend.
 *
 * A month whose slips span more than one currency reports `value: null` and
 * `currency: MIXED`, never a blended number. That is the honest rendering: the
 * count of slips is still a real quantity, the money is not.
 *
 * @param {Array<object>} slips
 * @returns {Array<{month:string, slips:number, lines:number, value:number|null,
 *                  currency:string|null, mis:number, mrt:number}>}
 */
export function monthlyIssueTrend(slips = []) {
  const list = Array.isArray(slips) ? slips : []
  const map = new Map()
  for (const s of list) {
    const month = str(s.month) || str(s.docMonth)
    if (!month) continue
    const row = map.get(month) || {
      month, slips: 0, lines: 0, value: 0, mis: 0, mrt: 0, _currencies: new Set(),
    }
    row.slips += 1
    row.lines += num(s.lineCount)
    row.value += num(s.bookedValue)
    if (s.docTypeKnown && isReturn(s.docType)) row.mrt += 1
    else if (s.docTypeKnown) row.mis += 1
    if (s.currency) row._currencies.add(s.currency)
    map.set(month, row)
  }
  return [...map.values()]
    .map((r) => {
      const currencies = [...r._currencies].filter((c) => c && c !== MIXED_CURRENCY)
      delete r._currencies
      const single = currencies.length === 1 ? currencies[0] : null
      return {
        ...r,
        value: single ? r.value : null,
        currency: single || (currencies.length > 1 ? MIXED_CURRENCY : null),
      }
    })
    .sort((a, b) => a.month.localeCompare(b.month))
}

/* ------------------------------------------------------------------ *
 * Export projections                                                  *
 * ------------------------------------------------------------------ */

/**
 * The slip export column list. The keys and the headers are declared TOGETHER,
 * and `slipExportRows` builds exactly these keys, so an export column can never
 * point at a field nobody populates - the failure mode that renders a blank
 * sheet and reads as missing data.
 */
export const SLIP_EXPORT_COLUMNS = Object.freeze([
  { key: 'issue_number', header: 'Slip No' },
  { key: 'doc_type', header: 'Document' },
  { key: 'date', header: 'Date' },
  { key: 'country', header: 'Country' },
  { key: 'site', header: 'Site' },
  { key: 'store_code', header: 'Store' },
  { key: 'work_order_no', header: 'Job Card' },
  { key: 'asset_code', header: 'Asset' },
  { key: 'lines', header: 'Lines' },
  { key: 'qty', header: 'Qty' },
  { key: 'booked_value', header: 'Value (as booked)' },
  { key: 'credited_value', header: 'Value (return credited)' },
  { key: 'currency', header: 'Currency' },
  { key: 'flag', header: 'Flag' },
])

/** Blank renders as "N/A" - never an em dash, never an empty cell. */
const cell = (v) => {
  const s = str(v)
  return s === '' ? 'N/A' : s
}
const numCell = (v) => {
  const n = numOrNull(v)
  return n == null ? 'N/A' : Math.round(n * 100) / 100
}

/**
 * Flat export rows for the slip register.
 * @param {Array<object>} slips
 */
export function slipExportRows(slips = []) {
  const list = Array.isArray(slips) ? slips : []
  return list.map((s) => ({
    issue_number: cell(s.issueNumber),
    doc_type: s.docTypeKnown ? docTypeLabel(s.docType) : 'Unknown document',
    date: cell(s.date),
    country: cell(s.country),
    site: cell(s.site),
    store_code: cell(s.storeCode),
    work_order_no: cell(s.workOrderNo),
    asset_code: cell(s.assetCode),
    lines: numCell(s.lineCount),
    qty: numCell(s.qty),
    booked_value: numCell(s.bookedValue),
    credited_value: numCell(s.creditedValue),
    currency: cell(s.currency),
    flag: s.returnSignAnomaly
      ? 'Return booked as a charge'
      : (s.mixedCurrency ? 'Mixed currency' : (s.linkedToJobCard ? '' : 'No job card')),
  }))
}

/** The line export column list, paired with `lineExportRows` for the same reason. */
export const LINE_EXPORT_COLUMNS = Object.freeze([
  { key: 'issue_number', header: 'Slip No' },
  { key: 'date', header: 'Date' },
  { key: 'work_order_no', header: 'Job Card' },
  { key: 'item_code', header: 'Item Code' },
  { key: 'item_description', header: 'Description' },
  { key: 'qty', header: 'Qty' },
  { key: 'unit_cost', header: 'Unit Cost' },
  { key: 'line_cost', header: 'Value' },
  { key: 'currency', header: 'Currency' },
  { key: 'site', header: 'Site' },
  { key: 'store_code', header: 'Store' },
])

/**
 * Flat export rows for the lines behind one or more slips.
 * @param {Array<object>} lines raw parts_consumption rows
 */
export function lineExportRows(lines = []) {
  const list = Array.isArray(lines) ? lines : []
  return list.map((l) => ({
    issue_number: cell(l?.issue_number),
    date: cell(isoDay(l?.event_date) || isoDay(l?.txn_date)),
    work_order_no: cell(l?.work_order_no),
    item_code: cell(l?.item_code),
    item_description: cell(l?.item_description),
    qty: numCell(l?.qty),
    unit_cost: numCell(l?.unit_cost),
    line_cost: numCell(l?.line_cost),
    currency: cell(l?.currency),
    site: cell(l?.site),
    store_code: cell(l?.store_code),
  }))
}

/* ------------------------------------------------------------------ *
 * Raising a slip in app                                               *
 * ------------------------------------------------------------------ */

/** Statuses a slip raised in app can hold. Mirrors the material_issues CHECK. */
export const ISSUE_STATUSES = Object.freeze(['draft', 'issued', 'cancelled'])

/** Display label for a slip status. */
export function issueStatusLabel(status) {
  const s = str(status).toLowerCase()
  if (s === 'draft') return 'Draft'
  if (s === 'issued') return 'Issued'
  if (s === 'cancelled') return 'Cancelled'
  return 'Unknown'
}

/**
 * The value of one draft line: qty x unit cost, or null when either is missing.
 *
 * NULL, NOT ZERO. A line whose price nobody has entered is unpriced; showing it
 * as 0.00 asserts it was free.
 *
 * @param {{qty?:*, unit_cost?:*}} line
 * @returns {number|null}
 */
export function draftLineValue(line = {}) {
  const qty = numOrNull(line.qty)
  const unit = numOrNull(line.unit_cost)
  if (qty == null || unit == null) return null
  return Math.round(qty * unit * 100) / 100
}

/**
 * Validate a draft slip before it is saved.
 *
 * Returns every problem at once rather than the first, so a storekeeper fixes
 * the form in one pass instead of discovering faults one save at a time.
 *
 * @param {{country?:string, work_order_no?:string, doc_type?:string}} header
 * @param {Array<object>} lines
 * @returns {{ok:boolean, errors:string[], total:number|null, unpricedLines:number}}
 */
export function validateDraftIssue(header = {}, lines = []) {
  const list = (Array.isArray(lines) ? lines : []).filter(
    (l) => str(l?.item_code) || str(l?.item_description),
  )
  const errors = []
  if (!str(header.country)) errors.push('Pick a country. Item codes are not unique across countries, so a slip must name one.')
  if (!str(header.work_order_no)) errors.push('Pick the job card this slip is issued against.')
  const docType = str(header.doc_type).toUpperCase() || 'MIS'
  if (!DOC_TYPE_KEYS.includes(docType)) errors.push('Pick a document type.')
  if (list.length === 0) errors.push('Add at least one item.')

  let total = 0
  let priced = 0
  let unpricedLines = 0
  list.forEach((l, i) => {
    // These mirror the database CHECKs (qty > 0, unit_cost >= 0). Catching them
    // here is what turns a raw constraint violation into a sentence a
    // storekeeper can act on. A return records a POSITIVE quantity too: the
    // direction of the movement is the document type's job, not the quantity's.
    const qty = numOrNull(l.qty)
    if (qty == null || qty <= 0) errors.push(`Line ${i + 1}: enter a quantity greater than zero.`)
    const unit = numOrNull(l.unit_cost)
    if (unit != null && unit < 0) {
      errors.push(`Line ${i + 1}: a unit cost cannot be negative. Use the return document type to credit a job.`)
    }
    const v = draftLineValue(l)
    if (v == null) unpricedLines += 1
    else { total += v; priced += 1 }
  })

  return {
    ok: errors.length === 0,
    errors,
    // An unpriced slip has no total, and saying so beats printing a total that
    // silently omits the lines nobody has costed.
    total: priced > 0 && unpricedLines === 0 ? Math.round(total * 100) / 100 : null,
    pricedTotal: priced > 0 ? Math.round(total * 100) / 100 : null,
    unpricedLines,
    lineCount: list.length,
  }
}
