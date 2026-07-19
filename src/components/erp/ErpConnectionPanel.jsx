import { useState, useEffect, useCallback } from 'react'
import { PlugZap, Save, Loader2, KeyRound, ShieldCheck, AlertCircle, Info } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import * as erp from '../../lib/api/erp'
import { toUserMessage } from '../../lib/safeError'

/**
 * ERP Connection — the place to store how TyrePulse reaches your ERP: system,
 * secure base URL, which entities to pull, and how often. Non-secret config
 * only; the API key/token is set as a server secret (never in the browser), so
 * the form explains exactly how to provide it. Editing is admin-only.
 */
export default function ErpConnectionPanel() {
  const { profile } = useAuth()
  // Who may edit the ERP connection: full admins plus the scoped integration
  // roles. Mirrors the app_settings `erp_connection` RLS (MIGRATIONS_V107).
  const ERP_EDITOR_ROLES = new Set(['admin', 'integration admin', 'automation'])
  const isAdmin = ERP_EDITOR_ROLES.has(String(profile?.role || '').trim().toLowerCase())

  const [cfg, setCfg] = useState(erp.DEFAULT_ERP)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setCfg(await erp.getErpConnection()) }
    catch { /* keep defaults */ }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }))
  const toggleEntity = (id) => setCfg((c) => ({
    ...c, entities: c.entities.includes(id) ? c.entities.filter((e) => e !== id) : [...c.entities, id],
  }))

  async function save(e) {
    e.preventDefault(); setSaving(true); setMsg(null)
    try { setCfg(await erp.saveErpConnection(cfg)); setMsg({ type: 'ok', text: 'ERP connection saved.' }) }
    catch (err) { setMsg({ type: 'err', text: toUserMessage(err, 'Could not save.') }) }
    finally { setSaving(false) }
  }

  if (loading) return (
    <div className="card flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Loading ERP connection…</div>
  )

  return (
    <form onSubmit={save} className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><PlugZap size={15} className="text-[var(--accent)]" /> ERP connection</h2>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.enabled ? 'bg-emerald-900/30 text-emerald-400' : 'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>
          {cfg.enabled ? 'Enabled' : 'Not connected'}
        </span>
      </div>

      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 flex items-center gap-2 ${msg.type === 'ok' ? 'bg-emerald-950/30 border border-emerald-800/40 text-emerald-300' : 'bg-red-900/25 border border-red-700/40 text-red-300'}`}>
          {msg.type === 'ok' ? <ShieldCheck size={15} /> : <AlertCircle size={15} />} {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">ERP system</span>
          <select className="input w-full mt-1" value={cfg.system} disabled={!isAdmin} onChange={(e) => set('system', e.target.value)}>
            {erp.ERP_SYSTEMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Connection name</span>
          <input className="input w-full mt-1" value={cfg.name} disabled={!isAdmin} onChange={(e) => set('name', e.target.value)} placeholder="Production ERP" />
        </label>
        <label className="block md:col-span-2">
          <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">API base URL (https)</span>
          <input className="input w-full mt-1 font-mono text-sm" value={cfg.base_url} disabled={!isAdmin} onChange={(e) => set('base_url', e.target.value)} placeholder="https://erp.yourcompany.com/api/v1" />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Authentication</span>
          <select className="input w-full mt-1" value={cfg.auth_type} disabled={!isAdmin} onChange={(e) => set('auth_type', e.target.value)}>
            {erp.ERP_AUTH.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Sync frequency</span>
          <select className="input w-full mt-1 capitalize" value={cfg.frequency} disabled={!isAdmin} onChange={(e) => set('frequency', e.target.value)}>
            {erp.ERP_FREQUENCY.map((f) => <option key={f} value={f} className="capitalize">{f}</option>)}
          </select>
        </label>
      </div>

      <div>
        <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Entities to sync</span>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {erp.ERP_ENTITIES.map((en) => {
            const on = cfg.entities.includes(en.id)
            return (
              <button type="button" key={en.id} disabled={!isAdmin} onClick={() => toggleEntity(en.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${on ? 'bg-[var(--accent)] text-white border-transparent' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}>
                {en.label}
              </button>
            )
          })}
        </div>
      </div>

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-[var(--text-primary)]">Enable scheduled sync</span>
        <button type="button" role="switch" aria-checked={cfg.enabled} disabled={!isAdmin} onClick={() => set('enabled', !cfg.enabled)}
          className={`relative w-11 h-6 rounded-full transition-colors ${cfg.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--input-bg)] border border-[var(--input-border)]'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${cfg.enabled ? 'translate-x-5' : ''}`} />
        </button>
      </label>

      {/* Credentials explainer — the honest, secure part */}
      <div className="rounded-lg px-3 py-3 text-xs leading-relaxed bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] space-y-1.5">
        <p className="flex items-center gap-2 font-semibold text-[var(--text-primary)]"><KeyRound size={13} className="text-[var(--accent)]" /> Where does the API key go?</p>
        <p>Your ERP key/token is <b>never stored here or in the browser</b>. It's set once as a secure server secret. After saving this config, an admin runs:</p>
        <code className="block font-mono bg-black/30 rounded px-2 py-1.5 text-[11px] text-emerald-300 overflow-x-auto">supabase secrets set ERP_API_KEY=your-key-here</code>
        <p className="flex items-start gap-1.5 text-[var(--text-muted)]"><Info size={12} className="mt-0.5 shrink-0" /> A scheduled edge function then reads that secret, pulls the selected entities from your ERP, and stages every row into the Data Intake Center for validation before commit, the same controlled pipeline as manual uploads.</p>
      </div>

      {isAdmin ? (
        <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-60">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save connection
        </button>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">Only an administrator or an integration role (Integration Admin / Automation) can change the ERP connection.</p>
      )}
    </form>
  )
}
