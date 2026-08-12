/**
 * stationMapping - reading the batching-plant proposal, and deciding what to accept.
 *
 * A production file names a plant by number. 25 numbered plants carried 206,868
 * loads with no site, so 92% of KSA production had no region and cost per m3
 * could not be cut by area at all. The server now reads the project names behind
 * each plant and proposes where it stands; this engine is how a person reads
 * that proposal, judges it, and turns the part they believe into the payload the
 * apply RPC takes.
 *
 * THE SITE AND THE REGION ARE TWO SEPARATE JUDGEMENTS and this file never merges
 * them. Stations 81, 82 and 83 pour into "KSIA-Private Aviation Apron",
 * "VARIOUS PROJECTS @ RIYADH" and "Alinma Bank Head Office": central Riyadh
 * beyond any doubt, so CENTRAL is certain, but Riyadh holds several company
 * plants so WHICH plant it is cannot be read from the text. Cost per m3 is cut by
 * REGION, so a region-only answer is most of what the mapping was for, not a
 * consolation prize. Collapsing the two into one confidence would either throw
 * away a certain region or dress an uncertain plant as settled.
 *
 * Pure: no I/O, no clock of its own (callers pass `now`).
 */

// ── tone vocabulary ──────────────────────────────────────────────────────────
// Same words the rest of the app uses (good / info / warning / danger / quiet),
// so a badge here reads the same as a badge anywhere else.

/** How sure the machine is, and how that should read. */
export const CONFIDENCE_META = Object.freeze({
  high: { key: 'high', label: 'High', tone: 'good', rank: 3, note: 'The evidence points one way.' },
  medium: { key: 'medium', label: 'Medium', tone: 'info', rank: 2, note: 'A clear leader, with something behind it.' },
  low: { key: 'low', label: 'Low', tone: 'warning', rank: 1, note: 'Thin or split evidence. Read it before accepting.' },
  none: { key: 'none', label: 'No evidence', tone: 'quiet', rank: 0, note: 'Nothing in the loads named a place.' },
})

/** Confidence in display order, strongest first. */
export const CONFIDENCE_ORDER = Object.freeze(['high', 'medium', 'low', 'none'])

/** Tolerant lookup - anything unrecognised is "no evidence", never a fake high. */
export function confidenceMeta(value) {
  const key = String(value ?? '').trim().toLowerCase()
  return CONFIDENCE_META[key] || CONFIDENCE_META.none
}

const rankOf = (value) => confidenceMeta(value).rank

/** What each station status means, in the owner's words. */
export const STATION_STATUS_META = Object.freeze({
  named: {
    key: 'named',
    label: 'Names a site',
    tone: 'good',
    note: 'The loads already carry a registered site, so there is nothing to map.',
  },
  mapped: {
    key: 'mapped',
    label: 'Mapped',
    tone: 'good',
    note: 'Someone has already said where this plant stands.',
  },
  proposed: {
    key: 'proposed',
    label: 'Proposed',
    tone: 'info',
    note: 'Read the evidence, then accept the part you believe.',
  },
  no_evidence: {
    key: 'no_evidence',
    label: 'No evidence',
    tone: 'quiet',
    note: 'No project name behind these loads named a place. Add a keyword and propose again.',
  },
})

export const STATION_STATUS_ORDER = Object.freeze(['proposed', 'no_evidence', 'mapped', 'named'])

export function stationStatusMeta(status) {
  const key = String(status ?? '').trim().toLowerCase()
  return STATION_STATUS_META[key] || STATION_STATUS_META.no_evidence
}

// ── coercion ─────────────────────────────────────────────────────────────────

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const txt = (v) => {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}
/** Keywords arrive comma separated; an empty list is a real answer. */
const keywordList = (v) => {
  if (Array.isArray(v)) return v.map((k) => txt(k)).filter(Boolean)
  const s = txt(v)
  return s ? s.split(',').map((k) => k.trim()).filter(Boolean) : []
}

function shapeCandidate(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  return {
    site: txt(c.site),
    score: num(c.score),
    share: num(c.share),
    matched_m3: num(c.matched_m3),
    keywords: keywordList(c.keywords),
    evidence: Array.isArray(c.evidence) ? c.evidence.map((e) => txt(e)).filter(Boolean) : [],
  }
}

function shapeStation(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const status = stationStatusMeta(s.status).key
  const namedSite = txt(s.named_site)
  const mappedSite = txt(s.mapped_site)
  // What this station resolves to TODAY, and on whose word. A region-only
  // mapping carries no site, so "resolved" cannot be read off the site alone.
  const resolvedBy = status === 'named' ? 'named' : status === 'mapped' ? 'mapped' : null
  return {
    station: txt(s.station) ?? '',
    loads: num(s.loads),
    m3: num(s.m3),
    with_project: num(s.with_project),
    status,
    named_site: namedSite,
    mapped_site: mappedSite,
    resolved_site: mappedSite || namedSite || null,
    resolved_by: resolvedBy,
    proposed_site: txt(s.proposed_site),
    site_share: num(s.site_share),
    matched_m3: num(s.matched_m3),
    keywords: keywordList(s.keywords),
    runner_up: txt(s.runner_up),
    site_confidence: confidenceMeta(s.site_confidence).key,
    proposed_region: txt(s.proposed_region),
    region_share: num(s.region_share),
    region_confidence: confidenceMeta(s.region_confidence).key,
    candidates: Array.isArray(s.candidates) ? s.candidates.map(shapeCandidate) : [],
  }
}

/**
 * Read the propose RPC payload. Never throws.
 *
 * `ok:false` and "ok, and there is nothing" stay different statements: the first
 * means we could not look, and rendering it as an empty register would read as a
 * country with no plants.
 */
export function shapeProposals(payload) {
  const p = payload && typeof payload === 'object' ? payload : null
  if (!p || p.ok === false) {
    return { ok: false, reason: txt(p?.reason) || 'unavailable', country: txt(p?.country), stations: [] }
  }
  const list = Array.isArray(p.stations) ? p.stations : []
  return {
    ok: true,
    reason: null,
    country: txt(p.country),
    stations: list.map(shapeStation).filter((s) => s.station),
  }
}

// ── filtering ────────────────────────────────────────────────────────────────

/**
 * Narrow the review list.
 *
 * `confidence` matches EITHER judgement, because a plant whose region is certain
 * and whose site is not is exactly what someone filtering on "low" is hunting
 * for, and it would vanish if only one side were tested.
 */
export function filterStations(stations, { search, status, confidence, region, unmappedOnly } = {}) {
  const list = Array.isArray(stations) ? stations : []
  const q = String(search ?? '').trim().toLowerCase()
  const wantStatus = txt(status)
  const wantConf = txt(confidence)
  const wantRegion = txt(region)

  return list.filter((s) => {
    if (wantStatus && s.status !== wantStatus) return false
    if (wantConf && s.site_confidence !== wantConf && s.region_confidence !== wantConf) return false
    if (wantRegion && String(s.proposed_region ?? '').toUpperCase() !== wantRegion.toUpperCase()) return false
    if (unmappedOnly && s.resolved_by) return false
    if (!q) return true
    const hay = [
      s.station,
      s.named_site, s.mapped_site, s.proposed_site, s.runner_up, s.proposed_region,
      ...s.keywords,
      ...s.candidates.flatMap((c) => [c.site, ...c.keywords, ...c.evidence]),
    ]
    return hay.some((v) => v && String(v).toLowerCase().includes(q))
  })
}

// ── summary ──────────────────────────────────────────────────────────────────

const sum = (list, pick) => list.reduce((t, x) => t + (num(pick(x)) ?? 0), 0)

/**
 * The coverage headline: how much production now carries a region and how much
 * still does not. Percentages are null when there is nothing to divide - zero
 * would read as "none of it is covered", which is a measurement, not a gap.
 */
export function mappingSummary(stations) {
  const list = Array.isArray(stations) ? stations : []
  const covered = list.filter((s) => s.resolved_by)
  const uncovered = list.filter((s) => !s.resolved_by)
  const m3Total = sum(list, (s) => s.m3)
  const m3Covered = sum(covered, (s) => s.m3)
  const proposed = list.filter((s) => s.status === 'proposed')
  return {
    stations: list.length,
    mapped: list.filter((s) => s.status === 'mapped').length,
    named: list.filter((s) => s.status === 'named').length,
    proposed: proposed.length,
    // Not resolved, and nothing trustworthy on offer: a person has to decide.
    needsAttention: uncovered.filter(
      (s) => !s.proposed_region || rankOf(s.region_confidence) < CONFIDENCE_META.medium.rank,
    ).length,
    loads: sum(list, (s) => s.loads),
    m3: m3Total,
    m3WithRegion: m3Covered,
    m3WithoutRegion: m3Total - m3Covered,
    regionCoveragePct: m3Total > 0 ? (m3Covered / m3Total) * 100 : null,
  }
}

// ── evidence + acceptance ────────────────────────────────────────────────────

const pctText = (v) => (num(v) == null ? null : `${Math.round(num(v))}%`)

/**
 * Why this station was accepted, written once, in plain words.
 *
 * A STRING, deliberately: the map's evidence column takes a text note or jsonb,
 * and a JSON string is valid in both, while an object is only valid in one. What
 * matters is that a person reading the map a year from now can see the reasoning
 * without re-running anything.
 */
export function evidenceNote(station, { now } = {}) {
  const s = station || {}
  const parts = []
  if (s.keywords?.length) parts.push(`Keywords: ${s.keywords.join(', ')}`)
  const share = pctText(s.site_share)
  if (s.proposed_site && share) parts.push(`Site ${s.proposed_site} ${share} of matched evidence`)
  const rShare = pctText(s.region_share)
  if (s.proposed_region && rShare) parts.push(`Region ${s.proposed_region} ${rShare}`)
  if (num(s.matched_m3) != null) parts.push(`${Math.round(num(s.matched_m3)).toLocaleString('en-US')} m3 matched`)
  if (s.runner_up) parts.push(`Runner up ${s.runner_up}`)
  const projects = (s.candidates?.[0]?.evidence || []).slice(0, 3)
  if (projects.length) parts.push(`Projects: ${projects.join('; ')}`)
  const at = now instanceof Date ? now : now ? new Date(now) : null
  if (at && !Number.isNaN(at.getTime())) parts.push(`Accepted ${at.toISOString().slice(0, 10)}`)
  return parts.length ? `${parts.join('. ')}.` : 'Accepted with no supporting evidence recorded.'
}

/**
 * Turn the proposal into exactly what apply_station_proposals takes.
 *
 * Each half clears its own bar. A plant whose region is certain and whose site is
 * a guess sends the region and leaves `site` null, which is the whole point: the
 * region is what cost per m3 is cut by, and inventing the plant to go with it
 * would put real money behind a name nobody chose.
 *
 * Only stations still awaiting an answer are included. Re-sending one a person
 * already settled would overwrite their decision with the machine's.
 */
export function acceptancePlan(stations, { minSiteConfidence = 'high', minRegionConfidence = 'high', now } = {}) {
  const list = Array.isArray(stations) ? stations : []
  const siteBar = rankOf(minSiteConfidence)
  const regionBar = rankOf(minRegionConfidence)
  const plan = []
  for (const s of list) {
    if (s.status !== 'proposed') continue
    const takeSite = Boolean(s.proposed_site) && rankOf(s.site_confidence) >= siteBar && rankOf(s.site_confidence) > 0
    const takeRegion = Boolean(s.proposed_region) && rankOf(s.region_confidence) >= regionBar && rankOf(s.region_confidence) > 0
    if (!takeSite && !takeRegion) continue
    plan.push({
      station: s.station,
      site: takeSite ? s.proposed_site : null,
      region: takeRegion ? s.proposed_region : null,
      // The confidence stored is the confidence of what was actually taken.
      confidence: takeSite ? s.site_confidence : s.region_confidence,
      evidence: evidenceNote(s, { now }),
    })
  }
  return plan
}

/** One station, accepted whole (site and region, whatever it has). For a row button. */
export function acceptOne(station, { site, region, now } = {}) {
  const s = station || {}
  const chosenSite = site === undefined ? s.proposed_site ?? null : txt(site)
  const chosenRegion = region === undefined ? s.proposed_region ?? null : txt(region)
  return {
    station: s.station,
    site: chosenSite,
    region: chosenRegion,
    confidence: chosenSite ? s.site_confidence : s.region_confidence,
    evidence: evidenceNote(s, { now }),
  }
}

// ── the questions only the owner can answer ──────────────────────────────────

/**
 * The parent place a site name hangs off: DIRIYAH-G1 and DIRIYAH-G2 are two
 * gates of DIRIYAH, QIDDIYA-UPPER PLATEAU and QIDDIYA-LOWER PLATEAU two plateaus
 * of QIDDIYA. Split on the first separator, not on every one, or QIDDIYA-UPPER
 * PLATEAU would reduce to a word that names nothing.
 */
export function siteParent(name) {
  const s = String(name ?? '').trim().toUpperCase()
  if (!s) return null
  const cut = s.search(/[-_/]| /)
  if (cut <= 0) return null
  return s.slice(0, cut).trim() || null
}

/**
 * Stations whose leader and runner up are siblings of one parent.
 *
 * These are not failures of the matching. Diriyah gates G1 and G2 serve the same
 * projects and the same customers because a plant supplies whatever is near it,
 * so nothing in the text can separate them - only the owner knows. The place and
 * the region are certain; the gate is a question, and it should be put as one.
 */
export function ambiguousPairs(stations) {
  const list = Array.isArray(stations) ? stations : []
  const out = []
  for (const s of list) {
    if (s.resolved_by) continue
    const leader = s.proposed_site
    const runnerUp = s.runner_up
    if (!leader || !runnerUp) continue
    const parent = siteParent(leader)
    if (!parent || parent !== siteParent(runnerUp)) continue
    if (leader.toUpperCase() === runnerUp.toUpperCase()) continue
    const regionPart = s.proposed_region && rankOf(s.region_confidence) >= CONFIDENCE_META.medium.rank
      ? ` and in ${s.proposed_region}`
      : ''
    out.push({
      station: s.station,
      parent,
      leader,
      runnerUp,
      region: s.proposed_region,
      regionConfidence: s.region_confidence,
      m3: s.m3,
      question: `Station ${s.station} is at ${parent}${regionPart}. Which plant is it, ${leader} or ${runnerUp}?`,
    })
  }
  return out.sort((a, b) => (b.m3 ?? 0) - (a.m3 ?? 0))
}

/** Production that would land in each region if the open proposals were taken. */
export function regionImpact(stations) {
  const list = Array.isArray(stations) ? stations : []
  const by = new Map()
  for (const s of list) {
    if (s.status !== 'proposed' || !s.proposed_region) continue
    const key = s.proposed_region
    const cur = by.get(key) || { region: key, stations: 0, loads: 0, m3: 0 }
    cur.stations += 1
    cur.loads += num(s.loads) ?? 0
    cur.m3 += num(s.m3) ?? 0
    by.set(key, cur)
  }
  return [...by.values()].sort((a, b) => b.m3 - a.m3)
}

/** The regions actually on offer, for the filter. Read from the data, never hardcoded. */
export function proposedRegions(stations) {
  const list = Array.isArray(stations) ? stations : []
  return [...new Set(list.map((s) => s.proposed_region).filter(Boolean))].sort()
}
