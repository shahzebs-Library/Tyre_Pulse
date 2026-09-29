/**
 * Tread illustration for a tyre, chosen from what the record actually says.
 *
 * Mirrors the idea of src/lib/vehiclePhoto.js: the picture is presentation
 * only, never tyre data. The images under public/tyre-images are brand-free
 * illustrations of a sidewall and its tread face, one per tread CLASS (steer
 * rib, drive lug, trailer rib and so on). No image ever claims to show a
 * particular brand or pattern.
 *
 * How the class is picked, strongest evidence first:
 *   1. A tyre catalogue row (tyre_spec_catalog) for the same brand and size
 *      whose tyre_type / application / pattern names the tread class.
 *   2. The size class plus the wheel position the tyre was fitted to
 *      (a truck tyre on a front position is a steer tyre, on a rear or centre
 *      position a drive tyre).
 *   3. The size class alone.
 *   4. Nothing readable: a neutral tyre, and `basis` says so.
 */

const IMG = (key) => `/tyre-images/${key}.svg`

export const TREAD_CLASSES = {
  steer: { label: 'Steer rib', note: 'Rib pattern used on steer axles.' },
  drive: { label: 'Drive lug', note: 'Lug pattern used on driven axles for traction.' },
  trailer: { label: 'Trailer rib', note: 'Straight rib pattern used on free-rolling trailer axles.' },
  allPosition: { label: 'All position', note: 'Mixed rib pattern suited to any axle.' },
  wideSingle: { label: 'Wide single', note: 'Wide base tyre, usually steer or trailer.' },
  otrL3: { label: 'Loader (L3)', note: 'Earthmover lug pattern for loaders.' },
  otrL5: { label: 'Loader (L5, deep tread)', note: 'Extra deep earthmover tread for rock work.' },
  industrial: { label: 'Industrial / skid steer', note: 'Chevron lug pattern for skid steer and industrial machines.' },
  lightTruck: { label: 'Light truck', note: 'Block and rib pattern for vans, pickups and light trucks.' },
  passenger: { label: 'Passenger / SUV', note: 'Fine rib pattern for cars and SUVs.' },
  neutral: { label: 'Tyre', note: 'Tread type not known from the record.' },
}

/** Normalised size text: upper case, no spaces ('315/80 R 22.5' -> '315/80R22.5'). */
export function normalizeSize(size) {
  return String(size ?? '').toUpperCase().replace(/\s+/g, '')
}

/**
 * Parse a tyre size into { width, aspect, rim, kind } or null.
 * kind: 'metric' (315/80R22.5), 'numeric' (11R22.5, 23.5R25, 700R16),
 * 'bias' (10-16.5).
 */
export function parseTyreSize(size) {
  const s = normalizeSize(size)
  if (!s) return null
  let m = s.match(/^(\d{3})\/(\d{2})Z?R(\d{2}(?:\.\d)?)/)
  if (m) return { width: Number(m[1]), aspect: Number(m[2]), rim: Number(m[3]), kind: 'metric' }
  m = s.match(/^(\d{1,3}(?:\.\d{1,2})?)R(\d{2}(?:\.\d)?)/)
  if (m) return { width: Number(m[1]), aspect: null, rim: Number(m[2]), kind: 'numeric' }
  m = s.match(/^(\d{1,2}(?:\.\d)?)-(\d{2}(?:\.\d)?)/)
  if (m) return { width: Number(m[1]), aspect: null, rim: Number(m[2]), kind: 'bias' }
  return null
}

/** Size class: otr / truck / industrial / lightTruck / passenger, or null. */
export function sizeClass(size) {
  const p = parseTyreSize(size)
  if (!p) return null
  const { rim, aspect, width, kind } = p
  if (rim >= 24 && rim !== 24.5) return 'otr'
  if (kind === 'bias' && rim <= 17.5) return 'industrial'
  if (rim === 22.5 || rim === 24.5 || rim === 20 || rim === 22) return 'truck'
  if (rim === 17.5 || rim === 19.5) return 'lightTruck'
  if (rim <= 18) {
    if (kind === 'metric' && aspect != null && aspect <= 65 && width <= 285) return 'passenger'
    return 'lightTruck'
  }
  return null
}

/** Axle role from a wheel position code: 'steer' | 'drive' | 'trailer' | null. */
export function positionRole(position) {
  const v = String(position ?? '').toUpperCase().replace(/[\s_-]+/g, '')
  if (!v) return null
  if (/^(SP|SPARE)/.test(v)) return null
  if (/^(LH|RH|L|R)?T\d/.test(v) || v.includes('TRAILER')) return 'trailer'
  if (/^(LH|RH|L|R)F/.test(v) || /^F[LR]?\d/.test(v) || v.includes('FRONT') || v.includes('STEER')) return 'steer'
  if (/^(LH|RH|L|R)(R|C)/.test(v) || v.includes('REAR') || v.includes('DRIVE')) return 'drive'
  return null
}

/** Tread class named by a catalogue row's own words, or null. */
export function catalogueTreadClass(entry) {
  if (!entry) return null
  const text = [entry.tyre_type, entry.application, entry.pattern, entry.suitable_for]
    .map((x) => (Array.isArray(x) ? x.join(' ') : String(x ?? ''))).join(' ').toLowerCase()
  if (!text.trim()) return null
  if (/\bl-?5\b|\be-?4\b|deep tread/.test(text)) return 'otrL5'
  if (/\bl-?[23]\b|\be-?3\b|loader|earthmover|\botr\b/.test(text)) return 'otrL3'
  if (/skid|industrial|forklift/.test(text)) return 'industrial'
  if (/all.?position|mixed service|on.?off/.test(text)) return 'allPosition'
  if (/trailer/.test(text)) return 'trailer'
  if (/steer/.test(text)) return 'steer'
  if (/drive|traction/.test(text)) return 'drive'
  if (/passenger|\bsuv\b|\bcar\b/.test(text)) return 'passenger'
  if (/light truck|\blt\b|\bvan\b/.test(text)) return 'lightTruck'
  return null
}

/** Pick the catalogue row for a brand + size (case and spacing folded), or null. */
export function matchCatalogue(entries, { brand, size } = {}) {
  const list = Array.isArray(entries) ? entries : []
  const b = String(brand ?? '').trim().toUpperCase()
  const s = normalizeSize(size)
  if (!b || !s) return null
  const hits = list.filter((e) => String(e?.brand ?? '').trim().toUpperCase() === b && normalizeSize(e?.size) === s)
  if (!hits.length) return null
  const rank = (e) => (e.approval_status === 'approved' ? 0 : e.approval_status === 'pending' ? 1 : 2)
  return [...hits].sort((x, y) => rank(x) - rank(y))[0]
}

/**
 * Resolve the picture for a tyre.
 * @returns {{key:string, src:string, label:string, note:string,
 *   basis:'catalogue'|'position'|'size'|'none', pattern:string|null}}
 */
export function resolveTyreImage({ size, position, catalogue } = {}) {
  const out = (key, basis) => ({
    key,
    src: IMG(key),
    label: TREAD_CLASSES[key].label,
    note: TREAD_CLASSES[key].note,
    basis,
    pattern: catalogue?.pattern ? String(catalogue.pattern) : null,
  })
  const fromCat = catalogueTreadClass(catalogue)
  if (fromCat) return out(fromCat, 'catalogue')

  const cls = sizeClass(size)
  const role = positionRole(position)
  const parsed = parseTyreSize(size)

  if (cls === 'truck') {
    if (role === 'steer') return out('steer', 'position')
    if (role === 'drive') return out('drive', 'position')
    if (role === 'trailer') return out('trailer', 'position')
    if (parsed?.kind === 'metric' && parsed.aspect <= 65 && parsed.width >= 385) return out('wideSingle', 'size')
    return out('allPosition', 'size')
  }
  if (cls === 'otr') return out('otrL3', 'size')
  if (cls === 'industrial') return out('industrial', 'size')
  if (cls === 'lightTruck') return out('lightTruck', 'size')
  if (cls === 'passenger') return out('passenger', 'size')
  return out('neutral', 'none')
}

/** One plain-English line on why this picture was chosen. */
export function tyreImageCaption(img) {
  if (!img) return ''
  if (img.basis === 'catalogue') return `${img.label} tread, from the tyre catalogue${img.pattern ? ` (pattern ${img.pattern})` : ''}.`
  if (img.basis === 'position') return `${img.label} tread, judged from the size and the wheel position. Illustration only.`
  if (img.basis === 'size') return `${img.label} tread, judged from the size. Illustration only.`
  return 'Tread type not known from the record. Neutral illustration.'
}
