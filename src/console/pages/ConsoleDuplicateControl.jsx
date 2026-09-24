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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CopyX, RefreshCw, AlertTriangle, ShieldCheck, Database, Undo2, Search,
  Upload, Download, Info, Lock, CheckCircle2, BarChart3,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Code, Btn, Segmented,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { BarsChart } from '../components/ui/charts'
import {
  listDuplicateTargets, previewDuplicates, scanDuplicates, resolveDuplicates,
  restoreDuplicateBatch, listDuplicateBatches, previewSummary,
} from '../../lib/api/duplicateControl'
import { IMPORT_TARGETS, importTargetRows, uploadWorkbookSheets } from '../../lib/importTargets'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const CONFIRM_WORD = 'REMOVE'

/** Each country reports in its own currency; totals are never blended across them. */
const CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

const fmtNum = (n) => (n !== null && n !== undefined && Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A')
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
  const [loadError, setLoadError] = useState('')
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

  // Each check is numbered so a slow answer for the previous target or country
  // can never land under the one now on screen.
  const reqSeq = useRef(0)

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const [t, b] = await Promise.all([listDuplicateTargets(), listDuplicateBatches()])
      setTargets(t); setBatches(b)
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not load duplicate targets.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function selectTarget(t) {
    reqSeq.current += 1
    setSelected(t); setPreview(null); setGroups([]); setResult(null); setError('')
  }

  function selectCountry(c) {
    reqSeq.current += 1
    setCountry(c); setPreview(null); setGroups([])
  }

  const runPreview = useCallback(async (t = selected, c = country) => {
    if (!t) return
    const seq = ++reqSeq.current
    setBusy(true); setPreview(null); setGroups([]); setResult(null); setError('')
    try {
      const [p, g] = await Promise.all([
        previewDuplicates(t.key, c || null),
        scanDuplicates(t.key, c || null, 100),
      ])
      if (seq !== reqSeq.current) return
      setPreview(p); setGroups(g)
    } catch (e) {
      if (seq === reqSeq.current) setError(toUserMessage(e, 'Could not check for duplicates.'))
    } finally {
      setBusy(false)
    }
  }, [selected, country])

  async function doRemove() {
    if (busy || !selected || confirmText.trim().toUpperCase() !== CONFIRM_WORD) return
    setBusy(true); setError('')
    try {
      const r = await resolveDuplicates(selected.key, country || null,
        `Removed via Console Duplicate Control (${selected.tbl})`)
      setConfirmOpen(false); setConfirmText('')
      logAction?.('duplicate_resolve', r?.batch_id, selected.tbl,
        { deleted: r?.deleted, country: country || 'all' })
      await Promise.all([runPreview(), listDuplicateBatches().then(setBatches)])
      // Set after the refresh: runPreview clears `result` when it starts.
      setResult(r)
    } catch (e) {
      setError(toUserMessage(e, 'Could not remove the duplicates.'))
    } finally {
      setBusy(false)
    }
  }

  async function doRestore(batchId) {
    setBusy(true); setError('')
    try {
      const r = await restoreDuplicateBatch(batchId)
      logAction?.('duplicate_restore', batchId, r?.tbl, { restored: r?.restored })
      await Promise.all([
        listDuplicateBatches().then(setBatches),
        selected ? runPreview() : Promise.resolve(),
      ])
      setResult({ restored: r?.restored, tbl: r?.tbl })
    } catch (e) {
      setError(toUserMessage(e, 'Could not restore that batch.'))
    } finally {
      setBusy(false)
    }
  }

  function closeConfirm() {
    if (busy) return
    setConfirmOpen(false); setConfirmText('')
  }

  const deletable = Number(preview?.extra_deletable) || 0
  const protectedRows = Number(preview?.extra_protected) || 0
  const money = Number(preview?.money_deletable) || 0

  const openBatches = useMemo(() => batches.filter((b) => !b.restored), [batches])

  // Rows removed per table, from the removal history. A count of rows, never
  // money, so it is safe to add across countries.
  const removedBars = useMemo(() => {
    const byTbl = new Map()
    for (const b of batches) {
      if (b.restored) continue
      byTbl.set(b.tbl, (byTbl.get(b.tbl) || 0) + (Number(b.rows) || 0))
    }
    return [...byTbl.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [batches])

  const removedTotal = removedBars.reduce((a, b) => a + b.value, 0)

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><CopyX size={18} className="text-orange-400" /> Duplicate Control</h1>
          <p className="text-xs text-gray-500 mt-1">
            Find and remove rows that got imported twice, and see where each file should be uploaded.
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
      </header>

      <Segmented value={tab} onChange={setTab} options={[
        { key: 'duplicates', label: <span className="inline-flex items-center gap-1.5"><CopyX size={13} /> Duplicates</span>, count: openBatches.length || undefined, hint: 'Removals still undoable' },
        { key: 'import', label: <span className="inline-flex items-center gap-1.5"><Upload size={13} /> Where to import</span>, count: IMPORT_TARGETS.length },
      ]} />

      <ErrorState message={loadError} onRetry={load} />

      {tab === 'import' ? (
        <ImportReference />
      ) : (
        <>
          <Note icon={ShieldCheck} tone="accent">
            Nothing is removed until you confirm. Every removed row is kept in full and can be
            put back with one click. Rows that repeat because the source file genuinely repeats
            them are protected and can never be removed here.
          </Note>

          {loading && !targets.length ? (
            <LoadingState label="Loading duplicate targets" />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile label="Tables checked" value={fmtNum(targets.length)} icon={Database} />
                <StatTile label="Money tables" value={fmtNum(targets.filter((t) => t.kind === 'money').length)}
                  sub="Duplicates here inflate spend" tone="warning" />
                <StatTile label="Removals undoable" value={fmtNum(openBatches.length)} icon={Undo2}
                  sub={`${fmtNum(removedTotal)} rows held in the archive`} />
                <StatTile label="Removals put back" value={fmtNum(batches.length - openBatches.length)} tone="muted" />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel flush>
                  <div className="px-4 pt-4"><PanelHeader icon={Database} title="What to check" subtitle="Pick a table to look for rows imported twice." /></div>
                  <div className="max-h-[520px] overflow-y-auto px-4 pb-4">
                    {targets.length === 0 ? (
                      <EmptyState title="No targets available."
                        reason={loadError ? 'The target list could not be read.' : 'The server returned no tables to check.'} />
                    ) : (
                      <Table>
                        <THead><Th>Target</Th><Th>Table</Th><Th>Flags</Th></THead>
                        <tbody>
                          {targets.map((t) => {
                            const active = selected?.key === t.key
                            return (
                              <Tr key={t.key} onClick={() => selectTarget(t)} className={active ? 'bg-orange-950/20' : ''}>
                                <Td><span className={active ? 'text-orange-200 font-medium' : 'text-gray-200'}>{t.label}</span></Td>
                                <Td><Code>{t.tbl}</Code></Td>
                                <Td>
                                  <span className="inline-flex flex-wrap gap-1">
                                    {t.kind === 'money' && <Badge tone="warning">Affects money</Badge>}
                                    {!t.has_source_row && (
                                      <Badge tone="quiet" title="No line-number column, so repeats cannot be told apart">No line numbers</Badge>
                                    )}
                                  </span>
                                </Td>
                              </Tr>
                            )
                          })}
                        </tbody>
                      </Table>
                    )}
                  </div>
                </Panel>

                <Panel>
                  {!selected ? (
                    <EmptyState icon={Search} title="Pick something on the left to check for duplicates."
                      reason="Nothing is scanned or removed until you choose a table." />
                  ) : (
                    <div className="space-y-4">
                      <PanelHeader icon={CopyX} title={selected.label} subtitle={selected.tbl} />

                      <div>
                        <p className="text-[11px] font-semibold text-gray-400 mb-1.5">Country</p>
                        <Segmented value={country} onChange={selectCountry}
                          options={['', ...COUNTRIES].map((c) => ({ key: c, label: c || 'All countries' }))} />
                      </div>

                      <Btn icon={Search} onClick={() => runPreview()} busy={busy}>Check for duplicates</Btn>

                      <ErrorState message={error} />

                      {preview && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <StatTile label="Can be removed" value={fmtNum(deletable)} tone={deletable ? 'warning' : 'default'} />
                            <StatTile label="Protected (genuine)" value={fmtNum(protectedRows)} tone={protectedRows ? 'good' : 'default'} />
                          </div>
                          {(deletable + protectedRows) > 0 && (
                            <div className="space-y-1">
                              <ProportionBar segments={[
                                { label: 'Can be removed', value: deletable, tone: 'warning' },
                                { label: 'Protected', value: protectedRows, tone: 'good' },
                              ]} />
                              <p className="text-[10px] text-gray-600">Share of repeated rows that are import mistakes versus genuine repeats.</p>
                            </div>
                          )}
                          {/* Each country keeps its own currency (SAR / AED / EGP), so a
                              single figure across all of them would be meaningless. Show
                              the amount only when one country is selected. */}
                          {selected.kind === 'money' && deletable > 0 && (
                            <Note icon={AlertTriangle} tone="warning">
                              {country
                                ? `These rows are inflating reported ${country} spend by `
                                  + `${fmtMoney(money)} ${CURRENCY[country] || ''}. Removing them `
                                  + 'lowers the reported total by that amount, which is the correction.'
                                : 'These rows are inflating reported spend. Pick a single country '
                                  + 'to see the amount: each country keeps its own currency, so a '
                                  + 'combined figure would be meaningless.'}
                            </Note>
                          )}
                          <p className="text-[11px] text-gray-400">{previewSummary(preview)}</p>

                          {protectedRows > 0 && deletable === 0 && (
                            <Note icon={Lock}>
                              Every repeat here comes from a different line of the source file, so
                              these are real records, not import mistakes. Nothing to remove.
                            </Note>
                          )}

                          {deletable > 0 && (
                            <Btn variant="danger" icon={CopyX} disabled={busy}
                              onClick={() => { setConfirmOpen(true); setConfirmText('') }}>
                              Remove {fmtNum(deletable)} extra row(s)
                            </Btn>
                          )}
                        </div>
                      )}

                      {result && (
                        <Note icon={CheckCircle2} tone="accent">
                          {result.restored != null
                            ? `Put back ${fmtNum(result.restored)} row(s) into ${result.tbl}.`
                            : `Removed ${fmtNum(result.deleted)} row(s). You can undo this below.`}
                        </Note>
                      )}

                      {groups.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold text-gray-400 mb-1.5">Groups found (showing up to 100)</p>
                          <div className="max-h-64 overflow-y-auto">
                            <Table>
                              <THead><Th>Business key</Th><Th align="right">Copies</Th><Th>Verdict</Th></THead>
                              <tbody>
                                {groups.map((g, i) => (
                                  <Tr key={i}>
                                    <Td><span className="block max-w-[260px] truncate text-gray-400" title={g.bkey}>{g.bkey}</span></Td>
                                    <Td align="right"><span className="tabular-nums text-gray-300">{fmtNum(g.copies)}</span></Td>
                                    <Td>
                                      {g.verdict === 'genuine'
                                        ? <Badge tone="good" icon={Lock}>Protected</Badge>
                                        : <Badge tone="warning">Duplicate</Badge>}
                                    </Td>
                                  </Tr>
                                ))}
                              </tbody>
                            </Table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Panel>
              </div>

              {removedBars.length > 0 && (
                <Panel>
                  <PanelHeader icon={BarChart3} title="Rows removed per table"
                    subtitle="From the removal history, excluding batches already put back. A row count, so it is comparable across countries." />
                  <BarsChart bars={removedBars} valueFormat={(v) => `${fmtNum(v)} rows`}
                    summary={removedBars.map((b) => `${b.label}: ${b.value}`).join(', ')} />
                </Panel>
              )}

              <Panel flush>
                <div className="px-4 pt-4">
                  <PanelHeader icon={Undo2} title="Removal history" subtitle="Every removal stays undoable." />
                </div>
                {batches.length === 0 ? (
                  <EmptyState icon={Undo2} title="Nothing has been removed yet."
                    reason="Removals made on this page are listed here with an undo button." />
                ) : (
                  <div className="max-h-72 overflow-y-auto px-4 pb-4">
                    <Table>
                      <THead><Th>When</Th><Th>Table</Th><Th>Country</Th><Th align="right">Rows</Th><Th align="right">Action</Th></THead>
                      <tbody>
                        {batches.map((b) => (
                          <Tr key={b.batch_id}>
                            <Td nowrap><span className="text-gray-400">{fmtTime(b.created_at)}</span></Td>
                            <Td><Code>{b.tbl}</Code></Td>
                            <Td><span className="text-gray-400">{b.country || 'All'}</span></Td>
                            <Td align="right"><span className="tabular-nums text-gray-300">{fmtNum(b.rows)}</span></Td>
                            <Td align="right">
                              {b.restored
                                ? <Badge tone="good" icon={CheckCircle2}>Put back</Badge>
                                : <Btn size="xs" icon={Undo2} onClick={() => doRestore(b.batch_id)} disabled={busy}>Undo</Btn>}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </Panel>

              {openBatches.length > 0 && (
                <p className="text-[10px] text-gray-600 flex items-center gap-1">
                  <Info size={10} /> {openBatches.length} removal(s) can still be undone.
                </p>
              )}
            </>
          )}
        </>
      )}

      <Modal open={confirmOpen && !!selected} onClose={closeConfirm} width="max-w-md"
        title="Remove duplicate rows" subtitle={selected?.tbl}
        footer={(
          <>
            <Btn onClick={closeConfirm} disabled={busy}>Cancel</Btn>
            <Btn variant="danger" icon={CopyX} onClick={doRemove} busy={busy}
              disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD}>Remove</Btn>
          </>
        )}>
        {selected && (
          <div className="space-y-4">
            <p className="text-xs text-gray-300 leading-relaxed">
              This removes {fmtNum(deletable)} extra row(s) from {selected.tbl}
              {country ? ` for ${country}` : ''}, keeping the first copy of each.
              {selected.kind === 'money' && deletable > 0 && country
                && ` Reported ${country} spend will drop by ${fmtMoney(money)} `
                   + `${CURRENCY[country] || ''}, which is the correction.`}
              {' '}Every removed row is saved and can be put back from the removal history.
            </p>
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-400 mb-1.5">Type {CONFIRM_WORD} to confirm</span>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doRemove() }}
                autoFocus placeholder={CONFIRM_WORD}
                className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:border-red-700 focus:outline-none" />
            </label>
            <ErrorState message={error} />
          </div>
        )}
      </Modal>
    </div>
  )
}

/** Headers for the reference export, in the key order of importTargetRows(). */
const REFERENCE_HEADERS = ['Import into table', 'What it is', 'Ends up in', 'Source file', 'Add country column',
  'Headers must match exactly', 'Safe to upload twice', 'Columns', 'Notes']

function ImportReference() {
  const [err, setErr] = useState('')

  async function download() {
    setErr('')
    try {
      const rows = importTargetRows()
      const keys = Object.keys(rows[0] || {})
      await exportToExcel(rows, keys, REFERENCE_HEADERS.slice(0, keys.length),
        reportFileName('TyrePulse Import Reference'))
    } catch (e) {
      setErr(toUserMessage(e, 'Could not export the reference.'))
    }
  }

  /**
   * The blank workbook: one sheet per destination table, headers already the
   * exact column names, so a filled sheet imports with nothing to map. Built
   * from the same IMPORT_TARGETS the table below renders, so it cannot drift.
   */
  async function downloadTemplates() {
    setErr('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      for (const { name, rows } of uploadWorkbookSheets()) {
        const ws = XLSX.utils.aoa_to_sheet(rows)
        const widest = rows.reduce((w, r) => Math.max(w, r.length), 0)
        ws['!cols'] = Array.from({ length: widest }, (_, i) => {
          const longest = rows.reduce((w, r) => Math.max(w, String(r[i] ?? '').length), 0)
          return { wch: Math.max(14, Math.min(34, longest + 4)) }
        })
        XLSX.utils.book_append_sheet(wb, ws, name)
      }
      XLSX.writeFile(wb, `${reportFileName('TyrePulse Upload Workbook')}.xlsx`)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not build the upload workbook.'))
    }
  }

  const needsKey = IMPORT_TARGETS.filter((t) => t.reimportSafe !== 'safe')

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <Note icon={Info}>
            Import into the table named below using Supabase Table Editor, Import data from CSV.
            These tables always look empty afterwards on purpose: each one maps and forwards the
            rows into the live table, then clears itself.
          </Note>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="primary" icon={Download} onClick={downloadTemplates}
            title="A blank workbook, one sheet per table, headers already correct">Blank upload workbook</Btn>
          <Btn icon={Download} onClick={download}>This reference</Btn>
        </div>
      </div>

      <ErrorState message={err} />

      <Note icon={AlertTriangle} tone="warning">
        Most tables below are safe to upload twice. {needsKey.length > 0
          ? `${needsKey.map((t) => t.table).join(', ')} only stays safe when the ERP line number column is mapped; without it a re-upload adds the rows again, so come back to the Duplicates tab and check.`
          : 'Every table here is safe to upload twice.'}
      </Note>

      <div className="space-y-3">
        {IMPORT_TARGETS.map((t) => (
          <Panel key={t.table}>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
              <div>
                <p className="text-xs font-semibold text-orange-300 font-mono">{t.table}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{t.label}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge>Ends up in {t.feeds}</Badge>
                {t.needsCountry ? <Badge tone="warning">Add a country column</Badge>
                  : <Badge tone="info">Country from table name</Badge>}
                {t.verbatimHeaders && <Badge tone="warning">Headers must match exactly</Badge>}
                {t.reimportSafe === 'safe'
                  ? <Badge tone="good">Safe to upload twice</Badge>
                  : <Badge tone="danger">Needs line numbers to re-upload</Badge>}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] text-gray-500">
                <span className="text-gray-400 font-semibold">Source file:</span> {t.sourceFile}
              </p>
              <div>
                <p className="text-[10px] text-gray-400 font-semibold mb-1">Columns</p>
                <div className="flex flex-wrap gap-1">
                  {t.columns.map((c) => <Code key={c}>{c}</Code>)}
                </div>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">{t.notes}</p>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  )
}
