import { useEffect, useState, useMemo, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { Plus, Save, X, Download, FileText, PiggyBank } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import BudgetTabs from '../components/budgets/BudgetTabs'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
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

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend, BarElement)

const MONTHS_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const CURRENT_YEAR  = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1

const EMPTY_FORM = { site: '', monthly_budget: 25000, year: CURRENT_YEAR, month: CURRENT_MONTH }

const STATUS_OPTIONS = ['Draft', 'Approved', 'Overspent', 'Closed']

const STATUS_COLORS = {
  Approved:  'text-green-400',
  Overspent: 'text-red-400',
  Draft:     'text-[var(--text-muted)]',
  Closed:    'text-[var(--text-muted)]',
}

function KpiSkeletons() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card animate-pulse">
          <div className="h-3 w-24 bg-[var(--input-bg)]/40 rounded mb-3" />
          <div className="h-7 w-32 bg-[var(--input-bg)]/40 rounded" />
        </div>
      ))}
    </div>
  )
}

export default function Budgets() {
  const reportMeta = useReportMeta('Budgets & Cost')
  const { profile }   = useAuth()
  const { activeCountry, activeCurrency } = useSettings()
  const { t } = useLanguage()
  const [budgets, setBudgets]     = useState([])
  const [spending, setSpending]   = useState({})
  const [loading, setLoading]     = useState(true)
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

  useEffect(() => { load() }, [filterYear, filterMonth, plannerYear, viewMode, activeCountry])

  async function load() {
    setLoading(true)

    if (viewMode === 'month') {
      const [budgetRes, tyreRes] = await Promise.all([
        budgetsApi.listBudgets({ country: activeCountry, year: filterYear, month: filterMonth }),
        budgetsApi.listBudgetTyreRecords({
          country: activeCountry,
          start: `${filterYear}-${String(filterMonth).padStart(2, '0')}-01`,
          end: filterMonth === 12
            ? `${filterYear + 1}-01-01`
            : `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-01`,
        }),
      ])
      setBudgets(budgetRes.data ?? [])

      const spend = {}
      ;(tyreRes.data ?? []).forEach(t => {
        const key = `${t.site}~${filterYear}~${filterMonth}`
        spend[key] = (spend[key] ?? 0) + (Number(t.cost_per_tyre) || 0) * (t.qty ?? 1)
      })
      setSpending(spend)
    } else {
      const [budgetRes, tyreRes] = await Promise.all([
        budgetsApi.listBudgets({ country: activeCountry, year: plannerYear }),
        budgetsApi.listBudgetTyreRecords({
          country: activeCountry,
          start: `${plannerYear}-01-01`,
          end: `${plannerYear + 1}-01-01`,
        }),
      ])
      setBudgets(budgetRes.data ?? [])

      const spend = {}
      ;(tyreRes.data ?? []).forEach(t => {
        if (!t.issue_date) return
        const d = new Date(t.issue_date)
        const m = d.getMonth() + 1
        const key = `${t.site}~${plannerYear}~${m}`
        spend[key] = (spend[key] ?? 0) + (Number(t.cost_per_tyre) || 0) * (t.qty ?? 1)
      })
      setSpending(spend)
    }

    setLoading(false)
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const { error: err } = await budgetsApi.upsertBudget({
      ...form,
      region:     profile?.region ?? 'KSA',
      created_by: profile?.id,
    })
    if (err) { setError(toUserMessage(err)); setSaving(false); return }
    setShowForm(false)
    load()
    setSaving(false)
  }

  async function savePlannerEdits() {
    if (!Object.keys(plannerEdits).length) return
    setSavingPlanner(true)
    const upserts = Object.entries(plannerEdits).map(([key, value]) => {
      const [site, m] = key.split('~')
      return {
        site,
        month:          parseInt(m),
        year:           plannerYear,
        monthly_budget: parseFloat(value) || 0,
        region:         profile?.region ?? 'KSA',
        created_by:     profile?.id,
      }
    })
    await budgetsApi.upsertBudgets(upserts)
    setPlannerEdits({})
    await load()
    setSavingPlanner(false)
  }

  const monthLabels = useMemo(() => MONTHS_LABELS.map((_, i) => t(`budgets.months.${i}`)), [t])

  const annualSites = useMemo(() => {
    const s = new Set(budgets.map(b => b.site))
    return [...s].sort()
  }, [budgets])

  function getPlannerBudget(site, m) {
    const editKey = `${site}~${m}`
    if (plannerEdits[editKey] !== undefined) return plannerEdits[editKey]
    const found = budgets.find(b => b.site === site && b.month === m)
    return found ? found.monthly_budget : ''
  }

  function getSpend(site, m, year) {
    return spending[`${site}~${year ?? filterYear}~${m}`] ?? 0
  }

  const totalBudget = useMemo(() =>
    budgets.reduce((s, b) => s + b.monthly_budget, 0), [budgets])
  const totalSpend = useMemo(() =>
    budgets.reduce((s, b) => s + getSpend(b.site, filterMonth), 0), [budgets, spending, filterMonth])

  const utilPct = totalBudget > 0 ? Math.round((totalSpend / totalBudget) * 100) : 0
  const utilColor = utilPct >= 100 ? 'text-red-400' : utilPct >= 80 ? 'text-yellow-400' : 'text-green-400'

  // Monthly budget vs spend bar chart (per-site)
  const monthlyChartData = useMemo(() => {
    if (viewMode !== 'month' || budgets.length === 0) return null
    return {
      labels: budgets.map(b => b.site),
      datasets: [
        {
          label: t('budgets.columns.budget', { currency: activeCurrency }),
          data: budgets.map(b => b.monthly_budget),
          backgroundColor: 'rgba(59,130,246,0.6)',
          borderRadius: 4,
        },
        {
          label: t('budgets.columns.spent', { currency: activeCurrency }),
          data: budgets.map(b => getSpend(b.site, filterMonth)),
          backgroundColor: budgets.map(b => getSpend(b.site, filterMonth) > b.monthly_budget ? 'rgba(239,68,68,0.7)' : 'rgba(16,185,129,0.6)'),
          borderRadius: 4,
        },
      ],
    }
  }, [viewMode, budgets, spending, filterMonth, activeCurrency, t])

  // Monthly table columns for EnterpriseTable
  const monthlyColumns = useMemo(() => [
    { id: 'site', header: t('budgets.columns.site'), accessorFn: r => r.site, size: 160,
      cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span>,
    },
    { id: 'budget', header: t('budgets.columns.budget', { currency: activeCurrency }), accessorFn: r => r.monthly_budget, size: 120, meta: { align: 'right' },
      cell: ({ getValue }) => <span>{getValue().toLocaleString()}</span>,
    },
    { id: 'spent', header: t('budgets.columns.spent', { currency: activeCurrency }), accessorFn: r => getSpend(r.site, filterMonth), size: 120, meta: { align: 'right' },
      cell: ({ getValue, row }) => {
        const spent = getValue()
        const over = spent > row.original.monthly_budget
        return <span className={`font-medium ${over ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>{spent.toLocaleString()}</span>
      },
    },
    { id: 'remaining', header: t('budgets.columns.remaining'), accessorFn: r => r.monthly_budget - getSpend(r.site, filterMonth), size: 120, meta: { align: 'right' },
      cell: ({ getValue }) => {
        const rem = getValue()
        return <span className={`font-medium ${rem < 0 ? 'text-red-400' : 'text-green-400'}`}>{rem.toLocaleString()}</span>
      },
    },
    { id: 'progress', header: t('budgets.columns.progress'), accessorFn: r => r.monthly_budget > 0 ? (getSpend(r.site, filterMonth) / r.monthly_budget) * 100 : 0, size: 150, enableSorting: true,
      cell: ({ getValue }) => {
        const rawPct = getValue()
        const pct = Math.min(rawPct, 100)
        return (
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: rawPct > 100 ? '#ef4444' : '#16a34a' }} />
            </div>
            <span className={`text-xs font-medium ${rawPct >= 90 ? 'text-red-400' : rawPct >= 80 ? 'text-yellow-400' : 'text-[var(--text-muted)]'}`}>{rawPct.toFixed(0)}%</span>
          </div>
        )
      },
    },
    { id: 'status', header: t('budgets.columns.status'), accessorFn: r => r.status ?? 'Draft', size: 120, enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const b = row.original
        return (
          <select
            className={`text-xs bg-transparent border-0 cursor-pointer rounded px-1 py-0.5 focus:outline-none ${STATUS_COLORS[b.status] ?? 'text-[var(--text-muted)]'}`}
            value={b.status ?? 'Draft'}
            onChange={async e => {
              const newStatus = e.target.value
              try { await budgetsApi.updateBudgetStatus(b.id, newStatus) } catch { /* non-blocking status update */ }
              setBudgets(prev => prev.map(x => x.id === b.id ? { ...x, status: newStatus } : x))
            }}
          >
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{t(`budgets.status.${s.toLowerCase()}`)}</option>)}
          </select>
        )
      },
    },
  ], [activeCurrency, filterMonth, spending, t])

  const cumulativeChartData = useMemo(() => {
    if (viewMode !== 'annual' || !annualSites.length) return null

    const budgetPerMonth = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      return annualSites.reduce((s, site) => {
        const found = budgets.find(b => b.site === site && b.month === m)
        return s + (found?.monthly_budget ?? 0)
      }, 0)
    })

    const spendPerMonth = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      return annualSites.reduce((s, site) => s + getSpend(site, m, plannerYear), 0)
    })

    let cumBudget = 0, cumSpend = 0
    const cumBudgets = budgetPerMonth.map(v => (cumBudget += v))
    const cumSpends  = spendPerMonth.map(v => (cumSpend += v))

    return {
      labels: monthLabels,
      datasets: [
        {
          label: t('budgets.annual.budgetCeiling'),
          data: cumBudgets,
          borderColor: 'rgba(239,68,68,0.8)',
          backgroundColor: 'rgba(239,68,68,0.05)',
          fill: true, tension: 0.3, borderDash: [5, 3], pointRadius: 4,
        },
        {
          label: t('budgets.annual.actualSpend'),
          data: cumSpends,
          borderColor: 'rgba(59,130,246,1)',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: true, tension: 0.3, pointRadius: 4,
        },
      ],
    }
  }, [viewMode, annualSites, budgets, spending, plannerYear, monthLabels, t])

  function exportExcel() {
    if (viewMode === 'month') {
      const rows = budgets.map(b => ({
        Site:           b.site,
        [`Budget (${activeCurrency})`]: b.monthly_budget,
        [`Spent (${activeCurrency})`]:  getSpend(b.site, filterMonth),
        Remaining:      b.monthly_budget - getSpend(b.site, filterMonth),
        'Util %':       b.monthly_budget > 0
          ? ((getSpend(b.site, filterMonth) / b.monthly_budget) * 100).toFixed(1) + '%' : '0%',
      }))
      exportToExcel(rows, Object.keys(rows[0] || {}), Object.keys(rows[0] || {}), `budget-${filterYear}-${filterMonth}`, 'Budget')
    } else {
      const rows = []
      annualSites.forEach(site => {
        const row = { Site: site }
        MONTHS_LABELS.forEach((ml, i) => {
          const m = i + 1
          const found = budgets.find(b => b.site === site && b.month === m)
          row[`${ml} Budget`] = found?.monthly_budget ?? 0
          row[`${ml} Actual`] = getSpend(site, m, plannerYear)
        })
        rows.push(row)
      })
      exportToExcel(rows, Object.keys(rows[0] || {}), Object.keys(rows[0] || {}), `budget-annual-${plannerYear}`, 'Annual Planner')
    }
  }

  function exportPdfFn() {
    const rows = budgets.map(b => {
      const spent = getSpend(b.site, filterMonth)
      return { site: b.site, budget: Math.round(b.monthly_budget), spent: Math.round(spent), remaining: Math.round(b.monthly_budget - spent) }
    })
    exportToPdf(
      rows,
      [{ key: 'site', header: 'Site' }, { key: 'budget', header: 'Budget' }, { key: 'spent', header: 'Spent' }, { key: 'remaining', header: 'Remaining' }],
      `Budget Report - ${MONTHS_LABELS[filterMonth - 1]} ${filterYear}`,
      `budget-${filterYear}-${filterMonth}`,
      'portrait',
      '',
      { currency: activeCurrency },
    )
  }

  return (
    <div className="space-y-4">
      <BudgetTabs />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeader
          title={t('budgets.title')}
          subtitle={t('budgets.subtitle')}
          icon={PiggyBank}
        />
        <div className="flex gap-2">
          <button onClick={exportExcel} className="btn-secondary text-xs flex items-center gap-1.5">
            <Download size={14} /> {t('budgets.actions.excel')}
          </button>
          <button onClick={exportPdfFn} className="btn-secondary text-xs flex items-center gap-1.5">
            <FileText size={14} /> {t('budgets.actions.pdf')}
          </button>
          <button onClick={() => { setForm(EMPTY_FORM); setShowForm(true); setError('') }} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> {t('budgets.actions.setBudget')}
          </button>
        </div>
      </div>

      {/* View mode tabs */}
      <div className="flex gap-2">
        {[['month', t('budgets.viewModes.month')], ['annual', t('budgets.viewModes.annual')]].map(([val, label]) => (
          <button key={val} onClick={() => setViewMode(val)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === val ? 'bg-blue-600 text-white' : 'bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── MONTHLY VIEW ──────────────────────────────────────────────────── */}
      {viewMode === 'month' && (
        <>
          <div className="flex gap-3">
            <select className="input w-auto" value={filterYear} onChange={e => setFilterYear(+e.target.value)}>
              {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="input w-auto" value={filterMonth} onChange={e => setFilterMonth(+e.target.value)}>
              {monthLabels.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>

          {loading ? (
            <KpiSkeletons />
          ) : budgets.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="card">
                <p className="text-[var(--text-muted)] text-sm">{t('budgets.kpi.totalBudget')}</p>
                <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{formatCurrencyCompact(totalBudget, activeCurrency)}</p>
              </div>
              <div className="card">
                <p className="text-[var(--text-muted)] text-sm">{t('budgets.kpi.totalSpent')}</p>
                <p className={`text-2xl font-bold mt-1 ${totalSpend > totalBudget ? 'text-red-400' : 'text-green-400'}`}>
                  {formatCurrencyCompact(totalSpend, activeCurrency)}
                </p>
              </div>
              <div className="card">
                <p className="text-[var(--text-muted)] text-sm">{t('budgets.kpi.remaining')}</p>
                <p className={`text-2xl font-bold mt-1 ${totalBudget - totalSpend < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {formatCurrencyCompact(totalBudget - totalSpend, activeCurrency)}
                </p>
              </div>
              <div className="card">
                <p className="text-[var(--text-muted)] text-sm">{t('budgets.kpi.utilization')}</p>
                <p className={`text-2xl font-bold mt-1 ${utilColor}`}>{utilPct}%</p>
              </div>
            </div>
          )}

          {/* Budget vs Spend bar chart */}
          {!loading && monthlyChartData && (
            <div className="card">
              <h3 className="text-sm font-medium text-[var(--text-muted)] mb-4">
                {t('budgets.columns.budget', { currency: activeCurrency })} vs {t('budgets.columns.spent', { currency: activeCurrency })}
              </h3>
              <div style={{ height: 280 }}>
                <Bar
                  data={monthlyChartData}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#9ca3af' } } },
                    scales: {
                      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
                      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
                    },
                  }}
                />
              </div>
            </div>
          )}

          {loading ? (
            <div className="card animate-pulse h-64" />
          ) : (
            <div className="card p-0 overflow-hidden">
              <EnterpriseTable
                reportMeta={reportMeta}
                columns={monthlyColumns}
                data={budgets}
                getRowId={(row) => String(row.id)}
                enableGlobalFilter={true}
                searchPlaceholder="Search sites..."
                enableSorting={true}
                enableExport={true}
                exportFileName={`budget-${filterYear}-${filterMonth}`}
                initialPageSize={25}
                pageSizeOptions={[10, 25, 50]}
                emptyMessage={t('budgets.states.noBudgetsPeriod')}
              />
            </div>
          )}
        </>
      )}

      {/* ── ANNUAL PLANNER ────────────────────────────────────────────────── */}
      {viewMode === 'annual' && (
        <>
          <div className="flex items-center gap-3">
            <select className="input w-auto" value={plannerYear} onChange={e => setPlannerYear(+e.target.value)}>
              {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {Object.keys(plannerEdits).length > 0 && (
              <button onClick={savePlannerEdits} disabled={savingPlanner} className="btn-primary text-sm disabled:opacity-50">
                {savingPlanner ? t('budgets.annual.saving') : t('budgets.annual.saveChanges', { count: Object.keys(plannerEdits).length })}
              </button>
            )}
          </div>

          {/* Budget vs Actuals chart */}
          {cumulativeChartData && (
            <div className="card">
              <h3 className="text-sm font-medium text-[var(--text-muted)] mb-4">{t('budgets.annual.chartTitle', { year: plannerYear })}</h3>
              <div style={{ height: 280 }}>
                <Line
                  data={cumulativeChartData}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#9ca3af' } } },
                    scales: {
                      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
                      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
                    },
                  }}
                />
              </div>
            </div>
          )}

          {/* 12-month grid */}
          {loading ? (
            <div className="card overflow-x-auto animate-pulse">
              <div className="h-3 w-48 bg-[var(--input-bg)]/40 rounded mb-4" />
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
                {Array.from({ length: 5 * 13 }).map((_, i) => (
                  <div key={i} className="h-7 rounded bg-[var(--input-bg)]/40" />
                ))}
              </div>
            </div>
          ) : annualSites.length === 0 ? (
            <div className="card text-center py-12 text-[var(--text-muted)]">
              {t('budgets.states.noBudgetsYear', { year: plannerYear, action: t('budgets.actions.setBudget') })}
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <p className="text-xs text-[var(--text-muted)] mb-3">{t('budgets.annual.hint')}</p>
              <table className="w-full text-xs" style={{ minWidth: 900 }}>
                <thead>
                  <tr className="text-[var(--text-muted)] border-b border-[var(--input-border)]">
                    <th className="pb-2 pr-3 text-left sticky left-0 bg-[var(--surface-1)]">{t('budgets.columns.site')}</th>
                    {monthLabels.map(m => (
                      <th key={m} className="pb-2 px-1 text-center min-w-[80px]">{m}</th>
                    ))}
                    <th className="pb-2 px-2 text-right">{t('budgets.columns.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {annualSites.map(site => {
                    let siteTotal = 0
                    return (
                      <tr key={site} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20">
                        <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)] sticky left-0 bg-[var(--surface-1)]/90">{site}</td>
                        {Array.from({ length: 12 }, (_, i) => {
                          const m = i + 1
                          const budgetVal = getPlannerBudget(site, m)
                          const spent     = getSpend(site, m, plannerYear)
                          const overBudget = budgetVal > 0 && spent > parseFloat(budgetVal)
                          siteTotal += parseFloat(budgetVal) || 0
                          return (
                            <td key={m} className="py-1 px-1 text-center">
                              <div className="relative">
                                <input
                                  type="number"
                                  className={`w-full text-center rounded py-1 px-1 text-xs border transition-colors ${
                                    plannerEdits[`${site}~${m}`] !== undefined
                                      ? 'bg-yellow-900/30 border-yellow-700/50 text-yellow-300'
                                      : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)]'
                                  } focus:outline-none focus:border-blue-500`}
                                  value={budgetVal}
                                  onChange={e => {
                                    const key = `${site}~${m}`
                                    setPlannerEdits(prev => ({ ...prev, [key]: e.target.value }))
                                  }}
                                  placeholder="0"
                                />
                                {spent > 0 && (
                                  <div
                                    className={`text-[9px] mt-0.5 ${overBudget ? 'text-red-400' : 'text-green-400'}`}
                                    title={t('budgets.annual.actualTooltip', { value: formatCurrencyCompact(spent, activeCurrency) })}
                                  >
                                    ≈{Math.round(spent / 1000)}k
                                  </div>
                                )}
                              </div>
                            </td>
                          )
                        })}
                        <td className="py-1.5 px-2 text-right text-[var(--text-secondary)] font-medium">
                          {siteTotal > 0 ? formatCurrencyCompact(siteTotal, activeCurrency) : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('budgets.form.title')}</h2>
              <button onClick={() => setShowForm(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}
            <form onSubmit={save} className="space-y-3">
              <div><label className="label">{t('budgets.form.site')}</label><input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('budgets.form.year')}</label>
                  <select className="input" value={form.year} onChange={e => setForm(f => ({ ...f, year: +e.target.value }))}>
                    {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('budgets.form.month')}</label>
                  <select className="input" value={form.month} onChange={e => setForm(f => ({ ...f, month: +e.target.value }))}>
                    {monthLabels.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="label">{t('budgets.form.monthlyBudget', { currency: activeCurrency })}</label><input type="number" className="input" value={form.monthly_budget} onChange={e => setForm(f => ({ ...f, monthly_budget: +e.target.value }))} min={0} step={500} required /></div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save size={16} /> {saving ? t('budgets.form.saving') : t('budgets.form.save')}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('budgets.form.cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
