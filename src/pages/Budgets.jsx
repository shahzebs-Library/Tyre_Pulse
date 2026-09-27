/**
 * Budgets & Cost (route /budgets) - monthly budget vs tyre spend per site and
 * a 12-month planner grid where each site's monthly budget is edited in place.
 *
 * Every figure (spend per site/month, utilisation, remaining, the cumulative
 * planner series, spend at sites with no budget) is derived by the pure engine
 * src/lib/budgetsAnalytics.js. The page only reads, renders and writes.
 *
 * A failed read is shown as an error with Retry - never as "no budgets".
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import {
  Plus, Save, Download, FileText, PiggyBank, Search, X, AlertTriangle, RefreshCw,
  Wallet, TrendingUp, Percent, AlertCircle, Building2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardBody, CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import BudgetTabs from '../components/budgets/BudgetTabs'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import * as budgetsApi from '../lib/api/budgets'
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement,
  Filler, Tooltip, Legend, BarElement,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import { colorAt, withAlpha } from '../lib/reportColors'
import { compareValues, isBlank } from '../lib/consoleTable'
import {
  MONTH_LABELS, UTIL_BANDS, bandLabel, buildSpendIndex, monthlyRows, summarizeMonth,
  unbudgetedSpend, filterMonthlyRows, annualGrid, annualSummary, cumulativeSeries,
  monthlyExportRows, annualExportRows, annualExportColumns,
} from '../lib/budgetsAnalytics'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend, BarElement)

const CURRENT_YEAR  = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
const EMPTY_FORM = { site: '', monthly_budget: 25000, year: CURRENT_YEAR, month: CURRENT_MONTH }
const STATUS_OPTIONS = ['Draft', 'Approved', 'Overspent', 'Closed']

// Semantic utilisation tones: the text label always travels with the colour.
const BAND_TONE = {
  over: 'text-red-400',
  warn: 'text-amber-400',
  ok: 'text-green-400',
  none: 'text-[var(--text-muted)]',
}

/** Column sorting through the shared console comparator (blanks sort last). */
const sortable = (fn) => ({
  accessorFn: (r) => { const v = fn(r); return isBlank(v) ? undefined : v },
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
})

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: 'var(--text-muted)' } } },
  scales: {
    x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)' } },
    y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)' }, beginAtZero: true },
  },
}

function Kpi({ label, value, sub, icon: Icon, tone = 'text-[var(--text-primary)]', loading }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        {Icon && <Icon size={16} className={tone} aria-hidden="true" />}
      </div>
      {loading
        ? <div className="h-7 w-24 mt-2 rounded bg-[var(--input-bg)] animate-pulse" />
        : <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>}
      {sub && !loading && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </Card>
  )
}

function ErrorCard({ message, onRetry }) {
  return (
    <Card tone="crit" className="items-start gap-3" style={{ flexDirection: 'row' }} role="alert">
      <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-red-300 font-medium">Budgets could not be loaded.</p>
        <p className="text-[var(--text-muted)] text-sm mt-1">{message}</p>
      </div>
      <button type="button" onClick={onRetry} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
        <RefreshCw size={14} aria-hidden="true" /> Retry
      </button>
    </Card>
  )
}

export default function Budgets() {
  const reportMeta = useReportMeta('Budgets & Cost')
  const { profile }   = useAuth()
  const { activeCountry, activeCurrency } = useSettings()
  const { t } = useLanguage()
  const [budgets, setBudgets]     = useState([])
  const [tyreRows, setTyreRows]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [viewMode, setViewMode]   = useState('month')
  const [filterYear, setFilterYear]   = useState(CURRENT_YEAR)
  const [filterMonth, setFilterMonth] = useState(CURRENT_MONTH)
  const [plannerYear, setPlannerYear] = useState(CURRENT_YEAR)
  const [plannerEdits, setPlannerEdits] = useState({})
  const [savingPlanner, setSavingPlanner] = useState(false)
  const [search, setSearch] = useState('')
  const [bandFilter, setBandFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const isMonth = viewMode === 'month'
      const [budgetRes, tyreRes] = await Promise.all([
        isMonth
          ? budgetsApi.listBudgets({ country: activeCountry, year: filterYear, month: filterMonth })
          : budgetsApi.listBudgets({ country: activeCountry, year: plannerYear }),
        budgetsApi.listBudgetTyreRecords(isMonth
          ? {
              country: activeCountry,
              start: `${filterYear}-${String(filterMonth).padStart(2, '0')}-01`,
              end: filterMonth === 12
                ? `${filterYear + 1}-01-01`
                : `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-01`,
            }
          : { country: activeCountry, start: `${plannerYear}-01-01`, end: `${plannerYear + 1}-01-01` }),
      ])
      // The services return raw results; a failed read must surface, never
      // render as an empty register.
      if (budgetRes?.error) throw budgetRes.error
      if (tyreRes?.error) throw tyreRes.error
      setBudgets(budgetRes?.data ?? [])
      setTyreRows(tyreRes?.data ?? [])
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load budgets.'))
      setBudgets([])
      setTyreRows([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry, filterMonth, filterYear, plannerYear, viewMode])

  useEffect(() => { load() }, [load])

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    // `finally` is load-bearing: every close path is gated on `saving`, so a
    // stuck flag would make the dialog unclosable.
    try {
      const { error: err } = await budgetsApi.upsertBudget({
        ...form,
        region:     profile?.region ?? 'KSA',
        created_by: profile?.id,
      })
      if (err) { setError(toUserMessage(err)); return }
      setShowForm(false)
      load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the budget.'))
    } finally {
      setSaving(false)
    }
  }

  const closeForm = () => { if (!saving) setShowForm(false) }

  async function savePlannerEdits() {
    if (!Object.keys(plannerEdits).length) return
    setSavingPlanner(true)
    setActionError('')
    try {
      const upserts = Object.entries(plannerEdits).map(([key, value]) => {
        const [site, m] = key.split('~')
        return {
          site,
          month:          parseInt(m, 10),
          year:           plannerYear,
          monthly_budget: parseFloat(value) || 0,
          region:         profile?.region ?? 'KSA',
          created_by:     profile?.id,
        }
      })
      const res = await budgetsApi.upsertBudgets(upserts)
      // The edits stay in the grid when the write fails, so nothing is lost.
      if (res?.error) { setActionError(toUserMessage(res.error, 'Could not save the planner changes.')); return }
      setPlannerEdits({})
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not save the planner changes.'))
    } finally {
      setSavingPlanner(false)
    }
  }

  const changeStatus = useCallback(async (b, newStatus) => {
    setActionError('')
    try {
      await budgetsApi.updateBudgetStatus(b.id, newStatus)
      setBudgets((prev) => prev.map((x) => (x.id === b.id ? { ...x, status: newStatus } : x)))
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not update the budget status.'))
    }
  }, [])

  const monthLabels = useMemo(() => MONTH_LABELS.map((_, i) => t(`budgets.months.${i}`)), [t])

  // ── Monthly view ───────────────────────────────────────────────────────────
  const monthIndex = useMemo(
    () => buildSpendIndex(tyreRows, { year: filterYear, month: filterMonth }),
    [tyreRows, filterYear, filterMonth],
  )
  const allMonthRows = useMemo(
    () => (viewMode === 'month' ? monthlyRows(budgets, monthIndex, filterYear, filterMonth) : []),
    [viewMode, budgets, monthIndex, filterYear, filterMonth],
  )
  // The tiles cover the rows matching the SEARCH. The utilisation band and the
  // workflow status are held out: the tiles report on utilisation, so narrowing
  // them by it would only restate the choice.
  const kpiScope = useMemo(() => filterMonthlyRows(allMonthRows, { query: search }), [allMonthRows, search])
  const monthSummary = useMemo(() => summarizeMonth(kpiScope), [kpiScope])
  const visibleRows = useMemo(
    () => filterMonthlyRows(allMonthRows, { query: search, band: bandFilter, status: statusFilter }),
    [allMonthRows, search, bandFilter, statusFilter],
  )
  const unbudgeted = useMemo(
    () => (viewMode === 'month' ? unbudgetedSpend(monthIndex, budgets, filterYear, filterMonth) : []),
    [viewMode, monthIndex, budgets, filterYear, filterMonth],
  )
  const hasFilters = search || bandFilter !== 'all' || statusFilter !== 'all'
  const clearFilters = () => { setSearch(''); setBandFilter('all'); setStatusFilter('all') }

  const monthlyChartData = useMemo(() => {
    if (viewMode !== 'month' || visibleRows.length === 0) return null
    return {
      labels: visibleRows.map((r) => r.site),
      datasets: [
        {
          label: t('budgets.columns.budget', { currency: activeCurrency }),
          data: visibleRows.map((r) => r.budget),
          backgroundColor: withAlpha(colorAt(0), 0.7),
          borderRadius: 4,
        },
        {
          label: t('budgets.columns.spent', { currency: activeCurrency }),
          data: visibleRows.map((r) => r.spent),
          backgroundColor: visibleRows.map((r) => (r.band === 'over' ? 'rgba(239,68,68,0.75)' : 'rgba(16,185,129,0.65)')),
          borderRadius: 4,
        },
      ],
    }
  }, [viewMode, visibleRows, activeCurrency, t])

  const monthlyColumns = useMemo(() => [
    { id: 'site', header: t('budgets.columns.site'), ...sortable((r) => r.site), size: 160,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.site || 'N/A'}</span>,
    },
    { id: 'budget', header: t('budgets.columns.budget', { currency: activeCurrency }), ...sortable((r) => r.budget), size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.budget.toLocaleString()}</span>,
    },
    { id: 'spent', header: t('budgets.columns.spent', { currency: activeCurrency }), ...sortable((r) => r.spent), size: 130, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className={`font-medium tabular-nums ${row.original.band === 'over' ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>
          {row.original.spent.toLocaleString()}
        </span>
      ),
    },
    { id: 'remaining', header: t('budgets.columns.remaining'), ...sortable((r) => r.remaining), size: 130, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className={`font-medium tabular-nums ${row.original.remaining < 0 ? 'text-red-400' : 'text-green-400'}`}>
          {row.original.remaining.toLocaleString()}
        </span>
      ),
    },
    { id: 'progress', header: t('budgets.columns.progress'), ...sortable((r) => r.utilPct), size: 180,
      cell: ({ row }) => {
        const { utilPct, band } = row.original
        if (utilPct == null) return <span className="text-xs text-[var(--text-muted)]">N/A (no budget)</span>
        const pct = Math.min(utilPct, 100)
        return (
          <div className="flex items-center gap-2" title={bandLabel(band)}>
            <div className="w-24 h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden" aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: band === 'over' ? '#ef4444' : band === 'warn' ? '#f59e0b' : '#16a34a' }} />
            </div>
            <span className={`text-xs font-medium tabular-nums ${BAND_TONE[band]}`}>{utilPct.toFixed(0)}%</span>
          </div>
        )
      },
    },
    { id: 'band', header: 'Position', ...sortable((r) => bandLabel(r.band)), size: 150,
      cell: ({ row }) => <span className={`text-xs font-medium ${BAND_TONE[row.original.band]}`}>{bandLabel(row.original.band)}</span>,
    },
    { id: 'status', header: t('budgets.columns.status'), accessorFn: (r) => r.status, size: 140, enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const b = row.original
        return (
          <select
            className="input text-xs py-1 min-h-[36px]"
            aria-label={`Status for ${b.site || 'this budget'}`}
            value={b.status}
            onChange={(e) => changeStatus(b, e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(`budgets.status.${s.toLowerCase()}`)}</option>)}
          </select>
        )
      },
    },
  ], [activeCurrency, changeStatus, t])

  // ── Annual planner ─────────────────────────────────────────────────────────
  const plannerIndex = useMemo(() => buildSpendIndex(tyreRows, { year: plannerYear }), [tyreRows, plannerYear])
  const grid = useMemo(
    () => (viewMode === 'annual' ? annualGrid(budgets, plannerIndex, plannerYear, plannerEdits) : []),
    [viewMode, budgets, plannerIndex, plannerYear, plannerEdits],
  )
  const visibleGrid = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? grid.filter((r) => r.site.toLowerCase().includes(q)) : grid
  }, [grid, search])
  const yearSummary = useMemo(() => annualSummary(visibleGrid), [visibleGrid])
  const series = useMemo(() => cumulativeSeries(visibleGrid), [visibleGrid])

  const cumulativeChartData = useMemo(() => {
    if (viewMode !== 'annual' || !visibleGrid.length) return null
    return {
      labels: monthLabels,
      datasets: [
        {
          label: t('budgets.annual.budgetCeiling'),
          data: series.cumBudget,
          borderColor: 'rgba(239,68,68,0.85)',
          backgroundColor: 'rgba(239,68,68,0.05)',
          fill: true, tension: 0.3, borderDash: [5, 3], pointRadius: 3,
        },
        {
          label: t('budgets.annual.actualSpend'),
          data: series.cumSpend,
          borderColor: colorAt(0),
          backgroundColor: withAlpha(colorAt(0), 0.12),
          fill: true, tension: 0.3, pointRadius: 3,
        },
      ],
    }
  }, [viewMode, visibleGrid.length, series, monthLabels, t])

  const plannerColumns = useMemo(() => [
    { id: 'site', header: t('budgets.columns.site'), ...sortable((r) => r.site), size: 150,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.site}</span>,
    },
    ...monthLabels.map((label, i) => ({
      id: `m${i + 1}`,
      header: label,
      accessorFn: (r) => r.cells[i].budget,
      enableSorting: false,
      size: 96,
      meta: { export: false, align: 'center' },
      cell: ({ row }) => {
        const c = row.original.cells[i]
        const site = row.original.site
        return (
          <div>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              aria-label={`${site} ${label} budget`}
              className={`w-full min-w-[72px] text-center rounded py-1.5 px-1 text-xs border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                c.edited
                  ? 'bg-amber-500/10 border-amber-500/60 text-[var(--text-primary)]'
                  : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)]'
              }`}
              value={c.value}
              onChange={(e) => setPlannerEdits((prev) => ({ ...prev, [`${site}~${c.month}`]: e.target.value }))}
              placeholder="0"
            />
            {c.spent > 0 && (
              <div
                className={`text-[10px] mt-0.5 tabular-nums ${c.over ? 'text-red-400' : 'text-green-500'}`}
                title={t('budgets.annual.actualTooltip', { value: formatCurrencyCompact(c.spent, activeCurrency) })}
              >
                {c.over ? 'Over ' : 'Actual '}{formatCurrencyCompact(c.spent, activeCurrency)}
              </div>
            )}
          </div>
        )
      },
    })),
    { id: 'budgetTotal', header: t('budgets.columns.total'), ...sortable((r) => r.budgetTotal), size: 110, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="text-[var(--text-secondary)] font-medium tabular-nums">
          {row.original.budgetTotal > 0 ? formatCurrencyCompact(row.original.budgetTotal, activeCurrency) : 'N/A'}
        </span>
      ),
    },
    { id: 'spendTotal', header: 'Actual', ...sortable((r) => r.spendTotal), size: 110, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className={`font-medium tabular-nums ${row.original.budgetTotal > 0 && row.original.spendTotal > row.original.budgetTotal ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>
          {formatCurrencyCompact(row.original.spendTotal, activeCurrency)}
        </span>
      ),
    },
  ], [monthLabels, activeCurrency, t])

  // ── Exports ────────────────────────────────────────────────────────────────
  async function exportExcel() {
    setActionError('')
    try {
      if (viewMode === 'month') {
        const rows = monthlyExportRows(visibleRows)
        await exportToExcel(
          rows,
          ['site', 'budget', 'spent', 'remaining', 'util', 'band', 'status'],
          ['Site', `Budget (${activeCurrency})`, `Spent (${activeCurrency})`, 'Remaining', 'Utilisation', 'Position', 'Status'],
          reportFileName('Budgets', MONTH_LABELS[filterMonth - 1], filterYear),
          'Budget',
        )
      } else {
        const { keys, headers } = annualExportColumns()
        await exportToExcel(annualExportRows(visibleGrid), keys, headers, reportFileName('Budget planner', plannerYear), 'Annual Planner')
      }
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  async function exportPdfFn() {
    setActionError('')
    try {
      if (viewMode === 'month') {
        await exportToPdf(
          monthlyExportRows(visibleRows),
          [
            { key: 'site', header: 'Site' }, { key: 'budget', header: 'Budget' }, { key: 'spent', header: 'Spent' },
            { key: 'remaining', header: 'Remaining' }, { key: 'util', header: 'Utilisation' }, { key: 'band', header: 'Position' },
          ],
          `Budget Report ${MONTH_LABELS[filterMonth - 1]} ${filterYear}`,
          reportFileName('Budgets', MONTH_LABELS[filterMonth - 1], filterYear),
          'portrait', '', { currency: activeCurrency },
        )
      } else {
        await exportToPdf(
          visibleGrid.map((r) => ({
            site: r.site,
            budget: Math.round(r.budgetTotal),
            spent: Math.round(r.spendTotal),
            remaining: Math.round(r.budgetTotal - r.spendTotal),
            util: r.utilPct == null ? 'N/A' : `${r.utilPct.toFixed(1)}%`,
          })),
          [
            { key: 'site', header: 'Site' }, { key: 'budget', header: 'Annual budget' }, { key: 'spent', header: 'Actual' },
            { key: 'remaining', header: 'Remaining' }, { key: 'util', header: 'Utilisation' },
          ],
          `Budget Planner ${plannerYear}`,
          reportFileName('Budget planner', plannerYear),
          'portrait', '', { currency: activeCurrency },
        )
      }
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const canExport = viewMode === 'month' ? visibleRows.length > 0 : visibleGrid.length > 0
  const pendingEdits = Object.keys(plannerEdits).length
  const utilTone = (pct) => (pct == null ? 'text-[var(--text-muted)]' : BAND_TONE[pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'])

  return (
    <div className="space-y-4">
      <BudgetTabs />
      <PageHeader
        title={t('budgets.title')}
        subtitle={t('budgets.subtitle')}
        icon={PiggyBank}
        onRefresh={load}
        refreshing={loading}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportExcel} disabled={!canExport} className="btn-secondary text-sm flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
              <Download size={14} aria-hidden="true" /> {t('budgets.actions.excel')}
            </button>
            <button type="button" onClick={exportPdfFn} disabled={!canExport} className="btn-secondary text-sm flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
              <FileText size={14} aria-hidden="true" /> {t('budgets.actions.pdf')}
            </button>
            <button type="button" onClick={() => { setForm(EMPTY_FORM); setShowForm(true); setError('') }} className="btn-primary flex items-center gap-2 text-sm min-h-[44px]">
              <Plus size={16} aria-hidden="true" /> {t('budgets.actions.setBudget')}
            </button>
          </div>
        }
      />

      {/* View mode */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Budget view">
        {[['month', t('budgets.viewModes.month')], ['annual', t('budgets.viewModes.annual')]].map(([val, label]) => (
          <button
            key={val}
            type="button"
            role="tab"
            aria-selected={viewMode === val}
            onClick={() => setViewMode(val)}
            className={`px-4 min-h-[44px] rounded-lg text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 ${viewMode === val ? 'bg-blue-600 text-white' : 'bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loadError && <ErrorCard message={loadError} onRetry={load} />}
      {actionError && (
        <p role="alert" className="text-sm text-red-400 flex items-center gap-1.5">
          <AlertTriangle size={14} aria-hidden="true" /> {actionError}
        </p>
      )}

      {/* Filters shared by both views */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full" placeholder="Search sites" aria-label="Search sites" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {viewMode === 'month' ? (
            <>
              <select className="input w-auto" aria-label="Year" value={filterYear} onChange={(e) => setFilterYear(+e.target.value)}>
                {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <select className="input w-auto" aria-label="Month" value={filterMonth} onChange={(e) => setFilterMonth(+e.target.value)}>
                {monthLabels.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
              <select className="input w-auto" aria-label="Budget position" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)}>
                <option value="all">Any position</option>
                {UTIL_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
              <select className="input w-auto" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(`budgets.status.${s.toLowerCase()}`)}</option>)}
              </select>
            </>
          ) : (
            <select className="input w-auto" aria-label="Planner year" value={plannerYear} onChange={(e) => setPlannerYear(+e.target.value)}>
              {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">
            {viewMode === 'month' ? `${visibleRows.length} of ${allMonthRows.length} sites` : `${visibleGrid.length} of ${grid.length} sites`}
          </span>
        </div>
      </Card>

      {/* ── MONTHLY VIEW ──────────────────────────────────────────────────── */}
      {viewMode === 'month' && !loadError && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi loading={loading} label={t('budgets.kpi.totalBudget')} icon={Wallet} value={formatCurrencyCompact(monthSummary.totalBudget, activeCurrency)} sub={`${monthSummary.sites} site${monthSummary.sites === 1 ? '' : 's'}`} />
            <Kpi loading={loading} label={t('budgets.kpi.totalSpent')} icon={TrendingUp}
              tone={monthSummary.totalSpend > monthSummary.totalBudget ? 'text-red-400' : 'text-green-400'}
              value={formatCurrencyCompact(monthSummary.totalSpend, activeCurrency)} />
            <Kpi loading={loading} label={t('budgets.kpi.remaining')} icon={PiggyBank}
              tone={monthSummary.remaining < 0 ? 'text-red-400' : 'text-sky-400'}
              value={formatCurrencyCompact(monthSummary.remaining, activeCurrency)}
              sub={monthSummary.remaining < 0 ? 'Overspent' : undefined} />
            <Kpi loading={loading} label={t('budgets.kpi.utilization')} icon={Percent}
              tone={utilTone(monthSummary.utilPct)}
              value={monthSummary.utilPct == null ? 'N/A' : `${Math.round(monthSummary.utilPct)}%`}
              sub={monthSummary.utilPct == null ? 'No budget set' : undefined} />
            <Kpi loading={loading} label="Sites over budget" icon={AlertCircle}
              tone={monthSummary.overCount > 0 ? 'text-red-400' : 'text-[var(--text-primary)]'}
              value={monthSummary.overCount}
              sub={`${monthSummary.warnCount} near limit`} />
          </div>
          {!loading && kpiScope.length !== allMonthRows.length && (
            <p className="text-xs text-[var(--text-muted)] -mt-1">
              These figures cover the {kpiScope.length} site{kpiScope.length === 1 ? '' : 's'} matching your search, of {allMonthRows.length}.
              The position and status filters are not applied here, so utilisation stays readable.
            </p>
          )}

          {!loading && unbudgeted.length > 0 && (
            <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
              <Building2 size={16} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="text-sm">
                <p className="text-[var(--text-primary)] font-medium">
                  Spend with no budget set: {formatCurrencyCompact(unbudgeted.reduce((s, r) => s + r.spent, 0), activeCurrency)} at {unbudgeted.length} site{unbudgeted.length === 1 ? '' : 's'}
                </p>
                <p className="text-[var(--text-muted)] mt-0.5">
                  {unbudgeted.slice(0, 6).map((r) => `${r.site} (${formatCurrencyCompact(r.spent, activeCurrency)})`).join(', ')}
                  {unbudgeted.length > 6 ? ` and ${unbudgeted.length - 6} more` : ''}. These are not in the totals above.
                </p>
              </div>
            </Card>
          )}

          {!loading && monthlyChartData && (
            <Card>
              <CardHeader title={`${t('budgets.columns.budget', { currency: activeCurrency })} vs ${t('budgets.columns.spent', { currency: activeCurrency })}`} />
              <CardBody style={{ height: 280 }}>
                <Bar data={monthlyChartData} options={CHART_OPTS} aria-label="Budget versus spend by site" role="img" />
              </CardBody>
            </Card>
          )}

          <Card pad="none" clip>
            <EnterpriseTable
              viewKey="budgets"
              reportMeta={reportMeta}
              columns={monthlyColumns}
              data={visibleRows}
              getRowId={(row) => String(row.id)}
              loading={loading}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableSorting
              enableExport={false}
              initialPageSize={25}
              pageSizeOptions={[10, 25, 50, 100]}
              emptyMessage={allMonthRows.length === 0 ? t('budgets.states.noBudgetsPeriod') : 'No sites match these filters.'}
            />
          </Card>
        </>
      )}

      {/* ── ANNUAL PLANNER ────────────────────────────────────────────────── */}
      {viewMode === 'annual' && !loadError && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi loading={loading} label="Annual budget" icon={Wallet} value={formatCurrencyCompact(yearSummary.budget, activeCurrency)} sub={`${yearSummary.sites} site${yearSummary.sites === 1 ? '' : 's'}`} />
            <Kpi loading={loading} label="Actual spend" icon={TrendingUp}
              tone={yearSummary.spend > yearSummary.budget ? 'text-red-400' : 'text-green-400'}
              value={formatCurrencyCompact(yearSummary.spend, activeCurrency)} />
            <Kpi loading={loading} label={t('budgets.kpi.utilization')} icon={Percent}
              tone={utilTone(yearSummary.utilPct)}
              value={yearSummary.utilPct == null ? 'N/A' : `${Math.round(yearSummary.utilPct)}%`} />
            <Kpi loading={loading} label="Months over budget" icon={AlertCircle}
              tone={yearSummary.overCells > 0 ? 'text-red-400' : 'text-[var(--text-primary)]'}
              value={yearSummary.overCells} sub="Site-months where actual exceeded budget" />
          </div>

          {pendingEdits > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={savePlannerEdits} disabled={savingPlanner} className="btn-primary text-sm min-h-[44px] inline-flex items-center gap-2 disabled:opacity-50">
                <Save size={15} aria-hidden="true" />
                {savingPlanner ? t('budgets.annual.saving') : t('budgets.annual.saveChanges', { count: pendingEdits })}
              </button>
              <button type="button" onClick={() => setPlannerEdits({})} disabled={savingPlanner} className="btn-secondary text-sm min-h-[44px]">
                Discard changes
              </button>
              <span className="text-xs text-[var(--text-muted)]">Edited cells are outlined in amber until saved.</span>
            </div>
          )}

          {cumulativeChartData && !loading && (
            <Card>
              <CardHeader title={t('budgets.annual.chartTitle', { year: plannerYear })} />
              <CardBody style={{ height: 280 }}>
                <Line data={cumulativeChartData} options={CHART_OPTS} aria-label="Cumulative budget versus actual spend" role="img" />
              </CardBody>
            </Card>
          )}

          <Card pad="none" clip>
            {!loading && grid.length > 0 && (
              <p className="text-xs text-[var(--text-muted)] px-4 pt-3">{t('budgets.annual.hint')}</p>
            )}
            <EnterpriseTable
              columns={plannerColumns}
              data={visibleGrid}
              getRowId={(row) => row.site}
              loading={loading}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableSorting
              enableExport={false}
              enableKeyboard={false}
              stickyFirstColumn
              initialPageSize={25}
              pageSizeOptions={[10, 25, 50]}
              emptyMessage={grid.length === 0
                ? t('budgets.states.noBudgetsYear', { year: plannerYear, action: t('budgets.actions.setBudget') })
                : 'No sites match your search.'}
            />
          </Card>
        </>
      )}

      {/* Form modal. Submit stays INSIDE the <form>, so no `footer` slot. */}
      <Modal open={showForm} onClose={closeForm} title={t('budgets.form.title')} size="md">
        {error && <div role="alert" className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="label" htmlFor="budget-site">{t('budgets.form.site')}</label>
            <input id="budget-site" className="input" value={form.site} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="budget-year">{t('budgets.form.year')}</label>
              <select id="budget-year" className="input" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: +e.target.value }))}>
                {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="budget-month">{t('budgets.form.month')}</label>
              <select id="budget-month" className="input" value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: +e.target.value }))}>
                {monthLabels.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="budget-amount">{t('budgets.form.monthlyBudget', { currency: activeCurrency })}</label>
            <input id="budget-amount" type="number" className="input" value={form.monthly_budget} onChange={(e) => setForm((f) => ({ ...f, monthly_budget: +e.target.value }))} min={0} step={500} required />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 min-h-[44px] disabled:opacity-50">
              <Save size={16} aria-hidden="true" /> {saving ? t('budgets.form.saving') : t('budgets.form.save')}
            </button>
            <button type="button" onClick={closeForm} disabled={saving} className="btn-secondary min-h-[44px] disabled:opacity-50">{t('budgets.form.cancel')}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
