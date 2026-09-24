/**
 * ConsoleAuditIntegrity.jsx - tamper-evident audit logs + full audit export.
 *
 * Each closed UTC day of every audit source is sealed once by the database
 * (sha256 over the day's rows, chained to the previous day). "Verify now"
 * recomputes every sealed day: any row changed, added or deleted after sealing
 * shows as a mismatch; a day emptied by the retention policy is reported as such,
 * not as tampering. The export pulls the whole set page by page into Excel.
 * SOC 2 CC7.2 / ISO 27001 A.8.15.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Fingerprint, ShieldCheck, ShieldAlert, RefreshCw, CheckCircle2, XCircle, Download,
  Archive, FileSpreadsheet, Info,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { TrendChart } from '../components/ui/charts'
import {
  listAuditSeals, verifyAuditSeals, countAuditExport, exportAuditAll,
} from '../../lib/api/auditSeals'
import {
  AUDIT_SOURCES, sourceLabel, sealsBySource, volumeTrend, summarizeVerify,
  mismatchReason, flattenExportRow, exportColumns, exportWarning,
} from '../../lib/auditSeals'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'

function fmtWhen(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtNum(n) { return (Number(n) || 0).toLocaleString('en-GB') }

function VerifyResult({ result }) {
  if (!result) return null
  if (result.error) return <p className="text-xs text-red-400 mt-2">{result.error}</p>
  const s = result.summary
  if (s.empty) return <p className="text-xs text-gray-500 mt-2">No sealed days to check yet.</p>
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {s.passed
          ? <Badge tone="good" icon={CheckCircle2}>Passed</Badge>
          : <Badge tone="danger" icon={XCircle}>Failed</Badge>}
        <span className="text-xs text-gray-300">
          {s.passed
            ? `All ${fmtNum(s.checked)} sealed days are unaltered.`
            : `${fmtNum(s.mismatched.length)} of ${fmtNum(s.checked)} sealed days were changed after sealing.`}
          {s.purged > 0 && ` ${fmtNum(s.purged)} day(s) were emptied by the retention policy, as expected.`}
        </span>
        <span className="text-[11px] text-gray-500">Checked {fmtWhen(result.at)}</span>
      </div>
      {s.mismatched.length > 0 && (
        <Table>
          <THead>
            <Th>Day</Th><Th align="right">Rows when sealed</Th><Th align="right">Rows now</Th><Th>What changed</Th>
          </THead>
          <tbody>
            {s.mismatched.map((r) => (
              <Tr key={r.day} tone="danger">
                <Td nowrap><span className="font-mono text-gray-200">{r.day}</span></Td>
                <Td align="right"><span className="tabular-nums">{fmtNum(r.row_count_then)}</span></Td>
                <Td align="right"><span className="tabular-nums">{fmtNum(r.row_count_now)}</span></Td>
                <Td><span className="text-gray-300">{mismatchReason(r)}</span></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

function SourceCard({ source, stats, seals, result, busy, onVerify }) {
  const trend = useMemo(() => volumeTrend(seals, source.value, 90), [seals, source.value])
  return (
    <Panel tone={result?.summary && !result.summary.passed && !result.summary.empty ? 'danger' : undefined}>
      <PanelHeader
        icon={Fingerprint}
        title={source.label}
        subtitle={`Table ${source.value}`}
        actions={<Btn variant="primary" icon={ShieldCheck} onClick={onVerify} busy={busy}>Verify now</Btn>}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Sealed days" value={fmtNum(stats.days)} sub={stats.firstDay ? `From ${stats.firstDay}` : 'None yet'} />
        <StatTile label="Last sealed day" value={stats.lastDay || 'N/A'} />
        <StatTile label="Last seal written" value={stats.lastSealedAt ? fmtWhen(stats.lastSealedAt) : 'N/A'} />
        <StatTile label="Rows covered" value={fmtNum(stats.rows)} />
      </div>
      <VerifyResult result={result} />
      <div className="mt-4">
        <p className="text-[11px] text-gray-500 mb-1">Daily audit volume (rows per sealed day, last 90 days)</p>
        <TrendChart
          labels={trend.labels}
          series={[{ label: 'Rows', values: trend.values }]}
          height={160}
          summary={`Daily audit rows for ${source.label}`}
          emptyText="No sealed days yet."
        />
      </div>
    </Panel>
  )
}

function ExportPanel() {
  const [source, setSource] = useState('audit_log_v2')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [count, setCount] = useState(null)
  const [counting, setCounting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  useEffect(() => { setCount(null); setDone(null) }, [source, from, to])

  const rangeBad = from && to && from > to

  const doCount = async () => {
    setCounting(true); setError(null); setDone(null)
    try { setCount(await countAuditExport(source, from || null, to || null)) }
    catch (e) { setError(toUserMessage(e, 'Could not count the audit rows.')) }
    finally { setCounting(false) }
  }

  const doExport = async () => {
    if (!count) return
    setExporting(true); setError(null); setDone(null); setProgress({ done: 0, total: count })
    try {
      const raw = await exportAuditAll(source, from || null, to || null, count,
        (d, t) => setProgress({ done: d, total: t }))
      const flat = raw.map(flattenExportRow)
      const cols = exportColumns(flat)
      const range = from || to ? `${from || 'start'} to ${to || 'today'}` : 'All dates'
      await exportToExcel(flat, cols, cols,
        reportFileName('TyrePulse Audit Export', sourceLabel(source), from, to),
        'Audit', { title: `Audit export: ${sourceLabel(source)}`, dateRange: range })
      setDone(flat.length)
    } catch (e) {
      setError(toUserMessage(e, 'The export could not be completed.'))
    } finally {
      setExporting(false); setProgress(null)
    }
  }

  const warn = exportWarning(count)

  return (
    <Panel>
      <PanelHeader icon={FileSpreadsheet} title="Export audit log"
        subtitle="Download the complete set of rows for one source and date range (UTC days)." />
      <div className="grid gap-3 md:grid-cols-4 items-end">
        <label className="text-xs text-gray-400 space-y-1">
          <span>Source</span>
          <Select value={source} onChange={setSource} options={AUDIT_SOURCES} />
        </label>
        <label className="text-xs text-gray-400 space-y-1 block">
          <span>From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" />
        </label>
        <label className="text-xs text-gray-400 space-y-1 block">
          <span>To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" />
        </label>
        <div className="flex gap-2">
          <Btn icon={RefreshCw} onClick={doCount} busy={counting} disabled={rangeBad || exporting}>Count rows</Btn>
          <Btn variant="primary" icon={Download} onClick={doExport} busy={exporting}
            disabled={!count || rangeBad || counting}>Download Excel</Btn>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {rangeBad && <Note tone="warning" icon={Info}>The From date is after the To date.</Note>}
        {count !== null && !rangeBad && (
          <p className="text-xs text-gray-300">
            {count === 0 ? 'No rows in this range.' : `${fmtNum(count)} row(s) will be exported.`}
          </p>
        )}
        {warn && <Note tone="warning" icon={ShieldAlert}>{warn}</Note>}
        {progress && (
          <p className="text-xs text-gray-400">Fetching {fmtNum(progress.done)} of {fmtNum(progress.total)} rows...</p>
        )}
        {done !== null && <Note tone="accent" icon={CheckCircle2}>Exported {fmtNum(done)} row(s).</Note>}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <p className="text-[11px] text-gray-500">
          Rows are pulled in pages of 5,000 in time order. A Max Export Rows limit set in System Configuration still applies to the file.
        </p>
      </div>
    </Panel>
  )
}

export default function ConsoleAuditIntegrity() {
  const [state, setState] = useState({ loading: true, error: null, seals: [] })
  const [results, setResults] = useState({})
  const [busy, setBusy] = useState({})

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const seals = await listAuditSeals()
      setState({ loading: false, error: null, seals })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: toUserMessage(e, 'Could not load the audit seals.') }))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => sealsBySource(state.seals), [state.seals])

  const verify = async (source) => {
    setBusy((b) => ({ ...b, [source]: true }))
    try {
      const rows = await verifyAuditSeals(source)
      setResults((r) => ({ ...r, [source]: { at: new Date().toISOString(), summary: summarizeVerify(rows) } }))
    } catch (e) {
      setResults((r) => ({ ...r, [source]: { at: new Date().toISOString(), error: toUserMessage(e, 'Verification could not run.') } }))
    } finally {
      setBusy((b) => ({ ...b, [source]: false }))
    }
  }

  const verifyAll = async () => { for (const s of AUDIT_SOURCES) await verify(s.value) }
  const anyBusy = Object.values(busy).some(Boolean)

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            <Fingerprint size={18} className="text-orange-400" /> Audit Integrity
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Every closed day of the audit logs is sealed with a chained fingerprint at 00:45 UTC. Verify proves nothing was changed or deleted since.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn icon={RefreshCw} onClick={load} busy={state.loading}>Refresh</Btn>
          <Btn variant="primary" icon={ShieldCheck} onClick={verifyAll} busy={anyBusy}>Verify all</Btn>
        </div>
      </header>

      <Note icon={Archive}>
        Days older than the audit retention window (Console, System Configuration) are deleted by the retention job. Those days show as emptied by retention, not as tampering. Today is sealed tomorrow.
      </Note>

      {state.loading && !state.seals.length ? (
        <LoadingState label="Loading seals" />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={load} />
      ) : !state.seals.length ? (
        <EmptyState icon={Fingerprint} title="No seals yet" reason="The first seals are written by the nightly job at 00:45 UTC." />
      ) : (
        AUDIT_SOURCES.map((s) => (
          <SourceCard key={s.value} source={s} stats={stats[s.value]} seals={state.seals}
            result={results[s.value]} busy={!!busy[s.value]} onVerify={() => verify(s.value)} />
        ))
      )}

      <ExportPanel />
    </div>
  )
}
