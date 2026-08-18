/**
 * checklistIcons — the ONE icon vocabulary a checklist template can carry.
 *
 * WHY THIS EXISTS. `checklist_templates.icon` is free text and, measured live,
 * currently holds three incompatible kinds of value at once:
 *
 *     '🔧'  '📋'            an emoji (what the web builder's picker writes)
 *     'ClipboardCheck'      a lucide component name (what the seeded/imported
 *                           templates carry)
 *     null                  nothing at all
 *
 * Mobile passed that raw string straight into `<Ionicons name={tpl.icon} />`, so
 * two of the three kinds rendered as NOTHING - a blank square where the icon
 * should be. The web builder's own preview has the mirror-image bug: it renders
 * `{draft.icon}` as text, so a lucide-named template literally prints the words
 * "ClipboardCheck" on the card.
 *
 * THE FIX IS A TOKEN, NOT A GLYPH. A template stores a stable token
 * ('wrench', 'bolt', …); each stack maps that token to a real icon in ITS OWN
 * library. Storing a library-specific name is what caused this - a name that is
 * valid in lucide is meaningless to Ionicons and vice versa.
 *
 * NOTHING IS MIGRATED AND NO ONE'S CHOICE IS OVERWRITTEN. `resolveChecklistIcon`
 * still renders an emoji AS an emoji (an emoji is universal - it needs no map),
 * still understands the old lucide/Ionicons names as aliases, and falls back
 * through the template's category and then its name before giving up on the
 * generic clipboard. So every one of the 6 live templates gets a sensible icon
 * today without a data migration touching a single row.
 *
 * MIRROR: mobile/lib/checklistIcons.ts holds the same TOKENS, the same aliases
 * and the same resolution order, mapped to Ionicons instead of lucide. CHANGE
 * BOTH TOGETHER - pinned by src/test/checklistIcons.test.js, which asserts the
 * two files agree token-for-token by reading the mobile source.
 */

import {
  ClipboardList, Wrench, Zap, Truck, CircleDot, Gauge, Fuel, Droplets,
  Thermometer, BatteryCharging, ShieldCheck, Flame, Package, Snowflake,
  Hammer, Cross,
} from 'lucide-react'

/**
 * The vocabulary. Order is the order the builder's picker shows them, so the
 * everyday ones (clipboard, wrench, bolt) come first.
 *
 * `label` is what the picker calls it; `keywords` drive the name-based fallback
 * for a template that never chose an icon.
 */
export const CHECKLIST_ICONS = [
  { token: 'clipboard',   label: 'General check', Icon: ClipboardList,    keywords: ['check', 'checklist', 'inspection', 'daily', 'general', 'audit'] },
  { token: 'wrench',      label: 'Mechanical',    Icon: Wrench,           keywords: ['mechanic', 'mechanical', 'service', 'maintenance', 'repair', 'workshop', 'pm'] },
  { token: 'bolt',        label: 'Electrical',    Icon: Zap,              keywords: ['electric', 'electrical', 'electrician', 'wiring', 'alternator', 'starter'] },
  { token: 'truck',       label: 'Vehicle',       Icon: Truck,            keywords: ['vehicle', 'truck', 'mixer', 'driver', 'trip', 'pre-trip', 'fleet', 'bus'] },
  { token: 'tyre',        label: 'Tyre',          Icon: CircleDot,        keywords: ['tyre', 'tire', 'wheel', 'tread', 'pressure'] },
  { token: 'gauge',       label: 'Meter',         Icon: Gauge,            keywords: ['meter', 'odometer', 'reading', 'hours', 'gauge'] },
  { token: 'fuel',        label: 'Fuel / fluids', Icon: Fuel,             keywords: ['fuel', 'diesel', 'oil', 'fluid', 'lubricant', 'coolant'] },
  { token: 'water',       label: 'Washing',       Icon: Droplets,         keywords: ['wash', 'washing', 'clean', 'cleaning', 'water'] },
  { token: 'temperature', label: 'Temperature',   Icon: Thermometer,      keywords: ['temperature', 'heat', 'thermal', 'overheat'] },
  { token: 'battery',     label: 'Battery',       Icon: BatteryCharging,  keywords: ['battery', 'charge', 'charging'] },
  { token: 'safety',      label: 'Safety / HSE',  Icon: ShieldCheck,      keywords: ['safety', 'hse', 'ppe', 'compliance', 'security'] },
  { token: 'fire',        label: 'Fire',          Icon: Flame,            keywords: ['fire', 'extinguisher', 'flame'] },
  { token: 'stores',      label: 'Stores',        Icon: Package,          keywords: ['store', 'stores', 'stock', 'parts', 'inventory', 'spare'] },
  { token: 'cold',        label: 'Cold chain',    Icon: Snowflake,        keywords: ['cold', 'chiller', 'freezer', 'refrigerat', 'ac ', 'aircon'] },
  { token: 'hammer',      label: 'Body / fabric', Icon: Hammer,           keywords: ['body', 'fabricat', 'weld', 'structure', 'chassis'] },
  { token: 'health',      label: 'First aid',     Icon: Cross,            keywords: ['first aid', 'medical', 'health', 'medic'] },
]

export const CHECKLIST_ICON_TOKENS = CHECKLIST_ICONS.map((i) => i.token)

const BY_TOKEN = Object.fromEntries(CHECKLIST_ICONS.map((i) => [i.token, i]))

export const DEFAULT_CHECKLIST_ICON = 'clipboard'

/**
 * Old / foreign icon names that must keep working. The left side is what a live
 * row may already contain (lucide component names from the seeded templates,
 * Ionicons names from an earlier mobile write, and the obvious synonyms someone
 * might type); the right side is our token.
 *
 * Keys are compared through `normaliseIconKey`, so case, spaces, dashes and
 * underscores do not matter here - 'ClipboardCheck', 'clipboard-check' and
 * 'CLIPBOARD_CHECK' all hit the same entry.
 */
const ALIASES = {
  // lucide names (what 2 of the 6 live templates carry today)
  clipboardcheck: 'clipboard',
  clipboardlist: 'clipboard',
  clipboard: 'clipboard',
  checksquare: 'clipboard',
  filetext: 'clipboard',
  wrench: 'wrench',
  settings: 'wrench',
  cog: 'wrench',
  zap: 'bolt',
  truck: 'truck',
  car: 'truck',
  bus: 'truck',
  circledot: 'tyre',
  disc: 'tyre',
  disc3: 'tyre',
  gauge: 'gauge',
  fuel: 'fuel',
  droplets: 'water',
  droplet: 'water',
  thermometer: 'temperature',
  batterycharging: 'battery',
  battery: 'battery',
  shieldcheck: 'safety',
  shield: 'safety',
  hardhat: 'safety',
  flame: 'fire',
  package: 'stores',
  box: 'stores',
  snowflake: 'cold',
  hammer: 'hammer',
  cross: 'health',
  // Ionicons names (defensive - nothing writes these today, but the mobile card
  // used to be handed raw values and a future write could land one here)
  clipboardoutline: 'clipboard',
  checkboxoutline: 'clipboard',
  documenttextoutline: 'clipboard',
  constructoutline: 'wrench',
  buildoutline: 'wrench',
  flashoutline: 'bolt',
  caroutline: 'truck',
  busoutline: 'truck',
  discoutline: 'tyre',
  speedometeroutline: 'gauge',
  flaskoutline: 'fuel',
  wateroutline: 'water',
  thermometeroutline: 'temperature',
  batterychargingoutline: 'battery',
  shieldcheckmarkoutline: 'safety',
  flameoutline: 'fire',
  cubeoutline: 'stores',
  snowoutline: 'cold',
  hammeroutline: 'hammer',
  medkitoutline: 'health',
}

/** Category (checklist_templates.category) -> token, for a template with no icon. */
const CATEGORY_TOKEN = {
  inspection: 'clipboard',
  maintenance: 'wrench',
  workshop: 'wrench',
  mechanical: 'wrench',
  electrical: 'bolt',
  safety: 'safety',
  hse: 'safety',
  driver: 'truck',
  vehicle: 'truck',
  tyre: 'tyre',
  tire: 'tyre',
  washing: 'water',
  stores: 'stores',
  stock: 'stores',
}

/** Fold any icon-ish string to a comparable key: lowercase, letters+digits only. */
export function normaliseIconKey(raw) {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Is this stored value an emoji rather than a name?
 *
 * The test is deliberately structural rather than a pictographic regex: the
 * builder caps the field at 4 characters, and an emoji contains no ASCII
 * letters or digits while every name we care about is ASCII. A value that is
 * short, has no ASCII alphanumerics and carries at least one character above
 * the ASCII range is an emoji. This also correctly rejects '' and '   '.
 */
export function isEmojiIcon(raw) {
  const s = String(raw ?? '').trim()
  if (!s || s.length > 8) return false
  if (/[a-z0-9]/i.test(s)) return false
  return [...s].some((ch) => ch.codePointAt(0) > 0x2000)
}

/** The token a name resolves to, or null when it is not a name we know. */
export function tokenFromName(raw) {
  const key = normaliseIconKey(raw)
  if (!key) return null
  if (BY_TOKEN[key]) return key
  return ALIASES[key] ?? null
}

/** The token a category maps to, or null. */
export function tokenFromCategory(category) {
  const key = normaliseIconKey(category)
  if (!key) return null
  if (CATEGORY_TOKEN[key]) return CATEGORY_TOKEN[key]
  // A compound category ('Workshop Maintenance') matches on containment.
  const hit = Object.keys(CATEGORY_TOKEN).find((k) => key.includes(k))
  return hit ? CATEGORY_TOKEN[hit] : null
}

/** The token a template NAME suggests, from the vocabulary's own keywords. */
export function tokenFromTemplateName(name) {
  const s = String(name ?? '').toLowerCase()
  if (!s.trim()) return null
  // SPECIFIC BEFORE GENERIC. The default entry's keywords are deliberately broad
  // ('check', 'daily', 'general'), and scanning in catalogue order let them win
  // every time: 'Daily tyre pressure round' resolved to the generic clipboard
  // because 'daily' was matched before 'tyre'. A generic word must never
  // outrank a specific one, so the default is only tried once nothing else fits.
  for (const entry of CHECKLIST_ICONS) {
    if (entry.token === DEFAULT_CHECKLIST_ICON) continue
    if (entry.keywords.some((k) => s.includes(k))) return entry.token
  }
  const generic = CHECKLIST_ICONS.find((e) => e.token === DEFAULT_CHECKLIST_ICON)
  return generic?.keywords.some((k) => s.includes(k)) ? generic.token : null
}

/**
 * Resolve whatever a template carries into something renderable.
 *
 * Returns `{ kind, emoji, token }`:
 *   kind 'emoji' - render `emoji` as text; `token` is still filled in so a
 *                  caller that cannot render text (a monochrome badge, a PDF
 *                  glyph slot) has a real icon to fall back to.
 *   kind 'icon'  - render the icon for `token`.
 *
 * ORDER IS THE PRODUCT DECISION: an explicit choice wins (emoji, then a known
 * name), then the category, then the template's own name, then the generic
 * clipboard. Every step down is a weaker signal, and the last one never guesses
 * a specific trade - a checklist we know nothing about must not claim to be an
 * electrical one.
 */
export function resolveChecklistIcon(template = {}) {
  const raw = template?.icon
  const fallback =
    tokenFromCategory(template?.category)
    ?? tokenFromTemplateName(template?.name)
    ?? DEFAULT_CHECKLIST_ICON

  if (isEmojiIcon(raw)) return { kind: 'emoji', emoji: String(raw).trim(), token: fallback }

  const named = tokenFromName(raw)
  if (named) return { kind: 'icon', emoji: null, token: named }

  return { kind: 'icon', emoji: null, token: fallback }
}

/** The lucide component for a token (never null - unknown falls back). */
export function checklistIconComponent(token) {
  return (BY_TOKEN[token] ?? BY_TOKEN[DEFAULT_CHECKLIST_ICON]).Icon
}

/** Human label for a token, for the picker and for a11y text. */
export function checklistIconLabel(token) {
  return (BY_TOKEN[token] ?? BY_TOKEN[DEFAULT_CHECKLIST_ICON]).label
}

export default {
  CHECKLIST_ICONS, CHECKLIST_ICON_TOKENS, DEFAULT_CHECKLIST_ICON,
  normaliseIconKey, isEmojiIcon, tokenFromName, tokenFromCategory,
  tokenFromTemplateName, resolveChecklistIcon, checklistIconComponent,
  checklistIconLabel,
}
