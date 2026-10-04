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
 * Control Center round 2 added: the status strip, a "scan every table" pass
 * (one preview per table for the chosen country, nothing removed), a required
 * reason on every removal and every undo (sent to the server and the console
 * audit), and a plain impact line under each control.
 *
 * No raw SQL, no em/en dashes. Super-admin only (the whole /console is gated).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CopyX, AlertTriangle, ShieldCheck, Database, Undo2, Search,
  Upload, Download, Info, Lock, CheckCircle2, BarChart3, History, ArrowRight, SearchCheck,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Code, Btn, Segmented, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ConfirmImpactDialog,
} from '../components/ui'
import { BarsChart } from '../components/ui/charts'
import {
  listDuplicateTargets, previewDuplicates, scanDuplicates, resolveDuplicates,
  restoreDuplicateBatch, listDuplicateBatches, previewSummary,
} from '../../lib/api/duplicateControl'
import { IMPORT_TARGETS, importTargetRows, uploadWorkbookSheets } from '../../lib/importTargets'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import { searchRows, sortRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, TabBar, useUrlTab, usePager, Pager, Section, AttentionList } from './shared/pageKit'
import { StatusStrip, ImpactLine } from './dataOps/DataOpsParts'
import { scanAllSummary } from '../../lib/dataOpsCenter'

const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const CONFIRM_WORD = 'REMOVE'

/** Each country reports in its own currency; totals are never blended across them. */
const CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

const fmtNum = (n) => (n !== null && n !== undefined && Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A')
const fmtMoney = (n) => (Number.isFinite(Number(n))
  ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
  : 'N/A')
const TAB_KEYS = ['duplicates', 'history', 'import']
const HISTORY_COLUMNS = [
  { key: 'created_at', header: 'When', value: (b) => fmtTime(b.created_at) },
  { key: 'tbl', header: 'Table' },
  { key: 'country', header: 'Country', value: (b) => b.country || 'All' },
  { key: 'rows', header: 'Rows', value: (b) => Number(b.rows) || 0 },
  { key: 'state', header: 'State', value: (b) => (b.restored ? 'Put back' : 'Removed, undoable') },
]
const GROUP_COLUMNS = [
  { key: 'bkey', header: 'Business key' },
  { key: 'copies', header: 'Copies', value: (g) => Number(g.copies) || 0 },
  { key: 'verdict', header: 'Verdict', value: (g) => (g.verdict === 'genuine' ? 'Protected' : 'Duplicate') },
]
const fmtTime = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 16).replace('T', ' ')
}

export default function ConsoleDuplicateControl({ tabParam = 'tab' } = {}) {
  const { logAction } = useConsoleAuth()
  const [tab, setTab] = useUrlTab(TAB_KEYS, 'duplicates', tabParam)
  const [refreshedAt, setRefreshedAt] = useState(null)
  const [targetQuery, setTargetQuery] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyState, setHistoryState] = useState('')

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
  const [result, setResult] = useState(null)
  const [batches, setBatches] = useState([])
  const [restoreFor, setRestoreFor] = useState(null)   // batch waiting for an undo confirmation
  const [scanAll, setScanAll] = useState(null)         // scanAllSummary result
  const [scanning, setScanning] = useState(false)
  const [scanCountry, setScanCountry] = useState('KSA')

  // Each check is numbered so a slow answer for the previous target or country
  // can never land under the one now on screen.
  const reqSeq = useRef(0)

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const [t, b] = await Promise.all([listDuplicateTargets(), listDuplicateBatches()])
      setTargets(t); setBatches(b)
      setRefreshedAt(Date.now())
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

  async function doRemove({ reason } = {}) {
    if (busy || !selected) return
    setBusy(true); setError('')
    try {
      const r = await resolveDuplicates(selected.key, country || null,
        `Removed via Console Duplicate Control (${selected.tbl}): ${reason || 'no reason given'}`)
      setConfirmOpen(false)
      logAction?.('duplicate_resolve', r?.batch_id, selected.tbl,
        { deleted: r?.deleted, country: country || 'all', reason: reason || null })
      await Promise.all([runPreview(), listDuplicateBatches().then(setBatches)])
      // Set after the refresh: runPreview clears `result` when it starts.
      setResult(r)
    } catch (e) {
      setError(toUserMessage(e, 'Could not remove the duplicates.'))
    } finally {
      setBusy(false)
    }
  }

  async function doRestore(batchId, reason = null) {
    setBusy(true); setError('')
    try {
      const r = await restoreDuplicateBatch(batchId)
      setRestoreFor(null)
      logAction?.('duplicate_restore', batchId, r?.tbl, { restored: r?.restored, reason })
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
    setConfirmOpen(false)
  }

  // Scan every table for one country: previews only, nothing is removed.
  async function runScanAll() {
    setScanning(true); setError('')
    const results = []
    for (const t of targets) {
      try {
        results.push({ target: t, preview: await previewDuplicates(t.key, scanCountry || null) })
      } catch (e) {
        results.push({ target: t, error: toUserMessage(e, 'Could not check this table.') })
      }
    }
    const sum = scanAllSummary(results, scanCountry || null)
    setScanAll({ ...sum, country: scanCountry || null, at: Date.now() })
    setScanning(false)
    logAction?.('duplicate_scan_all', null, 'duplicates', { country: scanCountry || 'all', rows: sum.deletable })
  }

  const deletable = Number(preview?.extra_deletable) || 0
  const protectedRows = Number(preview?.extra_protected) || 0
  const money = Number(preview?.money_deletable) || 0

  const openBatches = useMemo(() => batches.filter((b) => !b.restored), [batches])
  const groupSort = useTableSort({ key: 'copies', dir: 'desc' })
  const sortedGroups = useMemo(() => sortRows(groups, groupSort.sort,
    { copies: (g) => Number(g.copies) || 0, verdict: (g) => (g.verdict === 'genuine' ? 1 : 0) }), [groups, groupSort.sort])
  const groupPager = usePager(sortedGroups, 25)
  const batchSort = useTableSort({ key: 'created_at', dir: 'desc' })
  const shownBatches = useMemo(() => {
    const base = searchRows(batches, historyQuery, ['tbl', 'country'])
      .filter((b) => !historyState || (historyState === 'open' ? !b.restored : b.restored))
    return sortRows(base, batchSort.sort, { restored: (b) => (b.restored ? 1 : 0), rows: (b) => Number(b.rows) || 0 })
  }, [batches, historyQuery, historyState, batchSort.sort])
  const batchPager = usePager(shownBatches, 25)
  const targetSort = useTableSort(null)
  const shownTargets = useMemo(() => {
    const base = searchRows(targets, targetQuery, ['label', 'tbl'])
    return targetSort.sort ? sortRows(base, targetSort.sort, { kind: (t) => (t.kind === 'money' ? 0 : 1) }) : base
  }, [targets, targetQuery, targetSort.sort])

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
  const lastRemoval = batches.reduce((m, b) => (b.created_at && (!m || b.created_at > m) ? b.created_at : m), null)
  const dash = loadError ? 'N/A' : loading && !targets.length ? '...' : null
  const strip = [
    { label: 'Tables checked', value: dash || fmtNum(targets.length) },
    { label: 'Money tables', value: dash || fmtNum(targets.filter((t) => t.kind === 'money').length) },
    { label: 'Without line numbers', value: dash || fmtNum(targets.filter((t) => !t.has_source_row).length), sub: 'Repeats cannot be told apart' },
    { label: 'Extra rows found', value: scanAll ? fmtNum(scanAll.deletable) : 'Not scanned', sub: scanAll ? `${scanAll.country || 'All countries'}, ${fmtNum(scanAll.tablesWithDuplicates)} tables` : 'Use Scan every table', tone: scanAll?.deletable ? 'warning' : undefined },
    { label: 'Removals undoable', value: dash || fmtNum(openBatches.length) },
    { label: 'Rows in archive', value: dash || fmtNum(removedTotal) },
    { label: 'Last removal', value: dash || (lastRemoval ? fmtTime(lastRemoval).slice(0, 10) : 'Never') },
    { label: 'Import tables', value: fmtNum(IMPORT_TARGETS.length) },
  ]

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={CopyX} title="Duplicate Control"
        purpose="Find and remove rows that got imported twice, and see where each file should be uploaded."
        refreshedAt={refreshedAt} onRefresh={load} refreshing={loading} />

      <StatusStrip label="Duplicate control status" cells={strip} />

      <TabBar ariaLabel="Duplicate control view" value={tab} onChange={setTab} tabs={[
        { key: 'duplicates', label: 'Duplicates', icon: CopyX },
        { key: 'history', label: 'Removal history', icon: History, count: openBatches.length || undefined, hint: 'Removals still undoable' },
        { key: 'import', label: 'Where to import', icon: Upload, count: IMPORT_TARGETS.length },
      ]} />

      <ErrorState message={loadError} onRetry={load} />

      {tab === 'import' ? (
        <ImportReference />
      ) : tab === 'history' ? (
        <HistoryTab loading={loading} loadError={loadError} batches={batches} shownBatches={shownBatches}
          pager={batchPager} sort={batchSort.sort} onSort={batchSort.onSort} busy={busy}
          query={historyQuery} onQuery={setHistoryQuery} state={historyState} onState={setHistoryState}
          removedBars={removedBars} openCount={openBatches.length} onRestore={(id) => setRestoreFor(batches.find((b) => b.batch_id === id) || { batch_id: id })} result={result} error={error} />
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
                  sub={`${fmtNum(removedTotal)} rows held in the archive`}
                  onClick={() => { setHistoryState('open'); setTab('history') }} />
                <StatTile label="Removals put back" value={fmtNum(batches.length - openBatches.length)} tone="muted"
                  onClick={() => { setHistoryState('restored'); setTab('history') }} />
              </div>

              <Panel>
                <PanelHeader icon={SearchCheck} title="Scan every table"
                  subtitle="One preview per table for the country you pick, so you see where the extra rows are before choosing a table."
                  actions={(
                    <span className="flex flex-wrap items-center gap-2">
                      <Segmented ariaLabel="Country to scan" role="group" value={scanCountry} onChange={setScanCountry}
                        options={['', ...COUNTRIES].map((c) => ({ key: c, label: c || 'All countries' }))} />
                      <Btn icon={SearchCheck} onClick={runScanAll} busy={scanning} disabled={!targets.length}>Scan every table</Btn>
                    </span>
                  )} />
                <ImpactLine change="Nothing. Each table is counted with the same check the remove button uses." who="Nobody. The scan is recorded in the console audit." />
                {scanAll && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] text-gray-400" aria-live="polite">
                      {scanAll.country || 'All countries'}: {fmtNum(scanAll.deletable)} extra rows can be removed across {fmtNum(scanAll.tablesWithDuplicates)} of {fmtNum(scanAll.tablesScanned)} tables;
                      {' '}{fmtNum(scanAll.protectedRows)} repeated rows are protected.
                      {scanAll.money != null && scanAll.money > 0 ? ` Money tables carry ${fmtMoney(scanAll.money)} ${scanAll.currency || ''} of duplicate spend.` : ''}
                      {scanAll.country ? '' : ' Pick one country to see money: currencies are never added together.'}
                      {scanAll.tablesFailed ? ` ${fmtNum(scanAll.tablesFailed)} tables could not be checked.` : ''}
                    </p>
                    <Table>
                      <THead><Th>Table</Th><Th align="right">Can be removed</Th><Th align="right">Protected</Th><Th align="right">Money</Th><Th align="right">Action</Th></THead>
                      <tbody>
                        {scanAll.rows.map((r) => (
                          <Tr key={r.key} tone={r.deletable ? 'warning' : undefined}>
                            <Td><span className="text-gray-200">{r.label}</span> <Code>{r.tbl}</Code></Td>
                            <Td align="right"><span className="tabular-nums">{r.error ? 'N/A' : fmtNum(r.deletable)}</span></Td>
                            <Td align="right"><span className="tabular-nums text-gray-400">{r.error ? 'N/A' : fmtNum(r.protectedRows)}</span></Td>
                            <Td align="right"><span className="tabular-nums text-gray-400">{r.money != null ? `${fmtMoney(r.money)} ${r.currency || ''}` : 'N/A'}</span></Td>
                            <Td align="right">
                              <Btn size="xs" icon={ArrowRight} disabled={!r.deletable}
                                onClick={() => { const t = targets.find((x) => x.key === r.key); if (t) { selectTarget(t); selectCountry(scanAll.country || ''); runPreview(t, scanAll.country || '') } }}>Open</Btn>
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel flush>
                  <div className="px-4 pt-4">
                    <PanelHeader icon={Database} title="What to check" subtitle="Pick a table to look for rows imported twice." />
                    <SearchInput value={targetQuery} onChange={setTargetQuery} placeholder="Search tables" className="mb-3 w-full sm:w-56" />
                  </div>
                  <div className="max-h-[520px] overflow-y-auto px-4 pb-4">
                    {targets.length === 0 ? (
                      <EmptyState title="No targets available."
                        reason={loadError ? 'The target list could not be read.' : 'The server returned no tables to check.'} />
                    ) : (
                      <Table>
                        <THead>
                          <Th sortKey="label" sort={targetSort.sort} onSort={targetSort.onSort}>Target</Th>
                          <Th sortKey="tbl" sort={targetSort.sort} onSort={targetSort.onSort}>Table</Th>
                          <Th sortKey="kind" sort={targetSort.sort} onSort={targetSort.onSort}>Flags</Th>
                        </THead>
                        <tbody>
                          {shownTargets.length === 0 && (
                            <tr><Td colSpan={3}><span className="text-gray-400">No table matches that search.</span></Td></tr>
                          )}
                          {shownTargets.map((t) => {
                            const active = selected?.key === t.key
                            return (
                              <Tr key={t.key} onClick={() => selectTarget(t)} className={active ? 'bg-orange-950/20' : ''}>
                                <Td><button type="button" aria-pressed={active} onClick={(e) => { e.stopPropagation(); selectTarget(t) }} className={`text-left break-words ${active ? 'text-orange-200 font-medium' : 'text-gray-200 hover:text-orange-300'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded`}>{t.label}</button></Td>
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
                        <Segmented ariaLabel="Country" role="group" value={country} onChange={selectCountry}
                          options={['', ...COUNTRIES].map((c) => ({ key: c, label: c || 'All countries' }))} />
                      </div>

                      <Btn icon={Search} onClick={() => runPreview()} busy={busy}>Check for duplicates</Btn>
                      <ImpactLine change="Checking only counts and lists groups. Removing keeps the first copy of each group and archives every other copy in full."
                        who={selected.kind === 'money' ? 'Spend reports for the chosen country drop by the duplicate amount, which is the correction.' : 'Anyone reading this table sees one row where there were several.'}
                        undo="Removal history tab, one click per batch." />

                      <ErrorState message={error} />

                      {preview && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <StatTile label="Can be removed" value={fmtNum(deletable)} tone={deletable ? 'warning' : 'default'} />
                            <StatTile label="Protected (genuine)" value={fmtNum(protectedRows)} tone={protectedRows ? 'good' : 'default'} />
                          </div>
                          {(deletable + protectedRows) > 0 && (
                            <div className="space-y-1">
                              <ProportionBar segments={[
                                { label: 'Can be removed', value: deletable, tone: 'warning' },
                                { label: 'Protected', value: protectedRows, tone: 'good' },
                              ]} />
                              <p className="text-[10px] text-gray-400">Share of repeated rows that are import mistakes versus genuine repeats.</p>
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
                              onClick={() => setConfirmOpen(true)}>
                              Remove {fmtNum(deletable)} extra row(s)
                            </Btn>
                          )}
                        </div>
                      )}

                      {result && (
                        <Note icon={CheckCircle2} tone="accent">
                          {result.restored != null
                            ? `Put back ${fmtNum(result.restored)} row(s) into ${result.tbl}.`
                            : `Removed ${fmtNum(result.deleted)} row(s). You can undo this from the Removal history tab.`}
                        </Note>
                      )}

                      {groups.length > 0 && (
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                            <p className="text-[11px] font-semibold text-gray-400">Groups found (up to 100 read)</p>
                            <span className="flex gap-2"><ExportButtons rows={sortedGroups} columns={GROUP_COLUMNS} title={`TyrePulse Duplicate Groups ${selected.tbl}`} /></span>
                          </div>
                          <div>
                            <Table>
                              <THead>
                                <Th sortKey="bkey" sort={groupSort.sort} onSort={groupSort.onSort}>Business key</Th>
                                <Th sortKey="copies" sort={groupSort.sort} onSort={groupSort.onSort} align="right">Copies</Th>
                                <Th sortKey="verdict" sort={groupSort.sort} onSort={groupSort.onSort}>Verdict</Th>
                              </THead>
                              <tbody>
                                {groupPager.pageRows.map((g, i) => (
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
                            <Pager pager={groupPager} label="groups" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Panel>
              </div>

              {openBatches.length > 0 && (
                <AttentionList quiet title="Undo window" items={[{
                  key: 'undo', tone: 'info',
                  title: `${fmtNum(openBatches.length)} removal(s) can still be undone`,
                  detail: `${fmtNum(removedTotal)} rows are held in the archive and can be put back.`,
                  action: () => { setHistoryState('open'); setTab('history') }, actionLabel: 'Review', actionIcon: ArrowRight,
                }]} />
              )}
            </>
          )}
        </>
      )}

      <ConfirmImpactDialog open={confirmOpen && !!selected} onCancel={closeConfirm} onConfirm={doRemove}
        danger title="Remove duplicate rows" confirmLabel="Remove" typedWord={CONFIRM_WORD} requireReason busy={busy} error={error}
        impact={selected ? {
          tone: 'danger',
          what: `Remove ${fmtNum(deletable)} extra row(s) from ${selected.tbl}${country ? ` for ${country}` : ''}, keeping the first copy of each.`,
          change: selected.kind === 'money' && country
            ? `Reported ${country} spend drops by ${fmtMoney(money)} ${CURRENCY[country] || ''}, which is the correction.`
            : 'The extra copies leave the live table. Protected (genuine) repeats are never touched.',
          who: 'Everyone who reads this table, in every report and export.',
          undo: 'Yes. Every removed row is archived in full and can be put back from the Removal history tab.',
          stats: [
            { label: 'Rows removed', value: fmtNum(deletable) },
            { label: 'Protected, kept', value: fmtNum(protectedRows) },
            { label: 'Country', value: country || 'All' },
          ],
        } : null} />

      <ConfirmImpactDialog open={!!restoreFor} onCancel={() => { if (!busy) setRestoreFor(null) }}
        onConfirm={({ reason }) => doRestore(restoreFor.batch_id, reason)}
        title="Undo this removal" confirmLabel="Put rows back" requireReason busy={busy} error={error}
        impact={restoreFor ? {
          tone: 'warning',
          what: `Put ${fmtNum(restoreFor.rows)} archived row(s) back into ${restoreFor.tbl || 'their table'}${restoreFor.country ? ` for ${restoreFor.country}` : ''}.`,
          change: 'The removed copies return to the live table. If they were duplicates, reported totals go back up by their amount.',
          who: 'Everyone who reads this table.',
          undo: 'Remove them again from the Duplicates tab.',
        } : null} />
    </div>
  )
}

function HistoryTab({ loading, loadError, batches, shownBatches, pager, sort, onSort, busy, query, onQuery, state, onState, removedBars, openCount, onRestore, result, error }) {
  if (loading && !batches.length) return <LoadingState label="Loading the removal history" />
  return (
    <div className="space-y-4">
      <ErrorState message={error} />
      {result && result.restored != null && (
        <Note icon={CheckCircle2} tone="accent">Put back {fmtNum(result.restored)} row(s) into {result.tbl}.</Note>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel flush className="lg:col-span-2">
          <div className="px-4 pt-4">
            <PanelHeader icon={Undo2} title="Removal history" subtitle="Every removal stays undoable."
              actions={<ExportButtons rows={shownBatches} columns={HISTORY_COLUMNS} title="TyrePulse Duplicate Removals" disabled={!!loadError} />} />
            <ImpactLine className="mb-3" change="Undo puts the archived copies of that batch back into the live table." who="Everyone who reads that table; totals rise by the restored rows." undo="Remove them again from the Duplicates tab." />
            <Toolbar className="mb-3">
              <SearchInput value={query} onChange={onQuery} placeholder="Search table or country" className="w-full sm:w-56" />
              <Segmented role="group" ariaLabel="Removal state" value={state} onChange={onState} options={[
                { key: '', label: 'All', count: batches.length },
                { key: 'open', label: 'Undoable', count: openCount },
                { key: 'restored', label: 'Put back', count: batches.length - openCount },
              ]} />
            </Toolbar>
          </div>
          {batches.length === 0 ? (
            loadError ? (
              <p className="px-4 pb-4 text-xs text-gray-400">The removal history could not be read, so it is not shown. Use Retry above.</p>
            ) : (
              <EmptyState icon={Undo2} title="Nothing has been removed yet."
                reason="Removals made on the Duplicates tab are listed here with an undo button." />
            )
          ) : shownBatches.length === 0 ? (
            <EmptyState title="No removal matches these filters" reason="Clear the search or the state filter." />
          ) : (
            <div className="px-4 pb-4">
              <Table>
                <THead>
                  <Th sortKey="created_at" sort={sort} onSort={onSort}>When</Th>
                  <Th sortKey="tbl" sort={sort} onSort={onSort}>Table</Th>
                  <Th sortKey="country" sort={sort} onSort={onSort}>Country</Th>
                  <Th sortKey="rows" sort={sort} onSort={onSort} align="right">Rows</Th>
                  <Th sortKey="restored" sort={sort} onSort={onSort} align="right">Action</Th>
                </THead>
                <tbody>
                  {pager.pageRows.map((b) => (
                    <Tr key={b.batch_id}>
                      <Td nowrap><span className="text-gray-400">{fmtTime(b.created_at)}</span></Td>
                      <Td><Code>{b.tbl}</Code></Td>
                      <Td><span className="text-gray-400">{b.country || 'All'}</span></Td>
                      <Td align="right"><span className="tabular-nums text-gray-300">{fmtNum(b.rows)}</span></Td>
                      <Td align="right">
                        {b.restored
                          ? <Badge tone="good" icon={CheckCircle2}>Put back</Badge>
                          : <Btn size="xs" icon={Undo2} onClick={() => onRestore(b.batch_id)} disabled={busy} title={`Undo removal of ${fmtNum(b.rows)} rows from ${b.tbl}`}>Undo</Btn>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pager pager={pager} label="removals" />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHeader icon={BarChart3} title="Rows removed per table"
            subtitle="Excluding batches already put back. A row count, so it is comparable across countries." />
          <BarsChart bars={removedBars} valueFormat={(v) => `${fmtNum(v)} rows`}
            summary={removedBars.map((b) => `${b.label}: ${b.value}`).join(', ')}
            emptyText={loadError ? 'The removal history could not be read.' : 'Nothing is currently removed.'} />
        </Panel>
      </div>
    </div>
  )
}

/** Headers for the reference export, in the key order of importTargetRows(). */
const REFERENCE_HEADERS = ['Import into table', 'What it is', 'Ends up in', 'Source file', 'Add country column',
  'Headers must match exactly', 'Safe to upload twice', 'Columns', 'Notes']

function ImportReference() {
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const shown = useMemo(() => searchRows(IMPORT_TARGETS, q, ['table', 'label', 'feeds', 'sourceFile', (t) => t.columns.join(' ')]), [q])

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

      <SearchInput value={q} onChange={setQ} placeholder="Search tables, files or columns" className="w-full sm:w-72" />
      {shown.length === 0 && <EmptyState title="No import table matches that search" reason="Try a file name such as expenses or job cards." />}
      <div className="space-y-2">
        {shown.map((t) => (
          <Section key={t.table} icon={Database} title={<span className="font-mono text-orange-300">{t.table}</span>} subtitle={t.label}
            badge={t.reimportSafe === 'safe'
              ? <Badge tone="good">Safe to upload twice</Badge>
              : <Badge tone="danger">Needs line numbers to re-upload</Badge>}>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <Badge>Ends up in {t.feeds}</Badge>
              {t.needsCountry ? <Badge tone="warning">Add a country column</Badge>
                : <Badge tone="info">Country from table name</Badge>}
              {t.verbatimHeaders && <Badge tone="warning">Headers must match exactly</Badge>}
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
          </Section>
        ))}
      </div>
    </div>
  )
}
