/**
 * assetOwnership.js - which country OWNS an asset vs which country BORE its cost.
 *
 * WHY THIS EXISTS
 * The same asset number can appear in more than one country. Until now the app could
 * not separate the two questions, so a mixer owned by KSA that runs a job in UAE
 * looked exactly like two unrelated machines that happen to share a code. Management
 * needs both views and needs them never double counted.
 *
 * WHAT THE DATA ACTUALLY SAYS - read this before treating every shared code as a
 * transferred vehicle. Measured on the live 216,792 expense rows: 1,300 asset codes
 * carry spend and 221 carry it in two countries, but only 144 of those 221 have no
 * month in which both countries billed the code. 57 codes bill CONCURRENTLY in two or
 * more months, and one physical machine cannot be in two countries at once. Identity
 * confirms it: GN103 is a CATERPILLAR in KSA and a Sany in UAE. The asset numbering
 * scheme is a per-country sequence per asset class (BP batch plant, GN generator,
 * MP mobile pump, TM mixer), so collisions are expected, not exceptional. A shared
 * code is therefore EVIDENCE TO WEIGH, never proof of a transfer.
 *
 * WHY OWNERSHIP IS DECIDED ON OPERATING HISTORY AND NOTHING ELSE
 * The signals that look authoritative are unusable on this data, and either one would
 * have quietly handed KSA the whole contested population:
 *   - finance evidence is absent: purchase_value, net_book_value, fa_asset_number,
 *     operation_start_date, serial_no and chassis_no are NULL on all 1,523 fleet rows.
 *   - registration_no exists only in KSA (391 rows, 0 UAE, 0 Egypt), so it can only
 *     ever vote KSA.
 *   - vehicle_fleet.created_at is the date the derivation migration ran, not asset
 *     age, so "oldest register row" is a load-order artifact that also favours KSA.
 * Operating history is the only signal symmetric across the three countries. The two
 * discarded signals are still SHOWN to the reviewer (registrationCountry,
 * identityConflict) but they never decide.
 *
 * THE CURRENCY RULE
 * KSA reports in SAR, UAE in AED, Egypt in EGP. Cost is only ever grouped BY currency,
 * never added across them - `totalsByCurrency` returns a list of per-currency totals
 * and there is deliberately no function here that returns one blended number. Every
 * cross-country total in this system's history has been a bug.
 *
 * This module is PURE: no I/O, no Supabase, no Date.now(). It shapes the V376
 * `get_asset_ownership` payload for display; the SQL is the source of the decision and
 * `OWNERSHIP_BASIS` mirrors its ladder exactly - change both together.
 *
 * @module assetOwnership
 */

/** Unknown-owner display text. Never render a blank or a dash. */
export const UNKNOWN_OWNER = 'N/A'

/**
 * The ownership ladder, mirroring the CASE in `get_asset_ownership` (V376).
 * `decides` is false where the rule deliberately refuses to name an owner.
 */
export const OWNERSHIP_BASIS = {
  single_country: {
    key: 'single_country',
    label: 'Single country',
    decides: true,
    confidence: 'high',
    tone: 'neutral',
    explain: 'Only one country has ever recorded cost against this asset.',
  },
  dominant_operator: {
    key: 'dominant_operator',
    label: 'Dominant operator',
    decides: true,
    confidence: 'medium',
    tone: 'info',
    explain:
      'One country runs at least 90 percent of the active months and cost lines; the remainder is a stray or mis-keyed tail.',
  },
  sequential_transfer: {
    key: 'sequential_transfer',
    label: 'Transferred',
    decides: true,
    confidence: 'medium',
    tone: 'info',
    explain:
      'The countries used this asset one after the other with no shared month, so it moved; the current holder owns it.',
  },
  contested_concurrent: {
    key: 'contested_concurrent',
    label: 'Contested',
    decides: false,
    confidence: 'none',
    tone: 'warn',
    explain:
      'Two countries billed this code in the same month more than once. One machine cannot be in two countries at once, so this is very likely two different machines sharing a number. Ownership is not guessed.',
  },
  unknown: {
    key: 'unknown',
    label: 'Unknown',
    decides: false,
    confidence: 'none',
    tone: 'warn',
    explain: 'The evidence does not identify an owning country.',
  },
}

/** Ordered for a filter control. */
export const BASIS_KEYS = [
  'single_country',
  'dominant_operator',
  'sequential_transfer',
  'contested_concurrent',
  'unknown',
]

/** Basis metadata, falling back to `unknown` for an unrecognised key. */
export function basisMeta(basis) {
  return OWNERSHIP_BASIS[basis] || OWNERSHIP_BASIS.unknown
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v) => (v == null ? '' : String(v))

/**
 * Normalise one per-country row of an asset's footprint.
 * @returns {{country:string, currency:string, cost:number, tyreCost:number,
 *   rows:number, monthsActive:number, firstDate:string, lastDate:string,
 *   isOwner:boolean, bearsForOther:boolean}}
 */
function normalizeCountryRow(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    country: str(r.country),
    currency: str(r.currency),
    cost: num(r.cost),
    tyreCost: num(r.tyre_cost),
    rows: num(r.rows),
    monthsActive: num(r.months_active),
    firstDate: str(r.first_date),
    lastDate: str(r.last_date),
    isOwner: r.is_owner === true,
    bearsForOther: r.bears_cost_for_other_country === true,
  }
}

/**
 * Normalise one asset from the RPC payload into a display-ready shape.
 * Tolerates a partial or malformed row rather than throwing.
 */
export function normalizeAsset(raw) {
  const a = raw && typeof raw === 'object' ? raw : {}
  const basis = OWNERSHIP_BASIS[a.ownership_basis] ? a.ownership_basis : 'unknown'
  const countries = Array.isArray(a.countries) ? a.countries.map(normalizeCountryRow) : []
  const owningCountry = str(a.owning_country) || null
  return {
    assetNo: str(a.asset_no),
    owningCountry,
    // the rule refuses to name an owner for a contested asset; surface that as
    // an explicit unknown rather than an empty cell
    owningCountryLabel: owningCountry || UNKNOWN_OWNER,
    basis,
    basisLabel: basisMeta(basis).label,
    confidence: str(a.ownership_confidence) || basisMeta(basis).confidence,
    countryCount: num(a.country_count),
    concurrentMonths: num(a.concurrent_months),
    transferredFrom: str(a.transferred_from) || null,
    identityConflict: a.identity_conflict === true,
    registrationCountry: str(a.registration_country) || null,
    isCrossCountry: num(a.country_count) > 1,
    countries,
  }
}

/**
 * Normalise the whole `get_asset_ownership` payload.
 * An unauthorised or missing payload yields an empty, safe object so the caller
 * renders an empty state instead of crashing.
 */
export function normalizeOwnership(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const ok = p.ok === true
  const s = p.summary && typeof p.summary === 'object' ? p.summary : {}
  return {
    ok,
    reason: str(p.reason) || null,
    generatedAt: str(p.generated_at) || null,
    rule: str(p.rule) || null,
    basisOfEvidence: str(p.basis_of_evidence) || null,
    summary: {
      assetsTotal: num(s.assets_total),
      crossCountry: num(s.cross_country),
      singleCountry: num(s.single_country),
      dominantOperator: num(s.dominant_operator),
      sequentialTransfer: num(s.sequential_transfer),
      contested: num(s.contested),
      unknown: num(s.unknown),
      identityConflicts: num(s.identity_conflicts),
      byCountry: (Array.isArray(s.by_country) ? s.by_country : []).map((c) => ({
        country: str(c && c.country),
        currency: str(c && c.currency),
        ownAssetCost: num(c && c.own_asset_cost),
        foreignOwnedCost: num(c && c.foreign_owned_cost),
        contestedCost: num(c && c.contested_cost),
        totalCost: num(c && c.total_cost),
        foreignOwnedAssets: num(c && c.foreign_owned_assets),
      })),
    },
    assets: (Array.isArray(p.assets) ? p.assets : []).map(normalizeAsset),
  }
}

/**
 * Split an asset's countries into the owner and the countries bearing cost for
 * someone else. For a contested asset there is no owner, so every country lands
 * in `contested` and none is labelled foreign - calling one of them foreign would
 * assert an ownership the evidence does not support.
 */
export function costBearingSplit(asset) {
  const a = asset && Array.isArray(asset.countries) ? asset : { countries: [], owningCountry: null }
  const owner = []
  const foreign = []
  const contested = []
  for (const c of a.countries) {
    if (!a.owningCountry) contested.push(c)
    else if (c.country === a.owningCountry) owner.push(c)
    else foreign.push(c)
  }
  return { owner, foreign, contested }
}

/**
 * Group amounts by currency. This is the ONLY aggregation this module offers:
 * it returns one total PER currency, so a caller physically cannot render a
 * single blended cross-country number.
 * @param {Array<{currency:string, cost:number}>} entries
 * @returns {Array<{currency:string, total:number, count:number}>}
 */
export function totalsByCurrency(entries) {
  const list = Array.isArray(entries) ? entries : []
  const map = new Map()
  for (const e of list) {
    const cur = str(e && e.currency) || 'N/A'
    const prev = map.get(cur) || { currency: cur, total: 0, count: 0 }
    prev.total += num(e && e.cost)
    prev.count += 1
    map.set(cur, prev)
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency))
}

/**
 * Cost this country bore on assets it does not own, per currency. Built from the
 * per-asset rows so it stays correct for any filtered subset.
 */
export function foreignBorneByCurrency(assets) {
  const rows = []
  for (const a of Array.isArray(assets) ? assets : []) {
    for (const c of costBearingSplit(a).foreign) rows.push(c)
  }
  return totalsByCurrency(rows)
}

/** One-line explanation of how an asset's owner was decided. */
export function ownershipExplanation(asset) {
  const a = asset || {}
  const meta = basisMeta(a.basis)
  if (a.basis === 'sequential_transfer' && a.transferredFrom && a.owningCountry) {
    return `Moved from ${a.transferredFrom} to ${a.owningCountry} with no overlapping month, so ${a.owningCountry} holds it now.`
  }
  if (a.basis === 'contested_concurrent') {
    const m = a.concurrentMonths
    return `${m} month${m === 1 ? '' : 's'} where two countries billed this code at the same time. ${meta.explain}`
  }
  return meta.explain
}

/** Filter the asset list for the table controls. */
export function filterAssets(assets, opts = {}) {
  const { query = '', basis = 'all', country = 'all', crossOnly = false, conflictsOnly = false } = opts
  const q = String(query || '').trim().toLowerCase()
  return (Array.isArray(assets) ? assets : []).filter((a) => {
    if (crossOnly && !a.isCrossCountry) return false
    if (conflictsOnly && !a.identityConflict) return false
    if (basis !== 'all' && a.basis !== basis) return false
    if (country !== 'all') {
      const touches = a.owningCountry === country || a.countries.some((c) => c.country === country)
      if (!touches) return false
    }
    if (q) {
      const hay = `${a.assetNo} ${a.owningCountryLabel} ${a.basisLabel} ${a.countries
        .map((c) => c.country)
        .join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Rows for an Excel export: one line per asset, cost kept per country. */
export function ownershipExportRows(assets) {
  return (Array.isArray(assets) ? assets : []).map((a) => {
    const { foreign } = costBearingSplit(a)
    return {
      asset_no: a.assetNo,
      owning_country: a.owningCountryLabel,
      ownership_basis: a.basisLabel,
      confidence: a.confidence,
      countries: a.countries.map((c) => c.country).join(' + ') || 'N/A',
      concurrent_months: a.concurrentMonths,
      transferred_from: a.transferredFrom || 'N/A',
      identity_conflict: a.identityConflict ? 'Yes' : 'No',
      // per country, in its own currency, joined as text so no currency is added
      // to another
      cost_by_country:
        a.countries.map((c) => `${c.country} ${Math.round(c.cost).toLocaleString()} ${c.currency}`).join('  |  ') ||
        'N/A',
      cost_borne_for_other_country:
        foreign.map((c) => `${c.country} ${Math.round(c.cost).toLocaleString()} ${c.currency}`).join('  |  ') || 'N/A',
    }
  })
}

export const OWNERSHIP_EXPORT_COLUMNS = [
  'asset_no',
  'owning_country',
  'ownership_basis',
  'confidence',
  'countries',
  'concurrent_months',
  'transferred_from',
  'identity_conflict',
  'cost_by_country',
  'cost_borne_for_other_country',
]

export const OWNERSHIP_EXPORT_HEADERS = [
  'Asset No',
  'Owning Country',
  'Basis',
  'Confidence',
  'Countries',
  'Concurrent Months',
  'Transferred From',
  'Identity Conflict',
  'Cost by Country',
  'Cost Borne for Another Country',
]
