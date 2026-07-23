import { useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { exportToPdf, exportToExcel, reportFileName } from '../lib/exportUtils'
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import { ScanLine, Search, Download, FileText, Upload, AlertTriangle, Trash2, RotateCcw, X } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
import { toUserMessage } from '../lib/safeError'
import { scrapTyreBySerial, unscrapTyreBySerial, getScrapMark } from '../lib/api/tyreExchange'

function SearchSkeleton() {
  return (
    <>
      <div className="card animate-pulse">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="h-8 w-40 bg-[var(--surface-2)] rounded-md" />
              <div className="h-6 w-16 bg-[var(--surface-2)] rounded-full" />
            </div>
            <div className="h-4 w-56 bg-[var(--surface-2)] rounded" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-20 bg-[var(--surface-2)] rounded-md" />
            <div className="h-8 w-16 bg-[var(--surface-2)] rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-[var(--surface-2)] rounded-lg p-3 text-center space-y-2">
              <div className="h-6 w-12 bg-[var(--surface-3)] rounded mx-auto" />
              <div className="h-3 w-20 bg-[var(--surface-3)] rounded mx-auto" />
            </div>
          ))}
        </div>
        <div className="h-4 w-32 bg-[var(--surface-2)] rounded mt-3" />
      </div>

      <div className="card animate-pulse">
        <div className="h-5 w-32 bg-[var(--surface-2)] rounded mb-4" />
        <div className="space-y-4">
          {[...Array(3)].map((_, gi) => (
            <div key={gi}>
              <div className="h-4 w-28 bg-[var(--surface-2)] rounded mb-2" />
              <div className="space-y-2 pl-3 border-l border-[var(--border-dim)]">
                {[...Array(2)].map((_, ri) => (
                  <div key={ri} className="flex items-start gap-3 py-2">
                    <div className="h-3 w-20 bg-[var(--surface-2)] rounded flex-shrink-0 mt-1" />
                    <div className="flex-1 space-y-1.5">
                      <div className="flex gap-3">
                        <div className="h-3 w-16 bg-[var(--surface-2)] rounded" />
                        <div className="h-3 w-12 bg-[var(--surface-2)] rounded" />
                        <div className="h-3 w-10 bg-[var(--surface-2)] rounded" />
                      </div>
                      <div className="h-3 w-36 bg-[var(--surface-2)] rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default function SerialTracker() {
  const [activeTab, setActiveTab] = useState('single')

  // ── Single Search state ───────────────────────────────────────────────────
  const [serialInput, setSerialInput] = useState('')
  const [records, setRecords]         = useState([])
  const [loading, setLoading]         = useState(false)
  const [searched, setSearched]       = useState(false)
  const [lastQuery, setLastQuery]     = useState('')
  const [error, setError]             = useState(null)

  // ── Scrap workflow state ──────────────────────────────────────────────────
  const [scrapMark, setScrapMark]     = useState(null)   // { serial, reason, created_at } | null
  const [scrapOpen, setScrapOpen]     = useState(false)
  const [scrapReason, setScrapReason] = useState('')
  const [scrapBusy, setScrapBusy]     = useState(false)
  const [scrapErr, setScrapErr]       = useState(null)

  // ── Bulk Lookup state ─────────────────────────────────────────────────────
  const [bulkResults, setBulkResults]   = useState([])
  const [bulkLoading, setBulkLoading]   = useState(false)
  const [bulkFileName, setBulkFileName] = useState('')
  const [bulkDragOver, setBulkDragOver] = useState(false)
  const [bulkDone, setBulkDone]         = useState(false)
  const [bulkSearch, setBulkSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState(null)
  const bulkFileRef = useRef(null)

  // ── Single search ─────────────────────────────────────────────────────────
  async function search() {
    if (!serialInput.trim()) return
    setLoading(true)
    setSearched(false)
    setError(null)
    const q = serialInput.trim()
    setScrapMark(null)
    setScrapErr(null)
    try {
      const { data, error: qErr } = await supabase
        .from('tyre_records')
        .select('*')
        .eq('serial_no', q)
        .order('issue_date', { ascending: true })
      if (qErr) throw qErr
      setRecords(data || [])
      if ((data || []).length) {
        try { setScrapMark(await getScrapMark(q)) } catch { /* scrap flag is best-effort */ }
      }
    } catch (err) {
      setError(toUserMessage(err, 'Could not search for that serial.'))
      setRecords([])
    } finally {
      setLastQuery(q)
      setSearched(true)
      setLoading(false)
    }
  }

  // ── Mark / unmark scrap ────────────────────────────────────────────────────
  async function confirmScrap() {
    setScrapBusy(true)
    setScrapErr(null)
    try {
      const country = records[0]?.country || null
      await scrapTyreBySerial(lastQuery, { reason: scrapReason, country })
      setRecords(prev => prev.map(r => ({ ...r, status: 'Scrapped' })))
      setScrapMark({ serial: lastQuery, reason: scrapReason.trim() || null, created_at: new Date().toISOString() })
      setScrapOpen(false)
      setScrapReason('')
    } catch (err) {
      setScrapErr(toUserMessage(err, 'Could not mark this tyre as scrap.'))
    } finally {
      setScrapBusy(false)
    }
  }

  async function undoScrap() {
    setScrapBusy(true)
    setScrapErr(null)
    try {
      await unscrapTyreBySerial(lastQuery)
      setRecords(prev => prev.map(r => (r.status === 'Scrapped' ? { ...r, status: 'Active' } : r)))
      setScrapMark(null)
    } catch (err) {
      setScrapErr(toUserMessage(err, 'Could not remove the scrap mark.'))
    } finally {
      setScrapBusy(false)
    }
  }

  const stats = useMemo(() => {
    if (records.length === 0) return null
    const first = records[0]
    const last  = records[records.length - 1]
    const assets = new Set(records.map(r => r.asset_no).filter(Boolean))
    const totalCost = records.reduce((s, r) => s + (parseFloat(r.cost) || 0), 0)
    let days = 0
    if (first.issue_date && last.issue_date) {
      const d1 = new Date(first.issue_date), d2 = new Date(last.issue_date)
      days = Math.round((d2 - d1) / (1000 * 60 * 60 * 24))
    }
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 12)
    const active = last.issue_date && new Date(last.issue_date) >= cutoff
    return { first, last, assets: assets.size, totalCost, days, active, brand: first.brand, description: first.description }
  }, [records])

  const timeline = useMemo(() => {
    if (records.length === 0) return []
    const groups = []
    let currentGroup = null
    records.forEach(r => {
      if (!currentGroup || currentGroup.asset !== r.asset_no) {
        currentGroup = { asset: r.asset_no, records: [] }
        groups.push(currentGroup)
      }
      currentGroup.records.push(r)
    })
    return groups
  }, [records])

  function exportLifecyclePdf() {
    try {
      exportToPdf(
        records,
        [
          { key: 'issue_date',  header: 'Date' },
          { key: 'asset_no',    header: 'Asset No' },
          { key: 'site',        header: 'Site' },
          { key: 'position',    header: 'Position' },
          { key: 'brand',       header: 'Brand' },
          { key: 'description', header: 'Description' },
          { key: 'risk_level',  header: 'Risk' },
          { key: 'cost',        header: 'Cost' },
        ],
        `Serial Lifecycle: ${lastQuery}`,
        reportFileName('TyrePulse Serial', lastQuery),
        'landscape'
      )
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  function exportLifecycleExcel() {
    try {
      exportToExcel(
        records,
        ['issue_date','asset_no','site','position','brand','description','risk_level','cost','remarks'],
        ['Date','Asset No','Site','Position','Brand','Description','Risk','Cost','Remarks'],
        reportFileName('TyrePulse Serial', lastQuery)
      )
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const riskColor = r => {
    if (!r) return 'text-[var(--text-muted)]'
    const l = r.toLowerCase()
    if (l === 'critical') return 'text-red-400'
    if (l === 'high')     return 'text-orange-400'
    if (l === 'medium')   return 'text-yellow-400'
    return 'text-green-400'
  }

  // ── Bulk Lookup ───────────────────────────────────────────────────────────
  const SERIAL_HEADERS = ['serial_no', 'Serial No', 'Serial Number', 'serial']

  function extractSerialsFromSheet(wb, XLSX) {
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    if (rows.length === 0) return []
    const firstRow = rows[0]
    const matchedKey = SERIAL_HEADERS.find(h => h in firstRow)
    if (!matchedKey) return []
    const serials = rows.map(r => String(r[matchedKey] || '').trim()).filter(Boolean)
    return [...new Set(serials)]
  }

  async function processBulkFile(file) {
    const XLSX = await import('xlsx')
    setBulkFileName(file.name)
    setBulkLoading(true)
    setBulkDone(false)
    setBulkResults([])
    setBulkSearch('')
    setStatusFilter(null)
    setError(null)

    try {
      const arrayBuffer = await file.arrayBuffer()
      const wb = XLSX.read(arrayBuffer, { type: 'array' })
      const serials = extractSerialsFromSheet(wb, XLSX)

      if (serials.length === 0) {
        setBulkLoading(false)
        setBulkDone(true)
        return
      }

      const cutoff = new Date()
      cutoff.setMonth(cutoff.getMonth() - 12)
      const cutoffStr = cutoff.toISOString().split('T')[0]

      const results = []
      const BATCH_SIZE = 10

      for (let i = 0; i < serials.length; i += BATCH_SIZE) {
        const batch = serials.slice(i, i + BATCH_SIZE)
        const batchResults = await Promise.all(
          batch.map(async serial => {
            const { data, error: qErr } = await supabase
              .from('tyre_records')
              .select('serial_no, issue_date, asset_no, status, cost:cost_per_tyre')
              .eq('serial_no', serial)
              .order('issue_date', { ascending: true })
            if (qErr) throw qErr
            if (!data || data.length === 0) {
              return { serial, first_seen: null, last_asset: null, total_records: 0, cost: 0, status: 'Not Found' }
            }
            const first = data[0]
            const last  = data[data.length - 1]
            const scrapped = data.some(r => /scrap/i.test(r.status || ''))
            const isActive = last.issue_date && last.issue_date >= cutoffStr
            const cost = data.reduce((s, r) => s + (parseFloat(r.cost) || 0), 0)
            return {
              serial,
              first_seen: first.issue_date || null,
              last_asset: last.asset_no || null,
              total_records: data.length,
              cost,
              status: scrapped ? 'Scrapped' : isActive ? 'Active' : 'Retired',
            }
          })
        )
        results.push(...batchResults)
      }

      setBulkResults(results)
    } catch (err) {
      setError(toUserMessage(err, 'Could not process that file.'))
      setBulkResults([])
    } finally {
      setBulkLoading(false)
      setBulkDone(true)
    }
  }

  function handleBulkFileInput(e) {
    const file = e.target.files?.[0]
    if (file) processBulkFile(file)
  }

  function handleBulkDrop(e) {
    e.preventDefault()
    setBulkDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processBulkFile(file)
  }

  function exportBulkExcel() {
    try {
      exportToExcel(
        bulkResults,
        ['serial', 'first_seen', 'last_asset', 'total_records', 'cost', 'status'],
        ['Serial No', 'First Seen', 'Last Asset', 'Records', 'Cost', 'Status'],
        'TyrePulse_BulkLookup'
      )
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const bulkSummary = useMemo(() => {
    if (bulkResults.length === 0) return null
    const found   = bulkResults.filter(r => r.status !== 'Not Found').length
    const active  = bulkResults.filter(r => r.status === 'Active').length
    const retired = bulkResults.filter(r => r.status === 'Retired').length
    const scrapped = bulkResults.filter(r => r.status === 'Scrapped').length
    const notFound = bulkResults.filter(r => r.status === 'Not Found').length
    return { total: found, active, retired, scrapped, notFound }
  }, [bulkResults])

  const filteredBulkResults = useMemo(() => {
    let rows = bulkResults
    if (statusFilter) rows = rows.filter(r => r.status === statusFilter)
    if (bulkSearch.trim()) {
      const q = bulkSearch.trim().toLowerCase()
      rows = rows.filter(r =>
        r.serial.toLowerCase().includes(q) ||
        (r.last_asset || '').toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      )
    }
    return rows
  }, [bulkResults, bulkSearch, statusFilter])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Serial Tracker"
        subtitle="Search a tyre by serial number, trace its history, and mark it as scrap"
        icon={ScanLine}
      />

      <div className="flex gap-1 p-1 bg-[var(--surface-2)] rounded-lg w-fit">
        {[['single', 'Single Search'], ['bulk', 'Bulk Lookup']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === key ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Single Search tab ──────────────────────────────────────────────── */}
      {activeTab === 'single' && (
        <>
          <div className="card">
            <div className="flex gap-3">
              <input
                className="input flex-1 text-base"
                placeholder="Enter serial number (case-sensitive)..."
                value={serialInput}
                onChange={e => setSerialInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
              />
              <button onClick={search} disabled={loading || !serialInput.trim()}
                className="btn-primary flex items-center gap-2 px-5 disabled:opacity-50">
                <Search size={16} />
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          {loading && <SearchSkeleton />}

          {!loading && error && (
            <div className="card border border-red-500/30 flex items-center gap-3">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <p className="text-sm text-red-300 flex-1">{error}</p>
              <button onClick={search} className="btn-secondary text-xs px-3 py-1.5">Retry</button>
            </div>
          )}

          {!loading && !error && searched && records.length === 0 && (
            <div className="card">
              <EmptyState
                illustration="state/search-empty"
                icon={ScanLine}
                title="No records found"
                description={`No tyre records match serial "${lastQuery}". Check spelling and capitalisation.`}
              />
            </div>
          )}

          {!loading && stats && (
            <>
              <div className="card">
                <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="text-2xl font-bold font-mono text-[var(--text-primary)]">{lastQuery}</span>
                      {scrapMark ? (
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium border bg-red-900/30 text-red-400 border-red-700/50 flex items-center gap-1">
                          <Trash2 size={12} /> Scrapped
                        </span>
                      ) : (
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                          stats.active
                            ? 'bg-green-900/30 text-green-400 border-green-700/50'
                            : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
                        }`}>
                          {stats.active ? 'Active' : 'Retired'}
                        </span>
                      )}
                    </div>
                    {(stats.brand || stats.description) && (
                      <p className="text-[var(--text-secondary)] text-sm">{[stats.brand, stats.description].filter(Boolean).join(' · ')}</p>
                    )}
                    {scrapMark && (
                      <p className="text-xs text-red-300/80 mt-1">
                        Scrapped {formatDate(scrapMark.created_at)}{scrapMark.reason ? ` · ${scrapMark.reason}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {scrapMark ? (
                      <button onClick={undoScrap} disabled={scrapBusy}
                        className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50">
                        <RotateCcw size={14} /> {scrapBusy ? 'Working...' : 'Undo scrap'}
                      </button>
                    ) : (
                      <button onClick={() => { setScrapErr(null); setScrapReason(''); setScrapOpen(true) }}
                        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md font-medium border border-red-700/50 bg-red-900/20 text-red-300 hover:bg-red-900/40 transition-colors">
                        <Trash2 size={14} /> Mark as Scrap
                      </button>
                    )}
                    <button onClick={exportLifecycleExcel} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                      <Download size={14} /> Excel
                    </button>
                    <button onClick={exportLifecyclePdf} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                      <FileText size={14} /> PDF
                    </button>
                  </div>
                </div>
                {scrapErr && (
                  <div className="mb-3 -mt-1 flex items-center gap-2 text-sm text-red-300">
                    <AlertTriangle size={14} className="shrink-0" /> {scrapErr}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'First Used',      value: formatDate(stats.first.issue_date) },
                    { label: 'Total Records',   value: records.length },
                    { label: 'Vehicles Used',   value: stats.assets },
                    { label: 'Days in Service', value: stats.days || '-' },
                  ].map(s => (
                    <div key={s.label} className="bg-[var(--surface-2)] rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-[var(--text-primary)]">{s.value}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
                {stats.totalCost > 0 && (
                  <p className="text-[var(--text-secondary)] text-sm mt-3">
                    Total cost: <span className="text-[var(--text-primary)] font-semibold">{formatCurrencyCompact(stats.totalCost)}</span>
                  </p>
                )}
              </div>

              <div className="card">
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-4">Service Timeline</h3>
                <div className="space-y-4">
                  {timeline.map((group, gi) => (
                    <div key={gi}>
                      {gi > 0 && (
                        <div className="flex items-center gap-2 py-1 px-3 rounded-md text-xs text-blue-400 bg-blue-900/20 border border-blue-800/40 mb-3 w-fit">
                          Transferred to {group.asset || 'unknown'}
                        </div>
                      )}
                      <div className="mb-1">
                        <span className="text-sm font-semibold text-[var(--text-primary)] font-mono">{group.asset || 'Unknown Asset'}</span>
                        <span className="text-xs text-[var(--text-muted)] ml-2">{group.records.length} record{group.records.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="space-y-2 pl-3 border-l border-[var(--border-bright)]">
                        {group.records.map(r => (
                          <div key={r.id} className="flex items-start gap-3 py-2">
                            <div className="text-xs font-mono text-[var(--text-muted)] w-24 flex-shrink-0 pt-0.5">{formatDate(r.issue_date)}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                                <span className="text-[var(--text-secondary)]">{r.site || '-'}</span>
                                {r.position && <span className="text-[var(--text-muted)]">Pos: <span className="text-[var(--text-primary)] font-mono">{r.position}</span></span>}
                                {r.risk_level && <span className={riskColor(r.risk_level)}>{r.risk_level}</span>}
                                {r.cost > 0 && <span className="text-[var(--text-muted)]">{formatCurrencyCompact(r.cost)}</span>}
                              </div>
                              {r.description && <p className="text-xs text-[var(--text-dim)] mt-0.5 truncate">{r.description}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Bulk Lookup tab ────────────────────────────────────────────────── */}
      {activeTab === 'bulk' && (
        <div className="space-y-4">
          <div
            className={`card border-2 border-dashed transition-all cursor-pointer ${
              bulkDragOver ? 'border-green-500 bg-green-900/10' : 'border-[var(--border-bright)] hover:border-gray-500'
            }`}
            onDragOver={e => { e.preventDefault(); setBulkDragOver(true) }}
            onDragLeave={() => setBulkDragOver(false)}
            onDrop={handleBulkDrop}
            onClick={() => bulkFileRef.current?.click()}
          >
            <input
              ref={bulkFileRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={handleBulkFileInput}
            />
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center pointer-events-none">
              <Upload size={32} className={bulkDragOver ? 'text-green-400' : 'text-[var(--text-muted)]'} />
              <p className="text-[var(--text-primary)] font-medium">
                {bulkFileName ? bulkFileName : 'Drop an Excel or CSV file here'}
              </p>
              <p className="text-[var(--text-muted)] text-sm">
                File must have a column: <span className="font-mono text-[var(--text-secondary)]">serial_no</span>, <span className="font-mono text-[var(--text-secondary)]">Serial No</span>, <span className="font-mono text-[var(--text-secondary)]">Serial Number</span>, or <span className="font-mono text-[var(--text-secondary)]">serial</span>
              </p>
              <button
                className="btn-secondary text-sm px-4 py-1.5 pointer-events-auto"
                onClick={e => { e.stopPropagation(); bulkFileRef.current?.click() }}
              >
                Browse File
              </button>
            </div>
          </div>

          {bulkLoading && (
            <div className="card text-center py-10">
              <div className="inline-block w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-[var(--text-secondary)]">Processing serial numbers...</p>
            </div>
          )}

          {error && !bulkLoading && (
            <div className="card border border-red-500/30 flex items-center gap-3">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <p className="text-sm text-red-300 flex-1">{error}</p>
            </div>
          )}

          {bulkDone && !bulkLoading && !error && (
            <>
              {bulkSummary && (
                <div className="rounded-xl px-5 py-4 space-y-3"
                  style={{ background: 'rgba(22,163,74,0.10)', border: '1px solid rgba(22,163,74,0.3)' }}>
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: 'Found',   value: bulkSummary.total,    key: null,         active: statusFilter === null, color: 'green' },
                        { label: 'Active',  value: bulkSummary.active,   key: 'Active',     active: statusFilter === 'Active',   color: 'emerald' },
                        { label: 'Retired', value: bulkSummary.retired,  key: 'Retired',    active: statusFilter === 'Retired',  color: 'gray' },
                        { label: 'Scrapped', value: bulkSummary.scrapped, key: 'Scrapped',  active: statusFilter === 'Scrapped',  color: 'red' },
                        { label: 'Missing', value: bulkSummary.notFound, key: 'Not Found',  active: statusFilter === 'Not Found', color: 'red' },
                      ].map(chip => (
                        <button
                          key={chip.label}
                          onClick={() => setStatusFilter(chip.active && chip.key !== null ? null : chip.key)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                            chip.active && chip.key === null
                              ? 'bg-green-900/40 text-green-300 border-green-600/50'
                              : chip.active
                                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] border-gray-500'
                                : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)] hover:border-gray-500 hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <span className={`text-base font-bold ${
                            chip.label === 'Found'   ? 'text-green-400' :
                            chip.label === 'Active'  ? 'text-emerald-400' :
                            chip.label === 'Missing' || chip.label === 'Scrapped' ? 'text-red-400' : 'text-[var(--text-secondary)]'
                          }`}>{chip.value}</span>
                          <span>{chip.label}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                          className="input text-sm pl-7 pr-3 py-1.5 w-44"
                          placeholder="Filter results..."
                          value={bulkSearch}
                          onChange={e => setBulkSearch(e.target.value)}
                        />
                      </div>
                      <button onClick={exportBulkExcel} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                        <Download size={14} /> Export
                      </button>
                    </div>
                  </div>
                  {(statusFilter || bulkSearch.trim()) && (
                    <p className="text-xs text-[var(--text-muted)]">
                      Showing {filteredBulkResults.length} of {bulkResults.length} results
                      {statusFilter && <> · filtered by <span className="text-[var(--text-secondary)]">{statusFilter}</span></>}
                      {bulkSearch.trim() && <> · matching <span className="text-[var(--text-secondary)]">"{bulkSearch}"</span></>}
                      <button onClick={() => { setStatusFilter(null); setBulkSearch('') }} className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline">Clear</button>
                    </p>
                  )}
                </div>
              )}

              {bulkResults.length === 0 ? (
                <div className="card">
                  <EmptyState
                    illustration="state/search-empty"
                    icon={FileText}
                    title="No serials found"
                    description="No serial numbers could be extracted from the file. Check that it has a recognised column header."
                  />
                </div>
              ) : filteredBulkResults.length === 0 ? (
                <div className="card text-center py-10">
                  <p className="text-[var(--text-secondary)]">No results match the current filter.</p>
                  <button onClick={() => { setStatusFilter(null); setBulkSearch('') }} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline mt-1">Clear filters</button>
                </div>
              ) : (
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--text-secondary)] border-b border-[var(--border-dim)]">
                        <th className="pb-2 pr-4">Serial No</th>
                        <th className="pb-2 pr-4">First Seen</th>
                        <th className="pb-2 pr-4">Last Asset</th>
                        <th className="pb-2 pr-4 text-right">Records</th>
                        <th className="pb-2 pr-4 text-right">Cost</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBulkResults.map(r => (
                        <tr key={r.serial} className="border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)]">
                          <td className="py-2 pr-4 font-mono text-[var(--text-primary)]">{r.serial}</td>
                          <td className="py-2 pr-4 text-[var(--text-secondary)] text-xs">{formatDate(r.first_seen)}</td>
                          <td className="py-2 pr-4 font-mono text-[var(--text-secondary)] text-xs">{r.last_asset || '-'}</td>
                          <td className="py-2 pr-4 text-[var(--text-secondary)] text-right">{r.total_records}</td>
                          <td className="py-2 pr-4 text-[var(--text-secondary)] text-right text-xs">
                            {r.cost > 0 ? formatCurrencyCompact(r.cost) : '-'}
                          </td>
                          <td className="py-2">
                            {r.status === 'Not Found' ? (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border-bright)]">Not Found</span>
                            ) : r.status === 'Active' ? (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-green-900/30 text-green-400 border-green-700/50">Active</span>
                            ) : r.status === 'Scrapped' ? (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-red-900/30 text-red-400 border-red-700/50">Scrapped</span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]">Retired</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Scrap confirmation modal ───────────────────────────────────────── */}
      {scrapOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !scrapBusy && setScrapOpen(false)}>
          <div className="card w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-red-900/30 text-red-400"><Trash2 size={18} /></div>
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">Mark tyre as scrap</h3>
                  <p className="text-xs text-[var(--text-muted)] font-mono">{lastQuery}</p>
                </div>
              </div>
              <button onClick={() => !scrapBusy && setScrapOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              This flags the tyre and all {records.length} of its record{records.length !== 1 ? 's' : ''} as Scrapped, removing it from active and pool counts. You can undo this later.
            </p>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Reason (optional)</label>
            <textarea
              className="input w-full text-sm min-h-[72px]"
              placeholder="e.g. Worn beyond limit, sidewall damage, retread failed..."
              value={scrapReason}
              onChange={e => setScrapReason(e.target.value)}
            />
            {scrapErr && (
              <div className="mt-2 flex items-center gap-2 text-sm text-red-300">
                <AlertTriangle size={14} className="shrink-0" /> {scrapErr}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setScrapOpen(false)} disabled={scrapBusy} className="btn-secondary text-sm px-4 py-1.5 disabled:opacity-50">Cancel</button>
              <button onClick={confirmScrap} disabled={scrapBusy}
                className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-md font-medium border border-red-700/50 bg-red-600/80 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
                <Trash2 size={14} /> {scrapBusy ? 'Marking...' : 'Confirm scrap'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
