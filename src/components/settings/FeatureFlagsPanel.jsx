import { useEffect, useRef, useState } from 'react'
import { ToggleRight, RotateCcw, Save } from 'lucide-react'
import {
  FLAG_DEFS, DEFAULT_FLAGS, fetchFlags, saveFlags, flagsByCategory,
} from '../../lib/featureFlags'

/**
 * Feature Flags — admin-only, org-wide feature switches (Roadmap #5).
 * Enable/disable whole capabilities per organisation without a deploy
 * (e.g. AI tools on, accident module off). Stored in app_settings under
 * `feature_flags`; writes are admin-gated by the same RLS as erp_connection.
 * Optimistic toggle + rollback on save failure.
 */
export default function FeatureFlagsPanel() {
  const [flags, setFlags] = useState(DEFAULT_FLAGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null) // { ok: boolean, text: string }
  const msgTimer = useRef(null)

  useEffect(() => {
    let active = true
    fetchFlags({ force: true })
      .then((f) => { if (active) setFlags(f) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; clearTimeout(msgTimer.current) }
  }, [])

  function flash(ok, text) {
    setMsg({ ok, text })
    clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(null), 4000)
  }

  async function persist(next, prev) {
    setSaving(true)
    try {
      await saveFlags(next)
      flash(true, 'Feature flags saved')
    } catch (err) {
      setFlags(prev) // rollback the optimistic update
      flash(false, `Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  function toggle(key) {
    if (loading || saving) return
    const prev = flags
    const next = { ...prev, [key]: !prev[key] }
    setFlags(next) // optimistic
    persist(next, prev)
  }

  function resetToDefaults() {
    if (loading || saving) return
    const prev = flags
    setFlags(DEFAULT_FLAGS)
    persist({ ...DEFAULT_FLAGS }, prev)
  }

  const isDefault = FLAG_DEFS.every((d) => flags[d.key] === d.default)
  const disabledCount = FLAG_DEFS.filter((d) => flags[d.key] === false).length

  return (
    <div className="card space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <ToggleRight size={16} /> Feature Flags
        </h2>
        {!isDefault && (
          <button
            type="button"
            onClick={resetToDefaults}
            disabled={saving}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 disabled:opacity-50"
          >
            <RotateCcw size={13} /> Reset to defaults
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)] -mt-2">
        Turn whole features on or off for your organisation — changes apply to every user, no deploy needed.
        {disabledCount > 0 && ` ${disabledCount} feature${disabledCount === 1 ? '' : 's'} currently disabled.`}
      </p>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading feature flags">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded-xl bg-[var(--input-bg)] animate-pulse" />
          ))}
        </div>
      ) : (
        flagsByCategory().map(({ category, flags: defs }) => (
          <div key={category}>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              {category}
            </p>
            <div className="space-y-3">
              {defs.map((def) => {
                const on = flags[def.key] !== false
                return (
                  <label key={def.key} className="flex items-center justify-between gap-4 cursor-pointer">
                    <span className="min-w-0">
                      <span className="block text-sm text-[var(--text-primary)]">{def.label}</span>
                      <span className="block text-xs text-[var(--text-muted)]">{def.description}</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${def.label} ${on ? 'enabled' : 'disabled'}`}
                      disabled={saving}
                      onClick={() => toggle(def.key)}
                      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60 ${
                        on ? 'bg-[var(--accent)]' : 'bg-[var(--input-bg)] border border-[var(--input-border)]'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
                    </button>
                  </label>
                )
              })}
            </div>
          </div>
        ))
      )}

      <div className="flex items-center gap-2 min-h-[1.25rem]" aria-live="polite">
        {saving && (
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
            <Save size={12} /> Saving…
          </span>
        )}
        {!saving && msg && (
          <span className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</span>
        )}
      </div>
    </div>
  )
}
