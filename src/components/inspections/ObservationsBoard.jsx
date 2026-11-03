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
import { MessageSquare, AlertTriangle, Truck, Wrench, Search, Download, Plus, Eye, ArrowLeft } from 'lucide-react'
import { Card, Kpi, Tabs, Pager, fmtInt } from '../commandCenter/kit'
import {
  observationRegister, filterObservations, observationSummary, OBSERVATION_KINDS,
} from '../../lib/inspectionWorkspaceView'
import { exportToExcel } from '../../lib/exportUtils'
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
  rows, loading, error, onBack, onOpen, onRaiseAction, onAddObservation,
}) {
  const [kind, setKind] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [exportError, setExportError] = useState('')

  const all = useMemo(() => observationRegister(rows), [rows])
  const summary = useMemo(() => observationSummary(all), [all])
  const list = useMemo(() => filterObservations(all, { q, kind, severity }), [all, q, kind, severity])
  useEffect(() => { setPage(0) }, [q, kind, severity, rows])

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
          inspector: o.inspector, action: o.kind === 'note' ? '' : o.actionRaised ? 'Raised' : 'Not raised',
        })),
        ['day', 'kind', 'asset_no', 'site', 'position', 'text', 'remarks', 'severity', 'inspector', 'action'],
        ['Date', 'Type', 'Asset', 'Site', 'Position', 'Observation', 'Remarks', 'Severity', 'Inspector', 'Corrective action'],
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
        <Kpi icon={Wrench} tone="t-green" display={show(summary.withAction)} label="Inspections with an action" loading={loading}
          title={unreadable ? undefined : `${fmtInt(summary.needingAction)} inspections with a finding have no action yet`} />
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
        </div>
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
                <span role="cell">{o.inspector || 'N/A'}</span>
                <span role="cell" className="iw-o-acts">
                  <button type="button" className="cc-btn-ghost iw-inline" onClick={() => onOpen(o.row)}>
                    <Eye size={12} aria-hidden="true" /> Open
                  </button>
                  {o.kind !== 'note' && (o.actionRaised
                    ? <Link className="cc-link" to="/actions">Action raised</Link>
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
    </div>
  )
}
