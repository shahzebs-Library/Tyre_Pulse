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
  Users, Building2, Database, Zap, Shield, RefreshCw, ClipboardCheck,
  Truck, UserPlus, Activity, ChevronRight, ShieldCheck,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Table, THead, Th, Tr, Td,
  EmptyState, ErrorState,
} from '../components/ui'
import { TrendChart, BarsChart, ShareChart, ScoreRing } from '../components/ui/charts'
import { loadAttentionInputs } from '../../lib/api/consoleAttention'
import { buildAttention } from '../../lib/consoleAttention'
import { getSecurityPosture } from '../../lib/api/securityAudit'
import { fetchAllPages } from '../../lib/fetchAll'
import { dailySeries, topShare } from '../../lib/consoleCharts'

const nf = new Intl.NumberFormat('en-US')
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
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data, error } = await supabase
      .from('ai_token_logs')
      .select('created_at, status, cost_usd')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(1000)
    if (error) throw error
    return data || []
  }, [])

  const [actions, loadActions] = useLoader(async () => {
    const { data, error } = await supabase
      .from('console_sessions')
      .select('id, action, target_type, created_at')
      .order('created_at', { ascending: false })
      .limit(8)
    if (error) throw error
    return data || []
  }, [])

  const loadAll = useCallback(() => {
    loadStats(); loadAttention(); loadSecurity(); loadPeople(); loadAi(); loadActions()
  }, [loadStats, loadAttention, loadSecurity, loadPeople, loadAi, loadActions])

  useEffect(() => { loadAll() }, [loadAll])

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

  const busy = stats.loading || people.loading || ai.loading

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>System Overview</h1>
          <p className="text-xs text-gray-500 mt-1">
            {activeOrg ? `Showing ${activeOrg.name}` : 'All organisations, live data'}
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={loadAll} busy={busy}>Refresh</Btn>
      </header>

      {/* Waiting on you */}
      {attention.error ? (
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
                  className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-gray-800/50 transition-colors">
                  <Badge tone={a.tone === 'danger' ? 'danger' : a.tone === 'warning' ? 'warning' : 'info'}>
                    {a.tone === 'danger' ? 'Urgent' : a.tone === 'warning' ? 'Review' : 'Info'}
                  </Badge>
                  <span className="text-xs text-gray-200 flex-1">{a.text}</span>
                  <ChevronRight size={13} className="text-gray-500" />
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/* Headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile icon={Users} label="Users" value={fmt(U.total)} sub={`${fmt(U.pending ?? 0)} pending approval`}
          onClick={() => navigate('/console/users')} tone={Number(U.pending) > 0 ? 'accent' : 'default'} />
        <StatTile icon={UserPlus} label="New this week" value={fmt(U.new_week)} sub={`${fmt(U.new_today ?? 0)} today`} />
        <StatTile icon={Shield} label="Locked accounts" value={fmt(U.locked ?? 0)}
          tone={Number(U.locked) > 0 ? 'warning' : 'default'} onClick={() => navigate('/console/users')} />
        <StatTile icon={Building2} label="Organisations" value={fmt(O.total)} sub={`${fmt(O.active ?? 0)} active`}
          onClick={() => navigate('/console/organisations')} />
        <StatTile icon={Truck} label="Vehicles" value={fmt(A.vehicles)} sub="registered" />
        <StatTile icon={Zap} label="AI calls (30d)" value={ai.error ? 'N/A' : fmt(aiDaily.total)}
          sub={aiFailed ? `${aiFailed} failed` : 'no failures'} tone={aiFailed ? 'warning' : 'default'}
          onClick={() => navigate('/console/ai-usage')} />
      </div>
      {stats.error && <ErrorState message={stats.error} onRetry={loadStats} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader icon={ShieldCheck} title="Security"
            actions={<Btn size="xs" onClick={() => navigate('/console/security-audit')}>Open audit</Btn>} />
          {security.error ? (
            <p className="text-xs text-gray-500">Could not read the security score. {security.error}</p>
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
            subtitle={people.error ? people.error : `${fmt(signups.total)} registrations in the window.`} />
          <TrendChart labels={signups.labels} series={[{ label: 'New users', values: signups.values }]}
            height={190} summary={`${signups.total} new users in 30 days`}
            emptyText="No registrations in the last 30 days." />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader icon={Users} title="Users by role" subtitle="The five largest roles, the rest grouped as Other." />
          {people.error ? <ErrorState message={people.error} onRetry={loadPeople} /> : (
            <ShareChart parts={roles} height={170} center={{ value: fmt((people.data || []).length), label: 'users' }}
              summary={roles.map((r) => `${r.label} ${r.value}`).join(', ')} emptyText="No users yet." />
          )}
        </Panel>
        <Panel>
          <PanelHeader icon={Database} title="Platform data" subtitle="Records held across every organisation." />
          <BarsChart bars={assetBars} height={170} valueFormat={(v) => nf.format(v)}
            summary={assetBars.map((b) => `${b.label} ${b.value}`).join(', ')} emptyText="No records yet." />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader icon={Zap} title="AI usage, last 30 days"
            subtitle={ai.error ? ai.error : `${fmt(aiDaily.total)} calls, estimated cost $${aiCost.toFixed(2)}.`}
            actions={<Btn size="xs" onClick={() => navigate('/console/ai-usage')}>Details</Btn>} />
          <TrendChart labels={aiDaily.labels} series={[{ label: 'AI calls', values: aiDaily.values }]}
            height={180} summary={`${aiDaily.total} AI calls in 30 days`}
            emptyText="No AI calls in the last 30 days." />
        </Panel>
        <Panel flush>
          <div className="p-4 pb-2">
            <PanelHeader icon={Activity} title="Recent console actions"
              actions={<Btn size="xs" onClick={() => navigate('/console/audit-trail')}>Audit trail</Btn>} />
          </div>
          {actions.error ? (
            <div className="px-4 pb-4"><ErrorState message={actions.error} onRetry={loadActions} /></div>
          ) : !actions.data?.length ? (
            <div className="px-4 pb-4"><EmptyState title="No console actions yet" /></div>
          ) : (
            <Table className="border-0 rounded-none">
              <THead><Th>Action</Th><Th align="right">When</Th></THead>
              <tbody>
                {actions.data.map((a) => (
                  <Tr key={a.id}>
                    <Td><span className="text-gray-300 capitalize">{String(a.action).replace(/_/g, ' ')}</span></Td>
                    <Td align="right" nowrap><span className="text-gray-500 tabular-nums">{fmtWhen(a.created_at)}</span></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </div>
  )
}
