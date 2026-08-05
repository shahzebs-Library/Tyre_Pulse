/**
 * Platform Map - one page that answers, for a non-technical owner:
 * "what does my platform HAVE, what does each piece do, and what does it
 * NOT have yet?" Every entry is plain English; the gap list is honest and
 * names who can move each item forward. Derived from the real registries,
 * so it cannot drift from what is actually deployed.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Map, Monitor, Smartphone, Shield, AlertTriangle, User, FileUp, Hammer } from 'lucide-react'
import { Panel, PanelHeader, Note, StatTile, SearchInput, Badge } from '../components/ui'
import {
  consoleSections, webSections, mobileSections, filterSections, platformCounts, NOT_BUILT,
} from '../../lib/platformMap'
import { CONSOLE_NAV } from '../components/ConsoleLayout'
import { NAV_CATALOG } from '../../components/Layout'
import { MOBILE_MODULES } from '../../lib/mobileModules'

const WHO_META = {
  you: { label: 'Needs your decision', icon: User, tone: 'accent' },
  'customer file': { label: 'Needs a file from the company', icon: FileUp, tone: 'warning' },
  build: { label: 'Engineering not built yet', icon: Hammer, tone: 'quiet' },
}

export default function ConsolePlatformMap() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')

  const consoleSecs = useMemo(() => consoleSections(CONSOLE_NAV), [])
  const webSecs = useMemo(() => webSections(NAV_CATALOG), [])
  const mobileSecs = useMemo(() => mobileSections(MOBILE_MODULES), [])
  const counts = useMemo(
    () => platformCounts({ consoleNav: CONSOLE_NAV, navCatalog: NAV_CATALOG, mobileModules: MOBILE_MODULES }),
    [],
  )

  const fConsole = filterSections(consoleSecs, term)
  const fWeb = filterSections(webSecs, term)
  const fMobile = filterSections(mobileSecs, term)
  const q = term.trim().toLowerCase()
  const fGaps = q
    ? NOT_BUILT.filter((g) => g.title.toLowerCase().includes(q) || g.what.toLowerCase().includes(q))
    : NOT_BUILT

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-white">Platform Map</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Everything the platform has, in plain English - and the honest list of what it does not have yet.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile icon={Shield} label="Console tools" value={counts.consolePages} sub="your control pages" tone="accent" />
        <StatTile icon={Monitor} label="Web app areas" value={counts.webAreas} sub="what your team uses" tone="info" />
        <StatTile icon={Smartphone} label="Mobile modules" value={counts.mobileModules} sub="on the field phones" tone="good" />
        <StatTile icon={AlertTriangle} label="Known gaps" value={counts.gaps} sub="stated, not hidden" tone="warning" />
      </div>

      <SearchInput value={term} onChange={setTerm} placeholder="Search everything (e.g. duplicate, tyre, backup)" className="max-w-md" />

      {/* The honest part first: what is NOT built, and who can move it. */}
      {fGaps.length > 0 && (
        <Panel tone="warning">
          <PanelHeader icon={AlertTriangle} title="What the platform does NOT have yet" tone="warning"
            subtitle="Stated plainly so nothing is discovered mid-task. Each one names who can move it forward." />
          <div className="px-4 pb-4 space-y-3">
            {fGaps.map((g) => {
              const meta = WHO_META[g.who]
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
        </Panel>
      )}

      <Panel>
        <PanelHeader icon={Shield} title="Console - your control room"
          subtitle="Only you (super admin) can see these. Click any name to open it." />
        <div className="px-4 pb-4 space-y-4">
          {fConsole.map((g) => (
            <div key={g.label}>
              <p className="text-[11px] uppercase tracking-wider text-gray-600 font-semibold mb-2">{g.label}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {g.items.map((it) => (
                  <button key={it.to} type="button" onClick={() => navigate(it.to)}
                    className="text-left rounded-lg border border-gray-800 bg-gray-900/40 p-2.5 hover:border-orange-800/60 hover:bg-gray-900 transition-colors">
                    <p className="text-xs font-semibold text-gray-200">{it.label}</p>
                    <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{it.what}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {fConsole.length === 0 && <p className="text-xs text-gray-600">No console tool matches that.</p>}
        </div>
      </Panel>

      <Panel>
        <PanelHeader icon={Monitor} title="Web app - what your team works in"
          subtitle="Every area of the main application, grouped the way the sidebar groups them. Who sees what is governed in Access Control." />
        <div className="px-4 pb-4 space-y-3">
          {fWeb.map((g) => (
            <div key={g.label}>
              <p className="text-[11px] uppercase tracking-wider text-gray-600 font-semibold mb-1.5">{g.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((label) => (
                  <span key={label} className="text-[11px] px-2 py-1 rounded-md border border-gray-800 bg-gray-900/40 text-gray-300">{label}</span>
                ))}
              </div>
            </div>
          ))}
          {fWeb.length === 0 && <p className="text-xs text-gray-600">No web area matches that.</p>}
        </div>
      </Panel>

      <Panel>
        <PanelHeader icon={Smartphone} title="Mobile app - the field phones"
          subtitle="Each module and which roles open it by default. Per-person overrides live in Access Control; the released version lives in Mobile App Control." />
        <div className="px-4 pb-4 space-y-3">
          {fMobile.map((g) => (
            <div key={g.label}>
              <p className="text-[11px] uppercase tracking-wider text-gray-600 font-semibold mb-1.5">{g.label}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {g.items.map((it) => (
                  <div key={it.label} className="flex items-baseline justify-between gap-2 rounded-md border border-gray-800 bg-gray-900/40 px-2.5 py-1.5">
                    <span className="text-xs text-gray-200 font-medium">{it.label}</span>
                    <span className="text-[10px] text-gray-500 text-right">{it.openTo}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {fMobile.length === 0 && <p className="text-xs text-gray-600">No mobile module matches that.</p>}
        </div>
      </Panel>

      <Note icon={Map} tone="quiet">
        This map is generated from the same registries the real sidebars use, so it cannot drift from
        what is actually deployed. A new page added anywhere appears here automatically.
      </Note>
    </div>
  )
}
