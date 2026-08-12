import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Factory, Check, RefreshCcw, AlertTriangle, Search, Download, Tags,
  HelpCircle, Plus, Trash2, ListChecks,
} from 'lucide-react'
import { useSettings, COUNTRIES } from '../../contexts/SettingsContext'
import {
  proposeStationSites, applyStationProposals,
  listSiteKeywords, upsertSiteKeyword, deleteSiteKeyword,
  listSites,
} from '../../lib/api/costPerM3'
import {
  shapeProposals, filterStations, mappingSummary, acceptancePlan, acceptOne,
  ambiguousPairs, regionImpact, proposedRegions, evidenceNote,
  confidenceMeta, stationStatusMeta, CONFIDENCE_ORDER, STATION_STATUS_ORDER,
} from '../../lib/stationMapping'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName, reportDateLabel } from '../../lib/exportUtils'
import Modal from '../ui/Modal'
import CostM3Table, { MEASURE_COLUMNS } from './CostM3Table'

/**
 * Which plant is at which site, and why we think so.
 *
 * The production file identifies a batching plant by number - 39, 40, 81 - and
 * that number lands in the site column, so per-site production reads as numbers
 * nobody can place and cost per m3 cannot be cut by area at all.
 *
 * The server now proposes an answer by reading the project names behind each
 * plant's own loads. This panel is where a person REVIEWS that proposal: the
 * evidence is on show, the site and the region are judged separately, nothing is
 * written until a dry run has said how much production would move, and the
 * questions the data genuinely cannot settle are put as questions.
 *
 * The site list comes from the site register, the same names parts resolves to,
 * so the two sides cannot drift into separate vocabularies.
 */

const TONE_TEXT = {
  good: 'var(--success, #10b981)',
  info: 'var(--info, #38bdf8)',
  warning: 'var(--warning, #f59e0b)',
  danger: 'var(--danger, #ef4444)',
  quiet: 'var(--text-dim)',
}

function Pill({ tone = 'quiet', children, title }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ background: 'var(--panel-2)', color: TONE_TEXT[tone] || TONE_TEXT.quiet }}
    >
      {children}
    </span>
  )
}

const int = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Math.round(Number(v)).toLocaleString('en-US'))
// Null is not zero: a share nobody could measure says so rather than reading as
// "none of the evidence pointed there".
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${Math.round(Number(v))}%`)

const FILTER_CLASS = 'rounded-md border border-[var(--border-subtle)] px-2 py-1.5 text-sm'
const FILTER_STYLE = { background: 'var(--surface)', color: 'var(--text-primary)' }

export default function StationMapPanel() {
  const { activeCountry } = useSettings()
  const initial = activeCountry && activeCountry !== 'All' ? activeCountry : COUNTRIES[0]
  const [country, setCountry] = useState(initial)

  const [proposal, setProposal] = useState({ ok: true, reason: null, stations: [] })
  const [sites, setSites] = useState([])
  const [keywords, setKeywords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [filters, setFilters] = useState({ search: '', status: '', confidence: '', region: '', unmappedOnly: false })
  const [evidenceOf, setEvidenceOf] = useState(null)
  const [pending, setPending] = useState(null) // { label, entries, preview } staged write
  const [writing, setWriting] = useState(false)
  const [bulk, setBulk] = useState({ site: 'high', region: 'high' })
  const [showKeywords, setShowKeywords] = useState(false)
  const [manual, setManual] = useState({}) // station -> site chosen by hand

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true); setError(''); setNotice('')
    Promise.all([
      proposeStationSites({ country }),
      listSites({ country }).catch(() => []),
      listSiteKeywords({ country }).catch(() => []),
    ])
      .then(([raw, si, kw]) => {
        if (cancelled) return
        setProposal(shapeProposals(raw))
        setSites(Array.isArray(si) ? si : [])
        setKeywords(Array.isArray(kw) ? kw : [])
      })
      .catch((e) => { if (!cancelled) setError(toUserMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country])

  useEffect(() => load(), [load])

  const stations = proposal.stations
  const summary = useMemo(() => mappingSummary(stations), [stations])
  const rows = useMemo(() => filterStations(stations, filters), [stations, filters])
  const questions = useMemo(() => ambiguousPairs(stations), [stations])
  const regions = useMemo(() => proposedRegions(stations), [stations])
  const impact = useMemo(() => regionImpact(stations), [stations])

  // The register IS the list. A free-text box here would let a typo invent a
  // site nothing else knows about, which is how production and parts grew
  // separate vocabularies in the first place.
  const siteOptions = useMemo(
    () => sites
      .map((s) => ({ name: String(s?.name ?? '').trim(), region: String(s?.region ?? '').trim() }))
      .filter((s) => s.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [sites],
  )

  // Region is not a field here: it belongs to the site, so it is read back from
  // Site Management. Set it there once and every plant at that site reports
  // under it.
  const regionOf = useMemo(() => {
    const m = new Map()
    for (const s of siteOptions) m.set(s.name.toUpperCase(), s.region)
    return (name) => m.get(String(name ?? '').trim().toUpperCase()) || null
  }, [siteOptions])

  const plan = useMemo(
    () => acceptancePlan(stations, { minSiteConfidence: bulk.site, minRegionConfidence: bulk.region, now: new Date() }),
    [stations, bulk],
  )

  // ---- staged write: dry run first, always -----------------------------------
  // Nothing is ever written on one click. The dry run says how much production
  // would move, and only a second, deliberate confirm writes it.
  async function stage(entries, label) {
    if (!entries.length) return
    setError(''); setNotice(''); setWriting(true)
    try {
      const preview = await applyStationProposals({ country, stations: entries, dryRun: true })
      if (preview?.ok === false) {
        setError(preview.reason === 'forbidden'
          ? 'You do not have permission to change the plant mapping. Ask an Admin, Manager or Director.'
          : 'The mapping could not be checked. Nothing was changed.')
        return
      }
      setPending({ label, entries, preview })
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setWriting(false)
    }
  }

  async function commit() {
    if (!pending) return
    setWriting(true); setError('')
    try {
      const res = await applyStationProposals({ country, stations: pending.entries, dryRun: false })
      if (res?.ok === false) {
        setError(res.reason === 'forbidden'
          ? 'You do not have permission to change the plant mapping. Nothing was changed.'
          : 'The mapping could not be written. Nothing was changed.')
        return
      }
      const moved = (res?.moved || []).reduce((t, m) => t + (Number(m.approved_m3) || 0), 0)
      setNotice(`${Number(res?.written || pending.entries.length).toLocaleString('en-US')} plant ${
        (res?.written ?? pending.entries.length) === 1 ? 'mapping' : 'mappings'
      } saved. ${int(moved)} approved m3 now reports under its region.`)
      setPending(null)
      setManual({})
      load()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setWriting(false)
    }
  }

  function acceptStation(s) {
    stage([acceptOne(s, { now: new Date() })], `Station ${s.station}`)
  }

  function acceptRegionOnly(s) {
    stage([acceptOne(s, { site: null, now: new Date() })], `Station ${s.station} region only`)
  }

  function setByHand(station, site) {
    const region = regionOf(site)
    stage([{
      station,
      site,
      region: region || null,
      confidence: 'high',
      evidence: `Set by hand from the site register on ${reportDateLabel(new Date())}.`,
    }], `Station ${station}`)
  }

  function exportReview() {
    const cols = ['station', 'loads', 'm3', 'status', 'resolved_site', 'proposed_site', 'site_confidence',
      'site_share', 'proposed_region', 'region_confidence', 'region_share', 'runner_up', 'keywords', 'evidence']
    const headers = ['Station', 'Loads', 'Approved M3', 'Status', 'Resolves to now', 'Proposed site',
      'Site confidence', 'Site share', 'Proposed region', 'Region confidence', 'Region share',
      'Runner up', 'Keywords', 'Evidence']
    const data = rows.map((s) => ({
      station: s.station,
      loads: s.loads ?? 'N/A',
      m3: s.m3 == null ? 'N/A' : Math.round(s.m3),
      status: stationStatusMeta(s.status).label,
      resolved_site: s.resolved_site || 'Not set',
      proposed_site: s.proposed_site || 'None',
      site_confidence: confidenceMeta(s.site_confidence).label,
      site_share: pct(s.site_share),
      proposed_region: s.proposed_region || 'None',
      region_confidence: confidenceMeta(s.region_confidence).label,
      region_share: pct(s.region_share),
      runner_up: s.runner_up || 'None',
      keywords: s.keywords.join(', ') || 'None',
      evidence: evidenceNote(s),
    }))
    exportToExcel(data, cols, headers,
      reportFileName('Batching plant mapping', country, reportDateLabel(new Date())), 'Plant mapping')
  }

  // ---- summary rows ----------------------------------------------------------
  const summaryRows = [
    { key: 'stations', label: 'Batching plants producing', value: int(summary.stations) },
    { key: 'covered', label: 'Approved M3 reporting under a region', value: int(summary.m3WithRegion), strong: true },
    { key: 'uncovered', label: 'Approved M3 with no region yet', value: int(summary.m3WithoutRegion) },
    {
      key: 'pctcov',
      label: 'Share of production carrying a region',
      value: summary.regionCoveragePct == null ? 'No production to measure' : pct(summary.regionCoveragePct),
      strong: true,
    },
    { key: 'proposed', label: 'Plants awaiting your answer', value: int(summary.proposed) },
    { key: 'attention', label: 'Plants with nothing solid to propose', value: int(summary.needsAttention) },
  ]

  const columns = [
    {
      key: 'station',
      header: 'Plant',
      render: (r) => <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{r.station}</span>,
    },
    { key: 'loads', header: 'Loads', align: 'right', render: (r) => int(r.loads) },
    { key: 'm3', header: 'Approved M3', align: 'right', render: (r) => int(r.m3) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const m = stationStatusMeta(r.status)
        return <Pill tone={m.tone} title={m.note}>{m.label}</Pill>
      },
    },
    {
      key: 'site',
      header: 'Plant it stands at',
      render: (r) => {
        if (r.resolved_site) {
          return (
            <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
              <Check size={13} /> {r.resolved_site}
            </span>
          )
        }
        if (r.resolved_by) return <span style={{ color: 'var(--text-secondary)' }}>Region only</span>
        if (!r.proposed_site) return <span style={{ color: 'var(--text-dim)' }}>Nothing to propose</span>
        const c = confidenceMeta(r.site_confidence)
        return (
          <span className="inline-flex items-center gap-2">
            <span style={{ color: 'var(--text-primary)' }}>{r.proposed_site}</span>
            <Pill tone={c.tone} title={c.note}>{c.label} {pct(r.site_share)}</Pill>
          </span>
        )
      },
    },
    {
      key: 'region',
      header: 'Region',
      render: (r) => {
        // A mapped or named plant takes its region from the site register, so
        // the answer lives in Site Management, not in a second field here.
        if (r.resolved_by) {
          const reg = regionOf(r.resolved_site)
          if (reg) return <span style={{ color: 'var(--text-primary)' }}>{reg}</span>
          return <span style={{ color: 'var(--text-dim)' }}>Set in Site Management</span>
        }
        if (!r.proposed_region) return <span style={{ color: 'var(--text-dim)' }}>Not known</span>
        const c = confidenceMeta(r.region_confidence)
        return (
          <span className="inline-flex items-center gap-2">
            <span style={{ color: 'var(--text-primary)' }}>{r.proposed_region}</span>
            <Pill tone={c.tone} title={c.note}>{c.label} {pct(r.region_share)}</Pill>
          </span>
        )
      },
    },
    {
      key: 'why',
      header: 'Why',
      render: (r) => (
        <div className="min-w-0">
          <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
            {r.keywords.length ? r.keywords.join(', ') : 'No keyword matched'}
          </div>
          {r.runner_up && (
            <div className="text-xs" style={{ color: 'var(--text-dim)' }}>Runner up: {r.runner_up}</div>
          )}
        </div>
      ),
    },
    {
      key: 'act',
      header: 'Decide',
      render: (r) => (
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="btn-secondary text-xs" onClick={() => setEvidenceOf(r)}>
            Evidence
          </button>
          {r.status === 'proposed' && r.proposed_site && (
            <button type="button" className="btn-secondary text-xs" disabled={writing}
                    onClick={() => acceptStation(r)}>
              Accept
            </button>
          )}
          {r.status === 'proposed' && r.proposed_region && (
            <button type="button" className="btn-secondary text-xs" disabled={writing}
                    onClick={() => acceptRegionOnly(r)}
                    title="Take the region and leave the plant undecided">
              Region only
            </button>
          )}
          <select
            value={manual[r.station] ?? ''}
            onChange={(e) => {
              const site = e.target.value
              setManual((m) => ({ ...m, [r.station]: site }))
              if (site) setByHand(r.station, site)
            }}
            disabled={!siteOptions.length || writing}
            className="min-w-[150px] rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs"
            style={FILTER_STYLE}
          >
            <option value="">{r.resolved_site ? 'Change site...' : 'Set by hand...'}</option>
            {siteOptions.map((s) => (
              <option key={s.name} value={s.name}>{s.region ? `${s.name} (${s.region})` : s.name}</option>
            ))}
          </select>
        </div>
      ),
    },
  ]

  return (
    <section className="card mt-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2"
              style={{ color: 'var(--text-secondary)' }}>
            <Factory size={15} /> Which plant is at which site
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            The production file names a batching plant by number. The system reads the project names
            behind each plant and proposes where it stands, with the evidence beside it. The plant and
            the region are two separate judgements: for several plants the region is certain while the
            plant itself is not, and cost per m3 is cut by region, so taking the region alone is a real
            answer. Nothing is written until you have seen how much production would move.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={country} onChange={(e) => setCountry(e.target.value)}
                  className={FILTER_CLASS} style={FILTER_STYLE}>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" onClick={() => setShowKeywords(true)}
                  className="btn-secondary text-xs inline-flex items-center gap-1">
            <Tags size={13} /> Keywords
          </button>
          <button type="button" onClick={exportReview} disabled={!rows.length}
                  className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50">
            <Download size={13} /> Excel
          </button>
          <button type="button" onClick={load} disabled={loading}
                  className="btn-secondary text-xs inline-flex items-center gap-1">
            <RefreshCcw size={13} /> {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-3 text-sm rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap"
           style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <AlertTriangle size={14} /> {error}
          <button type="button" onClick={load} className="btn-secondary text-xs">Retry</button>
        </p>
      )}
      {notice && (
        <p className="mb-3 text-sm rounded-lg px-3 py-2"
           style={{ background: 'var(--panel-2)', color: 'var(--text-primary)' }}>{notice}</p>
      )}

      {/* We could not look is not the same as there is nothing to look at. */}
      {!loading && !proposal.ok && (
        <p className="mb-3 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
           style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--text-primary)' }}>
          <AlertTriangle size={14} />
          {proposal.reason === 'forbidden'
            ? 'You do not have permission to read the plant proposal.'
            : 'The plant proposal could not be produced for this country.'}
          <button type="button" onClick={load} className="btn-secondary text-xs">Retry</button>
        </p>
      )}

      {!loading && !siteOptions.length && (
        <p className="mb-3 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
           style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--text-primary)' }}>
          <AlertTriangle size={14} />
          No sites are registered for {country}. Add them in Site Management first, because that is
          where the site list and its region come from.
        </p>
      )}

      {/* Coverage headline: the number the whole exercise was for. */}
      <div className="mb-4">
        <CostM3Table
          title="Coverage"
          columns={MEASURE_COLUMNS}
          rows={summaryRows}
          rowKey="key"
          loading={loading}
          dense
          empty={proposal.ok ? `No production recorded for ${country} yet.` : 'Coverage could not be measured.'}
        />
      </div>

      {/* The questions the data cannot settle. */}
      {!loading && questions.length > 0 && (
        <div className="mb-4 rounded-lg border border-[var(--border-subtle)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2 mb-2"
              style={{ color: 'var(--text-muted)' }}>
            <HelpCircle size={13} /> Needs your decision
          </h3>
          <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
            These plants are certainly at this place and in this region. Which gate or plateau each one
            is cannot be read from the loads, because the plants there serve the same projects and the
            same customers. Only you know.
          </p>
          <ul className="space-y-2">
            {questions.map((q) => (
              <li key={q.station} className="flex items-center justify-between gap-3 flex-wrap text-sm">
                <span style={{ color: 'var(--text-primary)' }}>
                  {q.question}{' '}
                  <span style={{ color: 'var(--text-dim)' }}>({int(q.m3)} approved m3)</span>
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" className="btn-secondary text-xs" disabled={writing}
                          onClick={() => setByHand(q.station, q.leader)}>
                    {q.leader}
                  </button>
                  <button type="button" className="btn-secondary text-xs" disabled={writing}
                          onClick={() => setByHand(q.station, q.runnerUp)}>
                    {q.runnerUp}
                  </button>
                  {q.region && (
                    <button
                      type="button" className="btn-secondary text-xs" disabled={writing}
                      title="Take the region now and leave the plant for later"
                      onClick={() => stage(
                        [{ station: q.station, site: null, region: q.region, confidence: q.regionConfidence, evidence: q.question }],
                        `Station ${q.station} region only`,
                      )}
                    >
                      {q.region} only
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Accept in bulk, by how sure each half is. */}
      {!loading && summary.proposed > 0 && (
        <div className="mb-4 rounded-lg border border-[var(--border-subtle)] p-3 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
              Accept a plant when it is at least
            </label>
            <select value={bulk.site} onChange={(e) => setBulk((b) => ({ ...b, site: e.target.value }))}
                    className={FILTER_CLASS} style={FILTER_STYLE}>
              {CONFIDENCE_ORDER.filter((k) => k !== 'none').map((k) => (
                <option key={k} value={k}>{confidenceMeta(k).label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
              Accept a region when it is at least
            </label>
            <select value={bulk.region} onChange={(e) => setBulk((b) => ({ ...b, region: e.target.value }))}
                    className={FILTER_CLASS} style={FILTER_STYLE}>
              {CONFIDENCE_ORDER.filter((k) => k !== 'none').map((k) => (
                <option key={k} value={k}>{confidenceMeta(k).label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50"
            disabled={!plan.length || writing}
            onClick={() => stage(plan, `${plan.length} plant ${plan.length === 1 ? 'mapping' : 'mappings'}`)}
          >
            <ListChecks size={13} />
            {plan.length
              ? `Preview ${plan.length} ${plan.length === 1 ? 'plant' : 'plants'}`
              : 'Nothing clears those bars'}
          </button>
          <p className="text-xs basis-full" style={{ color: 'var(--text-dim)' }}>
            {plan.filter((p) => !p.site).length > 0
              ? `${plan.filter((p) => !p.site).length} of these take the region only, because the plant itself is not certain.`
              : 'Each half is judged on its own bar, so a certain region can be taken while the plant waits.'}
          </p>
        </div>
      )}

      {/* Filters. */}
      <div className="flex items-end gap-2 flex-wrap mb-3">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
          <input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Plant, site, keyword or project"
            className={`${FILTER_CLASS} pl-7 min-w-[230px]`}
            style={FILTER_STYLE}
          />
        </div>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                className={FILTER_CLASS} style={FILTER_STYLE}>
          <option value="">Any status</option>
          {STATION_STATUS_ORDER.map((k) => (
            <option key={k} value={k}>{stationStatusMeta(k).label}</option>
          ))}
        </select>
        <select value={filters.confidence} onChange={(e) => setFilters((f) => ({ ...f, confidence: e.target.value }))}
                className={FILTER_CLASS} style={FILTER_STYLE}>
          <option value="">Any confidence</option>
          {CONFIDENCE_ORDER.map((k) => (
            <option key={k} value={k}>{confidenceMeta(k).label}</option>
          ))}
        </select>
        <select value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))}
                className={FILTER_CLASS} style={FILTER_STYLE}>
          <option value="">Any region</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <label className="text-xs inline-flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={filters.unmappedOnly}
                 onChange={(e) => setFilters((f) => ({ ...f, unmappedOnly: e.target.checked }))} />
          Only plants with no answer yet
        </label>
      </div>

      <CostM3Table
        columns={columns}
        rows={rows}
        rowKey="station"
        loading={loading}
        alignTop
        empty={
          !proposal.ok ? 'The proposal could not be read, so there is nothing to review.'
            : stations.length ? 'No plant matches these filters.'
              : `No production recorded for ${country} yet.`
        }
        footnote={
          stations.length && rows.length !== stations.length
            ? `Showing ${rows.length} of ${stations.length} plants.`
            : undefined
        }
      />

      <EvidenceModal
        station={evidenceOf}
        onClose={() => setEvidenceOf(null)}
        regionOf={regionOf}
      />

      <ConfirmModal
        pending={pending}
        writing={writing}
        impact={impact}
        onCancel={() => setPending(null)}
        onConfirm={commit}
      />

      <KeywordModal
        open={showKeywords}
        onClose={() => setShowKeywords(false)}
        country={country}
        rows={keywords}
        siteOptions={siteOptions}
        regions={regions}
        onChanged={load}
      />
    </section>
  )
}

/**
 * The machine's reasoning, in full. A person must be able to CHECK it rather
 * than trust it, so the real project names are here beside the scores.
 */
function EvidenceModal({ station, onClose, regionOf }) {
  if (!station) return null
  const s = station
  const siteC = confidenceMeta(s.site_confidence)
  const regionC = confidenceMeta(s.region_confidence)
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Plant ${s.station}`}
      subtitle={`${int(s.loads)} loads, ${int(s.m3)} approved m3, ${int(s.with_project)} of them naming a project`}
    >
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border-subtle)] p-3">
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Plant it stands at</div>
            <div style={{ color: 'var(--text-primary)' }}>{s.proposed_site || 'Nothing to propose'}</div>
            <div className="mt-1 flex items-center gap-2">
              <Pill tone={siteC.tone}>{siteC.label}</Pill>
              <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
                {pct(s.site_share)} of matched evidence
              </span>
            </div>
            {s.runner_up && (
              <div className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>Runner up: {s.runner_up}</div>
            )}
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] p-3">
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Region</div>
            <div style={{ color: 'var(--text-primary)' }}>
              {s.resolved_by ? (regionOf(s.resolved_site) || 'Set in Site Management')
                : (s.proposed_region || 'Not known')}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Pill tone={regionC.tone}>{regionC.label}</Pill>
              <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
                {pct(s.region_share)} of matched evidence
              </span>
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
              Cost per m3 is cut by region, so this is the half that matters most.
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
            Candidates
          </h4>
          {s.candidates.length ? (
            <div className="space-y-2">
              {s.candidates.map((c, i) => (
                <div key={`${c.site}-${i}`} className="rounded-lg border border-[var(--border-subtle)] p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{c.site || 'Unnamed'}</span>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      score {c.score == null ? 'N/A' : c.score} | {pct(c.share)} | {int(c.matched_m3)} m3
                    </span>
                  </div>
                  {c.keywords.length > 0 && (
                    <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Matched on: {c.keywords.join(', ')}
                    </div>
                  )}
                  {c.evidence.length ? (
                    <ul className="mt-1 text-xs list-disc pl-5" style={{ color: 'var(--text-dim)' }}>
                      {c.evidence.map((e, j) => <li key={j}>{e}</li>)}
                    </ul>
                  ) : (
                    <div className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
                      No project name recorded behind this candidate.
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              No project name behind these loads named a place, so there is nothing to weigh. Add a
              keyword for a project this plant serves, then propose again.
            </p>
          )}
        </div>

        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{evidenceNote(s)}</p>
      </div>
    </Modal>
  )
}

/** Nothing is written until this has said how much production moves. */
function ConfirmModal({ pending, writing, impact, onCancel, onConfirm }) {
  if (!pending) return null
  const wouldMove = Array.isArray(pending.preview?.would_move) ? pending.preview.would_move : []
  const regionOnly = pending.entries.filter((e) => !e.site)
  return (
    <Modal
      open
      onClose={onCancel}
      size="lg"
      title="Check before it is written"
      subtitle={pending.label}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onCancel} disabled={writing}>Cancel</button>
          <button type="button" className="btn-primary text-sm disabled:opacity-50" onClick={onConfirm} disabled={writing}>
            {writing ? 'Writing...' : 'Write the mapping'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4 text-sm">
        <p style={{ color: 'var(--text-secondary)' }}>
          This is a check only. Nothing has been changed yet.
        </p>

        <CostM3Table
          title="Production that would move"
          columns={[
            { key: 'region', header: 'Region' },
            { key: 'loads', header: 'Loads', align: 'right', render: (r) => int(r.loads) },
            { key: 'm3', header: 'Approved M3', align: 'right', render: (r) => int(r.approved_m3) },
          ]}
          rows={wouldMove}
          rowKey={(r, i) => r.region || i}
          dense
          empty="The check reported no production moving. The mapping would still be saved for future uploads."
        />

        <CostM3Table
          title="What will be written"
          columns={[
            { key: 'station', header: 'Plant' },
            { key: 'site', header: 'Site', render: (r) => r.site || 'Left undecided' },
            { key: 'region', header: 'Region', render: (r) => r.region || 'Not set' },
            { key: 'confidence', header: 'Confidence', render: (r) => confidenceMeta(r.confidence).label },
          ]}
          rows={pending.entries}
          rowKey="station"
          dense
          empty="Nothing selected."
        />

        {regionOnly.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
            {regionOnly.length} of these record the region only. The plant stays undecided on purpose,
            because the loads cannot say which one it is, and guessing would put real money behind a
            name nobody chose.
          </p>
        )}

        {impact.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
            Across every open proposal: {impact.map((r) => `${r.region} ${int(r.m3)} m3`).join(', ')}.
          </p>
        )}
      </div>
    </Modal>
  )
}

/**
 * The keywords are the mapping. Adding one and proposing again is how a new
 * plant or a new project gets placed, with no developer involved.
 */
function KeywordModal({ open, onClose, country, rows, siteOptions, regions, onChanged }) {
  const blank = { keyword: '', target: 'site', site: '', region: '', weight: 1, note: '' }
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { if (open) { setForm(blank); setErr('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true); setErr('')
    try {
      await upsertSiteKeyword({
        country,
        keyword: form.keyword,
        site: form.target === 'site' ? form.site : null,
        region: form.target === 'region' ? form.region : null,
        weight: form.weight,
        note: form.note,
        source: 'manual',
      })
      setForm(blank)
      onChanged?.()
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  async function toggle(row) {
    setBusy(true); setErr('')
    try { await upsertSiteKeyword({ ...row, active: !row.active }); onChanged?.() }
    catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  async function remove(row) {
    setBusy(true); setErr('')
    try { await deleteSiteKeyword(row.id); onChanged?.() }
    catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  const canSave = form.keyword.trim() && (form.target === 'site' ? form.site : form.region)

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Words that place a plant"
           subtitle={`${country}: what the matcher looks for in a project name`}>
      <div className="space-y-4 text-sm">
        <p style={{ color: 'var(--text-secondary)' }}>
          The matcher reads the project names behind each plant and looks for these words. A keyword
          either names a plant or names an area, never both. Add one here, then press Refresh on the
          panel to propose again: that is how a new plant or a new project gets placed, without waiting
          for a developer.
        </p>

        {err && (
          <p className="text-sm rounded-lg px-3 py-2 flex items-center gap-2"
             style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
            <AlertTriangle size={14} /> {err}
          </p>
        )}

        <div className="rounded-lg border border-[var(--border-subtle)] p-3 grid gap-2 sm:grid-cols-5 items-end">
          <div className="sm:col-span-2">
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Word in the project name</label>
            <input value={form.keyword} onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
                   placeholder="diriyah" className={`${FILTER_CLASS} w-full`} style={FILTER_STYLE} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Places it in a</label>
            <select value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                    className={`${FILTER_CLASS} w-full`} style={FILTER_STYLE}>
              <option value="site">Site</option>
              <option value="region">Region</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
              {form.target === 'site' ? 'Site' : 'Region'}
            </label>
            {form.target === 'site' ? (
              <select value={form.site} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))}
                      className={`${FILTER_CLASS} w-full`} style={FILTER_STYLE}>
                <option value="">Pick a site...</option>
                {siteOptions.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            ) : (
              <input value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value.toUpperCase() }))}
                     list="tp-station-regions" placeholder="CENTRAL"
                     className={`${FILTER_CLASS} w-full`} style={FILTER_STYLE} />
            )}
            <datalist id="tp-station-regions">
              {regions.map((r) => <option key={r} value={r} />)}
            </datalist>
          </div>
          <button type="button" className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50"
                  disabled={!canSave || busy} onClick={save}>
            <Plus size={13} /> Add
          </button>
        </div>

        <CostM3Table
          title="Keywords in use"
          columns={[
            { key: 'keyword', header: 'Word' },
            { key: 'target', header: 'Places it in', render: (r) => r.site || r.region || 'N/A' },
            { key: 'kind', header: 'Kind', render: (r) => (r.site ? 'Site' : 'Region') },
            { key: 'weight', header: 'Weight', align: 'right', render: (r) => int(r.weight) },
            { key: 'source', header: 'Source', render: (r) => r.source || 'N/A' },
            {
              key: 'active',
              header: 'Active',
              render: (r) => (
                <Pill tone={r.active ? 'good' : 'quiet'}>{r.active ? 'On' : 'Off'}</Pill>
              ),
            },
            {
              key: 'act',
              header: '',
              render: (r) => (
                <div className="flex items-center gap-2">
                  <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => toggle(r)}>
                    {r.active ? 'Turn off' : 'Turn on'}
                  </button>
                  <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => remove(r)}
                          aria-label={`Delete keyword ${r.keyword}`}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ),
            },
          ]}
          rows={rows}
          rowKey="id"
          dense
          empty={`No keywords are recorded for ${country} yet.`}
        />
      </div>
    </Modal>
  )
}
