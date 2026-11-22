/**
 * Hierarchy: Equipment > Major system > Assembly > Subassembly > Figure > Part.
 * Two parallel structures are kept on every figure:
 *  - oem_path: the manufacturer's own chapter and heading, exactly as printed
 *  - standard: a Tyre Pulse category so different manufacturers can be searched
 *    and reported together
 * A figure that matches no standard category is NOT forced into one: it stays
 * `uncategorised` and its own heading becomes a derived, manual-specific
 * category that an admin can confirm or map. Admin corrections are stored as
 * rules and re-applied to later imports of similar manuals.
 */

// code, system (chassis | upper), stems that must appear as whole words (plurals allowed)
export const STANDARD_CATEGORIES = Object.freeze([
  // chassis
  ['engine', 'chassis', ['engine', 'turbocharger', 'cylinder', 'crankshaft', 'piston', 'flywheel', 'oil pan']],
  ['cooling', 'chassis', ['radiator', 'cooling', 'coolant', 'intercooler', 'fan']],
  ['fuel', 'chassis', ['fuel', 'diesel tank', 'injector']],
  ['air_intake_exhaust', 'chassis', ['air intake', 'air cleaner', 'air filter', 'exhaust', 'muffler', 'silencer']],
  ['transmission_clutch', 'chassis', ['transmission', 'gearbox', 'clutch', 'transfer case']],
  ['propeller_shaft', 'chassis', ['propeller', 'drive shaft', 'driveshaft', 'cardan']],
  ['front_axle', 'chassis', ['front axle']],
  ['rear_axle', 'chassis', ['rear axle', 'differential', 'drive axle']],
  ['steering', 'chassis', ['steering']],
  ['suspension', 'chassis', ['suspension', 'leaf spring', 'shock absorber', 'stabilizer', 'stabiliser']],
  ['braking', 'chassis', ['brake', 'braking', 'abs']],
  ['pneumatic', 'chassis', ['pneumatic', 'air tank', 'air dryer', 'compressor', 'air pipe', 'air line']],
  ['electrical_chassis', 'chassis', ['battery', 'starter', 'alternator', 'wiring harness', 'chassis electrical', 'instrument panel']],
  ['chassis_frame', 'chassis', ['chassis', 'frame assembly', 'cross member', 'bumper', 'fifth wheel', 'spare wheel carrier']],
  ['cab_interior', 'chassis', ['cab', 'seat', 'dashboard', 'door', 'windshield', 'wiper', 'mirror', 'air conditioning', 'heater', 'interior']],
  ['wheels_hubs', 'chassis', ['wheel', 'hub', 'tyre', 'tire', 'rim']],
  ['hydraulic_pto', 'chassis', ['pto', 'power take off', 'power take-off']],
  // upper equipment
  ['mixer_drum', 'upper', ['mixing drum', 'mixer drum', 'drum body', 'drum assembly', 'blade']],
  ['drum_drive', 'upper', ['drum drive', 'drive of drum']],
  ['reduction_gearbox', 'upper', ['reduction gearbox', 'reducer', 'reduction gear']],
  ['hydraulic_pump_motor', 'upper', ['hydraulic pump', 'hydraulic motor', 'pump and motor', 'motor assembly']],
  ['hydraulic_tank_filtration', 'upper', ['hydraulic tank', 'oil tank', 'filter assembly', 'oil filter', 'filtration', 'oil cooler']],
  ['water_system', 'upper', ['water supply', 'water tank', 'water pump', 'water system', 'water pipe']],
  ['feeding_hopper', 'upper', ['hopper', 'feeding', 'feed hopper']],
  ['discharge_chute', 'upper', ['chute', 'discharge']],
  ['roller_assembly', 'upper', ['roller', 'roller assembly']],
  ['drum_supports', 'upper', ['drum support', 'support of drum', 'bracket of drum', 'frame of drum']],
  ['control_mechanisms', 'upper', ['control mechanism', 'control lever', 'operating mechanism', 'handle']],
  ['platforms_ladders', 'upper', ['platform', 'ladder', 'walkway', 'step']],
  ['safety_guards', 'upper', ['guard', 'safety', 'cover', 'shield']],
  ['electrical_controls', 'upper', ['electrical control', 'control box', 'remote control', 'controller', 'upper electrical']],
  // either system
  ['fasteners_mounting', null, ['fastener', 'bolt kit', 'mounting', 'bracket', 'clamp', 'standard parts']],
])

export const SYSTEM_OF = Object.fromEntries(STANDARD_CATEGORIES.map(([code, system]) => [code, system]))

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim()
const esc = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
const has = (text, stem) => new RegExp(`(^|[^a-z0-9])${esc(stem)}(?:s|es)?(?![a-z0-9])`).test(text)

export const headingKey = (heading) => norm(heading).replace(/\b\d+\b/g, '#').trim()

/** Best standard category for a heading, or null. Longer matching phrases win; ties are reported, not guessed. */
export function classifyCategory(heading) {
  const text = norm(heading)
  if (!text) return null
  const hits = []
  for (const [code, system, stems] of STANDARD_CATEGORIES) {
    const stem = stems.filter((s) => has(text, s)).sort((a, b) => b.length - a.length)[0]
    if (stem) hits.push({ code, system, stem, weight: stem.length })
  }
  if (!hits.length) return null
  hits.sort((a, b) => b.weight - a.weight)
  const top = hits[0]
  const tie = hits.filter((h) => h.weight === top.weight && h.code !== top.code)
  return { category: top.code, system: top.system, matched: top.stem, ambiguous: tie.length > 0, alternatives: tie.map((h) => h.code) }
}

/** Token-overlap similarity of two normalised headings, 0 to 1. */
export function headingSimilarity(a, b) {
  const A = new Set(headingKey(a).split(' ').filter(Boolean)); const B = new Set(headingKey(b).split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  const inter = [...A].filter((x) => B.has(x)).length
  return inter / Math.max(A.size, B.size)
}

/**
 * Admin corrections are rules { heading, category, system, manufacturer?, scope: 'manual'|'manufacturer'|'all' }.
 * A correction wins over the automatic result. It applies on an exact heading
 * match, or on a near match (>= 0.8) when its scope allows reuse.
 */
export function applyCorrection(heading, corrections = [], { manufacturer = '' } = {}) {
  let best = null
  for (const c of corrections) {
    if (c.scope === 'manufacturer' && c.manufacturer && manufacturer && c.manufacturer.toLowerCase() !== manufacturer.toLowerCase()) continue
    const exact = headingKey(c.heading) === headingKey(heading)
    const sim = exact ? 1 : headingSimilarity(c.heading, heading)
    if (sim >= 0.8 && (!best || sim > best.sim)) best = { rule: c, sim, exact }
  }
  return best
}

/**
 * Classify one figure into the full structure. `chapter` is the OEM chapter
 * label as printed (for example "2"); `oemTitle` the chapter title if known.
 */
export function classifyFigureHierarchy({ heading, chapter, chapterTitle, area, equipment }, { corrections = [], manufacturer = '' } = {}) {
  const oemPath = [chapterTitle || (chapter != null ? `Chapter ${chapter}` : ''), heading].filter(Boolean)
  const fix = applyCorrection(heading, corrections, { manufacturer })
  if (fix) {
    return { equipment, system: fix.rule.system || area || 'other', category: fix.rule.category, source: fix.exact ? 'admin_correction' : 'admin_correction_similar', confidence: fix.exact ? 1 : Number((0.7 + 0.25 * fix.sim).toFixed(2)), oem_path: oemPath, derived: false, review: !fix.exact }
  }
  const auto = classifyCategory(heading)
  if (!auto) {
    return { equipment, system: area || 'other', category: 'uncategorised', source: 'derived', derived_category: headingKey(heading) || null, confidence: 0, oem_path: oemPath, derived: true, review: true }
  }
  const systemClash = area && area !== 'other' && auto.system && auto.system !== area
  return {
    equipment, system: auto.system || area || 'other', category: auto.category, source: 'rule', matched: auto.matched,
    confidence: systemClash ? 0.5 : auto.ambiguous ? 0.55 : 0.9, oem_path: oemPath, derived: false,
    review: Boolean(systemClash || auto.ambiguous), reason: systemClash ? `Heading reads as ${auto.system} but the figure sits in ${area}` : auto.ambiguous ? `Also fits ${auto.alternatives.join(', ')}` : '',
  }
}

/** Manual-specific categories found in a manual that the standard list does not cover (admin can confirm or map them). */
export function derivedCategories(figures) {
  const by = new Map()
  for (const [id, f] of Object.entries(figures)) {
    const h = f.hierarchy
    if (!h?.derived) continue
    const k = h.derived_category || id
    const e = by.get(k) || { key: k, heading: f.heading, figures: [] }
    e.figures.push(id); by.set(k, e)
  }
  return [...by.values()].sort((a, b) => b.figures.length - a.figures.length)
}
