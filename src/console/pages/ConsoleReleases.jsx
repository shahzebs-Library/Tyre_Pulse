/**
 * ConsoleReleases.jsx - Releases (/console/releases).
 *
 * One timeline across web, Android, database and releases recorded by hand,
 * with what is running now, Android adoption on installs AND active phones,
 * app errors before vs after each release in equal windows, and a guarded
 * web rollback that RECORDS the decision and sends you to Vercel. The console
 * never deploys or rolls anything back on its own.
 *
 * Nothing removed: the old Release & Impact ledger lives on as the Releases,
 * Impacts and Insights tabs (?tab=releases | impacts | insights), unchanged.
 *
 * Honest gaps stated on screen: web adoption is not measured (browsers do not
 * report a build), the Vercel and marketing deploy lists are not connected,
 * Flutter does not report its version, crash-free rate needs Sentry release
 * tags, database changes cannot be rolled back from here, and the error
 * source is app-logged errors (no request count, so no error rate).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Rocket, Globe, Smartphone, Database, RotateCcw, AlertTriangle, CheckCircle2, Layers, GitCompare,
  Activity, ExternalLink, Apple, Megaphone, Info, History,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Toolbar, Segmented, SearchInput, Select,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ProportionBar, ConfirmImpactDialog,
} from '../components/ui'
import { PageHeader, useUrlTab, TabBar, TabPanel, Drawer, DetailList } from './shared/pageKit'
import ExportButtons from './shared/ExportButtons'
import ReleaseLedger from './releases/ReleaseLedger'
import {
  getRecentMigrations, getEngineeringConfig, listRecordedReleases, getAppAdoption,
  countErrors24h, getReleaseErrorWindows, recordRollback,
} from '../../lib/api/engineeringCenter'
import {
  buildReleaseTimeline, filterTimeline, groupByDay, platformCounts, errorVerdict, adoptionSummary,
  fmtInt, riyadhTime, riyadhDay, PLATFORMS,
} from '../../lib/engineeringCenter'
import { installedRelease } from '../../lib/releases'
import { toUserMessage } from '../../lib/safeError'
import { useConsoleAuth } from '../ConsoleAuthContext'

const TABS = ['timeline', 'releases', 'impacts', 'insights']
const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.key, p.label]))
const PLATFORM_ICON = { web: Globe, marketing: Megaphone, android: Smartphone, flutter: Smartphone, database: Database, manual: Rocket }
const WINDOW_HOURS = 12
const VERDICT_TONE = { Higher: 'danger', Lower: 'good', Similar: 'default', 'Too early': 'info', 'N/A': 'quiet' }
const VERCEL_URL = 'https://vercel.com/dashboard'
const NOT_ROLLED_BACK = [
  'Database changes and migrations stay as they are.',
  'Settings, environment variables and secrets are not changed.',
  'Phones keep the app version they have installed.',
  'Domains and the marketing site are not touched.',
  'New pushes to main stop going live until the rollback is undone in Vercel.',
]

const liveBuildId = installedRelease?.buildId || null
const liveShort = liveBuildId && !['development', 'local'].includes(liveBuildId) ? String(liveBuildId).slice(0, 7) : null

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

const loadMigrations = () => getRecentMigrations(100)

export default function ConsoleReleases() {
  const [tab, setTab] = useUrlTab(TABS, 'timeline')
  const [params, setParams] = useSearchParams()
  const migrations = useLoad(loadMigrations, 'Migration history could not be read.')
  const config = useLoad(getEngineeringConfig, 'App version settings could not be read.')
  const recorded = useLoad(listRecordedReleases, 'Recorded releases could not be read.')
  const adoption = useLoad(getAppAdoption, 'App adoption could not be read.')
  const errors24 = useLoad(countErrors24h, 'Errors could not be counted.')
  const { logAction } = useConsoleAuth()

  const [platform, setPlatform] = useState('all')
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const [rollbackOpen, setRollbackOpen] = useState(params.get('rollback') === '1')
  const [flash, setFlash] = useState(null)
  const [readAt, setReadAt] = useState(Date.now())

  const reloadAll = () => {
    migrations.reload(); config.reload(); recorded.reload(); adoption.reload(); errors24.reload()
    setReadAt(Date.now())
  }

  const cfg = config.data || {}
  const android = useMemo(() => {
    const min = cfg.mobile_min_version; const latest = cfg.mobile_latest_version
    if (!min && !latest) return null
    const times = [min?.updatedAt, latest?.updatedAt].filter(Boolean).sort()
    return { min: min?.value || null, latest: latest?.value || null, updatedAt: times[times.length - 1] || null }
  }, [cfg.mobile_min_version, cfg.mobile_latest_version])

  const events = useMemo(() => buildReleaseTimeline({
    notes: installedRelease?.releases || [],
    migrations: migrations.data?.items || [],
    android,
    recorded: recorded.data || [],
    liveBuild: liveBuildId,
  }), [migrations.data, android, recorded.data])

  const inPeriod = useMemo(() => filterTimeline(events, { platform: 'all', days }), [events, days])
  const counts = useMemo(() => platformCounts(inPeriod), [inPeriod])
  const visible = useMemo(() => filterTimeline(events, { platform, days, search }), [events, platform, days, search])
  const groups = useMemo(() => groupByDay(visible), [visible])

  // Errors before vs after, only for events with a real time of day.
  const timed = useMemo(() => visible.filter((e) => e.timeKnown && e.at).slice(0, 40), [visible])
  const [windows, setWindows] = useState({ loading: false, error: '', byId: {} })
  const timedKey = timed.map((e) => e.id).join('|')
  useEffect(() => {
    let alive = true
    if (!timed.length) { setWindows({ loading: false, error: '', byId: {} }); return undefined }
    setWindows((w) => ({ ...w, loading: true, error: '' }))
    getReleaseErrorWindows(timed.map((e) => e.at), WINDOW_HOURS)
      .then((items) => {
        if (!alive) return
        const byId = {}
        timed.forEach((e, i) => { byId[e.id] = items[i] || null })
        setWindows({ loading: false, error: '', byId })
      })
      .catch((e) => { if (alive) setWindows({ loading: false, error: toUserMessage(e, 'Errors before and after could not be read.'), byId: {} }) })
    return () => { alive = false }
  }, [timedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => adoptionSummary(adoption.data?.by_version || [], android?.min, android?.latest), [adoption.data, android])
  const recorded30 = useMemo(() => (recorded.data || []).filter((r) => r.released_at && Date.now() - new Date(r.released_at).getTime() < 30 * 86400000), [recorded.data])
  const rollbacks30 = recorded30.filter((r) => r.kind === 'rollback').length
  const releases30 = useMemo(() => filterTimeline(events, { days: 30 }).length, [events])

  const exportRows = useMemo(() => visible.map((e) => {
    const w = windows.byId[e.id]
    return {
      when: e.at ? (e.timeKnown ? riyadhTime(e.at) : `${riyadhDay(e.at)} (time not recorded)`) : 'N/A',
      platform: PLATFORM_LABEL[e.platform] || 'Recorded',
      version: e.version || 'N/A',
      change: e.title,
      status: e.status,
      before: w ? fmtInt(w.before) : 'N/A',
      after: w ? fmtInt(w.after) : 'N/A',
      verdict: w ? errorVerdict(w) : 'N/A',
      source: e.source,
    }
  }), [visible, windows.byId])

  const openRollback = () => setRollbackOpen(true)
  const closeRollback = () => {
    setRollbackOpen(false)
    if (params.get('rollback')) { const p = new URLSearchParams(params); p.delete('rollback'); setParams(p, { replace: true }) }
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={Rocket} title="Releases"
        purpose="What shipped, where, and whether errors went up afterwards. One timeline for web, Android and the database."
        refreshedAt={readAt} onRefresh={reloadAll}
        refreshing={migrations.loading || config.loading || recorded.loading}
        actions={(<>
          <Btn icon={RotateCcw} variant="danger" onClick={openRollback}>Roll back web app</Btn>
        </>)} />

      {flash && (
        <Note icon={flash.tone === 'ok' ? CheckCircle2 : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>{flash.text}</Note>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Releases, 30 days" icon={Rocket}
          value={migrations.loading || recorded.loading ? 'N/A' : fmtInt(releases30)}
          sub="Web notes, database days, Android, recorded" />
        <StatTile label="Live web build" icon={Globe} value={liveShort || 'N/A'}
          sub={liveShort ? 'Build this console runs' : 'Build id not set on this build'} />
        <StatTile label="Android on latest" icon={Smartphone}
          value={adoption.loading || adoption.error || summary.pctActive === null ? 'N/A' : `${summary.pctActive}%`}
          sub={adoption.error ? 'Could not be read' : summary.pctActive === null ? 'No latest version recorded'
            : `${fmtInt(summary.latestActive)} of ${fmtInt(summary.active)} active phones, ${fmtInt(summary.latestInstalls)} of ${fmtInt(summary.installs)} installs`} />
        <StatTile label="App errors, 24 hours" icon={Activity}
          tone={errors24.data > 0 ? 'warning' : 'default'}
          value={errors24.loading || errors24.error ? 'N/A' : fmtInt(errors24.data)}
          sub={errors24.error ? 'Could not be counted' : 'Logged errors; no request count, so no rate'} />
        <StatTile label="Migrations today" icon={Database}
          value={migrations.loading || migrations.error ? 'N/A' : fmtInt(migrations.data?.today)}
          sub={migrations.data ? `${fmtInt(migrations.data.total)} applied in total` : undefined} />
        <StatTile label="Rollbacks, 30 days" icon={RotateCcw}
          tone={rollbacks30 ? 'warning' : 'default'}
          value={recorded.loading || recorded.error ? 'N/A' : fmtInt(rollbacks30)}
          sub="Recorded from this screen" />
      </div>

      <TabBar value={tab} onChange={setTab} label="Release sections" tabs={[
        { key: 'timeline', label: 'Timeline', count: visible.length },
        { key: 'releases', label: 'Recorded releases', count: recorded.data ? recorded.data.filter((r) => r.kind !== 'rollback').length : undefined },
        { key: 'impacts', label: 'Impacts' },
        { key: 'insights', label: 'Insights' },
      ]} />

      {tab === 'timeline' && (
        <TabPanel label="Timeline">
          <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
            <div className="space-y-4 min-w-0">
              <Panel>
                <PanelHeader icon={History} title="Release timeline"
                  subtitle={`Grouped by day, Riyadh time. Errors compare the ${WINDOW_HOURS} hours before with the ${WINDOW_HOURS} hours after.`}
                  actions={(
                    <Toolbar>
                      <Segmented ariaLabel="Period" role="group" value={String(days)} onChange={(v) => setDays(Number(v))}
                        options={[{ key: '7', label: '7 days' }, { key: '30', label: '30 days' }, { key: '90', label: '90 days' }]} />
                      <SearchInput value={search} onChange={setSearch} placeholder="Search version or change" className="w-full sm:w-56" ariaLabel="Search releases" />
                      <ExportButtons rows={exportRows} title="Releases" columns={[
                        { key: 'when', header: 'When' }, { key: 'platform', header: 'Platform' }, { key: 'version', header: 'Version' },
                        { key: 'change', header: 'Change' }, { key: 'status', header: 'Status' }, { key: 'before', header: 'Errors before' },
                        { key: 'after', header: 'Errors after' }, { key: 'verdict', header: 'Verdict' }, { key: 'source', header: 'Source' },
                      ]} />
                    </Toolbar>
                  )} />
                <div className="px-4 pb-3">
                  <Segmented ariaLabel="Platform" role="group" value={platform} onChange={setPlatform} options={[
                    { key: 'all', label: 'All', count: counts.all || 0 },
                    ...PLATFORMS.map((p) => ({ key: p.key, label: p.label, count: counts[p.key] || 0 })),
                    ...(counts.manual ? [{ key: 'manual', label: 'Recorded', count: counts.manual }] : []),
                  ]} />
                </div>
                {migrations.error && <div className="px-4 pb-3"><ErrorState message={migrations.error} onRetry={migrations.reload} /></div>}
                {recorded.error && <div className="px-4 pb-3"><ErrorState message={recorded.error} onRetry={recorded.reload} /></div>}
                {migrations.loading || recorded.loading ? <LoadingState label="Reading releases" rows={6} /> : visible.length === 0 ? (
                  <EmptyState icon={Rocket} title="Nothing in this period"
                    reason={search || platform !== 'all' ? 'Clear the search or choose All platforms.' : 'Widen the period to see older releases.'}
                    action={<Btn onClick={() => { setSearch(''); setPlatform('all'); setDays(90) }}>Show 90 days, all platforms</Btn>} />
                ) : (
                  <div className="divide-y divide-gray-800">
                    {groups.map((g) => (
                      <section key={g.key} aria-label={g.label}>
                        <h3 className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g.label}</h3>
                        <Table>
                          <THead>
                            <Th>Time</Th><Th>Platform</Th><Th>Version</Th><Th>Change</Th><Th align="right">Errors before / after</Th>
                          </THead>
                          <tbody>
                            {g.events.map((e) => {
                              const w = windows.byId[e.id]
                              const verdict = e.timeKnown ? (w ? errorVerdict(w) : (windows.loading ? null : 'N/A')) : null
                              const Icon = PLATFORM_ICON[e.platform] || Rocket
                              return (
                                <Tr key={e.id} onClick={() => setDetail(e)} ariaLabel={`Open ${e.title}`}>
                                  <Td nowrap><span className="text-gray-400 tabular-nums">{e.timeKnown && e.at ? riyadhTime(e.at).split(' ').slice(-1)[0] : 'N/A'}</span></Td>
                                  <Td nowrap><span className="inline-flex items-center gap-1.5 text-gray-300"><Icon size={12} aria-hidden="true" />{PLATFORM_LABEL[e.platform] || 'Recorded'}</span></Td>
                                  <Td nowrap><span className="font-mono text-gray-200">{e.version || 'N/A'}</span>{e.status === 'Live' && <Badge tone="good">Live</Badge>}{e.status === 'Rollback' && <Badge tone="warning">Rollback</Badge>}</Td>
                                  <Td className="text-gray-300 break-words max-w-xl">{e.title}</Td>
                                  <Td align="right" nowrap>
                                    {!e.timeKnown ? <span className="text-gray-500" title="The release notes carry a date but not a time, so no equal window can be drawn.">N/A, no time</span>
                                      : !w ? <span className="text-gray-500">{windows.loading ? 'Reading' : 'N/A'}</span>
                                        : (<span className="inline-flex items-center gap-2 tabular-nums">
                                          <span className="text-gray-300">{fmtInt(w.before)} / {fmtInt(w.after)}</span>
                                          <Badge tone={VERDICT_TONE[verdict] || 'default'}>{verdict}</Badge>
                                        </span>)}
                                  </Td>
                                </Tr>
                              )
                            })}
                          </tbody>
                        </Table>
                      </section>
                    ))}
                  </div>
                )}
                {windows.error && <div className="px-4 py-3"><ErrorState message={windows.error} /></div>}
                <p className="px-4 py-3 text-[11px] text-gray-500">
                  Web entries come from the release notes shipped in the build, which carry a date but no time. The Vercel deploy list is not connected, so commit times and skipped deploys are not shown.
                </p>
              </Panel>

              <CompareReleases events={visible} windows={windows.byId} />
            </div>

            <div className="space-y-4 min-w-0">
              <RunningNow android={android} adoption={summary} adoptionError={adoption.error}
                migrations={migrations.data} flutterMin={cfg.flutter_min_version?.value} onRollback={openRollback} />
              <AndroidAdoption summary={summary} loading={adoption.loading} error={adoption.error} onRetry={adoption.reload}
                latest={android?.latest} min={android?.min} />
              <Panel>
                <PanelHeader icon={Info} title="Not measured yet" />
                <ul className="px-4 pb-4 space-y-1.5 text-xs text-gray-400 list-disc pl-8">
                  <li>Web adoption: browsers do not report which build they run.</li>
                  <li>Crash-free rate per build: needs Sentry release tags on the web build.</li>
                  <li>Flutter version: the Flutter app does not report its version yet.</li>
                  <li>Marketing site deploys: that project is not connected.</li>
                  <li>Error rate: app errors are logged, requests are not counted, so only counts are shown.</li>
                </ul>
              </Panel>
            </div>
          </div>
        </TabPanel>
      )}

      {tab !== 'timeline' && (
        <TabPanel label="Recorded releases">
          <ReleaseLedger embedded tab={tab} onTabChange={setTab} />
        </TabPanel>
      )}

      <ReleaseDrawer event={detail} window={detail ? windows.byId[detail.id] : null} onClose={() => setDetail(null)} />

      <RollbackDialog open={rollbackOpen} onClose={closeRollback} logAction={logAction}
        recorded={recorded.data || []}
        onDone={(to) => {
          closeRollback()
          setFlash({ tone: 'ok', text: `Rollback to ${to} recorded. Finish it in Vercel: open the project, Deployments, choose the build, Instant Rollback.` })
          recorded.reload()
        }} />
    </div>
  )
}

/* ── running now ───────────────────────────────────────────────────────── */

function RunningNow({ android, adoption, adoptionError, migrations, flutterMin, onRollback }) {
  const rows = [
    { key: 'web', icon: Globe, label: 'Web app', version: liveShort || 'N/A', note: liveShort ? 'Adoption not measured' : 'Build id not set on this build' },
    { key: 'marketing', icon: Megaphone, label: 'Marketing site', version: 'N/A', note: 'Deploy list not connected' },
    {
      key: 'android', icon: Smartphone, label: 'Android', version: android?.latest || 'N/A',
      note: adoptionError ? 'Adoption could not be read' : adoption.pctActive === null ? 'Latest version not recorded' : `${adoption.pctActive}% of active phones`,
    },
    { key: 'flutter', icon: Smartphone, label: 'Flutter', version: 'N/A', note: flutterMin ? `Minimum ${flutterMin}; running version not reported` : 'Running version not reported' },
    { key: 'ios', icon: Apple, label: 'iOS', version: 'N/A', note: 'There is no iOS app' },
    { key: 'database', icon: Database, label: 'Database', version: migrations?.latest?.version || 'N/A', note: migrations ? `${fmtInt(migrations.total)} migrations applied` : 'Could not be read' },
  ]
  return (
    <Panel>
      <PanelHeader icon={Layers} title="Running now" subtitle="Production only; there is no staging." />
      <ul className="px-4 pb-3 divide-y divide-gray-800">
        {rows.map((r) => (
          <li key={r.key} className="py-2 flex items-center gap-3">
            <r.icon size={14} className="text-gray-500 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-300">{r.label}</p>
              <p className="text-[11px] text-gray-500">{r.note}</p>
            </div>
            <span className="font-mono text-xs text-gray-200">{r.version}</span>
          </li>
        ))}
      </ul>
      <div className="px-4 pb-4">
        <Btn icon={RotateCcw} variant="danger" onClick={onRollback}>Roll back web app</Btn>
      </div>
    </Panel>
  )
}

function AndroidAdoption({ summary, loading, error, onRetry, latest, min }) {
  return (
    <Panel>
      <PanelHeader icon={Smartphone} title="Android adoption"
        subtitle="Installs, and phones opened in the last 7 days. Active phones are the fair measure." />
      {loading ? <LoadingState rows={3} /> : error ? <div className="px-4 pb-4"><ErrorState message={error} onRetry={onRetry} /></div>
        : summary.rows.length === 0 ? <EmptyState icon={Smartphone} title="No phones have reported a version" reason="Phones report their version after signing in." />
          : (
            <div className="px-4 pb-4 space-y-3">
              <ProportionBar total={summary.installs} segments={summary.rows.slice(0, 5).map((r, i) => ({
                label: r.version || 'Unknown', value: r.installs, tone: i === 0 ? 'good' : 'muted',
              }))} />
              <Table>
                <THead><Th>Version</Th><Th align="right">Installs</Th><Th align="right">Active 7d</Th></THead>
                <tbody>
                  {summary.rows.map((r) => (
                    <Tr key={r.version || 'unknown'}>
                      <Td nowrap>
                        <span className="font-mono text-gray-200">{r.version || 'Unknown'}</span>
                        {latest && r.version === latest && <Badge tone="good">Latest</Badge>}
                        {min && summary.belowRows.some((b) => b.version === r.version) && <Badge tone="warning">Below minimum</Badge>}
                      </Td>
                      <Td align="right" className="tabular-nums">{fmtInt(r.installs)}</Td>
                      <Td align="right" className="tabular-nums">{fmtInt(r.active)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
    </Panel>
  )
}

/* ── compare two releases ──────────────────────────────────────────────── */

function CompareReleases({ events, windows }) {
  const options = events.map((e) => ({ value: e.id, label: `${e.at ? riyadhDay(e.at) : 'N/A'} ${PLATFORM_LABEL[e.platform] || 'Recorded'} ${e.version || ''}`.trim() }))
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const ea = events.find((e) => e.id === a) || null
  const eb = events.find((e) => e.id === b) || null
  const col = (e) => {
    if (!e) return null
    const w = windows[e.id]
    return [
      ['Platform', PLATFORM_LABEL[e.platform] || 'Recorded'],
      ['Version', e.version || 'N/A'],
      ['When', e.at ? (e.timeKnown ? riyadhTime(e.at) : `${riyadhDay(e.at)}, time not recorded`) : 'N/A'],
      ['Change', e.title],
      ['Errors before', w ? fmtInt(w.before) : 'N/A'],
      ['Errors after', w ? fmtInt(w.after) : 'N/A'],
      ['Verdict', w ? errorVerdict(w) : 'N/A'],
    ]
  }
  return (
    <Panel>
      <PanelHeader icon={GitCompare} title="Compare two releases" subtitle="Pick any two entries in the current filter." />
      <div className="px-4 pb-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={a} onChange={setA} options={options} placeholder="First release" ariaLabel="First release" />
          <Select value={b} onChange={setB} options={options} placeholder="Second release" ariaLabel="Second release" />
        </div>
        {!ea || !eb ? <p className="text-xs text-gray-500">Choose two releases to see them side by side.</p> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {[ea, eb].map((e, i) => (
              <div key={`${e.id}-${i}`} className="rounded-xl border border-gray-800 p-3"><DetailList items={col(e)} /></div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ── release detail ────────────────────────────────────────────────────── */

function ReleaseDrawer({ event, window: w, onClose }) {
  const verdict = w ? errorVerdict(w) : 'N/A'
  return (
    <Drawer open={!!event} onClose={onClose} title={event ? `${PLATFORM_LABEL[event.platform] || 'Recorded'} ${event.version || ''}`.trim() : ''}
      subtitle={event?.source}>
      {event && (
        <div className="space-y-4">
          <DetailList items={[
            ['When', event.at ? (event.timeKnown ? riyadhTime(event.at) : `${riyadhDay(event.at)}, time not recorded`) : 'N/A'],
            ['Status', event.status],
            event.range ? ['Range', event.range] : null,
            ['Errors before', w ? `${fmtInt(w.before)} in ${WINDOW_HOURS} hours` : 'N/A'],
            ['Errors after', w ? `${fmtInt(w.after)}${w.complete ? '' : ' so far, window not complete'}` : 'N/A'],
            ['Verdict', verdict],
          ]} />
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">What changed</h4>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{event.detail || event.title}</p>
          </div>
          {event.modules?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{[...new Set(event.modules)].map((m) => <Badge key={m} tone="info">{m}</Badge>)}</div>
          )}
          <Note icon={Info}>
            {event.timeKnown
              ? `Errors come from the app error log in equal ${WINDOW_HOURS}-hour windows. A handful of errors is not proof of a bad release.`
              : 'This entry has a date but no time, so no before and after window can be drawn.'}
          </Note>
        </div>
      )}
    </Drawer>
  )
}

/* ── guarded rollback ──────────────────────────────────────────────────── */

function RollbackDialog({ open, onClose, onDone, logAction, recorded }) {
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setTo(''); setError('') } }, [open])
  const previous = useMemo(() => (recorded || []).filter((r) => r.kind !== 'rollback' && (!r.platform || r.platform === 'web')).map((r) => r.version).filter(Boolean), [recorded])
  const confirm = async ({ reason }) => {
    if (reason.length < 5) { setError('Give a reason of at least 5 characters.'); return }
    setBusy(true); setError('')
    try {
      await recordRollback({ platform: 'web', from: liveShort, to: to.trim(), reason })
      try { await logAction?.('record_rollback', null, 'releases', { platform: 'web', from: liveShort, to: to.trim(), reason }) } catch { /* audit best effort */ }
      window.open(VERCEL_URL, '_blank', 'noopener,noreferrer')
      onDone?.(to.trim())
    } catch (e) {
      setError(toUserMessage(e, 'The rollback could not be recorded.'))
    } finally { setBusy(false) }
  }
  return (
    <ConfirmImpactDialog open={open} danger title="Roll back the web app"
      confirmLabel="Record and open Vercel" typedWord="ROLLBACK" requireReason busy={busy} error={error}
      readyExtra={to.trim().length > 0} onCancel={onClose} onConfirm={confirm}
      impact={{
        tone: 'danger',
        what: 'Records a rollback of the web app and opens Vercel, where you choose the build and press Instant Rollback.',
        change: `From ${liveShort || 'the live build'} to the build you name below.`,
        who: 'Everyone using the web app and the console after Vercel switches.',
        undo: 'In Vercel, Undo Rollback. Record it here again if you want it on the timeline.',
      }}>
      <label className="block">
        <span className="block text-[11px] font-semibold text-gray-400 mb-1">Roll back to (build or commit)</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} list="rollback-previous" autoComplete="off" spellCheck={false}
          placeholder="e.g. 3bcfd28"
          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs font-mono text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
        <datalist id="rollback-previous">{previous.map((v) => <option key={v} value={v} />)}</datalist>
      </label>
      <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-3">
        <p className="text-[11px] font-semibold text-red-300 mb-1">Not rolled back</p>
        <ul className="list-disc pl-5 space-y-0.5 text-xs text-gray-300">{NOT_ROLLED_BACK.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
      <p className="text-[11px] text-gray-500 inline-flex items-center gap-1">
        <ExternalLink size={11} aria-hidden="true" />This screen never deploys or rolls back by itself. The switch happens in Vercel.
      </p>
    </ConfirmImpactDialog>
  )
}
