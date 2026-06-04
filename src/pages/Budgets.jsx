import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Save, X, Download, FileText } from 'lucide-react'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement,
  Filler, Tooltip, Legend, BarElement,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend, BarElement)

const MONTHS_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const CURRENT_YEAR  = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1

const EMPTY_FORM = { site: '', monthly_budget: 25000, year: CURRENT_YEAR, month: CURRENT_MONTH }

export default function Budgets() {
  const { profile }   = useAuth()
  const [budgets, setBudgets]     = useState([])
  const [spending, setSpending]   = useState({})   // { 'site-year-month': number }
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [viewMode, setViewMode]   = useState('month')  // 'month' | 'annual'
  const [filterYear, setFilterYear]   = useState(CURRENT_YEAR)
  const [filterMonth, setFilterMonth] = useState(CURRENT_MONTH)
  const [plannerYear, setPlannerYear] = useState(CURRENT_YEAR)
  const [plannerEdits, setPlannerEdits] = useState({})  // { 'site-m': value }
  const [savingPlanner, setSavingPlanner] = useState(false)

  useEffect(() => { load() }, [filterYear, filterMonth, plannerYear, viewMode])

  async function load() {
    setLoading(true)

    if (viewMode === 'month') {
      const [budgetRes, tyreRes] = await Promise.all([
        supabase.from('budgets').select('*').eq('year', filterYear).eq('month', filterMonth).order('site'),
        supabase.from('tyre_records')
          .select('site, cost_per_tyre, qty, issue_date')
          .gte('issue_date', `${filterYear}-${String(filterMonth).padStart(2, '0')}-01`)
          .lt('issue_date', filterMonth === 12
            ? `${filterYear + 1}-01-01`
            : `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-01`),
      ])
      setBudgets(budgetRes.data ?? [])

      const spend = {}
      ;(tyreRes.data ?? []).forEach(t => {
        const key = `${t.site}~${filterYear}~${filterMonth}`
        spend[key] = (spend[key] ?? 0) + (t.cost_per_tyre ?? 1200) * (t.qty ?? 1)
      })
      setSpending(spend)
    } else {
      // Annual view — load all 12 months
      const [budgetRes, tyreRes] = await Promise.all([
        supabase.from('budgets').select('*').eq('year', plannerYear).order('site'),
        supabase.from('tyre_records')
          .select('site, cost_per_tyre, qty, issue_date')
          .gte('issue_date', `${plannerYear}-01-01`)
          .lt('issue_date', `${plannerYear + 1}-01-01`),
      ])
      setBudgets(budgetRes.data ?? [])

      const spend = {}
      ;(tyreRes.data ?? []).forEach(t => {
        if (!t.issue_date) return
        const d = new Date(t.issue_date)
        const m = d.getMonth() + 1
        const key = `${t.site}~${plannerYear}~${m}`
        spend[key] = (spend[key] ?? 0) + (t.cost_per_tyre ?? 1200) * (t.qty ?? 1)
      })
      setSpending(spend)
    }

    setLoading(false)
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('budgets').upsert({
      ...form,
      region:     profile?.region ?? 'KSA',
      created_by: profile?.id,
    }, { onConflict: 'site,region,year,month' })
    if (err) { setError(err.message); setSaving(false); return }
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
    await supabase.from('budgets').upsert(upserts, { onConflict: 'site,region,year,month' })
    setPlannerEdits({})
    await load()
    setSavingPlanner(false)
  }

  // Annual planner: unique sites
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

  // Monthly view totals
  const totalBudget = useMemo(() =>
    budgets.reduce((s, b) => s + b.monthly_budget, 0), [budgets])
  const totalSpend = useMemo(() =>
    budgets.reduce((s, b) => s + getSpend(b.site, filterMonth), 0), [budgets, spending, filterMonth])

  // Budget vs actuals chart (annual view: cumulative)
  const cumulativeChartData = useMemo(() => {
    if (viewMode !== 'annual' || !annualSites.length) return null

    // Aggregate across all sites per month
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

    // Cumulative
    let cumBudget = 0, cumSpend = 0
    const cumBudgets = budgetPerMonth.map(v => (cumBudget += v))
    const cumSpends  = spendPerMonth.map(v => (cumSpend += v))

    return {
      labels: MONTHS_LABELS,
      datasets: [
        {
          label: 'Budget Ceiling',
          data: cumBudgets,
          borderColor: 'rgba(239,68,68,0.8)',
          backgroundColor: 'rgba(239,68,68,0.05)',
          fill: true, tension: 0.3, borderDash: [5, 3], pointRadius: 4,
        },
        {
          label: 'Actual Spend',
          data: cumSpends,
          borderColor: 'rgba(59,130,246,1)',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: true, tension: 0.3, pointRadius: 4,
        },
      ],
    }
  }, [viewMode, annualSites, budgets, spending, plannerYear])

  function exportExcel() {
    if (viewMode === 'month') {
      const rows = budgets.map(b => ({
        Site:           b.site,
        'Budget (SAR)': b.monthly_budget,
        'Spent (SAR)':  getSpend(b.site, filterMonth),
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
      return [b.site, b.monthly_budget.toLocaleString(), spent.toLocaleString(), (b.monthly_budget - spent).toLocaleString()]
    })
    exportToPdf(rows, ['Site', 'Budget', 'Spent', 'Remaining'], 'Budget Report', `budget-${filterYear}-${filterMonth}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Budgets</h1>
          <p className="text-gray-400 text-sm mt-1">Monthly budget vs actual spending</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="btn-secondary text-xs flex items-center gap-1.5">
            <Download size={14} /> Excel
          </button>
          <button onClick={exportPdfFn} className="btn-secondary text-xs flex items-center gap-1.5">
            <FileText size={14} /> PDF
          </button>
          <button onClick={() => { setForm(EMPTY_FORM); setShowForm(true); setError('') }} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> Set Budget
          </button>
        </div>
      </div>

      {/* View mode tabs */}
      <div className="flex gap-2">
        {[['month', 'Monthly View'], ['annual', 'Annual Planner']].map(([val, label]) => (
          <button key={val} onClick={() => setViewMode(val)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === val ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
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
              {MONTHS_LABELS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>

          {budgets.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              <div className="card"><p className="text-gray-400 text-sm">Total Budget</p><p className="text-2xl font-bold text-white mt-1">SAR {totalBudget.toLocaleString()}</p></div>
              <div className="card"><p className="text-gray-400 text-sm">Total Spent</p><p className={`text-2xl font-bold mt-1 ${totalSpend > totalBudget ? 'text-red-400' : 'text-green-400'}`}>SAR {totalSpend.toLocaleString()}</p></div>
              <div className="card"><p className="text-gray-400 text-sm">Remaining</p><p className={`text-2xl font-bold mt-1 ${totalBudget - totalSpend < 0 ? 'text-red-400' : 'text-blue-400'}`}>SAR {(totalBudget - totalSpend).toLocaleString()}</p></div>
            </div>
          )}

          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>{['Site', 'Budget (SAR)', 'Spent (SAR)', 'Remaining', 'Utilisation'].map(h => <th key={h} className="table-header">{h}</th>)}</tr></thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="text-center py-12 text-gray-500">Loading…</td></tr>
                  ) : budgets.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-12 text-gray-500">No budgets for this period</td></tr>
                  ) : budgets.map(b => {
                    const spent = getSpend(b.site, filterMonth)
                    const remaining = b.monthly_budget - spent
                    const pct = b.monthly_budget > 0 ? Math.min(100, (spent / b.monthly_budget) * 100) : 0
                    return (
                      <tr key={b.id} className="hover:bg-gray-800/30">
                        <td className="table-cell font-medium text-white">{b.site}</td>
                        <td className="table-cell">{b.monthly_budget.toLocaleString()}</td>
                        <td className={`table-cell font-medium ${remaining < 0 ? 'text-red-400' : 'text-gray-300'}`}>{spent.toLocaleString()}</td>
                        <td className={`table-cell font-medium ${remaining < 0 ? 'text-red-400' : 'text-green-400'}`}>{remaining.toLocaleString()}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className={`text-xs font-medium ${pct >= 90 ? 'text-red-400' : pct >= 80 ? 'text-yellow-400' : 'text-gray-400'}`}>{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
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
                {savingPlanner ? 'Saving…' : `Save ${Object.keys(plannerEdits).length} Changes`}
              </button>
            )}
          </div>

          {/* Budget vs Actuals chart */}
          {cumulativeChartData && (
            <div className="card">
              <h3 className="text-sm font-medium text-gray-400 mb-4">Cumulative Budget vs Actual Spend ({plannerYear})</h3>
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
            <div className="card text-center py-12 text-gray-500">Loading…</div>
          ) : annualSites.length === 0 ? (
            <div className="card text-center py-12 text-gray-500">
              No budgets for {plannerYear}. Add some using "Set Budget" above.
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <p className="text-xs text-gray-500 mb-3">Click any cell to edit budget. Green = under budget, red = over.</p>
              <table className="w-full text-xs" style={{ minWidth: 900 }}>
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="pb-2 pr-3 text-left sticky left-0 bg-gray-900">Site</th>
                    {MONTHS_LABELS.map(m => (
                      <th key={m} className="pb-2 px-1 text-center min-w-[80px]">{m}</th>
                    ))}
                    <th className="pb-2 px-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {annualSites.map(site => {
                    let siteTotal = 0
                    return (
                      <tr key={site} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                        <td className="py-1.5 pr-3 font-medium text-white sticky left-0 bg-gray-900/90">{site}</td>
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
                                      : 'bg-gray-800 border-gray-700 text-gray-300'
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
                                    title={`Actual: SAR ${spent.toLocaleString()}`}
                                  >
                                    ≈{Math.round(spent / 1000)}k
                                  </div>
                                )}
                              </div>
                            </td>
                          )
                        })}
                        <td className="py-1.5 px-2 text-right text-gray-300 font-medium">
                          {siteTotal > 0 ? `SAR ${siteTotal.toLocaleString('en-SA', { maximumFractionDigits: 0 })}` : '—'}
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
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Set Monthly Budget</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}
            <form onSubmit={save} className="space-y-3">
              <div><label className="label">Site *</label><input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Year</label>
                  <select className="input" value={form.year} onChange={e => setForm(f => ({ ...f, year: +e.target.value }))}>
                    {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Month</label>
                  <select className="input" value={form.month} onChange={e => setForm(f => ({ ...f, month: +e.target.value }))}>
                    {MONTHS_LABELS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="label">Monthly Budget (SAR)</label><input type="number" className="input" value={form.monthly_budget} onChange={e => setForm(f => ({ ...f, monthly_budget: +e.target.value }))} min={0} step={500} required /></div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save size={16} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
