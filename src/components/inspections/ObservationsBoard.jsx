/**
 * Observations board - the "Observations" module of the Inspections workspace.
 *
 * Lists every observation the loaded inspections carry (tyres recorded as
 * anything other than Good, inspector findings and notes, Site Observation
 * records), with search, kind and severity filters, an Excel export, and the
 * same actions as the queue: open the inspection, or raise a corrective action.
 *
 * It reads the rows the page already loaded and the page filters (dates, site)
 * already applied. Nothing is fetched here.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare, AlertTriangle, Truck, Wrench, Search, Download, Plus, Eye, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Card, Kpi, Tabs, Pager, fmtInt } from '../commandCenter/kit'
import {
  observationRegister, filterObservations, observationSummary, OBSERVATION_KINDS, observationOptions, observationLabel, groupObservationsByInspection,
} from '../../lib/inspectionWorkspaceView'
import { exportToExcel } from '../../lib/exportUtils'
import { listFitmentsForAssets } from '../../lib/api/tyreChangeTracking'
import { withTyreNow, tyreNowSummary, matchesTyreNow, TYRE_NOW_META } from '../../lib/observationTracking'
import ObservationDetail from './ObservationDetail'
import { listActionsForInspectionIds } from '../../lib/api/correctiveActions'
import { toUserMessage } from '../../lib/safeError'
import MultiSelectFilter from '../ui/MultiSelectFilter'
import { selectionMatches, isSelectionActive } from '../../lib/filterSelection'

const PAGE = 15
const SEVERITIES = ['all', 'Critical', 'High', 'Medium', 'Minor', 'Low', 'Note', 'Not rated']
const KIND_LABEL = Object.fromEntries(OBSERVATION_KINDS.map((k) => [k.key, k.label]))

const fmtDay = (d) => {
  if (!d) return 'N/A'
  const x = new Date(`${d}T00:00:00`)
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function ObservationsBoard({
  rows, loading, error, onBack, onOpen, onRaiseAction, onAddObservation, country, regionOf,
}) {
  const [kind, setKind] = useState('all')
  // Multi-select filters hold an array; [] means no narrowing.
  const [severity, setSeverity] = useState([])
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [exportError, setExportError] = useState('')
  // Default hides findings the tyre change history shows were already dealt with.
  const [tyreNow, setTyreNow] = useState('not_replaced')
  const [region, setRegion] = useState([])
  const [site, setSite] = useState([])
  const [asset, setAsset] = useState([])
  const [inspector, setInspector] = useState([])
  const [action, setAction] = useState('all')
  const [observation, setObservation] = useState([])
  const [detail, setDetail] = useState(null) // inspection ID
  // Fitment records for the vehicles these observations name. null while loading
  // or unreadable, so no row is given a status it was not checked for.
  const [fitments, setFitments] = useState(null)
  const [fitError, setFitError] = useState('')
  const [actionRows, setActionRows] = useState(null)
  const [actionError, setActionError] = useState('')

  const base = useMemo(() => observationRegister(rows), [rows])
  const inspectionKey = useMemo(() => [...new Set(base.map((o) => o.inspectionId).filter(Boolean))].sort().join('|'), [base])
  useEffect(() => {
    let alive = true
    setActionRows(null); setActionError('')
    const ids = inspectionKey ? inspectionKey.split('|') : []
    listActionsForInspectionIds(ids)
      .then((actions) => { if (alive) setActionRows(actions) })
      .catch(() => { if (alive) setActionError('Corrective action status could not be verified. Please retry before creating another action.') })
    return () => { alive = false }
  }, [inspectionKey])
  const assetKey = useMemo(
    () => [...new Set(base.filter((o) => o.kind === 'tyre').map((o) => o.asset_no).filter(Boolean))].sort().join('|'),
    [base],
  )
  useEffect(() => {
    let alive = true
    setFitments(null); setFitError('')
    const assets = assetKey ? assetKey.split('|') : []
    if (!assets.length) { setFitments([]); return undefined }
    listFitmentsForAssets(assets, { country: country && country !== 'All' ? country : undefined })
      .then((res) => {
        if (!alive) return
        if (res.ok) setFitments(res.rows)
        else setFitError(res.reason || 'Could not read the tyre change records.')
      })
      .catch(() => { if (alive) setFitError('Could not read the tyre change records.') })
    return () => { alive = false }
  }, [assetKey, country])
  const all = useMemo(() => {
    const byFinding = new Map()
    for (const a of actionRows || []) {
      const key = `${a.source_id}:${a.source_detail}`
      if (!byFinding.has(key)) byFinding.set(key, a)
    }
    return withTyreNow(base, fitments).map((obs) => {
      const detailKey = obs.kind === 'tyre' ? `damage:${obs.rawPosition}` : 'general'
      const actionRecord = actionRows == null ? null : byFinding.get(`${obs.inspectionId}:${detailKey}`) || null
      return { ...obs, actionRaised: !!actionRecord, actionRecord }
    })
  }, [base, fitments, actionRows])
  const actionsReady = actionRows != null && !actionError
  // Region lives on the site register, so it is looked up from the site; a site
  // the register does not place has no region and never matches a region pick.
  const regionFor = (siteName) => (regionOf && siteName ? regionOf(siteName) || '' : '')
  const summary = useMemo(() => observationSummary(all), [all])
  const nowSummary = useMemo(() => tyreNowSummary(all), [all])
  const settled = useMemo(() => {
    const by = new Map()
    for (const o of all) {
      if (o.kind !== 'tyre') continue
      const prev = by.get(o.inspectionId)
      const done = o.tyreNow?.state === 'replaced'
      by.set(o.inspectionId, prev === undefined ? done : prev && done)
    }
    return new Set([...by].filter(([, done]) => done).map(([id]) => id))
  }, [all])
  const list = useMemo(
    () => filterObservations(all, { q, kind })
      .filter((o) => matchesTyreNow(o, tyreNow))
      // A note on an inspection whose tyre findings were ALL replaced is about
      // work already done, so it leaves the default view with them.
      .filter((o) => !(tyreNow === 'not_replaced' && o.kind === 'note' && settled.has(o.inspectionId)))
      .filter((o) => selectionMatches(observation, observationLabel(o))
        && selectionMatches(severity, o.severity)
        && selectionMatches(region, regionFor(o.site))
        && selectionMatches(site, o.site)
        && selectionMatches(asset, o.asset_no)
        && selectionMatches(inspector, o.inspector)
        && (action === 'all' || (o.kind !== 'note' && (action === 'raised' ? o.actionRaised : !o.actionRaised)))),
    [all, settled, q, kind, severity, observation, tyreNow, region, site, asset, inspector, action], // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => { setPage(0) }, [q, kind, severity, observation, tyreNow, region, site, asset, inspector, action, rows])
  const regionOptions = useMemo(
    () => [...new Set(all.map((o) => regionFor(o.site)).filter(Boolean))].sort(),
    [all, regionOf], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const optionsOf = (key) => [...new Set(all.map((o) => o[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
  const siteOptions = useMemo(() => optionsOf('site'), [all]) // eslint-disable-line react-hooks/exhaustive-deps
  const assetOptions = useMemo(() => optionsOf('asset_no'), [all]) // eslint-disable-line react-hooks/exhaustive-deps
  const inspectorOptions = useMemo(() => optionsOf('inspector'), [all]) // eslint-disable-line react-hooks/exhaustive-deps
  const observationList = useMemo(() => observationOptions(all), [all])
  const filtersOn = q || kind !== 'all' || tyreNow !== 'not_replaced' || action !== 'all'
    || [severity, observation, region, site, asset, inspector].some(isSelectionActive)
  const clearFilters = () => {
    setQ(''); setKind('all'); setSeverity([]); setObservation([]); setTyreNow('not_replaced')
    setRegion([]); setSite([]); setAsset([]); setInspector([]); setAction('all')
  }

  const unreadable = !!error
  const show = (v) => (unreadable ? 'N/A' : fmtInt(v))
  const grouped = useMemo(() => groupObservationsByInspection(list), [list])
  const pageRows = grouped.slice(page * PAGE, page * PAGE + PAGE)
  const severities = SEVERITIES.filter((s) => s !== 'all' && all.some((o) => o.severity === s))

  async function exportExcel() {
    setExportError('')
    try {
      const r = (o) => o.tyreNow?.replacement || {}
      const p = (o) => o.tyreNow?.previous || {}
      await exportToExcel(
        list.map((o) => ({
          day: o.day, kind: KIND_LABEL[o.kind], asset_no: o.asset_no, site: o.site,
          position: o.position, text: o.text, remarks: o.remarks, severity: o.severity,
          pressure: o.pressure ?? '', tread: o.tread ?? '', inspector: o.inspector,
          tyre_now: o.tyreNow ? TYRE_NOW_META[o.tyreNow.state].label : '',
          old_serial: p(o).serial || '', old_brand: p(o).brand || '', old_fitted: p(o).fittedOn || '', old_job_card: p(o).jobCard || '',
          new_serial: r(o).serial || '', new_brand: r(o).brand || '', new_size: r(o).size || '',
          replaced_on: r(o).fittedOn || '', job_card: r(o).jobCard || '',
          days_to_replace: o.tyreNow?.daysToReplace ?? '', removed_on: o.tyreNow?.removedOn || '',
          not_known_reason: o.tyreNow?.state === 'unknown' ? (o.tyreNow.reason || '') : '',
          action: o.kind === 'note' ? '' : o.actionRaised ? 'Raised' : 'Not raised',
        })),
        ['day', 'kind', 'asset_no', 'site', 'position', 'text', 'remarks', 'severity', 'pressure', 'tread', 'inspector',
          'tyre_now', 'old_serial', 'old_brand', 'old_fitted', 'old_job_card',
          'new_serial', 'new_brand', 'new_size', 'replaced_on', 'job_card', 'days_to_replace', 'removed_on', 'not_known_reason', 'action'],
        ['Inspection date', 'Type', 'Asset', 'Site', 'Position', 'Observation', 'Remarks', 'Severity', 'Pressure (PSI)', 'Tread (mm)', 'Inspector',
          'Tyre now', 'Tyre at inspection: serial', 'Tyre at inspection: brand', 'Tyre at inspection: fitted on', 'Tyre at inspection: job card',
          'New tyre: serial', 'New tyre: brand', 'New tyre: size', 'Replaced on', 'Replacement job card', 'Days to replace', 'Removed on', 'Why not known', 'Corrective action'],
        'TyrePulse Observations',
        'Observations',
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  return (
    <div className="iw-obsboard">
      <div className="iw-kpis iw-kpis-obs">
        <Kpi icon={MessageSquare} tone="t-blue" display={show(summary.total)} label="Observations" loading={loading}
          title={unreadable ? undefined : `${fmtInt(summary.tyre)} tyre findings, ${fmtInt(summary.note)} notes, ${fmtInt(summary.observation)} site observations`} />
        <Kpi icon={AlertTriangle} tone="t-red" display={show(summary.critical)} label="Critical or high" loading={loading}
          danger={!unreadable && summary.critical > 0} />
        <Kpi icon={Truck} tone="t-amber" display={show(summary.vehicles)} label="Vehicles with observations" loading={loading} />
        <Kpi icon={CheckCircle2} tone="t-green" display={unreadable || fitError ? 'N/A' : fitments == null ? '...' : fmtInt(nowSummary.replaced)}
          label="Tyres already replaced" loading={loading} onClick={() => setTyreNow('replaced')}
          title="A different tyre was fitted on the same wheel after the inspection, per the tyre change records" />
        <Kpi icon={Wrench} tone="t-amber" display={unreadable || fitError ? 'N/A' : fitments == null ? '...' : fmtInt(nowSummary.open)}
          label="Still open" loading={loading} onClick={() => setTyreNow('open')}
          title={unreadable ? undefined : `Tyre findings where the same tyre is still fitted or no change record covers the wheel. ${fmtInt(summary.withAction)} inspections have an action.`} />
      </div>

      <Card
        title={`Observations (${unreadable ? 'N/A' : fmtInt(grouped.length)} inspections, ${fmtInt(list.length)} findings)`}
        sub="Tyres recorded as anything other than Good, inspector findings and notes, and site observations, over the dates and site above."
        action={(
          <span className="iw-actions">
            {onBack && (
              <button type="button" className="cc-btn-ghost iw-inline" onClick={onBack}>
                <ArrowLeft size={12} aria-hidden="true" /> Inspections
              </button>
            )}
            {onAddObservation && (
              <button type="button" className="cc-btn iw-inline" onClick={onAddObservation}>
                <Plus size={12} aria-hidden="true" /> Add Observation
              </button>
            )}
            <button type="button" className="cc-btn iw-inline" onClick={exportExcel} disabled={!list.length}>
              <Download size={12} aria-hidden="true" /> Excel
            </button>
          </span>
        )}
      >
        <div className="iw-obs-tools">
          <div className="cc-search iw-search">
            <Search size={15} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search vehicle, site, inspector, text, tyre serial, job card..." aria-label="Search observations" />
          </div>
          <MultiSelectFilter className="iw-ms" label="Observation" allLabel="All observations" pluralLabel="observations"
            options={observationList.map((o) => ({ value: o.label, label: `${o.label} (${o.count})` }))}
            value={observation} onChange={setObservation} />
          <MultiSelectFilter className="iw-ms" label="Severity" allLabel="All severities" pluralLabel="severities"
            options={severities} value={severity} onChange={setSeverity} />
          <label className="iw-obs-sev">
            <span>Tyre now</span>
            <select className="cc-select" value={tyreNow} onChange={(e) => setTyreNow(e.target.value)} aria-label="Filter by whether the tyre was replaced">
              <option value="not_replaced">Not replaced yet</option>
              <option value="all">Any, including replaced</option>
              <option value="open">Still open</option>
              {Object.entries(TYRE_NOW_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </label>
          {regionOptions.length > 0 && (
            <MultiSelectFilter className="iw-ms" label="Region" allLabel="All regions" pluralLabel="regions"
              options={regionOptions} value={region} onChange={setRegion} />
          )}
          <MultiSelectFilter className="iw-ms" label="Site" allLabel="All sites" pluralLabel="sites"
            options={siteOptions} value={site} onChange={setSite} />
          <MultiSelectFilter className="iw-ms" label="Vehicle" allLabel="All vehicles" pluralLabel="vehicles"
            options={assetOptions} value={asset} onChange={setAsset} />
          <MultiSelectFilter className="iw-ms" label="Inspector" allLabel="All inspectors" pluralLabel="inspectors"
            options={inspectorOptions} value={inspector} onChange={setInspector} />
          <label className="iw-obs-sev">
            <span>Action</span>
            <select className="cc-select" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by corrective action">
              <option value="all">Any</option>
              <option value="raised">Action raised</option>
              <option value="none">No action yet</option>
            </select>
          </label>
          {filtersOn && (
            <button type="button" className="cc-btn-ghost iw-inline" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
        {tyreNow === 'not_replaced' && nowSummary.replaced > 0 && (
          <p className="iw-od-muted" role="status">
            {fmtInt(nowSummary.replaced)} {nowSummary.replaced === 1 ? 'finding is' : 'findings are'} hidden because the tyre change history shows the tyre was already replaced.{' '}
            <button type="button" className="cc-link cc-link-btn" onClick={() => setTyreNow('replaced')}>Show them</button>
          </p>
        )}
        {fitError && <p className="iw-od-muted" role="status">Could not read the tyre change records, so no finding shows whether it was replaced. {fitError}</p>}
        <Tabs label="Observation type" value={kind} onChange={setKind} tabs={[
          { key: 'all', label: 'All', count: unreadable ? null : all.length },
          ...OBSERVATION_KINDS.map((k) => ({ key: k.key, label: k.label, count: unreadable ? null : summary[k.key] })),
        ]} />

        {exportError && <div className="cc-card iw-error" role="alert"><span>{exportError}</span></div>}

        {loading && !rows?.length ? (
          <div className="iw-skel">{Array.from({ length: 6 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 44 }} />)}</div>
        ) : unreadable ? (
          <div className="cc-empty">Could not read the inspections, so no observation can be listed.</div>
        ) : !all.length ? (
          <div className="cc-empty">
            No observation in these inspections: every tyre was recorded as Good and no finding or note was written.
            {onAddObservation ? ' Use Add Observation to record one.' : ''}
          </div>
        ) : !pageRows.length ? (
          <div className="cc-empty">No observation matches these filters.</div>
        ) : (
          <div className="iw-obs-table" role="table" aria-label="Observations">
            <div className="iw-otr iw-oth" role="row">
              <span role="columnheader">Date</span>
              <span role="columnheader">Vehicle</span>
              <span role="columnheader">Observation</span>
              <span role="columnheader">Severity</span>
              <span role="columnheader">Tyre now</span>
              <span role="columnheader">Inspector</span>
              <span role="columnheader">Action</span>
            </div>
            {pageRows.map((o) => (
              <div key={o.key} className="iw-otr" role="row">
                <span role="cell" className="iw-o-day">{fmtDay(o.day)}</span>
                <span role="cell"><b>{o.asset_no || 'No asset'}</b><small>{o.site || 'No site'}</small></span>
                <span role="cell" className="iw-o-text">
                  <small className="iw-o-kind">{o.findings.length} findings in this inspection</small>
                  <b>{o.findings.filter((f) => f.kind === 'tyre').length} tyre finding(s)</b>
                  <small>{o.findings.map((f) => [f.position, f.text].filter(Boolean).join(': ')).join(' | ')}</small>
                </span>
                <span role="cell"><span className={`cc-pill ${o.findings.some((f) => f.tone === 'bad') ? 'bad' : o.tone}`}>{o.findings.some((f) => f.tone === 'bad') ? 'Critical' : o.severity}</span></span>
                <span role="cell">
                  {!o.findings.some((f) => f.kind === 'tyre') ? <span className="cc-na">-</span>
                    : !o.findings.find((f) => f.kind === 'tyre')?.tyreNow ? <small>{fitError ? 'N/A' : 'Checking...'}</small>
                      : (
                        <>
                          <small>{o.findings.filter((f) => f.kind === 'tyre' && f.tyreNow?.state === 'replaced').length} replaced / {o.findings.filter((f) => f.kind === 'tyre').length} reported</small>
                        </>
                      )}
                </span>
                <span role="cell">{o.inspector || 'N/A'}</span>
                <span role="cell" className="iw-o-acts">
                  <button type="button" className="cc-btn-ghost iw-inline" onClick={() => setDetail(o.inspectionId)}>
                    <Eye size={12} aria-hidden="true" /> Open
                  </button>
                  {!actionsReady
                    ? <small role="status">{actionError ? 'Action status unavailable' : 'Checking actions...'}</small>
                    : <>
                      <small>{o.findings.filter((f) => f.actionRaised).length} / {o.findings.filter((f) => f.kind !== 'note').length} actions raised</small>
                      {o.findings.some((f) => f.kind === 'tyre' && !f.actionRaised && f.tyreNow?.state !== 'replaced') && onRaiseAction && (
                        <button type="button" className="cc-btn iw-inline" onClick={() => onRaiseAction(o.row)}>Create actions</button>
                      )}
                    </>}
                </span>
              </div>
            ))}
          </div>
        )}
        {actionError && <p role="alert" className="text-sm text-red-500 mt-3">{actionError}</p>}
        {grouped.length > PAGE && <Pager page={page} pageSize={PAGE} total={grouped.length} onPage={setPage} noun="inspections" />}
      </Card>
      {detail && (
        <ObservationDetail
          observations={all.filter((o) => o.inspectionId === detail)}
          obs={all.find((o) => o.inspectionId === detail)}
          onClose={() => setDetail(null)}
          onOpenInspection={(r) => { setDetail(null); onOpen(r) }}
          onRaiseAction={actionsReady && onRaiseAction ? (r, key) => { setDetail(null); onRaiseAction(r, key) } : null}
        />
      )}
    </div>
  )
}
