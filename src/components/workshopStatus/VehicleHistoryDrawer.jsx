/**
 * Vehicle History Drawer (Workshop Status, Loop 9, spec section 14).
 *
 * The audit trail of ONE workshop vehicle: Excel imports, manual updates,
 * field changes, assignments, ETA changes, attachments, removal / release,
 * restore and final disposition, each with who, when, source and old -> new.
 *
 * Strictly READ ONLY. The history table is append-only in the database, and
 * this drawer offers no edit or delete control of any kind.
 *
 * Props: { record, open, onClose }
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Download, History, Loader2, Lock, RefreshCw } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import { listRecordHistory, resolveHistoryNames } from '../../lib/api/workshopStatusHistory'
import {
  HISTORY_CATEGORIES, groupHistory, filterEntries, categoryCounts, formatValue, fieldLabel,
  historyExportRows, CATEGORY_LABELS, SOURCE_LABELS,
} from '../../lib/workshopStatus/history'
import './workshopStatus.css'
import './vehicleHistory.css'

const PAGE = 60
const EXPORT_PAGE = 200
const EXPORT_MAX_PAGES = 25
const SUMMARY_ORDER = [
  'permanently_deleted', 'soft_deleted', 'undeleted', 'removed', 'restored', 'archived', 'unarchived',
  'final_disposition', 'attachment_added', 'attachment_removed', 'added', 'excel_updated', 'manual_update', 'export',
]

function formatWhen(ts, language) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleString(language === 'ar' ? 'ar' : 'en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

export default function VehicleHistoryDrawer({ record, open, onClose }) {
  const { t, language } = useLanguage()
  const h = useCallback((k, v) => t(`workshopStatusHistory.drawer.${k}`, v), [t])
  const tr = useCallback((key, fallback) => {
    const s = t(key)
    return !s || s === key ? fallback : s
  }, [t])

  const recordId = record?.id || null
  const [events, setEvents] = useState([])
  const [names, setNames] = useState({})
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [cursor, setCursor] = useState({ hasMore: false, before: null, inclusive: false })
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [namesError, setNamesError] = useState(false)
  const [filter, setFilter] = useState('all')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const reqRef = useRef(0)

  const addNames = useCallback(async (rows) => {
    try {
      const map = await resolveHistoryNames(rows)
      setNames((prev) => ({ ...prev, ...map }))
    } catch {
      setNamesError(true)
    }
  }, [])

  const load = useCallback(async () => {
    if (!recordId) return
    const req = ++reqRef.current
    setStatus('loading'); setError(''); setMoreError(''); setNamesError(false)
    try {
      const res = await listRecordHistory(recordId, { limit: PAGE })
      if (req !== reqRef.current) return
      setEvents(res.events)
      setCursor({ hasMore: res.hasMore, before: res.nextBefore, inclusive: res.nextInclusive })
      setStatus('ready')
      addNames(res.events)
    } catch (err) {
      if (req !== reqRef.current) return
      setError(toUserMessage(err, h('error')))
      setStatus('error')
    }
  }, [recordId, h, addNames])

  useEffect(() => {
    if (!open) return
    setEvents([]); setNames({}); setFilter('all'); setExportError('')
    load()
  }, [open, load])

  const loadMore = async () => {
    if (!cursor.hasMore || loadingMore) return
    const req = reqRef.current
    setLoadingMore(true); setMoreError('')
    try {
      const res = await listRecordHistory(recordId, { limit: PAGE, before: cursor.before, inclusive: cursor.inclusive })
      if (req !== reqRef.current) return
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id))
        return [...prev, ...res.events.filter((e) => !seen.has(e.id))]
      })
      setCursor({ hasMore: res.hasMore, before: res.nextBefore, inclusive: res.nextInclusive })
      addNames(res.events)
    } catch (err) {
      setMoreError(toUserMessage(err, h('moreError')))
    } finally {
      setLoadingMore(false)
    }
  }

  const entries = useMemo(() => groupHistory(events), [events])
  const counts = useMemo(() => categoryCounts(entries), [entries])
  const shown = useMemo(() => filterEntries(entries, filter), [entries, filter])

  const valueLabels = useMemo(() => ({
    blank: h('blank'), yes: h('yes'), no: h('no'), unknownPerson: h('unknownPerson'),
  }), [h])
  const fieldName = (f) => tr(`workshopStatusHistory.fields.${f}`, fieldLabel(f))
  const catName = (c) => tr(`workshopStatusHistory.categories.${c}`, CATEGORY_LABELS[c] || c)
  const srcName = (s) => tr(`workshopStatusHistory.sources.${s}`, SOURCE_LABELS[s] || SOURCE_LABELS.system)
  const show = (field, value) => formatValue(field, value, { userNames: names, labels: valueLabels })

  const summaryOf = (entry) => {
    if (entry.reason) {
      const r = tr(`workshopStatusHistory.reasons.${entry.reason}`, '')
      if (r) return r
    }
    const type = SUMMARY_ORDER.find((x) => entry.eventTypes.includes(x))
    if (type) return tr(`workshopStatusHistory.events.${type}`, entry.message || '')
    return entry.message || entry.reason || ''
  }

  const doExport = async () => {
    if (exporting) return
    setExporting(true); setExportError('')
    try {
      let all = events
      let cur = cursor
      let pages = 0
      while (cur.hasMore && pages < EXPORT_MAX_PAGES) {
        const res = await listRecordHistory(recordId, { limit: EXPORT_PAGE, before: cur.before, inclusive: cur.inclusive })
        const seen = new Set(all.map((e) => e.id))
        all = [...all, ...res.events.filter((e) => !seen.has(e.id))]
        cur = { hasMore: res.hasMore, before: res.nextBefore, inclusive: res.nextInclusive }
        pages += 1
      }
      let userNames = names
      try { userNames = { ...names, ...(await resolveHistoryNames(all)) } } catch { /* names stay as loaded */ }
      const rows = historyExportRows(filterEntries(groupHistory(all), filter), {
        userNames, labels: valueLabels, fieldLabel: fieldName, categoryLabel: catName, sourceLabel: srcName,
      })
      const { exportToExcel, reportFileName, reportDateLabel } = await import('../../lib/exportUtils')
      const cols = ['at', 'actor', 'source', 'category', 'field', 'old_value', 'new_value', 'reason']
      const headers = [h('colAt'), h('colActor'), h('colSource'), h('colCategory'), h('colField'), h('colOld'), h('colNew'), h('colReason')]
      await exportToExcel(rows, cols, headers,
        reportFileName('TyrePulse Workshop History', record?.asset_no || '', reportDateLabel()), 'History')
    } catch (err) {
      setExportError(toUserMessage(err, h('exportError')))
    } finally {
      setExporting(false)
    }
  }

  if (!record) return null

  const chips = ['all', ...HISTORY_CATEGORIES.filter((c) => counts[c] > 0)]

  const footer = (
    <div className="cc wks-his-foot">
      <button type="button" className="cc-btn-ghost wks-tap" onClick={onClose}>{h('closeButton')}</button>
      <button type="button" className="cc-btn-ghost wks-tap" onClick={doExport}
        disabled={exporting || status !== 'ready' || !entries.length}>
        {exporting ? <Loader2 size={14} className="wks-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
        {' '}{exporting ? h('exporting') : h('export')}
      </button>
    </div>
  )

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      size="lg"
      closeLabel={h('close')}
      title={h('title', { asset: record.asset_no || '' })}
      subtitle={h('subtitle', { site: record.site || '-', country: record.country || '-' })}
      footer={footer}
    >
      <div className="cc wks-his">
        <p className="wks-his-note"><Lock size={13} aria-hidden="true" /> {h('readOnly')}</p>

        {status === 'loading' && (
          <div className="wks-his-state" role="status"><Loader2 size={18} className="wks-spin" aria-hidden="true" /> {h('loading')}</div>
        )}

        {status === 'error' && (
          <div className="wks-banner bad" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <p>{error || h('error')}</p>
              <button type="button" className="cc-btn-ghost wks-tap" onClick={load}>
                <RefreshCw size={14} aria-hidden="true" /> {h('retry')}
              </button>
            </div>
          </div>
        )}

        {status === 'ready' && !entries.length && (
          <div className="wks-his-state" data-testid="wks-his-empty"><History size={18} aria-hidden="true" /> {h('empty')}</div>
        )}

        {status === 'ready' && entries.length > 0 && (
          <>
            <div className="wks-his-chips" role="group" aria-label={h('filterLabel')}>
              {chips.map((c) => (
                <button key={c} type="button" className={`wks-his-chip${filter === c ? ' on' : ''}`}
                  aria-pressed={filter === c} onClick={() => setFilter(c)}>
                  {c === 'all' ? h('filterAll') : catName(c)}
                  <span className="wks-his-count">{c === 'all' ? entries.length : counts[c]}</span>
                </button>
              ))}
            </div>

            {namesError && <p className="wks-his-warn" role="status">{h('namesError')}</p>}
            {exportError && <p className="wks-his-warn" role="alert">{exportError}</p>}

            {!shown.length ? (
              <div className="wks-his-state">{h('emptyFilter')}</div>
            ) : (
              <ol className="wks-his-list" data-testid="wks-his-timeline">
                {shown.map((e) => {
                  const summary = summaryOf(e)
                  return (
                    <li key={e.key} className={`wks-his-entry cat-${e.category}`}>
                      <div className="wks-his-head">
                        <strong className="wks-his-actor">{e.actorName || h('system')}</strong>
                        <time className="wks-his-time" dateTime={e.at || undefined}>{formatWhen(e.at, language)}</time>
                        <span className={`wks-his-source src-${e.source}`}>{srcName(e.source)}</span>
                      </div>
                      <div className="wks-his-tags">
                        {e.categories.map((c) => <span key={c} className="wks-his-tag">{catName(c)}</span>)}
                      </div>
                      {summary && <p className="wks-his-summary">{summary}</p>}
                      {e.changes.length > 0 && (
                        <ul className="wks-his-changes">
                          {e.changes.map((c, i) => (
                            <li key={`${c.field}-${i}`} className="wks-his-change">
                              <span className="wks-his-field">{fieldName(c.field)}</span>
                              <span className="wks-his-old">{show(c.field, c.oldValue)}</span>
                              <ArrowRight size={12} className="wks-his-arrow" aria-label={h('changedTo')} />
                              <span className="wks-his-new">{show(c.field, c.newValue)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}

            {moreError && <p className="wks-his-warn" role="alert">{moreError}</p>}
            {cursor.hasMore && (
              <button type="button" className="cc-btn-ghost wks-tap wks-his-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? h('loadingMore') : h('loadMore')}
              </button>
            )}
          </>
        )}
      </div>
    </SideDrawer>
  )
}
