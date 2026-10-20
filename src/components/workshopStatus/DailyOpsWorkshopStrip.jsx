/**
 * Daily Ops overview -> Workshop Status summary strip (Loop 13).
 *
 * Five real figures from the Workshop Status data, each a link to the matching
 * Workshop Status tab: vehicles in the workshop, down more than 7 days, past
 * their expected release date, released today, and the last confirmed daily
 * upload (when and who).
 *
 * Reads reuse the Workshop Status services; the counts come from the shared
 * pure engine src/lib/workshopStatus/dailyOpsSummary.js. Permissions come from
 * workshop_status_my_permissions() and FAIL CLOSED: the strip renders nothing
 * unless the caller may view Workshop Status, and a figure whose source the
 * caller may not read is not shown at all. A failed read renders N/A with a
 * Retry, never 0.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wrench, Truck, Timer, AlertTriangle, CheckCircle2, Upload, RefreshCw } from 'lucide-react'
import { Kpi } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { loadMyWorkshopPermissions } from '../../lib/api/workshopStatusPermissions'
import { listActiveVehicles } from '../../lib/api/workshopStatusActive'
import { listRemovedRecords } from '../../lib/api/workshopStatusRemoved'
import { listRecentUploads } from '../../lib/api/workshopStatusActivity'
import { buildDailyOpsWorkshopSummary, DAILY_OPS_WORKSHOP_LINKS } from '../../lib/workshopStatus/dailyOpsSummary'
import { fmtDateTime } from '../../lib/workshopStatus/activeView'
import { WORKSHOP_STATUS_PATH } from '../../lib/workshopStatus/notificationLinks'
import './DailyOpsWorkshopStrip.css'

const p = 'workshopStatusDailyOps.strip'

export default function DailyOpsWorkshopStrip({ country }) {
  const { t } = useLanguage()
  const [perms, setPerms] = useState(null) // null = loading
  const [state, setState] = useState({ loading: true, active: null, removed: null, uploads: null, failed: [], truncated: false })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadMyWorkshopPermissions().then(({ permissions }) => { if (!cancelled) setPerms(permissions) })
    return () => { cancelled = true }
  }, [])

  const canView = perms?.view === true
  const canRemoved = perms?.view_removed === true
  const canUploads = perms?.view_uploads === true

  useEffect(() => {
    if (!canView) return undefined
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    const tasks = [
      listActiveVehicles({ country }),
      canRemoved ? listRemovedRecords({ country }) : Promise.resolve(null),
      canUploads ? listRecentUploads({ country }) : Promise.resolve(null),
    ]
    Promise.allSettled(tasks).then(([a, r, u]) => {
      if (cancelled) return
      const failed = []
      if (a.status === 'rejected') failed.push('active')
      if (r.status === 'rejected') failed.push('removed')
      if (u.status === 'rejected') failed.push('uploads')
      setState({
        loading: false,
        active: a.status === 'fulfilled' ? a.value.rows : null,
        removed: r.status === 'fulfilled' && r.value ? r.value.rows : null,
        uploads: u.status === 'fulfilled' ? u.value : null,
        failed,
        truncated: (a.status === 'fulfilled' && a.value.truncated) || (r.status === 'fulfilled' && r.value?.truncated) || false,
      })
    })
    return () => { cancelled = true }
  }, [canView, canRemoved, canUploads, country, nonce])

  const summary = useMemo(
    () => buildDailyOpsWorkshopSummary({ active: state.active, removed: state.removed, uploads: state.uploads, now: new Date() }),
    [state.active, state.removed, state.uploads],
  )
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  if (!canView) return null

  const loading = state.loading
  const na = t(`${p}.na`)
  const show = (v) => (v == null ? na : undefined)
  const upload = summary.lastUpload
  const uploadAt = upload ? fmtDateTime(upload.at) : null
  const allFailed = state.failed.length > 0 && state.failed.length === [true, canRemoved, canUploads].filter(Boolean).length
  const empty = !loading && state.failed.length === 0 && summary.active === 0 && !upload

  return (
    <section className="cc-card dows-card" aria-label={t(`${p}.title`)}>
      <div className="cc-card-head">
        <div>
          <h2 className="cc-card-title"><Wrench size={15} aria-hidden="true" /> {t(`${p}.title`)}</h2>
          <p className="cc-card-sub">{t(`${p}.sub`)}</p>
        </div>
        <Link className="cc-link" to={WORKSHOP_STATUS_PATH}>{t(`${p}.open`)}</Link>
      </div>

      {!loading && state.failed.length > 0 && (
        <div className="dows-banner" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{allFailed ? t(`${p}.errorAll`) : t(`${p}.errorPartial`)}</span>
          <button type="button" className="cc-btn" onClick={retry}><RefreshCw size={13} aria-hidden="true" /> {t(`${p}.retry`)}</button>
        </div>
      )}
      {!loading && state.truncated && <p className="dows-note" role="status">{t(`${p}.capped`)}</p>}
      {empty && <p className="dows-note">{t(`${p}.empty`)}</p>}

      <div className="dows-grid">
        <Kpi icon={Truck} tone="t-blue" loading={loading} value={summary.active} display={show(summary.active)}
          label={t(`${p}.active`)} to={DAILY_OPS_WORKSHOP_LINKS.active} title={t(`${p}.activeHint`)} />
        <Kpi icon={Timer} tone="t-amber" loading={loading} value={summary.waiting7} display={show(summary.waiting7)}
          label={t(`${p}.waiting7`)} to={DAILY_OPS_WORKSHOP_LINKS.waiting} title={t(`${p}.waiting7Hint`)}
          danger={summary.waiting7 > 0} />
        <Kpi icon={AlertTriangle} tone="t-red" loading={loading} value={summary.overdueRelease} display={show(summary.overdueRelease)}
          label={t(`${p}.overdue`)} to={DAILY_OPS_WORKSHOP_LINKS.overdue} title={t(`${p}.overdueHint`)}
          danger={summary.overdueRelease > 0} />
        {canRemoved && (
          <Kpi icon={CheckCircle2} tone="t-green" loading={loading} value={summary.releasedToday} display={show(summary.releasedToday)}
            label={t(`${p}.releasedToday`)} to={DAILY_OPS_WORKSHOP_LINKS.released} title={t(`${p}.releasedTodayHint`)} />
        )}
        {canUploads && (
          <Kpi icon={Upload} tone="t-blue" loading={loading}
            display={!summary.uploadsKnown ? na : (uploadAt || t(`${p}.noUpload`))}
            label={upload?.by ? t(`${p}.lastUploadBy`, { name: upload.by }) : t(`${p}.lastUpload`)}
            to={DAILY_OPS_WORKSHOP_LINKS.upload} title={t(`${p}.lastUploadHint`)} />
        )}
      </div>
    </section>
  )
}
