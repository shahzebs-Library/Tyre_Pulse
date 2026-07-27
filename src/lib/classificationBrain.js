/**
 * classificationBrain.js — the one place that decides what a cost line IS.
 *
 * Every expense line has to land in exactly one bucket: tyre, spare or oil. Getting
 * that wrong moves real money between reported categories, so this engine is built
 * around one principle: DECIDE FROM THE STRONGEST AVAILABLE EVIDENCE, AND SAY WHICH
 * EVIDENCE DECIDED IT.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (measured, not theoretical)
 * ---------------------------------------------------------------------------
 * Classification used to be a regex over the free-text item description. Two failures
 * were measured on the live 216,792-row expense table:
 *
 *  1. Part numbers look like tyre sizes. "PLATE KIT, PRESSURE 3400121501",
 *     "GEARBOX SICOMA MAO4500/3000" and "BRAKE DISC ... 500103705/05474876" all
 *     classified as TYRE because a digit run inside the part number matched a size
 *     pattern. SAR 1.77M of spares sat in the KSA tyre column.
 *  2. Real lubricants were missed. "COMPRESSOR OIL 68" and Egypt's engine oils
 *     (Mobil Delvac, Shell Rimula) sat in spare parts - EGP 7.2M of them - because the
 *     oil patterns did not recognise those phrasings.
 *
 * A regex over the description cannot fix this, because the description is written by
 * humans in three countries and two languages and contains part numbers. So the engine
 * uses layers of evidence instead, strongest first.
 *
 * ---------------------------------------------------------------------------
 * THE EVIDENCE LADDER
 * ---------------------------------------------------------------------------
 *  1. REVIEWED MASTER   a human decided this item code. Absolute; nothing overrides it.
 *  2. ITEM CODE RANGE   the ERP's OWN taxonomy, and by far the best machine signal.
 *                       Verified on live data: all 142 codes in the 310xxx range are
 *                       tyres, 400xxx are concrete pump parts, 050xxx brakes,
 *                       150-153xxx filters, OL-* lubricants.
 *  3. EXPLICIT WORDS    the description literally says tyre/tire, or names a known tyre
 *                       brand next to a tyre size. Accessories are excluded first, so a
 *                       "TYRE PATCH" or a "WHEEL RIM" never counts as a tyre.
 *  4. JOB CARD          the work order also appears in monthly tyre consumption, so a
 *                       tyre was fitted on this visit. CORROBORATING ONLY - see below.
 *  5. DESCRIPTION HINTS the old patterns, last resort, lowest confidence.
 *
 * ---------------------------------------------------------------------------
 * WHY THE JOB CARD IS NOT AN OVERRIDE  (this was checked before deciding)
 * ---------------------------------------------------------------------------
 * "If a job card appears in monthly tyre consumption then it is a tyre expense" is a
 * reasonable instinct and the signal is genuinely strong - 4,302 expense lines sit on
 * such a card. But those cards are workshop VISITS, not tyre-only jobs. On live data
 * the spare lines booked to tyre job cards include BATTERY 200 AMP, GEAR BOX COMPLETE,
 * ENGINE CYLINDER, BRAKE PADS, BRAKE CALIPER, FRONT GLASS and CONCRETE HOSE - about
 * 601,916 of clearly non-tyre parts across 550 distinct codes. Treating the card as an
 * override would book batteries and gearboxes as tyre cost.
 *
 * So the job card is used exactly where it adds information and nowhere else: it
 * promotes an item whose identity is UNKNOWN or ambiguous, and it is ignored for an item
 * whose identity is already clear. That keeps the signal's value without importing its
 * error.
 */

/** The three cost buckets the ledger reports on. */
export const BUCKETS = Object.freeze(['tyre', 'spare', 'oil'])

/** Which bucket a material category rolls into. Unknown never vanishes: it becomes spare. */
export const CATEGORY_BUCKET = Object.freeze({
  tyre: 'tyre',
  lubricant: 'oil',
  fuel: 'oil',
  spare_part: 'spare',
  filter: 'spare',
  consumable: 'spare',
  service: 'spare',
  labour: 'spare',
  capital: 'spare',
  unclassified: 'spare',
})

/**
 * The ERP's own item-code taxonomy, read off the live data. This is the most reliable
 * machine signal available and it is deliberately listed before any text matching.
 *
 * Each entry: a prefix test and the category it implies.
 */
export const CODE_RANGES = Object.freeze([
  // Tyres. Verified: every one of the 142 codes in this range is a tyre.
  { test: /^310\d{3}/, category: 'tyre', note: 'ERP tyre range 310xxx' },
  { test: /^TI-GE/i, category: 'tyre', note: 'Egypt tyre code TI-GE' },
  // Lubricants.
  { test: /^OL-/i, category: 'lubricant', note: 'ERP lubricant code OL-' },
  // Filters are their own thing but report as spare.
  { test: /^15[0-3]\d{3}/, category: 'filter', note: 'ERP filter range 150-153xxx' },
  // Concrete pump / plant / mixer parts.
  { test: /^400\d{3}/, category: 'spare_part', note: 'ERP pump-part range 400xxx' },
  { test: /^4(3[0-4])\d{3}/, category: 'spare_part', note: 'ERP mixer/plant range 430-434xxx' },
  { test: /^330\d{3}/, category: 'spare_part', note: 'ERP hydraulics range 330xxx' },
  // Brakes, clutch, bearings.
  { test: /^050\d{3}/, category: 'spare_part', note: 'ERP brake range 050xxx' },
  { test: /^030\d{3}/, category: 'spare_part', note: 'ERP clutch range 030xxx' },
  { test: /^(200|420)\d{3}/, category: 'spare_part', note: 'ERP bearing range' },
])

/**
 * Tyre brands seen in this fleet's own data, including the ones a generic list misses.
 * Used ONLY together with a tyre size, so a brand word alone never makes something a tyre.
 */
export const TYRE_BRANDS = Object.freeze([
  'roadx', 'longmarch', 'long march', 'rockholder', 'roadwest', 'mac royal',
  'drive master', 'drivemaster', 'cachland', 'taiho', 'v-glory', 'v glory', 'fortune',
  'allround', 'tanova', 'bossway', 'ecostar', 'transking', 'transtone', 'double star',
  'wildpeak', 'priny', 'roadking', 'firemax', 'montana', 'maxam', 'tracmax', 'trackmax',
  'skyfire', 'sky fire', 'infinity', 'tegrys', 'ericle', 'zeetex', 'prille', 'techking',
  'blackhawk', 'doublecoin', 'double coin', 'westlake', 'westlike', 'jinyu', 'triangle',
  'advance', 'nison', 'century', 'wellplus', 'formula', 'aosen', 'gold dove', 'superway',
  'kunlun', 'fulda', 'rock buster', 'diamond back', 'aget', 'allianz', 'allaine',
  'firestone', 'bridgestone', 'michelin', 'goodyear', 'dunlop', 'hankook', 'kumho',
  'yokohama', 'pirelli', 'continental', 'apollo', 'mrf', 'ceat', 'bkt', 'otani',
  'annaite', 'sailun', 'windforce', 'joyroad', 'roadlux', 'chaoyang', 'mitas',
  'alliance', 'itr', 'tvs', 'linglong', 'aeolus',
])

/**
 * Wheel and tyre ACCESSORIES. These mention tyres but are not tyres, and the standing
 * rule is that a tyre consumable stays a spare. Checked BEFORE any tyre test.
 */
export const ACCESSORY_TOKENS = Object.freeze([
  'patch', 'patches', 'valve', 'glue', 'cement', 'fender', 'flap', 'inflat', 'gauge',
  'soap', 'chalk', 'rim', 'wheel nut', 'wheel bolt', 'wheel stud', 'wheel clamp',
  'wheel set', 'balanc', 'weight', 'spanner', 'remover', 'tool', 'paste', 'marker',
  'protector', 'foam', 'puncture', 'nozzle', 'welding machine', 'wheel barrow',
  'kilomitter', 'spill', 'inner tube', 'tube and flap', 'tube flap', 'spacer ring',
  'spider hub', 'repair kit',
])

/**
 * Mechanical assemblies that are NEVER a tyre, whatever the item code says.
 *
 * The ERP code range is the strongest machine signal available and is trusted
 * at 0.95, but a code range only means "someone filed this under tyres" - and
 * on real data that range contains a power steering pump, a gearbox and an
 * o-ring. A description that names a whole assembly beats a filing decision.
 *
 * SEPARATE from ACCESSORY_TOKENS on purpose: the accessory guard has an escape
 * hatch for a code-says-tyre item that also carries a size, which is how
 * "ORING 23.5*25" stayed in the tyre bucket. These have no escape hatch,
 * because a size in the text does not make a gearbox a tyre - it is the size of
 * the thing the part fits.
 *
 * CHECKED AFTER the lubricant test, so "COMPRESSOR OIL" and "TRANSMISSION OIL"
 * are still lubricants rather than being caught here as assemblies.
 */
export const NON_TYRE_PART_TOKENS = Object.freeze([
  'gear box', 'gearbox', 'transmission', 'steering pump', 'water pump',
  'hydraulic pump', 'radiator', 'alternator', 'starter motor', 'cylinder head',
  'oring', 'o ring', 'o-ring', 'rubber roll',
])

/** Phrases that make something a lubricant. Order matters: checked after exclusions. */
export const LUBRICANT_TOKENS = Object.freeze([
  'engine oil', 'gear oil', 'hydraulic oil', 'compressor oil', 'transmission oil',
  'brake oil', 'brake fluid', 'atf', 'grease', 'lubricant', 'delvac', 'rimula',
  'voyager', 'gear fluid', 'hydraulic fluid',
  // 'transmission oil' was known but 'gearbox oil' was not, so GEARBOX OIL 140
  // fell past this test into the mechanical-assembly guard and was filed as a
  // part at 0.92 confidence - confidently wrong instead of honestly unsure.
  // Found by the decisions view; see V393.
  'gearbox oil', 'gear box oil', 'axle oil', 'differential oil', 'diff oil',
  'cooling oil', 'refrigerant oil',
  // Coolant is a consumable fluid, not a part, and the fleet already books it that
  // way in all three countries (KSA 622 lines, Egypt 113, UAE 9 - every one of them
  // already in the oil bucket). Without these tokens the engine sends coolant to the
  // spare default and breaks a consistency the data already has. 'cooliant' is the
  // Egypt export's own spelling and is matched verbatim rather than corrected.
  // A COOLANT FILTER or COOLANT LINE stays a part: OIL_PART_TOKENS is tested first.
  'coolant', 'cooliant', 'antifreeze', 'anti freeze', 'radiator fluid',
  // 'lubricant' is whole-word, so it does not reach "LUBRICATING OIL B320SH".
  'lubricating',
  // AdBlue / diesel exhaust fluid is a dosed consumable fluid and the fleet
  // already books it in the oil bucket; without it the engine sent it to spare.
  'adblue', 'ad blue', 'diesel exhaust fluid', 'def fluid',
])

/**
 * Words that mean "this is a part that merely mentions oil", not oil itself.
 * An OIL FILTER is a filter. An OIL SEAL is a seal. An OIL COOLER is a cooler.
 */
export const OIL_PART_TOKENS = Object.freeze([
  'filter', 'seal', 'gasket', 'pump', 'cooler', 'line', 'hose', 'pipe', 'gauge',
  'sensor', 'switch', 'cap', 'tank', 'strainer', 'separator', 'baffle', 'injection',
  // Plurals are NOT implied: every token here is matched whole-word on purpose
  // (the 'Shell RIMula matched rim' lesson), so "COOLING HOSES" matched nothing
  // and a hose was filed as oil. See V393b.
  'filters', 'seals', 'gaskets', 'pumps', 'coolers', 'lines', 'hoses', 'pipes',
  'gauges', 'sensors', 'switches', 'caps', 'tanks', 'strainers', 'separators',
])

/** A tyre size, in every format this fleet's data actually uses. */
const TYRE_SIZE_PATTERNS = [
  /\b\d{3}\/\d{2,3}\s*[rz]?\s*\d{2}(\.\d)?\b/i,   // 315/80R22.5, 385/65 R22.5
  /\b\d{2}\.\d{1,2}\s*[-r]\s*\d{2}\b/i,            // 23.5-25, 23.5R25
  /\b1[12]\.?0?0\s*[-r]\s*\d{2}(\.\d)?\b/i,        // 12.00R24, 1200R24
  /\b\d{2}\s*[-r]\s*1[68]\.5\b/i,                  // 10-16.5, 12-16.5
  /\b\d{1,2}\.\d{2}\s*r\s*\d{2}\b/i,               // 7.50R16, 9.00R20
  /\b\d{3}\s*r\s*\d{2}c?\b/i,                      // 195R15, 205R16
]

const norm = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Match a token as a WHOLE WORD, never as a substring.
 *
 * This is not a style preference, it is the bug that keeps recurring in this data.
 * A naive `includes('rim')` matches "Shell RIMula", so Egypt's engine oil was read as a
 * wheel rim and booked to spare parts. The same class of mistake put part numbers in the
 * tyre column. Every token test in this engine goes through here.
 */
function hasWord(text, token) {
  const t = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // token may itself contain spaces ("wheel nut"), so bound the whole phrase
  return new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`, 'i').test(text)
}

const hasAnyWord = (text, tokens) => tokens.some((t) => hasWord(text, t))

/** Pure: does the text contain a recognisable tyre size? */
export function hasTyreSize(description) {
  const d = norm(description)
  if (!d) return false
  return TYRE_SIZE_PATTERNS.some((re) => re.test(d))
}

/** Pure: does the text name a tyre brand? */
export function hasTyreBrand(description) {
  const d = norm(description)
  if (!d) return false
  return hasAnyWord(d, TYRE_BRANDS)
}

/**
 * Pure: does this name a mechanical assembly that cannot be a tyre?
 * Whole-word matching, so "transmission" never fires on a substring.
 */
export function isNonTyrePart(text) {
  const d = norm(text)
  if (!d) return false
  return hasAnyWord(d, NON_TYRE_PART_TOKENS)
}

/** Pure: is this a wheel or tyre accessory rather than a tyre? */
export function isAccessory(description) {
  const d = norm(description)
  if (!d) return false
  return hasAnyWord(d, ACCESSORY_TOKENS)
}

/** Pure: is this actually a lubricant, as opposed to a part that mentions oil? */
export function isLubricant(description) {
  const d = norm(description)
  if (!d) return false
  if (hasAnyWord(d, OIL_PART_TOKENS)) return false
  if (hasAnyWord(d, LUBRICANT_TOKENS)) return true
  return hasViscosityGrade(d)
}

/**
 * Pure: does the text carry a real viscosity grade (15W40, 10w-40, 85 W - 140)?
 *
 * A bare "number W number" is NOT enough. Two live descriptions proved it:
 * "REAR U BOLT 6W 24*92*500" and "LED LIGHT 50 W 60*60" both read as viscosity
 * grades and put 64 lines of bolts and lamps into the oil bucket. What separates
 * them from a real grade is what FOLLOWS: a dimension continues into another
 * measurement (`*` or `x`), a grade does not. Spacing cannot be used to tell them
 * apart, because "Shell Spirax S2 A 85 W - 140" is a genuine spaced grade.
 */
export function hasViscosityGrade(text) {
  const d = norm(text)
  if (!d) return false
  // the trailing (?![*x\d]) rejects a run that continues into another dimension
  return /\b\d{1,2}\s?w\s?[-\s]?\s?\d{2,3}\b(?!\s*[*x]\s*\d)/i.test(d)
}

/** Pure: the ERP code range's opinion, or null when the code is outside every range. */
export function categoryFromCode(itemCode) {
  const code = String(itemCode == null ? '' : itemCode).trim().toUpperCase()
  if (!code) return null
  for (const r of CODE_RANGES) {
    if (r.test.test(code)) return { category: r.category, note: r.note }
  }
  return null
}

/**
 * Decide what a cost line is.
 *
 * @param {object} line
 * @param {string} [line.itemCode]
 * @param {string} [line.description]
 * @param {object} [evidence]
 * @param {string} [evidence.reviewedCategory]  a human's decision for this item code
 * @param {boolean} [evidence.onTyreJobCard]    the work order appears in monthly tyre
 *                                              consumption, i.e. a tyre was fitted on
 *                                              this visit. Corroborating only.
 * @returns {{category:string, bucket:string, confidence:number, decidedBy:string, reason:string}}
 */
export function classifyLine(line = {}, evidence = {}) {
  const desc = line.description || ''
  const code = line.itemCode || ''
  const { reviewedCategory, onTyreJobCard } = evidence

  // 1. A human decided. Nothing overrides this.
  if (reviewedCategory && CATEGORY_BUCKET[reviewedCategory]) {
    return out(reviewedCategory, 1, 'reviewed-master',
      'A person confirmed what this item is')
  }

  // 2. The ERP's own code range. Best machine signal available.
  const byCode = categoryFromCode(code)

  // An accessory is never a tyre, whatever else says so.
  if (isAccessory(desc)) {
    // ...unless the code range says tyre AND the text also carries a size, which is a
    // real tyre whose description happens to include an accessory word.
    const codeSaysTyre = byCode?.category === 'tyre'
    if (!(codeSaysTyre && hasTyreSize(desc))) {
      return out('spare_part', 0.9, 'accessory',
        'Wheel or tyre accessory, which is not a tyre')
    }
  }

  // A real lubricant beats a code range that only knows the item is "a part".
  if (isLubricant(desc)) {
    return out('lubricant', 0.9, 'description-lubricant',
      'Names a lubricant, and is not a part that merely mentions oil')
  }

  // A named mechanical assembly beats the code range. The range says where the
  // ERP filed the item; the description says what it actually is.
  if (isNonTyrePart(desc)) {
    return out('spare_part', 0.92, 'non-tyre-part',
      'Names a mechanical assembly, which is not a tyre whatever its item code')
  }

  if (byCode) {
    return out(byCode.category, 0.95, 'code-range', byCode.note)
  }

  // 3. Explicit tyre wording.
  const saysTyre = /\btyre|tire\b/i.test(desc)
  if (saysTyre || (hasTyreBrand(desc) && hasTyreSize(desc))) {
    return out('tyre', 0.85, saysTyre ? 'description-tyre' : 'brand-and-size',
      saysTyre ? 'Description says tyre' : 'Names a tyre brand next to a tyre size')
  }

  // 4. Job card corroboration. ONLY for an item we could not otherwise identify, and
  //    only when the text at least carries a tyre size. A tyre job card also consumes
  //    batteries and brake pads, so it must never promote a clearly-identified part.
  if (onTyreJobCard && hasTyreSize(desc)) {
    return out('tyre', 0.7, 'job-card',
      'Unidentified item carrying a tyre size, on a job card where a tyre was fitted')
  }

  // 5. Nothing identified it. Spare is the honest default: cost still lands somewhere
  //    and shows up as unreviewed in the master rather than disappearing.
  return out('spare_part', 0.3, 'default',
    'Nothing identified this item, so it defaults to spare and needs review')
}

function out(category, confidence, decidedBy, reason) {
  return {
    category,
    bucket: CATEGORY_BUCKET[category] || 'spare',
    confidence,
    decidedBy,
    reason,
  }
}

/**
 * Pure: split a set of already-classified lines into bucket totals. Amounts are only
 * ever summed within one currency, because adding SAR to AED is not arithmetic.
 *
 * @param {Array<{bucket:string, amount:number, currency?:string}>} lines
 * @returns {{byCurrency:Record<string,{tyre:number,spare:number,oil:number,total:number}>, mixed:boolean}}
 */
export function summariseBuckets(lines) {
  const byCurrency = {}
  for (const l of lines || []) {
    if (!l) continue
    const cur = l.currency || 'UNKNOWN'
    const amt = Number(l.amount) || 0
    byCurrency[cur] = byCurrency[cur] || { tyre: 0, spare: 0, oil: 0, total: 0 }
    const b = BUCKETS.includes(l.bucket) ? l.bucket : 'spare'
    byCurrency[cur][b] += amt
    byCurrency[cur].total += amt
  }
  return { byCurrency, mixed: Object.keys(byCurrency).length > 1 }
}

/**
 * Pure: a plain-English audit line explaining one decision, for the review UI and for
 * anyone asking why a cost landed where it did.
 */
export function explainDecision(result) {
  if (!result) return ''
  const pct = Math.round((Number(result.confidence) || 0) * 100)
  return `${result.category} (counts as ${result.bucket}) - ${result.reason} [${pct}% confidence, `
    + `decided by ${result.decidedBy}]`
}
