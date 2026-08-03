import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, RefreshCw, Check, Undo2, Power, Sparkles, Plus } from 'lucide-react'
import {
  listTyreSuggestions, listLearnedFacts, confirmTyreFact, undoTyreBatch,
  deactivateLearnedFact, reactivateLearnedFact,
} from '../../lib/api/tyreLearning'
import { shapeSuggestions, suggestionSummary, normalizeBrandToken, MATCH_TYPES } from '../../lib/tyreLearning'
import { toUserMessage } from '../../lib/safeError'
import { APPROVED_BRANDS, CHINESE_BRANDS } from '../../lib/tyreSpecCatalog'

const BRAND_SUGGESTIONS = Array.from(new Set([...APPROVED_BRANDS, ...CHINESE_BRANDS]))

/**
 * Tyre Data Learning - confirm a brand once and it fills every matching current
 * row AND auto-applies to future imports (V471). Self-contained section for the
 * Data Reconciliation page. Elevated-gated server-side; nothing here touches cost.
 */
export default function TyreLearningSection({ activeCountry } = {}) {
  const country = activeCountry && activeCountry !== 'All' ? activeCountry : 'All'

  const [suggestions, setSuggestions] = useState([])
  const [facts, setFacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [notice, setNotice] = useState(null)
  const [lastBatch, setLastBatch] = useState(null)

  // manual confirm form
  const [mType, setMType] = useState('serial')
  const [mValue, setMValue] = useState('')
  const [mBrand, setMBrand] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [sug, fac] = await Promise.all([
        listTyreSuggestions({ country }),
        listLearnedFacts({ country }),
      ])
      setSuggestions(shapeSuggestions(sug))
      setFacts(Array.isArray(fac) ? fac : [])
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => suggestionSummary(suggestions), [suggestions])

  async function applyConfirm({ matchType, matchValue, targetValue, rowCountry, key }) {
    setBusyKey(key); setError(null); setNotice(null)
    try {
      const res = await confirmTyreFact({
        matchType, matchValue, targetField: 'brand', targetValue,
        country: rowCountry || (country !== 'All' ? country : null), dryRun: false,
      })
      if (res?.batch_id) setLastBatch({ id: res.batch_id, filled: res.filled, value: targetValue })
      setNotice(`Confirmed. Filled ${res?.filled ?? 0} row(s) now; future imports with this ${matchType === 'serial' ? 'serial' : 'spelling'} auto-fill too.`)
      await load()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setBusyKey(null)
    }
  }

  function onManualConfirm() {
    const brand = normalizeBrandToken(mBrand)
    const value = String(mValue || '').trim()
    if (!value || !brand) { setError('Enter both the value and a real brand.'); return }
    applyConfirm({ matchType: mType, matchValue: value, targetValue: brand, key: 'manual' })
      .then(() => { setMValue(''); setMBrand('') })
  }

  async function onUndo() {
    if (!lastBatch?.id) return
    setBusyKey('undo'); setError(null)
    try {
      const res = await undoTyreBatch(lastBatch.id)
      setNotice(`Undone. Restored ${res?.restored ?? 0} row(s) and turned the rule off.`)
      setLastBatch(null)
      await load()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setBusyKey(null)
    }
  }

  async function toggleFact(f) {
    setBusyKey(`fact-${f.id}`); setError(null)
    try {
      if (f.active) await deactivateLearnedFact(f.id)
      else await reactivateLearnedFact(f.id)
      await load()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--card-border)]">
        <div className="w-9 h-9 rounded-lg bg-gray-800/60 border border-gray-700/40 flex items-center justify-center shrink-0">
          <Brain className="w-5 h-5 text-emerald-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tyre Data Learning</h3>
            <span className="text-xs text-[var(--text-muted)]">confirm once, auto-fix now and future</span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Confirm a serial's brand (or fix a misspelled brand). It fills every matching row now and auto-applies to future imports. Never touches cost.
          </p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-gray-800/40">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="p-5 space-y-5">
        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
        {notice && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300">
            <span>{notice}</span>
            {lastBatch?.id && (
              <button type="button" disabled={busyKey === 'undo'} onClick={onUndo} className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 px-2 py-1 text-xs hover:bg-emerald-500/10 disabled:opacity-50">
                <Undo2 size={13} /> Undo last
              </button>
            )}
          </div>
        )}

        {/* summary tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Serials to fill" value={summary.serials} />
          <Tile label="Rows to fill" value={summary.rows} />
          <Tile label="From another row" value={summary.fromSelf} />
          <Tile label="From master file" value={summary.fromMaster} />
        </div>

        {/* suggestions */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Suggested brand fills</p>
          {loading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading suggestions...</p>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No recoverable brand gaps. Every blank-brand serial either has no source or is already learned.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--card-border)]">
              <table className="w-full text-sm">
                <thead className="bg-gray-900/40 text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Serial</th>
                    <th className="px-3 py-2 text-left font-medium">Country</th>
                    <th className="px-3 py-2 text-right font-medium">Rows</th>
                    <th className="px-3 py-2 text-left font-medium">Suggested brand</th>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-right font-medium">Confirm</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.slice(0, 200).map((s) => {
                    const key = `sug-${s.serialKey}`
                    return (
                      <tr key={key} className="border-t border-[var(--card-border)]">
                        <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{s.serialNo}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{s.country || 'N/A'}</td>
                        <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{s.rows}</td>
                        <td className="px-3 py-2"><span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">{s.brand}</span></td>
                        <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{s.sourceLabel}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={busyKey === key}
                            onClick={() => applyConfirm({ matchType: 'serial', matchValue: s.serialNo, targetValue: s.brand, rowCountry: s.country, key })}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            <Check size={13} /> Confirm
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* manual confirm */}
        <div className="rounded-lg border border-[var(--card-border)] p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Sparkles size={13} /> Teach it manually</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <select value={mType} onChange={(e) => setMType(e.target.value)} className="rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {Object.entries(MATCH_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={mValue} onChange={(e) => setMValue(e.target.value)} placeholder={mType === 'serial' ? 'Serial number' : 'Wrong spelling (e.g. TRAINGLE)'} className="rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]" />
            <input value={mBrand} onChange={(e) => setMBrand(e.target.value)} list="tp-brand-suggestions" placeholder="Correct brand" className="rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]" />
            <button type="button" disabled={busyKey === 'manual'} onClick={onManualConfirm} className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              <Plus size={14} /> Confirm & learn
            </button>
          </div>
          <datalist id="tp-brand-suggestions">{BRAND_SUGGESTIONS.map((b) => <option key={b} value={b} />)}</datalist>
          <p className="mt-1 text-xs text-[var(--text-muted)]">By serial fills every row of that serial. Normalize a spelling fixes that raw brand everywhere it appears - now and on future imports.</p>
        </div>

        {/* learned rules */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Learned rules ({facts.length})</p>
          {facts.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No rules yet. Confirm a suggestion above to create one.</p>
          ) : (
            <div className="space-y-1.5">
              {facts.slice(0, 100).map((f) => (
                <div key={f.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${f.active ? 'border-[var(--card-border)]' : 'border-gray-700/40 opacity-60'}`}>
                  <span className="text-[var(--text-secondary)]">
                    <span className="text-[var(--text-muted)]">{f.match_type === 'serial' ? 'Serial' : 'Spelling'}</span>{' '}
                    <span className="font-mono text-[var(--text-primary)]">{f.match_value}</span>{' -> '}
                    <span className="font-medium text-[var(--text-primary)]">{f.target_value}</span>{' '}
                    <span className="text-xs text-[var(--text-muted)]">({f.target_field}{f.country ? `, ${f.country}` : ''}{f.active ? '' : ', off'})</span>
                  </span>
                  <button type="button" disabled={busyKey === `fact-${f.id}`} onClick={() => toggleFact(f)} className="inline-flex items-center gap-1 rounded-md border border-[var(--card-border)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-gray-800/40 disabled:opacity-50">
                    <Power size={12} /> {f.active ? 'Turn off' : 'Turn on'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function Tile({ label, value }) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-gray-900/30 px-3 py-2">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[var(--text-primary)]">{Number(value || 0).toLocaleString()}</p>
    </div>
  )
}
