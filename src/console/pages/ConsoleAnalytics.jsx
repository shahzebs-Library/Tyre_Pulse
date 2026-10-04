/**
 * ConsoleAnalytics - /console/analytics. How the platform is actually used.
 *
 * Replaces, and keeps whole as tabs: AI Usage and Metric Catalogue. The
 * overview reads get_platform_activity(): sign-ins, phones opening the app,
 * records written per module per day, the September account cohort, roles,
 * countries and organisations. Page views are NOT recorded (PostHog receives
 * nothing while its key is unset), so nothing here claims to count screens or
 * clicks. Two "active" measures are shown side by side because neither is
 * complete on its own.
 */
import { lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, Users, Smartphone, FileText, Building2, Zap, Info, BookOpen, BellRing, Eye } from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ImpactBox,
} from '../components/ui'
import { TrendChart, BarsChart } from '../components/ui/charts'
import { PageHeader, TabBar, useUrlTab, useRefreshStamp, ConsoleLink } from './shared/pageKit'
import ExportButtons from './shared/ExportButtons'
import Embedded, { MovedFrom } from './monitor/Embedded'
import { getPlatformActivity } from '../../lib/api/monitorCenter'
import { listMetrics } from '../../lib/api/metricRegistry'
import {
  fmtNum, pctOf, fmtPct, riyadhDateTime, shortDate, moduleTable, recordsPerDay, stickiness, metricCertified, MODULE_LABELS,
} from '../../lib/monitorCenter'
import { toUserMessage } from '../../lib/safeError'

const ConsoleAIUsage = lazy(() => import('./ConsoleAIUsage'))
const ConsoleMetricCatalogue = lazy(() => import('./ConsoleMetricCatalogue'))

const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'ai', label: 'AI usage', icon: Zap },
  { key: 'metrics', label: 'Metric catalogue', icon: BookOpen },
]
const TAB_KEYS = TABS.map((t) => t.key)

const MODULE_COLUMNS = [
  { key: 'label', header: 'Module' },
  { key: 'today', header: 'Today' },
  { key: 'last7', header: 'Last 7 days' },
  { key: 'prev7', header: 'Previous 7 days' },
  { key: 'change', header: 'Change', value: (r) => (r.change === 'new' ? 'New' : r.change == null ? 'N/A' : `${r.change}%`) },
  { key: 'd30', header: '30 days' },
  { key: 'share', header: 'Share of 30 days', value: (r) => fmtPct(r.share) },
]
const ORG_COLUMNS = [
  { key: 'name', header: 'Organization' },
  { key: 'members', header: 'Members' },
  { key: 'active30', header: 'Active 30 days' },
  { key: 'active7', header: 'Active 7 days' },
  { key: 'expense_lines', header: 'Expense lines' },
  { key: 'job_cards', header: 'Job cards' },
  { key: 'tyre_records', header: 'Tyre records' },
  { key: 'inspections', header: 'Inspections' },
  { key: 'last_write', header: 'Last record', value: (o) => riyadhDateTime(o.last_write) || 'N/A' },
]

function changeText(c) {
  if (c === 'new') return <Badge tone="good">New</Badge>
  if (c == null) return <span className="text-gray-500">N/A</span>
  return <span className={c > 0 ? 'text-emerald-300' : c < 0 ? 'text-red-300' : 'text-gray-400'}>{c > 0 ? '+' : ''}{c}%</span>
}

export default function ConsoleAnalytics() {
  const [tab, setTab] = useUrlTab(TAB_KEYS, 'overview')
  const { refreshedAt, stamp } = useRefreshStamp()
  const [data, setData] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [orgQ, setOrgQ] = useState('')
  const [metricQ, setMetricQ] = useState('')
  const [certFilter, setCertFilter] = useState('')
  const [days, setDays] = useState('30')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [a, m] = await Promise.allSettled([getPlatformActivity(), listMetrics()])
      if (a.status === 'rejected') throw a.reason
      setData(a.value)
      setMetrics(m.status === 'fulfilled' ? (m.value || []) : null)
      stamp()
    } catch (e) { setError(toUserMessage(e, 'Platform activity could not be loaded.')); setData(null) }
    finally { setLoading(false) }
  }, [stamp])
  useEffect(() => { if (tab === 'overview') load() }, [tab, load])

  const mt = useMemo(() => moduleTable(data?.daily || []), [data])
  const moduleRows = useMemo(() => mt.rows.filter((r) => !moduleFilter || r.module === moduleFilter), [mt, moduleFilter])
  const perDay = useMemo(() => {
    const filtered = (data?.daily || []).filter((d) => !moduleFilter || d.module === moduleFilter)
    return recordsPerDay(filtered, Number(days))
  }, [data, moduleFilter, days])
  const orgs = useMemo(() => (data?.by_org || []).filter((o) => !orgQ || String(o.name || '').toLowerCase().includes(orgQ.toLowerCase())), [data, orgQ])
  const activeOrgs = (data?.by_org || []).filter((o) => Number(o.active30) > 0).length
  const metricRows = useMemo(() => (metrics || []).filter((m) => {
    if (certFilter === 'certified' && !metricCertified(m)) return false
    if (certFilter === 'draft' && metricCertified(m)) return false
    const needle = metricQ.trim().toLowerCase()
    return !needle || `${m.name} ${m.metric_id} ${m.business_owner || ''}`.toLowerCase().includes(needle)
  }), [metrics, metricQ, certFilter])
  const certifiedCount = (metrics || []).filter(metricCertified).length
  const posthogOn = Boolean(import.meta.env?.VITE_POSTHOG_KEY)

  const s = data?.signed_in || {}
  const app = data?.app_opened || {}
  const cohort = data?.cohort || {}
  const ai = data?.ai || {}
  const stickSign = stickiness(s.d7, s.d30)
  const stickApp = stickiness(app.d7, app.d30)
  const driverRow = (data?.by_role || []).find((r) => String(r.role).toLowerCase() === 'driver')

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={BarChart3} title="Analytics"
        purpose="How the platform is actually used: who signs in, what they record, and how each number on the dashboards is defined."
        refreshedAt={tab === 'overview' ? refreshedAt : null} onRefresh={tab === 'overview' ? load : undefined} busy={loading}
        actions={tab === 'overview' && <ExportButtons rows={moduleRows} columns={MODULE_COLUMNS} title="Records written per module" />} />
      <MovedFrom onPick={setTab} items={[{ key: 'ai', label: 'AI Usage' }, { key: 'metrics', label: 'Metric Catalogue' }]} />
      <TabBar tabs={TABS} value={tab} onChange={setTab} ariaLabel="Analytics sections" />

      {tab === 'ai' && <Embedded page={ConsoleAIUsage} label="AI usage" />}
      {tab === 'metrics' && <Embedded page={ConsoleMetricCatalogue} label="metric catalogue" />}

      {tab === 'overview' && (
        <div className="space-y-4">
          {error && <ErrorState message={error} onRetry={load} />}
          {loading && !data && <Panel><LoadingState label="Reading platform activity" rows={5} /></Panel>}

          {data && (<>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
              <span>Sign-in data: <span className="text-gray-300">Recorded</span></span>
              <span>Records written: <span className="text-gray-300">Recorded</span></span>
              <span>Page views and clicks: <span className={posthogOn ? 'text-gray-300' : 'text-amber-300'}>{posthogOn ? 'Collected by PostHog, not shown here' : 'Not recorded'}</span></span>
              <span>Web vs phone split: <span className="text-gray-300">Android only</span></span>
              <span>Data as of: <span className="text-gray-300">{riyadhDateTime(data.generated_at || refreshedAt) || 'N/A'} Riyadh</span></span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatTile label="Active people, 30 days" icon={Users} value={fmtNum(s.d30)}
                sub={`signed in, ${fmtPct(pctOf(s.d30, data.accounts))} of ${fmtNum(data.accounts)}`} />
              <StatTile label="Phones, 30 days" icon={Smartphone} value={fmtNum(app.d30)} sub={`opened the app, ${fmtNum(app.d7)} in 7 days`} />
              <StatTile label="Active people, 7 days" value={fmtNum(app.d7)} sub={`on the app; ${fmtNum(s.d7)} signed in again`} />
              <StatTile label="Records, 30 days" icon={FileText} value={fmtNum(mt.totals.d30)} sub={`${fmtNum(mt.totals.last7)} in 7 days, prev 7: ${fmtNum(mt.totals.prev7)}`} />
              <StatTile label="Active organizations" icon={Building2} value={`${fmtNum(activeOrgs)} of ${fmtNum((data.by_org || []).length)}`}
                sub={`${fmtNum((data.by_org || []).length - activeOrgs)} with no activity`} />
              <StatTile label="AI calls, 30 days" icon={Zap} value={fmtNum(ai.d30)} sub={`${ai.cost_30d == null ? 'cost N/A' : `$${Number(ai.cost_30d).toFixed(2)} spent`}, ${fmtNum(ai.all)} all time`}
                onClick={() => setTab('ai')} />
            </div>

            {!posthogOn && (
              <Note icon={Eye} tone="warning">
                Page views are not being collected. The product analytics tool (PostHog) is wired into the web app but its key is not set in the hosting settings,
                so this page counts sign-ins and saved records only, never screens or clicks. To turn it on, set VITE_POSTHOG_KEY and VITE_POSTHOG_HOST in Vercel and redeploy (owner action).
              </Note>
            )}

            <Panel>
              <PanelHeader icon={FileText} title="Records written per day"
                subtitle={perDay.peak ? `Peak ${fmtNum(perDay.peak.value)} on ${perDay.peak.label}` : 'Nothing written in this window'}
                actions={(<>
                  <Select ariaLabel="Module" value={moduleFilter} onChange={setModuleFilter} placeholder="All modules"
                    options={Object.entries(MODULE_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
                  <Segmented ariaLabel="Window" value={days} onChange={setDays}
                    options={[{ key: '7', label: '7D' }, { key: '30', label: '30D' }, { key: '60', label: '60D' }]} />
                </>)} />
              <TrendChart labels={perDay.labels} series={[{ label: 'Records', values: perDay.values }]} height={200}
                summary={`${fmtNum(perDay.values.reduce((a, b) => a + b, 0))} records in ${days} days.`} />
            </Panel>

            <Panel>
              <PanelHeader icon={FileText} title="Records written per module" subtitle="What people actually entered, by the date each row was created (Riyadh days)." />
              <Table>
                <THead><Th>Module</Th><Th align="right">Today</Th><Th align="right">7 days</Th><Th align="right">Prev 7</Th><Th align="right">Change</Th><Th align="right">30 days</Th><Th align="right">Share</Th></THead>
                <tbody>
                  {moduleRows.map((r) => (
                    <Tr key={r.module}>
                      <Td>{r.label}</Td>
                      <Td align="right" className="tabular-nums">{fmtNum(r.today)}</Td>
                      <Td align="right" className="tabular-nums">{fmtNum(r.last7)}</Td>
                      <Td align="right" className="tabular-nums">{fmtNum(r.prev7)}</Td>
                      <Td align="right">{changeText(r.change)}</Td>
                      <Td align="right" className="tabular-nums">{fmtNum(r.d30)}</Td>
                      <Td align="right">{fmtPct(r.share)}</Td>
                    </Tr>
                  ))}
                  {!moduleFilter && (
                    <Tr>
                      <Td className="font-semibold">All modules</Td>
                      <Td align="right" className="tabular-nums font-semibold">{fmtNum(mt.totals.today)}</Td>
                      <Td align="right" className="tabular-nums font-semibold">{fmtNum(mt.totals.last7)}</Td>
                      <Td align="right" className="tabular-nums font-semibold">{fmtNum(mt.totals.prev7)}</Td>
                      <Td align="right">{changeText(mt.totals.change)}</Td>
                      <Td align="right" className="tabular-nums font-semibold">{fmtNum(mt.totals.d30)}</Td>
                      <Td align="right">100%</Td>
                    </Tr>
                  )}
                </tbody>
              </Table>
              <p className="text-[11px] text-gray-500 mt-2">Expense lines and job cards are mostly uploaded; the rest are typed in by field staff.</p>
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel>
                <PanelHeader icon={Users} title="Active people, measured two ways" subtitle="Neither is complete on its own." />
                <Table>
                  <THead><Th>Measure</Th><Th align="right">30 days</Th><Th align="right">7 days</Th><Th align="right">Stickiness</Th><Th>Watch out</Th></THead>
                  <tbody>
                    <Tr><Td>Signed in</Td><Td align="right">{fmtNum(s.d30)}</Td><Td align="right">{fmtNum(s.d7)}</Td><Td align="right">{fmtPct(stickSign)}</Td>
                      <Td className="text-gray-500">Phones keep people signed in for weeks, so this undercounts.</Td></Tr>
                    <Tr><Td>Opened the Android app</Td><Td align="right">{fmtNum(app.d30)}</Td><Td align="right">{fmtNum(app.d7)}</Td><Td align="right">{fmtPct(stickApp)}</Td>
                      <Td className="text-gray-500">Only Android phones with push on; web is not counted.</Td></Tr>
                  </tbody>
                </Table>
                <p className="text-[11px] text-gray-500 mt-2">Stickiness is active in 7 days out of active in 30 days. A true daily active count needs page views, which are not recorded.</p>
              </Panel>

              <Panel>
                <PanelHeader icon={Users} title="New account activation" subtitle={cohort.month ? `${cohort.month} cohort` : 'Latest month cohort'} />
                <div className="grid grid-cols-3 gap-3">
                  <StatTile label="Accounts created" value={fmtNum(cohort.created)} />
                  <StatTile label="Signed in once" value={fmtNum(cohort.ever_signed)} sub={`${fmtPct(pctOf(cohort.ever_signed, cohort.created))} of them`} />
                  <StatTile label="Within 7 days" value={fmtNum(cohort.signed_7d)} sub={`${fmtPct(pctOf(cohort.signed_7d, cohort.created, 1))} of them`} />
                </div>
                <div className="mt-3">
                  <ImpactBox tone="warning"
                    what={`${fmtNum(s.never)} of ${fmtNum(data.accounts)} accounts have never signed in.`}
                    change="Nothing changes by looking. A reminder goes only if you send one from Notifications."
                    who={driverRow ? `Mostly drivers: ${fmtNum(driverRow.accounts)} driver accounts, ${fmtNum(driverRow.active)} active in 30 days.` : 'See the role table below.'}
                    undo="A reminder cannot be unsent." />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ConsoleLink to="/console/notifications?compose=drivers" icon={BellRing}>Remind inactive drivers</ConsoleLink>
                  <span className="text-[11px] text-gray-500">Opens the announcement composer with the driver audience filled in.</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Day 1 / 7 / 30 retention per cohort is Not recorded: only the latest sign-in is kept, not each visit.</p>
              </Panel>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel>
                <PanelHeader icon={Users} title="By role" subtitle="Accounts, active in 30 days, and phones that opened the app." />
                <Table>
                  <THead><Th>Role</Th><Th align="right">Accounts</Th><Th align="right">Active 30d</Th><Th align="right">App 30d</Th></THead>
                  <tbody>
                    {(data.by_role || []).map((r) => (
                      <Tr key={r.role}><Td>{r.role || 'No role'}</Td><Td align="right">{fmtNum(r.accounts)}</Td><Td align="right">{fmtNum(r.active)}</Td><Td align="right">{fmtNum(r.app)}</Td></Tr>
                    ))}
                  </tbody>
                </Table>
              </Panel>
              <Panel>
                <PanelHeader icon={Building2} title="By country" subtitle="Accounts and people active in 30 days." />
                <BarsChart bars={(data.by_country || []).map((c) => ({ label: c.country || 'Not set', value: Number(c.active) || 0 }))}
                  summary={(data.by_country || []).map((c) => `${c.country || 'Not set'}: ${fmtNum(c.active)} active of ${fmtNum(c.accounts)}`).join('; ')}
                  emptyText="No active people by country yet." />
              </Panel>
            </div>

            <Panel>
              <PanelHeader icon={Building2} title="Per organization" subtitle="Members, activity and the records each company wrote."
                actions={<ExportButtons rows={orgs} columns={ORG_COLUMNS} title="Activity per organization" />} />
              <Toolbar className="mb-3"><SearchInput value={orgQ} onChange={setOrgQ} placeholder="Filter organizations" className="w-full sm:w-64" /></Toolbar>
              {orgs.length === 0 ? <EmptyState title="No organization matches" reason="Clear the filter to see all." /> : (
                <Table>
                  <THead><Th>Organization</Th><Th align="right">Members</Th><Th align="right">Active 30d</Th><Th align="right">Active 7d</Th><Th align="right">Expense lines</Th><Th align="right">Job cards</Th><Th align="right">Tyres</Th><Th align="right">Inspections</Th><Th>Last record</Th></THead>
                  <tbody>
                    {orgs.map((o) => (
                      <Tr key={o.org_id}>
                        <Td>{o.name || 'Unnamed'}</Td>
                        {['members', 'active30', 'active7', 'expense_lines', 'job_cards', 'tyre_records', 'inspections'].map((k) => (
                          <Td key={k} align="right" className="tabular-nums">{fmtNum(o[k])}</Td>
                        ))}
                        <Td nowrap>{shortDate(o.last_write) || 'None'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel>
                <PanelHeader icon={Zap} title="AI assistant" subtitle="Calls and spend. Full detail in the AI usage tab."
                  actions={<Btn onClick={() => setTab('ai')}>Open AI usage</Btn>} />
                <div className="grid grid-cols-3 gap-3">
                  <StatTile label="Calls, 30 days" value={fmtNum(ai.d30)} />
                  <StatTile label="Failed, 30 days" value={fmtNum(ai.failed_30d)} tone={Number(ai.failed_30d) ? 'danger' : 'default'} />
                  <StatTile label="Last call" value={shortDate(ai.last_at) || 'N/A'} />
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Monthly budget: {data.ai_budget == null ? 'N/A, no budget is set' : `$${fmtNum(data.ai_budget)}`}.</p>
              </Panel>

              <Panel>
                <PanelHeader icon={BookOpen} title="Metric catalogue" subtitle={`${fmtNum(certifiedCount)} of ${fmtNum((metrics || []).length)} metrics certified`}
                  actions={<Btn onClick={() => setTab('metrics')}>Open catalogue</Btn>} />
                {metrics === null ? <ErrorState message="The metric catalogue could not be read." onRetry={load} /> : (<>
                  <Toolbar className="mb-2">
                    <SearchInput value={metricQ} onChange={setMetricQ} placeholder="Search metrics" className="w-full sm:w-48" />
                    <Select ariaLabel="Certification" value={certFilter} onChange={setCertFilter} placeholder="All"
                      options={[{ value: 'certified', label: 'Certified' }, { value: 'draft', label: 'Not certified' }]} />
                  </Toolbar>
                  {metricRows.length === 0 ? <EmptyState title="No metric matches" reason="Clear the search or filter." /> : (
                    <ul className="space-y-1.5 text-xs max-h-72 overflow-auto pr-1">
                      {metricRows.map((m) => (
                        <li key={m.metric_id} className="flex items-center justify-between gap-2">
                          <span className="text-gray-300">{m.name || m.metric_id}</span>
                          <span className="flex items-center gap-1.5">
                            <span className="text-gray-500">{m.business_owner || 'No owner'}</span>
                            <Badge tone={metricCertified(m) ? 'good' : 'quiet'}>{metricCertified(m) ? 'Certified' : m.status === 'deprecated' ? 'Deprecated' : 'Draft'}</Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-gray-500 mt-2">Certified means an owner, a refresh time, a calculation reference and at least one dashboard are recorded, or the metric was approved as certified.</p>
                </>)}
              </Panel>
            </div>

            <Note icon={Info}>Numbers on this page count accounts and rows. Nothing here adds money across countries.</Note>
          </>)}
        </div>
      )}
    </div>
  )
}
