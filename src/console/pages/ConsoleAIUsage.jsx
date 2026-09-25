/**
 * ConsoleAIUsage.jsx - AI usage and spend across the platform.
 *
 * Reads ai_token_logs through the single AI usage reader (lib/api/aiOps), the
 * same one AI Administration uses, so both pages report the same numbers.
 *
 * The previous version read ai_usage_log, which holds no rows, and selected
 * columns that table does not have, so this page could only ever show an error
 * or an empty state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Zap, RefreshCw, DollarSign, AlertTriangle, Cpu, Download, Layers } from 'lucide-react'
import {
  Panel, PanelHeader, StatTile, Badge, Btn, Segmented, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Note,
} from '../components/ui'
import { TrendChart, BarsChart } from '../components/ui/charts'
import { getUsageOverview } from '../../lib/api/aiOps'
import { dailySeries } from '../../lib/consoleCharts'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { COUNTRIES } from '../../contexts/SettingsContext'

const RANGES = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
]
const COUNTRY_OPTS = [{ value: '', label: 'All countries' }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]

const nf = new Intl.NumberFormat('en-US')
const usd = (v) => `$${(Number(v) || 0).toFixed((Number(v) || 0) < 1 ? 4 : 2)}`
const pct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`
const fmtWhen = (v) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'N/A')

export default function ConsoleAIUsage() {
  const [range, setRange] = useState('30')
  const [country, setCountry] = useState('')
  const [metric, setMetric] = useState('calls')
  const [state, setState] = useState({ loading: true, error: null, data: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await getUsageOverview({ days: Number(range), country: country || undefined })
      setState({ loading: false, error: null, data })
    } catch (err) {
      setState({ loading: false, error: toUserMessage(err, 'Could not load AI usage.'), data: null })
    }
  }, [range, country])

  useEffect(() => { load() }, [load])

  const s = state.data?.summary
  const rows = useMemo(() => state.data?.rows || [], [state.data])

  const series = useMemo(() => {
    const days = Number(range)
    if (metric === 'cost') {
      const byDay = Object.fromEntries((s?.byDay || []).map((d) => [d.date, d.cost]))
      const base = dailySeries([], () => null, days)
      return { labels: base.labels, values: base.keys.map((k) => Number((byDay[k] || 0).toFixed(4))), label: 'Cost (USD)' }
    }
    if (metric === 'failures') {
      const d = dailySeries(rows.filter((r) => r.status && r.status !== 'success'), (r) => r.created_at, days)
      return { labels: d.labels, values: d.values, label: 'Failed calls' }
    }
    const d = dailySeries(rows.filter((r) => !r.status || r.status === 'success'), (r) => r.created_at, days)
    return { labels: d.labels, values: d.values, label: 'Calls' }
  }, [rows, s, metric, range])

  const modelBars = (s?.byModel || []).slice(0, 8).map((m) => ({ label: m.model, value: Number(m.cost.toFixed(4)) }))
  const featureBars = (s?.byFeature || []).slice(0, 8).map((f) => ({ label: f.feature, value: f.calls }))

  const exportRows = () => {
    exportToExcel(rows.map((r) => ({
      when: r.created_at, model: r.model, feature: r.feature, status: r.status || 'success',
      prompt: r.prompt_tokens, completion: r.completion_tokens, cost: r.cost_usd, country: r.country,
    })), ['when', 'model', 'feature', 'status', 'prompt', 'completion', 'cost', 'country'],
    ['Time', 'Model', 'Feature', 'Status', 'Prompt tokens', 'Completion tokens', 'Cost USD', 'Country'],
    reportFileName('AI Usage', `${range} days`))
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1><Zap size={18} className="text-orange-400" /> AI Usage</h1>
          <p className="text-xs text-gray-500 mt-1">Calls, tokens, spend and failures for every AI feature, from the AI request log.</p>
        </div>
        <Toolbar>
          <Segmented value={range} onChange={setRange} options={RANGES} ariaLabel="Date range" role="group" />
          <label className="block"><span className="sr-only">Country</span>
            <Select value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-36" />
          </label>
          <Btn icon={Download} onClick={exportRows} disabled={!rows.length}>Export</Btn>
          <Btn icon={RefreshCw} onClick={load} busy={state.loading}>Refresh</Btn>
        </Toolbar>
      </header>

      {state.error && <ErrorState message={state.error} onRetry={load} />}
      {state.loading && !s && <LoadingState label="Loading AI usage" rows={4} />}

      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile icon={Zap} label="Successful calls" value={nf.format(s.totalCalls)} />
            <StatTile icon={Layers} label="Tokens" value={nf.format(s.totalTokens)}
              sub={`${nf.format(s.promptTokens)} in, ${nf.format(s.completionTokens)} out`} />
            <StatTile icon={DollarSign} label="Spend" value={usd(s.totalCost)} tone="accent" />
            <StatTile icon={DollarSign} label="Cost per call" value={s.totalCalls ? usd(s.avgCostPerCall) : 'N/A'} />
            <StatTile icon={AlertTriangle} label="Failed calls" value={nf.format(s.failedCalls)}
              tone={s.failedCalls ? 'warning' : 'default'} />
            <StatTile icon={Cpu} label="Failure rate" value={rows.length ? pct(s.failureRate) : 'N/A'}
              tone={s.failureRate > 0.05 ? 'danger' : 'default'} />
          </div>

          {/* The service pages past the server's 1,000-row cap and reports when its
              safety ceiling was hit; the old `rows.length >= 5000` test could
              never fire because the unpaged read stopped at 1,000. */}
          {state.data?.truncated && (
            <Note tone="warning" icon={AlertTriangle}>Showing the most recent {rows.length.toLocaleString()} requests in this window. Narrow the range for complete totals.</Note>
          )}

          <Panel>
            <PanelHeader icon={Zap} title="Trend" subtitle={`Per day over the last ${range} days.`}
              actions={<Segmented value={metric} onChange={setMetric} ariaLabel="Trend metric" role="group" options={[
                { key: 'calls', label: 'Calls' }, { key: 'cost', label: 'Cost' }, { key: 'failures', label: 'Failures' },
              ]} />} />
            <TrendChart labels={series.labels} series={[{ label: series.label, values: series.values }]} height={220}
              summary={`${series.label} per day`} emptyText="No AI requests in this window." />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader icon={Cpu} title="Spend by model" subtitle="Estimated from recorded cost, or model pricing when cost is missing." />
              <BarsChart bars={modelBars} valueFormat={usd} summary={modelBars.map((b) => `${b.label} ${usd(b.value)}`).join(', ')}
                emptyText="No spend recorded." />
            </Panel>
            <Panel>
              <PanelHeader icon={Layers} title="Calls by feature" subtitle="Which part of the app is asking the AI." />
              <BarsChart bars={featureBars} valueFormat={(v) => nf.format(v)}
                summary={featureBars.map((b) => `${b.label} ${b.value}`).join(', ')} emptyText="No calls recorded." />
            </Panel>
          </div>

          <Panel flush>
            <div className="p-4 pb-2">
              <PanelHeader icon={AlertTriangle} title="Recent failures"
                subtitle="Rate limits, missing keys and provider errors. Each one was a user who got no answer." />
            </div>
            {!s.recentFailures.length ? (
              <div className="px-4 pb-4"><EmptyState title="No failed requests" reason="Every AI request in this window succeeded." /></div>
            ) : (
              <Table className="border-0 rounded-none">
                <THead><Th>When</Th><Th>Feature</Th><Th>Model</Th><Th>Status</Th><Th>Error</Th></THead>
                <tbody>
                  {s.recentFailures.map((r) => (
                    <Tr key={r.id}>
                      <Td nowrap><span className="text-gray-500 tabular-nums">{fmtWhen(r.created_at)}</span></Td>
                      <Td>{r.feature || 'other'}</Td>
                      <Td><span className="font-mono text-[11px] text-gray-400">{r.model || 'unknown'}</span></Td>
                      <Td><Badge tone={r.status === 'rate_limited' ? 'warning' : 'danger'}>{String(r.status || 'error').replace(/_/g, ' ')}</Badge></Td>
                      <Td><span className="text-gray-400 break-words">{r.error || (r.http_status ? `HTTP ${r.http_status}` : 'N/A')}</span></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
