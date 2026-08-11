/**
 * insuranceMatch - PURE matcher resolving an insurance row (a claim-register
 * entry or a per-machine schedule line) to a fleet asset. Zero I/O.
 *
 * WHY THIS EXISTS AS ITS OWN ENGINE: the insurer names a machine by chassis and
 * plate; the fleet names it by asset code. Neither side carries the other's key
 * reliably, so every insurance figure that is read "per asset", "per site" or
 * "per vehicle type" depends on this resolution being right. It is therefore
 * written to REFUSE rather than guess.
 *
 * THE RULES, each earned from a defect already recorded in PROJECT_MEMORY:
 *
 *  1. STRONG KEYS, IN ORDER: chassis_no (a VIN identifies one physical machine),
 *     then plate, then asset code. The first key that resolves to exactly ONE
 *     asset wins; a weaker key is never consulted to "improve" a strong miss.
 *
 *  2. PLATES ARE COMPARED WITH ALL WHITESPACE STRIPPED. V509 measured five
 *     "plate conflicts" that were pure spacing ("2041  XXB" vs "2041 XXB").
 *     Character ORDER is preserved deliberately - "KAA 4746" vs "4746 KAA" is a
 *     transposition, a judgement a matcher may not make, so it stays a miss.
 *
 *  3. EXCEL DESTROYS SERIALS. A chassis that arrives as "1.25121E+11" is not a
 *     chassis, it is the wreckage of one (V502/V511). It is rejected outright -
 *     matching on a mangled key silently attaches money to the wrong machine.
 *
 *  4. MATCHING IS COUNTRY-SCOPED. vehicle_fleet is unique per
 *     (org, country, asset_no) and the SAME code is a DIFFERENT machine in
 *     another country (V356/V376: GN103 is one generator in KSA and another in
 *     UAE). An unscoped index therefore treats a key seen in two countries as
 *     AMBIGUOUS, never as a match.
 *
 *  5. AMBIGUOUS IS NOT A MATCH. Two fleet rows sharing a normalised key return
 *     method 'ambiguous' at confidence 0, with the candidate count, so a person
 *     can settle it. Picking one would be a fabrication.
 */

/** Confidence attached to each resolution method. */
export const METHOD_CONFIDENCE = Object.freeze({
  chassis: 0.99,
  plate: 0.9,
  asset_no: 0.85,
  ambiguous: 0,
  unmatched: 0,
})

/** Order the strong keys are tried in. Strongest first; do not reorder lightly. */
export const MATCH_ORDER = Object.freeze(['chassis', 'plate', 'asset_no'])

/**
 * At or above this, a match is safe to PERSIST onto the claim register. Below
 * it the resolution is offered for review only - it is never written back.
 */
export const MIN_CONFIDENT_MATCH = 0.85

const blank = (v) => v == null || String(v).trim() === ''

/**
 * True when a value carries the signature of Excel having turned a long serial
 * into a float ("1.25121E+11", "2.24E+22"). Such a value has lost digits and can
 * never be restored, so it must never be used as a key.
 */
export function isMangledSerial(value) {
  if (blank(value)) return false
  return /^\s*\d+(\.\d+)?\s*[eE]\s*\+?\s*\d+\s*$/.test(String(value))
}

/** Upper-case, drop every separator/space. Returns null for a blank. */
function squash(value) {
  if (blank(value)) return null
  const s = String(value)
    .toUpperCase()
    .replace(/[^0-9A-Z؀-ۿ]/g, '')
  return s === '' ? null : s
}

/**
 * Normalised chassis/VIN key, or null when there is nothing usable.
 * A mangled scientific-notation value is rejected (rule 3), as is a value too
 * short to identify anything - a 3-character "chassis" matches by accident.
 */
export function normChassis(value) {
  if (isMangledSerial(value)) return null
  const s = squash(value)
  if (!s || s.length < 5) return null
  return s
}

/**
 * Normalised plate key: upper-case with ALL whitespace and punctuation removed
 * (rule 2). Character order is NEVER reordered.
 */
export function normPlate(value) {
  const s = squash(value)
  if (!s || s.length < 4) return null
  return s
}

/** Normalised asset code: upper-case, no whitespace (the V490 fleet convention). */
export function normAssetNo(value) {
  const s = squash(value)
  return s || null
}

const NORMALISERS = { chassis: normChassis, plate: normPlate, asset_no: normAssetNo }

/** The candidate key on a fleet row for a given method. */
function fleetKey(row, method) {
  if (method === 'chassis') return row?.chassis_no ?? row?.vin
  if (method === 'plate') return row?.registration_no ?? row?.plate_no ?? row?.plate_number
  return row?.asset_no
}

/** The candidate key on an insurance row for a given method. */
function insuranceKey(row, method) {
  if (method === 'chassis') return row?.chassis_no ?? row?.vin
  if (method === 'plate') return row?.plate_no ?? row?.plate_number ?? row?.registration_no
  return row?.asset_no
}

/**
 * Build the lookup index over vehicle_fleet rows.
 *
 * When `country` is given, ONLY that country's assets are indexed - the
 * boundary rule 4 describes. When it is omitted the whole set is indexed and a
 * key that occurs in more than one country is marked ambiguous rather than
 * matched, because those are two different machines that happen to share a code.
 *
 * @param {Array<object>} fleetRows vehicle_fleet rows
 * @param {{country?:string}} [opts]
 */
export function buildFleetIndex(fleetRows, { country } = {}) {
  const scoped = (Array.isArray(fleetRows) ? fleetRows : []).filter(
    (r) => r && (!country || country === 'All' || r.country === country),
  )
  const maps = { chassis: new Map(), plate: new Map(), asset_no: new Map() }
  const assets = new Map() // identity -> the fleet row
  const keyCoverage = { chassis: 0, plate: 0, asset_no: 0 }

  for (const row of scoped) {
    const assetKey = normAssetNo(row.asset_no)
    if (!assetKey) continue
    // IDENTITY IS COUNTRY + CODE, NEVER THE CODE ALONE. vehicle_fleet is unique
    // per (org, country, asset_no), so GN103 in KSA and GN103 in UAE are two
    // different generators. Keying on the bare code makes them look like one
    // machine and quietly resolves an unscoped lookup to whichever was indexed
    // first - the V376 defect this whole index exists to refuse.
    const identity = `${row.country || ''}|${assetKey}`
    if (!assets.has(identity)) assets.set(identity, row)
    for (const method of MATCH_ORDER) {
      const key = NORMALISERS[method](fleetKey(row, method))
      if (!key) continue
      keyCoverage[method] += 1
      const bucket = maps[method].get(key)
      if (bucket) {
        // Only a DIFFERENT machine makes the key ambiguous; the same machine
        // listed twice (a duplicate register row) is not a conflict.
        if (!bucket.includes(identity)) bucket.push(identity)
      } else {
        maps[method].set(key, [identity])
      }
    }
  }

  return {
    country: country || null,
    maps,
    assets,
    size: scoped.length,
    /** How many indexed assets actually carry each key - the reachable ceiling. */
    keyCoverage,
  }
}

/** An unresolved outcome, with the reason stated rather than implied. */
function miss(method, reason, extra = {}) {
  return { asset_no: null, method, confidence: 0, reason, ...extra }
}

/**
 * Resolve ONE insurance row against the index.
 *
 * @returns {{asset_no:string|null, method:string, confidence:number,
 *            reason?:string, candidates?:number, fleet?:object|null}}
 *          method is one of 'chassis' | 'plate' | 'asset_no' | 'ambiguous' |
 *          'unmatched'. An ambiguous or absent match ALWAYS returns
 *          asset_no null at confidence 0 - the matcher does not guess.
 */
export function matchToAsset(row, index) {
  if (!row || !index) return miss('unmatched', 'no_input')
  let sawAnyKey = false
  let ambiguousOn = null
  let ambiguousCount = 0

  for (const method of MATCH_ORDER) {
    const key = NORMALISERS[method](insuranceKey(row, method))
    if (!key) continue
    sawAnyKey = true
    const bucket = index.maps[method].get(key)
    if (!bucket || bucket.length === 0) continue
    if (bucket.length > 1) {
      // Remember it, but keep trying weaker keys - a plate may disambiguate a
      // shared asset code, which is exactly the cross-country case.
      if (!ambiguousOn) {
        ambiguousOn = method
        ambiguousCount = bucket.length
      }
      continue
    }
    const fleet = index.assets.get(bucket[0]) || null
    return {
      asset_no: fleet?.asset_no ?? bucket[0].split('|')[1] ?? null,
      method,
      confidence: METHOD_CONFIDENCE[method],
      fleet,
    }
  }

  if (ambiguousOn) {
    return miss('ambiguous', `more_than_one_asset_on_${ambiguousOn}`, { candidates: ambiguousCount })
  }
  // "We had no key to try" and "we tried and the fleet does not hold it" are
  // different facts and drive different fixes, so they are reported separately.
  return miss('unmatched', sawAnyKey ? 'not_in_fleet' : 'no_usable_key')
}

/** Resolve many rows, returning `{row, match}` pairs in input order. */
export function matchAll(rows, index) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({ row, match: matchToAsset(row, index) }))
}

/**
 * Link a claim-register row to an already-recorded accident.
 *
 * Two independent signals, strongest first: the insurer's own claim number
 * echoed on the accident, then same asset within `windowDays` of the accident
 * date. The date window exists because the two systems disagree about which day
 * an incident "happened" (report date vs loss date). More than one candidate in
 * the window is NOT resolved - two incidents on one machine in one week is
 * normal, and picking either would invent a link.
 */
export function linkClaimToAccident(claim, accidents, { windowDays = 3 } = {}) {
  const list = Array.isArray(accidents) ? accidents : []
  if (!claim || list.length === 0) return miss('unmatched', 'no_accidents')

  const claimNo = squash(claim.claim_no)
  if (claimNo) {
    const byNo = list.filter(
      (a) => squash(a.insurance_claim_no) === claimNo || squash(a.claim_no) === claimNo,
    )
    if (byNo.length === 1) return { accident_id: byNo[0].id, method: 'claim_no', confidence: 0.95 }
    if (byNo.length > 1) return miss('ambiguous', 'more_than_one_accident_on_claim_no', { candidates: byNo.length })
  }

  const asset = normAssetNo(claim.asset_no)
  const day = toDay(claim.accident_date) ?? toDay(claim.intimation_date)
  if (!asset || day == null) return miss('unmatched', 'no_usable_key')

  const near = list.filter((a) => {
    if (normAssetNo(a.asset_no) !== asset) return false
    const d = toDay(a.incident_date)
    return d != null && Math.abs(d - day) <= windowDays
  })
  if (near.length === 1) return { accident_id: near[0].id, method: 'asset_date', confidence: 0.8 }
  if (near.length > 1) return miss('ambiguous', 'more_than_one_accident_in_window', { candidates: near.length })
  return miss('unmatched', 'no_accident_in_window')
}

/** Whole days since epoch for a date-ish value, or null. */
function toDay(value) {
  if (blank(value)) return null
  const t = Date.parse(String(value).length <= 10 ? `${value}T00:00:00Z` : value)
  if (!Number.isFinite(t)) return null
  return Math.floor(t / 86400000)
}

/**
 * Summarise a batch of matches so a screen can state HOW WELL the linking ran
 * rather than presenting the linked subset as if it were everything.
 */
export function summarizeMatches(results) {
  const list = Array.isArray(results) ? results : []
  const byMethod = {}
  let confident = 0
  for (const { match } of list) {
    const m = match?.method || 'unmatched'
    byMethod[m] = (byMethod[m] || 0) + 1
    if ((match?.confidence ?? 0) >= MIN_CONFIDENT_MATCH && match?.asset_no) confident += 1
  }
  return {
    total: list.length,
    matched: confident,
    unresolved: list.length - confident,
    byMethod,
    // Null, not 0, when there was nothing to match: a rate over an empty set is
    // not a measurement of anything.
    matchRate: list.length > 0 ? confident / list.length : null,
  }
}
