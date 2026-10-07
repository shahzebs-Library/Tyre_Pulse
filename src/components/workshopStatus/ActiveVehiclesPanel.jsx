/**
 * ActiveVehiclesPanel - Daily Ops -> Workshop Status -> Active Vehicles (Loop 7).
 *
 * The primary daily working screen: every vehicle currently in the workshop
 * report for the chosen country, with KPI tiles, search, filters, sorting,
 * configurable columns (saved per browser), row expansion for the remaining
 * fields, stacked cards on a phone, paging and an Excel export of exactly the
 * rows on screen.
 *
 * Country follows the working context: one country, or All = every country the
 * caller may see (RLS decides) with a Country column.
 *
 * The Update action is shown only when the server granted `update`; it calls
 * `onUpdate(record)` and never edits anything itself (the update drawer owns
 * writes). `reloadKey` changing reloads the list (after a save, for example).
 *
 * Last updated by / at are the server-captured name and time, never typed text.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Truck, Clock, AlertTriangle, CalendarCheck, UserX, Hourglass, Loader2, RotateCcw, Search, X,
  SlidersHorizontal, Columns, Download, ChevronDown, ChevronRight, PencilLine, ShieldAlert,
} from 'lucide-react'
import { Card, Kpi, Pager, fmtInt } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { loadActiveVehicles } from '../../lib/api/workshopStatusActive'
import { CURRENT_STAGES, DELAY_REASONS, PARTS_STATUSES } from '../../lib/workshopStatus/vocab'
import {
  daysDown, freshness, lastUpdate, fmtDay, fmtDateTime, filterRecords, sortRecords, summarize,
  emptyFilters, activeFilterCount, vocabOptions, distinctValues, responsibleOptions, localDay,
  UNASSIGNED, FRESHNESS, DAYS_DOWN_THRESHOLDS,
} from '../../lib/workshopStatus/activeView'
import './workshopStatus.css'
import './activeVehicles.css'

const STORAGE_KEY = 'tp.workshopStatus.active.columns.v1'
const PAGE_SIZES = [25, 50, 100]

/**
 * Configurable columns. `sort` maps a column to a sortRecords key. The asset
 * number, expand toggle and Actions are fixed and not listed here.
 */
const COLUMNS = [
  { key: 'site', label: 'site', def: true, sort: 'site' },
  { key: 'complaint', label: 'complaint', def: true },
  { key: 'days', label: 'daysDown', def: true, sort: 'days', numeric: true },
  { key: 'stage', label: 'stage', def: true, sort: 'stage' },
  { key: 'delay', label: 'delayReason', def: true },
  { key: 'next', label: 'nextAction', def: true },
  { key: 'parts', label: 'partsStatus', def: true },
  { key: 'responsible', label: 'responsible', def: true },
  { key: 'expected', label: 'expectedRelease', def: true, sort: 'expected' },
  { key: 'lastBy', label: 'lastUpdated', def: true, sort: 'updated' },
  { key: 'fresh', label: 'freshness', def: true },
  { key: 'reg', label: 'regNo', def: false },
  { key: 'category', label: 'category', def: false },
  { key: 'department', label: 'department', def: false },
  { key: 'ooc', label: 'oocSince', def: false },
  { key: 'workDone', label: 'workDone', def: false },
  { key: 'actionTaken', label: 'actionTaken', def: false },
  { key: 'detailed', label: 'detailedReason', def: false },
  { key: 'mr', label: 'mr', def: false },
  { key: 'po', label: 'po', def: false },
  { key: 'partDate', label: 'expectedPartDate', def: false },
  { key: 'blocker', label: 'blocker', def: false },
  { key: 'remarks', label: 'remarks', def: false },
  { key: 'lastUpload', label: 'lastUpload', def: false },
  { key: 'source', label: 'source', def: false },
]
const COLUMN_KEYS = COLUMNS.map((c) => c.key)
const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.def).map((c) => c.key)

/** Fields shown in the expanded row, in order. */
const DETAIL_FIELDS = ['workDone', 'actionTaken', 'detailed', 'mr', 'po', 'partDate', 'blocker', 'remarks',
  'department', 'category', 'reg', 'ooc', 'complaint', 'lastUpload', 'source']

function readColumns() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_COLUMNS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_COLUMNS
    const keep = parsed.filter((k) => COLUMN_KEYS.includes(k))
    return keep.length ? keep : DEFAULT_COLUMNS
  } catch {
    return DEFAULT_COLUMNS
  }
}

function writeColumns(cols) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cols)) } catch { /* private window: keep in memory */ }
}

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')
const txt = (v) => (blank(v) ? null : String(v))

export default function ActiveVehiclesPanel({ permissions, permState = 'ready', onRetryPermissions, onUpdate, reloadKey = 0 }) {
  const { t } = useLanguage()
  const a = (k, v) => t(`workshopStatus.active.${k}`, v)
  const { activeCountry } = useSettings()
  const isAll = !activeCountry || activeCountry === 'All'
  const country = isAll ? '' : activeCountry

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [filters, setFilters] = useState(emptyFilters)
  const [showFilters, setShowFilters] = useState(false)
  const [sort, setSort] = useState({ key: 'days', dir: 'desc' })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [expanded, setExpanded] = useState(() => new Set())
  const [cols, setCols] = useState(readColumns)
  const [showColumns, setShowColumns] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const runRef = useRef(0)

  const canView = permissions?.view === true
  const canUpdate = permissions?.update === true && typeof onUpdate === 'function'
  const canExport = permissions?.export === true

  const load = useCallback(async () => {
    const run = ++runRef.current
    setLoading(true); setError('')
    try {
      const res = await loadActiveVehicles({ country })
      if (run !== runRef.current) return
      setRows(res.rows || [])
      setTruncated(Boolean(res.truncated))
      setNow(new Date())
    } catch (err) {
      if (run !== runRef.current) return
      setError(toUserMessage(err, t('workshopStatus.active.loadError')))
    } finally {
      if (run === runRef.current) setLoading(false)
    }
  }, [country, t])

  useEffect(() => {
    if (permState !== 'ready' || !canView) return
    load()
  }, [load, reloadKey, permState, canView])

  // A new country starts on the first page with no expanded rows.
  useEffect(() => { setPage(0); setExpanded(new Set()) }, [country])

  const filtered = useMemo(() => filterRecords(rows, filters, { now }), [rows, filters, now])
  const sorted = useMemo(() => sortRecords(filtered, sort, { now }), [filtered, sort, now])
  const stats = useMemo(() => summarize(rows, { now }), [rows, now])
  const pageRows = useMemo(() => sorted.slice(page * pageSize, (page + 1) * pageSize), [sorted, page, pageSize])

  // Keep the page in range when the filtered set shrinks.
  useEffect(() => {
    const last = Math.max(0, Math.ceil(sorted.length / pageSize) - 1)
    if (page > last) setPage(last)
  }, [sorted.length, pageSize, page])

  const siteOptions = useMemo(() => distinctValues(rows, 'site'), [rows])
  const countryOptions = useMemo(() => distinctValues(rows, 'country'), [rows])
  const stageOptions = useMemo(() => vocabOptions(CURRENT_STAGES, rows, 'current_stage'), [rows])
  const delayOptions = useMemo(() => vocabOptions(DELAY_REASONS, rows, 'delay_reason'), [rows])
  const partsOptions = useMemo(() => vocabOptions(PARTS_STATUSES, rows, 'parts_status'), [rows])
  const peopleOptions = useMemo(() => responsibleOptions(rows), [rows])

  const setFilter = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(0) }
  const clearFilters = () => { setFilters(emptyFilters()); setPage(0) }
  /** KPI tiles apply one preset on top of a clean filter state. */
  const preset = (patch) => { setFilters({ ...emptyFilters(), ...patch }); setPage(0) }

  const toggleColumn = (key) => {
    setCols((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : COLUMN_KEYS.filter((k) => cur.includes(k) || k === key)
      writeColumns(next)
      return next
    })
  }
  const resetColumns = () => { setCols(DEFAULT_COLUMNS); writeColumns(DEFAULT_COLUMNS) }

  const toggleRow = (id) => setExpanded((cur) => {
    const next = new Set(cur)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const onSortHeader = (key) => setSort((s) => (s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'days' || key === 'updated' ? 'desc' : 'asc' }))

  // ── Cell rendering (one place for table, cards and details) ───────────────
  const freshLabel = (fr) => a(`fresh.${fr}`)
  const freshTone = (fr) => (fr === FRESHNESS.TODAY ? 'good' : fr === FRESHNESS.STALE ? 'warn' : 'bad')
  const sourceLabel = (s) => (s ? a(`sources.${['excel', 'manual', 'system'].includes(s) ? s : 'system'}`) : null)

  function cellText(r, key) {
    switch (key) {
      case 'site': return txt(r.site)
      case 'complaint': return txt(r.complaint)
      case 'days': { const d = daysDown(r, now); return d == null ? null : a('daysValue', { n: fmtInt(d) }) }
      case 'stage': return txt(r.current_stage)
      case 'delay': return txt(r.delay_reason)
      case 'next': return txt(r.next_action)
      case 'parts': return txt(r.parts_status)
      case 'responsible':
        if (blank(r.responsible_user_id)) return a('notAssigned')
        return r.responsible_name || a('unknownPerson')
      case 'expected': return fmtDay(r.expected_release_date) || txt(r.excel_expected_release)
      case 'lastBy': {
        const u = lastUpdate(r)
        const when = fmtDateTime(u.at)
        if (!u.by && !when) return null
        return [u.by || a('systemUser'), when].filter(Boolean).join(', ')
      }
      case 'fresh': return freshLabel(freshness(r, now))
      case 'reg': return txt(r.reg_no)
      case 'category': return txt(r.vehicle_category)
      case 'department': return txt(r.department)
      case 'ooc': return fmtDay(r.ooc_since)
      case 'workDone': return txt(r.work_done)
      case 'actionTaken': return txt(r.action_taken)
      case 'detailed': return txt(r.detailed_reason)
      case 'mr': return txt(r.mr_number)
      case 'po': return txt(r.po_number)
      case 'partDate': return fmtDay(r.expected_part_date)
      case 'blocker': return txt(r.blocker)
      case 'remarks': return txt(r.remarks)
      case 'lastUpload': {
        const u = r.last_upload
        if (!u) return null
        const when = fmtDay(u.report_date) || fmtDay(u.confirmed_at || u.uploaded_at)
        return [u.upload_no != null ? a('uploadNo', { no: u.upload_no }) : null, when].filter(Boolean).join(', ')
      }
      case 'source': return sourceLabel(r.last_update_source)
      case 'country': return txt(r.country)
      default: return null
    }
  }

  function renderCell(r, key) {
    if (key === 'fresh') {
      const fr = freshness(r, now)
      return <span className={`cc-pill ${freshTone(fr)}`}>{freshLabel(fr)}</span>
    }
    if (key === 'lastBy') {
      const u = lastUpdate(r)
      const when = fmtDateTime(u.at)
      if (!u.by && !when) return <span className="cc-na">{a('na')}</span>
      return (
        <span className="wks-av-who">
          <span className="wks-av-who-name">{u.by || a('systemUser')}</span>
          {when && <span className="wks-av-who-at">{when}</span>}
        </span>
      )
    }
    if (key === 'days') {
      const d = daysDown(r, now)
      if (d == null) return <span className="cc-na">{a('unknown')}</span>
      return <span className={d > 14 ? 'wks-av-days bad' : d > 7 ? 'wks-av-days warn' : 'wks-av-days'}>{fmtInt(d)}</span>
    }
    if (key === 'responsible' && blank(r.responsible_user_id)) {
      return <span className="cc-na">{a('notAssigned')}</span>
    }
    const v = cellText(r, key)
    return v == null ? <span className="cc-na">{a('na')}</span> : v
  }

  const visibleCols = useMemo(() => {
    const list = COLUMNS.filter((c) => cols.includes(c.key))
    return isAll ? [{ key: 'country', label: 'country' }, ...list] : list
  }, [cols, isAll])

  // ── Export ────────────────────────────────────────────────────────────────
  const exportExcel = async () => {
    if (!sorted.length || exporting) return
    setExporting(true); setExportError('')
    try {
      const keys = ['asset', ...(isAll ? ['country'] : []), ...COLUMN_KEYS.filter((k) => k !== 'fresh'), 'fresh']
      const headers = keys.map((k) => a(`col.${k === 'asset' ? 'asset' : (COLUMNS.find((c) => c.key === k)?.label || k)}`))
      const data = sorted.map((r) => {
        const o = { asset: r.asset_no }
        for (const k of keys) if (k !== 'asset') o[k] = k === 'days' ? daysDown(r, now) : cellText(r, k)
        return o
      })
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      await exportToExcel(data, keys, headers,
        reportFileName('Workshop Active Vehicles', isAll ? 'All countries' : country, localDay(now)),
        'Active vehicles', { title: a('exportTitle') })
    } catch (err) {
      setExportError(toUserMessage(err, a('exportError')))
    } finally {
      setExporting(false)
    }
  }

  // ── Permission states ─────────────────────────────────────────────────────
  if (permState === 'loading') {
    return (
      <Card>
        <div className="wks-state" role="status" aria-live="polite">
          <Loader2 size={18} className="wks-spin" aria-hidden="true" /> {a('loadingPerms')}
        </div>
      </Card>
    )
  }
  if (!canView) {
    return (
      <Card>
        <div className="wks-state wks-state-col" role="alert">
          <ShieldAlert size={26} aria-hidden="true" className="wks-ico-warn" />
          <h2 className="wks-h">{a('deniedTitle')}</h2>
          <p className="wks-muted">{a('deniedBody')}</p>
          {permState === 'error' && onRetryPermissions && (
            <button type="button" className="cc-btn-ghost wks-tap" onClick={onRetryPermissions}>
              <RotateCcw size={14} aria-hidden="true" /> {a('retry')}
            </button>
          )}
        </div>
      </Card>
    )
  }

  const nFilters = activeFilterCount(filters)
  const colSpan = visibleCols.length + 3

  const detailList = (r) => (
    <dl className="wks-av-detail">
      {DETAIL_FIELDS.map((k) => {
        const v = cellText(r, k)
        return (
          <div key={k}>
            <dt>{a(`col.${COLUMNS.find((c) => c.key === k)?.label || k}`)}</dt>
            <dd>{v == null ? <span className="cc-na">{a('na')}</span> : v}</dd>
          </div>
        )
      })}
    </dl>
  )

  const updateButton = (r) => (canUpdate ? (
    <button type="button" className="cc-btn-ghost wks-tap wks-av-update" onClick={() => onUpdate(r)}
      aria-label={a('updateFor', { asset: r.asset_no })}>
      <PencilLine size={14} aria-hidden="true" /> {a('update')}
    </button>
  ) : null)

  return (
    <div className="wks-panel">
      <div className="wks-av-kpis">
        <Kpi icon={Truck} tone="t-blue" value={stats.total} label={a('kpi.total')} loading={loading && !rows.length} onClick={clearFilters} />
        <Kpi icon={Clock} tone="t-amber" value={stats.notUpdatedToday} label={a('kpi.notUpdatedToday')} loading={loading && !rows.length}
          danger={stats.notUpdatedToday > 0} onClick={() => preset({ updated: 'not_today' })} />
        <Kpi icon={Hourglass} tone="t-amber" value={stats.over7} label={a('kpi.over7')} loading={loading && !rows.length} onClick={() => preset({ minDays: 7 })} />
        <Kpi icon={AlertTriangle} tone="t-red" value={stats.over14} label={a('kpi.over14')} loading={loading && !rows.length}
          danger={stats.over14 > 0} onClick={() => preset({ minDays: 14 })} />
        <Kpi icon={CalendarCheck} tone="t-green" value={stats.expectedToday} label={a('kpi.expectedToday')} loading={loading && !rows.length} onClick={() => preset({ expectedToday: true })} />
        <Kpi icon={UserX} tone="t-purple" value={stats.unassigned} label={a('kpi.unassigned')} loading={loading && !rows.length} onClick={() => preset({ responsible: UNASSIGNED })} />
      </div>

      <Card>
        <div className="wks-av-toolbar">
          <label className="cc-search wks-search wks-av-search">
            <Search size={14} aria-hidden="true" />
            <span className="wks-sr">{a('searchLabel')}</span>
            <input type="search" value={filters.search} placeholder={a('searchPlaceholder')}
              onChange={(e) => setFilter('search', e.target.value)} />
            {filters.search && (
              <button type="button" className="wks-clear" aria-label={t('common.clearSearch')} onClick={() => setFilter('search', '')}>
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </label>
          <div className="wks-av-tools">
            <button type="button" className={`cc-btn-ghost wks-tap ${showFilters ? 'is-on' : ''}`} aria-expanded={showFilters}
              onClick={() => setShowFilters((s) => !s)}>
              <SlidersHorizontal size={14} aria-hidden="true" /> {nFilters ? a('filtersCount', { n: nFilters }) : a('filters')}
            </button>
            <label className="cc-field wks-av-sort">
              <span className="wks-sr">{a('sortLabel')}</span>
              <select className="cc-select wks-tap" value={`${sort.key}:${sort.dir}`} aria-label={a('sortLabel')}
                onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSort({ key, dir }) }}>
                {['days:desc', 'days:asc', 'updated:desc', 'updated:asc', 'expected:asc', 'asset:asc', 'site:asc', 'stage:asc'].map((v) => (
                  <option key={v} value={v}>{a(`sort.${v.replace(':', '_')}`)}</option>
                ))}
              </select>
            </label>
            <button type="button" className={`cc-btn-ghost wks-tap wks-av-hide-sm ${showColumns ? 'is-on' : ''}`} aria-expanded={showColumns}
              onClick={() => setShowColumns((s) => !s)}>
              <Columns size={14} aria-hidden="true" /> {a('columns')}
            </button>
            {canExport && (
              <button type="button" className="cc-btn-ghost wks-tap" onClick={exportExcel} disabled={!sorted.length || exporting}>
                {exporting ? <Loader2 size={14} className="wks-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} {a('export')}
              </button>
            )}
            <button type="button" className="cc-btn-ghost wks-tap" onClick={load} disabled={loading} aria-label={a('refresh')}>
              <RotateCcw size={14} aria-hidden="true" className={loading ? 'wks-spin' : ''} />
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="wks-av-filters" data-testid="wks-av-filters">
            {isAll && countryOptions.length > 1 && (
              <FilterSelect label={a('col.country')} value={filters.country} onChange={(v) => setFilter('country', v)} options={countryOptions} any={a('any')} />
            )}
            <FilterSelect label={a('col.site')} value={filters.site} onChange={(v) => setFilter('site', v)} options={siteOptions} any={a('any')} />
            <FilterSelect label={a('col.stage')} value={filters.stage} onChange={(v) => setFilter('stage', v)} options={stageOptions} any={a('any')} />
            <FilterSelect label={a('col.delayReason')} value={filters.delayReason} onChange={(v) => setFilter('delayReason', v)} options={delayOptions} any={a('any')} />
            <FilterSelect label={a('col.partsStatus')} value={filters.partsStatus} onChange={(v) => setFilter('partsStatus', v)} options={partsOptions} any={a('any')} />
            <label className="cc-field">
              <span>{a('col.responsible')}</span>
              <select className="cc-select wks-tap" value={filters.responsible} onChange={(e) => setFilter('responsible', e.target.value)}>
                <option value="">{a('any')}</option>
                <option value={UNASSIGNED}>{a('notAssigned')}</option>
                {peopleOptions.map((p) => <option key={p.id} value={p.id}>{p.name || a('unknownPerson')}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>{a('col.daysDown')}</span>
              <select className="cc-select wks-tap" value={filters.minDays ?? ''} onChange={(e) => setFilter('minDays', e.target.value ? Number(e.target.value) : null)}>
                <option value="">{a('any')}</option>
                {DAYS_DOWN_THRESHOLDS.map((n) => <option key={n} value={n}>{a('moreThanDays', { n })}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>{a('updatedFilter')}</span>
              <select className="cc-select wks-tap" value={filters.updated} onChange={(e) => setFilter('updated', e.target.value)}>
                <option value="">{a('any')}</option>
                <option value="today">{a('updatedToday')}</option>
                <option value="not_today">{a('notUpdatedToday')}</option>
              </select>
            </label>
            <label className="wks-check wks-tap wks-av-checkbox">
              <input type="checkbox" checked={filters.expectedToday} onChange={(e) => setFilter('expectedToday', e.target.checked)} />
              <span>{a('expectedTodayFilter')}</span>
            </label>
            <button type="button" className="cc-btn-ghost wks-tap" onClick={clearFilters} disabled={!nFilters && !filters.search}>
              {a('clearFilters')}
            </button>
          </div>
        )}

        {showColumns && (
          <fieldset className="wks-av-columns" data-testid="wks-av-columns">
            <legend className="wks-h">{a('columnsTitle')}</legend>
            <p className="wks-muted">{a('columnsHint')}</p>
            <div className="wks-av-colgrid">
              {COLUMNS.map((c) => (
                <label key={c.key} className="wks-check wks-tap">
                  <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                  <span>{a(`col.${c.label}`)}</span>
                </label>
              ))}
            </div>
            <button type="button" className="cc-btn-ghost wks-tap" onClick={resetColumns}>{a('resetColumns')}</button>
          </fieldset>
        )}

        <p className="wks-muted wks-av-count" aria-live="polite">
          {a('showingCount', { shown: fmtInt(sorted.length), total: fmtInt(rows.length) })}
          {isAll ? ` ${a('allCountriesNote')}` : ''}
        </p>

        {truncated && (
          <div className="wks-banner warn" role="status">
            <AlertTriangle size={17} aria-hidden="true" />
            <p>{a('truncated')}</p>
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
              <strong>{a('loadErrorTitle')}</strong>
              <p>{error}</p>
              <button type="button" className="cc-btn-ghost wks-tap" onClick={load}>
                <RotateCcw size={14} aria-hidden="true" /> {a('retry')}
              </button>
            </div>
          </div>
        ) : loading && !rows.length ? (
          <div className="wks-av-skel" role="status" aria-live="polite">
            <span className="wks-sr">{a('loading')}</span>
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 34 }} />)}
          </div>
        ) : !rows.length ? (
          <div className="wks-empty">
            <h2 className="wks-h">{a('emptyTitle')}</h2>
            <p className="wks-muted">{a('emptyBody')}</p>
          </div>
        ) : !sorted.length ? (
          <div className="wks-empty">
            <h2 className="wks-h">{a('noMatchesTitle')}</h2>
            <p className="wks-muted">{a('noMatchesBody')}</p>
            <button type="button" className="cc-btn-ghost wks-tap" onClick={clearFilters}>{a('clearFilters')}</button>
          </div>
        ) : (
          <>
            <div className="wks-av-table-wrap wks-desktop">
              <table className="wks-av-table">
                <thead>
                  <tr>
                    <th scope="col" className="wks-av-exp"><span className="wks-sr">{a('details')}</span></th>
                    <SortTh label={a('col.asset')} sortKey="asset" sort={sort} onSort={onSortHeader} sticky ascLabel={a('sortedAsc')} descLabel={a('sortedDesc')} />
                    {visibleCols.map((c) => (c.sort
                      ? <SortTh key={c.key} label={a(`col.${c.label}`)} sortKey={c.sort} sort={sort} onSort={onSortHeader} numeric={c.numeric} ascLabel={a('sortedAsc')} descLabel={a('sortedDesc')} />
                      : <th key={c.key} scope="col">{a(`col.${c.label}`)}</th>))}
                    <th scope="col" className="wks-av-actions-h">{a('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const open = expanded.has(r.id)
                    return (
                      <Fragment key={r.id}>
                        <tr className={open ? 'is-open' : ''}>
                          <td className="wks-av-exp">
                            <button type="button" className="wks-av-toggle" aria-expanded={open}
                              aria-label={open ? a('hideDetailsFor', { asset: r.asset_no }) : a('showDetailsFor', { asset: r.asset_no })}
                              onClick={() => toggleRow(r.id)}>
                              {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" className="wks-av-chev" />}
                            </button>
                          </td>
                          <th scope="row" className="wks-av-sticky"><span className="wks-mono">{r.asset_no}</span></th>
                          {visibleCols.map((c) => (
                            <td key={c.key} className={`${c.numeric ? 'is-num' : ''} wks-av-c-${c.key}`}>{renderCell(r, c.key)}</td>
                          ))}
                          <td className="wks-av-actions">{updateButton(r)}</td>
                        </tr>
                        {open && (
                          <tr className="wks-av-detail-row">
                            <td colSpan={colSpan}>{detailList(r)}</td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <ul className="wks-cards wks-av-cards">
              {pageRows.map((r) => {
                const open = expanded.has(r.id)
                const fr = freshness(r, now)
                return (
                  <li key={r.id} className="wks-item">
                    <div className="wks-av-card-head">
                      <span className="wks-mono">{r.asset_no}</span>
                      <span className={`cc-pill ${freshTone(fr)}`}>{freshLabel(fr)}</span>
                    </div>
                    {['site', 'days', 'stage', 'delay', 'next', 'parts', 'responsible', 'expected', 'lastBy', ...(isAll ? ['country'] : [])].map((k) => {
                      const v = cellText(r, k)
                      if (v == null) return null
                      return (
                        <div key={k} className="wks-item-row">
                          <span className="wks-item-k">{a(`col.${COLUMNS.find((c) => c.key === k)?.label || k}`)}</span>
                          <span className="wks-item-v">{v}</span>
                        </div>
                      )
                    })}
                    {open && detailList(r)}
                    <div className="wks-av-card-actions">
                      <button type="button" className="cc-btn-ghost wks-tap" aria-expanded={open} onClick={() => toggleRow(r.id)}>
                        {open ? a('hideDetails') : a('showDetails')}
                      </button>
                      {updateButton(r)}
                    </div>
                  </li>
                )
              })}
            </ul>

            <Pager page={page} pageSize={pageSize} total={sorted.length} onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(0) }} sizes={PAGE_SIZES} noun={a('pagerNoun')} />
          </>
        )}
      </Card>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options, any }) {
  return (
    <label className="cc-field">
      <span>{label}</span>
      <select className="cc-select wks-tap" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{any}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

function SortTh({ label, sortKey, sort, onSort, numeric, sticky, ascLabel, descLabel }) {
  const active = sort.key === sortKey
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th scope="col" aria-sort={ariaSort} className={`${numeric ? 'is-num' : ''} ${sticky ? 'wks-av-sticky' : ''}`}>
      <button type="button" className="wks-av-sortbtn" onClick={() => onSort(sortKey)}>
        {label}
        {active && <span aria-hidden="true">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
        {active && <span className="wks-sr">{sort.dir === 'asc' ? ascLabel : descLabel}</span>}
      </button>
    </th>
  )
}
