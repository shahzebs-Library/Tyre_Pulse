/**
 * parseInsurancePolicy - pure parser that extracts an insurance policy SCHEDULE
 * (GGCI / Gulf General style) from a policy PDF's text lines, so the Tyre Pulse app
 * can add policies by upload.
 *
 * Modeled on parsePdf.js: extractPdfLines(file) (lazy pdfjs-dist) feeds the pure
 * text -> object parser here. The parser is defensive - it never throws on odd
 * input and returns null when the text is clearly not a policy schedule.
 *
 * Quirks handled:
 *  - Digits split across text items ("1 ,164 , 910 . 72") - collapse whitespace in a
 *    window after each label before matching a number.
 *  - Arabic (non-latin) interleaved on the same visual line - stripped before reading.
 *  - Dates as DD/MM/YYYY -> ISO YYYY-MM-DD.
 */

import { extractPdfLines } from './parsePdf'

/** Strip non-latin (Arabic etc.) glyphs, keep ASCII letters/digits/punctuation. */
function stripNonLatin(s) {
  return String(s || '').replace(/[^\x00-\x7F]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Collapse an entire lines[]/text blob into one whitespace-normalized latin string. */
function toText(linesOrText) {
  const lines = Array.isArray(linesOrText)
    ? linesOrText
    : String(linesOrText || '').split(/\r?\n/)
  return stripNonLatin(lines.map((l) => String(l == null ? '' : l)).join(' '))
}

/**
 * Parse "1,164,910.72" / "186 920 953 . 11" / "10,000,000" -> Number (or null).
 * Accepts a value whose digits were split across items (spaces anywhere).
 */
function toAmount(raw) {
  if (raw == null) return null
  const t = String(raw).replace(/[\s,]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** DD/MM/YYYY (or DD-MM-YYYY) -> ISO YYYY-MM-DD (day-first, GCC convention). */
function toIsoDate(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (!m) return null
  let [, d, mo, y] = m
  const dd = Number(d)
  const mm = Number(mo)
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null
  if (y.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/**
 * Grab the amount that follows a label. Numbers may be fragmented ("1 ,164 , 910 . 72"),
 * so collapse whitespace in a window after the label, then take the first number-ish run
 * (digits, commas, and at most one dot). A leading "SAR" / "(SAR)" is skipped.
 */
function grabAmount(text, labelRe, windowLen = 60) {
  const m = text.match(labelRe)
  if (!m) return null
  const start = m.index + m[0].length
  const window = text.slice(start, start + windowLen)
    .replace(/[\s]/g, '')
    .replace(/^:?\(?SAR\)?/i, '')
    .replace(/^SAR/i, '')
  const mm = window.match(/-?[\d,]*\d(?:\.\d+)?/)
  return mm ? toAmount(mm[0]) : null
}

/** Grab a free-text value after a label, up to a set of stop words / end. */
function grabText(text, labelRe, stopRe = /(Policy\s*Period|Premium|Sum\s*Insured|Limit\s*of|Cover|Deductible|Condition)/i, maxLen = 120) {
  const m = text.match(labelRe)
  if (!m) return null
  const start = m.index + m[0].length
  let seg = text.slice(start, start + maxLen).replace(/^[:\s]+/, '')
  const stop = seg.match(stopRe)
  if (stop && stop.index > 0) seg = seg.slice(0, stop.index)
  seg = seg.replace(/\s+/g, ' ').trim()
  return seg || null
}

/** Infer a policy type from the whole document text. */
function inferPolicyType(text) {
  const t = text.toLowerCase()
  if (/third\s*party|\btpl\b/.test(t)) return 'motor_tpl'
  if (/auto\s*risk|\bmotor\b|comprehensive/.test(t)) return 'motor_comprehensive'
  if (/\bplant\b|equipment|machinery|contractors/.test(t)) return 'plant_equipment'
  return 'other'
}

/**
 * Parse a policy SCHEDULE from extracted lines (or a raw text blob).
 * @param {string[]|string} linesOrText
 * @returns {object|null}
 */
export function parseInsurancePolicySchedule(linesOrText) {
  const text = toText(linesOrText)
  if (!text) return null
  // Must look like a policy schedule: needs "Policy" AND a "Policy No" anchor.
  if (!/\bPolicy\b/i.test(text)) return null
  if (!/Policy\s*No\.?/i.test(text)) return null

  // Policy number: a run of alnum/dash after "Policy No.".
  let policy_no = null
  const pnM = text.match(/Policy\s*No\.?\s*:?\s*([A-Za-z0-9][A-Za-z0-9-]+)/i)
  if (pnM) policy_no = pnM[1].replace(/[-.\s]+$/, '')

  // Insured name.
  const insured_name = grabText(text, /Insured\s*Name\s*:?/i)

  // Insurer / underwriter (best-effort).
  let insurer = grabText(
    text,
    /(?:Insurer|Underwrit(?:er|ten\s*by)|Company\s*Name)\s*:?/i,
    /(Policy|Premium|Insured|Sum|Limit|Cover|Deductible|Condition|Address)/i,
  )
  if (!insurer && /Gulf\s*General/i.test(text)) insurer = 'Gulf General Insurance Company'

  // Dates: "Policy Period From : 16/04/2026 To : 15/04/2027".
  let period_from = null
  let period_to = null
  const perM = text.match(/Policy\s*Period[^0-9]*From\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})[^0-9]*To\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)
  if (perM) {
    period_from = toIsoDate(perM[1])
    period_to = toIsoDate(perM[2])
  } else {
    const fromM = text.match(/From\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)
    const toM = text.match(/To\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i)
    if (fromM) period_from = toIsoDate(fromM[1])
    if (toM) period_to = toIsoDate(toM[1])
  }

  // Money fields.
  const premium = grabAmount(text, /Premium\s*(?:\(SAR\))?\s*:?/i)
  const sum_insured = grabAmount(text, /Sum\s*Insured\s*:?/i)
  const limit_of_liability = grabAmount(text, /Limit\s*of\s*Liability\s*:?/i)

  // Currency (default SAR).
  let currency = 'SAR'
  const curM = text.match(/\b(SAR|USD|AED|EGP|EUR|GBP)\b/)
  if (curM) currency = curM[1].toUpperCase()

  // Total-loss threshold: "exceeds 60%" or "Total loss @ 65%".
  let total_loss_threshold_pct = null
  const tlM =
    text.match(/exceeds?\s*(\d{1,3})\s*%/i) ||
    text.match(/Total\s*loss\s*@?\s*(\d{1,3})\s*%/i) ||
    text.match(/constructed\s*total\s*loss[^%]*?(\d{1,3})\s*%/i)
  if (tlM) {
    const pct = Number(tlM[1])
    if (Number.isFinite(pct) && pct > 0 && pct <= 100) total_loss_threshold_pct = pct
  }

  // Deductible line text.
  const deductible_text = grabText(
    text,
    /Deductible\s*\(?s?\)?\s*:?/i,
    /(Condition|Cover\b|Sum\s*Insured|Limit\s*of|Premium|Policy\s*Period)/i,
    200,
  )

  const policy_type = inferPolicyType(text)

  // Conditions: numbered clauses after "Condition(s)".
  const conditions = parseConditions(text)

  return {
    policy_no,
    insurer: insurer || null,
    insured_name: insured_name || null,
    period_from,
    period_to,
    premium,
    sum_insured,
    limit_of_liability,
    currency,
    total_loss_threshold_pct,
    deductible_text: deductible_text || null,
    policy_type,
    conditions,
  }
}

/**
 * Pull numbered clauses from the "Condition(s)" section: "1. ... 2. ... 3. ...".
 * Latin text only, each clause trimmed. Returns [] when no such section exists.
 */
function parseConditions(text) {
  const secM = text.match(/Condition\s*\(?s?\)?\s*:?/i)
  if (!secM) return []
  let seg = text.slice(secM.index + secM[0].length)
  // Stop at a later section header if present (best-effort; keeps it bounded).
  const stop = seg.match(/\b(Signature|Authori[sz]ed\s*Signator|Warrant(?:y|ies)\s*:|Endorsement\s*:|Subject\s*to\s*the\s*terms)\b/i)
  if (stop && stop.index > 0) seg = seg.slice(0, stop.index)

  const out = []
  // Split on "N." / "N)" markers, keeping the sequence number.
  const re = /(\d{1,3})\s*[.)]\s*(.+?)(?=\s+\d{1,3}\s*[.)]\s|$)/g
  let m
  while ((m = re.exec(seg)) !== null) {
    const seq = Number(m[1])
    const clause_text = String(m[2] || '').replace(/\s+/g, ' ').trim()
    if (clause_text) out.push({ seq, clause_text })
  }
  return out
}

/**
 * Load a policy PDF and return its parsed schedule object.
 * @param {File|ArrayBuffer} file
 * @returns {Promise<object>}
 */
export async function insurancePolicyRowsFromPdf(file) {
  const lines = await extractPdfLines(file)
  const parsed = parseInsurancePolicySchedule(lines)
  if (!parsed) {
    throw new Error('No insurance policy schedule found in this PDF. Upload a GGCI-style policy schedule (with a Policy No.).')
  }
  return parsed
}
