/**
 * RemovedRecordsPanel - Daily Ops -> Workshop Status -> Released (Loop 11).
 *
 * Vehicles that left the daily Excel report (the owner calls this "released
 * from the workshop"). Each row shows when and by which upload it left, the
 * stage / reason / responsible person it had at that moment, and the final
 * disposition if one was recorded. Actions (disposition, restore, archive,
 * delete) open one dialog and go through workshop_status_record_action; the
 * server decides every one of them. The removal itself is never erased.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Archive, ArchiveRestore, CheckCircle2, Download, History, Loader2, PackageCheck,
  RotateCcw, Search, ShieldAlert, SlidersHorizontal, Trash2, Undo2, X,
} from 'lucide-react'
import { Card, Kpi, fmtInt } from '../commandCenter/kit'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { loadRemovedRecords, runRecordAction } from '../../lib/api/workshopStatusRemoved'
import { fmtDateTime, localDay } from '../../lib/workshopStatus/activeView'
import {
  DISPOSITIONS, DISPOSITION_OTHER, REMOVED_STATUS, STATUS_ORDER, MIN_REASON,
  activeRemovedFilterCount, availableActions, emptyRemovedFilters, filterRemoved, needsReason,
  reasonValid, removedSites, removedStatus, sortRemoved, summarizeRemoved,
} from '../../lib/workshopStatus/removedView'
import './workshopStatus.css'
import './activeVehicles.css'
import './removed.css'

const ACTION_ICON = {
  disposition: CheckCircle2,
  restore: Undo2,
  archive: Archive,
  unarchive: ArchiveRestore,
  soft_delete: Trash2,
  undelete: RotateCcw,
  permanent_delete: Trash2,
}
const DANGER = new Set(['soft_delete', 'permanent_delete'])

export default function RemovedRecordsPanel({ permissions, permState = 'ready', onRetryPermissions, onHistory, onChanged }) {
  const { t } = useLanguage()
  const m = useCallback((k, v) => t(`workshopStatusRemoved.${k}`, v), [t])
  const { activeCountry } = useSettings()
  const isAll = !activeCountry || activeCountry === 'All'
  const country = isAll ? '' : activeCountry

  const [rows, setRows] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(emptyRemovedFilters)
  const [showFilters, setShowFilters] = useState(false)
  const [dialog, setDialog] = useState(null) // { record, action }
  const [notice, setNotice] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const runRef = useRef(0)

  const canView = permissions?.view === true && permissions?.view_removed === true
  const canExport = permissions?.export === true

  const load = useCallback(async () => {
    const run = ++runRef.current
    setLoading(true); setError('')
    try {
      const res = await loadRemovedRecords({ country })
      if (run !== runRef.current) return
      setRows(res?.rows || [])
      setTruncated(Boolean(res?.truncated))
    } catch (err) {
      if (run !== runRef.current) return
      setError(toUserMessage(err, m('loadError')))
    } finally {
      if (run === runRef.current) setLoading(false)
    }
  }, [country, m])

  useEffect(() => {
    if (permState !== 'ready' || !canView) return
    load()
  }, [load, permState, canView])

  const stats = useMemo(() => summarizeRemoved(rows), [rows])
  const sites = useMemo(() => removedSites(rows), [rows])
  const shown = useMemo(() => sortRemoved(filterRemoved(rows, filters)), [rows, filters])
  const filterCount = activeRemovedFilterCount(filters)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const dispLabel = (v) => (v ? m(`disposition.${v}`) : m('noDisposition'))
  const reasonLabel = (v) => (v ? m(`removedReason.${v}`) : m('na'))
  const uploadLabel = (u) => (u ? (u.upload_no ? `#${u.upload_no}` : m('upload')) : m('na'))

  const onDone = (action) => {
    setDialog(null)
    setNotice(m(`done.${action}`))
    load()
    if (action === 'restore' && typeof onChanged === 'function') onChanged()
  }

  const exportExcel = async () => {
    if (!shown.length || exporting) return
    setExporting(true); setExportError('')
    try {
      const keys = ['asset_no', 'site', 'status', 'removed_at', 'removed_by_upload', 'removed_reason',
        'previous_stage', 'previous_reason', 'previous_responsible', 'disposition', 'disposition_by', 'disposition_at']
      const headers = keys.map((k) => m(`col.${k}`))
      const out = shown.map((r) => ({
        asset_no: r.asset_no,
        site: r.site || m('na'),
        status: m(`status.${removedStatus(r)}`),
        removed_at: r.removed_at ? fmtDateTime(r.removed_at) : m('na'),
        removed_by_upload: uploadLabel(r.removed_by_upload),
        removed_reason: reasonLabel(r.removed_reason),
        previous_stage: r.previous_current_stage || m('na'),
        previous_reason: r.previous_delay_reason || m('na'),
        previous_responsible: r.previous_responsible_name || m('na'),
        disposition: dispLabel(r.final_disposition),
        disposition_by: r.final_disposition_by_name || m('na'),
        disposition_at: r.final_disposition_at ? fmtDateTime(r.final_disposition_at) : m('na'),
      }))
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      await exportToExcel(out, keys, headers,
        reportFileName('Workshop Released Vehicles', isAll ? 'All countries' : country, localDay(new Date())),
        'Released', { title: m('exportTitle') })
    } catch (err) {
      setExportError(toUserMessage(err, m('exportError')))
    } finally {
      setExporting(false)
    }
  }

  if (permState === 'loading') {
    return (
      <Card>
        <div className="wks-state" role="status" aria-live="polite">
          <Loader2 size={18} className="wks-spin" aria-hidden="true" /> {m('loadingPerms')}
        </div>
      </Card>
    )
  }
  if (!canView) {
    return (
      <Card>
        <div className="wks-state wks-state-col" role="alert">
          <ShieldAlert size={26} aria-hidden="true" className="wks-ico-warn" />
          <h2 className="wks-h">{m('deniedTitle')}</h2>
          <p className="wks-muted">{m('deniedBody')}</p>
          {permState === 'error' && onRetryPermissions && (
            <button type="button" className="cc-btn-ghost wks-tap" onClick={onRetryPermissions}>
              <RotateCcw size={14} aria-hidden="true" /> {m('retry')}
            </button>
          )}
        </div>
      </Card>
    )
  }

  const actionButtons = (r) => {
    const acts = availableActions(r, permissions)
    return (
      <div className="wks-rm-actions">
        {typeof onHistory === 'function' && (
          <button type="button" className="cc-btn-ghost wks-tap" onClick={() => onHistory(r)}
            aria-label={m('historyFor', { asset: r.asset_no })}>
            <History size={14} aria-hidden="true" /> {m('history')}
          </button>
        )}
        {acts.map((a) => {
          const Icon = ACTION_ICON[a]
          return (
            <button key={a} type="button" className={`cc-btn-ghost wks-tap ${DANGER.has(a) ? 'wks-rm-danger' : ''}`}
              onClick={() => { setNotice(''); setDialog({ record: r, action: a }) }}
              aria-label={m('actionFor', { action: m(`action.${a}`), asset: r.asset_no })}>
              <Icon size={14} aria-hidden="true" /> {m(`action.${a}`)}
            </button>
          )
        })}
      </div>
    )
  }

  const statusPill = (r) => {
    const s = removedStatus(r)
    return <span className={`wks-rm-pill is-${s}`}>{m(`status.${s}`)}</span>
  }

  return (
    <div className="wks-panel">
      <div className="wks-av-kpis">
        <Kpi icon={PackageCheck} tone="t-blue" value={stats.released} label={m('kpi.released')} loading={loading && !rows.length}
          onClick={() => setFilters({ ...emptyRemovedFilters(), status: REMOVED_STATUS.RELEASED })} />
        <Kpi icon={AlertTriangle} tone="t-amber" value={stats.awaitingDisposition} label={m('kpi.awaiting')} loading={loading && !rows.length}
          onClick={() => setFilters({ ...emptyRemovedFilters(), disposition: 'none' })} />
        <Kpi icon={Archive} tone="t-purple" value={stats.archived} label={m('kpi.archived')} loading={loading && !rows.length}
          onClick={() => setFilters({ ...emptyRemovedFilters(), status: REMOVED_STATUS.ARCHIVED })} />
        {permissions?.soft_delete === true && (
          <Kpi icon={Trash2} tone="t-red" value={stats.deleted} label={m('kpi.deleted')} loading={loading && !rows.length}
            onClick={() => setFilters({ ...emptyRemovedFilters(), status: REMOVED_STATUS.DELETED })} />
        )}
      </div>

      <Card title={m('title')} sub={m('lead')}>
        <div className="wks-av-toolbar">
          <label className="cc-search wks-search wks-av-search">
            <Search size={14} aria-hidden="true" />
            <span className="wks-sr">{m('searchLabel')}</span>
            <input type="search" value={filters.search} placeholder={m('searchPlaceholder')}
              onChange={(e) => setFilter('search', e.target.value)} />
            {filters.search && (
              <button type="button" className="wks-clear" aria-label={t('common.clearSearch')} onClick={() => setFilter('search', '')}>
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </label>
          <div className="wks-av-tools">
            <button type="button" className="cc-btn-ghost wks-tap" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
              <SlidersHorizontal size={14} aria-hidden="true" /> {filterCount ? m('filtersCount', { n: filterCount }) : m('filters')}
            </button>
            {canExport && (
              <button type="button" className="cc-btn-ghost wks-tap" onClick={exportExcel} disabled={!shown.length || exporting}>
                {exporting ? <Loader2 size={14} className="wks-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} {m('export')}
              </button>
            )}
            <button type="button" className="cc-btn-ghost wks-tap" onClick={load} disabled={loading} aria-label={m('refresh')}>
              <RotateCcw size={14} aria-hidden="true" className={loading ? 'wks-spin' : ''} />
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="wks-av-filters" data-testid="wks-rm-filters">
            <label className="cc-field">
              <span>{m('col.status')}</span>
              <select className="cc-select wks-tap" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
                <option value="">{m('any')}</option>
                {STATUS_ORDER.filter((s) => s !== REMOVED_STATUS.DELETED || permissions?.soft_delete === true)
                  .map((s) => <option key={s} value={s}>{m(`status.${s}`)}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>{m('col.disposition')}</span>
              <select className="cc-select wks-tap" value={filters.disposition} onChange={(e) => setFilter('disposition', e.target.value)}>
                <option value="">{m('any')}</option>
                <option value="none">{m('noDisposition')}</option>
                {DISPOSITIONS.map((d) => <option key={d} value={d}>{m(`disposition.${d}`)}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>{m('col.site')}</span>
              <select className="cc-select wks-tap" value={filters.site} onChange={(e) => setFilter('site', e.target.value)}>
                <option value="">{m('any')}</option>
                {sites.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {filterCount > 0 && (
              <button type="button" className="cc-btn-ghost wks-tap" onClick={() => setFilters(emptyRemovedFilters())}>
                {m('clearFilters')}
              </button>
            )}
          </div>
        )}

        <p className="wks-muted wks-av-count" aria-live="polite">{m('count', { shown: fmtInt(shown.length), total: fmtInt(rows.length) })}</p>

        {notice && <div className="wks-banner ok" role="status"><CheckCircle2 size={17} aria-hidden="true" /><p>{notice}</p></div>}
        {truncated && <div className="wks-banner warn" role="status"><AlertTriangle size={17} aria-hidden="true" /><p>{m('truncated')}</p></div>}
        {exportError && <div className="wks-banner bad" role="alert"><AlertTriangle size={17} aria-hidden="true" /><p>{exportError}</p></div>}

        {error ? (
          <div className="wks-banner bad" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <div>
              <strong>{m('loadErrorTitle')}</strong>
              <p>{error}</p>
              <button type="button" className="cc-btn-ghost wks-tap" onClick={load}>
                <RotateCcw size={14} aria-hidden="true" /> {m('retry')}
              </button>
            </div>
          </div>
        ) : loading && !rows.length ? (
          <div className="wks-av-skel" role="status" aria-live="polite">
            <span className="wks-sr">{m('loading')}</span>
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 34 }} />)}
          </div>
        ) : !rows.length ? (
          <div className="wks-empty">
            <h2 className="wks-h">{m('emptyTitle')}</h2>
            <p className="wks-muted">{m('emptyBody')}</p>
          </div>
        ) : !shown.length ? (
          <div className="wks-empty">
            <h2 className="wks-h">{m('noMatchesTitle')}</h2>
            <p className="wks-muted">{m('noMatchesBody')}</p>
          </div>
        ) : (
          <>
            <div className="wks-av-table-wrap wks-desktop">
              <table className="wks-av-table" aria-label={m('title')}>
                <thead>
                  <tr>
                    <th scope="col">{m('col.asset_no')}</th>
                    <th scope="col">{m('col.status')}</th>
                    <th scope="col">{m('col.removed_at')}</th>
                    <th scope="col">{m('col.removed_reason')}</th>
                    <th scope="col">{m('col.previous_stage')}</th>
                    <th scope="col">{m('col.previous_responsible')}</th>
                    <th scope="col">{m('col.disposition')}</th>
                    <th scope="col"><span className="wks-sr">{m('col.actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">
                        <span className="wks-rm-asset">{r.asset_no}</span>
                        <span className="wks-muted wks-rm-sub">{r.site || m('na')}</span>
                      </th>
                      <td>{statusPill(r)}</td>
                      <td>
                        {r.removed_at ? fmtDateTime(r.removed_at) : m('na')}
                        <span className="wks-muted wks-rm-sub">{m('byUpload', { upload: uploadLabel(r.removed_by_upload) })}</span>
                      </td>
                      <td>{reasonLabel(r.removed_reason)}</td>
                      <td>
                        {r.previous_current_stage || m('na')}
                        {r.previous_delay_reason && <span className="wks-muted wks-rm-sub">{r.previous_delay_reason}</span>}
                      </td>
                      <td>{r.previous_responsible_name || m('na')}</td>
                      <td>
                        {dispLabel(r.final_disposition)}
                        {r.final_disposition_by_name && (
                          <span className="wks-muted wks-rm-sub">
                            {m('dispositionBy', { name: r.final_disposition_by_name, at: fmtDateTime(r.final_disposition_at) })}
                          </span>
                        )}
                      </td>
                      <td>{actionButtons(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="wks-cards">
              {shown.map((r) => (
                <li key={r.id} className="wks-item">
                  <div className="wks-act-card-head"><strong>{r.asset_no}</strong> {statusPill(r)}</div>
                  <div className="wks-item-row"><span className="wks-item-k">{m('col.site')}</span><span className="wks-item-v">{r.site || m('na')}</span></div>
                  <div className="wks-item-row"><span className="wks-item-k">{m('col.removed_at')}</span><span className="wks-item-v">{r.removed_at ? fmtDateTime(r.removed_at) : m('na')}</span></div>
                  <div className="wks-item-row"><span className="wks-item-k">{m('col.removed_by_upload')}</span><span className="wks-item-v">{uploadLabel(r.removed_by_upload)}</span></div>
                  <div className="wks-item-row"><span className="wks-item-k">{m('col.removed_reason')}</span><span className="wks-item-v">{reasonLabel(r.removed_reason)}</span></div>
                  <div className="wks-item-row"><span className="wks-item-k">{m('col.previous_stage')}</span><span className="wks-item-v">{r.previous_current_stage || m('na')}</span></div>
                  <div className="wks-item-row"><span className="wks-item-k">{m('col.previous_responsible')}</span><span className="wks-item-v">{r.previous_responsible_name || m('na')}</span></div>
                  <div className="wks-item-row"><span className="wks-item-k">{m('col.disposition')}</span><span className="wks-item-v">{dispLabel(r.final_disposition)}</span></div>
                  {actionButtons(r)}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {dialog && (
        <ActionDialog
          record={dialog.record}
          action={dialog.action}
          m={m}
          onClose={() => setDialog(null)}
          onDone={() => onDone(dialog.action)}
          onStale={() => { setDialog(null); load() }}
        />
      )}
    </div>
  )
}

function ActionDialog({ record, action, m, onClose, onDone, onStale }) {
  const [reason, setReason] = useState('')
  const [disposition, setDisposition] = useState(record.final_disposition || '')
  const [remarks, setRemarks] = useState(record.final_disposition_remarks || '')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [stale, setStale] = useState(false)

  const isDisp = action === 'disposition'
  const reasonOk = !needsReason(action) || reasonValid(reason)
  const dispOk = !isDisp || (disposition && (disposition !== DISPOSITION_OTHER || remarks.trim().length > 0))
  const valid = reasonOk && dispOk

  const submit = async (e) => {
    e?.preventDefault?.()
    setTouched(true)
    if (!valid || saving) return
    setSaving(true); setErr('')
    try {
      await runRecordAction(record.id, action, {
        reason: needsReason(action) ? reason : null,
        disposition: isDisp ? disposition : null,
        remarks: isDisp ? remarks : null,
        expectedUpdatedAt: record.updated_at,
      })
      onDone()
    } catch (error) {
      if (error?.code === 'record_changed') { setStale(true); setErr(m('errors.record_changed')) } else if (['already_active', 'not_found', 'denied'].includes(error?.code)) setErr(m(`errors.${error.code}`))
      else if (error?.code === 'invalid') setErr(error.message)
      else setErr(toUserMessage(error, m('errors.generic')))
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <div className="wks-rm-footer">
      <button type="button" className="cc-btn-ghost wks-tap" onClick={onClose} disabled={saving}>{m('cancel')}</button>
      {stale ? (
        <button type="button" className="cc-btn wks-tap" onClick={onStale}>{m('reload')}</button>
      ) : (
        <button type="submit" form="wks-rm-form" className={`cc-btn wks-tap ${DANGER.has(action) ? 'wks-rm-danger-btn' : ''}`} disabled={saving}>
          {saving && <Loader2 size={14} className="wks-spin" aria-hidden="true" />} {m(`confirm.${action}`)}
        </button>
      )}
    </div>
  )

  return (
    <Modal open onClose={saving ? () => {} : onClose} title={m(`dialog.${action}.title`, { asset: record.asset_no })}
      subtitle={m(`dialog.${action}.body`)} size="md" footer={footer}>
      <form id="wks-rm-form" className="wks-rm-form" onSubmit={submit} noValidate>
        {err && <div className="wks-banner bad" role="alert"><AlertTriangle size={16} aria-hidden="true" /><p>{err}</p></div>}
        {isDisp && (
          <>
            <label className="cc-field">
              <span>{m('col.disposition')}</span>
              <select className="cc-select wks-tap" value={disposition} onChange={(e) => setDisposition(e.target.value)}
                aria-invalid={touched && !disposition}>
                <option value="">{m('chooseDisposition')}</option>
                {DISPOSITIONS.map((d) => <option key={d} value={d}>{m(`disposition.${d}`)}</option>)}
              </select>
            </label>
            {touched && !disposition && <span className="wks-upd-err" role="alert">{m('errors.chooseDisposition')}</span>}
            <label className="cc-field">
              <span>{disposition === DISPOSITION_OTHER ? m('remarksRequired') : m('remarks')}</span>
              <textarea className="wks-upd-control wks-upd-text" rows={3} maxLength={2000} value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                aria-invalid={touched && disposition === DISPOSITION_OTHER && !remarks.trim()} />
            </label>
            {touched && disposition === DISPOSITION_OTHER && !remarks.trim() && (
              <span className="wks-upd-err" role="alert">{m('errors.remarksRequired')}</span>
            )}
          </>
        )}
        {needsReason(action) && (
          <>
            <label className="cc-field">
              <span>{m('reason')}</span>
              <textarea className="wks-upd-control wks-upd-text" rows={3} maxLength={1000} value={reason}
                placeholder={m(`reasonPlaceholder.${action}`)} onChange={(e) => setReason(e.target.value)}
                aria-invalid={touched && !reasonValid(reason)} />
            </label>
            {touched && !reasonValid(reason) && (
              <span className="wks-upd-err" role="alert">{m('errors.reasonShort', { n: MIN_REASON })}</span>
            )}
          </>
        )}
        <p className="wks-muted">{m(`dialog.${action}.note`)}</p>
      </form>
    </Modal>
  )
}
