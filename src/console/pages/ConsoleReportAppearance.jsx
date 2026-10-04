import { useEffect, useState, useCallback, useMemo } from 'react'
import { Palette, Save, RotateCcw, CheckCircle2, Sparkles, Image as ImageIcon, Trash2, Layers, Upload, Wand2, FileText } from 'lucide-react'
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  PRESETS, PRESET_KEYS, PRESET_LABELS, DEFAULT_PRESET, setReportPalette,
} from '../../lib/reportColors'
import { getCompanyLogo, setCompanyLogo, getDiagramBg, setDiagramBg } from '../../lib/api/brandLogo'
import { safeImageSrc } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'
import {
  Note, Badge, Code, Btn, LoadingState, ErrorState,
  StatTile, ConfirmImpactDialog, Panel, PanelHeader,
} from '../components/ui'
import { PageHeader, useUrlTab, AttentionList, Collapsible, fmtRelative, fmtDateTime } from './shared/pageKit'
import { auditPalette, isLightBackground, contrastRatio, darkenToContrast, fixPalette, colourName } from './appearance/paletteCheck'
import { prepareLogo, LOGO_TYPES } from './appearance/logoUpload'
import { listConfigHistory, namesFor } from '../../lib/api/consolePlatform'
import { fetchConfigStamps } from './config/configStamps'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip)

const CONFIG_KEY = 'report_palette'
const DEFAULT_DIAGRAM_BG = '#000000'
const PREVIEW_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false } },
}
const DOUGHNUT_PREVIEW = { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }

const SECTIONS = ['theme', 'logo', 'diagram', 'none']

const FIELD_LABEL = 'block text-xs font-semibold text-gray-400 mb-1'
const TRACKED_KEYS = ['report_palette', 'company_logo', 'report_diagram_bg']

/** Readable ink over a #rrggbb swatch. Falls back to light ink on anything unparseable. */
function inkOver(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return '#fef08a'
  const n = parseInt(m[1], 16)
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 150 ? '#1f2937' : '#fef08a'
}

/** Audit is best effort: a logging failure must never undo or hide a real save. */
async function audit(logAction, ...args) {
  try { await logAction(...args) } catch { /* non-fatal */ }
}

function Swatches({ colors, height = 'h-4' }) {
  return (
    <div className="flex gap-1">
      {colors.map((c, i) => <span key={`${i}-${c}`} className={`${height} flex-1 rounded-sm`} style={{ background: c }} />)}
    </div>
  )
}

/** THE super-admin control for the report colour theme (org-wide). Persists the
 *  choice to system_config.report_palette and applies it live to every report. */
export default function ConsoleReportAppearance({ sectionParam = 'section' } = {}) {
  const { logAction } = useConsoleAuth()
  const [sel, setSel] = useState(DEFAULT_PRESET)          // preset key OR hex array (custom)
  const [savedSel, setSavedSel] = useState(DEFAULT_PRESET)
  const [custom, setCustom] = useState([...PRESETS[DEFAULT_PRESET]])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Company logo (org-wide brand mark on shared TV reports / public links).
  const [logoUrl, setLogoUrl] = useState('')          // persisted value
  const [logoInput, setLogoInput] = useState('')       // editable input
  const [logoLoading, setLogoLoading] = useState(true)
  const [logoSaving, setLogoSaving] = useState(false)
  const [logoSaved, setLogoSaved] = useState(false)
  const [confirmClearLogo, setConfirmClearLogo] = useState(false)
  const [logoError, setLogoError] = useState('')
  const [diagBg, setDiagBg] = useState(DEFAULT_DIAGRAM_BG)     // diagram background (editable)
  const [diagBgSaving, setDiagBgSaving] = useState(false)
  const [diagBgSaved, setDiagBgSaved] = useState(false)
  const [diagBgError, setDiagBgError] = useState('')
  const [diagBgStored, setDiagBgStored] = useState(DEFAULT_DIAGRAM_BG)
  const [readAt, setReadAt] = useState(null)
  const [section, setSection] = useUrlTab(SECTIONS, 'theme', sectionParam)
  const [history, setHistory] = useState({ state: 'loading', latest: {}, names: {} })
  const [stamps, setStamps] = useState({ map: {}, names: {} })
  const [logoInfo, setLogoInfo] = useState(null) // last prepared upload { width, height, bytes, tooLight }
  const [uploading, setUploading] = useState(false)

  // Last change of each appearance setting (system_config_history, super admin).
  const loadHistory = useCallback(async () => {
    try {
      const rows = await listConfigHistory({ limit: 300 })
      const latest = {}
      for (const r of rows || []) if (TRACKED_KEYS.includes(r.key) && !latest[r.key]) latest[r.key] = r
      const names = await namesFor(Object.values(latest).map((r) => r.changed_by)).catch(() => ({}))
      setHistory({ state: 'ok', latest, names })
    } catch {
      setHistory({ state: 'error', latest: {}, names: {} })
    }
  }, [])
  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => fetchConfigStamps(TRACKED_KEYS)).then(async (map) => {
      const names = await namesFor(Object.values(map).map((x) => x.updated_by)).catch(() => ({}))
      if (alive) setStamps({ map, names })
    }).catch(() => { /* fallback only */ })
    return () => { alive = false }
  }, [history])
  const lastText = (key) => {
    const r = history.latest[key]
    if (r) return `Last changed ${fmtRelative(r.changed_at)} by ${history.names[r.changed_by] || (r.changed_by ? 'unknown person' : 'system')}`
    const st = stamps.map[key]
    if (st?.updated_at) return `Last written ${fmtRelative(st.updated_at)}${st.updated_by ? ` by ${stamps.names[st.updated_by] || 'unknown person'}` : ' (person not recorded before 30 Sep 2026)'}`
    if (history.state === 'loading') return ''
    return 'Never saved: the built-in default is in use'
  }

  async function onLogoFile(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setUploading(true); setLogoError(''); setLogoSaved(false)
    try {
      const out = await prepareLogo(file)
      setLogoInput(out.dataUrl)
      setLogoInfo(out)
    } catch (err) {
      setLogoError(toUserMessage(err, 'The image could not be used.'))
    } finally {
      setUploading(false)
    }
  }
  const load = useCallback(async () => {
    setLoading(true); setSaved(false); setError(''); setLoadError('')
    try {
      const { data, error: err } = await supabase.from('system_config').select('value').eq('key', CONFIG_KEY).maybeSingle()
      // A failed read used to fall through silently and show the default
      // preset as though it were the saved choice. Say so instead.
      if (err) throw err
      if (data?.value) {
        try {
          const parsed = JSON.parse(data.value)
          if (Array.isArray(parsed)) { setSel(parsed); setCustom(parsed); setSavedSel(parsed) }
          else if (typeof parsed === 'string' && PRESETS[parsed]) { setSel(parsed); setSavedSel(parsed) }
        } catch {
          if (PRESETS[data.value]) { setSel(data.value); setSavedSel(data.value) }
        }
      }
    } catch (e) {
      setLoadError(toUserMessage(e, 'The saved theme could not be read.'))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const loadLogo = useCallback(async () => {
    setLogoLoading(true); setLogoError(''); setLogoSaved(false)
    try {
      const url = await getCompanyLogo()
      setLogoUrl(url); setLogoInput(url)
    } catch (e) {
      setLogoError(toUserMessage(e))
    } finally {
      setLogoLoading(false)
    }
  }, [])
  useEffect(() => { loadLogo() }, [loadLogo])

  // Loaded on its own so a logo read failure no longer leaves the diagram
  // colour stuck on its default (getDiagramBg never throws).
  const loadDiagBg = useCallback(async () => {
    const bg = await getDiagramBg()
    setDiagBg(bg || DEFAULT_DIAGRAM_BG)
    setDiagBgStored(bg || DEFAULT_DIAGRAM_BG)
  }, [])
  useEffect(() => { loadDiagBg() }, [loadDiagBg])

  async function saveLogo() {
    setLogoSaving(true); setLogoError(''); setLogoSaved(false)
    try {
      await setCompanyLogo(logoInput)
      const next = logoInput.trim()
      setLogoUrl(next); setLogoInput(next)
      await audit(logAction, 'update_config', null, 'company_logo', { set: next !== '', uploaded: next.startsWith('data:') })
      setLogoSaved(true)
      loadHistory()
    } catch (e) {
      setLogoError(toUserMessage(e))
    } finally {
      setLogoSaving(false)
    }
  }

  async function saveDiagBg(value) {
    setDiagBgSaving(true); setDiagBgError(''); setDiagBgSaved(false)
    try {
      await setDiagramBg(value)
      setDiagBg(value || DEFAULT_DIAGRAM_BG)
      setDiagBgStored(value || DEFAULT_DIAGRAM_BG)
      await audit(logAction, 'update_config', null, 'report_diagram_bg', { value: value || 'default' })
      setDiagBgSaved(true)
      loadHistory()
    } catch (e) {
      setDiagBgError(toUserMessage(e))
    } finally {
      setDiagBgSaving(false)
    }
  }

  async function clearLogo(reason) {
    setConfirmClearLogo(false)
    setLogoSaving(true); setLogoError(''); setLogoSaved(false)
    try {
      await setCompanyLogo('')
      setLogoUrl(''); setLogoInput(''); setLogoInfo(null)
      await audit(logAction, 'update_config', null, 'company_logo', { set: false, reason: reason || null })
      setLogoSaved(true)
      loadHistory()
    } catch (e) {
      setLogoError(toUserMessage(e))
    } finally {
      setLogoSaving(false)
    }
  }

  const logoPreview = safeImageSrc(logoInput.trim())
  const logoDirty = logoInput.trim() !== logoUrl

  const isCustom = Array.isArray(sel)
  const activeColors = useMemo(() => (isCustom ? sel : PRESETS[sel] || PRESETS[DEFAULT_PRESET]), [sel, isCustom])
  const themeDirty = JSON.stringify(sel) !== JSON.stringify(savedSel)
  const themeName = isCustom ? 'Custom' : (PRESET_LABELS[sel] || sel)

  // Live preview chart data built directly from the selected colours.
  const barData = useMemo(() => ({
    labels: activeColors.slice(0, 6).map((_, i) => `S${i + 1}`),
    datasets: [{ data: [8, 5, 7, 4, 6, 3], backgroundColor: activeColors.slice(0, 6), borderRadius: 3 }],
  }), [activeColors])
  const doughnutData = useMemo(() => ({
    labels: activeColors.slice(0, 5).map((_, i) => `P${i + 1}`),
    datasets: [{ data: [30, 22, 18, 16, 14], backgroundColor: activeColors.slice(0, 5), borderWidth: 0 }],
  }), [activeColors])

  function chooseCustom() {
    const seed = isCustom ? sel : PRESETS[sel] || PRESETS[DEFAULT_PRESET]
    setCustom([...seed]); setSel([...seed]); setSaved(false)
  }
  function editCustom(i, hex) {
    const next = custom.slice(); next[i] = hex
    setCustom(next); setSel(next); setSaved(false)
  }

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const value = JSON.stringify(sel) // preset name string or hex array
      const { error: err } = await supabase
        .from('system_config')
        .upsert([{ key: CONFIG_KEY, value, updated_at: new Date().toISOString() }], { onConflict: 'key', ignoreDuplicates: false })
      if (err) { setError(toUserMessage(err, 'Could not save the palette.')); return }
      setReportPalette(sel)              // apply live for this session immediately
      setSavedSel(sel)
      await audit(logAction, 'update_config', null, 'report_palette', { theme: isCustom ? 'custom' : sel })
      setSaved(true)
      loadHistory()
    } catch (e) {
      setError(toUserMessage(e, 'Could not save the palette.'))
    } finally {
      setSaving(false)
    }
  }

  function resetDefault() { setSel(DEFAULT_PRESET); setSaved(false) }
  function revertTheme() {
    setSel(savedSel)
    if (Array.isArray(savedSel)) setCustom(savedSel)
    setSaved(false)
  }

  const refreshAll = useCallback(async () => {
    await Promise.all([load(), loadLogo(), loadDiagBg()])
    setReadAt(Date.now())
  }, [load, loadLogo, loadDiagBg])
  useEffect(() => { if (!loading && !logoLoading && !readAt) setReadAt(Date.now()) }, [loading, logoLoading, readAt])

  const paletteAudit = useMemo(() => auditPalette(activeColors), [activeColors])
  function useDarkerColours() {
    const fixed = fixPalette(activeColors)
    setCustom(fixed); setSel(fixed); setSaved(false)
  }
  const logoIsUpload = logoInput.trim().startsWith('data:')
  const diagDirty = diagBg !== diagBgStored
  const diagLight = isLightBackground(diagBg)
  const openSection = (key) => setSection(key)


  const attention = []
  if (!loading && !loadError && themeDirty) {
    attention.push({ key: 'theme', tone: 'warning', text: 'The colour theme has unsaved changes. Reports keep the saved theme until you save.', actionLabel: 'Review theme', onAction: () => openSection('theme') })
  }
  if (!loading && paletteAudit.weak.length) {
    attention.push({ key: 'weak', tone: 'warning', text: `${paletteAudit.weak.length} ${paletteAudit.weak.length === 1 ? 'colour is' : 'colours are'} too pale to see clearly on a white report page (below 3:1 contrast).`, actionLabel: 'Review theme', onAction: () => openSection('theme') })
  }
  if (!loading && paletteAudit.duplicates.length) {
    attention.push({ key: 'dupe', tone: 'info', text: `${paletteAudit.duplicates.length} ${paletteAudit.duplicates.length === 1 ? 'pair of colours looks' : 'pairs of colours look'} almost the same, so a legend cannot tell those series apart.`, actionLabel: 'Review theme', onAction: () => openSection('theme') })
  }
  if (!logoLoading && !logoError && !logoUrl) {
    attention.push({ key: 'logo', tone: 'info', text: 'No company logo is set, so shared TV boards and public report links show no brand mark.', actionLabel: 'Set a logo', onAction: () => openSection('logo') })
  }
  if (diagLight) {
    attention.push({ key: 'diag', tone: 'warning', text: 'The inspection diagram background is light. The wheel labels are light too and will be hard to read.', actionLabel: 'Change it', onAction: () => openSection('diagram') })
  }

  const toggle = (key) => (open) => setSection(open ? key : 'none')

  return (
    <div className="space-y-4 max-w-7xl">
      <PageHeader
        icon={Palette}
        title="Report Appearance"
        purpose="The colour theme for every report chart (Board Overview, Executive, Accident and analytics reports), the company logo on shared boards, and the inspection diagram background. Applies org-wide."
        refreshedAt={readAt}
        onRefresh={refreshAll}
        refreshing={loading || logoLoading}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={Layers} label="Colour theme" value={loadError ? 'N/A' : loading ? '...' : themeName}
          sub={loadError ? 'could not be read' : themeDirty ? 'Unsaved change' : 'Saved and in use'} tone={themeDirty ? 'warning' : 'default'}
          onClick={() => openSection('theme')} active={section === 'theme'} />
        <StatTile label="Readable on white" value={loading ? '...' : `${paletteAudit.checked - paletteAudit.weak.length} of ${paletteAudit.checked}`}
          sub="colours at 3:1 or better" tone={paletteAudit.weak.length ? 'warning' : 'good'}
          onClick={() => openSection('theme')} />
        <StatTile icon={ImageIcon} label="Logo" value={logoError ? 'N/A' : logoLoading ? '...' : logoUrl ? 'Set' : 'Not set'}
          sub={logoError ? 'could not be read' : logoDirty ? 'Unsaved change' : 'On shared boards'} tone={logoUrl ? 'good' : 'muted'}
          onClick={() => openSection('logo')} active={section === 'logo'} />
        <StatTile label="Diagram colour" value={diagBgStored} sub={diagDirty ? 'Unsaved change' : diagLight ? 'Too light for labels' : 'Behind the tyre map'}
          tone={diagLight ? 'warning' : 'default'} onClick={() => openSection('diagram')} active={section === 'diagram'} />
      </div>

      <AttentionList items={attention} clear="The theme, logo and diagram colour are all set and readable." />

      <Panel>
        <PanelHeader icon={FileText} title="Report page preview"
          subtitle="How a shared report page looks with the selected theme, logo and diagram colour together. Nothing is saved from here." />
        <div className="rounded-xl border border-gray-800 p-4 space-y-3" style={{ background: '#ffffff', color: '#1f2937' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              {logoPreview
                ? <img src={logoPreview} alt="Company logo on the sample report" style={{ maxHeight: 36, maxWidth: 160, objectFit: 'contain' }} />
                : <span className="text-[11px] px-2 py-1 rounded border" style={{ borderColor: '#d1d5db', color: '#6b7280' }}>No logo</span>}
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: '#111827' }}>Board Overview</p>
                <p className="text-[11px]" style={{ color: '#6b7280' }}>Sample page, sample numbers</p>
              </div>
            </div>
            <span className="text-[11px]" style={{ color: '#6b7280' }}>Theme: {themeName}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div style={{ height: 110 }} className="sm:col-span-2"><Bar data={barData} options={PREVIEW_OPTS} /></div>
            <div style={{ height: 110 }}><Doughnut data={doughnutData} options={DOUGHNUT_PREVIEW} /></div>
          </div>
          <div className="rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap" style={{ background: diagBg }}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="inline-block rounded-sm" style={{ width: 14, height: 26, background: '#4b5563', border: `2px solid ${inkOver(diagBg)}` }} />
            ))}
            <span className="text-[11px] font-semibold" style={{ color: inkOver(diagBg) }}>Diagram background sample</span>
          </div>
        </div>
      </Panel>

      {/* ── Colour theme ─────────────────────────────────────────────────── */}
      <Collapsible
        icon={Layers}
        title="Chart colour theme"
        subtitle={loading ? 'Loading current theme' : `Selected: ${themeName}. ${lastText('report_palette')}`}
        open={section === 'theme'}
        onToggle={toggle('theme')}
        actions={(
          <>
            {themeDirty && !loading && <Badge tone="warning">Unsaved</Badge>}
            {themeDirty && !loading && <Btn onClick={revertTheme} disabled={saving}>Revert</Btn>}
            <Btn icon={RotateCcw} onClick={resetDefault} disabled={loading || saving}>Default</Btn>
            <Btn variant="primary" icon={Save} onClick={handleSave} busy={saving} disabled={loading || !!loadError}>
              Save theme
            </Btn>
          </>
        )}
      >
        <div className="space-y-3">
          <ErrorState message={loadError} onRetry={load} />
          <ErrorState message={error} />
          {saved && (
            <Note icon={CheckCircle2} tone="accent">
              Theme saved and applied. Reports use it now; other users pick it up on their next load.
            </Note>
          )}

          {loading ? (
            <LoadingState label="Loading current theme" rows={3} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Preset picker */}
              <div className="lg:col-span-2 space-y-3">
                <p className={FIELD_LABEL}>Preset themes</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PRESET_KEYS.map((key) => {
                    const active = !isCustom && sel === key
                    const weakHere = auditPalette(PRESETS[key]).weak.length
                    return (
                      <button type="button" key={key} onClick={() => { setSel(key); setSaved(false) }} aria-pressed={active}
                        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-xl border p-3 text-left transition-colors ${active ? 'border-orange-600/60 bg-orange-950/20' : 'border-gray-800 hover:border-gray-700 bg-gray-900/50'}`}>
                        <div className="flex items-center justify-between mb-2 gap-2">
                          <span className="text-sm font-semibold text-gray-100">{PRESET_LABELS[key] || key}</span>
                          <span className="flex items-center gap-1">
                            {weakHere > 0 && <Badge tone="warning" title="Colours below 3:1 contrast on a white page">{weakHere} pale</Badge>}
                            {active && <Badge tone="accent" icon={CheckCircle2}>Selected</Badge>}
                          </span>
                        </div>
                        <Swatches colors={PRESETS[key]} />
                      </button>
                    )
                  })}
                  {/* Custom */}
                  <button type="button" onClick={chooseCustom} aria-pressed={isCustom}
                    className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-xl border p-3 text-left transition-colors ${isCustom ? 'border-orange-600/60 bg-orange-950/20' : 'border-gray-800 hover:border-gray-700 bg-gray-900/50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-100 inline-flex items-center gap-1.5"><Sparkles size={14} className="text-orange-400" aria-hidden="true" /> Custom</span>
                      {isCustom && <Badge tone="accent" icon={CheckCircle2}>Selected</Badge>}
                    </div>
                    <Swatches colors={custom} />
                  </button>
                </div>

                {isCustom && (
                  <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3">
                    <p className={FIELD_LABEL}>Custom colours</p>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {custom.map((c, i) => {
                        const ratio = contrastRatio(c, '#ffffff')
                        const pale = ratio != null && ratio < 3
                        return (
                          <div key={i} className="space-y-0.5">
                            <input type="color" value={c} onChange={(e) => editCustom(i, e.target.value)}
                              className={`h-9 w-full rounded cursor-pointer bg-transparent border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${pale ? 'border-amber-600' : 'border-gray-800'}`} aria-label={`Colour ${i + 1}`} />
                            <p className={`text-[10px] tabular-nums text-center ${pale ? 'text-amber-300' : 'text-gray-500'}`}>{ratio == null ? 'N/A' : `${ratio.toFixed(1)}:1`}</p>
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-2">The ratio under each colour is its contrast on a white page. Aim for 3:1 or more.</p>
                  </div>
                )}

                {paletteAudit.weak.length > 0 && (
                  <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-3 space-y-2">
                    <p className="text-xs font-semibold text-amber-200">
                      {paletteAudit.weak.length} pale {paletteAudit.weak.length === 1 ? 'colour' : 'colours'} on a white page
                    </p>
                    <ul className="space-y-1">
                      {paletteAudit.weak.map((w) => {
                        const fix = darkenToContrast(w.hex)
                        return (
                          <li key={`${w.index}-${w.hex}`} className="flex flex-wrap items-center gap-2 text-[11px] text-gray-300">
                            <span className="w-4 h-4 rounded-sm border border-gray-700" style={{ background: w.hex }} aria-hidden="true" />
                            <span>Colour {w.index + 1}, {colourName(w.hex)} ({w.ratio.toFixed(1)}:1)</span>
                            <span className="text-gray-500">suggest</span>
                            <span className="w-4 h-4 rounded-sm border border-gray-700" style={{ background: fix }} aria-hidden="true" />
                            <Code>{fix}</Code>
                            <span className="text-gray-500">({contrastRatio(fix, '#ffffff')?.toFixed(1)}:1)</span>
                          </li>
                        )
                      })}
                    </ul>
                    <p className="text-[11px] text-gray-400">Who is affected: everyone who reads a chart in a report or PDF. Pale bars and slices are hard to see when printed.</p>
                    <Btn size="xs" icon={Wand2} onClick={useDarkerColours}>Use the darker colours</Btn>
                  </div>
                )}
              </div>
              {/* Live preview (deliberately white: this is how a printed report looks) */}
              <div className="space-y-2">
                <p className={FIELD_LABEL}>Live preview</p>
                <div className="rounded-xl border border-gray-800 bg-white p-3 space-y-3">
                  <div style={{ height: 120 }}><Bar data={barData} options={PREVIEW_OPTS} /></div>
                  <div style={{ height: 120 }}><Doughnut data={doughnutData} options={DOUGHNUT_PREVIEW} /></div>
                </div>
                <p className="text-[11px] text-gray-500">Preview on a white report page. The same colours drive on-screen and exported (PDF) charts.</p>
              </div>
            </div>
          )}
        </div>
      </Collapsible>

      {/* ── Company logo ─────────────────────────────────────────────────── */}
      <Collapsible
        icon={ImageIcon}
        title="Company logo"
        subtitle={`Shows on every shared TV report and public report link. ${lastText('company_logo')}`}
        open={section === 'logo'}
        onToggle={toggle('logo')}
        actions={(
          <>
            {logoDirty && !logoLoading && <Badge tone="warning">Unsaved</Badge>}
            <Btn icon={Trash2} onClick={() => setConfirmClearLogo(true)}
              disabled={logoSaving || logoLoading || (logoInput.trim() === '' && logoUrl === '')}>
              Clear
            </Btn>
            <Btn variant="primary" icon={Save} onClick={saveLogo} busy={logoSaving} disabled={logoLoading || (!!logoInput.trim() && !logoPreview)}>
              Save logo
            </Btn>
          </>
        )}
      >
        <div className="space-y-3">
          <ErrorState message={logoError} onRetry={logoLoading ? undefined : loadLogo} />
          {logoSaved && (
            <Note icon={CheckCircle2} tone="accent">Logo saved. It appears on shared TV reports and public links now.</Note>
          )}

          {logoLoading ? (
            <LoadingState label="Loading current logo" rows={2} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <div className="lg:col-span-2 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-800 text-xs text-gray-200 cursor-pointer hover:bg-gray-800/60 focus-within:ring-2 focus-within:ring-orange-500 ${uploading ? 'opacity-60' : ''}`}>
                    <Upload size={13} aria-hidden="true" />
                    {uploading ? 'Preparing image...' : 'Upload a logo'}
                    <input type="file" accept={LOGO_TYPES.join(',')} onChange={onLogoFile} disabled={uploading || logoSaving}
                      className="sr-only" aria-label="Upload a logo image" />
                  </label>
                  <span className="text-[11px] text-gray-500">PNG, JPEG or WebP up to 3 MB. Resized to fit 480 by 160 and stored as a small PNG.</span>
                </div>
                {logoIsUpload && (
                  <Note icon={ImageIcon} tone={logoInfo?.tooLight ? 'warning' : 'default'}>
                    Uploaded image{logoInfo ? `, ${logoInfo.width} by ${logoInfo.height}, ${Math.round(logoInfo.bytes / 1024)} KB` : ''}.
                    {logoInfo?.tooLight ? ' It is very light and may disappear on a white report page.' : ''}
                    {' '}<button type="button" className="underline text-orange-300 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                      onClick={() => { setLogoInput(''); setLogoInfo(null) }}>Paste a URL instead</button>
                  </Note>
                )}
                {!logoIsUpload && (<>
                <label htmlFor="company-logo-url" className={FIELD_LABEL}>Or paste a logo image URL</label>
                <input id="company-logo-url" type="url" inputMode="url" spellCheck={false}
                  value={logoInput} onChange={(e) => { setLogoInput(e.target.value); setLogoSaved(false); setLogoError('') }}
                  placeholder="https://your-company.com/logo.png"
                  aria-describedby="company-logo-help"
                  className="w-full rounded-lg bg-gray-900 border border-gray-800 text-gray-200 text-sm px-3 py-2 placeholder-gray-500 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
                <p id="company-logo-help" className="text-[11px] text-gray-500 mt-1.5">
                  Paste a public image URL (http or https) or a data:image URI. Use a wide, high-contrast mark so it reads on a wall board.
                  {logoInput.trim() && !logoPreview ? ' This address is not a usable image, so it cannot be saved.' : ''}
                </p>
                </>)}
                <p className="text-[11px] text-gray-400">Who is affected: everyone who opens a shared TV board or public report link.</p>
              </div>

              <div>
                <p className={FIELD_LABEL}>Preview</p>
                <div className="rounded-xl border border-gray-800 bg-white p-3 flex items-center justify-center" style={{ minHeight: 96 }}>
                  {logoPreview ? (
                    <img src={logoPreview} alt="Company logo preview" style={{ maxHeight: 72, maxWidth: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span className="text-xs" style={{ color: '#6b7280' }}>
                      {logoInput.trim() ? 'Not a usable image address' : 'No logo set'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Collapsible>

      {/* ── Inspection diagram background ────────────────────────────────── */}
      <Collapsible
        title="Inspection diagram background"
        subtitle={`The colour behind the tyre map on inspection and checklist reports. ${lastText('report_diagram_bg')}`}
        open={section === 'diagram'}
        onToggle={toggle('diagram')}
        tone={diagLight ? 'warning' : undefined}
        actions={(
          <>
            {diagDirty && <Badge tone="warning">Unsaved</Badge>}
            <Btn icon={RotateCcw} onClick={() => saveDiagBg('')} disabled={diagBgSaving}>Reset to black</Btn>
            <Btn variant="primary" icon={Save} onClick={() => saveDiagBg(diagBg)} busy={diagBgSaving}>Save colour</Btn>
          </>
        )}
      >
        <div className="space-y-3">
          <Note tone={diagLight ? 'warning' : 'default'}>Keep it dark. The wheel labels are light and disappear on a light background.</Note>
          <ErrorState message={diagBgError} />
          {diagBgSaved && (
            <Note icon={CheckCircle2} tone="accent">Saved. Every new inspection and checklist PDF uses this colour now.</Note>
          )}
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-gray-400">
              Colour
              <input type="color" value={diagBg}
                onChange={(e) => { setDiagBg(e.target.value); setDiagBgSaved(false); setDiagBgError('') }}
                className="h-9 w-14 rounded border border-gray-800 bg-gray-900 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
              <Code>{diagBg}</Code>
            </label>
            <div className="rounded-xl border border-gray-800 px-6 py-3 text-xs font-semibold"
              style={{ background: diagBg, color: inkOver(diagBg) }}>
              Diagram preview text
            </div>
          </div>
        </div>
      </Collapsible>

      <ConfirmImpactDialog open={confirmClearLogo} danger requireReason busy={logoSaving}
        title="Remove the company logo?" confirmLabel="Remove logo"
        onCancel={() => setConfirmClearLogo(false)} onConfirm={({ reason }) => clearLogo(reason)}
        impact={{
          tone: 'warning',
          what: 'The saved company logo is removed.',
          change: 'Shared TV reports and public report links show no brand mark until a new logo is saved.',
          who: 'Everyone who opens a shared board or public link, inside and outside the company.',
          undo: 'Yes. Upload or paste the logo again; the old value is kept in the settings change history.',
        }} />
    </div>
  )
}
