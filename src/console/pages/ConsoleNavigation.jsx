import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ListTree, Save, RotateCcw, ArrowUp, ArrowDown, Eye, EyeOff,
  FolderInput, Pencil, CheckCircle2, Menu, Undo2, ChevronDown, ChevronRight, GitCompare,
} from 'lucide-react'
import { NAV_CATALOG } from '../../components/Layout'
import {
  buildNavEditorModel, editorModelToLayout, applyNavLayout,
} from '../../lib/navLayout'
import { getNavLayout, saveNavLayout } from '../../lib/api/navLayout'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Code, Btn, SearchInput, Toolbar, Segmented, Select,
  LoadingState, EmptyState, ErrorState, Modal, Table, THead, Th, Tr, Td,
} from '../components/ui'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, TabPanel } from './shared/pageKit'
import { navChanges } from './navigation/navDiff'

/**
 * Navigation Customizer (super-admin, console). Reorder nav groups, reorder items
 * within a group, move an item to another group, rename a group, and hide
 * groups/items. Persisted org-wide to system_config.nav_layout and applied to the
 * main-app sidebar by Layout.jsx via applyNavLayout.
 *
 * HIDING IS COSMETIC menu tidiness - a hidden item is still route-reachable and
 * still governed by RBAC/flags; this screen never changes access, only the menu.
 *
 * Layout: header with Discard / Reset / Save, five tiles, then two tabs
 * (?tab=editor | changes). Groups in the editor fold away so the page is not a
 * wall of every menu item; a search or filter opens the groups that match. The
 * Changes tab lists every difference from the built-in sidebar and exports it.
 */

// Small square icon button in the console gray family (slate stays dark in
// light mode, so it is not used here).
const ICON_BTN = 'w-7 h-7 flex items-center justify-center rounded-md border border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'
const TABS = ['editor', 'changes']
const SHOW_OPTS = [
  { value: 'all', label: 'Every item' },
  { value: 'hidden', label: 'Hidden items' },
  { value: 'visible', label: 'Visible items' },
  { value: 'moved', label: 'Moved to another group' },
]
const CHANGE_EXPORT = [
  { key: 'kind', header: 'Change' }, { key: 'target', header: 'Menu entry' }, { key: 'detail', header: 'Detail' },
]

export default function ConsoleNavigation() {
  const { logAction } = useConsoleAuth()
  const [model, setModel] = useState(null)      // editor tree [{key,label,defaultLabel,hidden,items:[{key,label,hidden}]}]
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [renaming, setRenaming] = useState(null) // group key being renamed
  const [search, setSearch] = useState('')
  const [show, setShow] = useState('all')
  const [expanded, setExpanded] = useState(() => new Set())
  const [confirmReset, setConfirmReset] = useState(false)
  const [readAt, setReadAt] = useState(null)
  const [tab, setTab] = useUrlTab(TABS, 'editor')

  const defaults = useMemo(() => buildNavEditorModel(NAV_CATALOG, {}), [])
  const defaultGroupOf = useMemo(() => {
    const m = new Map()
    for (const g of defaults) for (const it of g.items) m.set(it.key, g.key)
    return m
  }, [defaults])

  const load = useCallback(async () => {
    setLoading(true); setError(''); setSaved(false)
    try {
      const layout = await getNavLayout({ force: true })
      setModel(buildNavEditorModel(NAV_CATALOG, layout))
      setDirty(false)
      setReadAt(Date.now())
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const groupOptions = useMemo(
    () => (model || []).map((g) => ({ key: g.key, label: g.label })),
    [model],
  )

  // Live preview of the resulting sidebar (visible-only, in effective order).
  const preview = useMemo(
    () => (model ? applyNavLayout(NAV_CATALOG, editorModelToLayout(model)) : []),
    [model],
  )

  const changes = useMemo(() => (model ? navChanges(defaults, model) : []), [defaults, model])

  const stats = useMemo(() => {
    const groups = model || []
    let items = 0; let hiddenItems = 0; let renamed = 0; let moved = 0
    for (const g of groups) {
      if (g.label !== g.defaultLabel) renamed += 1
      for (const it of g.items) {
        items += 1
        if (it.hidden) hiddenItems += 1
        if (defaultGroupOf.get(it.key) && defaultGroupOf.get(it.key) !== g.key) moved += 1
      }
    }
    return {
      groups: groups.length,
      hiddenGroups: groups.filter((g) => g.hidden).length,
      items,
      hiddenItems,
      renamed,
      moved,
      visibleItems: preview.reduce((a, g) => a + g.items.length, 0),
    }
  }, [model, preview, defaultGroupOf])

  const q = search.trim().toLowerCase()
  const filtering = !!q || show !== 'all'
  const matches = (it, groupKey) => {
    const text = !q
      || String(it.label || '').toLowerCase().includes(q)
      || String(it.key || '').toLowerCase().includes(q)
    if (!text) return false
    if (show === 'hidden') return it.hidden
    if (show === 'visible') return !it.hidden
    if (show === 'moved') return !!defaultGroupOf.get(it.key) && defaultGroupOf.get(it.key) !== groupKey
    return true
  }

  function mutate(next) { setModel(next); setDirty(true); setSaved(false) }

  function moveGroup(idx, dir) {
    const to = idx + dir
    if (to < 0 || to >= model.length) return
    const next = model.slice()
    ;[next[idx], next[to]] = [next[to], next[idx]]
    mutate(next)
  }
  function toggleGroupHidden(idx) {
    const next = model.slice()
    next[idx] = { ...next[idx], hidden: !next[idx].hidden }
    mutate(next)
  }
  function renameGroup(idx, label) {
    const next = model.slice()
    const g = next[idx]
    const clean = label.trim()
    next[idx] = { ...g, label: clean === '' ? g.defaultLabel : clean }
    mutate(next)
  }
  function moveItem(gIdx, iIdx, dir) {
    const to = iIdx + dir
    const items = model[gIdx].items
    if (to < 0 || to >= items.length) return
    const nextItems = items.slice()
    ;[nextItems[iIdx], nextItems[to]] = [nextItems[to], nextItems[iIdx]]
    const next = model.slice()
    next[gIdx] = { ...next[gIdx], items: nextItems }
    mutate(next)
  }
  function toggleItemHidden(gIdx, iIdx) {
    const items = model[gIdx].items.slice()
    items[iIdx] = { ...items[iIdx], hidden: !items[iIdx].hidden }
    const next = model.slice()
    next[gIdx] = { ...next[gIdx], items }
    mutate(next)
  }
  function moveItemToGroup(gIdx, iIdx, targetKey) {
    if (!targetKey || targetKey === model[gIdx].key) return
    const tIdx = model.findIndex((g) => g.key === targetKey)
    if (tIdx < 0) return
    const item = model[gIdx].items[iIdx]
    const next = model.map((g) => ({ ...g, items: g.items.slice() }))
    next[gIdx].items.splice(iIdx, 1)
    next[tIdx].items.push(item)
    mutate(next)
    // Follow the item: open the group it landed in.
    setExpanded((e) => new Set([...e, targetKey]))
  }
  function toggleExpanded(key) {
    setExpanded((e) => {
      const n = new Set(e)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const layout = editorModelToLayout(model)
      await saveNavLayout(layout)
      try { await logAction('update_config', null, 'nav_layout', { groups: layout.groups.length, items: layout.items.length, changes: changes.length }) } catch { /* non-fatal */ }
      setSaved(true); setDirty(false)
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setConfirmReset(false)
    setSaving(true); setError(''); setSaved(false)
    try {
      await saveNavLayout({ version: 1, groups: [], items: [] })
      try { await logAction('update_config', null, 'nav_layout', { reset: true }) } catch { /* non-fatal */ }
      setModel(buildNavEditorModel(NAV_CATALOG, {}))
      setSaved(true); setDirty(false)
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const allKeys = (model || []).map((g) => g.key)
  const allOpen = allKeys.length > 0 && allKeys.every((k) => expanded.has(k))

  return (
    <div className="space-y-4 max-w-7xl">
      <PageHeader
        icon={ListTree}
        title="Navigation Customizer"
        purpose="Reorder the main-app sidebar, move items between groups, rename groups and hide clutter. Applies org-wide."
        refreshedAt={readAt}
        meta={dirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
        actions={(
          <>
            <Btn icon={Undo2} onClick={load} disabled={saving || loading || !dirty} title="Discard unsaved changes">
              Discard
            </Btn>
            <Btn icon={RotateCcw} onClick={() => setConfirmReset(true)} disabled={saving || loading}>
              Reset to defaults
            </Btn>
            <Btn variant="primary" icon={Save} onClick={handleSave} busy={saving} disabled={loading || !dirty}>
              Save layout
            </Btn>
          </>
        )}
      />

      <Note icon={EyeOff}>
        Hiding is menu tidiness only. A hidden item is still reachable by its address, and access is still
        governed by roles and permissions.
      </Note>

      <ErrorState message={error} onRetry={!model ? load : undefined} />
      {saved && (
        <Note icon={CheckCircle2} tone="accent">
          Navigation saved. The sidebar uses it now; other users pick it up on their next load.
        </Note>
      )}

      {loading ? (
        <LoadingState label="Loading navigation" rows={6} />
      ) : !model || model.length === 0 ? (
        <Panel>
          <EmptyState
            icon={ListTree}
            title={error ? 'Navigation could not be loaded' : 'No navigation groups found'}
            reason={error
              ? 'The saved layout could not be read, so nothing is shown. Retry above.'
              : 'The sidebar catalog has no groups to arrange.'}
          />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatTile label="Groups" value={stats.groups}
              sub={stats.hiddenGroups ? `${stats.hiddenGroups} hidden` : 'None hidden'} />
            <StatTile label="Menu items" value={stats.items} onClick={() => { setShow('all'); setTab('editor') }} active={tab === 'editor' && show === 'all'} />
            <StatTile label="Shown in sidebar" value={stats.visibleItems} tone="accent"
              sub="Before role filtering" onClick={() => { setShow('visible'); setTab('editor') }} active={show === 'visible'} />
            <StatTile label="Hidden items" value={stats.hiddenItems} tone={stats.hiddenItems ? 'warning' : 'default'}
              sub={stats.renamed ? `${stats.renamed} groups renamed` : 'No groups renamed'}
              onClick={() => { setShow('hidden'); setTab('editor') }} active={show === 'hidden'} />
            <StatTile icon={GitCompare} label="Changes from default" value={changes.length}
              sub={stats.moved ? `${stats.moved} items moved` : 'No items moved'} tone={changes.length ? 'accent' : 'default'}
              onClick={() => setTab('changes')} active={tab === 'changes'} />
          </div>

          <nav aria-label="Navigation views" className="flex flex-wrap items-center justify-between gap-2">
            <Segmented ariaLabel="Navigation views" value={tab} onChange={setTab} options={[
              { key: 'editor', label: <><ListTree size={13} aria-hidden="true" />Editor</> },
              { key: 'changes', label: <><GitCompare size={13} aria-hidden="true" />Changes from default</>, count: changes.length },
            ]} />
          </nav>

          {tab === 'changes' ? (
            <TabPanel label="Changes from default">
              <Panel>
                <PanelHeader icon={GitCompare} title="Changes from the built-in sidebar"
                  subtitle={dirty ? 'Includes changes you have not saved yet.' : 'What the saved layout changes compared with the built-in menu.'}
                  actions={<ExportButtons rows={changes} columns={CHANGE_EXPORT} title="Navigation Changes" />} />
                {changes.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="The sidebar is the built-in default" reason="No group or item has been reordered, renamed, moved or hidden." />
                ) : (
                  <Table>
                    <THead><Th>Change</Th><Th>Menu entry</Th><Th>Detail</Th></THead>
                    <tbody>
                      {changes.map((c, i) => (
                        <Tr key={`${c.kind}:${c.target}:${i}`}>
                          <Td nowrap><Badge tone={c.tone}>{c.kind}</Badge></Td>
                          <Td className="text-gray-200">{c.target}</Td>
                          <Td className="text-gray-400">{c.detail}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Panel>
            </TabPanel>
          ) : (
            <TabPanel label="Editor">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                {/* Editor */}
                <div className="lg:col-span-2 space-y-3">
                  <Toolbar>
                    <SearchInput value={search} onChange={setSearch} placeholder="Filter items by name or key" className="flex-1 min-w-[12rem]" />
                    <Select ariaLabel="Show items" value={show} onChange={setShow} options={SHOW_OPTS} className="w-48" />
                    <Btn onClick={() => setExpanded(allOpen ? new Set() : new Set(allKeys))} disabled={filtering}>
                      {allOpen ? 'Collapse all' : 'Expand all'}
                    </Btn>
                  </Toolbar>
                  {model.map((g, gIdx) => {
                    const shown = g.items.map((it, iIdx) => ({ it, iIdx })).filter(({ it }) => matches(it, g.key))
                    if (filtering && shown.length === 0) return null
                    const open = filtering || expanded.has(g.key)
                    const bodyId = `nav-group-${g.key}`
                    return (
                      <Panel key={g.key} flush className={g.hidden ? 'opacity-70' : ''}>
                        <div className={`flex flex-wrap items-center gap-2 px-3 py-2 ${open ? 'border-b border-gray-800' : ''}`}>
                          <button type="button" className={ICON_BTN} onClick={() => toggleExpanded(g.key)} disabled={filtering}
                            aria-expanded={open} aria-controls={bodyId} aria-label={`${open ? 'Collapse' : 'Expand'} group ${g.label}`}
                            title={filtering ? 'Open while a filter is active' : open ? 'Collapse' : 'Expand'}>
                            {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                          </button>
                          <Menu size={14} className="text-gray-500 flex-shrink-0" aria-hidden="true" />
                          {renaming === g.key ? (
                            <input
                              autoFocus
                              defaultValue={g.label}
                              aria-label={`Rename ${g.defaultLabel}`}
                              onBlur={(e) => { renameGroup(gIdx, e.target.value); setRenaming(null) }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { renameGroup(gIdx, e.target.value); setRenaming(null) } if (e.key === 'Escape') setRenaming(null) }}
                              className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 focus:border-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                            />
                          ) : (
                            <button type="button" onClick={() => setRenaming(g.key)} title="Rename group"
                              className="flex-1 min-w-0 text-left inline-flex items-center gap-1.5 group rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                              <span className="sr-only">Rename group </span>
                              <span className="text-sm font-semibold text-gray-100 truncate">{g.label}</span>
                              {g.label !== g.defaultLabel && <Badge tone="accent">was {g.defaultLabel}</Badge>}
                              <Pencil size={11} className="text-gray-500 group-hover:text-gray-300 flex-shrink-0" aria-hidden="true" />
                            </button>
                          )}
                          {g.hidden && <Badge tone="quiet" icon={EyeOff}>Hidden</Badge>}
                          <span className="text-[11px] text-gray-500 tabular-nums flex-shrink-0"
                            title="Visible items of total items">
                            {g.items.filter((i) => !i.hidden).length}/{g.items.length}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button className={ICON_BTN} title="Move group up" aria-label={`Move group ${g.label} up`} disabled={gIdx === 0} onClick={() => moveGroup(gIdx, -1)}><ArrowUp size={13} aria-hidden="true" /></button>
                            <button className={ICON_BTN} title="Move group down" aria-label={`Move group ${g.label} down`} disabled={gIdx === model.length - 1} onClick={() => moveGroup(gIdx, 1)}><ArrowDown size={13} aria-hidden="true" /></button>
                            <button className={ICON_BTN} title={g.hidden ? 'Show group' : 'Hide group'} aria-label={`${g.hidden ? 'Show' : 'Hide'} group ${g.label}`} aria-pressed={!g.hidden} onClick={() => toggleGroupHidden(gIdx)}>
                              {g.hidden ? <EyeOff size={13} className="text-gray-500" /> : <Eye size={13} className="text-emerald-400" />}
                            </button>
                          </div>
                        </div>

                        {open && (
                          <div id={bodyId} className="p-2 space-y-1">
                            {g.items.length === 0 && <p className="text-[11px] text-gray-500 px-2 py-1">No items.</p>}
                            {shown.map(({ it, iIdx }) => {
                              const homeGroup = defaultGroupOf.get(it.key)
                              const movedFrom = homeGroup && homeGroup !== g.key ? defaults.find((d) => d.key === homeGroup)?.label : null
                              return (
                                <div key={it.key} className={`flex flex-wrap items-center gap-2 px-2 py-1 rounded-lg ${it.hidden ? 'opacity-50' : 'hover:bg-gray-800/60'}`}>
                                  <span className="text-[13px] text-gray-200 truncate flex-1 min-w-0">{it.label}</span>
                                  {it.hidden && <Badge tone="quiet">Hidden</Badge>}
                                  {movedFrom && <Badge tone="info">from {movedFrom}</Badge>}
                                  <span className="hidden sm:inline max-w-[140px] truncate"><Code>{it.key}</Code></span>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button className={ICON_BTN} title="Move up" aria-label={`Move ${it.label} up`} disabled={iIdx === 0} onClick={() => moveItem(gIdx, iIdx, -1)}><ArrowUp size={12} aria-hidden="true" /></button>
                                    <button className={ICON_BTN} title="Move down" aria-label={`Move ${it.label} down`} disabled={iIdx === g.items.length - 1} onClick={() => moveItem(gIdx, iIdx, 1)}><ArrowDown size={12} aria-hidden="true" /></button>
                                    <div className="relative inline-flex items-center">
                                      <FolderInput size={12} className="absolute left-1.5 text-gray-500 pointer-events-none" aria-hidden="true" />
                                      <select
                                        value={g.key}
                                        onChange={(e) => moveItemToGroup(gIdx, iIdx, e.target.value)}
                                        title="Move to group"
                                        aria-label={`Move ${it.label} to group`}
                                        className="appearance-none h-7 pl-6 pr-2 rounded-md border border-gray-800 bg-gray-900 text-[11px] text-gray-300 hover:text-gray-100 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 max-w-[130px]"
                                      >
                                        {groupOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                                      </select>
                                    </div>
                                    <button className={ICON_BTN} title={it.hidden ? 'Show item' : 'Hide item'} aria-label={`${it.hidden ? 'Show' : 'Hide'} ${it.label}`} aria-pressed={!it.hidden} onClick={() => toggleItemHidden(gIdx, iIdx)}>
                                      {it.hidden ? <EyeOff size={12} className="text-gray-500" /> : <Eye size={12} className="text-emerald-400" />}
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </Panel>
                    )
                  })}
                  {filtering && model.every((g) => !g.items.some((it) => matches(it, g.key))) && (
                    <Panel>
                      <EmptyState title="No items match"
                        reason={q ? `No menu item name or key contains "${search.trim()}" with this filter.` : 'No item matches this filter.'}
                        action={<Btn onClick={() => { setSearch(''); setShow('all') }}>Clear filter</Btn>} />
                    </Panel>
                  )}
                </div>

                {/* Live preview */}
                <div className="lg:sticky lg:top-4">
                  <Panel>
                    <PanelHeader title="Live preview" subtitle="Menu structure only. Each user still sees only what their role allows." />
                    <div className="max-h-[70vh] overflow-y-auto pr-1">
                      {preview.length === 0 ? (
                        <EmptyState icon={EyeOff} title="Everything hidden" reason="Every group or item is hidden, so the sidebar would be empty." />
                      ) : preview.map((g) => (
                        <div key={g.key} className="mb-3">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{g.label}</p>
                          <div className="space-y-0.5">
                            {g.items.map((it) => (
                              <div key={it.to} className="text-[12px] text-gray-300 px-2 py-1 rounded-md bg-gray-800/40 truncate">{it.label}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              </div>
            </TabPanel>
          )}
        </>
      )}

      <Modal
        open={confirmReset}
        title="Reset navigation to defaults"
        onClose={() => setConfirmReset(false)}
        width="max-w-md"
        footer={(
          <>
            <Btn onClick={() => setConfirmReset(false)} disabled={saving}>Cancel</Btn>
            <Btn variant="danger" icon={RotateCcw} onClick={handleReset} busy={saving}>Reset for everyone</Btn>
          </>
        )}
      >
        <p className="text-xs text-gray-300 leading-relaxed">
          This clears every custom group order, rename, move and hidden item for the whole organisation and
          saves the built-in sidebar straight away. It cannot be undone from here.
          {changes.length ? ` It removes ${changes.length} ${changes.length === 1 ? 'change' : 'changes'} (see the Changes tab).` : ''}
        </p>
      </Modal>
    </div>
  )
}
