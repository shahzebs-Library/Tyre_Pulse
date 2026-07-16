import { useEffect, useState, useCallback, useMemo } from 'react'
import { Palette, Save, RefreshCw, CheckCircle, Sparkles } from 'lucide-react'
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  PRESETS, PRESET_KEYS, PRESET_LABELS, DEFAULT_PRESET, setReportPalette,
} from '../../lib/reportColors'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip)

const CONFIG_KEY = 'report_palette'
const PREVIEW_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false } },
}
const DOUGHNUT_PREVIEW = { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }

/** THE super-admin control for the report colour theme (org-wide). Persists the
 *  choice to system_config.report_palette and applies it live to every report. */
export default function ConsoleReportAppearance() {
  const { logAction } = useConsoleAuth()
  const [sel, setSel] = useState(DEFAULT_PRESET)          // preset key OR hex array (custom)
  const [custom, setCustom] = useState([...PRESETS[DEFAULT_PRESET]])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setSaved(false); setError('')
    const { data } = await supabase.from('system_config').select('value').eq('key', CONFIG_KEY).maybeSingle()
    if (data?.value) {
      try {
        const parsed = JSON.parse(data.value)
        if (Array.isArray(parsed)) { setSel(parsed); setCustom(parsed) }
        else if (typeof parsed === 'string' && PRESETS[parsed]) setSel(parsed)
      } catch {
        if (PRESETS[data.value]) setSel(data.value)
      }
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const isCustom = Array.isArray(sel)
  const activeColors = useMemo(() => (isCustom ? sel : PRESETS[sel] || PRESETS[DEFAULT_PRESET]), [sel, isCustom])

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
    setSaving(true); setError('')
    const value = JSON.stringify(isCustom ? sel : sel) // preset name string or hex array
    const { error: err } = await supabase
      .from('system_config')
      .upsert([{ key: CONFIG_KEY, value, updated_at: new Date().toISOString() }], { onConflict: 'key', ignoreDuplicates: false })
    if (err) { setError(err.message); setSaving(false); return }
    setReportPalette(sel)              // apply live for this session immediately
    await logAction('update_config', null, 'report_palette', { theme: isCustom ? 'custom' : sel })
    setSaved(true); setSaving(false)
  }

  function resetDefault() { setSel(DEFAULT_PRESET); setSaved(false) }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><Palette size={20} /> Report Appearance</h1>
          <p className="text-sm text-slate-400 mt-1">Choose the colour theme for every report chart (Board Overview, Executive, Accident and analytics reports). Applies org-wide.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={resetDefault} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 inline-flex items-center gap-1.5"><RefreshCw size={13} /> Default</button>
          <button onClick={handleSave} disabled={saving || loading} className="text-sm px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
            <Save size={14} /> {saving ? 'Saving...' : 'Save theme'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/40 text-red-300 text-sm px-4 py-2">{error}</div>}
      {saved && <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 text-emerald-300 text-sm px-4 py-2 inline-flex items-center gap-2"><CheckCircle size={15} /> Theme saved and applied. Reports use it now; other users pick it up on their next load.</div>}

      {loading ? (
        <div className="text-slate-400 text-sm py-10 text-center">Loading current theme...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Preset picker */}
          <div className="lg:col-span-2 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Preset themes</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PRESET_KEYS.map((key) => {
                const active = !isCustom && sel === key
                return (
                  <button key={key} onClick={() => { setSel(key); setSaved(false) }}
                    className={`rounded-xl border p-3 text-left transition-colors ${active ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/40'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-white">{PRESET_LABELS[key] || key}</span>
                      {active && <CheckCircle size={15} className="text-indigo-400" />}
                    </div>
                    <div className="flex gap-1">
                      {PRESETS[key].map((c) => <span key={c} className="h-4 flex-1 rounded-sm" style={{ background: c }} />)}
                    </div>
                  </button>
                )
              })}
              {/* Custom */}
              <button onClick={chooseCustom}
                className={`rounded-xl border p-3 text-left transition-colors ${isCustom ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/40'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-white inline-flex items-center gap-1.5"><Sparkles size={14} /> Custom</span>
                  {isCustom && <CheckCircle size={15} className="text-indigo-400" />}
                </div>
                <div className="flex gap-1">
                  {custom.map((c) => <span key={c} className="h-4 flex-1 rounded-sm" style={{ background: c }} />)}
                </div>
              </button>
            </div>

            {isCustom && (
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Custom colours</p>
                <div className="grid grid-cols-6 gap-2">
                  {custom.map((c, i) => (
                    <input key={i} type="color" value={c} onChange={(e) => editCustom(i, e.target.value)}
                      className="h-9 w-full rounded cursor-pointer bg-transparent border border-slate-700" aria-label={`Colour ${i + 1}`} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Live preview */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live preview</p>
            <div className="rounded-xl border border-slate-700 bg-white p-3 space-y-3">
              <div style={{ height: 120 }}><Bar data={barData} options={PREVIEW_OPTS} /></div>
              <div style={{ height: 120 }}><Doughnut data={doughnutData} options={DOUGHNUT_PREVIEW} /></div>
            </div>
            <p className="text-[11px] text-slate-500">Preview on a white report page. The same colours drive on-screen and exported (PDF) charts.</p>
          </div>
        </div>
      )}
    </div>
  )
}
