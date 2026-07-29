/**
 * CasePortalShare - per-case external insurer / authority read-only portal link.
 *
 * Mounted on the accident case detail (Overview), beside the case completion
 * panel. An elevated user (Admin / Manager / Director / super-admin) mints a
 * PII-lean read-only link for THIS case - the insurer or claims authority sees
 * the case status, severity, per-team workstream state and the claim STATUS only,
 * with no login and no reach into tenant data. Optional password + expiry; the
 * token is revealed ONCE and can be revoked.
 *
 * SHIP-BEFORE-MIGRATE. The portal RPCs (docs/accident-module/16_EXTERNAL_PORTAL.sql)
 * are an authored, not-yet-applied artifact. When the service reports
 * `reason:'not_provisioned'` this renders an honest "not yet activated" note
 * instead of controls, so it can ship before the migration lands.
 *
 * Backend service: src/lib/api/accidentPortal.js (create / revoke / buildUrl).
 * There is no list read here (the mint returns the id used to revoke in-session);
 * this is a per-case affordance, not the org-wide report_shares manager.
 */
import { useState, useCallback } from 'react'
import {
  Globe, Plus, Loader2, ShieldCheck, AlertCircle, Copy, Check,
  ExternalLink, Trash2, Lock, Clock, X,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { createCasePortalLink, revokeCasePortalLink, buildCasePortalUrl } from '../../lib/api/accidentPortal'
import { toUserMessage } from '../../lib/safeError'

const ELEVATED_ROLES = new Set(['Admin', 'Manager', 'Director'])

const EMPTY_FORM = { password: '', expires: '' }

/** Convert a chosen calendar date to an end-of-day ISO string (or null). */
function endOfDayIso(dateStr) {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T23:59:59`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export default function CasePortalShare({ accidentId }) {
  const { profile } = useAuth()
  const elevated = ELEVATED_ROLES.has(profile?.role) || profile?.is_super_admin === true

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null)      // { id, url } shown ONCE
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [msg, setMsg] = useState(null)              // { type:'ok'|'err', text }
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const copy = useCallback((text) => {
    if (!navigator.clipboard?.writeText) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (creating || !accidentId) return
    setCreating(true); setMsg(null); setCreated(null)
    try {
      const res = await createCasePortalLink(accidentId, {
        password: form.password.trim() || null,
        expires: endOfDayIso(form.expires),
      })
      if (res?.reason === 'not_provisioned') {
        setNotProvisioned(true)
        setShowForm(false)
        return
      }
      if (res?.token) {
        setCreated({ id: res.id, url: buildCasePortalUrl(res.token) })
        setMsg({ type: 'ok', text: 'External link created. Copy it now: anyone with the link can view this case, read only.' })
        setShowForm(false)
        setForm(EMPTY_FORM)
      } else {
        setMsg({ type: 'err', text: 'The external link was not created. Please try again.' })
      }
    } catch (err) {
      setMsg({ type: 'err', text: toUserMessage(err, 'Could not create the external link.') })
    } finally {
      setCreating(false)
    }
  }

  async function revoke() {
    if (!created?.id) return
    setRevoking(true); setMsg(null)
    try {
      const res = await revokeCasePortalLink(created.id)
      if (res?.reason === 'not_provisioned') {
        setNotProvisioned(true)
        setCreated(null)
        return
      }
      setCreated(null)
      setConfirmRevoke(false)
      setMsg({ type: 'ok', text: 'External link revoked. The URL stops working immediately.' })
    } catch (err) {
      setMsg({ type: 'err', text: toUserMessage(err, 'Could not revoke the external link.') })
    } finally {
      setRevoking(false)
    }
  }

  // Only elevated roles may mint an external portal link.
  if (!elevated) return null

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Globe size={15} className="text-[var(--accent)]" /> External insurer / authority link
        </h3>
        {!notProvisioned && !created && (
          <button
            type="button"
            onClick={() => { setShowForm((s) => !s); setMsg(null) }}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--accent)] text-white flex items-center gap-1.5 hover:opacity-90 transition-opacity"
          >
            {showForm ? <X size={13} /> : <Plus size={13} />}
            {showForm ? 'Cancel' : 'Create link'}
          </button>
        )}
      </div>

      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        Share a read-only view of this one case with an insurer or authority, no login required. They see the
        case status, severity, each team's progress and the claim status only. Driver details, notes, liability
        findings and every money figure stay private.
      </p>

      {notProvisioned ? (
        <div className="text-sm rounded-lg px-3 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] flex items-start gap-2">
          <AlertCircle size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
          <span>External portal is not yet activated (pending DB migration). This will be available once the accident portal is provisioned.</span>
        </div>
      ) : (
        <>
          {msg && (
            <div className={`text-sm rounded-lg px-3 py-2 flex items-center gap-2 ${msg.type === 'ok' ? 'bg-emerald-950/30 border border-emerald-800/40 text-emerald-300' : 'bg-red-900/25 border border-red-700/40 text-red-300'}`}>
              {msg.type === 'ok' ? <ShieldCheck size={15} /> : <AlertCircle size={15} />} {msg.text}
            </div>
          )}

          {/* One-time reveal of the full portal URL */}
          {created && (
            <div className="rounded-lg px-3 py-3 bg-[var(--input-bg)] border border-[var(--accent)] space-y-3">
              <p className="text-xs font-semibold text-[var(--accent)] flex items-center gap-1.5">
                <Globe size={13} /> Copy this link now. Anyone with the link can view this case, read only.
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={created.url}
                  className="flex-1 font-mono text-xs px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] truncate"
                />
                <button
                  type="button"
                  onClick={() => copy(created.url)}
                  className="p-2 rounded-md bg-[var(--accent)] text-white shrink-0 hover:opacity-90"
                  title="Copy link"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <a
                  href={created.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-muted)] shrink-0 hover:text-[var(--accent)]"
                  title="Open portal"
                >
                  <ExternalLink size={14} />
                </a>
              </div>
              {confirmRevoke ? (
                <div className="flex items-center justify-between gap-3 rounded-md px-2.5 py-2 bg-red-900/20 border border-red-700/40">
                  <span className="text-xs text-red-300">Revoke this link? The URL stops working immediately.</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={revoke}
                      disabled={revoking}
                      className="text-xs font-semibold px-2.5 py-1 rounded-md bg-red-600 text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {revoking ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Revoke
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRevoke(false)}
                      className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRevoke(true)}
                  className="text-xs font-semibold text-[var(--text-muted)] hover:text-red-400 flex items-center gap-1.5"
                >
                  <Trash2 size={13} /> Revoke this link
                </button>
              )}
            </div>
          )}

          {/* Create form */}
          {showForm && !created && (
            <form onSubmit={submit} className="rounded-lg px-3 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                    <Lock size={11} /> Password <span className="text-[var(--text-muted)] font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={form.password}
                    onChange={(e) => setF('password', e.target.value)}
                    placeholder="None"
                    className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">Leave blank for no password.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                    <Clock size={11} /> Expires <span className="text-[var(--text-muted)] font-normal">(optional)</span>
                  </label>
                  <input
                    type="date"
                    value={form.expires}
                    onChange={(e) => setF('expires', e.target.value)}
                    className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">Link stops working after this day.</p>
                </div>
              </div>
              <button
                type="submit"
                disabled={creating}
                className="w-full text-sm font-semibold px-3 py-2.5 rounded-lg bg-[var(--accent)] text-white flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Create external link
              </button>
            </form>
          )}
        </>
      )}
    </div>
  )
}
