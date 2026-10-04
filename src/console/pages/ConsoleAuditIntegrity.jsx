/**
 * ConsoleAuditIntegrity.jsx - tamper-evident audit logs + full audit export.
 *
 * Each closed UTC day of every audit source is sealed once by the database
 * (sha256 over the day's rows, chained to the previous day). "Verify now"
 * recomputes every sealed day: any row changed, added or deleted after sealing
 * shows as a mismatch; a day emptied by the retention policy is reported as such,
 * not as tampering. The export pulls the whole set page by page into Excel.
 * SOC 2 CC7.2 / ISO 27001 A.8.15.
 *
 * Layout: one tab per audit source plus an Export tab (?tab=). A KPI row and a
 * "needs attention" list sit above: sources not yet verified this session,
 * failed verifications and a sealing job that has stopped writing seals. Each
 * source tab shows its seal stats, the verify result, the daily volume and a
 * searchable, paged list of its sealed days (a day opens its fingerprint chain
 * in a side drawer).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Fingerprint, ShieldCheck, ShieldAlert, RefreshCw, CheckCircle2, XCircle, Download,
  Archive, FileSpreadsheet, Info, CalendarDays,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, SearchInput, Toolbar, Code,
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
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, TabBar, useUrlTab, usePaged, Pager, SideDrawer, Field, AttentionList } from './shared/pageKit'

const TAB_KEYS = [...AUDIT_SOURCES.map((s) => s.value), 'export']
// Seals are written nightly for the previous UTC day, so the newest sealed
// day is normally yesterday. Two missed nights means the job has stopped.
const STALE_SEAL_DAYS = 2
const DAY_EXPORT_COLUMNS = [
  { key: 'day', header: 'Day (UTC)' },
  { key: 'row_count', header: 'Rows sealed' },
  { key: 'sealed_at', header: 'Sealed at' },
  { key: 'digest', header: 'Digest' },
  { key: 'chain_digest', header: 'Chain digest' },
]

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
            ? `All ${fmtNum(s.checked)} sealed days match their seals.`
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
  const days = useMemo(() => (seals || []).filter((r) => r.source === source.value), [seals, source.value])
  const [search, setSearch] = useState('')
  const [openDay, setOpenDay] = useState(null)
  const { sort, onSort } = useTableSort({ key: 'day', dir: 'desc' })
  const shownDays = useMemo(() => sortRows(searchRows(days, search, ['day', 'digest', 'chain_digest']), sort), [days, search, sort])
  const paged = usePaged(shownDays)
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
      <div className="mt-4">
        <PanelHeader icon={CalendarDays} title="Sealed days" subtitle="Each closed UTC day and its chained fingerprint. Select a day for the full chain."
          actions={<ExportButtons rows={shownDays} columns={DAY_EXPORT_COLUMNS} title={`Audit Seals ${source.label}`} />} />
        <Toolbar className="mb-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search day or digest" className="w-full sm:w-64" />
        </Toolbar>
        {days.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No sealed days for this source" reason="The nightly job seals each closed day at 00:45 UTC." />
        ) : shownDays.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No days match" reason="Nothing matches the search. Clear it to see every sealed day." />
        ) : (
          <>
            <Table>
              <THead>
                <Th sortKey="day" sort={sort} onSort={onSort}>Day (UTC)</Th>
                <Th sortKey="row_count" sort={sort} onSort={onSort} align="right">Rows sealed</Th>
                <Th sortKey="sealed_at" sort={sort} onSort={onSort}>Sealed at</Th>
                <Th>Digest</Th>
              </THead>
              <tbody>
                {paged.rows.map((d) => (
                  <Tr key={d.id || d.day} onClick={() => setOpenDay(d)} ariaLabel={`Open sealed day ${d.day}`}>
                    <Td nowrap><span className="font-mono text-gray-200">{d.day}</span></Td>
                    <Td align="right"><span className="tabular-nums">{fmtNum(d.row_count)}</span></Td>
                    <Td nowrap><span className="text-gray-400">{fmtWhen(d.sealed_at)}</span></Td>
                    <Td><span className="font-mono text-[11px] text-gray-500">{String(d.digest || '').slice(0, 16) || 'N/A'}</span></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pager paged={paged} label="sealed days" />
          </>
        )}
      </div>
      <SideDrawer open={!!openDay} onClose={() => setOpenDay(null)} title={openDay ? `Sealed day ${openDay.day}` : 'Sealed day'} subtitle={source.label}>
        {openDay && (
          <dl>
            <Field label="Rows sealed">{fmtNum(openDay.row_count)}</Field>
            <Field label="Sealed at">{fmtWhen(openDay.sealed_at)}</Field>
            <Field label="Digest"><Code>{openDay.digest || 'N/A'}</Code></Field>
            <Field label="Previous digest"><Code>{openDay.prev_digest || 'N/A'}</Code></Field>
            <Field label="Chain digest"><Code>{openDay.chain_digest || 'N/A'}</Code></Field>
          </dl>
        )}
      </SideDrawer>
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
  const [readAt, setReadAt] = useState(null)
  const [tab, setTab] = useUrlTab(TAB_KEYS, AUDIT_SOURCES[0].value)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const seals = await listAuditSeals()
      setState({ loading: false, error: null, seals })
      setReadAt(Date.now())
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

  const totals = useMemo(() => {
    let days = 0; let rows = 0; let last = null
    for (const s of AUDIT_SOURCES) {
      const st = stats[s.value]
      days += st.days; rows += st.rows
      if (st.lastSealedAt && (!last || st.lastSealedAt > last)) last = st.lastSealedAt
    }
    const verified = AUDIT_SOURCES.filter((s) => results[s.value]?.summary && !results[s.value].summary.empty)
    const failedSrc = verified.filter((s) => !results[s.value].summary.passed)
    const mismatched = failedSrc.reduce((a, s) => a + results[s.value].summary.mismatched.length, 0)
    return { days, rows, last, verified: verified.length, passed: verified.length - failedSrc.length, mismatched }
  }, [stats, results])

  const attention = useMemo(() => {
    if (state.loading || state.error || !state.seals.length) return []
    const items = []
    const ref = readAt || 0
    for (const s of AUDIT_SOURCES) {
      const r = results[s.value]
      if (r?.error) items.push({ key: `e-${s.value}`, tone: 'danger', title: `${s.label}: verification could not run`, detail: r.error, action: { label: 'Retry', onClick: () => verify(s.value) } })
      else if (r?.summary && !r.summary.passed && !r.summary.empty) items.push({ key: `m-${s.value}`, tone: 'danger', title: `${s.label}: ${r.summary.mismatched.length} sealed day(s) changed after sealing`, detail: 'Open the source to see which days and what changed.', action: { label: 'Open', onClick: () => setTab(s.value) } })
      const st = stats[s.value]
      const last = st.lastDay ? new Date(`${st.lastDay}T00:00:00Z`).getTime() : NaN
      if (st.days > 0 && ref && Number.isFinite(last) && (ref - last) / 86400000 > STALE_SEAL_DAYS + 1) {
        items.push({ key: `s-${s.value}`, tone: 'warning', title: `${s.label}: no seal since ${st.lastDay}`, detail: 'The nightly sealing job may have stopped. Days after this are not protected yet.', action: { label: 'Open', onClick: () => setTab(s.value) } })
      }
      if (!r && st.days > 0) items.push({ key: `n-${s.value}`, tone: 'info', title: `${s.label}: not verified this session`, detail: `${fmtNum(st.days)} sealed days are waiting to be checked.`, action: { label: 'Verify', onClick: () => verify(s.value) } })
    }
    return items
  }, [state, stats, results, readAt, setTab])
  const failedTiles = !!state.error

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={Fingerprint} title="Audit Integrity"
        purpose="Every closed day of the audit logs is sealed with a chained fingerprint at 00:45 UTC. Verify recomputes each day and checks it still matches its seal."
        refreshedAt={readAt} onRefresh={load} refreshing={state.loading}
        actions={<Btn variant="primary" icon={ShieldCheck} onClick={verifyAll} busy={anyBusy}>Verify all</Btn>} />

      <Note icon={Archive}>
        Days older than the audit retention window (Console, System Configuration) are deleted by the retention job. Those days show as emptied by retention, not as tampering. Today is sealed tomorrow.
      </Note>

      <Panel>
        <PanelHeader icon={Info} title="What Verify can and cannot prove" subtitle="Read this before you rely on a pass as evidence." />
        <ul className="text-xs text-gray-400 space-y-1.5 list-disc pl-4 max-w-4xl">
          <li>A pass means every sealed day still matches the fingerprint written for it, and each fingerprint still links to the day before. A changed or deleted row in a sealed day shows as a failure.</li>
          <li>The fingerprints are stored in the same database as the logs and are not signed with a separate key. Someone with full database access could rewrite a day and its seal together, and Verify would not see it.</li>
          <li>Copying each night's fingerprint out of the database (for example by email) is not set up yet. That is the step that would let the proof be checked from outside.</li>
          <li>Rows written before sealing started were never sealed, and today stays unsealed until tonight's job runs.</li>
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="quiet">Not set up</Badge>
          <span className="text-gray-400">Copy the daily fingerprint out of the database</span>
        </div>
      </Panel>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Sealed days" icon={CalendarDays} value={state.loading ? '...' : failedTiles ? 'N/A' : fmtNum(totals.days)}
          sub={failedTiles ? undefined : `${fmtNum(totals.rows)} rows covered`} />
        <StatTile label="Sources verified" icon={ShieldCheck} value={`${totals.verified} of ${AUDIT_SOURCES.length}`}
          tone={totals.verified === AUDIT_SOURCES.length && totals.passed === totals.verified ? 'good' : 'muted'} sub="This session" />
        <StatTile label="Days changed after sealing" icon={XCircle}
          value={totals.verified ? fmtNum(totals.mismatched) : 'N/A'}
          tone={totals.mismatched ? 'danger' : totals.verified ? 'good' : 'muted'} sub={totals.verified ? 'In verified sources' : 'Not verified yet'} />
        <StatTile label="Last seal written" icon={Archive} value={state.loading ? '...' : failedTiles || !totals.last ? 'N/A' : fmtWhen(totals.last)} />
      </div>

      {!state.loading && !state.error && state.seals.length > 0 && (
        <AttentionList items={attention} subtitle="Failed verifications, a stopped sealing job, then sources not yet verified."
          clearText="Every source is verified, unaltered and sealed up to date." />
      )}

      <TabBar tabs={[
        ...AUDIT_SOURCES.map((src) => ({ key: src.value, label: src.label, count: failedTiles ? undefined : stats[src.value].days })),
        { key: 'export', label: 'Export' },
      ]} value={tab} onChange={setTab} label="Audit integrity sections" />

      {tab === 'export' ? <ExportPanel /> : (
        state.loading && !state.seals.length ? (
          <LoadingState label="Loading seals" />
        ) : state.error ? (
          <ErrorState message={state.error} onRetry={load} />
        ) : !state.seals.length ? (
          <EmptyState icon={Fingerprint} title="No seals yet" reason="The first seals are written by the nightly job at 00:45 UTC." />
        ) : (
          AUDIT_SOURCES.filter((src) => src.value === tab).map((src) => (
            <SourceCard key={src.value} source={src} stats={stats[src.value]} seals={state.seals}
              result={results[src.value]} busy={!!busy[src.value]} onVerify={() => verify(src.value)} />
          ))
        )
      )}
    </div>
  )
}
