import { normalizePartNumber } from '../oemPartsExtractor'

/**
 * Record model. The callout index is an ILLUSTRATION reference, never a part
 * number: it lives in `callout`, and the OEM number is stored exactly as printed
 * (leading zeros, dots, dashes) in `part_no` with a separate search key.
 */
const NUM = '([A-Z0-9][A-Z0-9._/-]{5,})'
const SUPERSEDES = new RegExp(`(?:replaces?|supersedes|instead of|old\\s*(?:no\\.?|number|p/?n))\\s*[:.]?\\s*${NUM}`, 'ig')
const SUPERSEDED_BY = new RegExp(`(?:replaced by|superseded by|use|new\\s*(?:no\\.?|number|p/?n)|alt(?:ernative)?)\\s*[:.]?\\s*${NUM}`, 'ig')
const SERIAL = /(?:s\/?n|serial(?:\s*no\.?)?|chassis|from)\s*[:.]?\s*([A-Z0-9-]{4,})\s*(?:to|-|~|–)\s*([A-Z0-9-]{4,})?|(?:from|since|after)\s*(?:s\/?n|serial)?\s*[:.]?\s*([A-Z0-9-]{4,})/i
const UOM_RE = /^\s*\d+(?:\.\d+)?\s*([A-Za-z]{1,6})\b/

export function normaliseDescription(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').trim().toLowerCase()
}

/** Pull replacement numbers, serial applicability and remarks out of the OEM remark text. Unrecognised text is kept verbatim. */
export function parseRemark(remark) {
  const text = String(remark || '').trim()
  const grab = (re) => [...text.matchAll(re)].map((m) => m[1].replace(/[.,;]+$/, '')).filter((v) => /\d/.test(v))
  const supersedes = grab(SUPERSEDES)
  const supersededBy = grab(SUPERSEDED_BY)
  const m = text.match(SERIAL)
  const serialFrom = m ? (m[1] || m[3] || null) : null
  const serialTo = m ? (m[2] || null) : null
  return { remark: text, supersedes: [...new Set(supersedes)], superseded_by: [...new Set(supersededBy)], serial_from: serialFrom, serial_to: serialTo }
}

/** Unit of measure from a quantity cell such as "2 SET"; null when none is printed. */
export function parseUom(qtyText) {
  const m = String(qtyText || '').match(UOM_RE)
  return m && !/^\d/.test(m[1]) ? m[1].toUpperCase() : null
}

/** Full record for one extracted row. `ctx` carries the manual and figure facts. */
export function buildRecord(row, ctx = {}) {
  const r = parseRemark(row.remark)
  return {
    part_no: row.part_no, // exactly as printed
    part_no_normalized: normalizePartNumber(row.part_no),
    description_original: row.description,
    description_normalized: normaliseDescription(row.description),
    callout: row.index_no || null,
    parent_callout: row.parent_index || null,
    quantity_per_assembly: row.quantity ?? null,
    uom: row.uom || parseUom(row.qty_text) || null,
    figure_id: row.figure_id || null,
    assembly: ctx.heading || row.assembly_heading || null,
    category: ctx.category || null,
    make: ctx.manufacturer || null,
    model: ctx.model || null,
    serial_from: r.serial_from || ctx.serial_from || null,
    serial_to: r.serial_to || ctx.serial_to || null,
    remark: r.remark || null,
    supersedes: r.supersedes,
    superseded_by: r.superseded_by,
    revision: ctx.revision || null,
    document_ref: ctx.document_ref || null,
    pdf_page: row.source_pdf_page, printed_page: row.printed_page || null, illustration_pdf_page: row.illustration_pdf_page || null,
    confidence: row.confidence ?? null,
    validation_status: row.issues?.some((i) => i.severity === 'error') ? 'error' : row.issues?.length ? 'warning' : 'ok',
  }
}

/** Two rows are the SAME record only when everything that can differ in fitment agrees. */
export function sameRecord(a, b) {
  return normalizePartNumber(a.part_no) === normalizePartNumber(b.part_no)
    && String(a.index_no || a.callout || '') === String(b.index_no || b.callout || '')
    && Number(a.quantity ?? a.quantity_per_assembly ?? NaN) === Number(b.quantity ?? b.quantity_per_assembly ?? NaN)
    && String(a.remark || '').trim() === String(b.remark || '').trim()
    && String(a.assembly_heading || a.assembly || '') === String(b.assembly_heading || b.assembly || '')
}

/**
 * Same OEM number on one figure or manual with different quantity, remark or
 * serial range: kept as separate records and reported so a human can confirm
 * they are genuine fitment variants.
 */
export function fitmentVariants(records) {
  const by = new Map()
  for (const r of records) {
    const k = r.part_no_normalized || normalizePartNumber(r.part_no)
    by.set(k, [...(by.get(k) || []), r])
  }
  return [...by.values()].filter((list) => list.length > 1 && list.some((x) => !sameRecord(list[0], x)))
    .map((list) => ({ part_no: list[0].part_no, count: list.length, figures: [...new Set(list.map((x) => x.figure_id))] }))
}

/** Same part number, clearly different descriptions: a possible data error rather than a variant. */
export function conflictingValues(records) {
  const by = new Map()
  for (const r of records) {
    const k = r.part_no_normalized || normalizePartNumber(r.part_no)
    const d = r.description_normalized || normaliseDescription(r.description_original || r.description)
    const e = by.get(k) || new Map(); e.set(d, [...(e.get(d) || []), r]); by.set(k, e)
  }
  const out = []
  for (const [k, descs] of by) {
    if (descs.size < 2) continue
    const words = [...descs.keys()].map((d) => new Set(d.split(' ')))
    const overlap = words[0] && words.slice(1).every((w) => [...w].filter((x) => words[0].has(x)).length / Math.max(w.size, words[0].size) >= 0.5)
    if (!overlap) out.push({ part_no_normalized: k, descriptions: [...descs.keys()] })
  }
  return out
}

/**
 * Compare a re-processed record set with what is stored. Admin-corrected stored
 * records are never overwritten: they appear as `protected` and the proposed
 * value is shown beside them. Records referenced by work orders are protected
 * the same way (referenced = Set of part ids the caller supplies).
 */
export function reprocessPreview(existing, proposed, { referencedIds = new Set() } = {}) {
  const key = (r) => `${r.figure_id}|${r.callout || r.parent_callout || ''}|${normalizePartNumber(r.part_no)}`
  const have = new Map(existing.map((r) => [key(r), r]))
  const want = new Map(proposed.map((r) => [key(r), r]))
  const preview = { newParts: [], changed: [], protectedRecords: [], unchanged: 0, missingNow: [], uncertain: [], categoryChanges: [], duplicateCandidates: [] }
  for (const [k, p] of want) {
    const e = have.get(k)
    if (!e) { preview.newParts.push(p); if ((p.confidence ?? 1) < 0.7) preview.uncertain.push(p); continue }
    const diff = ['description_original', 'quantity_per_assembly', 'remark', 'assembly', 'category', 'uom'].filter((f) => String(e[f] ?? '') !== String(p[f] ?? ''))
    if (!diff.length) { preview.unchanged += 1; continue }
    const locked = e.admin_corrected || referencedIds.has(e.id)
    if (diff.includes('category')) preview.categoryChanges.push({ id: e.id, from: e.category, to: p.category })
    if (locked) preview.protectedRecords.push({ id: e.id, fields: diff, existing: e, proposed: p, reason: e.admin_corrected ? 'admin corrected' : 'referenced by a work order' })
    else preview.changed.push({ id: e.id, fields: diff, existing: e, proposed: p })
    if ((p.confidence ?? 1) < 0.7) preview.uncertain.push(p)
  }
  for (const [k, e] of have) if (!want.has(k)) preview.missingNow.push(e)
  const seen = new Map()
  for (const r of proposed) { const k = `${r.figure_id}|${r.callout}|${normalizePartNumber(r.part_no)}`; seen.set(k, (seen.get(k) || 0) + 1) }
  preview.duplicateCandidates = [...seen].filter(([, n]) => n > 1).map(([k]) => k)
  return preview
}
