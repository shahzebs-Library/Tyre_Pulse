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
  observationRegister, filterObservations, observationSummary, OBSERVATION_KINDS,
} from '../../lib/inspectionWorkspaceView'
import { exportToExcel } from '../../lib/exportUtils'
import { listFitmentsForAssets } from '../../lib/api/tyreChangeTracking'
import { withTyreNow, tyreNowSummary, matchesTyreNow, TYRE_NOW_META } from '../../lib/observationTracking'
import ObservationDetail from './ObservationDetail'
import { toUserMessage } from '../../lib/safeError'

const PAGE = 15
const SEVERITIES = ['all', 'Critical', 'High', 'Medium', 'Minor', 'Low', 'Note', 'Not rated']
const KIND_LABEL = Object.fromEntries(OBSERVATION_KINDS.map((k) => [k.key, k.label]))

const fmtDay = (d) => {
  if (!d) return 'N/A'
  const x = new Date(`${d}T00:00:00`)
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function ObservationsBoard({
  rows, loading, error, onBack, onOpen, onRaiseAction, onAddObservation, country,
}) {
  const [kind, setKind] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [exportError, setExportError] = useState('')
  const [tyreNow, setTyreNow] = useState('all')
  const [detail, setDetail] = useState(null)
  // Fitment records for the vehicles these observations name. null while loading
  // or unreadable, so no row is given a status it was not checked for.
  const [fitments, setFitments] = useState(null)
  const [fitError, setFitError] = useState('')

  const base = useMemo(() => observationRegister(rows), [rows])
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
  const all = useMemo(() => withTyreNow(base, fitments), [base, fitments])
  const summary = useMemo(() => observationSummary(all), [all])
  const nowSummary = useMemo(() => tyreNowSummary(all), [all])
  const list = useMemo(
    () => filterObservations(all, { q, kind, severity }).filter((o) => matchesTyreNow(o, tyreNow)),
    [all, q, kind, severity, tyreNow],
  )
  useEffect(() => { setPage(0) }, [q, kind, severity, tyreNow, rows])

  const unreadable = !!error
  const show = (v) => (unreadable ? 'N/A' : fmtInt(v))
  const pageRows = list.slice(page * PAGE, page * PAGE + PAGE)
  const severities = SEVERITIES.filter((s) => s === 'all' || all.some((o) => o.severity === s))

  async function exportExcel() {
    setExportError('')
    try {
      await exportToExcel(
        list.map((o) => ({
          day: o.day, kind: KIND_LABEL[o.kind], asset_no: o.asset_no, site: o.site,
          position: o.position, text: o.text, remarks: o.remarks, severity: o.severity,
          inspector: o.inspector, tyre_now: o.tyreNow ? TYRE_NOW_META[o.tyreNow.state].label : '',
          replaced_on: o.tyreNow?.replacement?.fittedOn || '', action: o.kind === 'note' ? '' : o.actionRaised ? 'Raised' : 'Not raised',
        })),
        ['day', 'kind', 'asset_no', 'site', 'position', 'text', 'remarks', 'severity', 'inspector', 'tyre_now', 'replaced_on', 'action'],
        ['Date', 'Type', 'Asset', 'Site', 'Position', 'Observation', 'Remarks', 'Severity', 'Inspector', 'Tyre now', 'Replaced on', 'Corrective action'],
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
        title={`Observations (${unreadable ? 'N/A' : fmtInt(list.length)}${list.length !== all.length ? ` of ${fmtInt(all.length)}` : ''})`}
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
              placeholder="Search vehicle, site, position, inspector, text..." aria-label="Search observations" />
          </div>
          <label className="iw-obs-sev">
            <span>Severity</span>
            <select className="cc-select" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filter by severity">
              {severities.map((s) => <option key={s} value={s}>{s === 'all' ? 'All severities' : s}</option>)}
            </select>
          </label>
          <label className="iw-obs-sev">
            <span>Tyre now</span>
            <select className="cc-select" value={tyreNow} onChange={(e) => setTyreNow(e.target.value)} aria-label="Filter by whether the tyre was replaced">
              <option value="all">Any</option>
              <option value="open">Still open</option>
              {Object.entries(TYRE_NOW_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </label>
        </div>
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
                  <small className="iw-o-kind">{KIND_LABEL[o.kind]}{o.position ? `, ${o.position}` : ''}</small>
                  <b>{o.text}</b>
                  {o.remarks && <small>{o.remarks}</small>}
                </span>
                <span role="cell"><span className={`cc-pill ${o.tone}`}>{o.severity}</span></span>
                <span role="cell">
                  {o.kind !== 'tyre' ? <span className="cc-na">-</span>
                    : !o.tyreNow ? <small>{fitError ? 'N/A' : 'Checking...'}</small>
                      : (
                        <>
                          <span className={`cc-pill ${TYRE_NOW_META[o.tyreNow.state].tone}`}>{TYRE_NOW_META[o.tyreNow.state].label}</span>
                          {o.tyreNow.state === 'replaced' && <small>{fmtDay(o.tyreNow.replacement?.fittedOn)}</small>}
                        </>
                      )}
                </span>
                <span role="cell">{o.inspector || 'N/A'}</span>
                <span role="cell" className="iw-o-acts">
                  <button type="button" className="cc-btn-ghost iw-inline" onClick={() => setDetail(o)}>
                    <Eye size={12} aria-hidden="true" /> Open
                  </button>
                  {o.kind !== 'note' && (o.actionRaised
                    ? <Link className="cc-link" to="/actions">Action raised</Link>
                    : o.tyreNow?.state === 'replaced' ? null
                    : (o.tone === 'bad' || o.tone === 'warn') && onRaiseAction
                      ? <button type="button" className="cc-btn iw-inline" onClick={() => onRaiseAction(o.row)}>Create action</button>
                      : null)}
                </span>
              </div>
            ))}
          </div>
        )}
        {list.length > PAGE && <Pager page={page} pageSize={PAGE} total={list.length} onPage={setPage} noun="observations" />}
      </Card>
      {detail && (
        <ObservationDetail
          obs={all.find((o) => o.key === detail.key) || detail}
          onClose={() => setDetail(null)}
          onOpenInspection={(r) => { setDetail(null); onOpen(r) }}
          onRaiseAction={onRaiseAction ? (r) => { setDetail(null); onRaiseAction(r) } : null}
        />
      )}
    </div>
  )
}
