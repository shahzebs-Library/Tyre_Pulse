/**
 * tyreLayoutSpec - the web reader of THE one tyre map definition,
 * docs/document-specs/tyre-layouts.json.
 *
 * That file is shared with the Flutter app (generated Dart const, pinned by a
 * parity test) so the screen, the printed report and the phone draw the same
 * wheels, call them by the same names and colour them by the same rule. Do not
 * copy any list from it into another module: import it from here.
 *
 * Pure, no I/O, safe in render and in Node.
 */
import SPEC from '../../docs/document-specs/tyre-layouts.json'

export { SPEC as TYRE_LAYOUT_SPEC }

const compact = (s) => String(s ?? '').toLowerCase().replace(/[\s\-_]+/g, '')
const up = (s) => String(s ?? '').trim().toUpperCase().replace(/[\s_-]+/g, '')

// ── Layouts ───────────────────────────────────────────────────────────────────
/** { key: { viewH, body, tyres: [{ id, x, y, w, h }] } } in render order. */
export const LAYOUT_GEOMETRY = Object.freeze(Object.fromEntries(
  Object.entries(SPEC.layouts).map(([key, l]) => [key, Object.freeze({
    key,
    viewH: l.viewH,
    body: l.body,
    tyres: Object.freeze(l.slots.map(([id, x, y, w, h]) => Object.freeze({ id, x, y, w, h }))),
  })]),
))

/** { key: [slot ids] } */
export const LAYOUT_SLOT_IDS = Object.freeze(Object.fromEntries(
  Object.entries(LAYOUT_GEOMETRY).map(([k, l]) => [k, Object.freeze(l.tyres.map((t) => t.id))]),
))

export const FALLBACK_LAYOUT = SPEC.fallbackLayout
export const AXLE_VARIANTS = SPEC.axleVariants
export const NO_TYRE_EQUIPMENT = Object.freeze([...SPEC.tyreless])
export const ASSET_PREFIX_MAP = Object.freeze({ ...SPEC.assetPrefix.map })

/** True when the machine carries no tyres at all. */
export function isTyrelessEquipment(vt) {
  if (!vt) return false
  const s = String(vt).toLowerCase().trim()
  return NO_TYRE_EQUIPMENT.some((k) => s.includes(k))
}

const KEY_INDEX = Object.fromEntries(Object.keys(LAYOUT_GEOMETRY).map((k) => [compact(k), k]))
const PREFIX_RE = new RegExp(SPEC.assetPrefix.pattern)
const WHEELER_RE = /(\d+)wheeler/

function ruleHits(rule, s, c) {
  return (rule.words || []).some((w) => s.includes(w)) || (rule.compact || []).some((w) => c.includes(w))
}

/** Layout key for an asset-code prefix (TM634, PL-090), or null. */
export function layoutForAssetPrefix(raw) {
  const m = String(raw ?? '').trim().match(PREFIX_RE)
  if (!m) return null
  return ASSET_PREFIX_MAP[m[1].toUpperCase().slice(0, 2)] || null
}

/**
 * Resolve ONE string onto a layout key, or null when nothing matched. The rule
 * order is the spec's: exact key, asset prefix, N-wheeler, pickup models, then
 * the keyword rules top to bottom.
 */
export function resolveLayoutOne(vt) {
  const raw = String(vt ?? '').trim()
  if (!raw) return null
  const s = raw.toLowerCase()
  const c = compact(raw)
  if (KEY_INDEX[c]) return KEY_INDEX[c]
  const byPrefix = layoutForAssetPrefix(raw)
  if (byPrefix) return byPrefix
  const wheeler = c.match(WHEELER_RE)
  if (wheeler) {
    const n = parseInt(wheeler[1], 10)
    for (const [min, key] of SPEC.wheeler) if (n >= min) return key
  }
  if (ruleHits(SPEC.pickupModels, s, c)) return 'Pickup'
  for (const rule of SPEC.keywordRules) if (ruleHits(rule, s, c)) return rule.layout
  return null
}

/** True when make/model names an identified pickup model. */
export function isPickupModel(...parts) {
  const text = parts.filter(Boolean).join(' ')
  return ruleHits(SPEC.pickupModels, text.toLowerCase(), compact(text))
}

// ── Position codes ────────────────────────────────────────────────────────────
/**
 * The GCC position code for one slot. `scope: 'erp'` leaves out display-only
 * overrides: the ERP position service's code table is mirrored in SQL.
 */
export function positionCodeFor(layoutKey, slotId, { scope = 'display' } = {}) {
  if (!slotId) return slotId
  // A raw fleet type (PUMPS, TRANSIT MIXER) is resolved to its layout first,
  // so every caller names a wheel the same way whichever it holds.
  const given = String(layoutKey || '')
  const key = (LAYOUT_GEOMETRY[given] ? given : (resolveLayoutOne(given) || given)).toLowerCase()
  for (const o of SPEC.positionCodes.overrides) {
    if (scope === 'erp' && o.scope === 'display') continue
    if (o.match.some((m) => key.includes(m)) && o.codes[slotId]) return o.codes[slotId]
  }
  return SPEC.positionCodes.base[slotId] || slotId
}

/** Every code any built-in layout shows, in layout order, without repeats. */
export const ALL_POSITION_CODES = Object.freeze(Array.from(new Set(
  Object.entries(LAYOUT_SLOT_IDS).flatMap(([key, slots]) => slots.map((s) => positionCodeFor(key, s))),
)))

/** Recorded spellings that also name a slot on this layout. */
export function aliasesFor(layoutKey, slotId) {
  return (SPEC.positionAliases[layoutKey] || {})[slotId] || []
}

/**
 * Which wheel of a built-in layout a stored position names, for drawing it on
 * the map: the slot id itself, the slot's code, or a known alias. null when
 * none does (the caller keeps the stored text and lights nothing).
 */
export function slotForStoredPosition(layoutKey, token) {
  const slots = LAYOUT_SLOT_IDS[layoutKey]
  const u = up(token)
  if (!slots || !u) return null
  const bySlot = slots.find((s) => s.toUpperCase() === u)
  if (bySlot) return bySlot
  const byCode = slots.find((s) => up(positionCodeFor(layoutKey, s)) === u)
  if (byCode) return byCode
  return slots.find((s) => aliasesFor(layoutKey, s).some((a) => up(a) === u)) || null
}

// ── Condition -> risk band ────────────────────────────────────────────────────
const COND = SPEC.conditions
const COND_RE = Object.fromEntries(Object.entries(COND.patterns).map(([b, p]) => [b, new RegExp(p, 'i')]))
export const COND_TO_RISK = Object.freeze({ ...COND.exact })
/** Stop-the-vehicle faults (red). */
export const SEVERE_CONDITION_RE = COND_RE.critical
/** Any reported fault: wear (amber) or severe (red). */
export const FAULT_CONDITION_RE = new RegExp(`${COND.patterns.warning}|${COND.patterns.critical}`, 'i')
export const WEAR_CONDITION_RE = COND_RE.warning
export const GOOD_CONDITION_RE = COND_RE.good

const NEGATION_RE = new RegExp(COND.negation, 'gi')
const NEGATED_GOOD_RE = new RegExp(COND.negatedGood, 'gi')

/**
 * The condition text with every phrase that DENIES a fault ("no damage",
 * "not damaged", "without cuts", "undamaged", "damage: none") replaced by
 * "ok", and every DENIED good word ("not good", "not ok") replaced by
 * "needsattention" (a critical word). "Good, no
 * damage" used to match "damage" and paint a healthy tyre red. Every stem test
 * on a condition word goes through this first.
 */
export function neutraliseCondition(condition) {
  const s = condition == null ? '' : String(condition)
  // "not good" / "not ok" first: a denied good word needs attention (red,
  // warning picture), it must never read as Good.
  return s.replace(NEGATED_GOOD_RE, ' needsattention ').replace(NEGATION_RE, ' ok ')
}

/** good | warning | critical | none. An unknown word is none (No data), never good. */
export function conditionRisk(condition) {
  const s = condition == null ? '' : String(condition).trim()
  if (!s) return 'none'
  if (COND.exact[s]) return COND.exact[s]
  const n = neutraliseCondition(s)
  for (const band of COND.order) if (COND_RE[band].test(n)) return band
  return 'none'
}

/** True when the word reports a fault (wear or severe), "no damage" excluded. */
export const isFaultCondition = (c) => FAULT_CONDITION_RE.test(neutraliseCondition(c))
/** True for a stop-the-vehicle fault (red), "no damage" excluded. */
export const isSevereConditionText = (c) => SEVERE_CONDITION_RE.test(neutraliseCondition(c))
/** True when the word reports wear, "no wear" excluded. */
export const isWearCondition = (c) => WEAR_CONDITION_RE.test(neutraliseCondition(c))
/** True when the word says the tyre is fine ("Good", "OK", "no damage"). */
export const isGoodCondition = (c) => GOOD_CONDITION_RE.test(neutraliseCondition(c))

// ── Condition -> kind (one colour, one glyph, one label) ──────────────────────
/** [{ kind, band, label, match, glyph }] in spec order. */
export const CONDITION_KINDS = Object.freeze(COND.kinds.map((k) => Object.freeze({
  ...k, matchRe: k.match ? new RegExp(k.match, 'i') : null,
})))
export const CONDITION_KIND = Object.freeze(Object.fromEntries(CONDITION_KINDS.map((k) => [k.kind, k])))

/**
 * good | worn | puncture | flat | damaged | missing | none. The band decides the
 * colour, the kind only picks the picture inside it, so a kind can never
 * disagree with conditionRisk.
 */
export function conditionKind(condition) {
  const band = conditionRisk(condition)
  const n = neutraliseCondition(condition)
  const inBand = CONDITION_KINDS.filter((k) => k.band === band)
  return (inBand.find((k) => k.matchRe && k.matchRe.test(n)) || inBand.find((k) => !k.matchRe) || CONDITION_KIND.none).kind
}

/** The default kind of a band (good -> good, warning -> worn, critical -> damaged, none -> none). */
export function kindForBand(band) {
  return (CONDITION_KINDS.find((k) => k.band === band && !k.matchRe) || CONDITION_KIND.none).kind
}

/**
 * The kind to DRAW for a wheel whose band may come from elsewhere (a tyre
 * record's risk level): the condition word's kind when it agrees with the
 * band, else the band's default picture. Colour and picture never disagree.
 */
export function kindForWheel(condition, band) {
  const k = conditionKind(condition)
  if (!band || (CONDITION_KIND[k] || CONDITION_KIND.none).band === band) return k
  return kindForBand(band)
}

/** The kind's colour: its band's palette entry in 'light' or 'dark'. */
export function kindHex(kind, theme = 'light') {
  return riskHex((CONDITION_KIND[kind] || CONDITION_KIND.none).band, theme)
}

// ── Palette ───────────────────────────────────────────────────────────────────
export const RISK_ORDER = Object.freeze([...SPEC.risk.order])
export const RISK_LABEL = Object.freeze({ ...SPEC.risk.labels })
export const RISK_PALETTE = SPEC.risk.palette

/** Hex colour of a band in 'light' or 'dark'. */
export function riskHex(band, theme = 'light') {
  const p = RISK_PALETTE[theme] || RISK_PALETTE.light
  return p[band] || p.none
}

/** [r, g, b] of a band, for jsPDF. */
export function riskRgb(band, theme = 'light') {
  const h = riskHex(band, theme).replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** The web app's current theme: 'light' when <html> carries the light class. */
export function currentTheme() {
  return typeof document !== 'undefined' && document.documentElement?.classList.contains('light') ? 'light' : 'dark'
}

/** CSS custom properties for the tyre board's four bands. */
export function riskCssVars(theme = currentTheme()) {
  return {
    '--tb-good': riskHex('good', theme), '--tb-warn': riskHex('warning', theme),
    '--tb-bad': riskHex('critical', theme), '--tb-none': riskHex('none', theme),
  }
}

/** A hex colour mixed toward black by `t` (0..1), for rim gradients. */
export function shade(hex, t) {
  const h = String(hex).replace('#', '')
  const ch = (i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')
  return `#${ch(0)}${ch(2)}${ch(4)}`
}
