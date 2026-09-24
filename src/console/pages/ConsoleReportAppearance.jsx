import { useEffect, useState, useCallback, useMemo } from 'react'
import { Palette, Save, RotateCcw, CheckCircle2, Sparkles, Image as ImageIcon, Trash2, Layers } from 'lucide-react'
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
  Panel, PanelHeader, Note, Badge, Code, Btn, LoadingState, ErrorState,
} from '../components/ui'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip)

const CONFIG_KEY = 'report_palette'
const DEFAULT_DIAGRAM_BG = '#000000'
const PREVIEW_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false } },
}
const DOUGHNUT_PREVIEW = { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }

const FIELD_LABEL = 'block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1'

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
export default function ConsoleReportAppearance() {
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
  const [logoError, setLogoError] = useState('')
  const [diagBg, setDiagBg] = useState(DEFAULT_DIAGRAM_BG)     // diagram background (editable)
  const [diagBgSaving, setDiagBgSaving] = useState(false)
  const [diagBgSaved, setDiagBgSaved] = useState(false)
  const [diagBgError, setDiagBgError] = useState('')

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
  useEffect(() => {
    let alive = true
    getDiagramBg().then((bg) => { if (alive) setDiagBg(bg || DEFAULT_DIAGRAM_BG) })
    return () => { alive = false }
  }, [])

  async function saveLogo() {
    setLogoSaving(true); setLogoError(''); setLogoSaved(false)
    try {
      await setCompanyLogo(logoInput)
      const next = logoInput.trim()
      setLogoUrl(next); setLogoInput(next)
      await audit(logAction, 'update_config', null, 'company_logo', { set: next !== '' })
      setLogoSaved(true)
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
      await audit(logAction, 'update_config', null, 'report_diagram_bg', { value: value || 'default' })
      setDiagBgSaved(true)
    } catch (e) {
      setDiagBgError(toUserMessage(e))
    } finally {
      setDiagBgSaving(false)
    }
  }

  async function clearLogo() {
    setLogoSaving(true); setLogoError(''); setLogoSaved(false)
    try {
      await setCompanyLogo('')
      setLogoUrl(''); setLogoInput('')
      await audit(logAction, 'update_config', null, 'company_logo', { set: false })
      setLogoSaved(true)
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
    } catch (e) {
      setError(toUserMessage(e, 'Could not save the palette.'))
    } finally {
      setSaving(false)
    }
  }

  function resetDefault() { setSel(DEFAULT_PRESET); setSaved(false) }

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            <Palette size={18} className="text-orange-400" /> Report Appearance
          </h1>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            The colour theme for every report chart (Board Overview, Executive, Accident and analytics reports),
            the company logo on shared boards, and the inspection diagram background. Applies org-wide.
          </p>
        </div>
      </header>

      {/* ── Colour theme ─────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={Layers}
          title="Chart colour theme"
          subtitle={loading ? 'Loading current theme' : `Selected: ${themeName}`}
          actions={(
            <>
              {themeDirty && !loading && <Badge tone="warning">Unsaved</Badge>}
              <Btn icon={RotateCcw} onClick={resetDefault} disabled={loading || saving}>Default</Btn>
              <Btn variant="primary" icon={Save} onClick={handleSave} busy={saving} disabled={loading}>
                Save theme
              </Btn>
            </>
          )}
        />

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
                    return (
                      <button key={key} onClick={() => { setSel(key); setSaved(false) }} aria-pressed={active}
                        className={`rounded-xl border p-3 text-left transition-colors ${active ? 'border-orange-600/60 bg-orange-950/20' : 'border-gray-800 hover:border-gray-700 bg-gray-900/50'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-gray-100">{PRESET_LABELS[key] || key}</span>
                          {active && <Badge tone="accent" icon={CheckCircle2}>Selected</Badge>}
                        </div>
                        <Swatches colors={PRESETS[key]} />
                      </button>
                    )
                  })}
                  {/* Custom */}
                  <button onClick={chooseCustom} aria-pressed={isCustom}
                    className={`rounded-xl border p-3 text-left transition-colors ${isCustom ? 'border-orange-600/60 bg-orange-950/20' : 'border-gray-800 hover:border-gray-700 bg-gray-900/50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-100 inline-flex items-center gap-1.5"><Sparkles size={14} className="text-orange-400" /> Custom</span>
                      {isCustom && <Badge tone="accent" icon={CheckCircle2}>Selected</Badge>}
                    </div>
                    <Swatches colors={custom} />
                  </button>
                </div>

                {isCustom && (
                  <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3">
                    <p className={FIELD_LABEL}>Custom colours</p>
                    <div className="grid grid-cols-6 gap-2">
                      {custom.map((c, i) => (
                        <input key={i} type="color" value={c} onChange={(e) => editCustom(i, e.target.value)}
                          className="h-9 w-full rounded cursor-pointer bg-transparent border border-gray-800" aria-label={`Colour ${i + 1}`} />
                      ))}
                    </div>
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
      </Panel>

      {/* ── Company logo ─────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={ImageIcon}
          title="Company logo"
          subtitle="Shows on every shared TV report and public report link."
          actions={(
            <>
              {logoDirty && !logoLoading && <Badge tone="warning">Unsaved</Badge>}
              <Btn icon={Trash2} onClick={clearLogo}
                disabled={logoSaving || logoLoading || (logoInput.trim() === '' && logoUrl === '')}>
                Clear
              </Btn>
              <Btn variant="primary" icon={Save} onClick={saveLogo} busy={logoSaving} disabled={logoLoading}>
                Save logo
              </Btn>
            </>
          )}
        />
        <div className="space-y-3">
          <ErrorState message={logoError} onRetry={logoLoading ? undefined : loadLogo} />
          {logoSaved && (
            <Note icon={CheckCircle2} tone="accent">Logo saved. It appears on shared TV reports and public links now.</Note>
          )}

          {logoLoading ? (
            <LoadingState label="Loading current logo" rows={2} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <div className="lg:col-span-2">
                <label htmlFor="company-logo-url" className={FIELD_LABEL}>Logo image URL</label>
                <input id="company-logo-url" type="url" inputMode="url" spellCheck={false}
                  value={logoInput} onChange={(e) => { setLogoInput(e.target.value); setLogoSaved(false); setLogoError('') }}
                  placeholder="https://your-company.com/logo.png"
                  className="w-full rounded-lg bg-gray-900 border border-gray-800 text-gray-200 text-sm px-3 py-2 placeholder-gray-600 focus:border-gray-700 focus:outline-none" />
                <p className="text-[11px] text-gray-500 mt-1.5">
                  Paste a public image URL (http or https) or a data:image URI. Use a wide, high-contrast mark so it reads on a wall board.
                </p>
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
      </Panel>

      {/* ── Inspection diagram background ────────────────────────────────── */}
      <Panel>
        <PanelHeader
          title="Inspection diagram background"
          subtitle="The colour behind the tyre map on inspection and checklist reports."
          actions={(
            <>
              <Btn icon={RotateCcw} onClick={() => saveDiagBg('')} disabled={diagBgSaving}>Reset to black</Btn>
              <Btn variant="primary" icon={Save} onClick={() => saveDiagBg(diagBg)} busy={diagBgSaving}>Save colour</Btn>
            </>
          )}
        />
        <div className="space-y-3">
          <Note>Keep it dark. The wheel labels are light and disappear on a light background.</Note>
          <ErrorState message={diagBgError} />
          {diagBgSaved && (
            <Note icon={CheckCircle2} tone="accent">Saved. Every new inspection and checklist PDF uses this colour now.</Note>
          )}
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-gray-400">
              Colour
              <input type="color" value={diagBg}
                onChange={(e) => { setDiagBg(e.target.value); setDiagBgSaved(false); setDiagBgError('') }}
                className="h-9 w-14 rounded border border-gray-800 bg-gray-900 cursor-pointer" />
              <Code>{diagBg}</Code>
            </label>
            <div className="rounded-xl border border-gray-800 px-6 py-3 text-xs font-semibold"
              style={{ background: diagBg, color: inkOver(diagBg) }}>
              Diagram preview text
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}
