import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ListTree, Save, RotateCcw, ArrowUp, ArrowDown, Eye, EyeOff,
  FolderInput, Pencil, CheckCircle, AlertCircle, Menu,
} from 'lucide-react'
import { NAV_CATALOG } from '../../components/Layout'
import {
  buildNavEditorModel, editorModelToLayout, applyNavLayout,
} from '../../lib/navLayout'
import { getNavLayout, saveNavLayout } from '../../lib/api/navLayout'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { toUserMessage } from '../../lib/safeError'

/**
 * Navigation Customizer (super-admin, console). Reorder nav groups, reorder items
 * within a group, move an item to another group, rename a group, and hide
 * groups/items. Persisted org-wide to system_config.nav_layout and applied to the
 * main-app sidebar by Layout.jsx via applyNavLayout.
 *
 * HIDING IS COSMETIC menu tidiness — a hidden item is still route-reachable and
 * still governed by RBAC/flags; this screen never changes access, only the menu.
 */
export default function ConsoleNavigation() {
  const { logAction } = useConsoleAuth()
  const [model, setModel] = useState(null)      // editor tree [{key,label,defaultLabel,hidden,items:[{key,label,hidden}]}]
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [renaming, setRenaming] = useState(null) // group key being renamed

  const load = useCallback(async () => {
    setLoading(true); setError(''); setSaved(false)
    try {
      const layout = await getNavLayout({ force: true })
      setModel(buildNavEditorModel(NAV_CATALOG, layout))
      setDirty(false)
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
  }

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const layout = editorModelToLayout(model)
      await saveNavLayout(layout)
      try { await logAction('update_config', null, 'nav_layout', { groups: layout.groups.length, items: layout.items.length }) } catch { /* non-fatal */ }
      setSaved(true); setDirty(false)
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
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

  const iconBtn = 'w-7 h-7 flex items-center justify-center rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed'

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><ListTree size={20} className="text-orange-400" /> Navigation Customizer</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Reorder the main-app sidebar, move items between groups, rename groups, and hide clutter. Applies org-wide.
            Hiding is menu tidiness only — a hidden item is still reachable and access is still governed by roles and permissions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleReset} disabled={saving || loading}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 inline-flex items-center gap-1.5 disabled:opacity-50">
            <RotateCcw size={13} /> Reset to defaults
          </button>
          <button onClick={handleSave} disabled={saving || loading || !dirty}
            className="text-sm px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
            <Save size={14} /> {saving ? 'Saving...' : 'Save layout'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/40 text-red-300 text-sm px-4 py-2 inline-flex items-center gap-2"><AlertCircle size={15} /> {error}</div>}
      {saved && <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 text-emerald-300 text-sm px-4 py-2 inline-flex items-center gap-2"><CheckCircle size={15} /> Navigation saved. The sidebar uses it now; other users pick it up on their next load.</div>}

      {loading ? (
        <div className="text-slate-400 text-sm py-16 text-center">Loading navigation...</div>
      ) : !model || model.length === 0 ? (
        <div className="text-slate-400 text-sm py-16 text-center">No navigation groups found.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          {/* Editor */}
          <div className="lg:col-span-2 space-y-3">
            {model.map((g, gIdx) => (
              <div key={g.key} className={`rounded-xl border ${g.hidden ? 'border-slate-800 bg-slate-900/40 opacity-70' : 'border-slate-700 bg-slate-800/40'}`}>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/60">
                  <Menu size={14} className="text-slate-500 flex-shrink-0" />
                  {renaming === g.key ? (
                    <input
                      autoFocus
                      defaultValue={g.label}
                      onBlur={(e) => { renameGroup(gIdx, e.target.value); setRenaming(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { renameGroup(gIdx, e.target.value); setRenaming(null) } if (e.key === 'Escape') setRenaming(null) }}
                      className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:border-orange-500 focus:outline-none"
                    />
                  ) : (
                    <button onClick={() => setRenaming(g.key)} className="flex-1 min-w-0 text-left inline-flex items-center gap-1.5 group">
                      <span className="text-sm font-semibold text-white truncate">{g.label}</span>
                      {g.label !== g.defaultLabel && <span className="text-[10px] text-orange-400/80 flex-shrink-0">(was {g.defaultLabel})</span>}
                      <Pencil size={11} className="text-slate-500 group-hover:text-slate-300 flex-shrink-0" />
                    </button>
                  )}
                  <span className="text-[11px] text-slate-500 flex-shrink-0">{g.items.filter((i) => !i.hidden).length}/{g.items.length}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button className={iconBtn} title="Move group up" disabled={gIdx === 0} onClick={() => moveGroup(gIdx, -1)}><ArrowUp size={13} /></button>
                    <button className={iconBtn} title="Move group down" disabled={gIdx === model.length - 1} onClick={() => moveGroup(gIdx, 1)}><ArrowDown size={13} /></button>
                    <button className={iconBtn} title={g.hidden ? 'Show group' : 'Hide group'} onClick={() => toggleGroupHidden(gIdx)}>
                      {g.hidden ? <EyeOff size={13} className="text-slate-500" /> : <Eye size={13} className="text-emerald-400" />}
                    </button>
                  </div>
                </div>

                <div className="p-2 space-y-1">
                  {g.items.length === 0 && <p className="text-[11px] text-slate-600 px-2 py-1">No items.</p>}
                  {g.items.map((it, iIdx) => (
                    <div key={it.key} className={`flex items-center gap-2 px-2 py-1 rounded-lg ${it.hidden ? 'opacity-45' : 'hover:bg-slate-800/60'}`}>
                      <span className="text-[13px] text-slate-200 truncate flex-1 min-w-0">{it.label}</span>
                      <span className="text-[10px] text-slate-600 font-mono truncate max-w-[120px] hidden sm:inline">{it.key}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button className={iconBtn} title="Move up" disabled={iIdx === 0} onClick={() => moveItem(gIdx, iIdx, -1)}><ArrowUp size={12} /></button>
                        <button className={iconBtn} title="Move down" disabled={iIdx === g.items.length - 1} onClick={() => moveItem(gIdx, iIdx, 1)}><ArrowDown size={12} /></button>
                        <div className="relative inline-flex items-center">
                          <FolderInput size={12} className="absolute left-1.5 text-slate-500 pointer-events-none" />
                          <select
                            value={g.key}
                            onChange={(e) => moveItemToGroup(gIdx, iIdx, e.target.value)}
                            title="Move to group"
                            className="appearance-none h-7 pl-6 pr-2 rounded-md border border-slate-700 bg-slate-900 text-[11px] text-slate-300 hover:text-white focus:border-orange-500 focus:outline-none max-w-[130px]"
                          >
                            {groupOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </select>
                        </div>
                        <button className={iconBtn} title={it.hidden ? 'Show item' : 'Hide item'} onClick={() => toggleItemHidden(gIdx, iIdx)}>
                          {it.hidden ? <EyeOff size={12} className="text-slate-500" /> : <Eye size={12} className="text-emerald-400" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Live preview */}
          <div className="space-y-2 lg:sticky lg:top-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live preview</p>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 max-h-[70vh] overflow-y-auto">
              {preview.length === 0 ? (
                <p className="text-slate-500 text-xs">Everything hidden.</p>
              ) : preview.map((g) => (
                <div key={g.key} className="mb-3">
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-slate-500 mb-1">{g.label}</p>
                  <div className="space-y-0.5">
                    {g.items.map((it) => (
                      <div key={it.to} className="text-[12px] text-slate-300 px-2 py-1 rounded-md bg-slate-800/40 truncate">{it.label}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">Preview shows menu structure only. Each user still sees only the items their role and permissions allow.</p>
          </div>
        </div>
      )}
    </div>
  )
}
