import { useState, useEffect, useCallback } from 'react'
import {
  Wallet, ChevronDown, ChevronRight, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, Calculator, Save,
} from 'lucide-react'
import * as imports from '../../lib/api/imports'
import { useSettings } from '../../contexts/SettingsContext'

const SCOPES = [
  { key: 'all', label: 'All vehicles' },
  { key: 'country', label: 'A country' },
  { key: 'site', label: 'A site' },
  { key: 'asset', label: 'One asset' },
]

/**
 * Cost Control — budget override commands for the Data Intake Center (admin).
 * Shows the fleet's monthly-budget coverage vs the ACTUAL average monthly tyre
 * spend (computed from real tyre history), and gives two commands:
 *   · Set a monthly budget for all vehicles / a country / a site / one asset.
 *   · Apply budgets from actuals — each vehicle's budget becomes its own real
 *     average monthly spend.
 * All writes are server-side (V88 RPCs), admin-gated and audited.
 */
export default function CostControlPanel({ isElevated = false }) {
  const { activeCurrency } = useSettings()
  const [open, setOpen] = useState(false)
  const [ov, setOv] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState('all')
  const [scopeValue, setScopeValue] = useState('')
  const [amount, setAmount] = useState('')

  const money = (n) => (n == null ? '—' : `${activeCurrency} ${Number(n).toLocaleString('en-US')}`)

  const load = useCallback(async () => {
    setError('')
    try { setOv(await imports.costBudgetOverview()) }
    catch (e) { setError(e?.message || 'Could not load the budget overview.'); setOv({}) }
  }, [])
  useEffect(() => { load() }, [load])

  async function applyOverride() {
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 0) { setError('Enter a valid amount (0 or more).'); return }
    if (scope !== 'all' && !scopeValue.trim()) { setError(`Enter the ${scope} to target.`); return }
    setBusy(true); setError(''); setMsg('')
    try {
      const res = await imports.costSetMonthlyBudget(scope, scope === 'all' ? null : scopeValue.trim(), amt)
      setMsg(`Monthly budget set to ${money(amt)} on ${res?.updated ?? 0} vehicle(s).`)
      setAmount('')
      await load()
    } catch (e) { setError(e?.message || 'Override failed.') } finally { setBusy(false) }
  }

  async function clearFlatRate() {
    const fr = ov?.flat_rate
    if (!fr) return
    if (!window.confirm(
      `${Number(fr.records).toLocaleString('en-US')} record(s) carry the SAME cost of ${money(fr.value)} (${fr.pct}% of all costed tyres).\n\n` +
      'A single identical value across all records is a default/placeholder, not real market cost — it makes every cost KPI wrong.\n\n' +
      'Clear these costs? (They become blank — pages show 0/— honestly. Real costs return when you upload a file with a cost column, using "Enrich existing records".)',
    )) return
    setBusy(true); setError(''); setMsg('')
    try {
      const res = await imports.costClearValue(fr.value)
      setMsg(`Cleared the flat ${money(fr.value)} placeholder from ${res?.cleared ?? 0} record(s). Costs are now honest — upload a file with real costs to fill them.`)
      await load()
    } catch (e) { setError(e?.message || 'Clear failed.') } finally { setBusy(false) }
  }

  async function applyActuals() {
    if (!window.confirm(
      'Set EVERY vehicle\'s monthly tyre budget to its own actual average monthly spend (computed from its real tyre history)?\n\n' +
      'This overwrites current budgets and is fully audited.',
    )) return
    setBusy(true); setError(''); setMsg('')
    try {
      const res = await imports.costApplyActualBudgets()
      setMsg(`Applied actual-spend budgets to ${res?.updated ?? 0} vehicle(s) — total ${money(res?.total_monthly)} / month.`)
      await load()
    } catch (e) { setError(e?.message || 'Apply failed.') } finally { setBusy(false) }
  }

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-800/40 transition-colors"
      >
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <Wallet size={16} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Cost control</span>
        {ov == null ? (
          <span className="text-xs text-[var(--text-muted)]">…</span>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">
            {Number(ov.with_budget ?? 0).toLocaleString('en-US')}/{Number(ov.vehicles ?? 0).toLocaleString('en-US')} vehicles budgeted
          </span>
        )}
        <span className="ml-auto" />
        <RefreshCw
          size={14}
          className="text-gray-500 hover:text-gray-300"
          onClick={(e) => { e.stopPropagation(); setOv(null); load() }}
          title="Refresh"
        />
      </button>

      {open && (
        <div className="border-t border-[var(--card-border)] p-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2">
              <AlertCircle size={15} /> {error}
            </div>
          )}
          {msg && (
            <div className="flex items-center gap-2 text-sm text-green-300 bg-green-900/20 border border-green-700 rounded-lg px-3 py-2">
              <CheckCircle2 size={15} /> {msg}
            </div>
          )}

          {ov == null ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Loading budget overview…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-[var(--text-muted)]">Total monthly budget</p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{money(ov.total_monthly_budget)}</p>
                </div>
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-[var(--text-muted)]">Actual avg monthly spend</p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{money(ov.actual_avg_monthly_spend)}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">from {ov.months_covered ?? 0} month(s) of real tyre history</p>
                </div>
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-[var(--text-muted)]">Vehicles with a budget</p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{Number(ov.with_budget ?? 0).toLocaleString('en-US')} <span className="text-xs text-gray-500 font-normal">of {Number(ov.vehicles ?? 0).toLocaleString('en-US')}</span></p>
                </div>
              </div>

              {ov.flat_rate && (
                <div className="bg-red-900/15 border border-red-700/40 rounded-xl p-4 space-y-2">
                  <p className="text-sm text-red-300 flex items-center gap-2">
                    <AlertCircle size={15} />
                    Cost data looks wrong: {Number(ov.flat_rate.records).toLocaleString('en-US')} record(s) ({ov.flat_rate.pct}%) share the SAME cost of {money(ov.flat_rate.value)}.
                  </p>
                  <p className="text-xs text-gray-400">
                    One identical value across everything is a default/placeholder, not real market cost — it inflates every cost KPI, report, and forecast.
                    Clear it so figures are honest, then upload a file that has a real cost column (with <span className="text-gray-200">Enrich existing records</span> on) to fill true costs.
                  </p>
                  {isElevated && (
                    <button onClick={clearFlatRate} disabled={busy}
                      className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs flex items-center gap-1.5 disabled:opacity-50">
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <AlertCircle size={13} />}
                      Clear the flat {money(ov.flat_rate.value)} placeholder costs
                    </button>
                  )}
                </div>
              )}

              {isElevated ? (
                <>
                  <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Override monthly budget</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className="block text-[11px] text-[var(--text-muted)] mb-1">Scope</label>
                        <select value={scope} onChange={(e) => setScope(e.target.value)}
                          className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200">
                          {SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </div>
                      {scope !== 'all' && (
                        <div>
                          <label className="block text-[11px] text-[var(--text-muted)] mb-1">{scope === 'asset' ? 'Asset No' : scope === 'site' ? 'Site' : 'Country'}</label>
                          <input value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}
                            placeholder={scope === 'asset' ? 'e.g. TRK-101' : scope === 'site' ? 'e.g. Riyadh' : 'e.g. KSA'}
                            className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 w-36" />
                        </div>
                      )}
                      <div>
                        <label className="block text-[11px] text-[var(--text-muted)] mb-1">Monthly amount ({activeCurrency})</label>
                        <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                          placeholder="e.g. 5000"
                          className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 w-32" />
                      </div>
                      <button onClick={applyOverride} disabled={busy}
                        className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50">
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Apply override
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={applyActuals} disabled={busy}
                      className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50">
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
                      Set every vehicle's budget from its actual spend
                    </button>
                    <p className="text-[11px] text-gray-500 max-w-md">
                      Uses each vehicle's own real tyre history (total spend ÷ its active months). Overrides are audited and feed Budget Planner, forecasting, and the executive digest.
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-400">Budget overrides are admin-only. Ask an administrator to set budgets.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
