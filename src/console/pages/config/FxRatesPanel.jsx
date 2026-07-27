/**
 * Exchange rates: the last thing standing between this system and a legitimate
 * combined-country total.
 *
 * Three countries report in three currencies, and every cross-country figure the
 * app has ever shown was either refused or, on the All view until this session,
 * silently wrong. The mechanism is now complete and inert: with no approved rate
 * it converts nothing and callers say so. Enter three rates here and it works.
 *
 * Entering a rate and standing behind it are separate acts, and the server
 * enforces the split: an elevated user can record a rate, but only an
 * administrator can approve one, because approval is what lets it move money.
 */
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Plus, Check, X, Trash2, Info, AlertTriangle } from 'lucide-react'
import {
  listCurrencyRates, addCurrencyRate, setRateApproval, deleteCurrencyRate,
  getFxCoverage, FX_POLICIES,
} from '../../../lib/api/currencyRates'
import { supabase } from '../../../lib/api/_client'
import { toUserMessage } from '../../../lib/safeError'

const today = () => new Date().toISOString().slice(0, 10)

export default function FxRatesPanel() {
  const [rates, setRates] = useState([])
  const [coverage, setCoverage] = useState(null)
  const [policy, setPolicy] = useState('monthly_avg')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ base: 'AED', quote: 'SAR', rate: '', rateDate: today() })

  const load = useCallback(async () => {
    setError('')
    try {
      const [rows, cov] = await Promise.all([
        listCurrencyRates(),
        getFxCoverage({ target: 'SAR' }).catch(() => null),
      ])
      setRates(rows)
      setCoverage(cov)
      if (cov?.policy) setPolicy(cov.policy)
    } catch (e) {
      setError(toUserMessage(e, 'Could not load exchange rates.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function savePolicy(next) {
    setPolicy(next)
    try {
      // Same path the rest of this page uses to persist a setting.
      const { error: e2 } = await supabase.from('system_config')
        .upsert([{ key: 'fx_policy', value: next }], { onConflict: 'key' })
      if (e2) throw e2
    } catch (e) {
      setError(toUserMessage(e, 'Could not save the policy.'))
    }
  }

  async function add() {
    setBusy(true); setError('')
    try {
      await addCurrencyRate(form)
      setForm((f) => ({ ...f, rate: '' }))
      await load()
    } catch (e) { setError(toUserMessage(e, 'Could not add that rate.')) } finally { setBusy(false) }
  }

  async function act(fn, ...args) {
    setBusy(true); setError('')
    try { await fn(...args); await load() } catch (e) {
      setError(toUserMessage(e, 'That change was not applied.'))
    } finally { setBusy(false) }
  }

  const missing = (coverage?.currencies || []).filter((c) => c.rate == null)

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-white">Exchange rates</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Needed before any figure can combine KSA, UAE and Egypt into one number.
          </p>
        </div>
        <button onClick={load} disabled={busy}
          className="h-8 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {error ? (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">{error}</div>
      ) : null}

      {/* Where things stand right now */}
      {coverage?.ok ? (
        coverage.complete ? (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <Check size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-300">
              Every currency in your data has an approved rate. Combined totals are available.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              No combined total is shown yet.
              {missing.length
                ? ` ${missing.map((c) => c.currency).join(' and ')} ${missing.length === 1 ? 'has' : 'have'} no approved rate.`
                : ''}
              {' '}Until then every figure stays in its own currency, which is correct rather than convenient.
            </p>
          </div>
        )
      ) : null}

      {/* Policy */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-300">How costs are converted</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {FX_POLICIES.map((p) => (
            <button key={p.key} onClick={() => savePolicy(p.key)}
              className={`text-left p-3 rounded-lg border transition-colors ${
                policy === p.key
                  ? 'border-orange-500/60 bg-orange-500/10'
                  : 'border-gray-800 bg-gray-900/60 hover:border-gray-700'}`}>
              <p className={`text-xs font-semibold ${policy === p.key ? 'text-orange-300' : 'text-gray-200'}`}>
                {p.label}
              </p>
              <p className="text-[11px] text-gray-500 mt-1 leading-snug">{p.detail}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Add */}
      <div className="flex items-end gap-2 flex-wrap">
        {[['base', 'From'], ['quote', 'To']].map(([k, label]) => (
          <label key={k} className="text-[11px] text-gray-400">
            {label}
            <input value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value.toUpperCase() }))}
              className="block w-20 mt-1 h-8 px-2 rounded-lg bg-gray-950 border border-gray-800 text-xs text-gray-200" />
          </label>
        ))}
        <label className="text-[11px] text-gray-400">
          Rate
          <input value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
            placeholder="1.0211" inputMode="decimal"
            className="block w-28 mt-1 h-8 px-2 rounded-lg bg-gray-950 border border-gray-800 text-xs text-gray-200" />
        </label>
        <label className="text-[11px] text-gray-400">
          Effective from
          <input type="date" value={form.rateDate}
            onChange={(e) => setForm((f) => ({ ...f, rateDate: e.target.value }))}
            className="block mt-1 h-8 px-2 rounded-lg bg-gray-950 border border-gray-800 text-xs text-gray-200" />
        </label>
        <button onClick={add} disabled={busy || !form.rate}
          className="h-8 px-3 rounded-lg bg-orange-600 hover:bg-orange-500 text-xs text-white font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
          <Plus size={12} /> Add rate
        </button>
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/25">
        <Info size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-sky-300">
          A new rate is recorded but not used until an administrator approves it. Nothing here is
          filled in automatically: a wrong rate reads as authoritative, which is worse than showing
          three honest per-country figures.
        </p>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-xs text-gray-500">Loading.</p>
      ) : rates.length === 0 ? (
        <p className="text-xs text-gray-500">
          No rates recorded. Combined-country totals stay unavailable until there are.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="py-2 pr-3">Pair</th>
                <th className="py-2 px-3 text-right">Rate</th>
                <th className="py-2 px-3">Effective from</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 pl-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-b border-gray-800/60">
                  <td className="py-2 pr-3 text-gray-200">{r.base_currency} to {r.quote_currency}</td>
                  <td className="py-2 px-3 text-right text-gray-200">{Number(r.rate).toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                  <td className="py-2 px-3 text-gray-400">{String(r.rate_date).slice(0, 10)}</td>
                  <td className="py-2 px-3">
                    {r.approved
                      ? <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">In use</span>
                      : <span className="px-1.5 py-0.5 rounded bg-gray-700/40 text-gray-400">Not approved</span>}
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">
                    <button onClick={() => act(setRateApproval, r.id, !r.approved)} disabled={busy}
                      className="h-7 px-2 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:text-white inline-flex items-center gap-1 disabled:opacity-50">
                      {r.approved ? <><X size={11} /> Withdraw</> : <><Check size={11} /> Approve</>}
                    </button>
                    <button onClick={() => act(deleteCurrencyRate, r.id)} disabled={busy}
                      className="h-7 px-2 ml-1.5 rounded bg-gray-800 border border-gray-700 text-red-300 hover:text-red-200 inline-flex items-center gap-1 disabled:opacity-50">
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
