/**
 * checklistIcons — MOBILE MIRROR of src/lib/checklist/checklistIcons.js.
 *
 * THE BUG THIS FIXES. The checklist card did:
 *     <Ionicons name={(tpl.icon as any) || 'checkbox-outline'} />
 * and `checklist_templates.icon` is free text holding three incompatible kinds
 * of value at once, measured live:
 *     '🔧' '📋'        an emoji (what the web builder's picker writes)
 *     'ClipboardCheck' a lucide component name (the seeded/imported templates)
 *     null             nothing
 * Only the third case worked. An emoji and a lucide name are both meaningless
 * to Ionicons, so `<Ionicons name="ClipboardCheck">` rendered a BLANK SQUARE -
 * which is exactly what "the icons are not correct" looks like on a phone. Four
 * of the six live templates were blank.
 *
 * The web file is the reference for the vocabulary, the aliases, the category
 * map and the resolution ORDER; only the glyph mapping differs, because a name
 * that is valid in lucide means nothing to Ionicons and vice versa - storing a
 * library-specific name is what caused this in the first place.
 *
 * CHANGE BOTH FILES TOGETHER. src/test/checklistIcons.test.js reads THIS file's
 * source and fails if the token lists drift apart.
 */

export type ChecklistIconToken =
  | 'clipboard' | 'wrench' | 'bolt' | 'truck' | 'tyre' | 'gauge' | 'fuel'
  | 'water' | 'temperature' | 'battery' | 'safety' | 'fire' | 'stores'
  | 'cold' | 'hammer' | 'health'

interface IconDef {
  token: ChecklistIconToken
  label: string
  /** Ionicons glyph name. Every one verified present in the installed glyph map. */
  ionicon: string
  keywords: string[]
}

export const CHECKLIST_ICONS: IconDef[] = [
  { token: 'clipboard',   label: 'General check', ionicon: 'clipboard-outline',          keywords: ['check', 'checklist', 'inspection', 'daily', 'general', 'audit'] },
  { token: 'wrench',      label: 'Mechanical',    ionicon: 'construct-outline',          keywords: ['mechanic', 'mechanical', 'service', 'maintenance', 'repair', 'workshop', 'pm'] },
  { token: 'bolt',        label: 'Electrical',    ionicon: 'flash-outline',              keywords: ['electric', 'electrical', 'electrician', 'wiring', 'alternator', 'starter'] },
  { token: 'truck',       label: 'Vehicle',       ionicon: 'bus-outline',                keywords: ['vehicle', 'truck', 'mixer', 'driver', 'trip', 'pre-trip', 'fleet', 'bus'] },
  { token: 'tyre',        label: 'Tyre',          ionicon: 'disc-outline',               keywords: ['tyre', 'tire', 'wheel', 'tread', 'pressure'] },
  { token: 'gauge',       label: 'Meter',         ionicon: 'speedometer-outline',        keywords: ['meter', 'odometer', 'reading', 'hours', 'gauge'] },
  { token: 'fuel',        label: 'Fuel / fluids', ionicon: 'flask-outline',              keywords: ['fuel', 'diesel', 'oil', 'fluid', 'lubricant', 'coolant'] },
  { token: 'water',       label: 'Washing',       ionicon: 'water-outline',              keywords: ['wash', 'washing', 'clean', 'cleaning', 'water'] },
  { token: 'temperature', label: 'Temperature',   ionicon: 'thermometer-outline',        keywords: ['temperature', 'heat', 'thermal', 'overheat'] },
  { token: 'battery',     label: 'Battery',       ionicon: 'battery-charging-outline',   keywords: ['battery', 'charge', 'charging'] },
  { token: 'safety',      label: 'Safety / HSE',  ionicon: 'shield-checkmark-outline',   keywords: ['safety', 'hse', 'ppe', 'compliance', 'security'] },
  { token: 'fire',        label: 'Fire',          ionicon: 'flame-outline',              keywords: ['fire', 'extinguisher', 'flame'] },
  { token: 'stores',      label: 'Stores',        ionicon: 'cube-outline',               keywords: ['store', 'stores', 'stock', 'parts', 'inventory', 'spare'] },
  { token: 'cold',        label: 'Cold chain',    ionicon: 'snow-outline',               keywords: ['cold', 'chiller', 'freezer', 'refrigerat', 'ac ', 'aircon'] },
  { token: 'hammer',      label: 'Body / fabric', ionicon: 'hammer-outline',             keywords: ['body', 'fabricat', 'weld', 'structure', 'chassis'] },
  { token: 'health',      label: 'First aid',     ionicon: 'medkit-outline',             keywords: ['first aid', 'medical', 'health', 'medic'] },
]

export const CHECKLIST_ICON_TOKENS = CHECKLIST_ICONS.map((i) => i.token)

const BY_TOKEN: Record<string, IconDef> = Object.fromEntries(CHECKLIST_ICONS.map((i) => [i.token, i]))

export const DEFAULT_CHECKLIST_ICON: ChecklistIconToken = 'clipboard'

/** Foreign / legacy names that must keep working. Compared via normaliseIconKey. */
const ALIASES: Record<string, ChecklistIconToken> = {
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

const CATEGORY_TOKEN: Record<string, ChecklistIconToken> = {
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

export function normaliseIconKey(raw: unknown): string {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Structural emoji test (see the web file): short, no ASCII alphanumerics, and
 * at least one character above the ASCII range. Correctly rejects '' and '  '.
 */
export function isEmojiIcon(raw: unknown): boolean {
  const s = String(raw ?? '').trim()
  if (!s || s.length > 8) return false
  if (/[a-z0-9]/i.test(s)) return false
  return [...s].some((ch) => (ch.codePointAt(0) ?? 0) > 0x2000)
}

export function tokenFromName(raw: unknown): ChecklistIconToken | null {
  const key = normaliseIconKey(raw)
  if (!key) return null
  if (BY_TOKEN[key]) return key as ChecklistIconToken
  return ALIASES[key] ?? null
}

export function tokenFromCategory(category: unknown): ChecklistIconToken | null {
  const key = normaliseIconKey(category)
  if (!key) return null
  if (CATEGORY_TOKEN[key]) return CATEGORY_TOKEN[key]
  const hit = Object.keys(CATEGORY_TOKEN).find((k) => key.includes(k))
  return hit ? CATEGORY_TOKEN[hit] : null
}

export function tokenFromTemplateName(name: unknown): ChecklistIconToken | null {
  const s = String(name ?? '').toLowerCase()
  if (!s.trim()) return null
  // SPECIFIC BEFORE GENERIC - see the web file. The default entry's keywords are
  // broad ('check', 'daily') and in catalogue order they shadowed every specific
  // match, so 'Daily tyre pressure round' came out as the generic clipboard.
  for (const entry of CHECKLIST_ICONS) {
    if (entry.token === DEFAULT_CHECKLIST_ICON) continue
    if (entry.keywords.some((k) => s.includes(k))) return entry.token
  }
  const generic = CHECKLIST_ICONS.find((e) => e.token === DEFAULT_CHECKLIST_ICON)
  return generic?.keywords.some((k) => s.includes(k)) ? generic.token : null
}

export interface ResolvedChecklistIcon {
  kind: 'emoji' | 'icon'
  emoji: string | null
  token: ChecklistIconToken
  /** Ionicons glyph for `token` - always a real glyph, safe to pass to <Ionicons>. */
  ionicon: string
}

/**
 * Resolve whatever a template carries into something renderable.
 *
 * An emoji is returned as an emoji (it is universal - it needs no map) but the
 * fallback `token`/`ionicon` are still filled in, so a caller that cannot draw
 * text has a real glyph. `ionicon` is NEVER an invalid name, which is the whole
 * point: nothing downstream can hand Ionicons a string it does not know.
 */
export function resolveChecklistIcon(template: { icon?: string | null; category?: string | null; name?: string | null } = {}): ResolvedChecklistIcon {
  const raw = template?.icon
  const fallback =
    tokenFromCategory(template?.category)
    ?? tokenFromTemplateName(template?.name)
    ?? DEFAULT_CHECKLIST_ICON

  if (isEmojiIcon(raw)) {
    return { kind: 'emoji', emoji: String(raw).trim(), token: fallback, ionicon: checklistIonicon(fallback) }
  }
  const named = tokenFromName(raw)
  const token = named ?? fallback
  return { kind: 'icon', emoji: null, token, ionicon: checklistIonicon(token) }
}

/** Ionicons glyph for a token (never invalid - unknown falls back). */
export function checklistIonicon(token: string | null | undefined): string {
  return (BY_TOKEN[String(token ?? '')] ?? BY_TOKEN[DEFAULT_CHECKLIST_ICON]).ionicon
}

export function checklistIconLabel(token: string | null | undefined): string {
  return (BY_TOKEN[String(token ?? '')] ?? BY_TOKEN[DEFAULT_CHECKLIST_ICON]).label
}
