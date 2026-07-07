/**
 * ReportBuilder - roadmap item 12. Users compose reports themselves instead of
 * waiting for hardcoded pages: pick a module, columns, filters, sort and an
 * optional chart; run it (allowlist-validated in reportDefinitions.runReport),
 * save it (private or org-shared via V100 RLS) and export results to CSV/Excel.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  FileBarChart, Plus, Play, Save, Trash2, Loader2, AlertTriangle, RefreshCw,
  Search, Share2, Lock, Download, FileSpreadsheet, X, ChevronDown, BarChart3,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import * as XLSX from 'xlsx'
import {
  MODULE_TABLES, MODULE_COLUMNS, FILTER_OPERATORS,
  listReportDefinitions, createReportDefinition, updateReportDefinition,
  deleteReportDefinition, runReport,
} from '../lib/api/reportDefinitions'
import { useAuth } from '../contexts/AuthContext'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend,
)

const MODULE_LABELS = {
  tyres: 'Tyres', inspections: 'Inspections', work_orders: 'Work Orders',
  accidents: 'Accidents', stock: 'Stock', fleet: 'Fleet', purchase_orders: 'Purchase Orders',
}
const CHART_TYPES = [
  { value: '',     label: 'No chart' },
  { value: 'bar',  label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'doughnut', label: 'Doughnut' },
]
const RESULT_LIMIT = 1000

const emptyDraft = () => ({
  id: null, name: '', description: '', module: 'tyres',
  columns: ['asset_no', 'site', 'brand', 'cost_per_tyre', 'issue_date'],
  filters: [], sort: null, chart: null, shared: false,
})

/** Client-side aggregation for the chart preview: count or sum per group. */
export function aggregateForChart(rows, chart) {
  if (!chart?.groupBy) return []
  const groups = new Map()
  for (const row of rows) {
    const key = String(row[chart.groupBy] ?? '—')
    const prev = groups.get(key) ?? 0
    if (chart.aggregate === 'sum') {
      const n = Number(row[chart.field])
      groups.set(key, prev + (Number.isFinite(n) ? n : 0))
    } else {
      groups.set(key, prev + 1)
    }
  }
  return [...groups.entries()]
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20)
}

/** Build a CSV string from result rows honouring the column order. */
export function buildCsv(rows, columns) {
  const esc = v => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map(r => columns.map(c => esc(r[c])).join(','))].join('\n')
}

const PALETTE = ['#f97316', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#ef4444', '#14b8a6', '#f43f5e', '#8b5cf6', '#84cc16']

export default function ReportBuilder() {
  const { user } = useAuth()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState(emptyDraft)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState(null)
  const [results, setResults] = useState(null)
  const [notice, setNotice] = useState(null)

  const moduleColumns = MODULE_COLUMNS[draft.module] ?? []
  const columnLabel = useCallback(
    name => moduleColumns.find(c => c.name === name)?.label ?? name,
    [moduleColumns],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setReports(await listReportDefinitions())
    } catch (e) {
      setLoadError(e.message || 'Could not load reports')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const patchDraft = patch => { setDraft(d => ({ ...d, ...patch })); setDirty(true) }

  const selectReport = r => {
    setDraft({
      id: r.id, name: r.name, description: r.description ?? '', module: r.module,
      columns: r.columns ?? [], filters: r.filters ?? [], sort: r.sort ?? null,
      chart: r.chart ?? null, shared: !!r.shared,
    })
    setDirty(false)
    setResults(null)
    setRunError(null)
  }

  const changeModule = module => {
    const cols = (MODULE_COLUMNS[module] ?? []).slice(0, 5).map(c => c.name)
    setDraft(d => ({ ...d, module, columns: cols, filters: [], sort: null, chart: null }))
    setDirty(true)
    setResults(null)
  }

  const toggleColumn = name => {
    setDraft(d => {
      const has = d.columns.includes(name)
      if (has && d.columns.length === 1) return d
      return { ...d, columns: has ? d.columns.filter(c => c !== name) : [...d.columns, name] }
    })
    setDirty(true)
  }

  const run = async () => {
    setRunning(true)
    setRunError(null)
    try {
      const rows = await runReport(draft, { limit: RESULT_LIMIT })
      setResults({ rows, ranAt: new Date() })
    } catch (e) {
      setRunError(e.message || 'Report failed')
      setResults(null)
    } finally {
      setRunning(false)
    }
  }

  const save = async (asCopy = false) => {
    if (!draft.name.trim()) { setNotice({ tone: 'error', text: 'Give the report a name before saving.' }); return }
    setSaving(true)
    try {
      const values = {
        name: draft.name.trim(), description: draft.description.trim() || null,
        module: draft.module, columns: draft.columns, filters: draft.filters,
        sort: draft.sort, chart: draft.chart, shared: draft.shared,
      }
      if (draft.id && !asCopy) {
        await updateReportDefinition(draft.id, values)
        setNotice({ tone: 'ok', text: 'Report saved.' })
      } else {
        const created = await createReportDefinition(values)
        setDraft(d => ({ ...d, id: created.id }))
        setNotice({ tone: 'ok', text: asCopy ? 'Saved as a copy.' : 'Report created.' })
      }
      setDirty(false)
      await load()
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async r => {
    if (!window.confirm(`Delete report "${r.name}"? This cannot be undone.`)) return
    try {
      await deleteReportDefinition(r.id)
      if (draft.id === r.id) { setDraft(emptyDraft()); setResults(null) }
      await load()
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || 'Delete failed' })
    }
  }

  const exportCsv = () => {
    const blob = new Blob([buildCsv(results.rows, draft.columns)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${draft.name || 'report'}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const exportXlsx = () => {
    const data = results.rows.map(r => Object.fromEntries(draft.columns.map(c => [columnLabel(c), r[c]])))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, MODULE_LABELS[draft.module] ?? 'Report')
    XLSX.writeFile(wb, `${draft.name || 'report'}.xlsx`)
  }

  const chartData = useMemo(() => {
    if (!results || !draft.chart?.type || !draft.chart?.groupBy) return null
    const agg = aggregateForChart(results.rows, draft.chart)
    if (!agg.length) return null
    return {
      labels: agg.map(a => a.label),
      datasets: [{
        label: draft.chart.aggregate === 'sum' ? `Sum of ${columnLabel(draft.chart.field)}` : 'Count',
        data: agg.map(a => a.value),
        backgroundColor: draft.chart.type === 'doughnut' ? PALETTE : 'rgba(249,115,22,0.7)',
        borderColor: draft.chart.type === 'line' ? '#f97316' : undefined,
        tension: 0.3,
      }],
    }
  }, [results, draft.chart, columnLabel])

  const chartOptions = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: draft.chart?.type === 'doughnut', labels: { color: '#9ca3af' } } },
    scales: draft.chart?.type === 'doughnut' ? undefined : {
      x: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(75,85,99,0.3)' } },
      y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(75,85,99,0.3)' } },
    },
  }), [draft.chart])

  const visibleReports = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? reports.filter(r => r.name.toLowerCase().includes(q)) : reports
  }, [reports, search])

  useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileBarChart className="w-6 h-6 text-orange-400" /> Report Builder
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Compose, run, save and export custom reports across every module.
          </p>
        </div>
        <button
          onClick={() => { setDraft(emptyDraft()); setResults(null); setDirty(false) }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New Report
        </button>
      </div>

      {notice && (
        <div className={`px-4 py-2 rounded-lg text-sm ${notice.tone === 'ok'
          ? 'bg-green-500/10 border border-green-500/40 text-green-300'
          : 'bg-red-500/10 border border-red-500/40 text-red-300'}`}>
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* ── Saved reports ─────────────────────────────────────────────── */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-3 space-y-2 lg:col-span-1 self-start">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-500" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search reports…"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-500"
            />
          </div>
          {loading ? (
            <div className="space-y-2 py-2">
              {[0, 1, 2].map(i => <div key={i} className="h-12 bg-gray-700/50 rounded-lg animate-pulse" />)}
            </div>
          ) : loadError ? (
            <div className="text-center py-6 space-y-2">
              <AlertTriangle className="w-6 h-6 text-red-400 mx-auto" />
              <p className="text-sm text-red-300">{loadError}</p>
              <button onClick={load} className="inline-flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300">
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          ) : visibleReports.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              {search ? 'No reports match your search.' : 'No saved reports yet — build one and hit Save.'}
            </p>
          ) : visibleReports.map(r => (
            <div
              key={r.id}
              onClick={() => selectReport(r)}
              className={`p-3 rounded-lg cursor-pointer border transition-colors ${draft.id === r.id
                ? 'bg-orange-500/10 border-orange-500/50'
                : 'bg-gray-900/60 border-gray-700 hover:border-gray-600'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{r.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {MODULE_LABELS[r.module] ?? r.module} · {(r.columns ?? []).length} columns
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {r.shared
                    ? <Share2 className="w-3.5 h-3.5 text-blue-400" title="Shared with organisation" />
                    : <Lock className="w-3.5 h-3.5 text-gray-500" title="Private" />}
                  {r.user_id === user?.id && (
                    <button
                      onClick={e => { e.stopPropagation(); remove(r) }}
                      className="text-gray-500 hover:text-red-400" title="Delete report"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Builder + results ─────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Report name</label>
                <input
                  value={draft.name} onChange={e => patchDraft({ name: e.target.value })}
                  placeholder="e.g. Monthly tyre spend by site"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Module</label>
                <select
                  value={draft.module} onChange={e => changeModule(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
                >
                  {Object.keys(MODULE_TABLES).map(m => (
                    <option key={m} value={m}>{MODULE_LABELS[m] ?? m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Description (optional)</label>
                <input
                  value={draft.description} onChange={e => patchDraft({ description: e.target.value })}
                  placeholder="What this report answers"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-2">
                Columns <span className="text-gray-600">({draft.columns.length} selected, order = click order)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {moduleColumns.map(c => {
                  const on = draft.columns.includes(c.name)
                  return (
                    <button
                      key={c.name} onClick={() => toggleColumn(c.name)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${on
                        ? 'bg-orange-500/20 border-orange-500/60 text-orange-300'
                        : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'}`}
                    >
                      {c.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400">Filters (all must match)</label>
                <button
                  onClick={() => patchDraft({ filters: [...draft.filters, { field: moduleColumns[0]?.name, operator: 'eq', value: '' }] })}
                  className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add filter
                </button>
              </div>
              {draft.filters.length === 0 ? (
                <p className="text-xs text-gray-600">No filters — the report returns everything (capped at {RESULT_LIMIT} rows).</p>
              ) : draft.filters.map((f, i) => {
                const fieldType = moduleColumns.find(c => c.name === f.field)?.type ?? 'text'
                const noValue = f.operator === 'is_null' || f.operator === 'not_null'
                const setF = patch => patchDraft({
                  filters: draft.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                })
                return (
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <select
                      value={f.field} onChange={e => setF({ field: e.target.value })}
                      className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200"
                    >
                      {moduleColumns.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
                    </select>
                    <select
                      value={f.operator} onChange={e => setF({ operator: e.target.value })}
                      className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200"
                    >
                      {FILTER_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {!noValue && (
                      <input
                        type={fieldType === 'number' ? 'number' : fieldType === 'date' ? 'date' : 'text'}
                        value={f.value ?? ''} onChange={e => setF({ value: e.target.value })}
                        placeholder="Value"
                        className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600"
                      />
                    )}
                    <button
                      onClick={() => patchDraft({ filters: draft.filters.filter((_, j) => j !== i) })}
                      className="text-gray-500 hover:text-red-400" title="Remove filter"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-400 block mb-1">Sort by</label>
                  <select
                    value={draft.sort?.field ?? ''}
                    onChange={e => patchDraft({ sort: e.target.value ? { field: e.target.value, dir: draft.sort?.dir ?? 'desc' } : null })}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
                  >
                    <option value="">Default order</option>
                    {moduleColumns.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
                  </select>
                </div>
                {draft.sort?.field && (
                  <select
                    value={draft.sort.dir}
                    onChange={e => patchDraft({ sort: { ...draft.sort, dir: e.target.value } })}
                    className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
                  >
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Chart</label>
                  <select
                    value={draft.chart?.type ?? ''}
                    onChange={e => patchDraft({
                      chart: e.target.value
                        ? { type: e.target.value, groupBy: draft.chart?.groupBy ?? moduleColumns[0]?.name, aggregate: draft.chart?.aggregate ?? 'count', field: draft.chart?.field ?? null }
                        : null,
                    })}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-sm text-gray-200"
                  >
                    {CHART_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {draft.chart?.type && (
                  <>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Group by</label>
                      <select
                        value={draft.chart.groupBy}
                        onChange={e => patchDraft({ chart: { ...draft.chart, groupBy: e.target.value } })}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-sm text-gray-200"
                      >
                        {moduleColumns.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Aggregate</label>
                      <select
                        value={draft.chart.aggregate === 'sum' ? `sum:${draft.chart.field ?? ''}` : 'count'}
                        onChange={e => {
                          const v = e.target.value
                          patchDraft({
                            chart: v === 'count'
                              ? { ...draft.chart, aggregate: 'count', field: null }
                              : { ...draft.chart, aggregate: 'sum', field: v.slice(4) },
                          })
                        }}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-sm text-gray-200"
                      >
                        <option value="count">Count</option>
                        {moduleColumns.filter(c => c.type === 'number').map(c => (
                          <option key={c.name} value={`sum:${c.name}`}>Sum of {c.label}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-gray-700">
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox" checked={draft.shared}
                  onChange={e => patchDraft({ shared: e.target.checked })}
                  className="rounded border-gray-600 bg-gray-900 text-orange-500"
                />
                Share with organisation (read-only)
              </label>
              <div className="flex items-center gap-2">
                {dirty && <span className="text-xs text-yellow-400">Unsaved changes</span>}
                {draft.id && (
                  <button
                    onClick={() => save(true)} disabled={saving}
                    className="px-3 py-2 text-sm text-gray-300 border border-gray-600 rounded-lg hover:border-gray-500 disabled:opacity-50"
                  >
                    Save as copy
                  </button>
                )}
                <button
                  onClick={() => save(false)} disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {draft.id ? 'Save' : 'Save report'}
                </button>
                <button
                  onClick={run} disabled={running || draft.columns.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Run
                </button>
              </div>
            </div>
          </div>

          {/* ── Results ─────────────────────────────────────────────────── */}
          {runError && (
            <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">{runError}</p>
              <button onClick={run} className="ml-auto text-sm text-orange-400 hover:text-orange-300 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          )}

          {running && !results && (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-2">
              {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-8 bg-gray-700/50 rounded animate-pulse" />)}
            </div>
          )}

          {results && (
            <div className="bg-gray-800 rounded-xl border border-gray-700">
              <div className="flex items-center justify-between flex-wrap gap-2 p-4 border-b border-gray-700">
                <p className="text-sm text-gray-400">
                  <span className="text-white font-semibold">{results.rows.length.toLocaleString()}</span> rows
                  {results.rows.length >= RESULT_LIMIT && (
                    <span className="text-yellow-400"> (capped at {RESULT_LIMIT} — add filters to narrow down)</span>
                  )}
                  <span className="text-gray-600"> · ran {results.ranAt.toLocaleTimeString()}</span>
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={exportCsv} disabled={!results.rows.length}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 border border-gray-600 rounded-lg hover:border-gray-500 disabled:opacity-50">
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                  <button onClick={exportXlsx} disabled={!results.rows.length}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 border border-gray-600 rounded-lg hover:border-gray-500 disabled:opacity-50">
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                  </button>
                </div>
              </div>

              {chartData && (
                <div className="p-4 border-b border-gray-700">
                  <div className="h-64">
                    {draft.chart.type === 'bar' && <Bar data={chartData} options={chartOptions} />}
                    {draft.chart.type === 'line' && <Line data={chartData} options={chartOptions} />}
                    {draft.chart.type === 'doughnut' && <Doughnut data={chartData} options={chartOptions} />}
                  </div>
                </div>
              )}

              {results.rows.length === 0 ? (
                <div className="text-center py-10">
                  <BarChart3 className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No rows matched — loosen the filters and run again.</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-800">
                      <tr className="border-b border-gray-700">
                        {draft.columns.map(c => (
                          <th key={c} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                            {columnLabel(c)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.rows.map((r, i) => (
                        <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                          {draft.columns.map(c => (
                            <td key={c} className="px-4 py-2 text-gray-300 whitespace-nowrap max-w-xs truncate">
                              {r[c] == null || r[c] === '' ? <span className="text-gray-600">—</span> : String(r[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
