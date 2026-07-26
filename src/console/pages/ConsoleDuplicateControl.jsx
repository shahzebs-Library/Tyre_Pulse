/**
 * ConsoleDuplicateControl - super-admin duplicate finder / remover (V362).
 *
 * Two tabs:
 *   Duplicates    - pick a table, pick a country, see exactly how many extra rows
 *                   exist and what money they carry, inspect the groups, then
 *                   remove them behind a typed confirmation. Every removal is
 *                   archived and can be put back with one click.
 *   Where to import - the reference the customer asked for: which Supabase table
 *                   to import each ERP file into, which columns it expects, and
 *                   what to watch out for. Exportable to Excel.
 *
 * The rule the UI must not hide: a repeated business key is NOT automatically a
 * duplicate. Groups whose rows carry more than one distinct source_row are
 * genuine repeated lines in the source file, and the server refuses to touch
 * them. Those are shown as "protected" so that a deletable count of 0 never
 * reads as "nothing found".
 *
 * No raw SQL, no em/en dashes. Super-admin only (the whole /console is gated).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CopyX, RefreshCw, AlertTriangle, ShieldCheck, Database, Loader2, Undo2, Search,
  Upload, Download, Info, Lock,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listDuplicateTargets, previewDuplicates, scanDuplicates, resolveDuplicates,
  restoreDuplicateBatch, listDuplicateBatches, previewSummary,
} from '../../lib/api/duplicateControl'
import { IMPORT_TARGETS, importTargetRows } from '../../lib/importTargets'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'

const COUNTRIES = ['KSA', 'UAE', 'Egypt']

/** Each country reports in its own currency; totals are never blended across them. */
const CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

const fmtNum = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A')
const fmtMoney = (n) => (Number.isFinite(Number(n))
  ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
  : 'N/A')
const fmtTime = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 16).replace('T', ' ')
}

export default function ConsoleDuplicateControl() {
  const { logAction } = useConsoleAuth()
  const [tab, setTab] = useState('duplicates')

  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selected, setSelected] = useState(null)
  const [country, setCountry] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [groups, setGroups] = useState([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [result, setResult] = useState(null)
  const [batches, setBatches] = useState([])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [t, b] = await Promise.all([listDuplicateTargets(), listDuplicateBatches()])
      setTargets(t); setBatches(b)
    } catch (e) {
      setError(e?.message || 'Could not load duplicate targets.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function selectTarget(t) {
    setSelected(t); setPreview(null); setGroups([]); setResult(null); setError('')
  }

  const runPreview = useCallback(async (t = selected, c = country) => {
    if (!t) return
    setBusy(true); setPreview(null); setGroups([]); setResult(null); setError('')
    try {
      const [p, g] = await Promise.all([
        previewDuplicates(t.key, c || null),
        scanDuplicates(t.key, c || null, 100),
      ])
      setPreview(p); setGroups(g)
    } catch (e) {
      setError(e?.message || 'Could not check for duplicates.')
    } finally {
      setBusy(false)
    }
  }, [selected, country])

  async function doRemove() {
    if (!selected || confirmText.trim().toUpperCase() !== 'REMOVE') return
    setBusy(true); setError('')
    try {
      const r = await resolveDuplicates(selected.key, country || null,
        `Removed via Console Duplicate Control (${selected.tbl})`)
      setResult(r)
      setConfirmOpen(false); setConfirmText('')
      logAction?.('duplicate_resolve', r?.batch_id, selected.tbl,
        { deleted: r?.deleted, country: country || 'all' })
      await Promise.all([runPreview(), listDuplicateBatches().then(setBatches)])
    } catch (e) {
      setError(e?.message || 'Could not remove the duplicates.')
    } finally {
      setBusy(false)
    }
  }

  async function doRestore(batchId) {
    setBusy(true); setError('')
    try {
      const r = await restoreDuplicateBatch(batchId)
      setResult({ restored: r?.restored, tbl: r?.tbl })
      logAction?.('duplicate_restore', batchId, r?.tbl, { restored: r?.restored })
      await Promise.all([
        listDuplicateBatches().then(setBatches),
        selected ? runPreview() : Promise.resolve(),
      ])
    } catch (e) {
      setError(e?.message || 'Could not restore that batch.')
    } finally {
      setBusy(false)
    }
  }

  const deletable = Number(preview?.extra_deletable) || 0
  const protectedRows = Number(preview?.extra_protected) || 0
  const money = Number(preview?.money_deletable) || 0

  const openBatches = useMemo(() => batches.filter((b) => !b.restored), [batches])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <CopyX size={18} className="text-orange-400" /> Duplicate Control
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Find and remove rows that got imported twice, and see where each file should be uploaded.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white flex items-center gap-2 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex gap-1.5 border-b border-gray-800">
        {[['duplicates', 'Duplicates', CopyX], ['import', 'Where to import', Upload]].map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
              tab === k ? 'border-orange-500 text-orange-300' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-950/40 border border-red-800/50">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {tab === 'import' ? (
        <ImportReference />
      ) : (
        <>
          <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-sky-950/30 border border-sky-800/40">
            <ShieldCheck size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-sky-200">
              Nothing is removed until you confirm. Every removed row is kept in full and can be
              put back with one click. Rows that repeat because the source file genuinely repeats
              them are protected and can never be removed here.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-7 h-7 text-orange-500 animate-spin" />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Targets */}
              <div className="rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-800 text-xs font-semibold text-gray-300 flex items-center gap-2">
                  <Database size={13} className="text-gray-500" /> What to check
                </div>
                <div className="divide-y divide-gray-800/60 max-h-[520px] overflow-y-auto">
                  {targets.length === 0 ? (
                    <p className="px-4 py-6 text-xs text-gray-600 text-center">No targets available.</p>
                  ) : targets.map((t) => {
                    const active = selected?.key === t.key
                    return (
                      <button key={t.key} onClick={() => selectTarget(t)}
                        className={`w-full text-left px-4 py-3 transition-colors ${active ? 'bg-orange-900/20' : 'hover:bg-black/20'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-gray-200">{t.label}</span>
                          {t.kind === 'money' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-amber-300 border border-amber-800/50 bg-amber-900/20">
                              Affects money
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">
                          {t.tbl}
                          {!t.has_source_row && ' · no line-number column, so repeats cannot be told apart'}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Panel */}
              <div className="rounded-xl border border-gray-800 p-4">
                {!selected ? (
                  <div className="text-center text-sm text-gray-600 py-16">
                    Pick something on the left to check for duplicates.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">{selected.label}</h3>
                      <p className="text-[11px] text-gray-500 mt-0.5">{selected.tbl}</p>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Country</label>
                      <div className="flex flex-wrap gap-1.5">
                        {['', ...COUNTRIES].map((c) => (
                          <button key={c || 'all'}
                            onClick={() => { setCountry(c); setPreview(null); setGroups([]) }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] border ${
                              country === c ? 'bg-orange-600 border-orange-500 text-white'
                                : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'}`}>
                            {c || 'All countries'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button onClick={() => runPreview()} disabled={busy}
                      className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-200 hover:text-white flex items-center gap-2 disabled:opacity-50">
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                      Check for duplicates
                    </button>

                    {preview && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <Stat label="Can be removed" value={fmtNum(deletable)} tone={deletable ? 'amber' : 'plain'} />
                          <Stat label="Protected (genuine)" value={fmtNum(protectedRows)} tone={protectedRows ? 'sky' : 'plain'} />
                        </div>
                        {/* Each country keeps its own currency (SAR / AED / EGP), so a
                            single figure across all of them would be meaningless. Show
                            the amount only when one country is selected. */}
                        {selected.kind === 'money' && deletable > 0 && (
                          <div className="px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-800/40">
                            <p className="text-[11px] text-amber-200">
                              {country
                                ? `These rows are inflating reported ${country} spend by `
                                  + `${fmtMoney(money)} ${CURRENCY[country] || ''}. Removing them `
                                  + 'lowers the reported total by that amount, which is the correction.'
                                : 'These rows are inflating reported spend. Pick a single country '
                                  + 'to see the amount: each country keeps its own currency, so a '
                                  + 'combined figure would be meaningless.'}
                            </p>
                          </div>
                        )}
                        <p className="text-[11px] text-gray-400">{previewSummary(preview)}</p>

                        {protectedRows > 0 && deletable === 0 && (
                          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-sky-950/30 border border-sky-800/40">
                            <Lock size={12} className="text-sky-400 flex-shrink-0 mt-0.5" />
                            <p className="text-[11px] text-sky-200">
                              Every repeat here comes from a different line of the source file, so
                              these are real records, not import mistakes. Nothing to remove.
                            </p>
                          </div>
                        )}

                        {deletable > 0 && (
                          <button onClick={() => { setConfirmOpen(true); setConfirmText('') }} disabled={busy}
                            className="h-9 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white flex items-center gap-2 disabled:opacity-50">
                            <CopyX size={13} /> Remove {fmtNum(deletable)} extra row(s)
                          </button>
                        )}
                      </div>
                    )}

                    {result && (
                      <div className="px-3 py-2 rounded-lg bg-emerald-950/30 border border-emerald-800/40">
                        <p className="text-[11px] text-emerald-200">
                          {result.restored != null
                            ? `Put back ${fmtNum(result.restored)} row(s) into ${result.tbl}.`
                            : `Removed ${fmtNum(result.deleted)} row(s). You can undo this below.`}
                        </p>
                      </div>
                    )}

                    {groups.length > 0 && (
                      <div className="rounded-lg border border-gray-800 overflow-hidden">
                        <div className="px-3 py-2 border-b border-gray-800 text-[11px] font-semibold text-gray-400">
                          Groups found (showing up to 100)
                        </div>
                        <div className="max-h-56 overflow-y-auto divide-y divide-gray-800/60">
                          {groups.map((g, i) => (
                            <div key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                              <span className="text-[10px] text-gray-400 truncate flex-1" title={g.bkey}>
                                {g.bkey}
                              </span>
                              <span className="text-[10px] text-gray-500 flex-shrink-0">
                                {g.copies} copies
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold flex-shrink-0 border ${
                                g.verdict === 'genuine'
                                  ? 'text-sky-300 border-sky-800/50 bg-sky-900/20'
                                  : 'text-amber-300 border-amber-800/50 bg-amber-900/20'
                              }`}>
                                {g.verdict === 'genuine' ? 'Protected' : 'Duplicate'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Undo history */}
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-800 text-xs font-semibold text-gray-300 flex items-center gap-2">
              <Undo2 size={13} className="text-gray-500" /> Removal history
              <span className="text-[10px] text-gray-600 font-normal">
                every removal stays undoable
              </span>
            </div>
            {batches.length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-600 text-center">
                Nothing has been removed yet.
              </p>
            ) : (
              <div className="divide-y divide-gray-800/60 max-h-64 overflow-y-auto">
                {batches.map((b) => (
                  <div key={b.batch_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-200 truncate">
                        {fmtNum(b.rows)} row(s) from {b.tbl}
                        {b.country ? ` (${b.country})` : ''}
                      </p>
                      <p className="text-[10px] text-gray-600">{fmtTime(b.created_at)}</p>
                    </div>
                    {b.restored ? (
                      <span className="px-2 py-0.5 rounded text-[9px] font-semibold text-emerald-300 border border-emerald-800/50 bg-emerald-900/20 flex-shrink-0">
                        Put back
                      </span>
                    ) : (
                      <button onClick={() => doRestore(b.batch_id)} disabled={busy}
                        className="h-7 px-2.5 rounded-lg bg-gray-800 border border-gray-700 text-[11px] text-gray-300 hover:text-white flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50">
                        <Undo2 size={11} /> Undo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {openBatches.length > 0 && (
            <p className="text-[10px] text-gray-600 flex items-center gap-1">
              <Info size={10} /> {openBatches.length} removal(s) can still be undone.
            </p>
          )}
        </>
      )}

      {/* Confirm modal */}
      {confirmOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => { setConfirmOpen(false); setConfirmText('') }}>
          <div className="w-full max-w-md rounded-xl bg-[#0f0f16] border border-gray-800 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-400" /> Remove duplicate rows
            </h3>
            <p className="text-xs text-gray-400">
              This removes {fmtNum(deletable)} extra row(s) from {selected.tbl}
              {country ? ` for ${country}` : ''}, keeping the first copy of each.
              {selected.kind === 'money' && deletable > 0 && country
                && ` Reported ${country} spend will drop by ${fmtMoney(money)} `
                   + `${CURRENCY[country] || ''}, which is the correction.`}
              {' '}Every removed row is saved and can be put back from the removal history.
            </p>
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">
                Type REMOVE to confirm
              </label>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                autoFocus placeholder="REMOVE"
                className="w-full h-9 bg-gray-800/80 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-orange-500" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirmOpen(false); setConfirmText('') }}
                className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white">
                Cancel
              </button>
              <button onClick={doRemove} disabled={busy || confirmText.trim().toUpperCase() !== 'REMOVE'}
                className="h-9 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white flex items-center gap-2 disabled:opacity-40">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CopyX size={13} />} Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  const tones = {
    amber: 'text-amber-300 border-amber-800/40 bg-amber-950/20',
    sky: 'text-sky-300 border-sky-800/40 bg-sky-950/20',
    plain: 'text-gray-300 border-gray-800 bg-black/20',
  }
  return (
    <div className={`px-3 py-2 rounded-lg border ${tones[tone] || tones.plain}`}>
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className="text-lg font-semibold leading-tight">{value}</p>
    </div>
  )
}

function ImportReference() {
  function download() {
    const rows = importTargetRows()
    const keys = Object.keys(rows[0] || {})
    exportToExcel(rows, keys,
      ['Import into table', 'What it is', 'Ends up in', 'Source file', 'Add country column',
        'Headers must match exactly', 'Columns', 'Notes'],
      reportFileName('TyrePulse Import Reference'))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-sky-950/30 border border-sky-800/40 flex-1 min-w-[280px]">
          <Info size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-sky-200">
            Import into the table named below using Supabase Table Editor, Import data from CSV.
            These tables always look empty afterwards on purpose: each one maps and forwards the
            rows into the live table, then clears itself.
          </p>
        </div>
        <button onClick={download}
          className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white flex items-center gap-2">
          <Download size={13} /> Excel
        </button>
      </div>

      <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-amber-950/30 border border-amber-800/40">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-200">
          Uploading the same file twice adds the rows again. Nothing currently blocks it, so after
          any re-run come back to the Duplicates tab and check.
        </p>
      </div>

      <div className="space-y-3">
        {IMPORT_TARGETS.map((t) => (
          <div key={t.table} className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-800 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs font-semibold text-orange-300 font-mono">{t.table}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{t.label}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Tag>Ends up in {t.feeds}</Tag>
                {t.needsCountry ? <Tag tone="amber">Add a country column</Tag>
                  : <Tag tone="sky">Country from table name</Tag>}
                {t.verbatimHeaders && <Tag tone="amber">Headers must match exactly</Tag>}
              </div>
            </div>
            <div className="px-4 py-3 space-y-2">
              <p className="text-[10px] text-gray-500">
                <span className="text-gray-400 font-semibold">Source file:</span> {t.sourceFile}
              </p>
              <div>
                <p className="text-[10px] text-gray-400 font-semibold mb-1">Columns</p>
                <div className="flex flex-wrap gap-1">
                  {t.columns.map((c) => (
                    <span key={c} className="px-1.5 py-0.5 rounded bg-gray-800/70 border border-gray-700 text-[9px] text-gray-300 font-mono">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">{t.notes}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Tag({ children, tone }) {
  const tones = {
    amber: 'text-amber-300 border-amber-800/50 bg-amber-900/20',
    sky: 'text-sky-300 border-sky-800/50 bg-sky-900/20',
    plain: 'text-gray-400 border-gray-700 bg-gray-800/50',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${tones[tone] || tones.plain}`}>
      {children}
    </span>
  )
}
