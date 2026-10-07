/**
 * ActivityLogPanel - Daily Ops -> Workshop Status -> Activity log (Loop 10,
 * spec section 15 "Who Worked on What").
 *
 * Answers who updated which vehicle, what they changed (field old -> new),
 * when, at which site, which action and which upload. Reads the append-only
 * workshop_status_events table through RLS (full log needs view_activity),
 * newest first, keyset paged with "Load more".
 *
 * Server filters: date range, user, vehicle, site, action type, upload.
 * Client filters (on the vehicle's CURRENT values): stage and delay reason.
 * Excel export of the rows on screen when the server granted `export`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, RotateCcw, ShieldAlert, AlertTriangle, SlidersHorizontal, Download, Search, X,
} from 'lucide-react'
import { Card } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { listActivity, listRecentUploads, ACTIVITY_PAGE_SIZE } from '../../lib/api/workshopStatusActivity'
import { CURRENT_STAGES, DELAY_REASONS } from '../../lib/workshopStatus/vocab'
import { fmtDateTime, fmtDay, localDay } from '../../lib/workshopStatus/activeView'
import {
  ACTION_GROUP_KEYS, formatValue, filterActivity, actorOptions, distinctOf,
  actorSummary, dayRangeToIso, daysAgo, emptyActivityFilters,
} from '../../lib/workshopStatus/activityView'
import './workshopStatus.css'
import './activeVehicles.css'
import './activity.css'

const DEFAULT_DAYS = 7

function initialServerFilters(now = new Date()) {
  return { from: daysAgo(now, DEFAULT_DAYS), to: localDay(now), userId: '', assetNo: '', site: '', eventType: '', uploadId: '' }
}

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

export default function ActivityLogPanel({ permissions, permState = 'ready', onRetryPermissions }) {
  const { t } = useLanguage()
  const l = useCallback((k, v) => t(`workshopStatusActivity.log.${k}`, v), [t])
  const { activeCountry } = useSettings()
  const isAll = !activeCountry || activeCountry === 'All'
  const country = isAll ? '' : activeCountry

  const [server, setServer] = useState(() => initialServerFilters())
  const [assetText, setAssetText] = useState('')
  const [client, setClient] = useState(emptyActivityFilters)
  const [showFilters, setShowFilters] = useState(true)
  const [rows, setRows] = useState([])
  const [people, setPeople] = useState(() => new Map())
  const [cursor, setCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [uploads, setUploads] = useState([])
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [knownActors, setKnownActors] = useState(() => new Map())
  const runRef = useRef(0)

  const canView = permissions?.view === true && permissions?.view_activity === true
  const canExport = permissions?.export === true

  const query = useMemo(() => {
    const { from, to } = dayRangeToIso(server.from, server.to)
    return {
      from, to, userId: server.userId, assetNo: server.assetNo, site: server.site,
      eventType: server.eventType, uploadId: server.uploadId, country, limit: ACTIVITY_PAGE_SIZE,
    }
  }, [server, country])

  const rememberActors = (list) => setKnownActors((cur) => {
    const next = new Map(cur)
    for (const a of actorOptions(list)) if (!next.has(a.id)) next.set(a.id, a.name)
    return next
  })

  const load = useCallback(async () => {
    const run = ++runRef.current
    setLoading(true); setError('')
    try {
      const res = await listActivity(query)
      if (run !== runRef.current) return
      setRows(res.rows || [])
      setPeople(res.people instanceof Map ? res.people : new Map())
      setCursor(res.nextCursor || null)
      setHasMore(Boolean(res.hasMore))
      rememberActors(res.rows || [])
    } catch (err) {
      if (run !== runRef.current) return
      setError(toUserMessage(err, l('loadError')))
      setRows([]); setHasMore(false); setCursor(null)
    } finally {
      if (run === runRef.current) setLoading(false)
    }
  }, [query, l])

  const loadMore = async () => {
    if (!cursor || loadingMore) return
    const run = runRef.current
    setLoadingMore(true)
    try {
      const res = await listActivity({ ...query, before: cursor })
      if (run !== runRef.current) return
      setRows((cur) => [...cur, ...(res.rows || [])])
      if (res.people instanceof Map) setPeople((cur) => new Map([...cur, ...res.people]))
      setCursor(res.nextCursor || null)
      setHasMore(Boolean(res.hasMore))
      rememberActors(res.rows || [])
    } catch (err) {
      if (run !== runRef.current) return
      setError(toUserMessage(err, l('loadError')))
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (permState !== 'ready' || !canView) return
    load()
  }, [load, permState, canView])

  useEffect(() => {
    if (permState !== 'ready' || !canView) return
    let alive = true
    listRecentUploads({ country }).then((list) => { if (alive) setUploads(list || []) }).catch(() => { if (alive) setUploads([]) })
    return () => { alive = false }
  }, [country, permState, canView])

  // Vehicle text is applied after a short pause so typing does not fire a read per key.
  useEffect(() => {
    const id = setTimeout(() => {
      setServer((s) => (s.assetNo === assetText.trim() ? s : { ...s, assetNo: assetText.trim() }))
    }, 400)
    return () => clearTimeout(id)
  }, [assetText])

  const setS = (k, v) => setServer((s) => ({ ...s, [k]: v }))
  const setC = (k, v) => setClient((c) => ({ ...c, [k]: v }))
  const defaults = initialServerFilters()
  const nFilters = ['userId', 'assetNo', 'site', 'eventType', 'uploadId'].filter((k) => !blank(server[k])).length
    + (server.from !== defaults.from || server.to !== defaults.to ? 1 : 0)
    + (client.status ? 1 : 0) + (client.delayReason ? 1 : 0)
  const clearFilters = () => { setServer(initialServerFilters()); setAssetText(''); setClient(emptyActivityFilters()) }

  const shown = useMemo(() => filterActivity(rows, client), [rows, client])
  const actors = useMemo(() => [...knownActors].map(([id, name]) => ({ id, name }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))), [knownActors])
  const siteOptions = useMemo(() => {
    const list = distinctOf(rows, 'site')
    if (server.site && !list.includes(server.site)) list.push(server.site)
    return list
  }, [rows, server.site])
  const summary = useMemo(() => actorSummary(shown), [shown])

  // ── Text for one row (shared by table, cards and export) ──────────────────
  const fmtOpts = useMemo(() => ({ people, unknownPerson: l('unknownPerson'), yes: l('yes'), no: l('no') }), [people, l])
  const fieldLabel = (f) => (f ? l(`fields.${f}`) : null)
  const who = (r) => (r.isSystem ? l('system') : (r.actorName || l('unknownPerson')))
  const actionLabel = (r) => l(`actions.${r.group}`)
  const uploadText = (r) => {
    if (!r.uploadId) return null
    return [r.uploadNo != null ? l('uploadNo', { no: r.uploadNo }) : null, r.uploadFile].filter(Boolean).join(', ') || null
  }

  function change(r) {
    if (r.field) {
      return {
        field: fieldLabel(r.field),
        from: formatValue(r.field, r.oldValue, fmtOpts),
        to: formatValue(r.field, r.newValue, fmtOpts),
      }
    }
    return null
  }

  function detailText(r) {
    const c = change(r)
    if (c) return l('detail.fieldChange', { field: c.field, from: c.from ?? l('na'), to: c.to ?? l('na') })
    const d = r.details || {}
    switch (r.eventType) {
      case 'manual_update': {
        const fields = Array.isArray(d.changed_fields) ? d.changed_fields : []
        const n = Number(d.changed) || fields.length
        const names = fields.map((f) => l(`fields.${f}`)).join(', ')
        return [l('detail.fieldsChanged', { n }), names].filter(Boolean).join(': ')
      }
      case 'upload_previewed':
        return d.rows != null ? l('detail.rowsInFile', { n: d.rows }) : (d.file_name || l('detail.noDetail'))
      case 'upload_confirmed':
        return l('detail.uploadSummary', { added: d.new ?? 0, updated: d.updated ?? 0, removed: d.removed ?? 0 })
      case 'excel_updated':
        return l('detail.excelRefresh')
      default:
        return d.message || r.reason || d.file_name || l('detail.noDetail')
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  const exportExcel = async () => {
    if (!shown.length || exporting) return
    setExporting(true); setExportError('')
    try {
      const keys = ['time', 'who', 'vehicle', 'action', 'field', 'from', 'to', 'change', 'site', ...(isAll ? ['country'] : []), 'upload']
      const headers = keys.map((k) => l(`col.${k}`))
      const data = shown.map((r) => {
        const c = change(r)
        return {
          time: fmtDateTime(r.at) || '',
          who: who(r),
          vehicle: r.assetNo || '',
          action: actionLabel(r),
          field: c?.field || '',
          from: c?.from || '',
          to: c?.to || '',
          change: detailText(r),
          site: r.site || '',
          country: r.country || '',
          upload: uploadText(r) || '',
        }
      })
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      await exportToExcel(data, keys, headers,
        reportFileName('Workshop Activity Log', isAll ? 'All countries' : country, server.from, server.to),
        'Activity log', { title: l('exportTitle') })
    } catch (err) {
      setExportError(toUserMessage(err, l('exportError')))
    } finally {
      setExporting(false)
    }
  }

  // ── Permission states ─────────────────────────────────────────────────────
  if (permState === 'loading') {
    return (
      <Card>
        <div className="wks-state" role="status" aria-live="polite">
          <Loader2 size={18} className="wks-spin" aria-hidden="true" /> {l('loadingPerms')}
        </div>
      </Card>
    )
  }
  if (!canView) {
    return (
      <Card>
        <div className="wks-state wks-state-col" role="alert">
          <ShieldAlert size={26} aria-hidden="true" className="wks-ico-warn" />
          <h2 className="wks-h">{l('deniedTitle')}</h2>
          <p className="wks-muted">{l('deniedBody')}</p>
          {permState === 'error' && onRetryPermissions && (
            <button type="button" className="cc-btn-ghost wks-tap" onClick={onRetryPermissions}>
              <RotateCcw size={14} aria-hidden="true" /> {l('retry')}
            </button>
          )}
        </div>
      </Card>
    )
  }

  const renderChange = (r) => {
    const c = change(r)
    if (!c) return <span className="wks-act-detail">{detailText(r)}</span>
    return (
      <span className="wks-act-change">
        <span className="wks-act-field">{c.field}</span>
        <span className="wks-act-vals">
          <span className="wks-act-old">{c.from ?? <span className="cc-na">{l('na')}</span>}</span>
          <span aria-hidden="true" className="wks-act-arrow">{'→'}</span>
          <span className="wks-sr">{l('col.to')}</span>
          <span className="wks-act-new">{c.to ?? <span className="cc-na">{l('na')}</span>}</span>
        </span>
      </span>
    )
  }
  const na = <span className="cc-na">{l('na')}</span>

  return (
    <div className="wks-panel">
      <Card title={l('title')} sub={l('lead')}>
        <div className="wks-av-toolbar">
          <label className="cc-search wks-search wks-av-search">
            <Search size={14} aria-hidden="true" />
            <span className="wks-sr">{l('vehicle')}</span>
            <input type="search" value={assetText} placeholder={l('vehiclePlaceholder')}
              aria-label={l('vehicle')} onChange={(e) => setAssetText(e.target.value)} />
            {assetText && (
              <button type="button" className="wks-clear" aria-label={t('common.clearSearch')} onClick={() => setAssetText('')}>
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </label>
          <div className="wks-av-tools">
            <button type="button" className={`cc-btn-ghost wks-tap ${showFilters ? 'is-on' : ''}`} aria-expanded={showFilters}
              onClick={() => setShowFilters((s) => !s)}>
              <SlidersHorizontal size={14} aria-hidden="true" /> {nFilters ? l('filtersCount', { n: nFilters }) : l('filters')}
            </button>
            {canExport && (
              <button type="button" className="cc-btn-ghost wks-tap" onClick={exportExcel} disabled={!shown.length || exporting}>
                {exporting ? <Loader2 size={14} className="wks-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} {l('export')}
              </button>
            )}
            <button type="button" className="cc-btn-ghost wks-tap" onClick={load} disabled={loading} aria-label={l('refresh')}>
              <RotateCcw size={14} aria-hidden="true" className={loading ? 'wks-spin' : ''} />
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="wks-av-filters" data-testid="wks-act-filters">
            <label className="cc-field">
              <span>{l('from')}</span>
              <input type="date" className="cc-select wks-tap wks-act-date" value={server.from} max={server.to || undefined}
                onChange={(e) => setS('from', e.target.value)} />
            </label>
            <label className="cc-field">
              <span>{l('to')}</span>
              <input type="date" className="cc-select wks-tap wks-act-date" value={server.to} min={server.from || undefined}
                onChange={(e) => setS('to', e.target.value)} />
            </label>
            <label className="cc-field">
              <span>{l('user')}</span>
              <select className="cc-select wks-tap" value={server.userId} onChange={(e) => setS('userId', e.target.value)}>
                <option value="">{l('any')}</option>
                {actors.map((a) => <option key={a.id} value={a.id}>{a.name || l('unknownPerson')}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>{l('site')}</span>
              <select className="cc-select wks-tap" value={server.site} onChange={(e) => setS('site', e.target.value)}>
                <option value="">{l('any')}</option>
                {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>{l('action')}</span>
              <select className="cc-select wks-tap" value={server.eventType} onChange={(e) => setS('eventType', e.target.value)}>
                <option value="">{l('any')}</option>
                {ACTION_GROUP_KEYS.map((k) => <option key={k} value={k}>{l(`actions.${k}`)}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>{l('upload')}</span>
              <select className="cc-select wks-tap" value={server.uploadId} onChange={(e) => setS('uploadId', e.target.value)}>
                <option value="">{l('any')}</option>
                {uploads.map((u) => (
                  <option key={u.id} value={u.id}>
                    {[l('uploadNo', { no: u.upload_no }), u.file_name, fmtDay(u.report_date || u.uploaded_at)].filter(Boolean).join(', ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="cc-field">
              <span>{l('status')}</span>
              <select className="cc-select wks-tap" value={client.status} onChange={(e) => setC('status', e.target.value)}>
                <option value="">{l('any')}</option>
                {CURRENT_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>{l('delayReason')}</span>
              <select className="cc-select wks-tap" value={client.delayReason} onChange={(e) => setC('delayReason', e.target.value)}>
                <option value="">{l('any')}</option>
                {DELAY_REASONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <button type="button" className="cc-btn-ghost wks-tap" onClick={clearFilters} disabled={!nFilters && !assetText}>
              {l('clearFilters')}
            </button>
            {(client.status || client.delayReason) && <p className="wks-muted wks-act-note">{l('statusClientNote')}</p>}
          </div>
        )}

        {exportError && (
          <div className="wks-banner bad" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <p>{exportError}</p>
          </div>
        )}

        {error && !rows.length ? (
          <div className="wks-banner bad" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <div>
              <strong>{l('loadErrorTitle')}</strong>
              <p>{error}</p>
              <button type="button" className="cc-btn-ghost wks-tap" onClick={load}>
                <RotateCcw size={14} aria-hidden="true" /> {l('retry')}
              </button>
            </div>
          </div>
        ) : loading && !rows.length ? (
          <div className="wks-av-skel" role="status" aria-live="polite">
            <span className="wks-sr">{l('loading')}</span>
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 34 }} />)}
          </div>
        ) : !rows.length ? (
          <div className="wks-empty">
            <h2 className="wks-h">{l('emptyTitle')}</h2>
            <p className="wks-muted">{l('emptyBody')}</p>
          </div>
        ) : !shown.length ? (
          <div className="wks-empty">
            <h2 className="wks-h">{l('noMatchesTitle')}</h2>
            <p className="wks-muted">{l('noMatchesBody')}</p>
            <button type="button" className="cc-btn-ghost wks-tap" onClick={clearFilters}>{l('clearFilters')}</button>
          </div>
        ) : (
          <>
            <p className="wks-muted wks-av-count" aria-live="polite">
              {l('showingCount', { shown: shown.length, total: rows.length })}
              {hasMore ? ` ${l('moreAvailable')}` : ''}
            </p>

            {summary.length > 0 && (
              <div className="wks-act-people" aria-label={l('byPerson')}>
                {summary.slice(0, 8).map((s) => (
                  <span key={s.id} className="wks-act-chip">
                    <strong>{s.isSystem ? l('system') : (s.name || l('unknownPerson'))}</strong>
                    <span className="wks-muted">{l('byPersonCount', { events: s.events, vehicles: s.vehicles })}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="wks-av-table-wrap wks-desktop">
              <table className="wks-av-table" aria-label={l('title')}>
                <thead>
                  <tr>
                    <th scope="col">{l('col.time')}</th>
                    <th scope="col">{l('col.who')}</th>
                    <th scope="col">{l('col.vehicle')}</th>
                    <th scope="col">{l('col.change')}</th>
                    <th scope="col">{l('col.site')}</th>
                    {isAll && <th scope="col">{l('col.country')}</th>}
                    <th scope="col">{l('col.action')}</th>
                    <th scope="col">{l('col.upload')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td className="wks-act-time">{fmtDateTime(r.at) || na}</td>
                      <td>{r.isSystem ? <span className="wks-muted">{l('system')}</span> : who(r)}</td>
                      <th scope="row">{r.assetNo ? <span className="wks-mono">{r.assetNo}</span> : na}</th>
                      <td className="wks-act-c-change">{renderChange(r)}</td>
                      <td>{r.site || na}</td>
                      {isAll && <td>{r.country || na}</td>}
                      <td><span className={`cc-pill wks-act-pill g-${r.group}`}>{actionLabel(r)}</span></td>
                      <td>{uploadText(r) || na}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="wks-cards wks-act-cards">
              {shown.map((r) => (
                <li key={r.id} className="wks-item">
                  <div className="wks-act-card-head">
                    <span className="wks-mono">{r.assetNo || l('na')}</span>
                    <span className={`cc-pill wks-act-pill g-${r.group}`}>{actionLabel(r)}</span>
                  </div>
                  <div className="wks-item-row"><span className="wks-item-k">{l('col.who')}</span><span className="wks-item-v">{who(r)}</span></div>
                  <div className="wks-item-row"><span className="wks-item-k">{l('col.time')}</span><span className="wks-item-v">{fmtDateTime(r.at) || l('na')}</span></div>
                  <div className="wks-item-row"><span className="wks-item-k">{l('col.change')}</span><span className="wks-item-v">{detailText(r)}</span></div>
                  {r.site && <div className="wks-item-row"><span className="wks-item-k">{l('col.site')}</span><span className="wks-item-v">{r.site}</span></div>}
                  {uploadText(r) && <div className="wks-item-row"><span className="wks-item-k">{l('col.upload')}</span><span className="wks-item-v">{uploadText(r)}</span></div>}
                </li>
              ))}
            </ul>

            {error && (
              <div className="wks-banner bad" role="alert">
                <AlertTriangle size={17} aria-hidden="true" />
                <p>{error}</p>
              </div>
            )}

            {hasMore && (
              <div className="wks-act-more">
                <button type="button" className="cc-btn-ghost wks-tap" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? <><Loader2 size={14} className="wks-spin" aria-hidden="true" /> {l('loadingMore')}</> : l('loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

