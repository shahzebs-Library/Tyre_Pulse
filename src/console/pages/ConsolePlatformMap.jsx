/**
 * Platform Map - one page that answers, for a non-technical owner:
 * "what does my platform HAVE, what does each piece do, and what does it
 * NOT have yet?" Every entry is plain English; the gap list is honest and
 * names who can move each item forward. Derived from the real registries,
 * so it cannot drift from what is actually deployed.
 *
 * Layout: header, five tiles (each opens its tab), "needs attention", then
 * tabs (?tab=backend | gaps | console | web | mobile). One search box filters
 * every tab at once and the tab counts show how many entries match, so a
 * search never hides a result in a tab you are not looking at. The whole
 * inventory exports as one flat list.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Map, Monitor, Smartphone, Shield, AlertTriangle, User, FileUp, Hammer, Server, ExternalLink, SlidersHorizontal,
} from 'lucide-react'
import { Panel, PanelHeader, Note, StatTile, SearchInput, Badge, Segmented, Select, EmptyState, Btn } from '../components/ui'
import {
  consoleSections, webCapabilitySections, mobileSections, filterSections, platformCounts, NOT_BUILT,
  BACKEND_CAPABILITIES, filterBackendCapabilities, undescribedConsoleRoutes,
} from '../../lib/platformMap'
import { CONSOLE_NAV } from '../components/ConsoleLayout'
import { NAV_CATALOG } from '../../components/Layout'
import { MOBILE_MODULES } from '../../lib/mobileModules'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, AttentionList, Collapsible, TabPanel } from './platformOps/kit'

const WHO_META = {
  you: { label: 'Needs your decision', icon: User, tone: 'accent' },
  'customer file': { label: 'Needs a file from the company', icon: FileUp, tone: 'warning' },
  build: { label: 'Engineering not built yet', icon: Hammer, tone: 'quiet' },
}
const TABS = ['backend', 'gaps', 'console', 'web', 'mobile']
const WHO_OPTS = [
  { value: 'all', label: 'Everyone' },
  ...Object.entries(WHO_META).map(([value, m]) => ({ value, label: m.label })),
]
const EXPORT_COLUMNS = [
  { key: 'area', header: 'Area' }, { key: 'group', header: 'Group' },
  { key: 'label', header: 'Capability' }, { key: 'detail', header: 'What it does / who can move it' },
  { key: 'link', header: 'Address' },
]
const count = (secs) => secs.reduce((a, s) => a + s.items.length, 0)
const CARD = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

export default function ConsolePlatformMap() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [who, setWho] = useState('all')
  const [tab, setTab] = useUrlTab(TABS, 'backend')

  const consoleSecs = useMemo(() => consoleSections(CONSOLE_NAV), [])
  const webSecs = useMemo(() => webCapabilitySections(NAV_CATALOG), [])
  const mobileSecs = useMemo(() => mobileSections(MOBILE_MODULES), [])
  const counts = useMemo(
    () => platformCounts({ consoleNav: CONSOLE_NAV, navCatalog: NAV_CATALOG, mobileModules: MOBILE_MODULES }),
    [],
  )
  const undescribed = useMemo(() => undescribedConsoleRoutes(CONSOLE_NAV), [])

  const fConsole = filterSections(consoleSecs, term)
  const fWeb = filterSections(webSecs, term)
  const fMobile = filterSections(mobileSecs, term)
  const fBackend = filterBackendCapabilities(BACKEND_CAPABILITIES, term)
  const q = term.trim().toLowerCase()
  const fGaps = NOT_BUILT
    .filter((g) => !q || g.title.toLowerCase().includes(q) || g.what.toLowerCase().includes(q))
    .filter((g) => who === 'all' || g.who === who)
  const gapsByWho = useMemo(() => NOT_BUILT.reduce((a, g) => ({ ...a, [g.who]: (a[g.who] || 0) + 1 }), {}), [])

  const exportRows = useMemo(() => [
    ...BACKEND_CAPABILITIES.map((b) => ({ area: 'Backend', group: b.group, label: b.label, detail: b.what, link: b.to })),
    ...NOT_BUILT.map((g) => ({ area: 'Known gap', group: WHO_META[g.who]?.label || g.who, label: g.title, detail: g.what, link: '' })),
    ...consoleSecs.flatMap((s) => s.items.map((i) => ({ area: 'Console', group: s.label, label: i.label, detail: i.what, link: i.to }))),
    ...webSecs.flatMap((s) => s.items.map((i) => ({ area: 'Web app', group: s.label, label: i.label, detail: '', link: i.to }))),
    ...mobileSecs.flatMap((s) => s.items.map((i) => ({ area: 'Mobile app', group: s.label, label: i.label, detail: `Open to ${i.openTo}`, link: '' }))),
  ], [consoleSecs, webSecs, mobileSecs])

  const attention = []
  if (gapsByWho.you) {
    attention.push({ key: 'you', tone: 'warning', text: `${gapsByWho.you} ${gapsByWho.you === 1 ? 'gap waits' : 'gaps wait'} on a decision only you can make.`, actionLabel: 'Show them', onAction: () => { setWho('you'); setTerm(''); setTab('gaps') } })
  }
  if (gapsByWho['customer file']) {
    attention.push({ key: 'file', tone: 'info', text: `${gapsByWho['customer file']} ${gapsByWho['customer file'] === 1 ? 'gap needs' : 'gaps need'} a file from the company before it can close.`, actionLabel: 'Show them', onAction: () => { setWho('customer file'); setTerm(''); setTab('gaps') } })
  }
  if (undescribed.length) {
    attention.push({ key: 'undesc', tone: 'info', text: `${undescribed.length} console ${undescribed.length === 1 ? 'page has' : 'pages have'} no plain-English description yet: ${undescribed.join(', ')}.` })
  }

  const matchCount = { backend: fBackend.length, gaps: fGaps.length, console: count(fConsole), web: count(fWeb), mobile: count(fMobile) }
  const pickTab = (t) => { setTab(t) }

  return (
    <div className="space-y-4 max-w-7xl">
      <PageHeader
        icon={Map}
        title="Enterprise Capability Center"
        purpose="Open, govern and inspect console, web, mobile and backend capabilities from one Super Admin workspace."
        actions={<ExportButtons rows={exportRows} columns={EXPORT_COLUMNS} title="Platform Capability Inventory" />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile icon={Shield} label="Console tools" value={counts.consolePages} sub="your control pages" tone="accent"
          onClick={() => pickTab('console')} active={tab === 'console'} />
        <StatTile icon={Monitor} label="Web app areas" value={counts.webAreas} sub="what your team uses"
          onClick={() => pickTab('web')} active={tab === 'web'} />
        <StatTile icon={Smartphone} label="Mobile modules" value={counts.mobileModules} sub="on the field phones" tone="good"
          onClick={() => pickTab('mobile')} active={tab === 'mobile'} />
        <StatTile icon={Server} label="Backend domains" value={counts.backendCapabilities} sub="governed services"
          onClick={() => pickTab('backend')} active={tab === 'backend'} />
        <StatTile icon={AlertTriangle} label="Known gaps" value={counts.gaps} sub="stated, not hidden" tone="warning"
          onClick={() => { setWho('all'); pickTab('gaps') }} active={tab === 'gaps'} />
      </div>

      <AttentionList items={attention} clear="No gap is waiting on you." />

      <nav aria-label="Capability areas" className="flex flex-wrap items-center justify-between gap-2">
        <Segmented ariaLabel="Capability areas" value={tab} onChange={pickTab} options={[
          { key: 'backend', label: <><Server size={13} aria-hidden="true" />Backend</>, count: matchCount.backend },
          { key: 'gaps', label: <><AlertTriangle size={13} aria-hidden="true" />Not built yet</>, count: matchCount.gaps },
          { key: 'console', label: <><Shield size={13} aria-hidden="true" />Console</>, count: matchCount.console },
          { key: 'web', label: <><Monitor size={13} aria-hidden="true" />Web app</>, count: matchCount.web },
          { key: 'mobile', label: <><Smartphone size={13} aria-hidden="true" />Mobile app</>, count: matchCount.mobile },
        ]} />
        <SearchInput value={term} onChange={setTerm} placeholder="Search every capability (e.g. mobile access, cron, backup)" className="w-full sm:w-96" />
      </nav>

      {tab === 'backend' && (
        <TabPanel label="Backend">
          <Panel>
            <PanelHeader icon={Server} title="Backend control plane"
              subtitle="Safe operational entry points for every backend domain. Raw SQL and arbitrary RPC execution stay blocked." />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {fBackend.map((item) => (
                <button key={item.label} type="button" onClick={() => navigate(item.to)}
                  className={`${CARD} rounded-xl border border-gray-800 bg-gray-900/50 p-4 text-left hover:border-orange-700/60 hover:bg-orange-950/10 transition-colors`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500">{item.group}</p>
                      <p className="mt-1 text-sm font-semibold text-gray-100">{item.label}</p>
                    </div>
                    <Badge tone={item.status === 'Live' || item.status === 'Protected' ? 'good' : 'accent'}>{item.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">{item.what}</p>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-orange-400">
                    <span>{item.count == null ? 'Open controls' : `${item.count} governed`}</span>
                    <span className="flex items-center gap-1">Manage <ExternalLink size={10} aria-hidden="true" /></span>
                  </div>
                </button>
              ))}
            </div>
            {fBackend.length === 0 && <EmptyState title="No backend capability matches that" reason="Change the search to see the backend domains." />}
          </Panel>
        </TabPanel>
      )}

      {tab === 'gaps' && (
        <TabPanel label="Not built yet">
          {/* The honest part: what is NOT built, and who can move it. */}
          <Panel tone="warning">
            <PanelHeader icon={AlertTriangle} title="What the platform does NOT have yet" tone="warning"
              subtitle="Stated plainly so nothing is discovered mid-task. Each one names who can move it forward."
              actions={<Select ariaLabel="Who can move it" value={who} onChange={setWho} options={WHO_OPTS} className="w-60" />} />
            {fGaps.length === 0 ? (
              <EmptyState title="No gap matches" reason="Change the search or the owner filter to see every gap."
                action={<Btn onClick={() => { setTerm(''); setWho('all') }}>Show all gaps</Btn>} />
            ) : (
              <div className="space-y-3">
                {fGaps.map((g) => {
                  const meta = WHO_META[g.who] || WHO_META.build
                  const Icon = meta.icon
                  return (
                    <div key={g.title} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-gray-100">{g.title}</p>
                        <Badge tone={meta.tone} icon={Icon}>{meta.label}</Badge>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed">{g.what}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </TabPanel>
      )}

      {tab === 'console' && (
        <TabPanel label="Console">
          <Note icon={Shield}>Only you (super admin) can see these. Click any name to open it.</Note>
          {fConsole.length === 0 ? <Panel><EmptyState title="No console tool matches that" reason="Change the search to see every console page." /></Panel> : fConsole.map((g) => (
            <Collapsible key={`${g.label}:${!!q}`} title={g.label} count={g.items.length} defaultOpen={!!q || fConsole.length <= 3}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {g.items.map((it) => (
                  <button key={it.to} type="button" onClick={() => navigate(it.to)}
                    className={`${CARD} text-left rounded-lg border border-gray-800 bg-gray-900/40 p-2.5 hover:border-orange-800/60 hover:bg-gray-900 transition-colors`}>
                    <p className="text-xs font-semibold text-gray-200">{it.label}</p>
                    <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{it.what || 'No description yet.'}</p>
                  </button>
                ))}
              </div>
            </Collapsible>
          ))}
        </TabPanel>
      )}

      {tab === 'web' && (
        <TabPanel label="Web app">
          <Note icon={Monitor}>Open any live module in a new tab, or jump straight to its access governance with the sliders button.</Note>
          {fWeb.length === 0 ? <Panel><EmptyState title="No web area matches that" reason="Change the search to see every web area." /></Panel> : fWeb.map((g) => (
            <Collapsible key={`${g.label}:${!!q}`} title={g.label} count={g.items.length} defaultOpen={!!q || fWeb.length <= 3}>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((it) => (
                  <div key={it.to} className="flex items-center rounded-md border border-gray-800 bg-gray-900/40 overflow-hidden">
                    <button type="button" onClick={() => window.open(it.to, '_blank', 'noopener,noreferrer')}
                      className={`${CARD} px-2 py-1.5 text-[11px] text-gray-200 hover:bg-orange-950/30`}>{it.label}</button>
                    <button type="button" onClick={() => navigate(`/console/access?surface=web&module=${encodeURIComponent(it.to)}`)}
                      className={`${CARD} border-l border-gray-800 px-1.5 py-1.5 text-gray-500 hover:text-orange-400`} aria-label={`Manage ${it.label} access`} title={`Manage ${it.label} access`}>
                      <SlidersHorizontal size={11} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </Collapsible>
          ))}
        </TabPanel>
      )}

      {tab === 'mobile' && (
        <TabPanel label="Mobile app">
          <Note icon={Smartphone}>Every field module, its default roles, and direct access controls. Release and forced-update controls remain in Mobile App.</Note>
          {fMobile.length === 0 ? <Panel><EmptyState title="No mobile module matches that" reason="Change the search to see every mobile module." /></Panel> : fMobile.map((g) => (
            <Collapsible key={`${g.label}:${!!q}`} title={g.label} count={g.items.length} defaultOpen={!!q || fMobile.length <= 3}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {g.items.map((it) => (
                  <div key={it.label} className="flex items-center justify-between gap-2 rounded-md border border-gray-800 bg-gray-900/40 px-2.5 py-2">
                    <div className="min-w-0"><span className="text-xs text-gray-200 font-medium break-words">{it.label}</span><span className="block text-[10px] text-gray-500">{it.openTo}</span></div>
                    <Btn size="xs" icon={SlidersHorizontal} onClick={() => navigate(`/console/access?surface=mobile&module=${encodeURIComponent(it.key)}`)}>Access</Btn>
                  </div>
                ))}
              </div>
            </Collapsible>
          ))}
        </TabPanel>
      )}

      <Note icon={Map}>
        This map is generated from the same registries the real sidebars use, so it cannot drift from
        what is actually deployed. A new page added anywhere appears here automatically.
      </Note>
    </div>
  )
}
