import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { loadAiTyreOps, listFailedJobs } from '../../lib/api/aiTyreOps'
import { retryJobs } from '../../lib/api/aiTyreInspection'
import { shapeOps, fmtDuration } from '../../lib/aiTyreOps'
import { toUserMessage } from '../../lib/safeError'

const usd = (n) => (n === null || n === undefined ? 'N/A' : '$' + Number(n).toFixed(2))
const pct = (n) => (n === null || n === undefined ? 'N/A' : n + '%')
const Tile = ({ label, value, sub }) => (
  <div className="rounded-lg border border-[var(--border-dim)] p-3">
    <div className="text-xs text-[var(--text-muted)]">{label}</div>
    <div className="text-xl font-semibold mt-1">{value}</div>
    {sub && <div className="text-xs text-[var(--text-muted)] mt-1">{sub}</div>}
  </div>
)

/** Operations visibility + failed-job retry. Rendered only for supervisor roles by the page. */
export default function AiTyreOpsPanel({ canRetry }) {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [ops, fl] = await Promise.all([loadAiTyreOps({ days: 30 }), canRetry ? listFailedJobs() : Promise.resolve([])])
      setData(ops); setFailed(fl); setPicked(new Set())
    } catch (e) { setError(toUserMessage(e, 'Could not load AI operations data')); setData(null) }
    finally { setLoading(false) }
  }, [canRetry])
  useEffect(() => { load() }, [load])

  const ops = useMemo(() => (data ? shapeOps(data) : null), [data])

  const retry = async (ids) => {
    setBusy(true); setNotice('')
    try {
      const res = await retryJobs(ids)
      setNotice(res?.message || `Retry requested for ${ids.length} job${ids.length === 1 ? '' : 's'}.`)
      await load()
    } catch (e) { setNotice(e?.message || 'The retry could not be completed.') }
    finally { setBusy(false) }
  }
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-[var(--text-muted)]">Last 30 days for queue, timing, failures and models; spend is this calendar month (UTC). Time to result is job created to last update on completed jobs.</p>
      <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}><RefreshCw size={15}/> Refresh</button>
    </div>
    {error && <div role="alert" className="text-red-500 text-sm">{error} <button type="button" className="underline" onClick={load}>Retry</button></div>}
    {loading && !ops && <p role="status" className="text-sm text-[var(--text-muted)]">Loading operations data</p>}
    {ops && <>
      {data.truncated && <p role="note" className="text-xs text-amber-500">Very large result: figures cover the newest rows only.</p>}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Waiting" value={ops.queue.pending} sub={`${ops.queue.processing} analysing`} />
        <Tile label="Completed" value={ops.queue.completed} sub={`of ${ops.queue.total} jobs`} />
        <Tile label="Time to result (median)" value={fmtDuration(ops.latency.medianSec)} sub={`p95 ${fmtDuration(ops.latency.p95Sec)} (${ops.latency.count} jobs)`} />
        <Tile label="Failure rate" value={pct(ops.failures.ratePct)} sub={`${ops.failures.failed} failed of ${ops.failures.terminal} finished`} />
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Spend this month" value={usd(ops.spend.spentUsd)} sub={`tyre ${usd(ops.spend.tyreUsd)}, other AI ${usd(ops.spend.otherUsd)}`} />
        <Tile label="Monthly budget" value={data.budgetReadable ? (ops.spend.limitUsd ? usd(ops.spend.limitUsd) : 'Uncapped') : 'N/A'} sub={ops.spend.usedPct === null ? (data.budgetReadable ? '' : 'Budget setting not readable for your role') : `${ops.spend.usedPct}% used`} />
        <Tile label="Calls with unknown cost" value={ops.spend.unpricedCalls} sub="not included in spend" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold mb-2">Failures by kind</h3>
          {ops.failures.byKind.length === 0 ? <p className="text-xs text-[var(--text-muted)]">No failed jobs in this window.</p> :
            <table className="w-full text-sm"><tbody>{ops.failures.byKind.map((k) => <tr key={k.kind}><td className="py-1">{k.kind}</td><td className="text-right">{k.count}</td><td className="text-right text-[var(--text-muted)]">{k.sharePct}%</td></tr>)}</tbody></table>}
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2">Provider and model mix</h3>
          {ops.mix.length === 0 ? <p className="text-xs text-[var(--text-muted)]">No jobs in this window.</p> :
            <table className="w-full text-sm"><tbody>{ops.mix.map((m) => <tr key={m.provider + m.model}><td className="py-1">{m.provider} / {m.model}</td><td className="text-right">{m.jobs}</td><td className="text-right text-[var(--text-muted)]">{usd(m.costUsd)}{m.unpriced ? ` (+${m.unpriced} unpriced)` : ''}</td></tr>)}</tbody></table>}
        </div>
      </div>
      {canRetry && <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold">Failed jobs ({failed.length})</h3>
          <button type="button" className="btn btn-secondary" disabled={busy || picked.size === 0} onClick={() => retry([...picked])}><RotateCcw size={15}/> Retry selected ({picked.size})</button>
        </div>
        {notice && <p role="status" className="text-sm mb-2">{notice}</p>}
        {failed.length === 0 ? <p className="text-xs text-[var(--text-muted)]">No failed jobs.</p> :
          <div className="max-h-72 overflow-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-[var(--text-muted)]"><th className="w-8"><input type="checkbox" aria-label="Select all failed jobs" checked={picked.size === failed.length} onChange={(e) => setPicked(e.target.checked ? new Set(failed.slice(0, 100).map((j) => j.id)) : new Set())}/></th><th>Position</th><th>Reason</th><th>Attempts</th><th/></tr></thead>
            <tbody>{failed.map((j) => <tr key={j.id} className="border-t border-[var(--border-dim)]">
              <td><input type="checkbox" aria-label={`Select job ${j.tyre_position || ''}`} checked={picked.has(j.id)} onChange={() => toggle(j.id)}/></td>
              <td>{j.tyre_position || 'Not recorded'}</td><td>{j.failure_kind || j.error_message || 'Unknown'}</td><td>{j.attempts ?? 'N/A'}</td>
              <td className="text-right"><button type="button" className="btn-secondary" disabled={busy} onClick={() => retry([j.id])}>Retry</button></td></tr>)}</tbody>
          </table></div>}
        <p className="text-xs text-[var(--text-muted)] mt-2">Retrying re-queues a photo and may be charged again. Up to 100 jobs per request.</p>
      </div>}
    </>}
  </div>
}
