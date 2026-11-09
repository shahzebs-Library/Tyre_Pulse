/**
 * assetSiteHistory.js - where an asset belonged OVER TIME (operational reporting
 * attribution only; never an accounting record).
 *
 * vehicle_fleet.site is the CURRENT site. The history is rebuilt from job cards
 * (work_orders.site = the site the asset belongs to on the card) with the register
 * closing the story. Nothing is rewritten: a report may OPT IN to "the site at the
 * time" through siteAtDate(); everything else keeps the current site.
 *
 * MIRROR of SQL public.v_asset_site_history / public.asset_site_at()
 * (migration 20261110101000) - change both together.
 *
 * Period rules:
 *  - per asset, the majority job-card site of each calendar month; consecutive
 *    months with the same site are one period.
 *  - valid_from = first job card of the period; valid_to = the day before the next
 *    period starts (open for the last).
 *  - confirmed = 3+ job cards over 2+ months, every month 80%+ that site, no tie;
 *    anything else is provisional.
 *  - the latest period disagrees with the register: it closes at its last job card
 *    and a provisional 'register_current' period starts the next day.
 *  - an asset with no job card gets one provisional 'register_current_only' period.
 *  - a country typed as the site (KSA, UAE, EGYPT, SAUDI ARABIA) is not a site.
 */

export const PLACEHOLDER_SITES = Object.freeze(['KSA', 'UAE', 'EGYPT', 'SAUDI ARABIA'])
export const CONFIRM_MIN_JOB_CARDS = 3
export const CONFIRM_MIN_MONTHS = 2
export const CONFIRM_MIN_SHARE = 0.8

const up = (v) => String(v ?? '').trim().toUpperCase()
const day = (v) => (v ? String(v).slice(0, 10) : null)
const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
const keyOf = (org, country, asset) => `${org ?? ''}|${country ?? ''}|${asset}`

/**
 * Build the site history. Input:
 *   workOrders  [{ organisation_id, country, asset_no, site, opened_at }]
 *   fleet       [{ organisation_id, country, asset_no, site }]
 *   today       'YYYY-MM-DD' (job cards dated after it are ignored; defaults to now)
 * Returns periods: { organisation_id, country, asset_no, site, valid_from, valid_to,
 *   evidence, confidence, job_cards, months, min_month_share, last_evidence, register_site }.
 */
export function buildSiteHistory({ workOrders = [], fleet = [], today } = {}) {
  const cutoff = today || new Date().toISOString().slice(0, 10)
  const register = new Map()
  fleet.forEach((f) => {
    if (!up(f?.asset_no)) return
    register.set(keyOf(f.organisation_id, f.country, up(f.asset_no)), f)
  })

  // asset -> month -> site -> { n, first, last }
  const assets = new Map()
  workOrders.forEach((w) => {
    const asset = up(w?.asset_no)
    const site = up(w?.site)
    const d = day(w?.opened_at)
    if (!asset || !site || PLACEHOLDER_SITES.includes(site) || !d || d < '2000-01-01' || d > cutoff) return
    const k = keyOf(w.organisation_id, w.country, asset)
    if (!assets.has(k)) assets.set(k, { organisation_id: w.organisation_id ?? null, country: w.country ?? null, asset_no: asset, months: new Map() })
    const mon = d.slice(0, 7)
    const months = assets.get(k).months
    if (!months.has(mon)) months.set(mon, new Map())
    const sites = months.get(mon)
    const s = sites.get(site) || { n: 0, first: d, last: d }
    s.n += 1
    if (d < s.first) s.first = d
    if (d > s.last) s.last = d
    sites.set(site, s)
  })

  const out = []
  for (const [k, a] of assets.entries()) {
    const tops = [...a.months.keys()].sort().map((mon) => {
      const sites = [...a.months.get(mon).entries()].map(([site, s]) => ({ site, ...s }))
      const total = sites.reduce((t, s) => t + s.n, 0)
      sites.sort((x, y) => y.n - x.n || (x.last < y.last ? 1 : x.last > y.last ? -1 : 0) || (x.site < y.site ? -1 : 1))
      const top = sites[0]
      return { mon, site: top.site, n: top.n, first: top.first, last: top.last, share: top.n / total, tie: sites.length > 1 && sites[1].n === top.n }
    })
    const runs = []
    tops.forEach((t) => {
      const cur = runs[runs.length - 1]
      if (cur && cur.site === t.site) {
        cur.months += 1; cur.job_cards += t.n
        if (t.first < cur.valid_from) cur.valid_from = t.first
        if (t.last > cur.last_evidence) cur.last_evidence = t.last
        cur.min_share = Math.min(cur.min_share, t.share); cur.any_tie = cur.any_tie || t.tie
      } else {
        runs.push({ site: t.site, valid_from: t.first, last_evidence: t.last, months: 1, job_cards: t.n, min_share: t.share, any_tie: t.tie })
      }
    })
    const reg = register.get(k)
    const regSite = reg && up(reg.site) ? up(reg.site) : null
    runs.forEach((r, i) => {
      const last = i === runs.length - 1
      const disagrees = last && regSite != null && regSite !== r.site
      const strong = r.job_cards >= CONFIRM_MIN_JOB_CARDS && r.months >= CONFIRM_MIN_MONTHS
        && r.min_share >= CONFIRM_MIN_SHARE && !r.any_tie
      out.push({
        organisation_id: a.organisation_id, country: a.country, asset_no: a.asset_no, site: r.site,
        valid_from: r.valid_from,
        valid_to: !last ? addDays(runs[i + 1].valid_from, -1) : (disagrees ? r.last_evidence : null),
        evidence: 'job_cards', confidence: strong && !disagrees ? 'confirmed' : 'provisional',
        job_cards: r.job_cards, months: r.months, min_month_share: Math.round(r.min_share * 100) / 100,
        last_evidence: r.last_evidence, register_site: regSite,
      })
      if (disagrees) {
        out.push({
          organisation_id: a.organisation_id, country: a.country, asset_no: a.asset_no, site: regSite,
          valid_from: addDays(r.last_evidence, 1), valid_to: null, evidence: 'register_current',
          confidence: 'provisional', job_cards: 0, months: 0, min_month_share: null, last_evidence: null,
          register_site: regSite,
        })
      }
    })
  }
  for (const [k, f] of register.entries()) {
    if (assets.has(k) || !up(f.site)) continue
    out.push({
      organisation_id: f.organisation_id ?? null, country: f.country ?? null, asset_no: up(f.asset_no),
      site: up(f.site), valid_from: null, valid_to: null, evidence: 'register_current_only',
      confidence: 'provisional', job_cards: 0, months: 0, min_month_share: null, last_evidence: null,
      register_site: up(f.site),
    })
  }
  return out
}

/**
 * The site an asset belonged to on a date: { site, provisional, evidence }.
 * MIRROR of SQL public.asset_site_at(). A date before the first period gets the
 * earliest period's site, provisional, evidence 'before_first_evidence'. No
 * history at all -> { site: null, provisional: true, evidence: 'none' } (show N/A).
 */
export function siteAtDate(history = [], assetNo, date, { country } = {}) {
  const asset = up(assetNo)
  const d = day(date)
  const rows = (history || []).filter((h) => h.asset_no === asset && (country == null || h.country === country))
  if (!asset || !d || !rows.length) return { site: null, provisional: true, evidence: 'none' }
  const covering = rows
    .filter((h) => (h.valid_from == null || h.valid_from <= d) && (h.valid_to == null || d <= h.valid_to))
    .sort((a, b) => (a.valid_from === b.valid_from ? 0 : a.valid_from == null ? 1 : b.valid_from == null ? -1 : a.valid_from < b.valid_from ? 1 : -1))
  if (covering.length) {
    const h = covering[0]
    return { site: h.site, provisional: h.confidence !== 'confirmed', evidence: h.evidence }
  }
  const later = rows.filter((h) => h.valid_from != null && h.valid_from > d).sort((a, b) => (a.valid_from < b.valid_from ? -1 : 1))
  if (later.length) return { site: later[0].site, provisional: true, evidence: 'before_first_evidence' }
  return { site: null, provisional: true, evidence: 'none' }
}
