/**
 * DashboardBuilder (route /dashboard-builder): personal, composable dashboards,
 * rebuilt on the Command Center kit to the owner's three-panel mockup:
 *   Widget Library (left)  |  Canvas (centre)  |  Dashboard Settings (right).
 *
 * Users compose a dashboard from WIDGET_CATALOG: add (click or drag from the
 * library), remove, reorder (drag or arrows), resize (width 1-4, S/M/L), save
 * multiple named layouts, pick a default. Admins publish a layout to everyone
 * via the shared flag. Global filters (date range, site, country) drive every
 * widget and are saved as the layout default in edit mode. Live data with a
 * 120 s auto-refresh in view mode; a device toggle previews the grid at
 * tablet and phone widths.
 *
 * Persistence: savedViews (user_dashboards, falling back to app_settings).
 * The layout model stores name, widgets, filters, owner and the shared flag
 * only: description, tags, category, role audiences, theme and refresh
 * interval are not stored, so the settings panel does not offer them.
 * Pure shaping: src/lib/dashboardBuilderView.js.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  LayoutDashboard, Plus, Pencil, Check, X, Trash2, Save, Copy,
  ChevronLeft, ChevronRight, GripVertical, Star, Globe, RefreshCw,
  AlertTriangle, ChevronDown, Eye, Calendar, MapPin, RotateCcw, Search,
  Monitor, Tablet, Smartphone, Eraser, Settings2, ShieldCheck, Send,
  Gauge, BarChart3, List, Info, LayoutGrid, PieChart, LineChart, Hash, Sun, Moon, Users, Tag,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { useTheme } from '../contexts/ThemeContext'
import { useSites } from '../hooks/useSites'
import WidgetRenderer, { createWidgetDataLoader } from '../components/dashboard/WidgetRenderer'
import {
  WIDGET_CATALOG, WIDGET_BY_ID, SIZE_PRESETS,
  MIN_W, MAX_W, DEFAULT_LAYOUT, MAX_LAYOUTS,
  addWidget, removeWidget, moveWidget, resizeWidget, validateLayout,
  makeLayout, visibleLayouts, pickInitialLayout,
  DASHBOARD_RANGE_PRESETS, DEFAULT_DASHBOARD_FILTERS,
  normalizeFilters, resolveDashboardFilters,
} from '../lib/dashboardBuilder'
import {
  LIBRARY_TABS, librarySections, canvasSummary, saveStatus, DEVICES, gridColumns, spanFor,
  filterSummary, accessSummary,
} from '../lib/dashboardBuilderView'
import {
  listDashboards, saveDashboard, deleteDashboard,
  setDefaultDashboard, shareDashboard,
} from '../lib/api/savedViews'
import { toUserMessage } from '../lib/safeError'
import Modal from '../components/ui/Modal'
import { Tabs } from '../components/commandCenter/kit'
import './DashboardBuilder.css'

const REFRESH_MS = 120_000
const EMPTY_SLICE = { rows: [], error: null, loaded: false }
const WIDGET_MIME = 'application/x-tp-widget'
const KIND_ICON = { stat: Hash, gauge: Gauge, line: LineChart, bar: BarChart3, donut: PieChart, list: List }
const DEVICE_ICON = { desktop: Monitor, tablet: Tablet, mobile: Smartphone }

/* ── Small controls ─────────────────────────────────────────────────────── */
function IconBtn({ title, onClick, disabled, children, danger = false }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={`db-mini ${danger ? 'is-danger' : ''}`}>
      {children}
    </button>
  )
}

function SizeBtn({ active, onClick, children, title }) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={active} onClick={onClick}
      className={`db-size ${active ? 'is-on' : ''}`}>
      {children}
    </button>
  )
}

/* ── Name modal (new / rename / save-as) ────────────────────────────────── */
function NameModal({ title, initial, onSubmit, onClose }) {
  const [value, setValue] = useState(initial || '')
  const trimmed = value.trim()
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={(
        <>
          <button type="button" onClick={onClose} className="cc-btn-ghost">Cancel</button>
          <button type="submit" form="dashboard-layout-name-form" disabled={!trimmed} className="cc-btn-primary">Confirm</button>
        </>
      )}
    >
      <form id="dashboard-layout-name-form" className="cc db-form" onSubmit={e => { e.preventDefault(); if (trimmed) onSubmit(trimmed) }}>
        <label htmlFor="dashboard-layout-name">Layout name</label>
        <input id="dashboard-layout-name" autoFocus value={value} onChange={e => setValue(e.target.value)}
          maxLength={80} placeholder="Layout name" className="db-input" />
      </form>
    </Modal>
  )
}

/* ── Widget library (left panel) ────────────────────────────────────────── */
function WidgetLibrary({ placedIds, onAdd, searchRef }) {
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const sections = useMemo(() => librarySections(WIDGET_CATALOG, { tab, search, placedIds }), [tab, search, placedIds])
  return (
    <aside className="cc-card db-lib" aria-label="Widget library">
      <div className="db-panel-head">
        <h2 className="cc-card-title">Widget Library</h2>
        <span className="db-muted">{WIDGET_CATALOG.length} widgets</span>
      </div>
      <label className="cc-search db-lib-search">
        <Search size={15} aria-hidden="true" />
        <input ref={searchRef} aria-label="Search widgets" placeholder="Search widgets..." value={search} onChange={e => setSearch(e.target.value)} />
      </label>
      <Tabs tabs={LIBRARY_TABS} value={tab} onChange={setTab} label="Widget types" />
      <div className="db-lib-scroll">
        {sections.length === 0 && <div className="cc-empty">No widgets match "{search}".</div>}
        {sections.map(sec => {
          const open = !collapsed[sec.key]
          return (
            <section key={sec.key} className="db-lib-sec">
              <button type="button" className="db-lib-sec-head" aria-expanded={open}
                onClick={() => setCollapsed(c => ({ ...c, [sec.key]: open }))}>
                <span>{sec.label}</span>
                <ChevronDown size={14} className={open ? 'is-open' : ''} aria-hidden="true" />
              </button>
              {open && (
                <div className="db-lib-grid">
                  {sec.items.map(w => (
                    <div key={w.id} className="db-lib-item" draggable
                      onDragStart={e => { try { e.dataTransfer.setData(WIDGET_MIME, w.id); e.dataTransfer.effectAllowed = 'copy' } catch { /* ignore */ } }}
                      title={`${w.description} Drag onto the canvas or press Add.`}>
                      {(() => { const Icon = KIND_ICON[w.kind] || List; return <span className={`db-lib-icon k-${sec.key}`}><Icon size={16} aria-hidden="true" /></span> })()}
                      <span className="db-lib-copy">
                        <b>{w.label}</b>
                        <small>{w.kindLabel}{w.placed > 0 ? `, ${w.placed} placed` : ''}</small>
                      </span>
                      <button type="button" className="db-lib-add" onClick={() => onAdd(w.id)} aria-label={`Add ${w.label}`} title={`Add ${w.label}`}>
                        <Plus size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
      <p className="db-hint"><Info size={12} aria-hidden="true" /> Drag a widget onto the canvas, or press + to add it at the end.</p>
    </aside>
  )
}

/* ── Dashboard settings (right panel) ───────────────────────────────────── */
function SettingsPanel({
  draft, isStarter, canEditName, onName, filters, siteOptions, sitesLoading, onFilter, onReset,
  editMode, access, layoutOptions, onSwitch, onSetDefault, onToggleShared, saving, summary,
  fixedGrid, onFixedGrid,
}) {
  const [tab, setTab] = useState('config')
  const { isDark, setMode } = useTheme()
  const siteChoices = filters.site !== 'All' && !siteOptions.includes(filters.site) ? [filters.site, ...siteOptions] : siteOptions
  const isDefaultFilters = filters.range === 'all' && filters.site === 'All' && filters.country === 'All'
  return (
    <aside className="cc-card db-set" aria-label="Dashboard settings">
      <div className="db-panel-head"><h2 className="cc-card-title">Dashboard Settings</h2></div>
      <div className="db-seg" role="tablist" aria-label="Settings sections">
        <button type="button" role="tab" aria-selected={tab === 'config'} onClick={() => setTab('config')}><Settings2 size={14} aria-hidden="true" /> Configuration</button>
        <button type="button" role="tab" aria-selected={tab === 'perm'} onClick={() => setTab('perm')}><ShieldCheck size={14} aria-hidden="true" /> Permissions</button>
      </div>

      {tab === 'config' && (
        <div className="db-set-body">
          <h3 className="db-h3">Dashboard Details</h3>
          <label className="db-lbl" htmlFor="db-name">Name</label>
          <input id="db-name" className="db-input" value={draft?.name || ''} maxLength={80}
            disabled={!canEditName} onChange={e => onName(e.target.value)}
            title={canEditName ? 'Rename this layout, then Save Draft' : 'You cannot rename this layout. Use Save as Template for your own copy.'} />
          <label className="db-lbl" htmlFor="db-template">Template</label>
          <select id="db-template" className="cc-select db-full" value={draft?.id || ''} onChange={e => onSwitch(e.target.value)}>
            {layoutOptions.map(l => <option key={l.id} value={l.id}>{l.name}{l.id === DEFAULT_LAYOUT.id ? ' (starter)' : ''}{l.is_default ? ' (default)' : ''}</option>)}
          </select>
          <span className="db-lbl">Description</span>
          <div className="db-desc">
            {summary.widgets} widgets reading {summary.sources} live data sources
            {summary.categories.length ? `: ${summary.categories.map(c => c.label.toLowerCase()).join(', ')}.` : '.'}
            <small>Built from the widgets on the canvas. Layouts do not store a written description.</small>
          </div>
          <span className="db-lbl"><Tag size={12} aria-hidden="true" /> Category and tags</span>
          {summary.categories.length > 0
            ? <div className="db-chips">{summary.categories.map(c => <span key={c.label} className="cc-pill info">{c.label} {c.count}</span>)}</div>
            : <p className="db-muted db-mb">No widgets on the canvas yet.</p>}

          <h3 className="db-h3">Audience &amp; Access</h3>
          {access && (
            <>
              <div className="db-readonly"><span><Users size={12} aria-hidden="true" /> Audience</span><b>{access.audience}</b></div>
              <div className="db-readonly"><span>Access level</span><b>{draft?.shared ? 'Published to everyone' : 'Private to owner'}</b></div>
            </>
          )}

          <h3 className="db-h3">Display &amp; Data</h3>
          <p className="db-muted db-mb">{editMode ? 'Changes here are saved as this layout default.' : 'Applied to every widget now. Edit the layout to save them as its default.'}</p>
          <label className="db-lbl" htmlFor="db-range"><Calendar size={12} aria-hidden="true" /> Time range</label>
          <select id="db-range" className="cc-select db-full" value={filters.range} onChange={e => onFilter({ range: e.target.value })}>
            {DASHBOARD_RANGE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {filters.range === 'custom' && (
            <div className="db-two">
              <input type="date" aria-label="From date" className="cc-select" value={filters.from || ''} max={filters.to || undefined} onChange={e => onFilter({ from: e.target.value || null })} />
              <input type="date" aria-label="To date" className="cc-select" value={filters.to || ''} min={filters.from || undefined} onChange={e => onFilter({ to: e.target.value || null })} />
            </div>
          )}
          <div className="db-two">
            <div>
              <label className="db-lbl" htmlFor="db-site"><MapPin size={12} aria-hidden="true" /> Default site</label>
              <select id="db-site" className="cc-select db-full" value={filters.site} onChange={e => onFilter({ site: e.target.value })}>
                <option value="All">{sitesLoading ? 'Loading sites...' : 'All sites'}</option>
                {siteChoices.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="db-lbl" htmlFor="db-country"><Globe size={12} aria-hidden="true" /> Country</label>
              <select id="db-country" className="cc-select db-full" value={filters.country} onChange={e => onFilter({ country: e.target.value })}>
                <option value="All">All countries</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="db-readonly">
            <span>Refresh interval</span><b>Every 120 seconds (fixed)</b>
          </div>
          {!isDefaultFilters && (
            <button type="button" className="cc-btn-ghost db-mt" onClick={onReset}><RotateCcw size={13} aria-hidden="true" /> Reset filters</button>
          )}

          <span className="db-lbl">Theme</span>
          <div className="db-choice" role="group" aria-label="Theme">
            <button type="button" aria-pressed={!isDark} onClick={() => setMode('light')}><Sun size={14} aria-hidden="true" /> Light</button>
            <button type="button" aria-pressed={isDark} onClick={() => setMode('dark')}><Moon size={14} aria-hidden="true" /> Dark</button>
          </div>
          <span className="db-lbl">Layout</span>
          <div className="db-choice" role="group" aria-label="Canvas layout">
            <button type="button" aria-pressed={!fixedGrid} onClick={() => onFixedGrid(false)}><Monitor size={14} aria-hidden="true" /> Auto (Responsive)</button>
            <button type="button" aria-pressed={fixedGrid} onClick={() => onFixedGrid(true)}><LayoutGrid size={14} aria-hidden="true" /> Fixed Grid</button>
          </div>
          <p className="db-muted db-mt">Theme applies to the whole app on this device. Layout changes this preview only and is not saved with the dashboard.</p>
        </div>
      )}

      {tab === 'perm' && access && (
        <div className="db-set-body">
          <h3 className="db-h3">Audience &amp; Access</h3>
          <div className="db-readonly"><span>Audience</span><b>{access.audience}</b></div>
          <div className="db-readonly"><span>Owner</span><b>{access.owner}</b></div>
          <div className="db-readonly"><span>You can edit</span><b>{access.canEdit ? 'Yes' : 'No'}</b></div>
          <p className="db-muted db-mb">{access.note}</p>
          {access.canShare && !isStarter && (
            <button type="button" className="cc-btn-ghost db-full-btn" onClick={onToggleShared} disabled={saving}>
              <Globe size={14} aria-hidden="true" /> {draft?.shared ? 'Make private' : 'Publish to everyone'}
            </button>
          )}
          <button type="button" className="cc-btn-ghost db-full-btn" onClick={onSetDefault}
            disabled={saving || isStarter || draft?.is_default}>
            <Star size={14} aria-hidden="true" /> {draft?.is_default ? 'This is your default layout' : 'Open this layout by default'}
          </button>
          <p className="db-muted db-mt">Role based audiences are not supported: a layout is either private to its owner or published to everyone in the organisation. Data inside each widget is still limited by the viewer's own country and site access.</p>
        </div>
      )}
    </aside>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
export default function DashboardBuilder() {
  const { profile } = useAuth()
  const { activeCurrency, activeCountry } = useSettings()
  const userId = profile?.id || null
  const isAdmin = profile?.role === 'Admin'

  const [layouts, setLayouts]     = useState([])
  const [draft, setDraft]         = useState(null)   // working copy of the active layout
  const [filters, setFilters]     = useState(DEFAULT_DASHBOARD_FILTERS) // active global filters
  const [dirty, setDirty]         = useState(false)
  const [editMode, setEditMode]   = useState(false)
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving]       = useState(false)
  const [notice, setNotice]       = useState(null)   // { text, type: 'ok'|'err' }
  const [slices, setSlices]       = useState({})     // widgetId → { rows, error, loaded }
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [modal, setModal]         = useState(null)   // { mode: 'new'|'rename'|'saveAs' }
  const [confirmState, setConfirmState] = useState(null) // { kind: 'delete'|'discard', layout? }
  const switcherRef = useRef(null)
  const dragIndexRef = useRef(null)
  const loadingDataRef = useRef(false)
  const paramsKeyRef = useRef(null)

  // The dashboard honours the global country switcher as its baseline; the
  // board's own Country filter narrows further. Site options follow the
  // effective country so the picker only lists relevant sites.
  const effectiveCountry = (filters.country && filters.country !== 'All')
    ? filters.country
    : activeCountry
  const { options: siteOptions, loading: sitesLoading } = useSites(effectiveCountry)

  // Pure filters -> query params. Stable identity unless a filter truly changes.
  const queryParams = useMemo(
    () => resolveDashboardFilters({ ...filters, country: effectiveCountry }),
    [filters, effectiveCountry],
  )

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
        setLoadError(toUserMessage(e, 'Could not load dashboard layouts.'))
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
    const loader = createWidgetDataLoader(queryParams)
    await Promise.allSettled(ids.map(async id => {
      try {
        const rows = await loader(id)
        setSlices(prev => ({ ...prev, [id]: { rows, error: null, loaded: true } }))
      } catch (e) {
        setSlices(prev => ({
          ...prev,
          [id]: { ...(prev[id] || EMPTY_SLICE), error: toUserMessage(e, 'Query failed'), loaded: true },
        }))
      }
    }))
    loadingDataRef.current = false
  }, [queryParams])

  // Adopt a layout's stored default filters when the active layout changes
  // (initial load / switch). Draft mutations keep the same id, so editing
  // widgets never resets the filter bar.
  useEffect(() => {
    setFilters(draft?.filters ? normalizeFilters(draft.filters) : DEFAULT_DASHBOARD_FILTERS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id])

  // In edit mode, filter changes become the layout's saved default (marks dirty).
  useEffect(() => {
    if (!editMode || !draft) return
    const same = JSON.stringify(normalizeFilters(draft.filters)) === JSON.stringify(filters)
    if (same) return
    mutate(l => (l ? { ...l, filters, updated_at: new Date().toISOString() } : l))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, editMode])

  // Refetch the whole board when the resolved query params actually change.
  useEffect(() => {
    const key = JSON.stringify(queryParams)
    if (paramsKeyRef.current === null) { paramsKeyRef.current = key; return }
    if (paramsKeyRef.current === key) return
    paramsKeyRef.current = key
    setSlices({})
  }, [queryParams])

  // Fetch data for widgets that don't have a slice yet (add-widget / refilter).
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

  /* ── Global filters ──────────────────────────────────────────────────── */
  const handleFilterChange = useCallback((patch) => {
    setFilters(prev => normalizeFilters({ ...prev, ...patch }))
  }, [])
  const handleFilterReset = useCallback(() => {
    setFilters(DEFAULT_DASHBOARD_FILTERS)
  }, [])

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
      flash(toUserMessage(e, 'Save failed.'), 'err')
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

  function handleDelete() {
    if (!draft || !canDelete) return
    setConfirmState({ kind: 'delete' })
  }

  async function confirmDeleteLayout() {
    if (!draft || !canDelete) { setConfirmState(null); return }
    const saved = await persist(async list => {
      await deleteDashboard(draft.id, list)
      return list.filter(l => l.id !== draft.id)
    }, 'Layout deleted.')
    if (saved) {
      const next = pickInitialLayout(saved, userId) || DEFAULT_LAYOUT
      setDraft(validateLayout(next)); setDirty(false); setEditMode(false)
    }
    setConfirmState(null)
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

  function applySwitch(layout) {
    setDraft(validateLayout(layout))
    setDirty(false)
    setSwitcherOpen(false)
  }

  function handleSwitch(layout) {
    if (dirty) {
      setSwitcherOpen(false)
      setConfirmState({ kind: 'discard', layout })
      return
    }
    applySwitch(layout)
  }

  // Close the layout switcher on an outside press or Escape. Replaces a
  // full-screen click catcher so the page has no hand-rolled overlay.
  useEffect(() => {
    if (!switcherOpen) return undefined
    function onDown(e) {
      if (switcherRef.current && !switcherRef.current.contains(e.target)) setSwitcherOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setSwitcherOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [switcherOpen])

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

    /* ── Builder-only state and actions ──────────────────────────────────── */
  const [device, setDevice] = useState('desktop')
  const [fixedGrid, setFixedGrid] = useState(false)
  const [canvasWidth, setCanvasWidth] = useState(1200)
  const [moreOpen, setMoreOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const canvasRef = useRef(null)
  const moreRef = useRef(null)
  const librarySearchRef = useRef(null)
  const isStarter = draft?.id === DEFAULT_LAYOUT.id
  const savedVersion = useMemo(
    () => (draft ? (layouts.find(l => l.id === draft.id) || (isStarter ? DEFAULT_LAYOUT : null)) : null),
    [layouts, draft, isStarter],
  )
  const layoutOptions = useMemo(() => {
    const list = [DEFAULT_LAYOUT, ...visible]
    if (draft && !list.some(l => l.id === draft.id)) list.push(draft)
    return list
  }, [visible, draft])
  const summary = useMemo(() => canvasSummary(draft, WIDGET_BY_ID), [draft])
  const access = useMemo(() => accessSummary(draft, { userId, isAdmin, isStarter }), [draft, userId, isAdmin, isStarter])
  const status = saveStatus({ dirty, layout: draft, isStarter, now })
  const cols = fixedGrid && device === 'desktop' ? 4 : gridColumns(device, canvasWidth)
  const deviceDef = DEVICES.find(d => d.key === device) || DEVICES[0]

  // Keep the "Saved N minutes ago" line current.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Measure the canvas so the grid reflows by its own width, not the window.
  useEffect(() => {
    const el = canvasRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width
      if (w) setCanvasWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  // Close the overflow menu on an outside press or Escape.
  useEffect(() => {
    if (!moreOpen) return undefined
    function onDown(e) { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [moreOpen])

  function addFromLibrary(id) {
    if (!editMode) setEditMode(true)
    handleAdd(id)
  }

  function handleNameChange(name) {
    if (!canSaveInPlace) return
    mutate(l => (l ? { ...l, name: name.slice(0, 80), updated_at: new Date().toISOString() } : l))
  }

  function handleSwitchById(id) {
    const l = layoutOptions.find(x => x.id === id)
    if (l && l.id !== draft?.id) handleSwitch(l)
  }

  function handleDiscard() {
    if (!savedVersion) return
    setDraft(validateLayout(savedVersion))
    setFilters(savedVersion.filters ? normalizeFilters(savedVersion.filters) : DEFAULT_DASHBOARD_FILTERS)
    setDirty(false)
    flash('Changes discarded.')
  }

  function confirmClearCanvas() {
    mutate(l => (l ? { ...l, widgets: [], updated_at: new Date().toISOString() } : l))
    setEditMode(true)
    setConfirmState(null)
  }

  function onCanvasDrop(e) {
    let id = ''
    try { id = e.dataTransfer.getData(WIDGET_MIME) } catch { /* ignore */ }
    if (id && WIDGET_BY_ID[id]) { e.preventDefault(); addFromLibrary(id) }
  }

  function onCellDrop(i) {
    const reorder = onDrop(i)
    return e => {
      let id = ''
      try { id = e.dataTransfer.getData(WIDGET_MIME) } catch { /* ignore */ }
      if (id && WIDGET_BY_ID[id]) {
        e.preventDefault(); e.stopPropagation()
        if (!editMode) setEditMode(true)
        mutate(l => {
          const added = addWidget(l, id)
          if (added === l) return l
          return moveWidget(added, added.widgets.length - 1, i)
        })
        flash(`Added "${WIDGET_BY_ID[id]?.label}"`)
        return
      }
      reorder(e)
    }
  }

  const canPublish = isAdmin && !isStarter
  const filterText = filterSummary(filters, DASHBOARD_RANGE_PRESETS)

  /* ── States ───────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="cc db-page">
        <div className="cc-skel" style={{ height: 72 }} />
        <div className="db-layout">
          <div className="cc-skel" style={{ height: 520 }} />
          <div className="cc-skel" style={{ height: 520 }} />
          <div className="cc-skel" style={{ height: 520 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="cc db-page">
      {notice && (
        <div className={`db-toast ${notice.type === 'ok' ? 'is-ok' : 'is-err'}`} role={notice.type === 'ok' ? 'status' : 'alert'}>
          {notice.type === 'ok' ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* ── Header ── */}
      <header className="db-head">
        <div className="db-head-copy">
          <nav aria-label="Breadcrumb" className="db-crumb">Analytics &amp; Reports <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">Dashboard Builder</span></nav>
          <div className="db-title">
            <span className="db-title-icon"><LayoutGrid size={24} aria-hidden="true" /></span>
            <div>
              <h1>Dashboard Builder</h1>
              <p>Build dashboards from governed widgets, shared filters and reusable layouts.</p>
            </div>
          </div>
        </div>
        <div className="db-head-actions">
          <label className="db-template">
            <span>Template</span>
            <select className="cc-select" aria-label="Template" value={draft?.id || ''} onChange={e => handleSwitchById(e.target.value)}>
              {layoutOptions.map(l => <option key={l.id} value={l.id}>{l.name}{l.id === DEFAULT_LAYOUT.id ? ' (starter)' : ''}</option>)}
            </select>
          </label>
          <button type="button" className="cc-btn-ghost" onClick={handleSave} disabled={!canSaveInPlace || !dirty || saving}
            title={canSaveInPlace ? 'Save changes to this layout' : 'You do not own this layout. Use Save as Template.'}>
            <Save size={15} aria-hidden="true" /> {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button type="button" className="cc-btn-ghost" onClick={() => setEditMode(m => !m)}>
            {editMode ? <><Eye size={15} aria-hidden="true" /> Preview</> : <><Pencil size={15} aria-hidden="true" /> Edit layout</>}
          </button>
          <div className="db-split" ref={moreRef}>
            {canPublish ? (
              <button type="button" className="cc-btn-primary" onClick={handleToggleShared} disabled={saving}
                title={draft?.shared ? 'Make this layout private' : 'Publish this layout to everyone'}>
                <Send size={15} aria-hidden="true" /> {draft?.shared ? 'Unpublish' : 'Publish'}
              </button>
            ) : (
              <button type="button" className="cc-btn-primary" onClick={() => setModal({ mode: 'saveAs' })} disabled={saving}>
                <Copy size={15} aria-hidden="true" /> Save as Template
              </button>
            )}
            <button type="button" className="cc-btn-primary db-split-caret" aria-label="More layout actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>
              <ChevronDown size={15} />
            </button>
            {moreOpen && (
              <div className="db-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setModal({ mode: 'new' }) }} disabled={saving}><Plus size={14} aria-hidden="true" /> New layout</button>
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setModal({ mode: 'saveAs' }) }} disabled={saving}><Copy size={14} aria-hidden="true" /> Save as new layout</button>
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setModal({ mode: 'rename' }) }} disabled={!canSaveInPlace || saving}><Pencil size={14} aria-hidden="true" /> Rename</button>
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); handleSetDefault() }} disabled={saving || !draft || isStarter || draft.is_default}><Star size={14} aria-hidden="true" /> Set as my default</button>
                <button type="button" role="menuitem" className="is-danger" onClick={() => { setMoreOpen(false); handleDelete() }} disabled={!canDelete || saving}><Trash2 size={14} aria-hidden="true" /> Delete layout</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {loadError && (
        <div className="cc-card db-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{loadError} The starter layout is shown instead.</span>
          <button type="button" className="cc-btn-ghost" onClick={() => window.location.reload()}><RefreshCw size={13} aria-hidden="true" /> Try again</button>
        </div>
      )}

      <div className="db-layout">
        <WidgetLibrary placedIds={(draft?.widgets || []).map(w => w.widgetId)} onAdd={addFromLibrary} searchRef={librarySearchRef} />

        {/* ── Canvas ── */}
        <section className="cc-card db-canvas" aria-label="Canvas">
          <div className="db-canvas-head">
            <div className="db-canvas-title">
              <h2 className="cc-card-title">Canvas <span className="db-dot" aria-hidden="true">.</span> {draft?.name || 'Dashboard'}</h2>
              {draft?.is_default && <Star size={13} className="db-star" aria-label="Your default layout" />}
              {draft?.shared && <span className="cc-pill info"><Globe size={11} aria-hidden="true" /> Published</span>}
              <span className={`cc-pill ${status.tone}`}>{status.text}</span>
            </div>
            <div className="db-canvas-tools">
              <div className="db-devices" role="group" aria-label="Preview size">
                {DEVICES.map(d => {
                  const Icon = DEVICE_ICON[d.key]
                  return (
                    <button key={d.key} type="button" aria-pressed={device === d.key} title={d.label} aria-label={d.label} onClick={() => setDevice(d.key)}>
                      <Icon size={15} />
                    </button>
                  )
                })}
              </div>
              <button type="button" className="cc-btn-ghost" onClick={() => setConfirmState({ kind: 'clear' })} disabled={!draft?.widgets.length}>
                <Eraser size={14} aria-hidden="true" /> Clear Canvas
              </button>
              <button type="button" className="cc-icon-btn" onClick={() => loadData(widgetIds)} title="Refresh data now" aria-label="Refresh data now"><RefreshCw size={14} /></button>
            </div>
          </div>
          <p className="db-canvas-sub">
            {summary.widgets} widgets, filtered to {filterText}.{' '}
            {editMode ? 'Edit mode: drag to reorder, use the bar on each widget to resize or remove.' : 'Live data, refreshes every 2 minutes.'}
          </p>

          <div ref={canvasRef} className="db-canvas-area" onDragOver={e => e.preventDefault()} onDrop={onCanvasDrop}>
            <div className={`db-frame db-frame-${device}`} style={deviceDef.maxWidth ? { maxWidth: deviceDef.maxWidth } : undefined}>
              {draft && draft.widgets.length === 0 ? (
                <div className="db-empty">
                  <LayoutDashboard size={36} aria-hidden="true" />
                  <b>This layout is empty</b>
                  <span>Drag widgets here from the Widget Library, or press + on any widget. KPIs, gauges, charts and lists all read live fleet data.</span>
                  <button type="button" className="cc-btn-primary" onClick={() => { setEditMode(true); librarySearchRef.current?.focus() }}>
                    <Plus size={14} aria-hidden="true" /> Find a widget
                  </button>
                </div>
              ) : (
                <div className="db-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                  {(draft?.widgets || []).map((pw, i) => {
                    const def = WIDGET_BY_ID[pw.widgetId]
                    const n = draft.widgets.length
                    return (
                      <div
                        key={`${pw.widgetId}-${i}`}
                        className={`db-cell db-h-${pw.h} ${editMode ? 'is-edit' : ''}`}
                        style={{ gridColumn: `span ${spanFor(pw.w, cols)}` }}
                        draggable={editMode}
                        onDragStart={editMode ? onDragStart(i) : undefined}
                        onDragOver={onDragOver}
                        onDrop={onCellDrop(i)}
                      >
                        {editMode && (
                          <div className="db-cell-bar">
                            <span className="db-cell-name" title="Drag to reorder">
                              <GripVertical size={12} aria-hidden="true" />
                              <span>{def?.label}</span>
                            </span>
                            <span className="db-cell-ctrls">
                              <IconBtn title="Move earlier" onClick={() => handleMove(i, -1)} disabled={i === 0}><ChevronLeft size={12} /></IconBtn>
                              <IconBtn title="Move later" onClick={() => handleMove(i, 1)} disabled={i === n - 1}><ChevronRight size={12} /></IconBtn>
                              <span className="db-sep" />
                              {Array.from({ length: MAX_W - MIN_W + 1 }, (_, k) => MIN_W + k).map(w => (
                                <SizeBtn key={w} title={`${w} column${w > 1 ? 's' : ''} wide`} active={pw.w === w} onClick={() => handleWidth(i, w)}>{w}</SizeBtn>
                              ))}
                              <span className="db-sep" />
                              {Object.keys(SIZE_PRESETS).map(k => (
                                <SizeBtn key={k} title={`${k} preset`} onClick={() => handlePreset(i, k)}
                                  active={pw.w === SIZE_PRESETS[k].w && pw.h === SIZE_PRESETS[k].h}>{k}</SizeBtn>
                              ))}
                              <span className="db-sep" />
                              <IconBtn title="Remove widget" danger onClick={() => handleRemove(i)}><X size={12} /></IconBtn>
                            </span>
                          </div>
                        )}
                        <div className={`db-cell-body ${editMode ? 'is-locked' : ''}`}>
                          <WidgetRenderer widgetId={pw.widgetId} slice={slices[pw.widgetId] || EMPTY_SLICE} currency={activeCurrency} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        <SettingsPanel
          draft={draft}
          isStarter={isStarter}
          canEditName={!!canSaveInPlace}
          onName={handleNameChange}
          filters={filters}
          siteOptions={siteOptions}
          sitesLoading={sitesLoading}
          onFilter={handleFilterChange}
          onReset={handleFilterReset}
          editMode={editMode}
          access={access}
          layoutOptions={layoutOptions}
          onSwitch={handleSwitchById}
          onSetDefault={handleSetDefault}
          onToggleShared={handleToggleShared}
          saving={saving}
          summary={summary}
          fixedGrid={fixedGrid}
          onFixedGrid={setFixedGrid}
        />
      </div>

      {/* ── Footer actions ── */}
      <footer className="db-foot">
        <span className="db-muted">{dirty ? 'You have unsaved changes on this layout.' : `Layouts saved: ${visible.length} of ${MAX_LAYOUTS}.`}</span>
        <button type="button" className="cc-btn-ghost" onClick={handleDiscard} disabled={!dirty || saving}>Cancel</button>
        <button type="button" className="cc-btn-ghost" onClick={() => setModal({ mode: 'saveAs' })} disabled={saving}>Save as Template</button>
        {canPublish ? (
          <button type="button" className="cc-btn-primary" onClick={async () => { if (dirty && canSaveInPlace) await handleSave(); if (!draft?.shared) await handleToggleShared() }} disabled={saving || (draft?.shared && !dirty)}>
            <Send size={14} aria-hidden="true" /> {draft?.shared ? 'Save Published Dashboard' : 'Publish Dashboard'}
          </button>
        ) : (
          <button type="button" className="cc-btn-primary" onClick={handleSave} disabled={!canSaveInPlace || !dirty || saving}>
            <Save size={14} aria-hidden="true" /> Save Dashboard
          </button>
        )}
      </footer>

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

      {/* ── Confirmations (delete layout / discard unsaved changes) ── */}
      <Modal
        open={!!confirmState}
        onClose={saving ? undefined : () => setConfirmState(null)}
        title={confirmState?.kind === 'delete' ? 'Delete layout' : confirmState?.kind === 'clear' ? 'Clear canvas' : 'Discard unsaved changes'}
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmState(null)} disabled={saving}
              className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40">
              Cancel
            </button>
            {confirmState?.kind === 'clear' ? (
              <button type="button" onClick={confirmClearCanvas} className="cc-btn-primary db-danger-fill">Remove all widgets</button>
            ) : confirmState?.kind === 'delete' ? (
              <button type="button" onClick={confirmDeleteLayout} disabled={saving}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {saving ? 'Deleting...' : 'Delete layout'}
              </button>
            ) : (
              <button type="button"
                onClick={() => { const l = confirmState?.layout; setConfirmState(null); if (l) applySwitch(l) }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors">
                Discard and switch
              </button>
            )}
          </>
        )}
      >
        <p className="text-sm text-[var(--text-secondary)]">
          {confirmState?.kind === 'clear'
            ? 'Remove every widget from this canvas? Nothing is saved until you press Save Draft, and Cancel brings the widgets back.'
            : confirmState?.kind === 'delete'
            ? `Delete layout "${draft?.name || ''}"? This cannot be undone.`
            : 'Discard unsaved changes to the current layout?'}
        </p>
      </Modal>
    </div>
  )
}
