/**
 * Where one tyre has been: every tyre_records row carrying its serial, oldest
 * first, with the stage each row reached. Loads on demand for one serial.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { escapeLike } from '../../lib/searchFilter'
import { toUserMessage } from '../../lib/safeError'
import { kmRun, lifecycleStage } from '../../lib/tyreLifecycleAnalytics'
import { measureNote } from '../../lib/tyreRunningLife'
import { Card, fmtInt } from '../commandCenter/kit'

const STAGE_TONE = { 'In Service': 'good', 'Retread Eligible': 'info', Retreaded: 'info', Scrapped: 'bad', Removed: 'muted' }

export default function TyreHistoryPanel({ serial, row, onClose }) {
  const [state, setState] = useState({ loading: true, rows: null, error: null })

  const load = useCallback(async () => {
    setState({ loading: true, rows: null, error: null })
    const { data, error } = await supabase
      .from('tyre_records')
      .select('id,asset_no,serial_number:serial_no,position,brand,size,issue_date,removal_date,km_at_fitment,km_at_removal,category,risk_level,cost_per_tyre,site,tread_depth,removal_reason')
      .ilike('serial_no', escapeLike(serial))
      .order('issue_date')
      .order('id')
      .limit(200)
    if (error) setState({ loading: false, rows: null, error: toUserMessage(error, 'Could not load this tyre history.') })
    else setState({ loading: false, rows: data || [], error: null })
  }, [serial])

  useEffect(() => { load() }, [load])

  const note = row?._rl ? measureNote(row._rl) : ''
  return (
    <Card
      title={<span>Tyre history <span className="tlc-mono">{serial}</span></span>}
      sub="Every record for this serial, oldest first"
      action={(
        <span className="tlc-actions">
          <Link className="cc-btn-ghost" to={`/tyre-passport/${encodeURIComponent(serial)}`}>Open passport</Link>
          {onClose && <button type="button" className="cc-icon-btn" aria-label="Close tyre history" onClick={onClose}><X size={15} /></button>}
        </span>
      )}
    >
      {row && (
        <div className="tlc-facts">
          <span><small>km run</small><b>{row._km == null ? 'N/A' : `${fmtInt(row._km)} km`}</b></span>
          <span><small>Cost per km</small><b>{row._cpk == null ? 'N/A' : row._cpk.toFixed(4)}</b></span>
          <span><small>Category</small><b>{row._category}</b></span>
          <span><small>Site</small><b>{row.site || 'N/A'}</b></span>
          <span><small>Life used</small><b>{row._lifePct == null ? 'N/A' : `${Math.round(row._lifePct)}%${row._lifeDim === 'hours' ? ' (hours)' : ''}`}</b></span>
        </div>
      )}
      {note && <p className="tlc-note">{note}</p>}
      {state.error ? (
        <div className="cc-empty" role="alert"><div>{state.error}<br /><button type="button" className="cc-btn" onClick={load}><RefreshCw size={12} aria-hidden="true" /> Retry</button></div></div>
      ) : state.loading ? (
        <div className="cc-skel" style={{ height: 80 }} role="status" aria-label="Loading history" />
      ) : state.rows.length === 0 ? (
        <div className="cc-empty">No records found for this serial.</div>
      ) : (
        <ol className="tlc-timeline">
          {state.rows.map((h) => {
            const km = kmRun(h)
            const stage = lifecycleStage(h)
            return (
              <li key={h.id}>
                <b>{h.issue_date || 'Date N/A'}</b>
                <span>Asset {h.asset_no || 'N/A'}</span>
                <span>Site {h.site || 'N/A'}</span>
                <span>Position {h.position || 'N/A'}</span>
                <span>{km != null ? `${fmtInt(km)} km` : 'km N/A'}</span>
                {h.removal_date && <span>Removed {h.removal_date}</span>}
                <span className={`cc-pill ${STAGE_TONE[stage]}`}>{stage}</span>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
