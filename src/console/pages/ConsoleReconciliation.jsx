/**
 * ConsoleReconciliation.jsx - the Reconciliation Center.
 *
 * Expected vs actual across cost, fleet and production, with the difference and
 * where to investigate. A reconciliation that balances is quiet; one with a
 * variance carries the exact gap and a drilldown into the rows behind it.
 *
 * Running a reconciliation computes and stores the runs server-side; this page
 * reads them back. Nothing runs on load - a person presses "Run reconciliation
 * now".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Scale, RefreshCw, Play, AlertTriangle, CheckCircle2, ExternalLink, Download, FileText, ListChecks,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, Toolbar, SearchInput,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { runReconciliation, listReconciliationRuns } from '../../lib/api/dataTrustOps'
import { shapeReconciliation, reconSummary } from '../../lib/dataTrustOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import { useTableSort } from '../../lib/useTableSort'
import { BarsChart } from '../components/ui/charts'

const nf = new Intl.NumberFormat('en-US')
const num = (v) => (v === null || v === undefined ? 'N/A' : nf.format(Number(v)))

const COUNTRY_OPTS = ['All', ...COUNTRIES].map((c) => ({ value: c, label: c }))

function statusTone(status) {
  if (status === 'balanced') return 'good'
  if (status === 'variance') return 'warning'
  return 'default'
}
function statusLabel(status) {
  if (status === 'balanced') return 'Balanced'
  if (status === 'variance') return 'Variance'
  return status || 'Unknown'
}
/** Zero difference reads calm; any gap is amber and worth a look. */
function differenceClass(diff) {
  if (diff === null || diff === undefined) return 'text-gray-500'
  return Number(diff) === 0 ? 'text-emerald-300' : 'text-amber-300'
}
function drilldownHref(d) {
  if (typeof d !== 'string' || !d) return null
  if (d.startsWith('/') || d.startsWith('http://') || d.startsWith('https://')) return d
  return null
}
/** Difference as a share of what was expected; null when there is nothing to divide by. */
function variancePct(r) {
  if (!r || r.difference === null || r.difference === undefined) return null
  if (!r.expected) return null
  return (Number(r.difference) / Math.abs(Number(r.expected))) * 100
}
const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? 'N/A' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)
const ACCESSORS = {
  absDiff: (r) => (r.difference === null || r.difference === undefined ? null : Math.abs(r.difference)),
  pct: (r) => variancePct(r),
  status: (r) => (r.status === 'variance' ? 0 : r.status === 'balanced' ? 1 : 2),
}
const EXPORT_COLS = [
  ['label', 'Reconciliation'], ['expected', 'Expected'], ['actual', 'Actual'], ['difference', 'Difference'],
  ['variance_pct', 'Variance %'], ['unit', 'Unit'], ['status', 'Status'], ['affected', 'Affected'], ['last_run', 'Last run'],
]

function formatRunAt(ts) {
  if (!ts) return 'N/A'
  const dt = new Date(ts)
  if (Number.isNaN(dt.getTime())) return 'N/A'
  return dt.toLocaleString()
}

export default function ConsoleReconciliation() {
  const [country, setCountry] = useState('All')
  const [state, setState] = useState({ loading: true, error: null, runs: [] })
  const [running, setRunning] = useState(false)
  const [flash, setFlash] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const raw = await listReconciliationRuns({ country: country === 'All' ? null : country })
      setState({ loading: false, error: null, runs: shapeReconciliation(raw) })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), runs: [] })
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const runNow = async () => {
    setRunning(true)
    setFlash(null)
    try {
      await runReconciliation(country === 'All' ? null : country)
      const fresh = shapeReconciliation(
        await listReconciliationRuns({ country: country === 'All' ? null : country }),
      )
      setState((s) => ({ ...s, runs: fresh }))
      const sum = reconSummary(fresh)
      setFlash({
        tone: sum.variance > 0 ? 'warning' : 'accent',
        text: sum.total === 0
          ? 'The run finished but stored no reconciliations for this scope.'
          : sum.variance > 0
            ? `${sum.variance} of ${sum.total} reconciliation${sum.total === 1 ? '' : 's'} show a variance.`
            : `All ${sum.total} reconciliation${sum.total === 1 ? '' : 's'} balanced.`,
      })
    } catch (e) {
      setFlash({ tone: 'danger', text: toUserMessage(e) })
    } finally {
      setRunning(false)
    }
  }

  const summary = useMemo(() => reconSummary(state.runs), [state.runs])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.runs.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (!q) return true
      return `${r.label} ${r.unit}`.toLowerCase().includes(q)
    })
  }, [state.runs, search, statusFilter])
  const { sort, onSort, sorted } = useTableSort(filtered, { key: 'status', dir: 'asc' }, ACCESSORS)
  const varianceBars = useMemo(() => state.runs
    .filter((r) => r.status === 'variance' && r.difference)
    .map((r) => ({ label: r.label, value: Math.abs(Number(r.difference)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8), [state.runs])

  function exportRows(kind) {
    const out = sorted.map((r) => ({
      label: r.label,
      expected: r.expected ?? 'N/A',
      actual: r.actual ?? 'N/A',
      difference: r.difference ?? 'N/A',
      variance_pct: fmtPct(variancePct(r)),
      unit: r.unit || 'N/A',
      status: statusLabel(r.status),
      affected: r.affected,
      last_run: formatRunAt(r.runAt),
    }))
    const file = reportFileName('TyrePulse Reconciliation', country)
    if (kind === 'pdf') exportToPdf(out, EXPORT_COLS.map(([key, header]) => ({ key, header })), 'Reconciliation Runs', file, 'landscape')
    else exportToExcel(out, EXPORT_COLS.map(([k]) => k), EXPORT_COLS.map(([, h]) => h), file)
  }

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          <Scale size={18} className="text-orange-400" aria-hidden="true" /> Reconciliation Center
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Expected vs actual across cost, fleet and production, with the difference and where to investigate.
        </p>
      </div>
      <Toolbar>
        <Select ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-32" />
        <Btn variant="primary" icon={Play} busy={running} disabled={state.loading} onClick={runNow}>Run reconciliation now</Btn>
        <Btn icon={RefreshCw} onClick={load} busy={state.loading}>Refresh</Btn>
      </Toolbar>
    </div>
  )

  if (state.loading) return <div className="space-y-4">{header}<LoadingState label="Reading reconciliation runs" rows={5} /></div>
  if (state.error) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState message={state.error} onRetry={load} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {header}
      <Panel>
        <PanelHeader icon={ListChecks} title="Summary" subtitle="Click a tile to filter the runs to that status." />
        {flash && (
          <div className="mb-3" role="status">
            <Note icon={flash.tone === 'accent' ? CheckCircle2 : AlertTriangle} tone={flash.tone}>
              {flash.text}
            </Note>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="grid grid-cols-3 lg:grid-cols-1 gap-3 content-start">
            <StatTile label="Checks" value={num(summary.total)} onClick={() => setStatusFilter('')} active={!statusFilter} />
            <StatTile label="Balanced" value={num(summary.balanced)} tone={summary.balanced ? 'good' : 'default'}
              onClick={() => setStatusFilter((v) => (v === 'balanced' ? '' : 'balanced'))} active={statusFilter === 'balanced'} />
            <StatTile label="Variance" value={num(summary.variance)} tone={summary.variance ? 'warning' : 'default'}
              onClick={() => setStatusFilter((v) => (v === 'variance' ? '' : 'variance'))} active={statusFilter === 'variance'} />
          </div>
          <div className="lg:col-span-2">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Largest gaps (absolute difference)</p>
            <BarsChart bars={varianceBars} valueFormat={(v) => num(v)}
              summary={varianceBars.length ? `Largest gap: ${varianceBars[0].label} at ${num(varianceBars[0].value)}.` : 'No reconciliation shows a variance.'}
              emptyText="No reconciliation shows a variance." />
          </div>
        </div>
      </Panel>

      {/* ── runs ───────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={Scale}
          title="Reconciliation runs"
          subtitle={`Latest run per reconciliation, ${num(filtered.length)} of ${num(state.runs.length)} shown. A non-zero difference is worth investigating; open the drilldown for the rows behind it.`}
          actions={<>
            <Btn icon={Download} onClick={() => exportRows('xlsx')} disabled={!sorted.length}>Excel</Btn>
            <Btn icon={FileText} onClick={() => exportRows('pdf')} disabled={!sorted.length}>PDF</Btn>
          </>}
        />
        {state.runs.length > 0 && (
          <Toolbar className="mb-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search reconciliations" className="w-full sm:w-64" />
            <Select ariaLabel="Filter by status" value={statusFilter} onChange={setStatusFilter} placeholder="All statuses" className="w-36"
              options={[{ value: 'variance', label: 'Variance' }, { value: 'balanced', label: 'Balanced' }]} />
            {(search || statusFilter) && <Btn variant="quiet" onClick={() => { setSearch(''); setStatusFilter('') }}>Clear filters</Btn>}
          </Toolbar>
        )}
        {state.runs.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No reconciliations have been run yet"
            reason="Press Run reconciliation now to compute and store the current expected-vs-actual runs."
            action={<Btn variant="primary" icon={Play} busy={running} onClick={runNow}>Run reconciliation now</Btn>}
          />
        ) : sorted.length === 0 ? (
          <EmptyState icon={Scale} title="No reconciliations match these filters" reason="Clear the search and filters to see every run." />
        ) : (
          <Table>
            <THead>
              <Th sortKey="label" sort={sort} onSort={onSort}>Reconciliation</Th>
              <Th sortKey="expected" sort={sort} onSort={onSort} align="right">Expected</Th>
              <Th sortKey="actual" sort={sort} onSort={onSort} align="right">Actual</Th>
              <Th sortKey="absDiff" sort={sort} onSort={onSort} align="right">Difference</Th>
              <Th sortKey="pct" sort={sort} onSort={onSort} align="right">Variance</Th>
              <Th>Unit</Th>
              <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
              <Th sortKey="affected" sort={sort} onSort={onSort} align="right">Affected</Th>
              <Th align="right">Investigate</Th>
              <Th sortKey="runAt" sort={sort} onSort={onSort}>Last run</Th>
            </THead>
            <tbody>
              {sorted.map((r) => {
                const href = drilldownHref(r.drilldown)
                return (
                  <Tr key={r.reconKey} tone={r.status === 'variance' ? 'warning' : undefined}>
                    <Td><span className="font-medium text-gray-100">{r.label}</span></Td>
                    <Td align="right" nowrap>{num(r.expected)}</Td>
                    <Td align="right" nowrap>{num(r.actual)}</Td>
                    <Td align="right" nowrap>
                      <span className={`tabular-nums font-medium ${differenceClass(r.difference)}`}>{num(r.difference)}</span>
                    </Td>
                    <Td align="right" nowrap><span className={`tabular-nums ${differenceClass(r.difference)}`}>{fmtPct(variancePct(r))}</span></Td>
                    <Td><span className="text-gray-400">{r.unit || 'N/A'}</span></Td>
                    <Td><Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge></Td>
                    <Td align="right" nowrap>{num(r.affected)}</Td>
                    <Td align="right">
                      {href ? (
                        <a
                          href={href}
                          target={href.startsWith('/console') ? undefined : '_blank'}
                          rel={href.startsWith('/console') ? undefined : 'noopener noreferrer'}
                          aria-label={`Open the rows behind ${r.label}`}
                          className="inline-flex items-center gap-1 text-orange-300 hover:text-orange-200 text-xs rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                        >
                          <ExternalLink size={12} aria-hidden="true" /> Open
                        </a>
                      ) : (
                        <span className="text-gray-400 text-xs">N/A</span>
                      )}
                    </Td>
                    <Td nowrap><span className="text-gray-400 text-[11px]">{formatRunAt(r.runAt)}</span></Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  )
}
