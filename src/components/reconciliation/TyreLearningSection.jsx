import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, RefreshCw, Check, Undo2, Power, Sparkles, Plus } from 'lucide-react'
import {
  listTyreSuggestions, listLearnedFacts, confirmTyreFact, undoTyreBatch,
  deactivateLearnedFact, reactivateLearnedFact,
} from '../../lib/api/tyreLearning'
import { shapeSuggestions, suggestionSummary, normalizeBrandToken, MATCH_TYPES } from '../../lib/tyreLearning'
import { toUserMessage } from '../../lib/safeError'
import { APPROVED_BRANDS, CHINESE_BRANDS } from '../../lib/tyreSpecCatalog'
import EnterpriseTable from '../ui/EnterpriseTable'
import { reportFileName } from '../../lib/exportUtils'

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
  // A failed LOAD is kept apart from a failed action: the lists below must not
  // render "no gaps" / "no rules" when they were never read.
  const [loadError, setLoadError] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [notice, setNotice] = useState(null)
  const [lastBatch, setLastBatch] = useState(null)

  // manual confirm form
  const [mType, setMType] = useState('serial')
  const [mValue, setMValue] = useState('')
  const [mBrand, setMBrand] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null); setLoadError(null)
    try {
      const [sug, fac] = await Promise.all([
        listTyreSuggestions({ country }),
        listLearnedFacts({ country }),
      ])
      setSuggestions(shapeSuggestions(sug))
      setFacts(Array.isArray(fac) ? fac : [])
    } catch (e) {
      setSuggestions([]); setFacts([])
      setLoadError(toUserMessage(e, 'The learning data could not be read.'))
    } finally {
      setLoading(false)
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => suggestionSummary(suggestions), [suggestions])

  const suggestionColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (s) => s.serialNo, size: 160,
      cell: ({ row }) => <span className="font-mono text-[var(--text-primary)]">{row.original.serialNo}</span> },
    { id: 'country', header: 'Country', accessorFn: (s) => s.country || 'N/A', size: 100, meta: { filterVariant: 'select' } },
    { id: 'rows', header: 'Rows', accessorFn: (s) => Number(s.rows) || 0, size: 80, meta: { align: 'right' } },
    { id: 'brand', header: 'Suggested brand', accessorFn: (s) => s.brand, size: 160, meta: { filterVariant: 'select' },
      cell: ({ row }) => <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-500">{row.original.brand}</span> },
    { id: 'source', header: 'Source', accessorFn: (s) => s.sourceLabel, size: 150, meta: { filterVariant: 'select' } },
    {
      id: 'confirm', header: 'Confirm', size: 140, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const s = row.original
        const key = `sug-${s.serialKey}`
        return (
          <button
            type="button"
            disabled={busyKey === key}
            onClick={() => applyConfirm({ matchType: 'serial', matchValue: s.serialNo, targetValue: s.brand, rowCountry: s.country, key })}
            aria-label={`Confirm brand ${s.brand} for serial ${s.serialNo}`}
            className="btn-primary inline-flex min-h-[44px] items-center gap-1 px-3 text-xs font-medium disabled:opacity-50"
          >
            <Check size={13} /> Confirm
          </button>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busyKey])

  const factColumns = useMemo(() => [
    { id: 'type', header: 'Rule', accessorFn: (f) => (f.match_type === 'serial' ? 'Serial' : 'Spelling'), size: 100, meta: { filterVariant: 'select' } },
    { id: 'match', header: 'Matches', accessorFn: (f) => f.match_value, size: 170,
      cell: ({ row }) => <span className="font-mono text-[var(--text-primary)]">{row.original.match_value}</span> },
    { id: 'target', header: 'Becomes', accessorFn: (f) => f.target_value, size: 150,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.target_value}</span> },
    { id: 'field', header: 'Field', accessorFn: (f) => f.target_field, size: 90 },
    { id: 'country', header: 'Country', accessorFn: (f) => f.country || 'All', size: 90 },
    { id: 'state', header: 'State', accessorFn: (f) => (f.active ? 'On' : 'Off'), size: 80, meta: { filterVariant: 'select' } },
    {
      id: 'toggle', header: 'Action', size: 130, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const f = row.original
        return (
          <button type="button" disabled={busyKey === `fact-${f.id}`} onClick={() => toggleFact(f)}
            aria-label={`${f.active ? 'Turn off' : 'Turn on'} rule for ${f.match_value}`}
            className="btn-secondary inline-flex min-h-[44px] items-center gap-1 px-3 text-xs disabled:opacity-50">
            <Power size={12} /> {f.active ? 'Turn off' : 'Turn on'}
          </button>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busyKey])

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
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border-dim)]">
        <div className="w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center shrink-0">
          <Brain className="w-5 h-5 text-emerald-500" />
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
        <button type="button" onClick={load} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--border-dim)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-2)]">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="p-5 space-y-5">
        {loadError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            <span>{loadError}</span>
            <button type="button" onClick={load} className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-red-400/30 px-3 text-xs hover:bg-red-500/10">
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        )}
        {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
        {notice && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-500">
            <span>{notice}</span>
            {lastBatch?.id && (
              <button type="button" disabled={busyKey === 'undo'} onClick={onUndo} className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-emerald-400/30 px-3 text-xs hover:bg-emerald-500/10 disabled:opacity-50">
                <Undo2 size={13} /> Undo last
              </button>
            )}
          </div>
        )}

        {/* summary tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Serials to fill" value={loadError ? null : summary.serials} loading={loading} />
          <Tile label="Rows to fill" value={loadError ? null : summary.rows} loading={loading} />
          <Tile label="From another row" value={loadError ? null : summary.fromSelf} loading={loading} />
          <Tile label="From master file" value={loadError ? null : summary.fromMaster} loading={loading} />
        </div>

        {/* suggestions */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Suggested brand fills</p>
          {loading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading suggestions...</p>
          ) : loadError ? (
            <p className="text-sm text-[var(--text-muted)]">Suggestions could not be read. Use Retry above.</p>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No recoverable brand gaps. Every blank-brand serial either has no source or is already learned.</p>
          ) : (
            <EnterpriseTable
              columns={suggestionColumns}
              data={suggestions}
              getRowId={(s) => `sug-${s.serialKey}`}
              enableKeyboard={false}
              initialPageSize={25}
              emptyMessage="No suggestion matches this search"
              searchPlaceholder="Search suggestions"
              exportFileName={reportFileName('Tyre brand suggestions')}
              reportMeta={{ title: 'Suggested brand fills' }}
            />
          )}
        </div>

        {/* manual confirm */}
        <div className="rounded-lg border border-[var(--border-dim)] p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Sparkles size={13} /> Teach it manually</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <select value={mType} onChange={(e) => setMType(e.target.value)} aria-label="Match by" className="min-h-[44px] rounded-lg border border-[var(--border-dim)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {Object.entries(MATCH_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={mValue} onChange={(e) => setMValue(e.target.value)} placeholder={mType === 'serial' ? 'Serial number' : 'Wrong spelling (e.g. TRAINGLE)'} aria-label={mType === 'serial' ? 'Serial number' : 'Wrong spelling'} className="min-h-[44px] rounded-lg border border-[var(--border-dim)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]" />
            <input value={mBrand} onChange={(e) => setMBrand(e.target.value)} list="tp-brand-suggestions" placeholder="Correct brand" aria-label="Correct brand" className="min-h-[44px] rounded-lg border border-[var(--border-dim)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]" />
            <button type="button" disabled={busyKey === 'manual'} onClick={onManualConfirm} className="btn-primary inline-flex min-h-[44px] items-center justify-center gap-1 px-3 text-sm font-medium disabled:opacity-50">
              <Plus size={14} /> Confirm & learn
            </button>
          </div>
          <datalist id="tp-brand-suggestions">{BRAND_SUGGESTIONS.map((b) => <option key={b} value={b} />)}</datalist>
          <p className="mt-1 text-xs text-[var(--text-muted)]">By serial fills every row of that serial. Normalize a spelling fixes that raw brand everywhere it appears - now and on future imports.</p>
        </div>

        {/* learned rules */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Learned rules ({loadError ? 'N/A' : facts.length})</p>
          {loading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading rules...</p>
          ) : loadError ? (
            <p className="text-sm text-[var(--text-muted)]">Learned rules could not be read. Use Retry above.</p>
          ) : facts.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No rules yet. Confirm a suggestion above to create one.</p>
          ) : (
            <EnterpriseTable
              columns={factColumns}
              data={facts}
              getRowId={(f) => String(f.id)}
              enableKeyboard={false}
              initialPageSize={25}
              emptyMessage="No rule matches this search"
              searchPlaceholder="Search rules"
              exportFileName={reportFileName('Tyre learned rules')}
              reportMeta={{ title: 'Learned tyre rules' }}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function Tile({ label, value, loading }) {
  return (
    <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] px-3 py-2">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[var(--text-primary)] tabular-nums">{loading ? '...' : value == null ? 'N/A' : Number(value).toLocaleString()}</p>
    </div>
  )
}
