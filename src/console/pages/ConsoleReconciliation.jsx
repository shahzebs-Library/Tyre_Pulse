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
  Scale, RefreshCw, Play, AlertTriangle, CheckCircle2, ExternalLink,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { runReconciliation, listReconciliationRuns } from '../../lib/api/dataTrustOps'
import { shapeReconciliation, reconSummary } from '../../lib/dataTrustOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'

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
        text: sum.variance > 0
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

  if (state.loading) return <LoadingState label="Reading reconciliation runs" rows={5} />
  if (state.error) return <ErrorState message={state.error} onRetry={load} />

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          icon={Scale}
          title="Reconciliation Center"
          subtitle="Expected vs actual across cost, fleet and production - with the difference and where to investigate."
          actions={(
            <Toolbar>
              <Select value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-32" />
              <Btn variant="primary" icon={Play} busy={running} onClick={runNow}>Run reconciliation now</Btn>
              <Btn icon={RefreshCw} onClick={load}>Refresh</Btn>
            </Toolbar>
          )}
        />

        {flash && (
          <div className="px-4 pb-3">
            <Note icon={flash.tone === 'accent' ? CheckCircle2 : AlertTriangle} tone={flash.tone}>
              {flash.text}
            </Note>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 pt-0">
          <StatTile label="Checks" value={num(summary.total)} />
          <StatTile label="Balanced" value={num(summary.balanced)} tone={summary.balanced ? 'good' : 'default'} />
          <StatTile label="Variance" value={num(summary.variance)} tone={summary.variance ? 'warning' : 'default'} />
        </div>
      </Panel>

      {/* ── runs ───────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={Scale}
          title="Reconciliation runs"
          subtitle="Latest run per reconciliation. A non-zero difference is worth investigating - open the drilldown for the rows behind it."
        />
        {state.runs.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No reconciliations have been run yet"
            reason="Press Run reconciliation now to compute and store the current expected-vs-actual runs."
            action={<Btn variant="primary" icon={Play} busy={running} onClick={runNow}>Run reconciliation now</Btn>}
          />
        ) : (
          <Table>
            <THead>
              <Th>Reconciliation</Th>
              <Th align="right">Expected</Th>
              <Th align="right">Actual</Th>
              <Th align="right">Difference</Th>
              <Th>Unit</Th>
              <Th>Status</Th>
              <Th align="right">Affected</Th>
              <Th align="right">Investigate</Th>
              <Th>Last run</Th>
            </THead>
            <tbody>
              {state.runs.map((r) => {
                const href = drilldownHref(r.drilldown)
                return (
                  <Tr key={r.reconKey} tone={r.status === 'variance' ? 'warning' : undefined}>
                    <Td><span className="font-medium text-gray-100">{r.label}</span></Td>
                    <Td align="right" nowrap>{num(r.expected)}</Td>
                    <Td align="right" nowrap>{num(r.actual)}</Td>
                    <Td align="right" nowrap>
                      <span className={`tabular-nums font-medium ${differenceClass(r.difference)}`}>{num(r.difference)}</span>
                    </Td>
                    <Td><span className="text-gray-400">{r.unit || 'N/A'}</span></Td>
                    <Td><Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge></Td>
                    <Td align="right" nowrap>{num(r.affected)}</Td>
                    <Td align="right">
                      {href ? (
                        <a
                          href={href}
                          target={href.startsWith('/console') ? undefined : '_blank'}
                          rel={href.startsWith('/console') ? undefined : 'noopener noreferrer'}
                          className="inline-flex items-center gap-1 text-orange-300 hover:text-orange-200 text-xs"
                        >
                          <ExternalLink size={12} /> Open
                        </a>
                      ) : (
                        <span className="text-gray-600 text-xs">N/A</span>
                      )}
                    </Td>
                    <Td nowrap><span className="text-gray-500 text-[11px]">{formatRunAt(r.runAt)}</span></Td>
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
