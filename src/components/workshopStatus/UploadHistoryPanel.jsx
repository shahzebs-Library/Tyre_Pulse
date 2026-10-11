/**
 * UploadHistoryPanel - Daily Ops -> Workshop Status -> Daily upload -> history
 * (Loop 15). The register of past daily Excel uploads: file, sheet, report
 * date, rows, new / unchanged / released counts, who uploaded and when, and
 * whether it was confirmed or abandoned. A row opens that upload's parsed rows
 * read-only. Excel export of the filtered register and of one upload's rows.
 *
 * Read only. Visible with workshop_status_can('view_uploads'); RLS is the
 * boundary, the permission flag only decides whether the card is offered.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, RotateCcw, Download, Search, X } from 'lucide-react'
import { Card, Tabs, KitTable, Pager, fmtInt } from '../commandCenter/kit'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import { FIELD_LABELS } from '../../lib/workshopStatus/compareUpload'
import {
  historyRow, historyExportRows, HISTORY_EXPORT_KEYS, uploadRowView, summariseRows, ROW_OUTCOMES,
  appliedConflicts, detailExportRows, DETAIL_EXPORT_KEYS,
} from '../../lib/workshopStatus/uploadHistory'
import {
  listUploadHistory, listAllUploadHistory, listUploadRows, getUploadConfirmDetails,
} from '../../lib/api/workshopStatusUploads'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (v) => {
  const m = v ? String(v).match(/^(\d{4})-(\d{2})-(\d{2})/) : null
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}` : null
}
const when = (v) => {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const STATE_TONE = { confirmed: 'good', abandoned: 'muted', failed: 'bad' }
const DETAIL_TABS = ['all', 'conflict', ...ROW_OUTCOMES]

export default function UploadHistoryPanel({ countries = [], defaultCountry = '', refreshKey = 0 }) {
  const { t } = useLanguage()
  const h = useCallback((k, v) => t(`workshopStatus.history.${k}`, v), [t])
  const outcomeLabel = useCallback((o) => (o ? t(`workshopStatus.upload.kpi.${o}`) : ''), [t])

  const [country, setCountry] = useState(defaultCountry || 'all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [state, setState] = useState('all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [data, setData] = useState({ rows: [], total: 0 })
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [open, setOpen] = useState(null) // historyRow

  const filters = useMemo(() => ({
    country: country === 'all' ? null : country, from, to, state: state === 'all' ? null : state,
  }), [country, from, to, state])

  useEffect(() => { setPage(0) }, [filters])

  useEffect(() => {
    let alive = true
    setStatus('loading'); setError('')
    listUploadHistory({ ...filters, page, pageSize })
      .then((res) => { if (alive) { setData(res); setStatus('ready') } })
      .catch((err) => { if (alive) { setError(toUserMessage(err, h('loadError'))); setStatus('error') } })
    return () => { alive = false }
  }, [filters, page, pageSize, nonce, refreshKey, h])

  const rows = useMemo(() => data.rows.map(historyRow), [data.rows])
  const stateLabel = useCallback((s) => h(`state.${s}`), [h])

  const exportRegister = async () => {
    setExporting(true); setExportError('')
    try {
      const { rows: all } = await listAllUploadHistory(filters)
      const out = historyExportRows(all.map(historyRow), stateLabel)
      const headers = HISTORY_EXPORT_KEYS.map((k) => h(`col.${k}`))
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      await exportToExcel(out, [...HISTORY_EXPORT_KEYS], headers,
        reportFileName('Workshop Upload History', filters.country || 'All countries', from || null, to || null),
        'Uploads', { title: h('exportTitle') })
    } catch (err) {
      setExportError(toUserMessage(err, h('exportError')))
    } finally {
      setExporting(false)
    }
  }

  const columns = [
    { key: 'uploadNo', header: h('col.uploadNo'), numeric: true },
    { key: 'fileName', header: h('col.fileName'), cell: (r) => <span className="wks-mono">{r.fileName || '-'}</span> },
    { key: 'sheet', header: h('col.sheet') },
    { key: 'reportDate', header: h('col.reportDate'), cell: (r) => day(r.reportDate) || h('none') },
    { key: 'country', header: h('col.country') },
    { key: 'rows', header: h('col.rows'), numeric: true, cell: (r) => fmtInt(r.rows) },
    { key: 'newCount', header: h('col.newCount'), numeric: true, cell: (r) => fmtInt(r.newCount) },
    { key: 'unchangedCount', header: h('col.unchangedCount'), numeric: true, cell: (r) => fmtInt(r.unchangedCount) },
    { key: 'releasedCount', header: h('col.releasedCount'), numeric: true, cell: (r) => fmtInt(r.releasedCount) },
    { key: 'conflictCount', header: h('col.conflictCount'), numeric: true, cell: (r) => (r.conflictCount ? fmtInt(r.conflictCount) : '-') },
    { key: 'uploadedBy', header: h('col.uploadedBy') },
    { key: 'uploadedAt', header: h('col.uploadedAt'), sortValue: (r) => r.uploadedAt || '', cell: (r) => when(r.uploadedAt) },
    {
      key: 'state', header: h('col.state'),
      cell: (r) => <span className={`cc-pill ${STATE_TONE[r.state] || 'muted'}`}>{stateLabel(r.state)}</span>,
    },
  ]

  return (
    <Card
      title={h('title')}
      sub={h('sub')}
      action={(
        <button type="button" className="cc-btn-ghost wks-tap" onClick={exportRegister}
          disabled={exporting || status !== 'ready' || data.total === 0}>
          {exporting ? <Loader2 size={14} className="wks-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
          {h('export')}
        </button>
      )}
    >
      <div className="wks-filters" role="group" aria-label={h('filtersLabel')}>
        <label className="cc-field">
          <span>{h('country')}</span>
          <select className="cc-select wks-tap" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="all">{h('allCountries')}</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="cc-field">
          <span>{h('from')}</span>
          <input type="date" className="cc-input wks-tap" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="cc-field">
          <span>{h('to')}</span>
          <input type="date" className="cc-input wks-tap" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="cc-field">
          <span>{h('stateFilter')}</span>
          <select className="cc-select wks-tap" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="all">{h('allStates')}</option>
            {['confirmed', 'abandoned', 'failed'].map((s) => <option key={s} value={s}>{stateLabel(s)}</option>)}
          </select>
        </label>
        {(from || to || state !== 'all' || country !== (defaultCountry || 'all')) && (
          <button type="button" className="cc-btn-ghost wks-tap" onClick={() => { setFrom(''); setTo(''); setState('all'); setCountry(defaultCountry || 'all') }}>
            <X size={14} aria-hidden="true" /> {h('clear')}
          </button>
        )}
      </div>

      {exportError && <p className="wks-banner bad" role="alert"><AlertTriangle size={15} aria-hidden="true" /> {exportError}</p>}

      <div aria-live="polite" aria-busy={status === 'loading'} data-testid="wks-upload-history">
        {status === 'loading' && (
          <p className="wks-state" role="status"><Loader2 size={16} className="wks-spin" aria-hidden="true" /> {h('loading')}</p>
        )}
        {status === 'error' && (
          <div className="wks-banner bad" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <div>
              <p>{error}</p>
              <button type="button" className="cc-btn-ghost wks-tap" onClick={() => setNonce((n) => n + 1)}>
                <RotateCcw size={14} aria-hidden="true" /> {h('retry')}
              </button>
            </div>
          </div>
        )}
        {status === 'ready' && rows.length === 0 && (
          <p className="cc-empty">{from || to || state !== 'all'
            ? h('emptyFiltered')
            : country !== 'all' ? h('emptyCountry', { country }) : h('empty')}</p>
        )}
        {status === 'ready' && rows.length > 0 && (
          <>
            <div className="wks-desktop">
              <KitTable columns={columns} rows={rows} compact onRowClick={(r) => setOpen(r)} />
            </div>
            <ul className="wks-cards">
              {rows.map((r) => (
                <li key={r.id} className="wks-item">
                  <button type="button" className="wks-item-btn wks-tap" onClick={() => setOpen(r)}>
                    {columns.map((c) => {
                      const v = c.cell ? c.cell(r) : r[c.key]
                      if (v == null || v === '') return null
                      return (
                        <div key={c.key} className="wks-item-row">
                          <span className="wks-item-k">{c.header}</span>
                          <span className="wks-item-v">{v}</span>
                        </div>
                      )
                    })}
                  </button>
                </li>
              ))}
            </ul>
            <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(0) }} noun={h('noun')} />
            <p className="wks-muted wks-hint">{h('openHint')}</p>
          </>
        )}
      </div>

      <UploadDetailModal upload={open} onClose={() => setOpen(null)} h={h} outcomeLabel={outcomeLabel} stateLabel={stateLabel} />
    </Card>
  )
}

function UploadDetailModal({ upload, onClose, h, outcomeLabel, stateLabel }) {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [views, setViews] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [nonce, setNonce] = useState(0)
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    if (!upload?.id) return undefined
    let alive = true
    setStatus('loading'); setError(''); setTab('all'); setSearch('')
    Promise.all([listUploadRows(upload.id), getUploadConfirmDetails(upload.id)])
      .then(([res, details]) => {
        if (!alive) return
        const applied = appliedConflicts(details)
        setViews(res.rows.map((r) => uploadRowView(r, { labels: FIELD_LABELS, applied })))
        setTruncated(res.truncated)
        setStatus('ready')
      })
      .catch((err) => { if (alive) { setError(toUserMessage(err, h('rowsError'))); setStatus('error') } })
    return () => { alive = false }
  }, [upload?.id, nonce, h])

  const counts = useMemo(() => summariseRows(views), [views])
  const shownRows = useMemo(() => {
    const q = search.trim().toUpperCase().replace(/\s+/g, '')
    return views
      .filter((v) => (tab === 'all' ? true : tab === 'conflict' ? Boolean(v.conflict) : v.outcome === tab))
      .filter((v) => !q || String(v.asset || '').toUpperCase().includes(q))
  }, [views, tab, search])

  const exportRows = async () => {
    setExportError('')
    try {
      const headers = DETAIL_EXPORT_KEYS.map((k) => h(`dcol.${k}`))
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      await exportToExcel(detailExportRows(views, outcomeLabel), [...DETAIL_EXPORT_KEYS], headers,
        reportFileName('Workshop Upload', upload?.uploadNo ? `No ${upload.uploadNo}` : '', upload?.country || '', upload?.reportDate || ''),
        'Rows', { title: h('detailExportTitle') })
    } catch (err) {
      setExportError(toUserMessage(err, h('exportError')))
    }
  }

  const resolutionText = (v) => {
    if (!v.conflict) return null
    const choice = v.applied || v.requested
    const label = choice ? h(`resolution.${choice}`) : h('resolution.pending')
    const by = v.manualBy ? h('manualBy', { name: v.manualBy, when: when(v.manualAt) || '-' }) : null
    return <span>{label}{by ? <span className="wks-muted"> ({by})</span> : null}</span>
  }

  const columns = [
    { key: 'rowNumber', header: h('dcol.rowNumber'), numeric: true },
    { key: 'asset', header: h('dcol.asset'), cell: (v) => <span className="wks-mono">{v.asset || '-'}</span> },
    { key: 'outcome', header: h('dcol.outcome'), cell: (v) => <span className="cc-pill muted">{outcomeLabel(v.outcome)}</span> },
    { key: 'site', header: h('dcol.site') },
    { key: 'jobCard', header: h('dcol.jobCard') },
    {
      key: 'changes', header: h('dcol.changes'), sortable: false,
      cell: (v) => (v.changes.length
        ? <ul className="wks-changes">{v.changes.map((c) => <li key={c}>{c}</li>)}</ul>
        : v.releaseReason ? t2(h, v.releaseReason) : null),
    },
    { key: 'conflict', header: h('dcol.conflict'), sortable: false, cell: resolutionText },
    { key: 'errors', header: h('dcol.errors'), sortable: false, cell: (v) => (v.errors.length ? v.errors.join('; ') : null) },
  ]

  return (
    <Modal
      open={Boolean(upload)}
      onClose={onClose}
      title={upload ? h('detailTitle', { no: upload.uploadNo ?? '-', file: upload.fileName || '' }) : ''}
      size="xl"
      className="cc wks-modal"
      footer={(
        <div className="wks-actions">
          <button type="button" className="cc-btn-ghost wks-tap" onClick={exportRows} disabled={status !== 'ready' || views.length === 0}>
            <Download size={14} aria-hidden="true" /> {h('exportRows')}
          </button>
          <button type="button" className="cc-btn-primary wks-tap" onClick={onClose}>{h('close')}</button>
        </div>
      )}
    >
      {upload && (
        <div className="wks-dialog" data-testid="wks-upload-detail">
          <p className="wks-muted">{h('readOnly')}</p>
          <dl className="wks-meta">
            <div><dt>{h('col.reportDate')}</dt><dd>{day(upload.reportDate) || h('none')}</dd></div>
            <div><dt>{h('col.sheet')}</dt><dd>{upload.sheet || h('none')}</dd></div>
            <div><dt>{h('col.country')}</dt><dd>{upload.country || '-'}</dd></div>
            <div><dt>{h('col.uploadedBy')}</dt><dd>{upload.uploadedBy || '-'} - {when(upload.uploadedAt) || '-'}</dd></div>
            <div><dt>{h('col.state')}</dt><dd>{stateLabel(upload.state)}{upload.confirmedAt ? ` - ${upload.confirmedBy || ''} ${when(upload.confirmedAt)}` : ''}</dd></div>
            {upload.keptManualCount ? <div><dt>{h('col.keptManualCount')}</dt><dd>{fmtInt(upload.keptManualCount)}</dd></div> : null}
          </dl>

          {status === 'loading' && <p className="wks-state" role="status"><Loader2 size={16} className="wks-spin" aria-hidden="true" /> {h('rowsLoading')}</p>}
          {status === 'error' && (
            <div className="wks-banner bad" role="alert">
              <AlertTriangle size={17} aria-hidden="true" />
              <div>
                <p>{error}</p>
                <button type="button" className="cc-btn-ghost wks-tap" onClick={() => setNonce((n) => n + 1)}>
                  <RotateCcw size={14} aria-hidden="true" /> {h('retry')}
                </button>
              </div>
            </div>
          )}
          {exportError && <p className="wks-banner bad" role="alert">{exportError}</p>}
          {status === 'ready' && (
            <>
              {truncated && <p className="wks-banner warn" role="status">{h('rowsTruncated')}</p>}
              <div className="wks-review-head">
                <Tabs
                  label={h('detailTabs')}
                  value={tab}
                  onChange={setTab}
                  tabs={DETAIL_TABS.filter((k) => k === 'all' || counts[k] > 0).map((k) => ({
                    key: k,
                    label: k === 'all' ? h('allRows') : k === 'conflict' ? h('conflicts') : outcomeLabel(k),
                    count: k === 'all' ? views.length : counts[k],
                  }))}
                />
                <label className="cc-search wks-search">
                  <Search size={14} aria-hidden="true" />
                  <span className="wks-sr">{h('searchLabel')}</span>
                  <input type="search" value={search} placeholder={h('searchPlaceholder')} onChange={(e) => setSearch(e.target.value)} />
                </label>
              </div>
              {shownRows.length === 0
                ? <p className="cc-empty">{views.length === 0 ? h('rowsEmpty') : h('noMatches')}</p>
                : <KitTable columns={columns} rows={shownRows} compact scroll />}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

function t2(h, reason) {
  return h(`releaseReason.${reason}`)
}
