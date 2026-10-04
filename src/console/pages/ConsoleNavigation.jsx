import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ListTree, Save, RotateCcw, ArrowUp, ArrowDown, Eye, EyeOff,
  FolderInput, Pencil, CheckCircle2, Menu, Undo2, ChevronDown, ChevronRight, GitCompare, History, GripVertical, Users,
} from 'lucide-react'
import { NAV_CATALOG } from '../../components/Layout'
import {
  buildNavEditorModel, editorModelToLayout, applyNavLayout,
} from '../../lib/navLayout'
import { getNavLayout, saveNavLayout, invalidateNavLayout } from '../../lib/api/navLayout'
import { listConfigHistory, setConfigWithReason, namesFor } from '../../lib/api/consolePlatform'
import { rolesAllowedByModule } from './navigation/navReach'
import { fetchConfigStamps } from './config/configStamps'
import { governingModuleKey } from '../../lib/navAccess'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Code, Btn, SearchInput, Toolbar, Segmented, Select,
  LoadingState, EmptyState, ErrorState, Table, THead, Th, Tr, Td, ConfirmImpactDialog,
} from '../components/ui'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, TabPanel, usePaged, Pager, fmtDateTime, fmtRelative } from './shared/pageKit'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { navChanges, moveItemTo, moveGroupTo, describeLayout } from './navigation/navDiff'

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
const TABS = ['editor', 'changes', 'versions']
const EMPTY_LAYOUT = { version: 1, groups: [], items: [] }
const SHOW_OPTS = [
  { value: 'all', label: 'Every item' },
  { value: 'hidden', label: 'Hidden items' },
  { value: 'visible', label: 'Visible items' },
  { value: 'moved', label: 'Moved to another group' },
]
const CHANGE_EXPORT = [
  { key: 'kind', header: 'Change' }, { key: 'target', header: 'Menu entry' }, { key: 'detail', header: 'Detail' },
]

export default function ConsoleNavigation({ tabParam = 'tab' } = {}) {
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
  const [tab, setTab] = useUrlTab(TABS, 'editor', tabParam)
  const [versions, setVersions] = useState({ state: 'loading', rows: [], names: {} })
  const [restore, setRestore] = useState(null) // { row, value, label } or { reset: true }
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreError, setRestoreError] = useState('')
  const [reach, setReach] = useState(null) // { moduleKey: roles allowed } or null when unread
  const [drag, setDrag] = useState(null) // { type: 'item', g, i } | { type: 'group', g }
  const [stamp, setStamp] = useState(null)
  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => fetchConfigStamps(['nav_layout'])).then((m) => { if (alive) setStamp(m.nav_layout || null) }).catch(() => {})
    return () => { alive = false }
  }, [versions])

  // Every saved layout is in system_config_history (old and new value), so a
  // save can be undone and any earlier layout restored.
  const loadVersions = useCallback(async () => {
    try {
      const rows = await listConfigHistory({ key: 'nav_layout', limit: 50 })
      const names = await namesFor(rows.map((r) => r.changed_by)).catch(() => ({}))
      setVersions({ state: 'ok', rows, names })
    } catch {
      setVersions({ state: 'error', rows: [], names: {} })
    }
  }, [])
  useEffect(() => { loadVersions() }, [loadVersions])
  useEffect(() => {
    let alive = true
    Promise.resolve().then(rolesAllowedByModule).then((out) => { if (alive) setReach(out) })
      .catch(() => { if (alive) setReach(null) })
    return () => { alive = false }
  }, [])
  const rolesFor = (routeKey) => {
    if (!reach) return null
    try { return reach[governingModuleKey(routeKey)] ?? 0 } catch { return null }
  }

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
      loadVersions()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleReset(reason) {
    setConfirmReset(false)
    setSaving(true); setError(''); setSaved(false)
    try {
      if (reason) {
        await setConfigWithReason('nav_layout', JSON.stringify(EMPTY_LAYOUT), reason)
        try { invalidateNavLayout() } catch { /* cache only */ }
      } else {
        await saveNavLayout(EMPTY_LAYOUT)
      }
      try { await logAction('update_config', null, 'nav_layout', { reset: true, reason: reason || null }) } catch { /* non-fatal */ }
      setModel(buildNavEditorModel(NAV_CATALOG, {}))
      setSaved(true); setDirty(false)
      loadVersions()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  /** Put an earlier layout back for everyone (reason required, audited). */
  async function handleRestore(reason) {
    if (!restore) return
    if (restore.reset) { setRestore(null); await handleReset(reason); return }
    setRestoreBusy(true); setRestoreError('')
    try {
      let parsed = {}
      try { parsed = restore.value ? JSON.parse(restore.value) : {} } catch { parsed = {} }
      await setConfigWithReason('nav_layout', restore.value ? JSON.stringify(parsed) : JSON.stringify(EMPTY_LAYOUT), reason)
      try { invalidateNavLayout() } catch { /* cache only */ }
      try { await logAction('update_config', null, 'nav_layout', { restored_from: restore.row?.changed_at || null, reason }) } catch { /* non-fatal */ }
      setRestore(null)
      setModel(buildNavEditorModel(NAV_CATALOG, parsed))
      setDirty(false); setSaved(true)
      loadVersions()
    } catch (e) {
      setRestoreError(toUserMessage(e))
    } finally {
      setRestoreBusy(false)
    }
  }

  function dropOnItem(gIdx, iIdx) {
    if (!drag) return
    if (drag.type === 'item') mutate(moveItemTo(model, { g: drag.g, i: drag.i }, { g: gIdx, i: iIdx }))
    setDrag(null)
  }
  function dropOnGroup(gIdx) {
    if (!drag) return
    if (drag.type === 'group') mutate(moveGroupTo(model, drag.g, gIdx))
    else if (drag.type === 'item' && drag.g !== gIdx) {
      mutate(moveItemTo(model, { g: drag.g, i: drag.i }, { g: gIdx, i: model[gIdx].items.length }))
      setExpanded((e) => new Set([...e, model[gIdx].key]))
    }
    setDrag(null)
  }
  const lastSave = versions.rows[0] || null

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
            <Btn icon={History} disabled={saving || loading || !lastSave}
              title={lastSave ? `Put back the layout from before ${fmtDateTime(lastSave.changed_at)}` : 'No recorded save to undo'}
              onClick={() => { setRestoreError(''); setRestore({ row: lastSave, value: lastSave.old_value, label: 'the layout before the last save' }) }}>
              Undo last save
            </Btn>
            <Btn icon={RotateCcw} variant="danger" onClick={() => setConfirmReset(true)} disabled={saving || loading}>
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
        governed by roles and permissions. Drag rows (or use the arrows) to reorder; drop an item on a group
        header to move it there. Saving applies to every user on the web app; the Flutter app has its own menu.
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
              { key: 'versions', label: <><History size={13} aria-hidden="true" />Saved versions</>, count: versions.state === 'ok' ? versions.rows.length : null },
            ]} />
            <span className="text-[11px] text-gray-500">
              {versions.state === 'ok'
                ? (lastSave ? `Last saved ${fmtRelative(lastSave.changed_at)} by ${versions.names[lastSave.changed_by] || (lastSave.changed_by ? 'unknown person' : 'system')}`
                  : stamp?.updated_at ? `Last saved ${fmtRelative(stamp.updated_at)} (person not recorded before 30 Sep 2026)` : 'Never saved: the built-in sidebar is in use')
                : stamp?.updated_at ? `Last saved ${fmtRelative(stamp.updated_at)}` : versions.state === 'error' ? 'Last save: N/A (history not readable)' : ''}
            </span>
          </nav>

          {tab === 'versions' ? (
            <TabPanel label="Saved versions">
              <VersionsPanel versions={versions} onRetry={loadVersions}
                onRestore={(row, which) => { setRestoreError(''); setRestore({ row, value: which === 'old' ? row.old_value : row.new_value, label: which === 'old' ? `the layout before ${fmtDateTime(row.changed_at)}` : `the layout saved ${fmtDateTime(row.changed_at)}` }) }} />
            </TabPanel>
          ) : tab === 'changes' ? (
            <TabPanel label="Changes from default">
              <Panel>
                <PanelHeader icon={GitCompare} title="Changes from the built-in sidebar"
                  subtitle={dirty ? 'Includes changes you have not saved yet.' : 'What the saved layout changes compared with the built-in menu.'}
                  actions={<ExportButtons rows={changes} columns={CHANGE_EXPORT} title="Navigation Changes" />} />
                {changes.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="The sidebar is the built-in default" reason="No group or item has been reordered, renamed, moved or hidden." />
                ) : (
                  <ChangesTable changes={changes} />
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
                        <div className={`flex flex-wrap items-center gap-2 px-3 py-2 ${open ? 'border-b border-gray-800' : ''} ${drag ? 'outline-dashed outline-1 outline-gray-700' : ''}`}
                          draggable={!filtering && renaming !== g.key}
                          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ type: 'group', g: gIdx }) }}
                          onDragEnd={() => setDrag(null)}
                          onDragOver={(e) => { if (drag) e.preventDefault() }}
                          onDrop={(e) => { e.preventDefault(); dropOnGroup(gIdx) }}>
                          <GripVertical size={13} className="text-gray-500 cursor-grab flex-shrink-0" aria-hidden="true" />
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
                            <button className={`${ICON_BTN} w-auto px-2 gap-1 text-[11px]`} title={g.hidden ? 'Show group in the sidebar' : 'Hide group from the sidebar (pages stay reachable by link)'} aria-label={`${g.hidden ? 'Show' : 'Hide'} group ${g.label}`} aria-pressed={!g.hidden} onClick={() => toggleGroupHidden(gIdx)}>
                              {g.hidden ? <EyeOff size={13} className="text-gray-500" aria-hidden="true" /> : <Eye size={13} className="text-emerald-400" aria-hidden="true" />}
                              <span aria-hidden="true">{g.hidden ? 'Show' : 'Hide'}</span>
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
                                <div key={it.key} className={`flex flex-wrap items-center gap-2 px-2 py-1 rounded-lg ${it.hidden ? 'opacity-50' : 'hover:bg-gray-800/60'}`}
                                  draggable={!filtering}
                                  onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; setDrag({ type: 'item', g: gIdx, i: iIdx }) }}
                                  onDragEnd={() => setDrag(null)}
                                  onDragOver={(e) => { if (drag?.type === 'item') e.preventDefault() }}
                                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOnItem(gIdx, iIdx) }}>
                                  {!filtering && <GripVertical size={12} className="text-gray-500 cursor-grab flex-shrink-0" aria-hidden="true" />}
                                  <span className="text-[13px] text-gray-200 truncate flex-1 min-w-0">{it.label}</span>
                                  {it.hidden && <Badge tone="quiet" title="Still reachable by its address and still governed by access rules">Hidden</Badge>}
                                  {rolesFor(it.key) != null && (
                                    <span className="text-[10px] text-gray-500 inline-flex items-center gap-0.5" title="Roles allowed this page in Access Control (other roles follow their defaults)">
                                      <Users size={10} aria-hidden="true" />{rolesFor(it.key)}
                                    </span>
                                  )}
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
                                    <button className={`${ICON_BTN} w-auto px-2 gap-1 text-[11px]`} title={it.hidden ? 'Show item in the sidebar' : 'Hide item from the sidebar (still reachable by link)'} aria-label={`${it.hidden ? 'Show' : 'Hide'} ${it.label}`} aria-pressed={!it.hidden} onClick={() => toggleItemHidden(gIdx, iIdx)}>
                                      {it.hidden ? <EyeOff size={12} className="text-gray-500" aria-hidden="true" /> : <Eye size={12} className="text-emerald-400" aria-hidden="true" />}
                                      <span aria-hidden="true">{it.hidden ? 'Show' : 'Hide'}</span>
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

      <ConfirmImpactDialog open={confirmReset} danger requireReason typedWord="RESET" busy={saving}
        title="Reset navigation to defaults?" confirmLabel="Reset for everyone"
        onCancel={() => setConfirmReset(false)} onConfirm={({ reason }) => handleReset(reason)}
        impact={{
          tone: 'danger',
          what: 'The built-in sidebar is saved straight away for the whole platform.',
          change: `Every custom group order, rename, move and hidden item is removed${changes.length ? ` (${changes.length} ${changes.length === 1 ? 'change' : 'changes'}, see the Changes tab)` : ''}.`,
          who: 'Every web app user sees the built-in menu on their next load. Access rules do not change.',
          undo: 'Yes. Saved versions keep the layout you are replacing, so Undo last save puts it back.',
        }} />

      <ConfirmImpactDialog open={!!restore} requireReason busy={restoreBusy} error={restoreError}
        title="Restore an earlier navigation?" confirmLabel="Restore for everyone"
        onCancel={() => setRestore(null)} onConfirm={({ reason }) => handleRestore(reason)}
        impact={restore ? {
          tone: 'warning',
          what: `Put back ${restore.label}.`,
          change: `The sidebar becomes: ${describeLayout(restore.value)}.${dirty ? ' Your unsaved edits are discarded.' : ''}`,
          who: 'Every web app user on their next load. Access rules do not change.',
          undo: 'Yes. The layout you replace is kept in Saved versions.',
        } : null} />
    </div>
  )
}

/**
 * The change list, filterable by kind of change, searchable, sortable and
 * paged. The export button in the panel header still exports every change
 * (the full diff is what gets reviewed), independent of this view's filter.
 */
function ChangesTable({ changes }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const { sort, onSort } = useTableSort(null)
  const kinds = useMemo(() => [...new Set(changes.map((c) => c.kind))].sort(), [changes])
  const shown = useMemo(() => {
    const byKind = kind ? changes.filter((c) => c.kind === kind) : changes
    return sortRows(searchRows(byKind, query, ['kind', 'target', 'detail']), sort)
  }, [changes, kind, query, sort])
  const paged = usePaged(shown, 25, `${kind}|${query}`)
  return (
    <>
      <Toolbar className="mb-2">
        <Select ariaLabel="Kind of change" value={kind} onChange={setKind} placeholder="Every kind of change" className="w-52"
          options={kinds.map((k) => ({ value: k, label: k }))} />
        <SearchInput value={query} onChange={setQuery} placeholder="Search menu entry or detail" className="flex-1 min-w-[12rem]" />
      </Toolbar>
      {shown.length === 0 ? (
        <EmptyState icon={GitCompare} title="No change matches" reason="Nothing matches this kind and search. Clear them to see every change." />
      ) : (
        <>
          <Table>
            <THead>
              <Th sortKey="kind" sort={sort} onSort={onSort}>Change</Th>
              <Th sortKey="target" sort={sort} onSort={onSort}>Menu entry</Th>
              <Th sortKey="detail" sort={sort} onSort={onSort}>Detail</Th>
            </THead>
            <tbody>
              {paged.pageRows.map((c, i) => (
                <Tr key={`${c.kind}:${c.target}:${i}`}>
                  <Td nowrap><Badge tone={c.tone}>{c.kind}</Badge></Td>
                  <Td className="text-gray-200">{c.target}</Td>
                  <Td className="text-gray-400">{c.detail}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager {...paged} label="changes" />
        </>
      )}
    </>
  )
}

/** Every saved navigation layout, from the system_config change history. */
function VersionsPanel({ versions, onRetry, onRestore }) {
  const paged = usePaged(versions.rows, 15)
  const rows = versions.rows.map((r) => ({
    when: fmtDateTime(r.changed_at), by: versions.names[r.changed_by] || (r.changed_by ? 'Unknown person' : 'System'),
    before: describeLayout(r.old_value), after: describeLayout(r.new_value), reason: r.reason || 'Not recorded',
  }))
  return (
    <Panel>
      <PanelHeader icon={History} title="Saved versions"
        subtitle="Every save since 30 Sep 2026 with the layout before and after. Restoring needs a reason and is recorded too."
        actions={<ExportButtons rows={rows} title="Navigation saved versions" columns={[
          { key: 'when', header: 'When' }, { key: 'by', header: 'By' }, { key: 'before', header: 'Before' },
          { key: 'after', header: 'After' }, { key: 'reason', header: 'Reason' },
        ]} />} />
      {versions.state === 'loading' ? <LoadingState label="Reading saved versions" rows={3} /> : versions.state === 'error' ? (
        <ErrorState message="Saved versions could not be read. Only a super admin can read the change history." onRetry={onRetry} />
      ) : versions.rows.length === 0 ? (
        <EmptyState icon={History} title="No save recorded yet" reason="Recording started on 30 Sep 2026. The next save appears here and can be undone." />
      ) : (
        <>
          <Table>
            <THead><Th>When</Th><Th>By</Th><Th>Before</Th><Th>After</Th><Th>Reason</Th><Th align="right">Restore</Th></THead>
            <tbody>
              {paged.rows.map((r) => (
                <Tr key={r.id}>
                  <Td nowrap className="text-gray-300">{fmtDateTime(r.changed_at)}</Td>
                  <Td className="text-gray-400">{versions.names[r.changed_by] || (r.changed_by ? 'Unknown person' : 'System')}</Td>
                  <Td className="text-gray-400">{describeLayout(r.old_value)}</Td>
                  <Td className="text-gray-400">{describeLayout(r.new_value)}</Td>
                  <Td className="text-gray-400">{r.reason || 'Not recorded'}</Td>
                  <Td align="right" nowrap>
                    <span className="inline-flex gap-1">
                      <Btn size="xs" icon={Undo2} onClick={() => onRestore(r, 'old')}>Before</Btn>
                      <Btn size="xs" icon={History} onClick={() => onRestore(r, 'new')}>After</Btn>
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager paged={paged} label="versions" />
        </>
      )}
    </Panel>
  )
}
