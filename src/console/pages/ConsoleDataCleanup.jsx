/**
 * ConsoleDataCleanup - super-admin "clean old data" console (V289).
 *
 * Controlled deletion of OLD records, one target at a time, in plain English:
 *   1. A table of cleanup targets (logs + business data) with total rows and the
 *      oldest / newest date present.
 *   2. Pick a target, choose "older than" (age preset or a date), Preview the
 *      exact count that would be removed.
 *   3. Delete behind a typed CLEAN confirmation. The server takes a recovery
 *      SNAPSHOT first (recoverable from Console -> Backups) and logs every run.
 *
 * Business targets (accidents / tyres / inspections / work orders) are flagged
 * red with an extra warning; log targets are the safe default. No raw SQL, no
 * em/en dashes. Super-admin only (the whole /console is gated).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Trash2, RefreshCw, AlertTriangle, Info, Database, ShieldCheck, Eye, CheckCircle2, BarChart3,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, Table, THead, Th, Tr, Td,
  LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { BarsChart, STATUS, SERIES, useChartTheme } from '../components/ui/charts'
import {
  listCleanupTargets, previewCleanup, runCleanup, monthsAgoISO, AGE_PRESETS,
} from '../../lib/api/dataCleanup'
import { toUserMessage } from '../../lib/safeError'

const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 10)
}
const fmtNum = (n) => (n !== null && n !== undefined && Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A')
const CONFIRM_WORD = 'CLEAN'

export default function ConsoleDataCleanup() {
  const { logAction } = useConsoleAuth()
  const theme = useChartTheme()
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')

  const [selected, setSelected] = useState(null)   // target object
  const [before, setBefore] = useState(monthsAgoISO(24))
  const [preview, setPreview] = useState(null)      // { count } | null
  const [previewing, setPreviewing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)        // { deleted, snapshot } | null

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const rows = await listCleanupTargets()
      setTargets(rows)
      // Keep the selected target's totals current after a refresh or a run.
      setSelected((cur) => (cur ? rows.find((t) => t.key === cur.key) || cur : cur))
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not load cleanup targets.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function selectTarget(t) {
    setSelected(t); setPreview(null); setResult(null); setError('')
    setBefore(monthsAgoISO(24))
  }

  function changeCutoff(d) {
    setBefore(d); setPreview(null); setResult(null)
  }

  async function doPreview() {
    if (!selected) return
    setPreviewing(true); setPreview(null); setResult(null); setError('')
    try {
      setPreview(await previewCleanup(selected.key, before))
    } catch (e) {
      setError(toUserMessage(e, 'Could not preview.'))
    } finally {
      setPreviewing(false)
    }
  }

  async function doRun() {
    if (!selected) return
    setRunning(true); setError('')
    try {
      const res = await runCleanup(selected.key, before)
      setResult(res)
      setConfirmOpen(false); setConfirmText('')
      logAction?.('data_cleanup', null, selected.key, { before, deleted: res?.deleted })
      // Refresh totals so the table reflects the deletion.
      load()
      setPreview(null)
    } catch (e) {
      setError(toUserMessage(e, 'Could not run the cleanup.'))
    } finally {
      setRunning(false)
    }
  }

  function closeConfirm() {
    if (running) return
    setConfirmOpen(false)
  }

  const isBusiness = selected?.kind === 'business'

  const summary = useMemo(() => {
    const logs = targets.filter((t) => t.kind !== 'business')
    const biz = targets.filter((t) => t.kind === 'business')
    const sum = (arr) => arr.reduce((a, t) => a + (Number(t.total) || 0), 0)
    const oldest = targets.map((t) => t.oldest).filter(Boolean).sort()[0] || null
    return { logs: logs.length, biz: biz.length, logRows: sum(logs), bizRows: sum(biz), oldest }
  }, [targets])

  // Rows held per target: the size of what each cleanup could ever touch.
  // Business targets are drawn in the reserved "critical" status colour so the
  // chart repeats the table's warning rather than contradicting it.
  const bars = useMemo(() => [...targets]
    .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
    .map((t) => ({
      label: `${t.label}${t.kind === 'business' ? ' (business)' : ''}`,
      value: Number(t.total) || 0,
      color: t.kind === 'business' ? STATUS[theme].critical : SERIES[theme][1],
    })), [targets, theme])

  const confirmOk = confirmText.trim().toUpperCase() === CONFIRM_WORD
  const presetOptions = AGE_PRESETS.map((p) => ({ key: monthsAgoISO(p.months), label: p.label }))

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><Trash2 size={18} className="text-orange-400" /> Data Cleanup</h1>
          <p className="text-xs text-gray-500 mt-1">Delete old records you no longer need. A recovery snapshot is taken automatically before anything is removed.</p>
        </div>
        <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
      </header>

      <Note icon={ShieldCheck} tone="accent">
        Safe by design: pick a target, preview the exact number of old records, then confirm. The system snapshots the data first so a cleanup can be recovered from Backups, and every run is logged.
      </Note>

      {loadError && <ErrorState message={loadError} onRetry={load} />}

      {loading && !targets.length ? (
        <LoadingState label="Loading cleanup targets" />
      ) : !loadError && targets.length === 0 ? (
        <Panel>
          <EmptyState icon={Database} title="No cleanup targets are available."
            reason="The server returned an empty target list, so there is nothing this page can clean." />
        </Panel>
      ) : targets.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Log targets" value={fmtNum(summary.logs)} sub={`${fmtNum(summary.logRows)} rows held`} icon={Database} />
            <StatTile label="Business targets" value={fmtNum(summary.biz)} sub={`${fmtNum(summary.bizRows)} rows held`} tone={summary.biz ? 'warning' : 'default'} icon={AlertTriangle} />
            <StatTile label="Oldest record" value={fmtDate(summary.oldest)} sub="Across every target" />
            <StatTile label="Last run" value={result ? fmtNum(result.deleted) : 'N/A'}
              sub={result ? 'Records deleted this session' : 'No cleanup run this session'} tone={result ? 'good' : 'muted'} />
          </div>

          <Panel>
            <PanelHeader icon={BarChart3} title="Rows held per target"
              subtitle="Everything a cleanup of each target could ever touch. Business targets are marked. The preview below gives the exact count for a cutoff." />
            <BarsChart bars={bars} valueFormat={(v) => `${fmtNum(v)} rows`}
              summary={bars.map((b) => `${b.label}: ${b.value} rows`).join(', ')}
              emptyText="Every target is empty." />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel flush>
              <div className="px-4 pt-4"><PanelHeader icon={Database} title="Targets" subtitle="Select one to clean up." /></div>
              <div className="max-h-[520px] overflow-y-auto px-4 pb-4">
                <Table>
                  <THead>
                    <Th>Target</Th><Th>Kind</Th><Th align="right">Rows</Th><Th>Date range</Th>
                  </THead>
                  <tbody>
                    {targets.map((t) => {
                      const active = selected?.key === t.key
                      return (
                        <Tr key={t.key} onClick={() => selectTarget(t)} className={active ? 'bg-orange-950/20' : ''}>
                          <Td><button type="button" aria-pressed={active} onClick={(e) => { e.stopPropagation(); selectTarget(t) }} className={`text-left break-words ${active ? 'text-orange-200 font-medium' : 'text-gray-200 hover:text-orange-300'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded`}>{t.label}</button></Td>
                          <Td><Badge tone={t.kind === 'business' ? 'danger' : 'default'}>{t.kind === 'business' ? 'Business data' : 'Logs'}</Badge></Td>
                          <Td align="right" nowrap><span className="tabular-nums text-gray-300">{fmtNum(t.total)}</span></Td>
                          <Td nowrap><span className="text-gray-500">{fmtDate(t.oldest)} to {fmtDate(t.newest)}</span></Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
              </div>
            </Panel>

            <Panel tone={isBusiness ? 'danger' : undefined}>
              {!selected ? (
                <EmptyState icon={Trash2} title="Select a target to clean up."
                  reason="Nothing is previewed or deleted until you pick a target and confirm." />
              ) : (
                <div className="space-y-4">
                  <PanelHeader icon={Trash2} tone={isBusiness ? 'danger' : 'default'} title={selected.label}
                    subtitle={`${fmtNum(selected.total)} rows total, from ${fmtDate(selected.oldest)} to ${fmtDate(selected.newest)}.`} />

                  {isBusiness && (
                    <Note icon={AlertTriangle} tone="danger">
                      This is operational business data. Deleting removes those records permanently (recoverable only from the snapshot). Only clean data you are sure is no longer needed.
                    </Note>
                  )}

                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 mb-1.5">Delete records older than</p>
                    <div className="mb-2">
                      <Segmented ariaLabel="Age preset" role="group" options={presetOptions} value={before} onChange={changeCutoff} />
                    </div>
                    <input type="date" value={before} max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => changeCutoff(e.target.value)} aria-label="Cutoff date"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
                    <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                      <Info size={10} /> Cutoff {fmtDate(before)}. Records dated before this are removed; newer records are kept.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Btn icon={Eye} onClick={doPreview} busy={previewing} disabled={!before}>Preview</Btn>
                    <Btn variant="danger" icon={Trash2}
                      onClick={() => { setConfirmOpen(true); setConfirmText('') }}
                      disabled={!preview || Number(preview.count) === 0}>
                      Delete old records
                    </Btn>
                  </div>

                  <ErrorState message={error} />

                  {preview && (
                    <Note icon={Info} tone={Number(preview.count) > 0 ? 'warning' : 'default'}>
                      <span className="font-semibold">{fmtNum(preview.count)}</span> record(s) are older than {fmtDate(before)} and would be deleted.
                      {Number(preview.count) === 0 && <span className="block mt-0.5">Nothing to clean for this cutoff.</span>}
                    </Note>
                  )}

                  {result && (
                    <Note icon={CheckCircle2} tone="accent">
                      Deleted {fmtNum(result.deleted)} old record(s).{result.snapshot ? ' A recovery snapshot was saved to Backups.' : ''}
                    </Note>
                  )}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      <Modal open={confirmOpen && !!selected} onClose={closeConfirm} width="max-w-md"
        title="Confirm cleanup" subtitle="This cannot be undone here. Recovery is only from the Backups snapshot."
        footer={(
          <>
            <Btn onClick={closeConfirm} disabled={running}>Cancel</Btn>
            <Btn variant="danger" icon={Trash2} onClick={doRun} busy={running} disabled={!confirmOk}>
              {running ? 'Cleaning' : 'Delete permanently'}
            </Btn>
          </>
        )}>
        {selected && (
          <div className="space-y-3">
            <p className="text-xs text-gray-300 leading-relaxed">
              This will permanently delete <span className="font-semibold text-gray-100">{fmtNum(preview?.count)}</span> {selected.label.toLowerCase()} dated before <span className="font-semibold text-gray-100">{fmtDate(before)}</span>. A recovery snapshot is saved to Backups first.
            </p>
            <div>
              <p className="text-[11px] text-gray-500 mb-1.5">Type <span className="font-mono text-orange-300">{CONFIRM_WORD}</span> to confirm.</p>
              <input autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type CLEAN to confirm"
                className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:border-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
            </div>
            <ErrorState message={error} />
          </div>
        )}
      </Modal>
    </div>
  )
}
