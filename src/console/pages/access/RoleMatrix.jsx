/**
 * RoleMatrix - "Who can do what": roles across the top, app areas down the side.
 * Each cell carries two one-click switches, web and phone. Clicking a switch
 * STAGES a change (nothing is written); the host's StagedChanges panel shows the
 * plain-English impact and saves the batch with a reason.
 *
 * Cell legend:
 *   solid green  = on (saved rule)          dashed green = on by built-in default
 *   solid gray   = off (saved rule)         dashed gray  = off by built-in default
 *   orange ring  = unsaved change           no phone box = web only area
 * Admin is always on and cannot be switched off (the database forces it too).
 */
import { useMemo, useState } from 'react'
import { Monitor, Smartphone, Lock } from 'lucide-react'
import { MODULE_GROUPS } from '../../../lib/moduleCatalog'
import {
  MOBILE_PREFIX, mobileKeyFor, phoneCell, stageKey, webCell,
} from '../../../lib/accessOverview'
import { Badge, EmptyState, Panel, PanelHeader, SearchInput, Segmented, Toolbar } from '../../components/ui'

function Switch({ kind, state, staged, role, label, onToggle }) {
  if (!state) return <span className="inline-block w-6 h-6" aria-hidden="true" />
  const Icon = kind === 'web' ? Monitor : Smartphone
  const on = staged !== undefined ? staged : state.on
  const surface = kind === 'web' ? 'web' : 'phone'
  const base = on
    ? 'text-emerald-400 border-emerald-600/70 bg-emerald-500/10'
    : 'text-gray-500 border-gray-700 bg-transparent'
  const style = state.saved || staged !== undefined ? 'border-solid' : 'border-dashed'
  const ring = staged !== undefined ? 'ring-2 ring-orange-500 ring-offset-0' : ''
  const title = state.locked
    ? `${role} always has ${label} on the ${surface}`
    : `${role}: ${label} on the ${surface} is ${on ? 'on' : 'off'}${state.saved ? '' : ' (built-in default)'}${staged !== undefined ? ', unsaved' : ''}. Click to switch ${on ? 'off' : 'on'}.`
  return (
    <button type="button" disabled={state.locked} onClick={() => onToggle(!on)} title={title} aria-label={title}
      aria-pressed={on}
      className={`w-6 h-6 inline-flex items-center justify-center rounded-md border ${style} ${base} ${ring} disabled:cursor-not-allowed disabled:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500`}>
      <Icon size={12} aria-hidden="true" />
    </button>
  )
}

export default function RoleMatrix({ permMap, columns, peopleCounts, staged, onToggle }) {
  const [search, setSearch] = useState('')
  const [surface, setSurface] = useState('both')
  const [colFilter, setColFilter] = useState('all')
  const [diffOnly, setDiffOnly] = useState(false)

  const cols = useMemo(
    () => (columns || []).filter((c) => colFilter !== 'custom' || c.custom),
    [columns, colFilter],
  )

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    return MODULE_GROUPS.map((g) => ({
      group: g.group,
      modules: g.modules.filter((m) => {
        if (q && !m.label.toLowerCase().includes(q) && !m.key.includes(q) && !g.group.toLowerCase().includes(q)
          && !cols.some((c) => c.name.toLowerCase().includes(q))) return false
        if (!diffOnly) return true
        const mk = mobileKeyFor(m.key)
        return cols.some((c) => {
          const w = webCell(permMap, c.name, m.key)
          const p = phoneCell(permMap, c.name, mk)
          return (w && w.saved) || (p && p.saved) || staged[stageKey(c.name, m.key)] !== undefined
            || (mk && staged[stageKey(c.name, MOBILE_PREFIX + mk)] !== undefined)
        })
      }),
    })).filter((g) => g.modules.length)
  }, [search, diffOnly, cols, permMap, staged])

  const showWeb = surface !== 'phone'
  const showPhone = surface !== 'web'

  return (
    <Panel flush>
      <div className="px-4 pt-3">
        <PanelHeader title="Who can do what"
          subtitle="Roles across the top, app areas down the side. Each cell shows web and phone. Click to stage a change; nothing saves until you press Save."
          actions={<Segmented ariaLabel="Surface" role="group" value={surface} onChange={setSurface}
            options={[{ key: 'both', label: 'Both' }, { key: 'web', label: 'Web' }, { key: 'phone', label: 'Phone' }]} />} />
        <Toolbar className="pb-3">
          <SearchInput className="w-56" value={search} onChange={setSearch} placeholder="Find an area or role" />
          <Segmented ariaLabel="Columns" role="group" value={colFilter} onChange={setColFilter}
            options={[{ key: 'all', label: `All ${columns.length} roles` }, { key: 'custom', label: 'Custom roles only' }]} />
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
            <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} />
            Only rows with saved rules or unsaved changes
          </label>
          <span className="text-[11px] text-gray-500 ml-auto flex flex-wrap gap-3">
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm border border-emerald-600 bg-emerald-500/20 mr-1" />On</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm border border-gray-600 mr-1" />Off</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm border border-dashed border-gray-500 mr-1" />Built-in default</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm ring-2 ring-orange-500 mr-1" />Unsaved change</span>
          </span>
        </Toolbar>
      </div>
      {!groups.length ? (
        <div className="p-4"><EmptyState title="No area matches" reason="Nothing in the matrix matches this search or filter." /></div>
      ) : (
        <div className="overflow-x-auto border-t border-gray-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-900/60">
                <th scope="col" className="text-left px-3 py-2 text-gray-400 font-medium sticky left-0 bg-gray-900 z-10 min-w-[12rem]">App area</th>
                {cols.map((c) => (
                  <th key={c.name} scope="col" className="px-2 py-2 text-center text-gray-300 font-medium min-w-[6.5rem]">
                    <div className="leading-tight">{c.name}</div>
                    <div className="text-[10px] text-gray-500 font-normal">
                      {typeof peopleCounts?.[c.name] === 'number' ? `${peopleCounts[c.name]} ${peopleCounts[c.name] === 1 ? 'person' : 'people'}` : 'N/A'}
                    </div>
                    {c.custom && <Badge tone="accent">Custom</Badge>}
                    {c.name === 'Admin' && <Badge tone="quiet" icon={Lock}>Always on</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.group} group={g} cols={cols} permMap={permMap} staged={staged}
                  showWeb={showWeb} showPhone={showPhone} onToggle={onToggle} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">
        Delete stays Admin only and is fixed by the database. Capability detail (create, edit, export, approve) is on the Capabilities tab.
      </p>
    </Panel>
  )
}

function GroupRows({ group, cols, permMap, staged, showWeb, showPhone, onToggle }) {
  return (
    <>
      <tr><td colSpan={cols.length + 1} className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-gray-500">{group.group}</td></tr>
      {group.modules.map((m) => {
        const mk = mobileKeyFor(m.key)
        return (
          <tr key={m.key} className="border-t border-gray-800/60 hover:bg-gray-900/40">
            <th scope="row" className="text-left px-3 py-1.5 font-normal sticky left-0 bg-gray-950 z-10">
              <div className="text-gray-200">{m.label}</div>
              <div className="text-[10px] text-gray-500">{m.key}{mk ? ` . phone: ${mk}` : ' . web only'}</div>
            </th>
            {cols.map((c) => {
              const w = webCell(permMap, c.name, m.key)
              const p = phoneCell(permMap, c.name, mk)
              const wk = stageKey(c.name, m.key)
              const pk = mk ? stageKey(c.name, MOBILE_PREFIX + mk) : null
              return (
                <td key={c.name} className="px-2 py-1.5 text-center">
                  <span className="inline-flex gap-1">
                    {showWeb && <Switch kind="web" state={w} staged={staged[wk]} role={c.name} label={m.label}
                      onToggle={(next) => onToggle(c.name, m.key, next, w.on)} />}
                    {showPhone && <Switch kind="phone" state={p} staged={pk ? staged[pk] : undefined} role={c.name} label={m.label}
                      onToggle={(next) => onToggle(c.name, MOBILE_PREFIX + mk, next, p.on)} />}
                  </span>
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}
