/**
 * MobileAccessPanel.jsx - close (or open) the MOBILE app's modules for a ROLE or
 * a USER, from the web Access Manager.
 *
 * WHY SEPARATE: the main AccessManager tree is keyed on the WEB catalog
 * (src/lib/moduleCatalog.js). Its `mobile:` writes therefore used WEB keys
 * (`mobile:tyre_records`) which the mobile app never reads (its key is `records`).
 * This panel iterates the REAL mobile module keys (src/lib/mobileModules.js) so a
 * deny lands on `mobile:<mobileKey>` - the exact row the mobile app enforces via
 * resolveModuleAccess. It is deliberately self-contained (its own load + save)
 * so it does not entangle the web tree's elaborate draft/scope reconciliation.
 *
 * STORAGE (no schema change, reuses the surface-partitioned convention):
 *   - ROLE:  a `module_permissions` row  role + `mobile:<key>` + enabled (true/false),
 *            written via set_module_permissions (Admin / super only).
 *            Read by mobile get_user_module_permissions -> mobileRoleMatrixFromRaw.
 *   - USER:  a `user_access_grants` row on `mobile:<key>` effect grant|revoke,
 *            written via set_user_access_grant (super-admin only).
 *            Read by mobile get_my_access_grants -> mobileGrantsFromRaw.
 * The mobile precedence is: per-user grant > role matrix > client role default,
 * with admin / super-admin never lockable. So this panel's writes are authoritative.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Smartphone, Save, Loader2, RotateCcw, AlertTriangle, RefreshCw,
  Info, Check, X, Crown,
} from 'lucide-react'
import {
  MOBILE_MODULES, MOBILE_MODULES_BY_GROUP, mobileModuleDefaultAllows,
} from '../../../lib/mobileModules'
import { listGlobalPermissions, saveModulePermissions } from '../../../lib/api/modulePermissions'
import {
  listUserGrants, revokeUserAccessGrant, setUserAccessGrantScoped, mobileGrantKey,
} from '../../../lib/api/accessGrants'
import { toUserMessage } from '../../../lib/safeError'

const ALL_KEYS = MOBILE_MODULES.map((m) => m.key)

/** Index a user's grant rows to the mobile-view effect + id per mobile key. */
function indexMobileGrants(rows) {
  const idx = {}
  for (const r of rows || []) {
    const key = r?.module_key
    if (typeof key !== 'string' || !key.startsWith('mobile:')) continue
    if ((r.capability || 'view') !== 'view') continue
    const mobKey = key.slice('mobile:'.length)
    ;(idx[mobKey] ||= {})[r.effect] = r.id
  }
  return idx
}

export default function MobileAccessPanel({ mode, role, user, canWriteRole, canWriteUser }) {
  const isUser = mode === 'user'
  const subjectRole = isUser ? user?.role : role
  const isSuperSubject = isUser && user?.is_super_admin === true
  // Admin / super-admin are always fully allowed on mobile (never lockable).
  const alwaysAllowed = subjectRole === 'Admin' || isSuperSubject

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [roleDefaults, setRoleDefaults] = useState({}) // key -> role-effective ON
  const [baseline, setBaseline] = useState({})         // key -> current effective ON
  const [draft, setDraft] = useState({})               // key -> edited ON
  const [grantIdx, setGrantIdx] = useState({})         // user mode only
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const flashTimer = useRef(null)
  const flash = useCallback((msg, isError = false) => {
    if (isError) { setErrorMsg(msg); setNotice('') } else { setNotice(msg); setErrorMsg('') }
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => { setNotice(''); setErrorMsg('') }, 6000)
  }, [])
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  const readOnly = isUser ? !canWriteUser : !canWriteRole

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (isUser && !user) { setLoading(false); return }
    setLoading(true); setLoadError('')
    try {
      const vm = await listGlobalPermissions()
      const roleRows = (vm && vm[subjectRole]) || {}
      // role-effective default per module: an explicit mobile: role row wins,
      // else the client-side role default (moduleAllowedByRole mirror).
      const rd = {}
      for (const key of ALL_KEYS) {
        const rowKey = mobileGrantKey(key)
        rd[key] = Object.prototype.hasOwnProperty.call(roleRows, rowKey)
          ? roleRows[rowKey] === true
          : mobileModuleDefaultAllows(key, subjectRole)
      }
      setRoleDefaults(rd)

      if (isUser) {
        const rows = await listUserGrants(user.id)
        const idx = indexMobileGrants(rows)
        setGrantIdx(idx)
        const eff = {}
        for (const key of ALL_KEYS) {
          if (alwaysAllowed) { eff[key] = true; continue }
          const g = idx[key] || {}
          eff[key] = g.revoke ? false : g.grant ? true : rd[key]
        }
        setBaseline(eff)
        setDraft({ ...eff })
      } else {
        const eff = {}
        for (const key of ALL_KEYS) eff[key] = alwaysAllowed ? true : rd[key]
        setBaseline(eff)
        setDraft({ ...eff })
      }
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load mobile access.'))
    } finally {
      setLoading(false)
    }
  }, [isUser, user, subjectRole, alwaysAllowed])

  useEffect(() => { load() }, [load])

  // ── Dirty ─────────────────────────────────────────────────────────────────
  const dirtyKeys = useMemo(() => {
    const s = new Set()
    for (const key of ALL_KEYS) if (draft[key] !== baseline[key]) s.add(key)
    return s
  }, [draft, baseline])
  const dirtyCount = dirtyKeys.size

  const toggle = useCallback((key) => {
    if (readOnly || alwaysAllowed) return
    setDraft((d) => ({ ...d, [key]: !d[key] }))
  }, [readOnly, alwaysAllowed])

  const setAll = useCallback((on) => {
    if (readOnly || alwaysAllowed) return
    setDraft(() => Object.fromEntries(ALL_KEYS.map((k) => [k, on])))
  }, [readOnly, alwaysAllowed])

  const resetToRoleDefault = useCallback(() => {
    if (readOnly || alwaysAllowed) return
    setDraft(() => ({ ...roleDefaults }))
  }, [readOnly, alwaysAllowed, roleDefaults])

  const discard = useCallback(() => {
    setDraft({ ...baseline }); setNotice(''); setErrorMsg('')
  }, [baseline])

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (dirtyCount === 0 || saving || alwaysAllowed) return
    setSaving(true); setErrorMsg(''); setNotice('')
    try {
      if (isUser) {
        if (!canWriteUser) throw new Error('Only a Super Admin can change per-user access.')
        let writes = 0, deletes = 0
        for (const key of dirtyKeys) {
          const desired = draft[key] === true
          const base = roleDefaults[key] === true
          const ex = grantIdx[key] || {}
          if (desired === base) {
            // matches the role default -> no override needed: drop any grant.
            if (ex.grant) { await revokeUserAccessGrant(ex.grant); deletes += 1 }
            if (ex.revoke) { await revokeUserAccessGrant(ex.revoke); deletes += 1 }
          } else {
            const want = desired ? 'grant' : 'revoke'
            const opp = desired ? 'revoke' : 'grant'
            if (ex[opp]) { await revokeUserAccessGrant(ex[opp]); deletes += 1 }
            if (!ex[want]) {
              await setUserAccessGrantScoped(user.id, key, { capability: 'view', effect: want, scope: 'mobile' })
              writes += 1
            }
          }
        }
        const rows = await listUserGrants(user.id)
        const idx = indexMobileGrants(rows)
        setGrantIdx(idx)
        const eff = {}
        for (const key of ALL_KEYS) {
          const g = idx[key] || {}
          eff[key] = g.revoke ? false : g.grant ? true : roleDefaults[key]
        }
        setBaseline(eff); setDraft({ ...eff })
        flash(`Saved. ${writes} mobile override${writes !== 1 ? 's' : ''} set, ${deletes} reset. Applies on the person's next app load.`)
      } else {
        if (!canWriteRole) throw new Error('Only an Admin can change role access.')
        const changes = []
        for (const key of dirtyKeys) {
          changes.push({ role: subjectRole, module_key: mobileGrantKey(key), enabled: draft[key] === true })
        }
        if (changes.length) await saveModulePermissions(changes)
        // refresh from DB so baseline reflects the stored rows
        const vm = await listGlobalPermissions()
        const roleRows = (vm && vm[subjectRole]) || {}
        const eff = {}
        for (const key of ALL_KEYS) {
          const rowKey = mobileGrantKey(key)
          eff[key] = Object.prototype.hasOwnProperty.call(roleRows, rowKey)
            ? roleRows[rowKey] === true
            : mobileModuleDefaultAllows(key, subjectRole)
        }
        setRoleDefaults(eff); setBaseline(eff); setDraft({ ...eff })
        flash(`Saved. ${changes.length} mobile change${changes.length !== 1 ? 's' : ''} for ${subjectRole}. Applies on each user's next app load.`)
      }
    } catch (err) {
      flash(toUserMessage(err, 'Could not save mobile access. Your edits are still here, try again.'), true)
    } finally {
      setSaving(false)
    }
  }, [dirtyCount, dirtyKeys, saving, alwaysAllowed, isUser, canWriteUser, canWriteRole, draft, roleDefaults, grantIdx, user, subjectRole, flash])

  // ── Render ────────────────────────────────────────────────────────────────
  const enabledCount = ALL_KEYS.filter((k) => draft[k]).length

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--input-border)] bg-[var(--surface-1)]">
        <Smartphone size={16} className="text-[var(--brand-bright)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Mobile app access</h3>
        {!loading && !alwaysAllowed && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {enabledCount} of {ALL_KEYS.length} on
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {!readOnly && !alwaysAllowed && (
            <>
              <button onClick={() => setAll(true)} disabled={saving} className="btn-secondary text-[11px] px-2 py-1 disabled:opacity-40" title="Turn every mobile module on">All on</button>
              <button onClick={() => setAll(false)} disabled={saving} className="btn-secondary text-[11px] px-2 py-1 disabled:opacity-40" title="Turn every mobile module off">All off</button>
              <button onClick={resetToRoleDefault} disabled={saving} className="btn-secondary text-[11px] px-2 py-1 inline-flex items-center gap-1 disabled:opacity-40" title="Reset to the role default"><RotateCcw size={11} /> Default</button>
            </>
          )}
          <button onClick={load} disabled={saving} className="btn-secondary text-[11px] px-2 py-1 inline-flex items-center gap-1 disabled:opacity-40" title="Reload"><RefreshCw size={11} /></button>
        </div>
      </div>

      <div className="flex items-start gap-2 px-4 py-2.5 text-[11px] text-[var(--text-muted)] border-b border-[var(--input-border)]">
        <Info size={12} className="mt-0.5 shrink-0" />
        <p>
          Controls what {isUser ? 'this person' : `the ${subjectRole || 'role'}`} sees in the phone app only, separate from web access.
          Turning a module off hides it in the mobile app on the user's next load. Web access is unchanged.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
          <Loader2 size={18} className="animate-spin mr-2 text-[var(--brand-bright)]" /> Loading mobile access...
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
          <AlertTriangle size={22} className="text-red-400" />
          <p className="text-sm text-red-300">{loadError}</p>
          <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw size={14} /> Retry</button>
        </div>
      ) : alwaysAllowed ? (
        <div className="flex items-start gap-2 px-4 py-4 text-xs text-amber-200">
          <Crown size={14} className="mt-0.5 shrink-0 text-amber-400" />
          {isSuperSubject
            ? 'This user is a Super Admin and always has full mobile access. It cannot be limited here.'
            : 'Admin always has full mobile access. Edits here do not apply to Admin.'}
        </div>
      ) : (
        <div className="divide-y divide-[var(--input-border)]/60">
          {MOBILE_MODULES_BY_GROUP.map(({ group, modules }) => (
            <div key={group}>
              <div className="px-4 py-1.5 bg-[var(--surface-1)]/60 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{group}</div>
              {modules.map((m) => {
                const on = draft[m.key] === true
                const changed = dirtyKeys.has(m.key)
                const roleDef = roleDefaults[m.key] === true
                const overridesRole = isUser && on !== roleDef
                return (
                  <div key={m.key} className={`flex items-center gap-3 px-4 py-2 ${changed ? 'bg-[var(--brand-subtle,rgba(34,197,94,0.08))]' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[var(--text-primary)] truncate">
                        {m.label}
                        {overridesRole && <span className="ml-2 text-[10px] text-amber-300">overrides role</span>}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Role default: {roleDef ? 'On' : 'Off'}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${m.label} mobile access`}
                      disabled={readOnly || saving}
                      onClick={() => toggle(m.key)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                        on ? 'bg-[var(--brand,#16a34a)]' : 'bg-[var(--input-border)]'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Save bar */}
      {!loading && !alwaysAllowed && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--input-border)] bg-[var(--surface-1)]/60">
          {notice && <span className="text-xs text-green-300 inline-flex items-center gap-1"><Check size={13} /> {notice}</span>}
          {errorMsg && <span className="text-xs text-red-300 inline-flex items-center gap-1"><AlertTriangle size={13} /> {errorMsg}</span>}
          {!notice && !errorMsg && (
            <span className="text-xs text-[var(--text-muted)]">
              {dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount !== 1 ? 's' : ''}` : 'No changes'}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {dirtyCount > 0 && !readOnly && (
              <button onClick={discard} disabled={saving} className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-40"><X size={13} /> Discard</button>
            )}
            <button
              onClick={save}
              disabled={readOnly || saving || dirtyCount === 0}
              className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save mobile access
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
