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
import { useLanguage } from '../../contexts/LanguageContext'
import { statusLabels, categoryLabels } from '../../lib/tyreLifecycleLabels'

const STAGE_TONE = { 'In Service': 'good', 'Retread Eligible': 'info', Retreaded: 'info', Scrapped: 'bad', Removed: 'muted' }

export default function TyreHistoryPanel({ serial, row, onClose }) {
  const { t } = useLanguage()
  const naText = t('tyrelifecycle.na')
  const STAGE_LABEL = statusLabels(t)
  const CATEGORY_LABEL = categoryLabels(t)
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
    if (error) setState({ loading: false, rows: null, error: toUserMessage(error, t('tyrelifecycle.errors.history')) })
    else setState({ loading: false, rows: data || [], error: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial])

  useEffect(() => { load() }, [load])

  const note = row?._rl ? measureNote(row._rl) : ''
  return (
    <Card
      title={<span>{t('tyrelifecycle.history.title')} <span className="tlc-mono">{serial}</span></span>}
      sub={t('tyrelifecycle.history.sub')}
      action={(
        <span className="tlc-actions">
          <Link className="cc-btn-ghost" to={`/tyre-passport/${encodeURIComponent(serial)}`}>{t('tyrelifecycle.history.openPassport')}</Link>
          {onClose && <button type="button" className="cc-icon-btn" aria-label={t('tyrelifecycle.history.closeAria')} onClick={onClose}><X size={15} /></button>}
        </span>
      )}
    >
      {row && (
        <div className="tlc-facts">
          <span><small>{t('tyrelifecycle.history.kmRun')}</small><b>{row._km == null ? naText : t('tyrelifecycle.hero.statKm', { value: fmtInt(row._km) })}</b></span>
          <span><small>{t('tyrelifecycle.history.costPerKm')}</small><b>{row._cpk == null ? naText : row._cpk.toFixed(4)}</b></span>
          <span><small>{t('tyrelifecycle.history.category')}</small><b>{CATEGORY_LABEL[row._category] || row._category}</b></span>
          <span><small>{t('tyrelifecycle.history.site')}</small><b>{row.site || naText}</b></span>
          <span><small>{t('tyrelifecycle.history.lifeUsed')}</small><b>{row._lifePct == null ? naText : `${Math.round(row._lifePct)}%${row._lifeDim === 'hours' ? t('tyrelifecycle.history.hoursSuffix') : ''}`}</b></span>
        </div>
      )}
      {note && <p className="tlc-note">{note}</p>}
      {state.error ? (
        <div className="cc-empty" role="alert"><div>{state.error}<br /><button type="button" className="cc-btn" onClick={load}><RefreshCw size={12} aria-hidden="true" /> {t('tyrelifecycle.common.retry')}</button></div></div>
      ) : state.loading ? (
        <div className="cc-skel" style={{ height: 80 }} role="status" aria-label={t('tyrelifecycle.history.loading')} />
      ) : state.rows.length === 0 ? (
        <div className="cc-empty">{t('tyrelifecycle.history.noRecords')}</div>
      ) : (
        <ol className="tlc-timeline">
          {state.rows.map((h) => {
            const km = kmRun(h)
            const stage = lifecycleStage(h)
            return (
              <li key={h.id}>
                <b>{h.issue_date || t('tyrelifecycle.history.dateNa')}</b>
                <span>{t('tyrelifecycle.history.asset', { value: h.asset_no || naText })}</span>
                <span>{t('tyrelifecycle.history.site2', { value: h.site || naText })}</span>
                <span>{t('tyrelifecycle.history.position', { value: h.position || naText })}</span>
                <span>{km != null ? t('tyrelifecycle.hero.statKm', { value: fmtInt(km) }) : t('tyrelifecycle.history.kmNa')}</span>
                {h.removal_date && <span>{t('tyrelifecycle.history.removedOn', { date: h.removal_date })}</span>}
                <span className={`cc-pill ${STAGE_TONE[stage]}`}>{STAGE_LABEL[stage] || stage}</span>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
