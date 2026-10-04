/**
 * ConsoleDeveloper.jsx - Developer Center (/console/developer).
 *
 * One place to see what version runs on every surface, what shipped, what
 * runs on a timer, and to act on the app version gate, jobs and AI settings.
 * Production only (there is no staging environment).
 *
 * Replaces Mobile App, AI Admin, Automation Health and Pipeline Monitor.
 * Nothing was removed: each old page is a tab here (?tab=mobile | ai |
 * automation | pipeline) and its old route redirects to that tab, keeping
 * the old page's own sub-tab in ?sub=.
 *
 * Honest gaps shown on screen, not hidden: the Vercel deploy list is not
 * connected (no server-side token), per-edge-function calls and deployed
 * versions are not recorded, the Flutter app does not report its version,
 * the web client build in other people's browsers is not measured.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Code2, Globe, Smartphone, Layers, Database, Megaphone, Rocket, RotateCcw, RefreshCw, Play, ArrowUpCircle,
  Server, Sparkles, ExternalLink, GitBranch, Cpu, Info, Pencil,
} from 'lucide-react'
import {
  Panel, PanelHeader, StatTile, Badge, Btn, Note, Table, THead, Th, Tr, Td, LoadingState, ErrorState, EmptyState,
  ConfirmImpactDialog,
} from '../components/ui'
import { PageHeader, useUrlTab, TabBar, TabPanel, ConsoleLink } from './shared/pageKit'
import ExportButtons from './shared/ExportButtons'
import JobsPanel from './developer/JobsPanel'
import GatePanel, { useAdoption } from './developer/GatePanel'
import ConsoleAuthBridge from '../ConsoleAuthBridge'
import {
  getCronHealth, getAppAdoption, getRecentMigrations, getEngineeringConfig, getAiStats,
} from '../../lib/api/engineeringCenter'
import { listJobRuns, summarizeJobs } from '../../lib/api/aiOps'
import { saveSystemConfigValues } from '../../lib/api/systemConfig'
import { installedRelease } from '../../lib/releases'
import {
  jobTotals, fmtInt, migrationDate, migrationTitle, riyadhTime, riyadhDay, EDGE_FUNCTIONS,
} from '../../lib/engineeringCenter'
import { toUserMessage } from '../../lib/safeError'
import { useConsoleAuth } from '../ConsoleAuthContext'

const ConsoleMobileApp = lazy(() => import('./ConsoleMobileApp'))
const ConsoleAutomation = lazy(() => import('./ConsoleAutomation'))
const ConsolePipelineMonitor = lazy(() => import('./ConsolePipelineMonitor'))
const AiAdministration = lazy(() => import('../../pages/AiAdministration'))

const TABS = [
  { key: 'overview', label: 'Overview', icon: Code2 },
  { key: 'mobile', label: 'Mobile App', icon: Smartphone },
  { key: 'ai', label: 'AI Admin', icon: Sparkles },
  { key: 'automation', label: 'Automation Health', icon: Server },
  { key: 'pipeline', label: 'Pipeline Monitor', icon: GitBranch },
]

/** Small loader: { loading, error, data, reload }. Errors are sanitised. */
function useLoad(fn, fallback) {
  const [s, setS] = useState({ loading: true, error: '', data: null })
  const reload = useCallback(async () => {
    setS((p) => ({ ...p, loading: true, error: '' }))
    try { setS({ loading: false, error: '', data: await fn() }) }
    catch (e) { setS({ loading: false, error: toUserMessage(e, fallback), data: null }) }
  }, [fn, fallback])
  useEffect(() => { reload() }, [reload])
  return { ...s, reload }
}

const loadHealth = () => getCronHealth(7)
const loadMigrations = () => getRecentMigrations(9)
const loadEmails = async () => summarizeJobs(await listJobRuns({ days: 30 }))

export default function ConsoleDeveloper() {
  const [tab, setTab] = useUrlTab(TABS.map((t) => t.key), 'overview')
  const health = useLoad(loadHealth, 'Scheduled job health could not be read.')
  const adoption = useLoad(getAppAdoption, 'App adoption could not be read.')
  const migrations = useLoad(loadMigrations, 'Migration history could not be read.')
  const config = useLoad(getEngineeringConfig, 'The settings could not be read.')
  const ai = useLoad(getAiStats, 'AI usage could not be read.')
  const emails = useLoad(loadEmails, 'Report email totals could not be read.')
  const [raiseOpen, setRaiseOpen] = useState(false)
  const navigate = useNavigate()

  const refreshAll = () => Promise.all([health.reload(), adoption.reload(), migrations.reload(), config.reload(), ai.reload(), emails.reload()])
  const refreshing = health.loading || adoption.loading || migrations.loading || config.loading

  return (
    <div className="space-y-4">
      <PageHeader icon={Code2} title="Developer Center"
        purpose="What version runs where, what shipped, what runs on a timer, and the switches engineers use. Production only."
        onRefresh={refreshAll} refreshing={refreshing}
        actions={<Btn icon={Play} onClick={() => { setTab('overview'); setTimeout(() => document.getElementById('dev-jobs')?.scrollIntoView({ behavior: 'smooth' }), 50) }}>Run a job</Btn>}
        primary={<Btn variant="primary" icon={ArrowUpCircle} onClick={() => { setTab('overview'); setRaiseOpen(true) }}>Raise minimum app version</Btn>} />
      <Note icon={GitBranch}><b className="text-gray-300">Moved here from:</b> Mobile App, AI Admin, Automation Health, Pipeline Monitor. Every feature of those pages still has a home on this screen (tabs below).</Note>
      <TabBar tabs={TABS} value={tab} onChange={setTab} ariaLabel="Developer Center sections" />

      {tab === 'overview' && (
        <TabPanel label="Overview">
          <Overview health={health} adoption={adoption} migrations={migrations} config={config} ai={ai} emails={emails}
            raiseOpen={raiseOpen} setRaiseOpen={setRaiseOpen} onRollback={() => navigate('/console/releases?rollback=1')} />
        </TabPanel>
      )}
      {tab !== 'overview' && (
        <TabPanel label={TABS.find((t) => t.key === tab)?.label}>
          <Suspense fallback={<LoadingState label="Loading" rows={6} />}>
            {tab === 'mobile' && <ConsoleMobileApp tabParam="sub" />}
            {tab === 'automation' && <ConsoleAutomation tabParam="sub" />}
            {tab === 'pipeline' && <ConsolePipelineMonitor tabParam="sub" />}
            {tab === 'ai' && <ConsoleAuthBridge><AiAdministration /></ConsoleAuthBridge>}
          </Suspense>
        </TabPanel>
      )}
    </div>
  )
}

function Overview({ health, adoption, migrations, config, ai, emails, raiseOpen, setRaiseOpen, onRollback }) {
  const totals = useMemo(() => jobTotals(health.data?.jobs || []), [health.data])
  const a = useAdoption(adoption.data, config.data)
  const build = installedRelease?.buildId
  const buildShort = build && !['local', 'development'].includes(build) ? String(build).slice(0, 7) : null
  const latestNote = installedRelease?.releases?.[0]
  const mig = migrations.data
  const cfg = config.data || {}
  const minV = cfg.mobile_min_version?.value || ''
  const latestV = cfg.mobile_latest_version?.value || ''

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile icon={Globe} label="Web build" value={buildShort || 'N/A'} sub={buildShort ? 'the build this tab is running' : 'build id not stamped (local build)'} />
        <StatTile icon={Smartphone} label="Android on minimum" tone={a.pctInstalls !== null && a.pctInstalls < 100 ? 'warning' : 'default'}
          value={a.pctInstalls === null ? 'N/A' : `${a.pctInstalls}%`} sub={a.pctInstalls === null ? 'versions not readable' : `${fmtInt(a.latestInstalls)} of ${fmtInt(a.installs)} phones; ${fmtInt(a.belowInstalls)} below ${minV}`} />
        <StatTile icon={Rocket} label="Deploys today" value="N/A" sub="Vercel deploy list not connected" />
        <StatTile icon={Server} label="Jobs 24h" value={health.error ? 'N/A' : fmtInt(totals.runs24h)} sub={health.error ? 'could not read' : `${fmtInt(totals.failed24h)} failed; ${totals.active} of ${totals.total} on`} tone={totals.failed24h ? 'danger' : 'default'} />
        <StatTile icon={Cpu} label="Edge functions" value={fmtInt(EDGE_FUNCTIONS.length)} sub="per-function calls and errors not recorded" />
        <StatTile icon={Sparkles} label="AI calls 30d" value={ai.error ? 'N/A' : fmtInt(ai.data?.calls30)} sub={ai.data ? `USD ${ai.data.spend30 === null ? 'N/A' : ai.data.spend30.toFixed(2)} spent; last call ${ai.data.last ? riyadhDay(ai.data.last) : 'never'}` : 'loading'} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <VersionCard icon={Globe} title="Web app" badge={<Badge tone="good">Live</Badge>} value={buildShort || 'N/A'}
          lines={[latestNote ? `Latest notes ${latestNote.id}` : 'No release notes in the build', 'Adoption in other browsers not measured']} />
        <VersionCard icon={Smartphone} title="Android (Expo)" badge={<Badge tone="good">On Play</Badge>} value={latestV || 'N/A'}
          lines={[`${fmtInt(a.latestInstalls)} of ${fmtInt(a.installs)} phones on it (${a.pctInstalls ?? 'N/A'}%)`, `Minimum ${minV || 'not set'}, latest ${latestV || 'not recorded'}`]} />
        <VersionCard icon={Layers} title="Flutter app" badge={<Badge tone="warning">Testing</Badge>} value="Closed testing"
          lines={['Version not reported to the server', `Minimum ${cfg.flutter_min_version?.value || 'not set'}`]} />
        <VersionCard icon={Database} title="Database" badge={<Badge tone="good">Current</Badge>} value={mig ? `${fmtInt(mig.total)} migrations` : 'N/A'}
          lines={[mig ? `Latest ${mig.latest}` : 'Migration history not readable', mig ? `${fmtInt(mig.today)} applied today` : '']} />
        <VersionCard icon={Megaphone} title="Marketing site" badge={<Badge tone="info">Separate</Badge>} value="tyre-pulse-eezl"
          lines={['Its own Vercel project', 'Deploy list not connected']} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3"><Deployments buildShort={buildShort} latestNote={latestNote} onRollback={onRollback} /></div>
        <div className="xl:col-span-2">
          <GatePanel config={config.data} adoption={adoption.data} loading={config.loading || adoption.loading}
            error={config.error || adoption.error} onRetry={() => { config.reload(); adoption.reload() }}
            onChanged={() => { config.reload(); adoption.reload() }} raiseOpen={raiseOpen} setRaiseOpen={setRaiseOpen} />
        </div>
      </div>

      <div id="dev-jobs">
        <JobsPanel health={health.data} loading={health.loading} error={health.error} onRetry={health.reload}
          onChanged={health.reload} emailSummary={emails.data} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <EdgeFunctions />
        <Migrations state={migrations} />
      </div>

      <AiPanel ai={ai} config={config} />
    </div>
  )
}

function VersionCard({ icon: Icon, title, badge, value, lines = [] }) {
  return (
    <Panel>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-300"><Icon size={13} className="text-gray-500" aria-hidden="true" />{title}</p>
        {badge}
      </div>
      <p className="font-mono text-base font-semibold text-gray-100 truncate">{value}</p>
      {lines.filter(Boolean).map((l) => <p key={l} className="text-[11px] text-gray-500 truncate" title={l}>{l}</p>)}
    </Panel>
  )
}

function Deployments({ buildShort, latestNote, onRollback }) {
  return (
    <Panel>
      <PanelHeader icon={Rocket} title="Deployments" subtitle="Production only; there is no staging environment"
        actions={(<>
          <Btn icon={RefreshCw} disabled title="Redeploying needs a Vercel token held server-side. It is not connected, so it is done in the Vercel dashboard.">Redeploy current</Btn>
          <Btn icon={RotateCcw} onClick={onRollback} title="Opens the guarded rollback dialog in Releases">Roll back to previous</Btn>
          <ConsoleLink to="/console/releases" icon={Rocket}>Releases</ConsoleLink>
        </>)} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-lg overflow-hidden border border-gray-800 text-xs mb-3">
        {[['Ready', 'N/A', 'deploy list not connected'], ['Skipped', 'N/A', 'deploy list not connected'], ['Failed', 'N/A', 'deploy list not connected'], ['Build time', 'N/A', 'not recorded']].map(([l, v, s]) => (
          <div key={l} className="bg-gray-900/60 px-3 py-2"><p className="text-[10px] text-gray-500">{l}</p><p className="text-base font-semibold text-gray-100">{v}</p><p className="text-[10px] text-gray-500">{s}</p></div>
        ))}
      </div>
      <Note icon={Info}>The Vercel deploy timeline needs a Vercel token held in a server function (never in the browser). Until that is connected, the timeline below lists what is known for certain; the full release history is in Releases.</Note>
      <h4 className="text-xs font-semibold text-gray-300 mt-4 mb-2">What is live now</h4>
      <Table>
        <THead><Th>Project</Th><Th>Serves</Th><Th>Commit</Th><Th>Since</Th></THead>
        <tbody>
          <Tr><Td className="font-mono">tyre-pulse</Td><Td>tyrepulse.app (web app)</Td><Td className="font-mono">{buildShort || 'N/A'}</Td><Td>{latestNote?.date || 'N/A'}</Td></Tr>
          <Tr><Td className="font-mono">tyre-pulse-eezl</Td><Td>marketing site</Td><Td>Not connected</Td><Td>N/A</Td></Tr>
        </tbody>
      </Table>
      <p className="text-[11px] text-gray-500 mt-3">Roll back switches the site to the previous ready build without rebuilding. It opens the guarded dialog in Releases, which records the decision and sends you to Vercel to complete it. This page never starts a deploy on its own.</p>
    </Panel>
  )
}

function EdgeFunctions() {
  const rows = EDGE_FUNCTIONS.map((f) => ({ ...f, version: 'N/A', deployed: 'N/A' }))
  return (
    <Panel>
      <PanelHeader icon={Cpu} title={<span className="inline-flex items-center gap-2">Edge functions <Badge tone="info">{rows.length} in the repository</Badge></span>}
        actions={<ExportButtons rows={rows} columns={[{ key: 'name', header: 'Function' }, { key: 'what', header: 'What it does' }, { key: 'auth', header: 'Sign-in check' }]} title="Edge functions" />} />
      <Table>
        <THead><Th>Function</Th><Th>Sign-in check</Th><Th>Deployed version</Th></THead>
        <tbody>
          {rows.map((f) => (
            <Tr key={f.name}>
              <Td><p className="font-mono text-[11px] text-gray-200">{f.name}</p><p className="text-[10px] text-gray-500">{f.what}</p></Td>
              <Td><Badge tone={f.auth === 'In code' ? 'default' : 'info'}>{f.auth}</Badge></Td>
              <Td>N/A</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="text-[11px] text-gray-500 mt-3">Per-function calls, errors and deployed versions are not recorded where the console can read them. &quot;In code&quot; means the function checks the user itself.</p>
    </Panel>
  )
}

function Migrations({ state }) {
  const items = state.data?.items || []
  return (
    <Panel>
      <PanelHeader icon={Database} title={<span className="inline-flex items-center gap-2">Database migrations <Badge tone="good">No pending</Badge></span>}
        subtitle={state.data ? `${fmtInt(state.data.total)} applied, ${fmtInt(state.data.today)} today` : undefined} />
      {state.loading ? <LoadingState rows={5} /> : state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : items.length === 0
        ? <EmptyState title="No migrations recorded" reason="The migration history table is empty." /> : (
          <Table>
            <THead><Th>Version</Th><Th>What it changed</Th><Th>Applied</Th></THead>
            <tbody>
              {items.map((m) => {
                const d = migrationDate(m.version)
                return (
                  <Tr key={m.version}>
                    <Td className="font-mono text-[11px]">{m.version}</Td>
                    <Td><p className="text-gray-200">{migrationTitle(m.name)}</p><p className="font-mono text-[10px] text-gray-500">{m.name || 'N/A'}</p></Td>
                    <Td nowrap>{d ? `${riyadhDay(d)} ${riyadhTime(d)}` : 'N/A'} <Badge tone="good">Applied</Badge></Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      <p className="text-[11px] text-gray-500 mt-3">Migrations are never rolled back from here. A fix is a new migration, reviewed first.</p>
    </Panel>
  )
}

const AI_FIELDS = [
  { key: 'ai_monthly_budget_usd', label: 'Monthly budget (USD)', min: 0, max: 100000, hint: 'Stops all AI calls when reached' },
  { key: 'ai_rate_limit_per_min', label: 'Rate limit (per user, per minute)', min: 1, max: 600, hint: 'Per user, per minute' },
  { key: 'ai_cache_ttl_hours', label: 'Answer cache (hours)', min: 0, max: 720, hint: 'Repeat questions reuse an answer' },
]

function AiPanel({ ai, config }) {
  const { logAction } = useConsoleAuth() || {}
  const cfg = config.data || {}
  const on = String(cfg.ai_enabled?.value || '').toLowerCase() === 'true'
  const [dialog, setDialog] = useState(null) // 'toggle' | 'limits'
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const quiet = ai.data && ai.data.calls30 === 0
  const daysSince = ai.data?.last ? Math.floor((Date.now() - Date.parse(ai.data.last)) / 86400000) : null
  const draftBad = AI_FIELDS.find((f) => { const n = Number(draft[f.key]); return !Number.isFinite(n) || n < f.min || n > f.max })

  async function save({ reason }) {
    setBusy(true); setErr('')
    try {
      const values = dialog === 'toggle' ? { ai_enabled: !on } : Object.fromEntries(AI_FIELDS.map((f) => [f.key, String(Number(draft[f.key]))]))
      await saveSystemConfigValues(values)
      try { await logAction?.('update_config', null, 'system_config', { keys: Object.keys(values), reason }) } catch { /* audit best effort */ }
      setDialog(null); config.reload()
    } catch (e) { setErr(toUserMessage(e, 'The AI settings could not be saved.')) } finally { setBusy(false) }
  }

  return (
    <Panel>
      <PanelHeader icon={Sparkles} title={<span className="inline-flex items-center gap-2">AI administration {quiet && <Badge tone="warning">{daysSince === null ? 'Never used' : `Unused ${daysSince} days`}</Badge>}</span>}
        subtitle="From AI Admin" actions={<ConsoleLink to="/console/developer?tab=ai" icon={ExternalLink}>Prompts, models and usage</ConsoleLink>} />
      {ai.error ? <ErrorState message={ai.error} onRetry={ai.reload} /> : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-lg overflow-hidden border border-gray-800 text-xs mb-3">
          <div className="bg-gray-900/60 px-3 py-2"><p className="text-[10px] text-gray-500">Calls 30 days</p><p className="text-lg font-semibold text-gray-100">{fmtInt(ai.data?.calls30)}</p><p className="text-[10px] text-gray-500">{fmtInt(ai.data?.total)} all time</p></div>
          <div className="bg-gray-900/60 px-3 py-2"><p className="text-[10px] text-gray-500">Spend 30 days</p><p className="text-lg font-semibold text-gray-100">{ai.data?.spend30 === null || ai.data?.spend30 === undefined ? 'N/A' : `USD ${ai.data.spend30.toFixed(2)}`}</p><p className="text-[10px] text-gray-500">budget USD {cfg.ai_monthly_budget_usd?.value || 'N/A'}</p></div>
          <div className="bg-gray-900/60 px-3 py-2"><p className="text-[10px] text-gray-500">Last call</p><p className="text-lg font-semibold text-gray-100">{ai.data?.last ? riyadhDay(ai.data.last) : 'Never'}</p><p className="text-[10px] text-gray-500">{daysSince === null ? 'N/A' : `${daysSince} days ago`}</p></div>
        </div>
      )}
      {config.error ? <ErrorState message={config.error} onRetry={config.reload} /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 text-xs divide-y md:divide-y-0 divide-gray-800">
          <Row label="AI assistant" hint={on ? 'On for every company' : 'Off for every company'}>
            <Btn size="xs" variant={on ? 'danger' : 'primary'} onClick={() => setDialog('toggle')}>{on ? 'Turn off' : 'Turn on'}</Btn>
          </Row>
          <Row label="Model" hint={`${cfg.ai_model?.value || 'N/A'} saved; the server locks the model`}><Badge>{cfg.ai_model?.value || 'N/A'}</Badge></Row>
          {AI_FIELDS.map((f) => (
            <Row key={f.key} label={f.label} hint={f.hint}><Badge>{cfg[f.key]?.value || 'N/A'}</Badge></Row>
          ))}
          <Row label="Limits" hint="Budget, rate limit and cache"><Btn size="xs" icon={Pencil} onClick={() => { setDraft(Object.fromEntries(AI_FIELDS.map((f) => [f.key, cfg[f.key]?.value ?? '']))); setDialog('limits') }}>Edit</Btn></Row>
        </div>
      )}
      {quiet && on && <p className="text-[11px] text-gray-500 mt-3">No AI calls in 30 days. The switch is on but unused; consider turning it off to remove the risk surface.</p>}

      <ConfirmImpactDialog open={Boolean(dialog)} requireReason busy={busy} error={err || (dialog === 'limits' && draftBad ? `${draftBad.label} must be ${draftBad.min} to ${draftBad.max}.` : '')}
        readyExtra={dialog !== 'limits' || !draftBad} danger={dialog === 'toggle' && on}
        title={dialog === 'toggle' ? (on ? 'Turn the AI assistant off?' : 'Turn the AI assistant on?') : 'AI limits'}
        confirmLabel={dialog === 'toggle' ? (on ? 'Turn off' : 'Turn on') : 'Save limits'}
        onCancel={() => { setDialog(null); setErr('') }} onConfirm={save}
        impact={dialog === 'toggle'
          ? { tone: on ? 'danger' : 'info', what: on ? 'Every AI feature stops for every company.' : 'AI features become available again.', change: on ? 'Chat, analysis and the command center answer with "AI is turned off".' : 'Calls count against the monthly budget.', who: `Everyone who uses AI features (${fmtInt(ai.data?.calls30)} calls in 30 days).`, undo: 'Yes. Switch it back at any time.' }
          : { tone: 'info', what: 'Change the AI budget, rate limit and cache.', change: 'The AI functions read these on the next call.', who: 'Everyone who uses AI features.', undo: 'Yes. Save the old numbers again.' }}>
        {dialog === 'limits' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {AI_FIELDS.map((f) => (
              <label key={f.key} className="block text-xs"><span className="block text-[11px] text-gray-400 mb-1">{f.label}</span>
                <input type="number" min={f.min} max={f.max} value={draft[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" /></label>
            ))}
          </div>
        )}
      </ConfirmImpactDialog>
    </Panel>
  )
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0"><p className="font-medium text-gray-200">{label}</p><p className="text-[11px] text-gray-500 truncate">{hint}</p></div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
