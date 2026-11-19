/**
 * Rule-based assembly classifier. Decides which part of the machine a figure
 * belongs to (chassis, upper body, other) from its heading, with a confidence
 * and a human-readable reason. Pure and deterministic; no network, no AI.
 *
 * A heading that names the area itself ("upper", "chassis") decides the area;
 * a generic system word ("hydraulic", "electrical") only gets a group and is
 * left unassigned unless a neighbouring figure of the same chapter settles it.
 */
export const AREAS = Object.freeze({
  chassis: 'Chassis',
  upper: 'Upper part assembly',
  other: 'Other / unassigned',
})

// [group, area (null = generic, decided by context), strength, stems]
const RULES = [
  ['mixer_drum', 'upper', 0.92, ['mixing drum', 'mixer drum', 'drum', 'hopper', 'chute', 'discharge', 'feeding', 'blade']],
  ['water_system', 'upper', 0.92, ['water supply', 'water tank', 'water pump', 'water system']],
  ['upper_frame', 'upper', 0.9, ['upper part', 'upper frame', 'sub frame', 'subframe', 'sub-frame', 'upper assembly', 'platform', 'ladder']],
  ['chassis_frame', 'chassis', 0.92, ['chassis', 'frame assembly', 'cross member', 'bumper', 'fifth wheel', 'spare wheel carrier']],
  ['engine', 'chassis', 0.9, ['engine', 'turbocharger', 'cylinder', 'crankshaft', 'piston', 'flywheel', 'intercooler']],
  ['cooling_exhaust', 'chassis', 0.88, ['radiator', 'cooling', 'exhaust', 'muffler', 'silencer', 'air intake', 'air cleaner', 'fuel tank', 'fuel system', 'fuel line']],
  ['driveline', 'chassis', 0.9, ['transmission', 'gearbox', 'clutch', 'propeller', 'drive shaft', 'driveshaft', 'transfer case', 'pto']],
  ['axles_suspension', 'chassis', 0.9, ['axle', 'suspension', 'leaf spring', 'shock absorber', 'differential', 'hub', 'wheel and tyre', 'wheel and tire', 'tyre', 'tire', 'rim']],
  ['steering_brakes', 'chassis', 0.9, ['steering', 'brake', 'abs', 'air tank', 'air dryer', 'compressor']],
  ['cab', 'chassis', 0.88, ['cab', 'seat', 'dashboard', 'instrument panel', 'door', 'windshield', 'wiper', 'mirror', 'air conditioning', 'heater']],
  ['hydraulic', null, 0.62, ['hydraulic', 'oil pump', 'motor assembly', 'oil tank', 'oil cooler', 'valve block', 'pipeline']],
  ['electrical', null, 0.62, ['electrical', 'wiring', 'harness', 'battery', 'lamp', 'light', 'switch', 'controller', 'sensor', 'relay', 'fuse']],
  ['pneumatic', null, 0.6, ['pneumatic', 'air line', 'air pipe']],
]

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim()
const escapeRe = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
const hasStem = (text, stem) => new RegExp(`(^|[^a-z0-9])${escapeRe(stem)}(?:s|es)?(?![a-z0-9])`).test(text)

/** Classify one heading. Returns { group, area, confidence, reason }. */
export function classifyHeading(heading) {
  const text = norm(heading)
  if (!text) return { group: 'unknown', area: 'other', confidence: 0, reason: 'No heading text on the page' }
  const explicitUpper = /(^|[^a-z0-9])(upper|mixer|mixing|drum|water supply)/.test(text)
  const explicitChassis = /(^|[^a-z0-9])chassis/.test(text)
  let best = null
  for (const [group, area, strength, stems] of RULES) {
    const hit = stems.find((s) => hasStem(text, s))
    if (!hit) continue
    const score = strength + Math.min(0.04, hit.length / 400)
    if (!best || score > best.score) best = { group, area, score, hit }
  }
  if (!best) return { group: 'unknown', area: 'other', confidence: 0.2, reason: `No rule matches "${heading}"` }
  let { area } = best
  let confidence = best.score
  let reason = `Heading matches "${best.hit}" (${best.group.replace(/_/g, ' ')})`
  if (!area) {
    if (explicitUpper && !explicitChassis) { area = 'upper'; confidence = 0.85; reason += '; heading also names the upper body' }
    else if (explicitChassis && !explicitUpper) { area = 'chassis'; confidence = 0.85; reason += '; heading also names the chassis' }
    else area = 'other'
  } else if ((area === 'chassis' && explicitUpper && !explicitChassis) || (area === 'upper' && explicitChassis && !explicitUpper)) {
    area = explicitUpper ? 'upper' : 'chassis'
    confidence = Math.min(confidence, 0.75)
    reason += '; heading names both areas, area taken from the explicit word'
  }
  return { group: best.group, area, confidence: Number(Math.min(0.97, confidence).toFixed(2)), reason }
}

/** Fallback from row descriptions when the figure has no usable heading. Capped low on purpose. */
export function classifyFromDescriptions(descriptions = []) {
  const votes = new Map()
  for (const d of descriptions) {
    const c = classifyHeading(d)
    if (c.group === 'unknown') continue
    const key = `${c.group}|${c.area}`
    votes.set(key, (votes.get(key) || 0) + 1)
  }
  const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top) return { group: 'unknown', area: 'other', confidence: 0.1, reason: 'No heading and no descriptive keywords' }
  const [group, area] = top[0].split('|')
  const share = top[1] / Math.max(1, descriptions.length)
  return { group, area, confidence: Number(Math.min(0.55, 0.2 + share).toFixed(2)), reason: `Inferred from ${top[1]} part descriptions (no usable heading)` }
}

/**
 * Classify every figure, then use chapter consensus: printed page "2-14" is in
 * chapter 2 and figures in one chapter overwhelmingly share an area. A generic
 * or weak figure inherits the chapter area; an agreeing figure gains a little
 * confidence; a strong disagreement is flagged for review.
 * figures: [{ id, chapter, heading, descriptions }]
 */
export function classifyFigures(figures) {
  const first = figures.map((f) => {
    const c = classifyHeading(f.heading)
    return { ...f, ...(c.group === 'unknown' ? classifyFromDescriptions(f.descriptions) : c) }
  })
  const byChapter = new Map()
  for (const f of first) {
    if (f.chapter == null || f.area === 'other') continue
    const m = byChapter.get(f.chapter) || new Map()
    m.set(f.area, (m.get(f.area) || 0) + (f.confidence >= 0.8 ? 2 : 1))
    byChapter.set(f.chapter, m)
  }
  const consensus = new Map()
  for (const [chapter, votes] of byChapter) {
    const total = [...votes.values()].reduce((a, b) => a + b, 0)
    const [area, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
    if (total >= 3 && n / total >= 0.7) consensus.set(chapter, { area, share: n / total })
  }
  return first.map((f) => {
    const c = consensus.get(f.chapter)
    if (!c) return f
    if (f.area === c.area) return { ...f, confidence: Number(Math.min(0.99, f.confidence + 0.05).toFixed(2)), reason: `${f.reason}; agrees with chapter ${f.chapter}` }
    if (f.area === 'other' || f.confidence < 0.7) {
      return { ...f, area: c.area, confidence: Number(Math.min(0.7, 0.5 + c.share * 0.2).toFixed(2)), reason: `${f.reason}; area taken from chapter ${f.chapter} majority (${Math.round(c.share * 100)}%)` }
    }
    return { ...f, confidence: Math.min(f.confidence, 0.65), reason: `${f.reason}; conflicts with chapter ${f.chapter} majority, needs review`, conflict: true }
  })
}

export function breadcrumbFor({ model, area, heading }) {
  return [model, AREAS[area] || AREAS.other, heading].filter(Boolean)
}
