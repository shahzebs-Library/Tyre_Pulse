/**
 * ConsoleAIUsage.jsx - AI usage and spend across the platform.
 *
 * Reads ai_token_logs through the single AI usage reader (lib/api/aiOps), the
 * same one AI Administration uses, so both pages report the same numbers.
 *
 * The previous version read ai_usage_log, which holds no rows, and selected
 * columns that table does not have, so this page could only ever show an error
 * or an empty state.
 *
 * Layout: header, six tiles, "needs attention" (failure rate, rate limits and
 * the month-to-date spend against the monthly budget from System Configuration),
 * then tabs (?tab=trend | breakdown | failures). Every table is sortable, paged
 * and exportable; a failure opens in a drawer with its full error.
 *
 * Controls (super admin): pause or resume every AI feature (system_config
 * ai_enabled, red, typed confirm), change the monthly spend cap and the per
 * person rate limit. All go through admin_set_config, which needs a reason
 * and records who, old value, new value and why; each is also written to the
 * console audit log. Added measures: month-end spend projection and response
 * time (p50 / p95), stated as "Not recorded" when the log has no latency.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Zap, DollarSign, AlertTriangle, Cpu, Download, Layers, TrendingUp, ListChecks, Power, Gauge, Timer, CheckCircle2, SlidersHorizontal } from 'lucide-react'
import {
  Panel, PanelHeader, StatTile, Badge, Btn, Segmented, Select, Toolbar, SearchInput,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Note, Modal, ConfirmImpactDialog,
} from '../components/ui'
import { setConfigWithReason } from '../../lib/api/consolePlatform'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  parseConfigNumber, parseConfigBool, projectMonthEnd, percentile, validateCap, aiControlImpact,
} from '../../lib/aiUsageControls'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { TrendChart, BarsChart } from '../components/ui/charts'
import { getUsageOverview } from '../../lib/api/aiOps'
import { dailySeries } from '../../lib/consoleCharts'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { supabase } from '../../lib/supabase'
import { COUNTRIES } from '../../contexts/SettingsContext'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList, ConsoleLink, TabPanel, whenText } from './shared/pageKit'

const RANGES = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
]
const COUNTRY_OPTS = [{ value: '', label: 'All countries' }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]
const TABS = ['trend', 'breakdown', 'failures']
const FAILURE_WARN = 0.05

const nf = new Intl.NumberFormat('en-US')
const usd = (v) => `$${(Number(v) || 0).toFixed((Number(v) || 0) < 1 ? 4 : 2)}`
const pct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`
const isOkRow = (r) => !r.status || r.status === 'success'

const FEATURE_EXPORT = [
  { key: 'feature', header: 'Feature' }, { key: 'calls', header: 'Successful calls' },
  { key: 'failures', header: 'Failed calls' }, { key: 'tokens', header: 'Tokens' },
  { key: 'cost', header: 'Cost USD', value: (r) => Number((r.cost || 0).toFixed(4)) },
]
const FAILURE_EXPORT = [
  { key: 'created_at', header: 'When' }, { key: 'feature', header: 'Feature', value: (r) => r.feature || 'other' },
  { key: 'model', header: 'Model' }, { key: 'status', header: 'Status' },
  { key: 'http_status', header: 'HTTP' }, { key: 'error', header: 'Error' }, { key: 'country', header: 'Country' },
]

const parseBudget = parseConfigNumber

export default function ConsoleAIUsage({ tabParam = 'tab' } = {}) {
  const [range, setRange] = useState('30')
  const [country, setCountry] = useState('')
  const [metric, setMetric] = useState('calls')
  const [tab, setTab] = useUrlTab(TABS, 'trend', tabParam)
  const [state, setState] = useState({ loading: true, error: null, data: null, readAt: null })
  const [budget, setBudget] = useState({ value: null, error: false })
  const [aiCfg, setAiCfg] = useState({ enabled: null, rateLimit: null, error: false })
  const { logAction } = useConsoleAuth()
  const [control, setControl] = useState(null) // { kind: 'pause'|'resume'|'budget'|'rate' }
  const [controlValue, setControlValue] = useState('')
  const [controlBusy, setControlBusy] = useState(false)
  const [controlError, setControlError] = useState('')
  const [flash, setFlash] = useState('')
  const [failQuery, setFailQuery] = useState('')
  const [detail, setDetail] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await getUsageOverview({ days: Number(range), country: country || undefined })
      setState({ loading: false, error: null, data, readAt: Date.now() })
    } catch (err) {
      setState({ loading: false, error: toUserMessage(err, 'Could not load AI usage.'), data: null, readAt: null })
    }
    // The monthly budget lives in System Configuration; read it alongside so
    // the spend can be judged against it. A failed read is stated, not zeroed.
    try {
      const { data, error } = await supabase.from('system_config').select('key,value')
        .in('key', ['ai_monthly_budget_usd', 'ai_enabled', 'ai_rate_limit_per_min']).limit(10)
      if (error) throw error
      const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]))
      setBudget({ value: parseBudget(map.ai_monthly_budget_usd), error: false })
      // ai_enabled defaults to on when the key was never written (CONFIG_DEFAULTS).
      const enabled = parseConfigBool(map.ai_enabled)
      setAiCfg({ enabled: enabled === null ? true : enabled, rateLimit: parseConfigNumber(map.ai_rate_limit_per_min), error: false })
    } catch {
      setBudget({ value: null, error: true })
      setAiCfg({ enabled: null, rateLimit: null, error: true })
    }
  }, [range, country])

  useEffect(() => { load() }, [load])

  const s = state.data?.summary
  const rows = useMemo(() => state.data?.rows || [], [state.data])
  const failedRows = useMemo(() => rows.filter((r) => !isOkRow(r)), [rows])

  const series = useMemo(() => {
    const days = Number(range)
    if (metric === 'cost') {
      const byDay = Object.fromEntries((s?.byDay || []).map((d) => [d.date, d.cost]))
      const base = dailySeries([], () => null, days)
      return { labels: base.labels, values: base.keys.map((k) => Number((byDay[k] || 0).toFixed(4))), label: 'Cost (USD)' }
    }
    if (metric === 'failures') {
      const d = dailySeries(failedRows, (r) => r.created_at, days)
      return { labels: d.labels, values: d.values, label: 'Failed calls' }
    }
    const d = dailySeries(rows.filter(isOkRow), (r) => r.created_at, days)
    return { labels: d.labels, values: d.values, label: 'Calls' }
  }, [rows, failedRows, s, metric, range])

  const modelBars = (s?.byModel || []).slice(0, 8).map((m) => ({ label: m.model, value: Number(m.cost.toFixed(4)) }))
  const featureBars = (s?.byFeature || []).slice(0, 8).map((f) => ({ label: f.feature, value: f.calls }))

  // Per-feature table: success figures from the shared summary, failures counted here.
  const featureRows = useMemo(() => {
    const fails = {}
    for (const r of failedRows) { const k = r.feature || 'other'; fails[k] = (fails[k] || 0) + 1 }
    const seen = new Set()
    const out = (s?.byFeature || []).map((f) => { seen.add(f.feature); return { ...f, failures: fails[f.feature] || 0 } })
    for (const [feature, n] of Object.entries(fails)) if (!seen.has(feature)) out.push({ feature, calls: 0, tokens: 0, cost: 0, failures: n })
    return out
  }, [s, failedRows])
  const { sort: fSort, onSort: onFSort } = useTableSort({ key: 'cost', dir: 'desc' })
  const featureSorted = useMemo(() => sortRows(featureRows, fSort), [featureRows, fSort])
  const featurePaged = usePaged(featureSorted, 15, `${fSort?.key}|${fSort?.dir}|${range}|${country}`)

  const { sort, setSort, onSort } = useTableSort({ key: 'created_at', dir: 'desc' })
  const failures = useMemo(() => sortRows(
    searchRows(failedRows, failQuery, ['feature', 'model', 'status', 'error']),
    sort, { feature: (r) => r.feature || 'other' },
  ), [failedRows, failQuery, sort])
  const failPaged = usePaged(failures, 20, `${failQuery}|${sort?.key}|${sort?.dir}|${range}|${country}`)

  // Month-to-date spend, only when the loaded window reaches back to the 1st.
  const mtd = useMemo(() => {
    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const covered = Number(range) >= now.getUTCDate()
    if (!covered || !s) return { covered, spend: null }
    const key = start.toISOString().slice(0, 10)
    return { covered, spend: (s.byDay || []).filter((d) => d.date >= key).reduce((a, d) => a + d.cost, 0) }
  }, [s, range])

  const projection = useMemo(() => projectMonthEnd(mtd.spend), [mtd.spend])
  const latency = useMemo(() => {
    const vals = rows.filter(isOkRow).map((r) => r.latency_ms)
    return { p50: percentile(vals, 50), p95: percentile(vals, 95) }
  }, [rows])

  function openControl(kind) {
    setControlError('')
    setControlValue(kind === 'budget' ? String(budget.value ?? 0) : kind === 'rate' ? String(aiCfg.rateLimit ?? 0) : '')
    setControl({ kind })
  }
  const controlProblem = control?.kind === 'budget' ? validateCap(controlValue, { max: 100000 })
    : control?.kind === 'rate' ? validateCap(controlValue, { max: 1000, integer: true }) : null

  async function applyControl({ reason }) {
    const kind = control?.kind
    if (!kind) return
    setControlBusy(true); setControlError('')
    try {
      if (kind === 'pause' || kind === 'resume') {
        const next = kind === 'resume'
        await setConfigWithReason('ai_enabled', next, reason)
        await logAction?.(next ? 'ai_resume' : 'ai_pause', null, 'system_config', { key: 'ai_enabled', value: next, reason })
        setFlash(next ? 'AI features are on again.' : 'AI features are paused for everyone. The copilot refuses new requests until you resume.')
      } else {
        const key = kind === 'budget' ? 'ai_monthly_budget_usd' : 'ai_rate_limit_per_min'
        const value = String(Number(controlValue))
        await setConfigWithReason(key, value, reason)
        await logAction?.('ai_config_change', null, 'system_config', { key, value, reason })
        setFlash(kind === 'budget'
          ? (Number(value) > 0 ? `Monthly AI cap set to ${usd(Number(value))}.` : 'Monthly AI cap removed.')
          : (Number(value) > 0 ? `Rate limit set to ${value} requests a minute per person.` : 'Per person rate limit removed.'))
      }
      setControl(null)
      await load()
    } catch (e) {
      setControlError(toUserMessage(e, 'The setting could not be saved. Nothing was changed.'))
    } finally {
      setControlBusy(false)
    }
  }

  const [exportError, setExportError] = useState(null)
  const exportRows = async () => {
    setExportError(null)
    try {
      await exportToExcel(rows.map((r) => ({
        when: r.created_at, model: r.model, feature: r.feature, status: r.status || 'success',
        prompt: r.prompt_tokens, completion: r.completion_tokens, cost: r.cost_usd, country: r.country,
      })), ['when', 'model', 'feature', 'status', 'prompt', 'completion', 'cost', 'country'],
      ['Time', 'Model', 'Feature', 'Status', 'Prompt tokens', 'Completion tokens', 'Cost USD', 'Country'],
      reportFileName('AI Usage', `${range} days`))
    } catch (err) {
      setExportError(toUserMessage(err, 'The export could not be created. Please try again.'))
    }
  }

  const attention = []
  if (s) {
    const rateLimited = failedRows.filter((r) => r.status === 'rate_limited').length
    if (s.failureRate > FAILURE_WARN) {
      attention.push({ key: 'fail', tone: 'danger', text: `${pct(s.failureRate)} of AI requests failed in this window (${nf.format(s.failedCalls)} users got no answer).`, actionLabel: 'See failures', onAction: () => setTab('failures') })
    } else if (s.failedCalls) {
      attention.push({ key: 'fail', tone: 'info', text: `${nf.format(s.failedCalls)} AI requests failed (${pct(s.failureRate)}).`, actionLabel: 'See failures', onAction: () => setTab('failures') })
    }
    if (rateLimited) {
      attention.push({ key: 'rl', tone: 'warning', text: `${nf.format(rateLimited)} requests were refused by the rate limit. Raise it in System Configuration if these are genuine users.`, to: '/console/config?tab=ai', actionLabel: 'AI settings' })
    }
    if (budget.value && mtd.spend != null) {
      const share = mtd.spend / budget.value
      if (share >= 0.8) {
        attention.push({ key: 'budget', tone: share >= 1 ? 'danger' : 'warning', text: `Month-to-date spend ${usd(mtd.spend)} is ${pct(share)} of the ${usd(budget.value)} monthly budget.`, to: '/console/config?tab=ai', actionLabel: 'Budget setting' })
      }
    }
    const top = (s.byFeature || [])[0]
    if (top && s.totalCost > 0 && top.cost / s.totalCost > 0.6) {
      attention.push({ key: 'conc', tone: 'info', text: `${top.feature} accounts for ${pct(top.cost / s.totalCost)} of AI spend.`, actionLabel: 'Breakdown', onAction: () => setTab('breakdown') })
    }
  }

  const budgetSub = budget.error ? 'Budget could not be read'
    : !budget.value ? 'No monthly cap set'
      : mtd.spend == null ? 'Widen the range to cover this month'
        : `${usd(mtd.spend)} of ${usd(budget.value)} this month`

  return (
    <div className="space-y-4 max-w-7xl">
      <PageHeader
        icon={Zap}
        title="AI Usage"
        purpose="Calls, tokens, spend and failures for every AI feature, from the AI request log. Pause AI, or change the monthly cap and rate limit, from here."
        refreshedAt={state.readAt}
        onRefresh={load}
        refreshing={state.loading}
        actions={(
          <>
            <Segmented value={range} onChange={setRange} options={RANGES} ariaLabel="Date range" role="group" />
            <Select value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-36" ariaLabel="Country" />
            <Btn icon={Download} onClick={exportRows} disabled={!rows.length}>Export</Btn>
          </>
        )}
      />

      {flash && <Note icon={CheckCircle2} tone="accent">{flash}</Note>}

      <Panel>
        <PanelHeader icon={SlidersHorizontal} title="AI controls"
          subtitle="Platform-wide. Each change needs a reason and is recorded with the old and new value." />
        {aiCfg.error ? (
          <ErrorState message="The AI settings could not be read, so they cannot be changed here right now." onRetry={load} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-800 p-3">
              <p className="text-[11px] text-gray-500">AI features</p>
              <p className="text-sm font-semibold text-gray-100 mt-0.5">
                {aiCfg.enabled == null ? 'N/A' : aiCfg.enabled ? <Badge tone="good">On</Badge> : <Badge tone="danger">Paused</Badge>}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">Pausing stops the copilot and AI jobs for every user.</p>
              <div className="mt-2">
                {aiCfg.enabled === false ? (
                  <Btn size="xs" variant="primary" icon={Power} onClick={() => openControl('resume')}>Resume AI</Btn>
                ) : (
                  <Btn size="xs" variant="danger" icon={Power} disabled={aiCfg.enabled == null} onClick={() => openControl('pause')}>Pause all AI</Btn>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-gray-800 p-3">
              <p className="text-[11px] text-gray-500">Monthly spend cap</p>
              <p className="text-sm font-semibold text-gray-100 mt-0.5 tabular-nums">{budget.error ? 'N/A' : budget.value ? usd(budget.value) : 'No cap'}</p>
              <p className="text-[11px] text-gray-500 mt-1">
                {projection.projected == null ? 'Month-end projection: N/A (widen the range to cover this month).' : `Projected month end: ${usd(projection.projected)}.`}
              </p>
              <div className="mt-2"><Btn size="xs" icon={DollarSign} disabled={budget.error} onClick={() => openControl('budget')}>Change cap</Btn></div>
            </div>
            <div className="rounded-lg border border-gray-800 p-3">
              <p className="text-[11px] text-gray-500">Rate limit per person</p>
              <p className="text-sm font-semibold text-gray-100 mt-0.5 tabular-nums">{aiCfg.rateLimit == null ? 'N/A' : aiCfg.rateLimit ? `${aiCfg.rateLimit} a minute` : 'No limit'}</p>
              <p className="text-[11px] text-gray-500 mt-1">Requests over the limit are refused and shown below as rate limited.</p>
              <div className="mt-2"><Btn size="xs" icon={Gauge} disabled={aiCfg.rateLimit == null} onClick={() => openControl('rate')}>Change limit</Btn></div>
            </div>
          </div>
        )}
      </Panel>

      {state.error && <ErrorState message={state.error} onRetry={load} />}
      {exportError && <Note tone="danger" icon={AlertTriangle}><span role="alert">{exportError}</span></Note>}
      {state.loading && !s && <LoadingState label="Loading AI usage" rows={4} />}

      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile icon={Zap} label="Successful calls" value={nf.format(s.totalCalls)} onClick={() => { setMetric('calls'); setTab('trend') }} active={tab === 'trend' && metric === 'calls'} />
            <StatTile icon={Layers} label="Tokens" value={nf.format(s.totalTokens)}
              sub={`${nf.format(s.promptTokens)} in, ${nf.format(s.completionTokens)} out`} />
            <StatTile icon={DollarSign} label="Spend" value={usd(s.totalCost)} tone="accent" sub={budgetSub}
              onClick={() => { setMetric('cost'); setTab('trend') }} active={tab === 'trend' && metric === 'cost'} />
            <StatTile icon={DollarSign} label="Cost per call" value={s.totalCalls ? usd(s.avgCostPerCall) : 'N/A'} />
            <StatTile icon={AlertTriangle} label="Failed calls" value={nf.format(s.failedCalls)}
              tone={s.failedCalls ? 'warning' : 'default'} onClick={() => setTab('failures')} active={tab === 'failures'} />
            <StatTile icon={Cpu} label="Failure rate" value={rows.length ? pct(s.failureRate) : 'N/A'}
              tone={s.failureRate > FAILURE_WARN ? 'danger' : 'default'} />
            <StatTile icon={TrendingUp} label="Projected month end" value={projection.projected == null ? 'N/A' : usd(projection.projected)}
              tone={budget.value && projection.projected != null && projection.projected > budget.value ? 'danger' : 'default'}
              sub={projection.projected == null ? 'Needs this month in range' : budget.value ? `Cap ${usd(budget.value)}` : 'Straight line from this month'} />
            <StatTile icon={Timer} label="Response time" value={latency.p50 == null ? 'N/A' : `${nf.format(latency.p50)} ms`}
              sub={latency.p50 == null ? 'Not recorded by the AI functions yet' : `p95 ${nf.format(latency.p95)} ms`} />
          </div>

          {/* The service pages past the server's 1,000-row cap and reports when its
              safety ceiling was hit; the old `rows.length >= 5000` test could
              never fire because the unpaged read stopped at 1,000. */}
          {state.data?.truncated && (
            <Note tone="warning" icon={AlertTriangle}>Showing the most recent {rows.length.toLocaleString()} requests in this window. Narrow the range for complete totals.</Note>
          )}

          <AttentionList items={attention} clear="AI requests are succeeding and spend is within budget." />

          <nav aria-label="AI usage views" className="flex flex-wrap items-center justify-between gap-2">
            <Segmented ariaLabel="AI usage views" value={tab} onChange={setTab} options={[
              { key: 'trend', label: <><TrendingUp size={13} aria-hidden="true" />Trend</> },
              { key: 'breakdown', label: <><Layers size={13} aria-hidden="true" />Breakdown</>, count: featureRows.length },
              { key: 'failures', label: <><ListChecks size={13} aria-hidden="true" />Failures</>, count: failedRows.length },
            ]} />
            <p className="text-[11px] text-gray-500">Models, prompts and budgets are managed in <ConsoleLink plain to="/console/ai-admin">AI Administration</ConsoleLink>.</p>
          </nav>

          {tab === 'trend' && (
            <TabPanel label="Trend">
              <Panel>
                <PanelHeader icon={Zap} title="Trend" subtitle={`Per day over the last ${range} days.`}
                  actions={<Segmented value={metric} onChange={setMetric} ariaLabel="Trend metric" role="group" options={[
                    { key: 'calls', label: 'Calls' }, { key: 'cost', label: 'Cost' }, { key: 'failures', label: 'Failures' },
                  ]} />} />
                <TrendChart labels={series.labels} series={[{ label: series.label, values: series.values }]} height={220}
                  summary={`${series.label} per day`} emptyText="No AI requests in this window." />
              </Panel>
            </TabPanel>
          )}

          {tab === 'breakdown' && (
            <TabPanel label="Breakdown">
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
              <Panel>
                <PanelHeader icon={Layers} title="By feature" subtitle="Calls, failures, tokens and cost per feature in this window."
                  actions={<ExportButtons rows={featureSorted} columns={FEATURE_EXPORT} title={`AI Usage by Feature ${range} days`} />} />
                {featureRows.length === 0 ? (
                  <EmptyState title="No AI activity" reason="No AI request was logged in this window." />
                ) : (
                  <>
                    <Table>
                      <THead>
                        <Th sortKey="feature" sort={fSort} onSort={onFSort}>Feature</Th>
                        <Th align="right" sortKey="calls" sort={fSort} onSort={onFSort}>Calls</Th>
                        <Th align="right" sortKey="failures" sort={fSort} onSort={onFSort}>Failed</Th>
                        <Th align="right" sortKey="tokens" sort={fSort} onSort={onFSort}>Tokens</Th>
                        <Th align="right" sortKey="cost" sort={fSort} onSort={onFSort}>Cost</Th>
                        <Th align="right">Share of spend</Th>
                      </THead>
                      <tbody>
                        {featurePaged.rows.map((f) => (
                          <Tr key={f.feature}>
                            <Td>{f.feature}</Td>
                            <Td align="right">{nf.format(f.calls)}</Td>
                            <Td align="right">{f.failures ? <span className="text-amber-300">{nf.format(f.failures)}</span> : '0'}</Td>
                            <Td align="right">{nf.format(f.tokens)}</Td>
                            <Td align="right">{usd(f.cost)}</Td>
                            <Td align="right">{s.totalCost > 0 ? pct(f.cost / s.totalCost) : 'N/A'}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                    <Pager paged={featurePaged} label="features" />
                  </>
                )}
              </Panel>
            </TabPanel>
          )}

          {tab === 'failures' && (
            <TabPanel label="Failures">
              <Panel>
                <PanelHeader icon={AlertTriangle} title="Failures"
                  subtitle="Rate limits, missing keys and provider errors. Each one was a user who got no answer. Click one for the full error."
                  actions={(
                    <Toolbar>
                      <SearchInput value={failQuery} onChange={setFailQuery} placeholder="Search feature, model or error" className="w-full sm:w-56" ariaLabel="Search failures" />
                      <ExportButtons rows={failures} columns={FAILURE_EXPORT} title={`AI Failures ${range} days`} />
                    </Toolbar>
                  )} />
                {!failedRows.length ? (
                  <EmptyState title="No failed requests" reason="Every AI request in this window succeeded." />
                ) : !failures.length ? (
                  <EmptyState title="No failure matches" reason="Clear the search to see every failure."
                    action={<Btn onClick={() => setFailQuery('')}>Clear search</Btn>} />
                ) : (
                  <>
                    <Table>
                      <THead>
                        <Th sortKey="created_at" sort={sort} onSort={onSort}>When</Th>
                        <Th sortKey="feature" sort={sort} onSort={onSort}>Feature</Th>
                        <Th sortKey="model" sort={sort} onSort={onSort}>Model</Th>
                        <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th><Th>Error</Th>
                      </THead>
                      <tbody>
                        {failPaged.rows.map((r, i) => (
                          <Tr key={r.id || `${r.created_at}:${i}`} onClick={() => setDetail(r)} ariaLabel={`Failure ${r.feature || 'other'} ${r.status || ''}`.trim()}>
                            <Td nowrap><span className="text-gray-500 tabular-nums">{whenText(r.created_at)}</span></Td>
                            <Td>{r.feature || 'other'}</Td>
                            <Td><span className="font-mono text-[11px] text-gray-400">{r.model || 'unknown'}</span></Td>
                            <Td><Badge tone={r.status === 'rate_limited' ? 'warning' : 'danger'}>{String(r.status || 'error').replace(/_/g, ' ')}</Badge></Td>
                            <Td><span className="text-gray-400 line-clamp-2 break-words">{r.error || (r.http_status ? `HTTP ${r.http_status}` : 'N/A')}</span></Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                    <Pager paged={failPaged} label="failures" />
                    {sort?.key !== 'created_at' && <Btn size="xs" onClick={() => setSort({ key: 'created_at', dir: 'desc' })}>Newest first</Btn>}
                  </>
                )}
              </Panel>
            </TabPanel>
          )}
        </>
      )}

      <ConfirmImpactDialog
        open={!!control}
        title={control?.kind === 'pause' ? 'Pause all AI?' : control?.kind === 'resume' ? 'Resume AI?' : control?.kind === 'budget' ? 'Change the monthly AI cap?' : 'Change the AI rate limit?'}
        impact={control ? aiControlImpact(control.kind, { budget: budget.value, rateLimit: aiCfg.rateLimit, next: controlValue }) : null}
        confirmLabel={control?.kind === 'pause' ? 'Pause all AI' : control?.kind === 'resume' ? 'Resume AI' : 'Save'}
        danger={control?.kind === 'pause'}
        typedWord={control?.kind === 'pause' ? 'PAUSE AI' : undefined}
        requireReason
        busy={controlBusy}
        error={controlError}
        readyExtra={!controlProblem}
        onCancel={() => { if (!controlBusy) setControl(null) }}
        onConfirm={applyControl}
      >
        {(control?.kind === 'budget' || control?.kind === 'rate') && (
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-400 mb-1">
              {control.kind === 'budget' ? 'Monthly cap in US dollars (0 = no cap)' : 'Requests per person per minute (0 = no limit)'}
            </span>
            <input type="number" min="0" step={control.kind === 'budget' ? '0.01' : '1'} value={controlValue}
              onChange={(e) => setControlValue(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
            {controlProblem && <span className="block text-[11px] text-amber-300 mt-1">{controlProblem}</span>}
          </label>
        )}
      </ConfirmImpactDialog>

      <Modal open={!!detail} onClose={() => setDetail(null)} width="max-w-lg"
        title={detail ? `Failed request: ${detail.feature || 'other'}` : ''}
        subtitle={detail ? whenText(detail.created_at) : ''}
        footer={<Btn onClick={() => setDetail(null)}>Close</Btn>}>
        {detail && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <Badge tone={detail.status === 'rate_limited' ? 'warning' : 'danger'}>{String(detail.status || 'error').replace(/_/g, ' ')}</Badge>
              {detail.country && <Badge>{detail.country}</Badge>}
            </div>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-gray-400">
              <dt className="text-gray-500">Model</dt><dd className="col-span-2 font-mono break-all">{detail.model || 'unknown'}</dd>
              <dt className="text-gray-500">HTTP status</dt><dd className="col-span-2">{detail.http_status ?? 'N/A'}</dd>
              <dt className="text-gray-500">Latency</dt><dd className="col-span-2">{detail.latency_ms != null ? `${nf.format(detail.latency_ms)} ms` : 'N/A'}</dd>
            </dl>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Error</p>
              <p className="text-red-300 whitespace-pre-wrap break-words">{detail.error || 'No error text was recorded.'}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
