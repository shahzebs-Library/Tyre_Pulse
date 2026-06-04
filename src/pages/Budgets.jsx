import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Save, X, DollarSign } from 'lucide-react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1

const EMPTY_FORM = { site: '', monthly_budget: 25000, year: CURRENT_YEAR, month: CURRENT_MONTH }

export default function Budgets() {
  const { profile } = useAuth()
  const [budgets, setBudgets] = useState([])
  const [spending, setSpending] = useState({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filterYear, setFilterYear] = useState(CURRENT_YEAR)
  const [filterMonth, setFilterMonth] = useState(CURRENT_MONTH)

  useEffect(() => { load() }, [filterYear, filterMonth])

  async function load() {
    setLoading(true)
    const [budgetRes, tyreRes] = await Promise.all([
      supabase.from('budgets').select('*').eq('year', filterYear).eq('month', filterMonth).order('site'),
      supabase.from('tyre_records')
        .select('site, cost_per_tyre, issue_date')
        .gte('issue_date', `${filterYear}-${String(filterMonth).padStart(2, '0')}-01`)
        .lt('issue_date', filterMonth === 12
          ? `${filterYear + 1}-01-01`
          : `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-01`
        ),
    ])
    setBudgets(budgetRes.data ?? [])

    const spend = {}
    ;(tyreRes.data ?? []).forEach(t => {
      spend[t.site] = (spend[t.site] ?? 0) + (t.cost_per_tyre ?? 1200)
    })
    setSpending(spend)
    setLoading(false)
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('budgets').upsert({
      ...form,
      region: profile?.region ?? 'KSA',
      created_by: profile?.id,
    }, { onConflict: 'site,region,year,month' })
    if (err) { setError(err.message); setSaving(false); return }
    setShowForm(false)
    load()
    setSaving(false)
  }

  const totalBudget = budgets.reduce((s, b) => s + b.monthly_budget, 0)
  const totalSpend = budgets.reduce((s, b) => s + (spending[b.site] ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Budgets</h1>
          <p className="text-gray-400 text-sm mt-1">Monthly budget vs actual spending</p>
        </div>
        <button onClick={() => { setForm(EMPTY_FORM); setShowForm(true); setError('') }} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Set Budget
        </button>
      </div>

      {/* Period filters */}
      <div className="flex gap-3">
        <select className="input w-auto" value={filterYear} onChange={e => setFilterYear(+e.target.value)}>
          {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="input w-auto" value={filterMonth} onChange={e => setFilterMonth(+e.target.value)}>
          {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
      </div>

      {/* Summary */}
      {budgets.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <p className="text-gray-400 text-sm">Total Budget</p>
            <p className="text-2xl font-bold text-white mt-1">SAR {totalBudget.toLocaleString()}</p>
          </div>
          <div className="card">
            <p className="text-gray-400 text-sm">Total Spent</p>
            <p className={`text-2xl font-bold mt-1 ${totalSpend > totalBudget ? 'text-red-400' : 'text-green-400'}`}>
              SAR {totalSpend.toLocaleString()}
            </p>
          </div>
          <div className="card">
            <p className="text-gray-400 text-sm">Remaining</p>
            <p className={`text-2xl font-bold mt-1 ${totalBudget - totalSpend < 0 ? 'text-red-400' : 'text-blue-400'}`}>
              SAR {(totalBudget - totalSpend).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Site', 'Budget (SAR)', 'Spent (SAR)', 'Remaining', 'Utilisation'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-12 text-gray-500">Loading…</td></tr>
              ) : budgets.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-gray-500">No budgets for this period</td></tr>
              ) : budgets.map(b => {
                const spent = spending[b.site] ?? 0
                const remaining = b.monthly_budget - spent
                const pct = b.monthly_budget > 0 ? Math.min(100, (spent / b.monthly_budget) * 100) : 0
                const over = remaining < 0
                return (
                  <tr key={b.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="table-cell font-medium text-white">{b.site}</td>
                    <td className="table-cell">{b.monthly_budget.toLocaleString()}</td>
                    <td className={`table-cell font-medium ${over ? 'text-red-400' : 'text-gray-300'}`}>{spent.toLocaleString()}</td>
                    <td className={`table-cell font-medium ${over ? 'text-red-400' : 'text-green-400'}`}>{remaining.toLocaleString()}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${pct >= 100 ? 'text-red-400' : 'text-gray-400'}`}>{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

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
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
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
