/**
 * DashboardBuilder — personal, composable dashboard (route /dashboard-builder).
 *
 * Users compose their own dashboard from WIDGET_CATALOG: add / remove /
 * reorder / resize widgets, save multiple named layouts, pick a default.
 * Admins can publish a layout to everyone via the "shared" flag.
 *
 * View mode: the active layout renders as a responsive CSS grid (4 columns
 * on desktop, reflowing to 2 / 1 on smaller screens) with live data and a
 * 120s auto-refresh. Edit mode: catalog drawer, per-widget controls (remove,
 * arrows, width 1-4, S/M/L presets) with HTML5 drag-to-reorder as an
 * enhancement — the buttons remain the accessible fallback.
 *
 * Persistence: org-scoped app_settings key `dashboard_layouts`
 * (lib/dashboardBuilder.js), per-user filtered client-side.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  LayoutDashboard, Plus, Pencil, Check, X, Trash2, Save, Copy,
  ChevronLeft, ChevronRight, GripVertical, Star, Globe, RefreshCw,
  AlertTriangle, ChevronDown, Eye,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import WidgetRenderer, { createWidgetDataLoader } from '../components/dashboard/WidgetRenderer'
import {
  WIDGET_CATALOG, WIDGET_BY_ID, WIDGET_CATEGORIES, SIZE_PRESETS,
  MIN_W, MAX_W, DEFAULT_LAYOUT, MAX_LAYOUTS,
  addWidget, removeWidget, moveWidget, resizeWidget, validateLayout,
  makeLayout, visibleLayouts, pickInitialLayout,
} from '../lib/dashboardBuilder'
import {
  listDashboards, saveDashboard, deleteDashboard,
  setDefaultDashboard, shareDashboard,
} from '../lib/api/savedViews'

const REFRESH_MS = 120_000

// Literal class strings so Tailwind JIT generates them (dynamic template
// strings would be purged). 4-col grid on lg+, 2-col on md, 1-col on mobile.
const SPAN_CLASS = {
  1: 'md:col-span-1 lg:col-span-1',
  2: 'md:col-span-2 lg:col-span-2',
  3: 'md:col-span-2 lg:col-span-3',
  4: 'md:col-span-2 lg:col-span-4',
}
const HEIGHT_CLASS = {
  sm: 'min-h-[150px]',
  md: 'min-h-[280px]',
  lg: 'min-h-[380px]',
}

const EMPTY_SLICE = { rows: [], error: null, loaded: false }

/* ── Small controls ─────────────────────────────────────────────────────── */
function IconBtn({ title, onClick, disabled, children, danger = false }) {
  return (
    <button
      type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        danger
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hairline,rgba(148,163,184,0.15))]'
      }`}
    >
      {children}
    </button>
  )
}

function SizeBtn({ active, onClick, children, title }) {
  return (
    <button
      type="button" title={title} onClick={onClick}
      className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
        active
          ? 'bg-green-600 text-white'
          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hairline,rgba(148,163,184,0.15))]'
      }`}
    >
      {children}
    </button>
  )
}

/* ── Name modal (new / rename / save-as) ────────────────────────────────── */
function NameModal({ title, initial, onSubmit, onClose }) {
  const [value, setValue] = useState(initial || '')
  const trimmed = value.trim()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="card w-full max-w-sm !p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
        <form onSubmit={e => { e.preventDefault(); if (trimmed) onSubmit(trimmed) }}>
          <input
            autoFocus value={value} onChange={e => setValue(e.target.value)}
            maxLength={80} placeholder="Layout name"
            className="w-full px-3 py-2 rounded-lg text-sm bg-transparent text-[var(--text-primary)] outline-none focus:border-green-600"
            style={{ border: '1px solid var(--hairline, rgba(148,163,184,0.25))' }}
          />
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={onClose} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
            <button type="submit" disabled={!trimmed}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── Widget catalog drawer ──────────────────────────────────────────────── */
function CatalogDrawer({ open, onAdd, onClose, placedIds }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.35)' }} />
      <aside
        className="absolute right-0 top-0 bottom-0 w-full max-w-sm overflow-y-auto p-5 space-y-5"
        style={{ background: 'var(--panel, #ffffff)', borderLeft: '1px solid var(--hairline, rgba(148,163,184,0.2))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">Widget Catalog</h2>
          <IconBtn title="Close catalog" onClick={onClose}><X size={15} /></IconBtn>
        </div>
        {WIDGET_CATEGORIES.map(cat => (
          <section key={cat}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">{cat}</h3>
            <div className="space-y-2">
              {WIDGET_CATALOG.filter(w => w.category === cat).map(w => {
                const count = placedIds.filter(id => id === w.id).length
                return (
                  <div key={w.id} className="flex items-start gap-3 rounded-xl p-3"
                    style={{ border: '1px solid var(--hairline, rgba(148,163,184,0.18))' }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[var(--text-primary)]">
                        {w.label}
                        {count > 0 && <span className="ml-2 text-[10px] text-[var(--text-muted)]">×{count} placed</span>}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">{w.description}</p>
                    </div>
                    <button
                      type="button" onClick={() => onAdd(w.id)}
                      className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-green-600 hover:bg-green-500 text-white transition-colors"
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </aside>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
export default function DashboardBuilder() {
  const { profile } = useAuth()
  const { activeCurrency } = useSettings()
  const userId = profile?.id || null
  const isAdmin = profile?.role === 'Admin'

  const [layouts, setLayouts]     = useState([])
  const [draft, setDraft]         = useState(null)   // working copy of the active layout
  const [dirty, setDirty]         = useState(false)
  const [editMode, setEditMode]   = useState(false)
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving]       = useState(false)
  const [notice, setNotice]       = useState(null)   // { text, type: 'ok'|'err' }
  const [slices, setSlices]       = useState({})     // widgetId → { rows, error, loaded }
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [modal, setModal]         = useState(null)   // { mode: 'new'|'rename'|'saveAs' }
  const dragIndexRef = useRef(null)
  const loadingDataRef = useRef(false)

  const visible = useMemo(() => visibleLayouts(layouts, userId), [layouts, userId])
  const canSaveInPlace = draft && draft.id !== DEFAULT_LAYOUT.id &&
    (isAdmin || draft.created_by === userId)
  const canDelete = canSaveInPlace && visible.some(l => l.id === draft?.id)

  const flash = useCallback((text, type = 'ok') => {
    setNotice({ text, type })
    setTimeout(() => setNotice(null), 3500)
  }, [])

  /* ── Load saved layouts ─────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true); setLoadError(null)
      try {
        const rows = await listDashboards()
        if (!alive) return
        setLayouts(rows)
        const initial = pickInitialLayout(rows, userId) || DEFAULT_LAYOUT
        setDraft(validateLayout(initial))
        setDirty(false)
      } catch (e) {
        if (!alive) return
        setLoadError(e.message || 'Could not load dashboard layouts.')
        setDraft(validateLayout(DEFAULT_LAYOUT))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [userId])

  /* ── Widget data (per-widget isolation, deduped by source) ──────────── */
  const widgetIds = useMemo(
    () => [...new Set((draft?.widgets || []).map(w => w.widgetId))],
    [draft?.widgets],
  )

  const loadData = useCallback(async (ids) => {
    if (!ids.length || loadingDataRef.current) return
    loadingDataRef.current = true
    const loader = createWidgetDataLoader()
    await Promise.allSettled(ids.map(async id => {
      try {
        const rows = await loader(id)
        setSlices(prev => ({ ...prev, [id]: { rows, error: null, loaded: true } }))
      } catch (e) {
        setSlices(prev => ({
          ...prev,
          [id]: { ...(prev[id] || EMPTY_SLICE), error: e?.message || 'Query failed', loaded: true },
        }))
      }
    }))
    loadingDataRef.current = false
  }, [])

  // Fetch data for widgets that don't have a slice yet (add-widget case).
  useEffect(() => {
    const missing = widgetIds.filter(id => !slices[id])
    if (missing.length) loadData(missing)
  }, [widgetIds, slices, loadData])

  // 120s auto-refresh in view mode.
  useEffect(() => {
    if (editMode) return undefined
    const id = setInterval(() => loadData(widgetIds), REFRESH_MS)
    return () => clearInterval(id)
  }, [editMode, widgetIds, loadData])

  /* ── Draft mutations ─────────────────────────────────────────────────── */
  const mutate = fn => setDraft(prev => {
    const next = fn(prev)
    if (next !== prev) setDirty(true)
    return next
  })

  const handleAdd     = id => { mutate(l => addWidget(l, id)); flash(`Added "${WIDGET_BY_ID[id]?.label}"`) }
  const handleRemove  = i  => mutate(l => removeWidget(l, i))
  const handleMove    = (i, delta) => mutate(l => moveWidget(l, i, i + delta))
  const handleWidth   = (i, w) => mutate(l => resizeWidget(l, i, { w }))
  const handlePreset  = (i, key) => mutate(l => resizeWidget(l, i, SIZE_PRESETS[key]))

  /* ── Persistence actions ─────────────────────────────────────────────── */
  /**
   * Run a per-record persistence action against savedViews (which prefers the
   * V102 user_dashboards table and falls back to app_settings). `action`
   * receives the current layouts list and returns the next list to store
   * locally; the network write is performed inside it.
   */
  async function persist(action, okMsg) {
    setSaving(true)
    try {
      const next = await action(layouts)
      if (next) setLayouts(next)
      flash(okMsg)
      return next
    } catch (e) {
      flash(e.message || 'Save failed.', 'err')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (!draft || !canSaveInPlace) return
    const record = { ...draft, updated_at: new Date().toISOString(), created_by: draft.created_by ?? userId }
    const saved = await persist(async list => {
      await saveDashboard(record, list)
      const exists = list.some(l => l.id === record.id)
      return exists ? list.map(l => (l.id === record.id ? record : l)) : [...list, record]
    }, 'Layout saved.')
    if (saved) setDirty(false)
  }

  async function handleSaveAs(name) {
    setModal(null)
    if (layouts.length >= MAX_LAYOUTS) { flash(`Layout limit reached (${MAX_LAYOUTS}).`, 'err'); return }
    const created = makeLayout({ name, widgets: draft?.widgets || [], createdBy: userId })
    const saved = await persist(async list => {
      await saveDashboard(created, list)
      return [...list, created]
    }, `Saved as "${created.name}".`)
    if (saved) { setDraft(created); setDirty(false) }
  }

  async function handleNewLayout(name) {
    setModal(null)
    if (layouts.length >= MAX_LAYOUTS) { flash(`Layout limit reached (${MAX_LAYOUTS}).`, 'err'); return }
    const created = makeLayout({ name, widgets: DEFAULT_LAYOUT.widgets, createdBy: userId })
    const saved = await persist(async list => {
      await saveDashboard(created, list)
      return [...list, created]
    }, `Created "${created.name}".`)
    if (saved) { setDraft(created); setDirty(false); setEditMode(true) }
  }

  async function handleRename(name) {
    setModal(null)
    if (!draft || !canSaveInPlace) return
    const renamed = { ...draft, name, updated_at: new Date().toISOString() }
    const saved = await persist(async list => {
      await saveDashboard(renamed, list)
      return list.map(l => (l.id === draft.id ? renamed : l))
    }, 'Layout renamed.')
    if (saved) setDraft(renamed)
  }

  async function handleDelete() {
    if (!draft || !canDelete) return
    if (!window.confirm(`Delete layout "${draft.name}"? This cannot be undone.`)) return
    const saved = await persist(async list => {
      await deleteDashboard(draft.id, list)
      return list.filter(l => l.id !== draft.id)
    }, 'Layout deleted.')
    if (saved) {
      const next = pickInitialLayout(saved, userId) || DEFAULT_LAYOUT
      setDraft(validateLayout(next)); setDirty(false); setEditMode(false)
    }
  }

  async function handleSetDefault() {
    if (!draft || draft.id === DEFAULT_LAYOUT.id) return
    const saved = await persist(
      list => setDefaultDashboard(draft.id, list, userId),
      'Default layout set.',
    )
    if (saved) setDraft(prev => ({ ...prev, is_default: true }))
  }

  async function handleToggleShared() {
    if (!draft || !isAdmin || draft.id === DEFAULT_LAYOUT.id) return
    const willShare = !draft.shared
    const toggled = { ...draft, shared: willShare, updated_at: new Date().toISOString() }
    const saved = await persist(
      list => shareDashboard(draft.id, willShare, list),
      willShare ? 'Layout published to everyone.' : 'Layout is now private.',
    )
    if (saved) setDraft(toggled)
  }

  function handleSwitch(layout) {
    if (dirty && !window.confirm('Discard unsaved changes to the current layout?')) return
    setDraft(validateLayout(layout))
    setDirty(false)
    setSwitcherOpen(false)
  }

  /* ── Drag-to-reorder (enhancement; arrows remain the a11y fallback) ──── */
  const onDragStart = i => e => {
    dragIndexRef.current = i
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', String(i)) } catch { /* IE quirk */ }
  }
  const onDragOver = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  const onDrop = i => e => {
    e.preventDefault()
    const from = dragIndexRef.current
    dragIndexRef.current = null
    if (from != null && from !== i) mutate(l => moveWidget(l, from, i))
  }

  /* ── States ───────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="space-y-4 animate-in">
        <div className="h-12 rounded-xl animate-pulse" style={{ background: 'var(--hairline, rgba(148,163,184,0.14))' }} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-40 rounded-2xl animate-pulse" style={{ background: 'var(--hairline, rgba(148,163,184,0.12))' }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-in">
      {/* ── Toast ── */}
      {notice && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg"
          style={{
            background: notice.type === 'ok' ? 'rgba(22,163,74,0.15)' : 'rgba(239,68,68,0.15)',
            border: `1px solid ${notice.type === 'ok' ? 'rgba(22,163,74,0.4)' : 'rgba(239,68,68,0.4)'}`,
            color: notice.type === 'ok' ? '#16a34a' : '#ef4444',
            backdropFilter: 'blur(8px)',
          }}>
          {notice.type === 'ok' ? <Check size={14} /> : <AlertTriangle size={14} />}
          <span className="max-w-xs">{notice.text}</span>
        </div>
      )}

      {/* ── Header / toolbar ── */}
      <div className="card !p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5 min-w-0 mr-auto">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.25)' }}>
            <LayoutDashboard size={16} className="text-green-500" />
          </div>
          <div className="min-w-0">
            {/* Layout switcher */}
            <div className="relative">
              <button
                type="button" onClick={() => setSwitcherOpen(o => !o)}
                className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)] hover:opacity-80 transition-opacity"
              >
                <span className="truncate max-w-[220px]">{draft?.name || 'Dashboard'}</span>
                {draft?.is_default && <Star size={12} className="text-amber-500 fill-amber-500 flex-shrink-0" />}
                {draft?.shared && <Globe size={12} className="text-sky-500 flex-shrink-0" />}
                <ChevronDown size={14} className="text-[var(--text-muted)] flex-shrink-0" />
              </button>
              {switcherOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setSwitcherOpen(false)} />
                  <div className="absolute left-0 top-full mt-2 z-40 w-64 card !p-2 max-h-80 overflow-y-auto shadow-xl">
                    {[DEFAULT_LAYOUT, ...visible].map(l => (
                      <button
                        key={l.id} type="button" onClick={() => handleSwitch(l)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition-colors ${
                          l.id === draft?.id
                            ? 'bg-green-600/10 text-green-600 font-semibold'
                            : 'text-[var(--text-primary)] hover:bg-[var(--hairline,rgba(148,163,184,0.12))]'
                        }`}
                      >
                        <span className="truncate flex-1">{l.name}</span>
                        {l.is_default && <Star size={11} className="text-amber-500 fill-amber-500" />}
                        {l.shared && <Globe size={11} className="text-sky-500" />}
                        {l.id === DEFAULT_LAYOUT.id && <span className="text-[10px] text-[var(--text-muted)]">starter</span>}
                      </button>
                    ))}
                    <div className="my-1" style={{ borderTop: '1px solid var(--hairline, rgba(148,163,184,0.15))' }} />
                    <button
                      type="button" onClick={() => { setSwitcherOpen(false); setModal({ mode: 'new' }) }}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 text-green-600 hover:bg-green-600/10 font-semibold transition-colors"
                    >
                      <Plus size={12} /> New layout
                    </button>
                  </div>
                </>
              )}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {draft?.widgets.length || 0} widgets
              {dirty && <span className="ml-2 font-semibold text-amber-500">· Unsaved changes</span>}
              {loadError && <span className="ml-2 text-red-500">· {loadError}</span>}
            </p>
          </div>
        </div>

        {/* Toolbar actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {!editMode ? (
            <>
              <button type="button" onClick={() => loadData(widgetIds)}
                className="btn-secondary text-xs gap-1.5 py-1.5 px-3" title="Refresh data now">
                <RefreshCw size={12} /> Refresh
              </button>
              <button type="button" onClick={() => setEditMode(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 text-white transition-colors">
                <Pencil size={12} /> Edit layout
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setDrawerOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 text-white transition-colors">
                <Plus size={12} /> Add widget
              </button>
              <button type="button" onClick={handleSave} disabled={!canSaveInPlace || !dirty || saving}
                className="btn-secondary text-xs gap-1.5 py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                title={canSaveInPlace ? 'Save changes' : 'Use "Save as new", you don\'t own this layout'}>
                <Save size={12} /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setModal({ mode: 'saveAs' })} disabled={saving}
                className="btn-secondary text-xs gap-1.5 py-1.5 px-3 disabled:opacity-40">
                <Copy size={12} /> Save as new
              </button>
              <button type="button" onClick={() => setModal({ mode: 'rename' })} disabled={!canSaveInPlace || saving}
                className="btn-secondary text-xs gap-1.5 py-1.5 px-3 disabled:opacity-40">
                <Pencil size={12} /> Rename
              </button>
              <button type="button" onClick={handleSetDefault}
                disabled={saving || !draft || draft.id === DEFAULT_LAYOUT.id || draft.is_default}
                className="btn-secondary text-xs gap-1.5 py-1.5 px-3 disabled:opacity-40" title="Open this layout by default">
                <Star size={12} /> Set default
              </button>
              {isAdmin && draft?.id !== DEFAULT_LAYOUT.id && (
                <button type="button" onClick={handleToggleShared} disabled={saving}
                  className="btn-secondary text-xs gap-1.5 py-1.5 px-3 disabled:opacity-40"
                  title={draft?.shared ? 'Make this layout private' : 'Publish this layout to everyone'}>
                  <Globe size={12} /> {draft?.shared ? 'Unshare' : 'Share'}
                </button>
              )}
              <button type="button" onClick={handleDelete} disabled={!canDelete || saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ border: '1px solid rgba(239,68,68,0.3)' }}>
                <Trash2 size={12} /> Delete
              </button>
              <button type="button" onClick={() => setEditMode(false)}
                className="btn-secondary text-xs gap-1.5 py-1.5 px-3" title="Back to view mode">
                <Eye size={12} /> Done
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Empty layout state ── */}
      {draft && draft.widgets.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-16 gap-3 text-center">
          <LayoutDashboard size={40} className="text-[var(--text-muted)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">This layout is empty</p>
          <p className="text-xs text-[var(--text-muted)] max-w-sm">
            Add widgets from the catalog to build your dashboard: KPIs, gauges, charts and lists, all live from your fleet data.
          </p>
          <button type="button"
            onClick={() => { setEditMode(true); setDrawerOpen(true) }}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 text-white transition-colors">
            <Plus size={13} /> Open widget catalog
          </button>
        </div>
      )}

      {/* ── Widget grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {(draft?.widgets || []).map((pw, i) => {
          const def = WIDGET_BY_ID[pw.widgetId]
          const n = draft.widgets.length
          return (
            <div
              key={`${pw.widgetId}-${i}`}
              className={`relative ${SPAN_CLASS[pw.w] || SPAN_CLASS[1]} ${HEIGHT_CLASS[pw.h] || HEIGHT_CLASS.md} ${
                editMode ? 'rounded-2xl outline-dashed outline-1 outline-offset-2 outline-[var(--text-dim,#64748b)]' : ''
              }`}
              draggable={editMode}
              onDragStart={editMode ? onDragStart(i) : undefined}
              onDragOver={editMode ? onDragOver : undefined}
              onDrop={editMode ? onDrop(i) : undefined}
            >
              {/* Edit controls overlay */}
              {editMode && (
                <div className="absolute -top-2.5 left-2 right-2 z-10 flex items-center justify-between gap-1 px-2 py-1 rounded-lg shadow-md"
                  style={{ background: 'var(--panel, #ffffff)', border: '1px solid var(--hairline, rgba(148,163,184,0.25))' }}>
                  <span className="flex items-center gap-1 min-w-0 cursor-grab active:cursor-grabbing" title="Drag to reorder">
                    <GripVertical size={12} className="text-[var(--text-muted)] flex-shrink-0" />
                    <span className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{def?.label}</span>
                  </span>
                  <span className="flex items-center gap-0.5 flex-shrink-0">
                    <IconBtn title="Move earlier" onClick={() => handleMove(i, -1)} disabled={i === 0}>
                      <ChevronLeft size={12} />
                    </IconBtn>
                    <IconBtn title="Move later" onClick={() => handleMove(i, 1)} disabled={i === n - 1}>
                      <ChevronRight size={12} />
                    </IconBtn>
                    <span className="mx-0.5 h-3 w-px" style={{ background: 'var(--hairline, rgba(148,163,184,0.3))' }} />
                    {Array.from({ length: MAX_W - MIN_W + 1 }, (_, k) => MIN_W + k).map(w => (
                      <SizeBtn key={w} title={`${w} column${w > 1 ? 's' : ''} wide`} active={pw.w === w}
                        onClick={() => handleWidth(i, w)}>{w}</SizeBtn>
                    ))}
                    <span className="mx-0.5 h-3 w-px" style={{ background: 'var(--hairline, rgba(148,163,184,0.3))' }} />
                    {Object.keys(SIZE_PRESETS).map(k => (
                      <SizeBtn key={k} title={`${k} preset`} onClick={() => handlePreset(i, k)}
                        active={pw.w === SIZE_PRESETS[k].w && pw.h === SIZE_PRESETS[k].h}>{k}</SizeBtn>
                    ))}
                    <span className="mx-0.5 h-3 w-px" style={{ background: 'var(--hairline, rgba(148,163,184,0.3))' }} />
                    <IconBtn title="Remove widget" danger onClick={() => handleRemove(i)}>
                      <X size={12} />
                    </IconBtn>
                  </span>
                </div>
              )}
              <div className={`h-full ${editMode ? 'pt-3 pointer-events-none select-none' : ''}`}>
                <WidgetRenderer
                  widgetId={pw.widgetId}
                  slice={slices[pw.widgetId] || EMPTY_SLICE}
                  currency={activeCurrency}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Catalog drawer ── */}
      <CatalogDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onAdd={handleAdd}
        placedIds={(draft?.widgets || []).map(w => w.widgetId)}
      />

      {/* ── Name modals ── */}
      {modal?.mode === 'new' && (
        <NameModal title="New layout" initial="" onSubmit={handleNewLayout} onClose={() => setModal(null)} />
      )}
      {modal?.mode === 'saveAs' && (
        <NameModal title="Save as new layout" initial={`${draft?.name || 'Dashboard'} (copy)`}
          onSubmit={handleSaveAs} onClose={() => setModal(null)} />
      )}
      {modal?.mode === 'rename' && (
        <NameModal title="Rename layout" initial={draft?.name || ''} onSubmit={handleRename} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
