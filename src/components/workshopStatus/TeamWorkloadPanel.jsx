/**
 * TeamWorkloadPanel - Daily Ops -> Workshop Status -> Team workload (Loop 10).
 *
 * Per responsible person, over the vehicles in the CURRENT workshop report:
 * assigned active vehicles, repair in progress, waiting parts, waiting
 * approval and pending update today (nobody updated it by hand today).
 * Vehicles with no responsible person form the Unassigned row, always last.
 * The counts come from the pure activityView.workload engine; the records are
 * the same read Active vehicles uses, so both screens agree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCcw, ShieldAlert, AlertTriangle, Download } from 'lucide-react'
import { Card, fmtInt } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { loadWorkloadRecords } from '../../lib/api/workshopStatusActivity'
import { localDay } from '../../lib/workshopStatus/activeView'
import { workload, WORKLOAD_METRICS } from '../../lib/workshopStatus/activityView'
import './workshopStatus.css'
import './activeVehicles.css'
import './activity.css'

export default function TeamWorkloadPanel({ permissions, permState = 'ready', onRetryPermissions }) {
  const { t } = useLanguage()
  const w = useCallback((k, v) => t(`workshopStatusActivity.workload.${k}`, v), [t])
  const { activeCountry } = useSettings()
  const isAll = !activeCountry || activeCountry === 'All'
  const country = isAll ? '' : activeCountry

  const [records, setRecords] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const runRef = useRef(0)

  const canView = permissions?.view === true && (permissions?.view_activity === true || permissions?.view_reports === true)
  const canExport = permissions?.export === true

  const load = useCallback(async () => {
    const run = ++runRef.current
    setLoading(true); setError('')
    try {
      const res = await loadWorkloadRecords({ country })
      if (run !== runRef.current) return
      setRecords(res?.rows || [])
      setTruncated(Boolean(res?.truncated))
      setNow(new Date())
    } catch (err) {
      if (run !== runRef.current) return
      setError(toUserMessage(err, w('loadError')))
    } finally {
      if (run === runRef.current) setLoading(false)
    }
  }, [country, w])

  useEffect(() => {
    if (permState !== 'ready' || !canView) return
    load()
  }, [load, permState, canView])

  const data = useMemo(() => workload(records, { now }), [records, now])
  const personName = (r) => (r.unassigned ? w('unassigned') : (r.name || w('unknownPerson')))

  const exportExcel = async () => {
    if (!data.rows.length || exporting) return
    setExporting(true); setExportError('')
    try {
      const keys = ['person', ...WORKLOAD_METRICS]
      const headers = [w('person'), ...WORKLOAD_METRICS.map((m) => w(`metrics.${m}`))]
      const out = data.rows.map((r) => {
        const o = { person: personName(r) }
        for (const m of WORKLOAD_METRICS) o[m] = r[m]
        return o
      })
      const totalRow = { person: w('total') }
      for (const m of WORKLOAD_METRICS) totalRow[m] = data.totals[m]
      out.push(totalRow)
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      await exportToExcel(out, keys, headers,
        reportFileName('Workshop Team Workload', isAll ? 'All countries' : country, localDay(now)),
        'Team workload', { title: w('exportTitle') })
    } catch (err) {
      setExportError(toUserMessage(err, w('exportError')))
    } finally {
      setExporting(false)
    }
  }

  if (permState === 'loading') {
    return (
      <Card>
        <div className="wks-state" role="status" aria-live="polite">
          <Loader2 size={18} className="wks-spin" aria-hidden="true" /> {w('loadingPerms')}
        </div>
      </Card>
    )
  }
  if (!canView) {
    return (
      <Card>
        <div className="wks-state wks-state-col" role="alert">
          <ShieldAlert size={26} aria-hidden="true" className="wks-ico-warn" />
          <h2 className="wks-h">{w('deniedTitle')}</h2>
          <p className="wks-muted">{w('deniedBody')}</p>
          {permState === 'error' && onRetryPermissions && (
            <button type="button" className="cc-btn-ghost wks-tap" onClick={onRetryPermissions}>
              <RotateCcw size={14} aria-hidden="true" /> {w('retry')}
            </button>
          )}
        </div>
      </Card>
    )
  }

  return (
    <div className="wks-panel">
      <Card
        title={w('title')}
        sub={w('lead')}
        action={(
          <div className="wks-av-tools">
            {canExport && (
              <button type="button" className="cc-btn-ghost wks-tap" onClick={exportExcel} disabled={!data.rows.length || exporting}>
                {exporting ? <Loader2 size={14} className="wks-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} {w('export')}
              </button>
            )}
            <button type="button" className="cc-btn-ghost wks-tap" onClick={load} disabled={loading} aria-label={w('refresh')}>
              <RotateCcw size={14} aria-hidden="true" className={loading ? 'wks-spin' : ''} />
            </button>
          </div>
        )}
      >
        {truncated && (
          <div className="wks-banner warn" role="status">
            <AlertTriangle size={17} aria-hidden="true" />
            <p>{w('truncated')}</p>
          </div>
        )}
        {exportError && (
          <div className="wks-banner bad" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <p>{exportError}</p>
          </div>
        )}

        {error ? (
          <div className="wks-banner bad" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <div>
              <strong>{w('loadErrorTitle')}</strong>
              <p>{error}</p>
              <button type="button" className="cc-btn-ghost wks-tap" onClick={load}>
                <RotateCcw size={14} aria-hidden="true" /> {w('retry')}
              </button>
            </div>
          </div>
        ) : loading && !records.length ? (
          <div className="wks-av-skel" role="status" aria-live="polite">
            <span className="wks-sr">{w('loading')}</span>
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 34 }} />)}
          </div>
        ) : !data.rows.length ? (
          <div className="wks-empty">
            <h2 className="wks-h">{w('emptyTitle')}</h2>
            <p className="wks-muted">{w('emptyBody')}</p>
          </div>
        ) : (
          <>
            <div className="wks-av-table-wrap wks-desktop">
              <table className="wks-av-table" aria-label={w('title')}>
                <thead>
                  <tr>
                    <th scope="col">{w('person')}</th>
                    {WORKLOAD_METRICS.map((m) => <th key={m} scope="col" className="is-num">{w(`metrics.${m}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className={r.unassigned ? 'wks-act-unassigned' : ''}>
                      <th scope="row">{personName(r)}</th>
                      {WORKLOAD_METRICS.map((m) => (
                        <td key={m} className={`is-num ${m === 'pendingToday' && r[m] > 0 ? 'wks-act-warn' : ''}`}>{fmtInt(r[m])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="wks-act-total">
                    <th scope="row">{w('total')}</th>
                    {WORKLOAD_METRICS.map((m) => <td key={m} className="is-num">{fmtInt(data.totals[m])}</td>)}
                  </tr>
                </tfoot>
              </table>
            </div>

            <ul className="wks-cards">
              {data.rows.map((r) => (
                <li key={r.id} className="wks-item">
                  <div className="wks-act-card-head"><strong>{personName(r)}</strong></div>
                  {WORKLOAD_METRICS.map((m) => (
                    <div key={m} className="wks-item-row">
                      <span className="wks-item-k">{w(`metrics.${m}`)}</span>
                      <span className="wks-item-v">{fmtInt(r[m])}</span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
            <p className="wks-muted wks-av-count">{w('pendingNote')}</p>
          </>
        )}
      </Card>
    </div>
  )
}
