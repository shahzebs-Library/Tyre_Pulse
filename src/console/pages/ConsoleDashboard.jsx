/**
 * ConsoleDashboard.jsx - the super-admin overview.
 *
 * What a console visit is usually for, in order: anything waiting on you, the
 * security score, the platform at a glance, then trends. Every panel loads on
 * its own and a failed panel says so instead of showing a silent zero.
 *
 * AI usage reads ai_token_logs, the single AI usage source (V236). The previous
 * version read ai_usage_log, which is empty, so it always reported no usage.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Building2, Database, Zap, Shield, ClipboardCheck,
  Truck, UserPlus, Activity, ChevronRight, ShieldCheck,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, Table, THead, Th, Tr, Td,
  EmptyState, ErrorState, LoadingState,
} from '../components/ui'
import { TrendChart, BarsChart, ShareChart, ScoreRing } from '../components/ui/charts'
import { loadAttentionInputs } from '../../lib/api/consoleAttention'
import { buildAttention } from '../../lib/consoleAttention'
import { getSecurityPosture } from '../../lib/api/securityAudit'
import { fetchAllPages } from '../../lib/fetchAll'
import { dailySeries, topShare } from '../../lib/consoleCharts'
import { PageHeader as OpsPageHeader, ConsoleLink, useUrlTab, Pager, usePaged } from './shared/pageKit'
import ExportButtons from './shared/ExportButtons'
import { sortRows, useTableSort } from '../../lib/consoleTable'

const nf = new Intl.NumberFormat('en-US')
const AI_ROW_CEILING = 50000
const fmt = (n) => (n === null || n === undefined ? 'N/A' : nf.format(Number(n)))
const fmtWhen = (v) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'N/A')

function useLoader(fn, deps) {
  const [s, set] = useState({ loading: true, error: null, data: null })
  const run = useCallback(async () => {
    set((p) => ({ ...p, loading: true, error: null }))
    try {
      set({ loading: false, error: null, data: await fn() })
    } catch (err) {
      set({ loading: false, error: toUserMessage(err, 'Could not load this panel.'), data: null })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return [s, run]
}

export default function ConsoleDashboard() {
  const { activeOrg } = useConsoleAuth()
  const navigate = useNavigate()
  const orgId = activeOrg?.id || null

  const [stats, loadStats] = useLoader(async () => {
    const { data, error } = await supabase.rpc('get_console_stats')
    if (error) throw error
    return data
  }, [])

  const [attention, loadAttention] = useLoader(async () => buildAttention(await loadAttentionInputs()), [])
  const [security, loadSecurity] = useLoader(() => getSecurityPosture(), [])

  const [people, loadPeople] = useLoader(async () => {
    const { data, error } = await fetchAllPages((from, to) => {
      let q = supabase.from('profiles').select('id, role, created_at, approved, locked').order('id').range(from, to)
      if (orgId) q = q.eq('organisation_id', orgId)
      return q
    }, { max: 20000 })
    if (error) throw error
    return data
  }, [orgId])

  const [ai, loadAi] = useLoader(async () => {
    // Paged past the 1,000-row response cap with an id tiebreak, so a busy
    // month is counted in full rather than silently stopping at 1,000 calls.
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data, error, truncated } = await fetchAllPages((from, to) => supabase
      .from('ai_token_logs')
      .select('id, created_at, status, cost_usd')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to), { max: AI_ROW_CEILING })
    if (error) throw error
    return Object.assign(data || [], { truncated: !!truncated })
  }, [])

  const [actions, loadActions] = useLoader(async () => {
    const { data, error } = await supabase
      .from('console_sessions')
      .select('id, action, target_type, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return data || []
  }, [])

  const [refreshedAt, setRefreshedAt] = useState(null)
  const [tab, setTab] = useUrlTab(['overview', 'people', 'ai', 'activity'], 'overview')
  const loadAll = useCallback(() => {
    loadStats(); loadAttention(); loadSecurity(); loadPeople(); loadAi(); loadActions()
    setRefreshedAt(new Date().toISOString())
  }, [loadStats, loadAttention, loadSecurity, loadPeople, loadAi, loadActions])

  useEffect(() => { loadAll() }, [loadAll])

  // A failed or pending stats read must never render as "0 pending": every
  // sub line falls back to N/A unless the number was actually read.
  const statsOk = !!stats.data && !stats.error
  const U = stats.data?.users ?? {}
  const O = stats.data?.organisations ?? {}
  const A = stats.data?.assets ?? {}

  const signups = useMemo(() => dailySeries(people.data || [], (r) => r.created_at, 30), [people.data])
  const roles = useMemo(() => topShare(people.data || [], (r) => r.role, 5), [people.data])
  const aiDaily = useMemo(() => dailySeries(ai.data || [], (r) => r.created_at, 30), [ai.data])
  const aiFailed = useMemo(() => (ai.data || []).filter((r) => r.status && r.status !== 'success').length, [ai.data])
  const aiCost = useMemo(() => (ai.data || []).reduce((a, r) => a + (Number(r.cost_usd) || 0), 0), [ai.data])

  const assetBars = [
    { label: 'Tyre records', value: Number(A.tyres) || 0 },
    { label: 'Inspections', value: Number(A.inspections) || 0 },
    { label: 'Vehicles', value: Number(A.vehicles) || 0 },
  ]

  const { sort: actSort, onSort: onActSort } = useTableSort({ key: 'created_at', dir: 'desc' })
  const sortedActions = useMemo(() => sortRows(actions.data || [], actSort), [actions.data, actSort])
  const actPaged = usePaged(sortedActions, 10, `${actSort?.key}${actSort?.dir}`)
  const busy = stats.loading || people.loading || ai.loading
  const accountStates = useMemo(() => {
    const rows = people.data || []
    return {
      approved: rows.filter((r) => r.approved === true && r.locked !== true).length,
      pending: rows.filter((r) => r.approved !== true).length,
      locked: rows.filter((r) => r.locked === true).length,
    }
  }, [people.data])

  return (
    <div className="space-y-4 max-w-7xl">
      <OpsPageHeader
        title="System Overview"
        purpose={activeOrg ? `What needs you, and the platform at a glance, for ${activeOrg.name}.` : 'What needs you, and the platform at a glance, across all organisations.'}
        primary={attention.data?.length ? (
          <Btn variant="primary" icon={ClipboardCheck} onClick={() => navigate(attention.data[0].to)}
            title={attention.data[0].text}>Start with the most urgent</Btn>
        ) : null}
        refreshedAt={refreshedAt}
        onRefresh={loadAll}
        busy={busy}
      />

      {/* Waiting on you: announced when it finishes loading, so a screen
          reader hears whether anything needs action without hunting for it. */}
      <div aria-live="polite">
      {attention.loading && !attention.data && !attention.error ? (
        <Panel><LoadingState label="Checking what is waiting on you" rows={2} /></Panel>
      ) : attention.error ? (
        <Note tone="warning" icon={Shield}>Could not check what is waiting on you. {attention.error}</Note>
      ) : attention.data && (
        <Panel tone={attention.data.length ? 'accent' : undefined}>
          <PanelHeader icon={ClipboardCheck}
            title={attention.data.length ? 'Waiting on you' : 'Nothing is waiting on you'}
            subtitle={attention.data.length ? 'Each line opens the page that clears it.' : 'No pending approvals, unresolved errors, stale feeds or open alerts.'} />
          {attention.data.length > 0 && (
            <div className="space-y-1">
              {attention.data.map((a) => (
                <button key={a.key} type="button" onClick={() => navigate(a.to)}
                  className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-gray-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                  <Badge tone={a.tone === 'danger' ? 'danger' : a.tone === 'warning' ? 'warning' : 'info'}>
                    {a.tone === 'danger' ? 'Urgent' : a.tone === 'warning' ? 'Review' : 'Info'}
                  </Badge>
                  <span className="text-xs text-gray-200 flex-1 min-w-0 break-words">{a.text}</span>
                  <ChevronRight size={13} className="text-gray-500 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile icon={Users} label="Users" value={fmt(U.total)} sub={statsOk ? `${fmt(U.pending ?? 0)} pending approval` : 'Pending approvals: N/A'}
          onClick={() => navigate('/console/users')} tone={Number(U.pending) > 0 ? 'accent' : 'default'} />
        <StatTile icon={UserPlus} label="New this week" value={fmt(U.new_week)} sub={statsOk ? `${fmt(U.new_today ?? 0)} today` : 'Today: N/A'}
          onClick={() => setTab('people')} active={tab === 'people'} />
        <StatTile icon={Shield} label="Locked accounts" value={statsOk ? fmt(U.locked ?? 0) : 'N/A'}
          tone={Number(U.locked) > 0 ? 'warning' : 'default'} onClick={() => navigate('/console/users')} />
        <StatTile icon={Building2} label="Organisations" value={fmt(O.total)} sub={statsOk ? `${fmt(O.active ?? 0)} active` : 'Active: N/A'}
          onClick={() => navigate('/console/organisations')} />
        <StatTile icon={Truck} label="Vehicles" value={fmt(A.vehicles)} sub="registered" />
        <StatTile icon={Zap} label="AI calls (30d)" value={ai.error || !ai.data ? 'N/A' : fmt(aiDaily.total)}
          sub={ai.error || !ai.data ? 'Failures: N/A' : aiFailed ? `${aiFailed} failed` : 'no failures'} tone={aiFailed ? 'warning' : 'default'}
          onClick={() => navigate('/console/ai-usage')} />
      </div>
      {stats.error && <ErrorState message={stats.error} onRetry={loadStats} />}

      <Segmented value={tab} onChange={setTab} ariaLabel="Overview sections" options={[
        { key: 'overview', label: 'Overview' },
        { key: 'people', label: 'People', count: people.data ? people.data.length : undefined },
        { key: 'ai', label: 'AI usage', count: ai.data && !ai.error ? aiDaily.total : undefined },
        { key: 'activity', label: 'Console activity' },
      ]} />

      {tab === 'overview' && (<div role="tabpanel" aria-label="Overview" className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader icon={ShieldCheck} title="Security"
            actions={<Btn size="xs" onClick={() => navigate('/console/security-audit')}>Open audit</Btn>} />
          {security.error ? (
            <ErrorState message={`Could not read the security score. ${security.error}`} onRetry={loadSecurity} />
          ) : (
            <>
              <ScoreRing score={security.data?.score ?? null} size={104} label="Security score" />
              <p className="text-xs text-gray-500 mt-3">
                {security.data
                  ? `${security.data.checks.filter((c) => c.status === 'fail' || c.status === 'warn').length} open findings across ${security.data.checks.length} checks.`
                  : 'Reading checks...'}
              </p>
            </>
          )}
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader icon={UserPlus} title="New users, last 30 days"
            subtitle={people.error ? 'Could not read registrations.' : `${fmt(signups.total)} registrations in the window.`} />
          {people.error ? <ErrorState message={people.error} onRetry={loadPeople} /> : people.loading && !people.data ? <LoadingState label="Loading registrations" rows={3} /> : (
            <TrendChart labels={signups.labels} series={[{ label: 'New users', values: signups.values }]}
              height={190} summary={`${signups.total} new users in 30 days`}
              emptyText="No registrations in the last 30 days." />
          )}
        </Panel>
      </div>

        <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader icon={Database} title="Platform data" subtitle="Records held across every organisation." />
          {stats.error ? (
            <EmptyState title="Platform data unavailable" reason="The platform counts could not be read, so nothing is shown rather than zeros." />
          ) : stats.loading && !stats.data ? <LoadingState label="Loading platform data" rows={3} /> : (
            <BarsChart bars={assetBars} height={170} valueFormat={(v) => nf.format(v)}
              summary={assetBars.map((b) => `${b.label} ${b.value}`).join(', ')} emptyText="No records yet." />
          )}
        </Panel>
        <Panel>
          <PanelHeader icon={Activity} title="Where to go next" subtitle="The pages behind these numbers." />
          <div className="flex flex-wrap gap-2">
            <ConsoleLink to="/console/health" icon={Activity}>System health</ConsoleLink>
            <ConsoleLink to="/console/incidents" icon={Shield}>Incidents</ConsoleLink>
            <ConsoleLink to="/console/control-center" icon={ShieldCheck}>Data trust</ConsoleLink>
            <ConsoleLink to="/console/crash-reports" icon={Zap}>Crash reports</ConsoleLink>
            <ConsoleLink to="/console/self-healing" icon={Database}>Self-healing</ConsoleLink>
            <ConsoleLink to="/console/users" icon={Users}>Users</ConsoleLink>
          </div>
        </Panel>
        </div>
      </div>)}

      {tab === 'people' && (
        <div role="tabpanel" aria-label="People" className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
        <Panel>
          <PanelHeader icon={Users} title="Users by role" subtitle="The five largest roles, the rest grouped as Other." />
          {people.error ? <ErrorState message={people.error} onRetry={loadPeople} /> : people.loading && !people.data ? <LoadingState label="Loading users" rows={3} /> : (
            <ShareChart parts={roles} height={170} center={{ value: fmt((people.data || []).length), label: 'users' }}
              summary={roles.map((r) => `${r.label} ${r.value}`).join(', ')} emptyText="No users yet." />
          )}
        </Panel>
          </div>
          <Panel>
            <PanelHeader icon={Shield} title="Account states" subtitle={orgId ? 'This organisation.' : 'Every organisation.'}
              actions={<Btn size="xs" onClick={() => navigate('/console/users')}>Open users</Btn>} />
            {people.error ? <ErrorState message={people.error} onRetry={loadPeople} /> : people.loading && !people.data ? <LoadingState label="Loading users" rows={3} /> : (
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Approved" value={fmt(accountStates.approved)} tone="good" />
                <StatTile label="Waiting approval" value={fmt(accountStates.pending)} tone={accountStates.pending ? 'accent' : 'default'}
                  onClick={() => navigate('/console/users')} />
                <StatTile label="Locked" value={fmt(accountStates.locked)} tone={accountStates.locked ? 'warning' : 'default'}
                  onClick={() => navigate('/console/users')} />
                <StatTile label="New in 30 days" value={fmt(signups.total)} />
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'ai' && (
        <div role="tabpanel" aria-label="AI usage" className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader icon={Zap} title="AI usage, last 30 days"
            subtitle={ai.error ? 'Could not read AI usage.' : `${fmt(aiDaily.total)} calls, estimated cost $${aiCost.toFixed(2)}.${ai.data?.truncated ? ` Capped at the first ${nf.format(AI_ROW_CEILING)} calls.` : ''}`}
            actions={<Btn size="xs" onClick={() => navigate('/console/ai-usage')}>Details</Btn>} />
          {ai.error ? <ErrorState message={ai.error} onRetry={loadAi} /> : ai.loading && !ai.data ? <LoadingState label="Loading AI usage" rows={3} /> : (
            <TrendChart labels={aiDaily.labels} series={[{ label: 'AI calls', values: aiDaily.values }]}
              height={180} summary={`${aiDaily.total} AI calls in 30 days`}
              emptyText="No AI calls in the last 30 days." />
          )}
        </Panel>
          <Panel>
            <PanelHeader icon={Zap} title="AI health, 30 days" subtitle="Share of calls that failed and what they cost." />
            {ai.error ? <ErrorState message={ai.error} onRetry={loadAi} /> : ai.loading && !ai.data ? <LoadingState label="Loading AI usage" rows={2} /> : (
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Failure rate" value={aiDaily.total ? `${Math.round((aiFailed / aiDaily.total) * 100)}%` : 'N/A'}
                  sub={aiDaily.total ? `${aiFailed} of ${aiDaily.total}` : 'No calls'} tone={aiFailed ? 'warning' : 'good'} />
                <StatTile label="Estimated cost" value={`$${aiCost.toFixed(2)}`} sub={aiDaily.total ? `$${(aiCost / aiDaily.total).toFixed(4)} per call` : 'No calls'} />
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'activity' && (
        <div role="tabpanel" aria-label="Console activity">
        <Panel flush>
          <div className="p-4 pb-2">
            <PanelHeader icon={Activity} title="Recent console actions" subtitle="The latest 50 actions taken in this console."
              actions={(<>
                <ExportButtons rows={actions.data || []} title="Recent Console Actions" disabled={!!actions.error} columns={[
                  { key: 'action', header: 'Action', value: (r) => String(r.action || '').replace(/_/g, ' ') },
                  { key: 'target_type', header: 'Target' },
                  { key: 'created_at', header: 'When' },
                ]} />
                <Btn size="xs" onClick={() => navigate('/console/audit-trail')}>Audit trail</Btn>
              </>)} />
          </div>
          {actions.error ? (
            <div className="px-4 pb-4"><ErrorState message={actions.error} onRetry={loadActions} /></div>
          ) : actions.loading && !actions.data ? (
            <div className="px-4 pb-4"><LoadingState label="Loading console actions" rows={3} /></div>
          ) : !actions.data?.length ? (
            <div className="px-4 pb-4"><EmptyState title="No console actions yet" reason="Actions taken in this console are recorded here once someone takes one." /></div>
          ) : (
            <Table className="border-0 rounded-none">
              <THead><Th sortKey="action" sort={actSort} onSort={onActSort}>Action</Th><Th sortKey="target_type" sort={actSort} onSort={onActSort}>Target</Th><Th align="right" sortKey="created_at" sort={actSort} onSort={onActSort}>When</Th></THead>
              <tbody>
                {actPaged.slice.map((a) => (
                  <Tr key={a.id}>
                    <Td><span className="text-gray-300 capitalize">{String(a.action).replace(/_/g, ' ')}</span></Td>
                    <Td><span className="text-gray-500">{a.target_type ? String(a.target_type).replace(/_/g, ' ') : 'N/A'}</span></Td>
                    <Td align="right" nowrap><span className="text-gray-500 tabular-nums">{fmtWhen(a.created_at)}</span></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {actions.data?.length > 0 && <div className="px-4 pb-3"><Pager {...actPaged} size={10} label="actions" /></div>}
        </Panel>
        </div>
      )}
    </div>
  )
}
