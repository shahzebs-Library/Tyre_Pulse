import { useState, useEffect, useCallback } from 'react'
import {
  Wallet, ChevronDown, ChevronRight, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, Calculator, Save,
} from 'lucide-react'
import * as imports from '../../lib/api/imports'
import { useSettings } from '../../contexts/SettingsContext'
import { useLanguage } from '../../contexts/LanguageContext'

const SCOPES = ['all', 'country', 'site', 'asset']

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
  const { t } = useLanguage()
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
    catch (e) { setError(e?.message || t('intake.panels.costControl.errorLoad')); setOv({}) }
  }, [t])
  useEffect(() => { load() }, [load])

  async function applyOverride() {
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 0) { setError(t('intake.panels.costControl.errorInvalidAmount')); return }
    if (scope !== 'all' && !scopeValue.trim()) { setError(t('intake.panels.costControl.errorEnterScope', { scope })); return }
    setBusy(true); setError(''); setMsg('')
    try {
      const res = await imports.costSetMonthlyBudget(scope, scope === 'all' ? null : scopeValue.trim(), amt)
      setMsg(t('intake.panels.costControl.successOverride', { amount: money(amt), count: res?.updated ?? 0 }))
      setAmount('')
      await load()
    } catch (e) { setError(e?.message || t('intake.panels.costControl.errorOverride')) } finally { setBusy(false) }
  }

  async function convertLineTotals() {
    if (!window.confirm(t('intake.panels.costControl.convertConfirm'))) return
    setBusy(true); setError(''); setMsg('')
    try {
      const res = await imports.costConvertLineTotals()
      setMsg(t('intake.panels.costControl.successConvert', { count: Number(res?.converted ?? 0).toLocaleString('en-US'), amount: money(res?.total_spend) }))
      await load()
    } catch (e) { setError(e?.message || t('intake.panels.costControl.errorConvert')) } finally { setBusy(false) }
  }

  async function clearFlatRate() {
    const fr = ov?.flat_rate
    if (!fr) return
    if (!window.confirm(t('intake.panels.costControl.clearConfirm', { count: Number(fr.records).toLocaleString('en-US'), amount: money(fr.value), pct: fr.pct }))) return
    setBusy(true); setError(''); setMsg('')
    try {
      const res = await imports.costClearValue(fr.value)
      setMsg(t('intake.panels.costControl.successClear', { amount: money(fr.value), count: res?.cleared ?? 0 }))
      await load()
    } catch (e) { setError(e?.message || t('intake.panels.costControl.errorClear')) } finally { setBusy(false) }
  }

  async function applyActuals() {
    if (!window.confirm(t('intake.panels.costControl.applyActualsConfirm'))) return
    setBusy(true); setError(''); setMsg('')
    try {
      const res = await imports.costApplyActualBudgets()
      setMsg(t('intake.panels.costControl.successApply', { count: res?.updated ?? 0, amount: money(res?.total_monthly) }))
      await load()
    } catch (e) { setError(e?.message || t('intake.panels.costControl.errorApply')) } finally { setBusy(false) }
  }

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-800/40 transition-colors"
      >
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <Wallet size={16} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">{t('intake.panels.costControl.header')}</span>
        {ov == null ? (
          <span className="text-xs text-[var(--text-muted)]">…</span>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">
            {t('intake.panels.costControl.budgetedCount', { withBudget: Number(ov.with_budget ?? 0).toLocaleString('en-US'), vehicles: Number(ov.vehicles ?? 0).toLocaleString('en-US') })}
          </span>
        )}
        <span className="ml-auto" />
        <RefreshCw
          size={14}
          className="text-gray-500 hover:text-gray-300"
          onClick={(e) => { e.stopPropagation(); setOv(null); load() }}
          title={t('intake.panels.costControl.refresh')}
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
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> {t('intake.panels.costControl.loading')}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-[var(--text-muted)]">{t('intake.panels.costControl.totalMonthlyBudget')}</p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{money(ov.total_monthly_budget)}</p>
                </div>
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-[var(--text-muted)]">{t('intake.panels.costControl.actualAvgSpend')}</p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{money(ov.actual_avg_monthly_spend)}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{t('intake.panels.costControl.actualAvgSpendNote', { count: ov.months_covered ?? 0 })}</p>
                </div>
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-[var(--text-muted)]">{t('intake.panels.costControl.vehiclesWithBudget')}</p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{Number(ov.with_budget ?? 0).toLocaleString('en-US')} <span className="text-xs text-gray-500 font-normal">{t('intake.panels.costControl.of')} {Number(ov.vehicles ?? 0).toLocaleString('en-US')}</span></p>
                </div>
              </div>

              {ov.flat_rate && (
                <div className="bg-amber-900/15 border border-amber-700/40 rounded-xl p-4 space-y-2">
                  <p className="text-sm text-amber-300 flex items-center gap-2">
                    <AlertCircle size={15} />
                    {t('intake.panels.costControl.flatRateWarning', { count: Number(ov.flat_rate.records).toLocaleString('en-US'), pct: ov.flat_rate.pct, amount: money(ov.flat_rate.value) })}
                  </p>
                  <p className="text-xs text-gray-400">
                    {t('intake.panels.costControl.flatRateBody')}
                  </p>
                  {isElevated && (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={convertLineTotals} disabled={busy}
                        className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50">
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
                        {t('intake.panels.costControl.convertButton')}
                      </button>
                      <button onClick={clearFlatRate} disabled={busy}
                        className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs flex items-center gap-1.5 disabled:opacity-50">
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <AlertCircle size={13} />}
                        {t('intake.panels.costControl.clearButton')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isElevated ? (
                <>
                  <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">{t('intake.panels.costControl.overrideHeader')}</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className="block text-[11px] text-[var(--text-muted)] mb-1">{t('intake.panels.costControl.scopeLabel')}</label>
                        <select value={scope} onChange={(e) => setScope(e.target.value)}
                          className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200">
                          {SCOPES.map((s) => <option key={s} value={s}>{t(`intake.panels.costControl.scope${s.charAt(0).toUpperCase()}${s.slice(1)}`)}</option>)}
                        </select>
                      </div>
                      {scope !== 'all' && (
                        <div>
                          <label className="block text-[11px] text-[var(--text-muted)] mb-1">{scope === 'asset' ? t('intake.panels.costControl.assetLabel') : scope === 'site' ? t('intake.panels.costControl.siteLabel') : t('intake.panels.costControl.countryLabel')}</label>
                          <input value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}
                            placeholder={scope === 'asset' ? t('intake.panels.costControl.assetPlaceholder') : scope === 'site' ? t('intake.panels.costControl.sitePlaceholder') : t('intake.panels.costControl.countryPlaceholder')}
                            className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 w-36" />
                        </div>
                      )}
                      <div>
                        <label className="block text-[11px] text-[var(--text-muted)] mb-1">{t('intake.panels.costControl.monthlyAmountLabel', { currency: activeCurrency })}</label>
                        <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                          placeholder={t('intake.panels.costControl.monthlyAmountPlaceholder')}
                          className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 w-32" />
                      </div>
                      <button onClick={applyOverride} disabled={busy}
                        className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50">
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {t('intake.panels.costControl.applyOverride')}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={applyActuals} disabled={busy}
                      className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50">
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
                      {t('intake.panels.costControl.applyActualsButton')}
                    </button>
                    <p className="text-[11px] text-gray-500 max-w-md">
                      {t('intake.panels.costControl.applyActualsNote')}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-400">{t('intake.panels.costControl.adminOnly')}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
