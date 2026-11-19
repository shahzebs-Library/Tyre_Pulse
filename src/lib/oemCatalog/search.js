import { normalizePartNumber } from '../oemPartsExtractor'
import { parseRemark } from './records'

/**
 * Ranking and explanation for catalog search. Retrieval stays on the server;
 * this orders what came back, says WHY each row matched, and classifies
 * compatibility with the selected asset. A match on description or model name
 * never counts as proof of fit.
 */
// Small, documented synonym groups. Add a group only when the trade really uses both words.
const SYNONYMS = [['tyre', 'tire'], ['propeller shaft', 'drive shaft', 'driveshaft', 'cardan shaft'], ['gearbox', 'gear box', 'transmission'], ['hydraulic', 'hyd']]

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)

export function expandTerms(query) {
  const base = words(query)
  const text = base.join(' ')
  const extra = []
  for (const group of SYNONYMS) {
    const hit = group.find((g) => ` ${text} `.includes(` ${g} `))
    if (hit) for (const alt of group) if (alt !== hit) extra.push(...words(alt))
  }
  return { tokens: base, synonyms: [...new Set(extra)].filter((w) => !base.includes(w)) }
}

/** asset: { chassis_no, serial_no, make, model }. manual: stored manual with equipment_no, chassis_from/to, manufacturer, model, model_code. */
export function compatibility(manual, asset) {
  if (!asset || !manual) return 'unverified'
  const key = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const serial = key(asset.chassis_no || asset.serial_no)
  if (manual.manufacturer && asset.make && key(manual.manufacturer) !== key(asset.make)) return 'incompatible'
  if (serial && manual.equipment_no && serial === key(manual.equipment_no)) return 'confirmed'
  const from = key(manual.chassis_from); const to = key(manual.chassis_to)
  if (serial && (from || to)) {
    if ((from && serial < from) || (to && serial > to)) return 'incompatible'
    if ((from || to) && serial.length === (from || to).length) return 'confirmed'
  }
  const models = [manual.model, manual.model_code].map(key).filter(Boolean)
  const am = key(asset.model)
  if (am && models.some((m) => m === am || m.includes(am) || am.includes(m))) return 'model'
  return 'unverified'
}

/** Score one entry. reasons are stable codes the UI translates. */
export function scoreEntry(entry, query, ctx = {}) {
  const q = String(query || '').trim()
  const nq = normalizePartNumber(q)
  const { tokens, synonyms } = expandTerms(q)
  const reasons = []
  let score = 0
  const pn = normalizePartNumber(entry.part_no)
  const parsed = parseRemark(entry.remark)
  if (nq && pn === nq) { score += 100; reasons.push('exact_part_no') }
  else if (nq.length >= 3 && pn.startsWith(nq)) { score += 70; reasons.push('part_no_prefix') }
  else if (nq.length >= 4 && pn.includes(nq)) { score += 50; reasons.push('part_no_contains') }
  if (nq && [...parsed.supersedes, ...parsed.superseded_by].some((n) => normalizePartNumber(n) === nq)) { score += 80; reasons.push('replacement_number') }
  const desc = words(entry.description)
  if (tokens.length) {
    const hit = tokens.filter((t) => desc.includes(t))
    if (hit.length === tokens.length) { score += 40; reasons.push('description_all_words') }
    else if (hit.length) { score += 15 * hit.length / tokens.length; reasons.push('description_some_words') }
    else if (synonyms.some((s) => desc.includes(s))) { score += 20; reasons.push('description_synonym') }
  }
  const heading = words(entry.assembly_heading)
  if (tokens.length && tokens.every((t) => heading.includes(t))) { score += 25; reasons.push('assembly') }
  if (ctx.category && tokens.some((t) => words(ctx.category).includes(t))) { score += 10; reasons.push('category') }
  if (entry.printed_page && q === entry.printed_page) { score += 30; reasons.push('figure_no') }
  if (/^\d{1,3}$/.test(q) && String(Number(q)) === String(Number(entry.index_no || entry.parent_index))) { score += 5; reasons.push('callout') }
  const manual = entry.manual || {}
  const mtext = words(`${manual.manufacturer || ''} ${manual.model || ''} ${manual.model_code || ''} ${manual.equipment_no || ''}`)
  if (tokens.length && tokens.some((t) => mtext.includes(t))) { score += 5; reasons.push('manual') }
  return { score, reasons }
}

/** Rank, annotate and filter. filters: { manufacturer, category, compatibility, manualId }. */
export function rankResults(entries, query, { asset = null, manuals = [], figuresByManual = {}, filters = {} } = {}) {
  const manualById = new Map(manuals.map((m) => [m.id, m]))
  const out = []
  for (const e of entries) {
    const manual = e.manual && e.manual.manufacturer ? { ...manualById.get(e.manual_id), ...e.manual } : manualById.get(e.manual_id) || {}
    const fig = figuresByManual[e.manual_id]?.[e.printed_page ? `F${e.printed_page}` : '']
    const category = fig?.hierarchy?.category || null
    const { score, reasons } = scoreEntry({ ...e, manual }, query, { category })
    const compat = compatibility(manual, asset)
    if (filters.manufacturer && String(manual.manufacturer || '').toLowerCase() !== filters.manufacturer.toLowerCase()) continue
    if (filters.category && category !== filters.category) continue
    if (filters.compatibility && compat !== filters.compatibility) continue
    if (filters.manualId && e.manual_id !== filters.manualId) continue
    out.push({ ...e, manual, _score: score, _why: reasons, _compat: compat, _category: category })
  }
  const rank = { confirmed: 3, model: 2, unverified: 1, incompatible: 0 }
  return out.sort((a, b) => b._score - a._score || rank[b._compat] - rank[a._compat] || String(a.part_no).localeCompare(String(b.part_no)))
}
