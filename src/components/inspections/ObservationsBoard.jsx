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
import { useLanguage } from '../../contexts/LanguageContext'
import { selectionMatches, isSelectionActive } from '../../lib/filterSelection'

const PAGE = 15
const SEVERITIES = ['all', 'Critical', 'High', 'Medium', 'Minor', 'Low', 'Note', 'Not rated']

const fmtDay = (d) => {
  if (!d) return 'N/A'
  const x = new Date(`${d}T00:00:00`)
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function ObservationsBoard({
  rows, loading, error, onBack, onOpen, onRaiseAction, onAddObservation, country, regionOf,
}) {
  const { t } = useLanguage()
  const p = (k, v) => t(`inspections.observations.${k}`, v)
  const kindLabel = (key) => t(`inspections.observations.kinds.${key}`)
  const nowLabel = (key) => t(`inspections.observations.tyreNowState.${key}`)
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
      .catch(() => { if (alive) setActionError(p('actionStatusError')) })
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
        else setFitError(res.reason || p('fitError'))
      })
      .catch(() => { if (alive) setFitError(p('fitError')) })
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
  const show = (v) => (unreadable ? p('na') : fmtInt(v))
  const grouped = useMemo(() => groupObservationsByInspection(list), [list])
  const pageRows = grouped.slice(page * PAGE, page * PAGE + PAGE)
  const severities = SEVERITIES.filter((s) => s !== 'all' && all.some((o) => o.severity === s))

  async function exportExcel() {
    setExportError('')
    try {
      const r = (o) => o.tyreNow?.replacement || {}
      const prev = (o) => o.tyreNow?.previous || {}
      await exportToExcel(
        list.map((o) => ({
          day: o.day, kind: kindLabel(o.kind), asset_no: o.asset_no, site: o.site,
          position: o.position, text: o.text, remarks: o.remarks, severity: o.severity,
          pressure: o.pressure ?? '', tread: o.tread ?? '', inspector: o.inspector,
          tyre_now: o.tyreNow ? nowLabel(o.tyreNow.state) : '',
          old_serial: prev(o).serial || '', old_brand: prev(o).brand || '', old_fitted: prev(o).fittedOn || '', old_job_card: prev(o).jobCard || '',
          new_serial: r(o).serial || '', new_brand: r(o).brand || '', new_size: r(o).size || '',
          replaced_on: r(o).fittedOn || '', job_card: r(o).jobCard || '',
          days_to_replace: o.tyreNow?.daysToReplace ?? '', removed_on: o.tyreNow?.removedOn || '',
          not_known_reason: o.tyreNow?.state === 'unknown' ? (o.tyreNow.reason || '') : '',
          action: o.kind === 'note' ? '' : o.actionRaised ? p('export.raised') : p('export.notRaised'),
        })),
        ['day', 'kind', 'asset_no', 'site', 'position', 'text', 'remarks', 'severity', 'pressure', 'tread', 'inspector',
          'tyre_now', 'old_serial', 'old_brand', 'old_fitted', 'old_job_card',
          'new_serial', 'new_brand', 'new_size', 'replaced_on', 'job_card', 'days_to_replace', 'removed_on', 'not_known_reason', 'action'],
        [p('export.date'), p('export.type'), p('export.asset'), p('export.site'), p('export.position'), p('export.observation'), p('export.remarks'), p('export.severity'), p('export.pressure'), p('export.tread'), p('export.inspector'),
          p('export.tyreNow'), p('export.oldSerial'), p('export.oldBrand'), p('export.oldFitted'), p('export.oldJobCard'),
          p('export.newSerial'), p('export.newBrand'), p('export.newSize'), p('export.replacedOn'), p('export.replacementJobCard'), p('export.daysToReplace'), p('export.removedOn'), p('export.whyNotKnown'), p('export.correctiveAction')],
        'TyrePulse Observations',
        'Observations',
      )
    } catch (e) {
      setExportError(toUserMessage(e, p('exportError')))
    }
  }

  return (
    <div className="iw-obsboard">
      <div className="iw-kpis iw-kpis-obs">
        <Kpi icon={MessageSquare} tone="t-blue" display={show(summary.total)} label={p('kpi.observations')} loading={loading}
          title={unreadable ? undefined : p('kpi.observationsHint', { tyre: fmtInt(summary.tyre), note: fmtInt(summary.note), observation: fmtInt(summary.observation) })} />
        <Kpi icon={AlertTriangle} tone="t-red" display={show(summary.critical)} label={p('kpi.critical')} loading={loading}
          danger={!unreadable && summary.critical > 0} />
        <Kpi icon={Truck} tone="t-amber" display={show(summary.vehicles)} label={p('kpi.vehicles')} loading={loading} />
        <Kpi icon={CheckCircle2} tone="t-green" display={unreadable || fitError ? p('na') : fitments == null ? '...' : fmtInt(nowSummary.replaced)}
          label={p('kpi.replaced')} loading={loading} onClick={() => setTyreNow('replaced')}
          title={p('kpi.replacedHint')} />
        <Kpi icon={Wrench} tone="t-amber" display={unreadable || fitError ? p('na') : fitments == null ? '...' : fmtInt(nowSummary.open)}
          label={p('kpi.open')} loading={loading} onClick={() => setTyreNow('open')}
          title={unreadable ? undefined : p('kpi.openHint', { count: fmtInt(summary.withAction) })} />
      </div>

      <Card
        title={p('card.title', { inspections: unreadable ? p('na') : fmtInt(grouped.length), findings: fmtInt(list.length) })}
        sub={p('card.sub')}
        action={(
          <span className="iw-actions">
            {onBack && (
              <button type="button" className="cc-btn-ghost iw-inline" onClick={onBack}>
                <ArrowLeft size={12} aria-hidden="true" /> {p('card.back')}
              </button>
            )}
            {onAddObservation && (
              <button type="button" className="cc-btn iw-inline" onClick={onAddObservation}>
                <Plus size={12} aria-hidden="true" /> {p('card.add')}
              </button>
            )}
            <button type="button" className="cc-btn iw-inline" onClick={exportExcel} disabled={!list.length}>
              <Download size={12} aria-hidden="true" /> {p('card.excel')}
            </button>
          </span>
        )}
      >
        <div className="iw-obs-tools">
          <div className="cc-search iw-search">
            <Search size={15} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={p('filters.searchPlaceholder')} aria-label={p('filters.searchAria')} />
          </div>
          <MultiSelectFilter className="iw-ms" label={p('filters.observation')} allLabel={p('filters.allObservations')} pluralLabel={p('filters.observationsPlural')}
            options={observationList.map((o) => ({ value: o.label, label: `${o.label} (${o.count})` }))}
            value={observation} onChange={setObservation} />
          <MultiSelectFilter className="iw-ms" label={p('filters.severity')} allLabel={p('filters.allSeverities')} pluralLabel={p('filters.severitiesPlural')}
            options={severities} value={severity} onChange={setSeverity} />
          <label className="iw-obs-sev">
            <span>{p('filters.tyreNow')}</span>
            <select className="cc-select" value={tyreNow} onChange={(e) => setTyreNow(e.target.value)} aria-label={p('filters.tyreNowAria')}>
              <option value="not_replaced">{p('filters.notReplaced')}</option>
              <option value="all">{p('filters.anyIncludingReplaced')}</option>
              <option value="open">{p('filters.stillOpen')}</option>
              {Object.keys(TYRE_NOW_META).map((k) => <option key={k} value={k}>{nowLabel(k)}</option>)}
            </select>
          </label>
          {regionOptions.length > 0 && (
            <MultiSelectFilter className="iw-ms" label={p('filters.region')} allLabel={p('filters.allRegions')} pluralLabel={p('filters.regionsPlural')}
              options={regionOptions} value={region} onChange={setRegion} />
          )}
          <MultiSelectFilter className="iw-ms" label={p('filters.site')} allLabel={p('filters.allSites')} pluralLabel={p('filters.sitesPlural')}
            options={siteOptions} value={site} onChange={setSite} />
          <MultiSelectFilter className="iw-ms" label={p('filters.vehicle')} allLabel={p('filters.allVehicles')} pluralLabel={p('filters.vehiclesPlural')}
            options={assetOptions} value={asset} onChange={setAsset} />
          <MultiSelectFilter className="iw-ms" label={p('filters.inspector')} allLabel={p('filters.allInspectors')} pluralLabel={p('filters.inspectorsPlural')}
            options={inspectorOptions} value={inspector} onChange={setInspector} />
          <label className="iw-obs-sev">
            <span>{p('filters.action')}</span>
            <select className="cc-select" value={action} onChange={(e) => setAction(e.target.value)} aria-label={p('filters.actionAria')}>
              <option value="all">{p('filters.any')}</option>
              <option value="raised">{p('filters.actionRaised')}</option>
              <option value="none">{p('filters.noAction')}</option>
            </select>
          </label>
          {filtersOn && (
            <button type="button" className="cc-btn-ghost iw-inline" onClick={clearFilters}>{p('filters.clear')}</button>
          )}
        </div>
        {tyreNow === 'not_replaced' && nowSummary.replaced > 0 && (
          <p className="iw-od-muted" role="status">
            {nowSummary.replaced === 1 ? p('hiddenOne') : p('hiddenMany', { count: fmtInt(nowSummary.replaced) })}{' '}
            <button type="button" className="cc-link cc-link-btn" onClick={() => setTyreNow('replaced')}>{p('showThem')}</button>
          </p>
        )}
        {fitError && <p className="iw-od-muted" role="status">{p('fitErrorBanner')} {fitError}</p>}
        <Tabs label={p('typeTabsAria')} value={kind} onChange={setKind} tabs={[
          { key: 'all', label: p('all'), count: unreadable ? null : all.length },
          ...OBSERVATION_KINDS.map((k) => ({ key: k.key, label: kindLabel(k.key), count: unreadable ? null : summary[k.key] })),
        ]} />

        {exportError && <div className="cc-card iw-error" role="alert"><span>{exportError}</span></div>}

        {loading && !rows?.length ? (
          <div className="iw-skel">{Array.from({ length: 6 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 44 }} />)}</div>
        ) : unreadable ? (
          <div className="cc-empty">{p('unreadable')}</div>
        ) : !all.length ? (
          <div className="cc-empty">
            {p('emptyAll')}
            {onAddObservation ? ` ${p('emptyAdd')}` : ''}
          </div>
        ) : !pageRows.length ? (
          <div className="cc-empty">{p('emptyFiltered')}</div>
        ) : (
          <div className="iw-obs-table" role="table" aria-label={p('tableAria')}>
            <div className="iw-otr iw-oth" role="row">
              <span role="columnheader">{p('cols.date')}</span>
              <span role="columnheader">{p('cols.vehicle')}</span>
              <span role="columnheader">{p('cols.observation')}</span>
              <span role="columnheader">{p('cols.severity')}</span>
              <span role="columnheader">{p('cols.tyreNow')}</span>
              <span role="columnheader">{p('cols.inspector')}</span>
              <span role="columnheader">{p('cols.action')}</span>
            </div>
            {pageRows.map((o) => (
              <div key={o.key} className="iw-otr" role="row">
                <span role="cell" className="iw-o-day">{fmtDay(o.day)}</span>
                <span role="cell"><b>{o.asset_no || p('noAsset')}</b><small>{o.site || p('noSite')}</small></span>
                <span role="cell" className="iw-o-text">
                  <small className="iw-o-kind">{p('row.findingsIn', { count: o.findings.length })}</small>
                  <b>{p('row.tyreFindings', { count: o.findings.filter((f) => f.kind === 'tyre').length })}</b>
                  <small title={o.findings.map((f) => [f.position, f.text].filter(Boolean).join(': ')).join(' | ')} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{o.findings.map((f) => [f.position, f.text].filter(Boolean).join(': ')).join(' | ')}</small>
                </span>
                <span role="cell"><span className={`cc-pill ${o.findings.some((f) => f.tone === 'bad') ? 'bad' : o.tone}`}>{o.findings.some((f) => f.tone === 'bad') ? p('critical') : o.severity}</span></span>
                <span role="cell">
                  {!o.findings.some((f) => f.kind === 'tyre') ? <span className="cc-na">-</span>
                    : !o.findings.find((f) => f.kind === 'tyre')?.tyreNow ? <small>{fitError ? p('na') : p('row.checking')}</small>
                      : (
                        <>
                          <small>{p('row.replacedOf', { replaced: o.findings.filter((f) => f.kind === 'tyre' && f.tyreNow?.state === 'replaced').length, total: o.findings.filter((f) => f.kind === 'tyre').length })}</small>
                        </>
                      )}
                </span>
                <span role="cell">{o.inspector || p('na')}</span>
                <span role="cell" className="iw-o-acts">
                  <button type="button" className="cc-btn-ghost iw-inline" onClick={() => setDetail(o.inspectionId)}>
                    <Eye size={12} aria-hidden="true" /> {p('row.open')}
                  </button>
                  {!actionsReady
                    ? <small role="status">{actionError ? p('row.actionUnavailable') : p('row.checkingActions')}</small>
                    : <>
                      <small>{p('row.actionsRaised', { raised: o.findings.filter((f) => f.actionRaised).length, total: o.findings.filter((f) => f.kind !== 'note').length })}</small>
                      {o.findings.some((f) => f.kind === 'tyre' && !f.actionRaised && f.tyreNow?.state !== 'replaced') && onRaiseAction && (
                        <button type="button" className="cc-btn iw-inline" onClick={() => onRaiseAction(o.row)}>{p('row.createActions')}</button>
                      )}
                    </>}
                </span>
              </div>
            ))}
          </div>
        )}
        {actionError && <p role="alert" className="text-sm text-red-500 mt-3">{actionError}</p>}
        {grouped.length > PAGE && <Pager page={page} pageSize={PAGE} total={grouped.length} onPage={setPage} noun={p('noun')} />}
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
