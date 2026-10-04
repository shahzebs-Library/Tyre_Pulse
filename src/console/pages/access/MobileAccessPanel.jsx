/**
 * MobileAccessPanel.jsx - close (or open) the Flutter field app's modules for a
 * ROLE or a USER, from the web Access Manager. The module list mirrors
 * tyre_pulse_flutter/lib/core/permissions/module_registry.dart (see
 * src/lib/mobileModules.js); the retired Expo app is no longer the target.
 *
 * WHY SEPARATE: the main AccessManager tree is keyed on the WEB catalog
 * (src/lib/moduleCatalog.js). Its `mobile:` writes therefore used WEB keys
 * (`mobile:tyre_records`), which the Flutter app reads only through its small
 * webModuleKeyAliases table (its own key is `records`).
 * This panel iterates the REAL mobile module keys (src/lib/mobileModules.js) so a
 * deny lands on `mobile:<mobileKey>` - the exact row the Flutter app enforces via
 * core/permissions/access_resolver.dart. It is deliberately self-contained (its own load + save)
 * so it does not entangle the web tree's elaborate draft/scope reconciliation.
 *
 * STORAGE (no schema change, reuses the surface-partitioned convention):
 *   - ROLE:  a `module_permissions` row  role + `mobile:<key>` + enabled (true/false),
 *            written via set_module_permissions (Admin / super only).
 *            Read by the Flutter app via get_user_module_permissions.
 *   - USER:  a `user_access_grants` row on `mobile:<key>` effect grant|revoke,
 *            written via set_user_access_grant (super-admin only).
 *            Read by the Flutter app via get_my_access_grants.
 * The Flutter app's precedence is: per-user grant > role matrix > client role default,
 * with admin / super-admin never lockable. So this panel's writes are authoritative.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Smartphone, Save, RotateCcw, RefreshCw, Check, X, Crown } from 'lucide-react'
import {
  MOBILE_MODULES, MOBILE_MODULES_BY_GROUP, mobileModuleDefaultAllows,
} from '../../../lib/mobileModules'
import { listGlobalPermissions, saveModulePermissions } from '../../../lib/api/modulePermissions'
import {
  listUserGrants, revokeUserAccessGrant, setUserAccessGrantScoped, mobileGrantKey,
} from '../../../lib/api/accessGrants'
import { toUserMessage } from '../../../lib/safeError'
import { Badge, Btn, ErrorState, LoadingState, Note, Panel, PanelHeader } from '../../components/ui'

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

  // A success note fades; an error stays until the next action so it cannot be
  // missed while the edits it refers to are still on screen.
  const flashTimer = useRef(null)
  const flash = useCallback((msg, isError = false) => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    if (isError) { setErrorMsg(msg); setNotice(''); return }
    setNotice(msg); setErrorMsg('')
    flashTimer.current = setTimeout(() => setNotice(''), 6000)
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
    <Panel flush className="overflow-hidden">
      <div className="px-4 pt-3 border-b border-gray-800">
        <PanelHeader icon={Smartphone} title="Mobile app access"
          subtitle={loading || loadError || alwaysAllowed ? 'Flutter field app only, separate from web access' : `${enabledCount} of ${ALL_KEYS.length} modules on`}
          actions={(
            <>
              {!readOnly && !alwaysAllowed && !loading && !loadError && (
                <>
                  <Btn size="xs" onClick={() => setAll(true)} disabled={saving} title="Turn every mobile module on">All on</Btn>
                  <Btn size="xs" onClick={() => setAll(false)} disabled={saving} title="Turn every mobile module off">All off</Btn>
                  <Btn size="xs" icon={RotateCcw} onClick={resetToRoleDefault} disabled={saving} title="Reset to the role default">Default</Btn>
                </>
              )}
              <Btn size="xs" icon={RefreshCw} onClick={load} disabled={saving} busy={loading} title="Reload" ariaLabel="Reload mobile access" />
            </>
          )} />
      </div>

      <div className="px-4 py-2.5 border-b border-gray-800">
        <p className="text-[11px] text-gray-400">
          Controls what {isUser ? 'this person' : `the ${subjectRole || 'role'}`} sees in the Flutter field app only. Turning a module
          off hides it in the Flutter app the next time it loads access (sign-in or return to the app). Web access is unchanged.
        </p>
      </div>

      {loading ? (
        <div className="px-4"><LoadingState label="Loading mobile access" rows={4} /></div>
      ) : loadError ? (
        <div className="p-4"><ErrorState message={loadError} onRetry={load} /></div>
      ) : alwaysAllowed ? (
        <div className="p-4">
          <Note tone="warning" icon={Crown}>
            {isSuperSubject
              ? 'This user is a Super Admin and always has full mobile access. It cannot be limited here.'
              : 'Admin always has full mobile access. Edits here do not apply to Admin.'}
          </Note>
        </div>
      ) : (
        <div className="divide-y divide-gray-800/60">
          {MOBILE_MODULES_BY_GROUP.map(({ group, modules }) => (
            <div key={group} role="group" aria-label={group}>
              <div className="px-4 py-1.5 bg-gray-900/60 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{group}</div>
              {modules.map((m) => {
                const on = draft[m.key] === true
                const changed = dirtyKeys.has(m.key)
                const roleDef = roleDefaults[m.key] === true
                const overridesRole = isUser && on !== roleDef
                return (
                  <div key={m.key} className={`flex items-center gap-3 px-4 py-2 ${changed ? 'bg-orange-950/20' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-100 truncate flex items-center gap-2">
                        {m.label}
                        {overridesRole && <Badge tone="warning">Overrides role</Badge>}
                        {changed && <Badge tone="accent">Unsaved</Badge>}
                      </p>
                      <p className="text-[11px] text-gray-400">Role default: {roleDef ? 'On' : 'Off'}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${m.label} mobile access`}
                      disabled={readOnly || saving}
                      onClick={() => toggle(m.key)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                        on ? 'bg-orange-500' : 'bg-gray-700'
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
      {!loading && !loadError && !alwaysAllowed && (
        <div className="px-4 py-3 border-t border-gray-800 bg-gray-900/40 space-y-2">
          {errorMsg && <ErrorState message={errorMsg} />}
          <div className="flex flex-wrap items-center gap-2">
            {notice ? (
              <span role="status" className="text-xs text-emerald-300 inline-flex items-center gap-1"><Check size={13} aria-hidden="true" /> {notice}</span>
            ) : (
              <span className="text-xs text-gray-400">
                {readOnly ? 'Read only for your account.' : dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount !== 1 ? 's' : ''}` : 'No changes'}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {dirtyCount > 0 && !readOnly && (
                <Btn icon={X} onClick={discard} disabled={saving}>Discard</Btn>
              )}
              <Btn variant="primary" icon={Save} onClick={save} busy={saving} disabled={readOnly || dirtyCount === 0}>
                Save mobile access
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}
