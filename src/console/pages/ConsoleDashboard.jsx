/**
 * ConsoleDashboard.jsx - the Control Center Overview at /console.
 *
 * Order is what a super admin opens the console for: what state the platform
 * is in (status strip), the headline numbers, what needs action (ranked by
 * risk), live health beside the switches that change behaviour, background
 * jobs beside errors, security beside recent admin activity, then trends.
 *
 * Every panel loads on its own and a failed panel says so. Nothing is faked:
 * a number with no source reads "N/A" or "Not recorded" and says why.
 * Every switch opens a confirm with a reason and a plain-English impact box;
 * maintenance mode additionally needs the word PRODUCTION typed out.
 *
 * AI usage reads ai_token_logs, the single AI usage source (V236).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Database, Zap, Shield, ClipboardCheck, UserPlus, Activity, ShieldCheck,
  CreditCard, PenLine, AlertTriangle, SlidersHorizontal, Timer, Bug, History, TrendingUp,
  CheckCircle2, XCircle, HelpCircle, MinusCircle,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, Table, THead, Th, Tr, Td,
  EmptyState, ErrorState, LoadingState, ConfirmImpactDialog,
} from '../components/ui'
import { TrendChart, BarsChart, ShareChart, ScoreRing } from '../components/ui/charts'
import { loadAttentionInputs } from '../../lib/api/consoleAttention'
import { buildAttention } from '../../lib/consoleAttention'
import { getSecurityPosture } from '../../lib/api/securityAudit'
import { getMobileOps } from '../../lib/api/mobileOps'
import { listBackupSnapshots } from '../../lib/api/backups'
import { listCronJobs, summarizeCron } from '../../lib/api/automationHealth'
import { runAllChecks } from '../../lib/systemHealth'
import { installedRelease } from '../../lib/releases'
import {
  loadActiveUsers, loadRecordsWritten, loadRecentErrors, loadRecentAdminActivity,
  loadMaintenanceImpact, buildActionQueue, groupErrors, severityCounts,
} from '../../lib/api/consoleOverview'
import { loadSystemConfig, isSystemConfigLoaded, configBool, saveSystemConfigValues } from '../../lib/api/systemConfig'
import { fetchAllPages } from '../../lib/fetchAll'
import { dailySeries, topShare } from '../../lib/consoleCharts'
import { PageHeader as OpsPageHeader, ConsoleLink, useUrlTab, Pager, usePaged, ageText } from './shared/pageKit'
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

/**
 * The switches on the Overview. Every one is a real system_config key already
 * enforced somewhere (see ENFORCEMENT_STATUS in lib/api/systemConfig.js).
 */
export const PLATFORM_SWITCHES = [
  { key: 'maintenance_mode', label: 'Maintenance mode', desc: 'Blocks everyone except admins on web and phone.', who: 'Every approved user who is not an Admin or super admin.', danger: true },
  { key: 'registration_open', label: 'New registrations', desc: 'The sign-up form on web and phone.', who: 'People who do not have an account yet.' },
  { key: 'require_approval', label: 'Approve new users first', desc: 'New accounts wait for an admin before they get in.', who: 'Everyone who signs up from now on.' },
  { key: 'two_factor_required', label: 'Two-factor for admins', desc: 'Admins are asked to enrol an authenticator.', who: 'Every Admin and super admin.' },
  { key: 'export_enabled', label: 'Exports (Excel, PDF, PowerPoint)', desc: 'Download buttons across the app.', who: 'Every user who downloads reports.' },
  { key: 'email_notifications', label: 'Email notifications', desc: 'Reports and workflow emails.', who: 'Everyone who receives report or workflow email.' },
  { key: 'push_notifications', label: 'Push notifications', desc: 'Phone alerts to registered devices.', who: 'Everyone with the phone app and a push token.' },
  { key: 'ai_enabled', label: 'AI assistant', desc: 'Chat and AI analysis in the app.', who: 'Every user of the AI features.' },
  { key: 'backup_enabled', label: 'Nightly backup', desc: 'The scheduled snapshot of core tables.', who: 'Nobody directly. It decides whether a nightly restore point exists.' },
]

/** Plain-English impact for flipping one switch. Pure. */
export function switchImpact(sw, next) {
  return {
    tone: sw.danger && next ? 'danger' : 'warning',
    what: `${sw.label} will be turned ${next ? 'on' : 'off'}.`,
    change: `${sw.desc} ${next ? 'Starts applying' : 'Stops applying'} on the next page load or request.`,
    who: sw.who,
    undo: 'Yes. Switch it back here or in System Settings; the change and your reason are in the audit log.',
  }
}

const LEVEL_TONE = { critical: 'danger', high: 'warning', medium: 'accent', low: 'default' }
const LEVEL_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const HEALTH_ICON = { ok: CheckCircle2, degraded: AlertTriangle, down: XCircle, unknown: HelpCircle }
const HEALTH_TONE = { ok: 'good', degraded: 'warning', down: 'danger', unknown: 'default' }
const HEALTH_LABEL = { ok: 'Operational', degraded: 'Slow or partial', down: 'Down', unknown: 'Unknown' }

export default function ConsoleDashboard() {
  const { activeOrg, logAction } = useConsoleAuth()
  const navigate = useNavigate()
  const orgId = activeOrg?.id || null

  const [stats, loadStats] = useLoader(async () => {
    const { data, error } = await supabase.rpc('get_console_stats')
    if (error) throw error
    return data
  }, [])
  const [attention, loadAttention] = useLoader(async () => buildAttention(await loadAttentionInputs()), [])
  const [security, loadSecurity] = useLoader(() => getSecurityPosture(), [])
  const [mobile, loadMobile] = useLoader(() => getMobileOps(), [])
  const [backups, loadBackups] = useLoader(() => listBackupSnapshots(1), [])
  const [cron, loadCron] = useLoader(async () => summarizeCron(await listCronJobs()), [])
  const [health, loadHealth] = useLoader(() => runAllChecks(), [])
  const [active, loadActive] = useLoader(() => loadActiveUsers(), [])
  const [written, loadWritten] = useLoader(() => loadRecordsWritten(), [])
  const [errors, loadErrors] = useLoader(() => loadRecentErrors(), [])
  const [adminActs, loadAdminActs] = useLoader(() => loadRecentAdminActivity(12), [])
  const [config, loadConfig] = useLoader(async () => {
    await loadSystemConfig({ force: true })
    if (!isSystemConfigLoaded()) throw new Error('Could not read the platform switches.')
    return Object.fromEntries(PLATFORM_SWITCHES.map((s) => [s.key, configBool(s.key)]))
  }, [])

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
    loadStats(); loadAttention(); loadSecurity(); loadMobile(); loadBackups(); loadCron(); loadHealth()
    loadActive(); loadWritten(); loadErrors(); loadAdminActs(); loadConfig(); loadPeople(); loadAi(); loadActions()
    setRefreshedAt(new Date().toISOString())
  }, [loadStats, loadAttention, loadSecurity, loadMobile, loadBackups, loadCron, loadHealth, loadActive,
    loadWritten, loadErrors, loadAdminActs, loadConfig, loadPeople, loadAi, loadActions])

  useEffect(() => { loadAll() }, [loadAll])

  /* ── switch confirm ─────────────────────────────────────────────────────── */
  const [pending, setPending] = useState(null) // { sw, next }
  const [switchBusy, setSwitchBusy] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const [maintImpact, setMaintImpact] = useState(null)

  async function askSwitch(sw, next) {
    setSwitchError('')
    setPending({ sw, next })
    if (sw.key === 'maintenance_mode' && next) {
      setMaintImpact(null)
      try { setMaintImpact(await loadMaintenanceImpact()) } catch { setMaintImpact({ blocked: null, today: null, phones: null }) }
    }
  }

  async function applySwitch({ reason } = {}) {
    if (!pending) return
    setSwitchBusy(true); setSwitchError('')
    try {
      await saveSystemConfigValues({ [pending.sw.key]: pending.next })
      try { await logAction('update_config', null, 'system', { keys: [pending.sw.key], value: String(pending.next), reason }) } catch { /* audit is best effort */ }
      setPending(null)
      loadConfig(); loadAdminActs()
    } catch (err) {
      setSwitchError(toUserMessage(err, 'Could not change the switch. Nothing was changed.'))
    } finally {
      setSwitchBusy(false)
    }
  }

  /* ── derived ────────────────────────────────────────────────────────────── */
  const statsOk = !!stats.data && !stats.error
  const U = stats.data?.users ?? {}
  const A = stats.data?.assets ?? {}

  const queue = useMemo(() => buildActionQueue({
    attention: attention.data || [],
    posture: security.data,
    mobile: mobile.data,
  }), [attention.data, security.data, mobile.data])
  const queueCounts = useMemo(() => queue.reduce((a, q) => { a[q.level] = (a[q.level] || 0) + 1; return a }, {}), [queue])

  const signups = useMemo(() => dailySeries(people.data || [], (r) => r.created_at, 30), [people.data])
  const roles = useMemo(() => topShare(people.data || [], (r) => r.role, 5), [people.data])
  const aiDaily = useMemo(() => dailySeries(ai.data || [], (r) => r.created_at, 30), [ai.data])
  const aiFailed = useMemo(() => (ai.data || []).filter((r) => r.status && r.status !== 'success').length, [ai.data])
  const aiCost = useMemo(() => (ai.data || []).reduce((a, r) => a + (Number(r.cost_usd) || 0), 0), [ai.data])
  const errGroups = useMemo(() => groupErrors(errors.data || [], 8), [errors.data])
  const errCounts = useMemo(() => severityCounts(errors.data || []), [errors.data])
  const openFindings = useMemo(() => (security.data?.checks || []).filter((c) => c.status === 'fail' || c.status === 'warn'), [security.data])

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

  const build = installedRelease?.buildId
  const buildLabel = !build || build === 'local' || build === 'development' ? 'Local build' : String(build).slice(0, 8)
  const latestRelease = installedRelease?.releases?.[0]
  const snap = backups.data?.[0]

  const statusCells = [
    { label: 'Environment', value: 'PRODUCTION', tone: 'danger' },
    { label: 'Web build', value: buildLabel, sub: latestRelease ? `notes ${latestRelease.date}` : 'No release notes' },
    { label: 'Android minimum', value: mobile.error ? 'N/A' : mobile.loading && !mobile.data ? '...' : (mobile.data?.minVersion || 'Not set'), sub: mobile.data?.latestVersion ? `latest ${mobile.data.latestVersion}` : 'latest not recorded' },
    { label: 'Database', value: 'Not connected', sub: 'Size is not readable from the browser' },
    { label: 'Latest migration', value: 'Not connected', sub: 'Migration history is not exposed' },
    { label: 'Backups', value: backups.error ? 'N/A' : backups.loading && !backups.data ? '...' : snap ? (ageText(snap.taken_at) || fmtWhen(snap.taken_at)) : 'None yet', sub: snap ? `${fmt(snap.total_rows)} rows` : backups.error ? 'Could not read' : 'No snapshot recorded' },
    { label: 'Scheduled jobs', value: cron.error ? 'N/A' : cron.loading && !cron.data ? '...' : `${cron.data.active}/${cron.data.total}`, sub: cron.data ? `${cron.data.failing} failing` : cron.error ? 'Could not read' : '' },
    { label: 'Data as of', value: refreshedAt ? new Date(refreshedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '...', sub: 'this page' },
  ]

  return (
    <div className="space-y-4 max-w-[1400px]">
      <OpsPageHeader
        title="Overview"
        purpose={activeOrg ? `Platform state and controls, viewing ${activeOrg.name}.` : 'Platform-wide state and controls for every organisation. Tyre Pulse, production.'}
        primary={queue.length ? (
          <Btn variant="primary" icon={ClipboardCheck} onClick={() => navigate(queue[0].to)} title={queue[0].title}>Start with the most urgent</Btn>
        ) : null}
        refreshedAt={refreshedAt}
        onRefresh={loadAll}
        busy={busy}
      />

      {/* Status strip */}
      <section aria-label="Platform status" className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-px rounded-xl overflow-hidden border border-gray-800 bg-gray-800">
        {statusCells.map((c) => (
          <div key={c.label} className="bg-gray-950 px-3 py-2.5 min-w-0">
            <p className="text-[10px] text-gray-500 truncate">{c.label}</p>
            <p className={`text-xs font-semibold truncate ${c.tone === 'danger' ? 'text-red-400' : 'text-gray-200'}`} title={String(c.value)}>{c.value}</p>
            {c.sub && <p className="text-[10px] text-gray-500 truncate" title={c.sub}>{c.sub}</p>}
          </div>
        ))}
      </section>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatTile icon={Users} label="Total users" value={fmt(U.total)}
          sub={statsOk ? `+${fmt(U.new_week ?? 0)} this week, ${fmt(U.pending ?? 0)} pending` : 'Could not read'}
          onClick={() => navigate('/console/users')} tone={Number(U.pending) > 0 ? 'accent' : 'default'} />
        <StatTile icon={Activity} label="Active users (30d)" value={active.error ? 'N/A' : fmt(active.data?.d30)}
          sub={active.data ? `${fmt(active.data.d7)} in 7d, ${fmt(active.data.today)} today` : active.error ? 'Could not read' : '...'} />
        <StatTile icon={CreditCard} label="Revenue" value="N/A" tone="muted" sub="Billing not live, no subscriptions" />
        <StatTile icon={PenLine} label="Records written (7d)" value={written.error ? 'N/A' : fmt(written.data?.cur)}
          sub={written.data ? (written.data.change === null ? `prev 7 days: ${fmt(written.data.prev)}` : `${written.data.change > 0 ? '+' : ''}${written.data.change}% vs prev 7 days`) : written.error ? 'Could not read' : '...'} />
        <StatTile icon={AlertTriangle} label="Error rate" value="N/A" tone="muted"
          sub={errors.data ? `${fmt(errCounts.critical + errCounts.error)} unresolved errors, 7d` : 'No request log source'} />
      </div>
      {stats.error && <ErrorState message={stats.error} onRetry={loadStats} />}

      {/* Needs your action */}
      <div aria-live="polite">
        <Panel flush tone={queueCounts.critical ? 'danger' : queue.length ? 'accent' : undefined}>
          <div className="p-4 pb-2">
            <PanelHeader icon={ClipboardCheck}
              title={queue.length ? 'Needs your action' : 'Nothing needs your action'}
              subtitle={queue.length
                ? `${queueCounts.critical || 0} critical, ${queueCounts.high || 0} high. Ranked by risk; each item opens the page that clears it.`
                : 'No pending approvals, unresolved errors, stale feeds, open alerts or open security findings.'} />
            {attention.error && <Note tone="warning" icon={Shield}>Could not check what is waiting on you. {attention.error}</Note>}
            {security.error && <p className="text-[11px] text-amber-300 mt-1">Security findings could not be read, so they are not in this list.</p>}
          </div>
          {(attention.loading && !attention.data) || (security.loading && !security.data && !security.error) ? (
            <div className="px-4 pb-4"><LoadingState label="Checking what needs you" rows={3} /></div>
          ) : queue.length > 0 && (
            <ul className="divide-y divide-gray-800 border-t border-gray-800">
              {queue.slice(0, 10).map((q) => (
                <li key={q.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="w-20 shrink-0"><Badge tone={LEVEL_TONE[q.level]}>{LEVEL_LABEL[q.level]}</Badge></span>
                  <div className="flex-1 min-w-[12rem]">
                    <p className="text-xs font-medium text-gray-200 break-words">{q.title}</p>
                    {q.detail && <p className="text-[11px] text-gray-500 break-words">{q.detail}</p>}
                  </div>
                  <Btn size="xs" variant={q.level === 'critical' ? 'primary' : 'ghost'} onClick={() => navigate(q.to)}>{q.action}</Btn>
                </li>
              ))}
            </ul>
          )}
          {queue.length > 10 && <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">{queue.length - 10} more lower-priority items. Open Security Audit or System Health for the full lists.</p>}
        </Panel>
      </div>

      {/* Health + controls */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader icon={Activity} title="Live system health"
            subtitle={health.data ? `${health.data.summary.ok} up, ${health.data.summary.degraded + health.data.summary.unknown} to watch, ${health.data.summary.down} down. Checked ${ageText(health.data.checkedAt) || 'just now'}.` : 'Database, auth, core tables, storage and edge functions.'}
            actions={<><Btn size="xs" onClick={loadHealth} busy={health.loading}>Re-check</Btn><Btn size="xs" onClick={() => navigate('/console/health')}>Details</Btn></>} />
          {health.error ? <ErrorState message={health.error} onRetry={loadHealth} />
            : health.loading && !health.data ? <LoadingState label="Running health checks" rows={4} /> : (
              <ul className="space-y-1 max-h-80 overflow-y-auto pr-1">
                {(health.data?.checks || []).map((c) => {
                  const Icon = HEALTH_ICON[c.status] || MinusCircle
                  return (
                    <li key={c.id} className="flex items-center gap-2 text-xs px-1 py-1">
                      <Icon size={13} className={c.status === 'ok' ? 'text-emerald-400' : c.status === 'down' ? 'text-red-400' : c.status === 'degraded' ? 'text-amber-400' : 'text-gray-500'} aria-hidden="true" />
                      <span className="flex-1 min-w-0 truncate text-gray-300" title={c.detail || c.label}>{c.label}</span>
                      {c.latencyMs != null && <span className="text-[10px] text-gray-500 tabular-nums">{c.latencyMs} ms</span>}
                      <Badge tone={HEALTH_TONE[c.status]}>{HEALTH_LABEL[c.status] || 'Unknown'}</Badge>
                    </li>
                  )
                })}
              </ul>
            )}
        </Panel>

        <Panel>
          <PanelHeader icon={SlidersHorizontal} title="Platform controls" subtitle="Live switches. Each asks for a reason, shows who is affected and is written to the audit log."
            actions={<Btn size="xs" onClick={() => navigate('/console/config')}>All settings</Btn>} />
          {config.error ? <ErrorState message={config.error} onRetry={loadConfig} />
            : config.loading && !config.data ? <LoadingState label="Reading switches" rows={4} /> : (
              <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
                {PLATFORM_SWITCHES.map((sw) => {
                  const on = !!config.data?.[sw.key]
                  return (
                    <li key={sw.key} className="flex items-start gap-2 py-1.5 border-b border-gray-800/60">
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${sw.danger ? 'text-red-300' : 'text-gray-200'}`}>{sw.label}</p>
                        <p className="text-[10px] text-gray-500">{sw.desc}</p>
                      </div>
                      <button type="button" role="switch" aria-checked={on} aria-label={sw.label}
                        onClick={() => askSwitch(sw, !on)}
                        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 mt-0.5 relative w-9 h-5 rounded-full shrink-0 transition-colors ${on ? (sw.danger ? 'bg-red-600' : 'bg-emerald-600') : 'bg-gray-700'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          <p className="text-[10px] text-gray-500 mt-2">Mobile app gate (minimum version) lives on <ConsoleLink to="/console/mobile-app" plain>Mobile App</ConsoleLink>.</p>
        </Panel>
      </div>

      {/* Jobs + errors */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel flush>
          <div className="p-4 pb-2">
            <PanelHeader icon={Timer} title="Scheduled jobs"
              subtitle={cron.data ? `${cron.data.active} of ${cron.data.total} on, ${cron.data.failing} failing on last run.` : 'Background database jobs.'}
              actions={<Btn size="xs" onClick={() => navigate('/console/automation')}>All jobs</Btn>} />
          </div>
          {cron.error ? <div className="px-4 pb-4"><ErrorState message={cron.error} onRetry={loadCron} /></div>
            : cron.loading && !cron.data ? <div className="px-4 pb-4"><LoadingState label="Loading jobs" rows={3} /></div>
              : !cron.data?.jobs.length ? <div className="px-4 pb-4"><EmptyState title="No background jobs listed" reason="The job list came back empty. If jobs should exist, open Automation Health." /></div> : (
                <Table className="border-0 rounded-none">
                  <THead><Th>Job</Th><Th>Schedule</Th><Th>Last</Th><Th align="right">When</Th></THead>
                  <tbody>
                    {cron.data.jobs.slice(0, 10).map((j) => (
                      <Tr key={j.jobid ?? j.jobname}>
                        <Td><span className="font-mono text-[11px] text-gray-300">{j.jobname}</span>{!j.active && <span className="ml-1 text-[10px] text-gray-500">(off)</span>}</Td>
                        <Td><span className="font-mono text-[11px] text-gray-500">{j.schedule || 'N/A'}</span></Td>
                        <Td><Badge tone={j.tone === 'green' ? 'good' : j.tone === 'red' ? 'danger' : j.tone === 'amber' ? 'warning' : 'default'}>{j.lastStatus || 'Not recorded'}</Badge></Td>
                        <Td align="right" nowrap><span className="text-gray-500 tabular-nums">{fmtWhen(j.lastEnd)}</span></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
          {cron.data?.jobs.length > 10 && <p className="px-4 py-2 text-[11px] text-gray-500">Showing 10 of {cron.data.jobs.length}.</p>}
        </Panel>

        <Panel flush>
          <div className="p-4 pb-2">
            <PanelHeader icon={Bug} title="Errors and incidents" subtitle="Unresolved app log rows, last 7 days, grouped by message."
              actions={<><Btn size="xs" onClick={() => navigate('/console/health')}>Error log</Btn><Btn size="xs" onClick={() => navigate('/console/crash-reports')}>Error Center</Btn></>} />
            {errors.data && (
              <div className="grid grid-cols-4 gap-2">
                <StatTile label="Critical" value={fmt(errCounts.critical)} tone={errCounts.critical ? 'danger' : 'default'} />
                <StatTile label="Error" value={fmt(errCounts.error)} tone={errCounts.error ? 'warning' : 'default'} />
                <StatTile label="Warning" value={fmt(errCounts.warning)} />
                <StatTile label="Info" value={fmt(errCounts.info)} tone="muted" />
              </div>
            )}
          </div>
          {errors.error ? <div className="px-4 pb-4"><ErrorState message={errors.error} onRetry={loadErrors} /></div>
            : errors.loading && !errors.data ? <div className="px-4 pb-4"><LoadingState label="Loading errors" rows={3} /></div>
              : !errGroups.length ? <div className="px-4 pb-4"><EmptyState title="No unresolved errors in 7 days" reason="The app error log has nothing open for this period. Phone crashes are on the Error Center." /></div> : (
                <Table className="border-0 rounded-none">
                  <THead><Th>Severity</Th><Th>Issue</Th><Th>Module</Th><Th align="right">Count</Th></THead>
                  <tbody>
                    {errGroups.map((g) => (
                      <Tr key={g.message}>
                        <Td><Badge tone={g.severity === 'critical' ? 'danger' : g.severity === 'error' ? 'warning' : 'default'}>{g.severity}</Badge></Td>
                        <Td><span className="text-gray-300 break-words line-clamp-2">{g.message}</span></Td>
                        <Td><span className="font-mono text-[11px] text-gray-500">{g.module || 'N/A'}</span></Td>
                        <Td align="right"><span className="tabular-nums text-gray-300">{g.count}</span></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
        </Panel>
      </div>

      {/* Security + admin activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader icon={ShieldCheck} title="Security overview"
            subtitle={security.data?.generatedAt ? `Last scan ${ageText(security.data.generatedAt) || fmtWhen(security.data.generatedAt)}.` : 'Live catalog checks.'}
            actions={<Btn size="xs" onClick={() => navigate('/console/security-audit')}>Security Center</Btn>} />
          {security.error ? <ErrorState message={`Could not read the security score. ${security.error}`} onRetry={loadSecurity} />
            : security.loading && !security.data ? <LoadingState label="Reading security checks" rows={3} /> : (
              <div className="flex flex-wrap gap-4">
                <ScoreRing score={security.data?.score ?? null} size={104} label="Security score" />
                <div className="flex-1 min-w-[14rem] space-y-1">
                  <p className="text-xs text-gray-400">{`${openFindings.length} open finding${openFindings.length === 1 ? '' : 's'} across ${security.data?.checks.length ?? 0} checks.`}</p>
                  {openFindings.slice(0, 5).map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-xs">
                      <Badge tone={c.severity === 'critical' ? 'danger' : c.severity === 'high' ? 'warning' : 'default'}>{c.severity}</Badge>
                      <span className="flex-1 min-w-0 truncate text-gray-300" title={c.title}>{c.title}</span>
                    </div>
                  ))}
                  {!openFindings.length && <p className="text-xs text-emerald-300">Every check is passing.</p>}
                </div>
              </div>
            )}
        </Panel>

        <Panel flush>
          <div className="p-4 pb-2">
            <PanelHeader icon={History} title="Recent administrative activity" subtitle="Server-stamped console actions, newest first."
              actions={<Btn size="xs" onClick={() => navigate('/console/audit-trail')}>Audit Logs</Btn>} />
          </div>
          {adminActs.error ? <div className="px-4 pb-4"><ErrorState message={adminActs.error} onRetry={loadAdminActs} /></div>
            : adminActs.loading && !adminActs.data ? <div className="px-4 pb-4"><LoadingState label="Loading activity" rows={3} /></div>
              : !adminActs.data?.length ? <div className="px-4 pb-4"><EmptyState title="No console actions yet" reason="Actions taken in this console appear here once someone takes one." /></div> : (
                <Table className="border-0 rounded-none">
                  <THead><Th>When</Th><Th>Admin</Th><Th>Action</Th><Th>Target</Th></THead>
                  <tbody>
                    {adminActs.data.map((a) => (
                      <Tr key={a.id}>
                        <Td nowrap><span className="text-gray-500 tabular-nums">{fmtWhen(a.created_at)}</span></Td>
                        <Td><span className="text-gray-300">{a.admin_name || 'Not recorded'}</span></Td>
                        <Td><span className="text-gray-300 capitalize">{String(a.action || '').replace(/_/g, ' ')}</span></Td>
                        <Td><span className="text-gray-500">{a.target_type ? String(a.target_type).replace(/_/g, ' ') : 'N/A'}</span></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
        </Panel>
      </div>

      {/* Trends: the previous dashboard's panels, kept whole */}
      <Panel>
        <PanelHeader icon={TrendingUp} title="Trends and breakdowns" subtitle="Registrations, roles, AI usage and the full console action list." />
        <Segmented value={tab} onChange={setTab} ariaLabel="Trend sections" options={[
          { key: 'overview', label: 'Registrations' },
          { key: 'people', label: 'People', count: people.data ? people.data.length : undefined },
          { key: 'ai', label: 'AI usage', count: ai.data && !ai.error ? aiDaily.total : undefined },
          { key: 'activity', label: 'Console activity' },
        ]} />
      </Panel>

      {tab === 'overview' && (<div role="tabpanel" aria-label="Registrations" className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader icon={UserPlus} title="New users, last 30 days"
            subtitle={people.error ? 'Could not read registrations.' : `${fmt(signups.total)} registrations in the window.`} />
          {people.error ? <ErrorState message={people.error} onRetry={loadPeople} /> : people.loading && !people.data ? <LoadingState label="Loading registrations" rows={3} /> : (
            <TrendChart labels={signups.labels} series={[{ label: 'New users', values: signups.values }]}
              height={190} summary={`${signups.total} new users in 30 days`}
              emptyText="No registrations in the last 30 days." />
          )}
        </Panel>
        <Panel>
          <PanelHeader icon={Database} title="Platform data" subtitle="Records held across every organisation." />
          {stats.error ? (
            <EmptyState title="Platform data unavailable" reason="The platform counts could not be read, so nothing is shown rather than zeros." />
          ) : stats.loading && !stats.data ? <LoadingState label="Loading platform data" rows={3} /> : (
            <BarsChart bars={assetBars} height={170} valueFormat={(v) => nf.format(v)}
              summary={assetBars.map((b) => `${b.label} ${b.value}`).join(', ')} emptyText="No records yet." />
          )}
        </Panel>
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

      {pending && (
        <ConfirmImpactDialog open requireReason
          danger={!!pending.sw.danger && pending.next}
          typedWord={pending.sw.key === 'maintenance_mode' && pending.next ? 'PRODUCTION' : undefined}
          title={`Turn ${pending.sw.label.toLowerCase()} ${pending.next ? 'on' : 'off'}?`}
          confirmLabel={pending.next ? 'Turn on' : 'Turn off'}
          busy={switchBusy} error={switchError}
          impact={{
            ...switchImpact(pending.sw, pending.next),
            stats: pending.sw.key === 'maintenance_mode' && pending.next ? [
              { label: 'Users blocked', value: maintImpact ? (maintImpact.blocked === null ? 'N/A' : nf.format(maintImpact.blocked)) : '...' },
              { label: 'Signed in today', value: maintImpact ? (maintImpact.today === null ? 'N/A' : nf.format(maintImpact.today)) : '...' },
              { label: 'Phones registered', value: maintImpact ? (maintImpact.phones === null ? 'N/A' : nf.format(maintImpact.phones)) : '...' },
            ] : undefined,
          }}
          onCancel={() => setPending(null)} onConfirm={applySwitch} />
      )}
    </div>
  )
}
