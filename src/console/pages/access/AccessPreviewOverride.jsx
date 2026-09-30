/**
 * AccessPreviewOverride.jsx - the super-admin self-service "Preview and Override"
 * screen inside the console Access Control host.
 *
 * The operator picks a subject - either a ROLE or an individual USER - and sees
 * exactly which modules that subject can reach today (a preview of their sidebar)
 * grouped by product workspace, with the reason behind every allow/deny. From the
 * same rows the operator can force ALLOW or DENY on any module in one click, with
 * no dependency on anyone else:
 *
 *   - USER subject  -> per-user grant/revoke via accessGrants
 *     (set_user_access_grant / revoke_user_access_grant). Allow = grant,
 *     Deny = revoke, Clear = remove the override (falls back to the role).
 *     A grant and a revoke row for one module can coexist and always resolve to
 *     revoke, so every flip is reconciled through planUserOverrideWrite: it
 *     deletes the opposite effect on Allow/Deny and every matching row on Clear,
 *     leaving exactly one effective row.
 *   - ROLE subject  -> the role x module baseline via saveModulePermissions
 *     (set_module_permissions). Allow/Deny flips module_permissions.enabled.
 *
 * Admin and Super Admin subjects always resolve to full access and cannot be
 * reduced, so their override controls are disabled with an honest note.
 *
 * Every mutation re-reads the authoritative source (getEffectiveAccess for a
 * user, listGlobalPermissions for a role) so the preview updates live. All data
 * is real - honest loading, empty and error states, no fabrication.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SlidersHorizontal, Users, KeyRound, RefreshCw, Crown, CheckCircle2, XCircle, ShieldCheck, Globe,
  ChevronRight, Check, Ban, RotateCcw,
} from 'lucide-react'

import { ACCESS_ROLES } from '../../../lib/moduleCatalog'
import {
  ACCESS_MODULE_GROUPS as MODULE_GROUPS, ACCESS_MODULES as ALL_MODULES, ACCESS_MODULE_LABEL as MODULE_LABEL,
} from '../../../lib/accessCatalog'
import { listProfiles } from '../../../lib/api/users'
import { getEffectiveAccess } from '../../../lib/api/adminAccess'
import {
  listUserGrants, setUserAccessGrant, revokeUserAccessGrant, planUserOverrideWrite,
} from '../../../lib/api/accessGrants'
import { listGlobalPermissions, saveModulePermissions } from '../../../lib/api/modulePermissions'
import { toUserMessage } from '../../../lib/safeError'
import UserDirectory, { displayName } from './UserDirectory'
import {
  Badge, Btn, EmptyState, ErrorState, LoadingState, Modal, Note, Panel, PanelHeader, SearchInput, Segmented,
  StatTile, Toolbar,
} from '../../components/ui'

const FULL_ACCESS_ROLES = new Set(['Admin'])

// Roles that see every country regardless of their profiles.country array.
// DB app_can_see_country grants all-countries only to super/Admin; Director is scoped.
const COUNTRY_SEES_ALL_ROLES = new Set(['Admin'])

const MODULE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'allowed', label: 'Allowed' },
  { key: 'denied', label: 'Denied' },
  { key: 'overridden', label: 'Overridden' },
]

// Honest country label under the new scope semantics: admins/super (and the
// see-all roles) see every country; an "all"/"*" sentinel grants every country;
// otherwise a non-admin sees only the listed countries, and an empty array is
// no country access.
function countryLabel(country, seesAll) {
  const arr = Array.isArray(country) ? country.filter(Boolean) : [country].filter(Boolean)
  const isAll = arr.some((c) => ['ALL', '*'].includes(String(c ?? '').trim().toUpperCase()))
  if (seesAll || isAll) return 'All countries'
  return arr.length ? arr.join(', ') : 'No country access'
}

export default function AccessPreviewOverride() {
  const [mode, setMode] = useState('user') // 'user' | 'role'

  // Result of the last override. A success fades; an error stays on screen
  // until the next action so it cannot be missed.
  const [result, setResult] = useState(null) // { kind: 'success'|'error', message }
  const resultTimer = useRef(null)
  const pushToast = useCallback((kind, message) => {
    if (resultTimer.current) clearTimeout(resultTimer.current)
    setResult({ kind, message })
    if (kind === 'success') resultTimer.current = setTimeout(() => setResult(null), 5000)
  }, [])
  useEffect(() => () => { if (resultTimer.current) clearTimeout(resultTimer.current) }, [])
  const [moduleSearch, setModuleSearch] = useState('')
  const [confirmRoleDeny, setConfirmRoleDeny] = useState(null) // row pending a role-wide deny

  // ----- Users (for the "By User" subject picker) -----
  const [users, setUsers] = useState(null) // null = loading
  const [usersError, setUsersError] = useState('')
  const [usersRefreshing, setUsersRefreshing] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState(null)

  const loadUsers = useCallback(async () => {
    setUsersRefreshing(true); setUsersError('')
    try {
      const rows = await listProfiles()
      setUsers(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setUsersError(toUserMessage(err, 'Could not load the user directory.'))
      setUsers([])
    } finally {
      setUsersRefreshing(false)
    }
  }, [])

  // ----- Role permission baseline (for the "By Role" subject + its preview) -----
  const [permMap, setPermMap] = useState(null) // null = loading
  const [permError, setPermError] = useState('')
  const [permRefreshing, setPermRefreshing] = useState(false)
  const [selectedRole, setSelectedRole] = useState(null)

  const loadPerms = useCallback(async () => {
    setPermRefreshing(true); setPermError('')
    try {
      const map = await listGlobalPermissions()
      setPermMap(map && typeof map === 'object' ? map : {})
    } catch (err) {
      setPermError(toUserMessage(err, 'Could not load the role permission matrix.'))
      setPermMap({})
    } finally {
      setPermRefreshing(false)
    }
  }, [])

  // Load the source that the active mode needs, once.
  useEffect(() => {
    if (mode === 'user' && users === null && !usersError) loadUsers()
    if (mode === 'role' && permMap === null && !permError) loadPerms()
  }, [mode, users, usersError, permMap, permError, loadUsers, loadPerms])

  // ----- User effective access + that user's grants (for override Clear ids) -----
  const [access, setAccess] = useState(null) // null = loading (when a user is selected)
  const [accessError, setAccessError] = useState('')
  const [grants, setGrants] = useState([])
  const [moduleFilter, setModuleFilter] = useState('all')
  const [busyKey, setBusyKey] = useState('') // module currently being mutated

  const selectedUser = useMemo(
    () => (users || []).find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId],
  )

  const loadAccess = useCallback(async (userId) => {
    if (!userId) { setAccess(null); setGrants([]); return }
    setAccess(null); setAccessError('')
    try {
      const [data, grantRows] = await Promise.all([
        getEffectiveAccess(userId),
        // Not swallowed: an override write plans its deletes from these rows,
        // so an unread list would silently leave the opposite row behind.
        listUserGrants(userId),
      ])
      setAccess(data && typeof data === 'object' ? data : { modules: [] })
      setGrants(Array.isArray(grantRows) ? grantRows : [])
    } catch (err) {
      setAccessError(toUserMessage(err, 'Could not resolve effective access for this user.'))
      setAccess({ modules: [] })
      setGrants([])
    }
  }, [])

  useEffect(() => {
    if (mode === 'user') loadAccess(selectedUserId)
  }, [mode, selectedUserId, loadAccess])

  // Role list = catalog roles plus any live/custom roles present in the matrix.
  const roleOptions = useMemo(() => {
    const set = new Set(ACCESS_ROLES)
    for (const r of Object.keys(permMap || {})) if (r) set.add(r)
    return Array.from(set)
  }, [permMap])

  // ---- Normalised preview rows (uniform shape for both modes) ----
  const isSuperSubject = mode === 'user'
    ? (!!access?.is_super || !!selectedUser?.is_super_admin)
    : false
  const isFullRole = mode === 'role' && selectedRole && FULL_ACCESS_ROLES.has(selectedRole)
  const overridesLocked = isSuperSubject || isFullRole

  const previewRows = useMemo(() => {
    if (mode === 'user') {
      if (!access) return null
      const byKey = new Map((access.modules || []).map((m) => [m.key, m]))
      return ALL_MODULES.map((mod) => {
        const m = byKey.get(mod.key)
        const final = m ? !!m.final : false
        return {
          key: mod.key,
          group: mod.group,
          label: MODULE_LABEL[mod.key] || mod.key,
          allowed: isSuperSubject ? true : final,
          override: m?.override || null, // 'grant' | 'revoke' | null
          reason: isSuperSubject
            ? 'Super admin bypasses all gates'
            : (m?.reason || (final ? 'Allowed' : 'Denied by default')),
        }
      })
    }
    // role mode
    if (!permMap || !selectedRole) return null
    const roleMap = permMap[selectedRole] || {}
    return ALL_MODULES.map((mod) => {
      const enabled = isFullRole ? true : roleMap[mod.key] === true
      return {
        key: mod.key,
        group: mod.group,
        label: MODULE_LABEL[mod.key] || mod.key,
        allowed: enabled,
        override: null,
        reason: isFullRole
          ? 'Admin always has full access'
          : (enabled ? 'Role allows this module' : 'Denied by default (role has no access)'),
      }
    })
  }, [mode, access, permMap, selectedRole, isSuperSubject, isFullRole])

  const counts = useMemo(() => {
    const rows = previewRows || []
    let allowed = 0, denied = 0, overridden = 0
    for (const r of rows) {
      if (r.allowed) allowed += 1; else denied += 1
      if (r.override) overridden += 1
    }
    return { allowed, denied, overridden, total: rows.length }
  }, [previewRows])

  const visibleGroups = useMemo(() => {
    if (!previewRows) return []
    const q = moduleSearch.trim().toLowerCase()
    const filtered = previewRows.filter((r) => {
      if (moduleFilter === 'allowed' && !r.allowed) return false
      if (moduleFilter === 'denied' && r.allowed) return false
      if (moduleFilter === 'overridden' && !r.override) return false
      if (q && !`${r.label} ${r.key} ${r.reason}`.toLowerCase().includes(q)) return false
      return true
    })
    return MODULE_GROUPS
      .map((g) => ({ group: g.group, rows: filtered.filter((r) => r.group === g.group) }))
      .filter((g) => g.rows.length > 0)
  }, [previewRows, moduleFilter, moduleSearch])

  // ---- Override actions ----
  const applyUserOverride = useCallback(async (row, action) => {
    if (!selectedUserId || overridesLocked) return
    setBusyKey(row.key)
    try {
      // A grant and a revoke row for the same module can coexist (the grant table
      // is unique on user+module+capability+EFFECT, and set_user_access_grant
      // upserts on that same key), and every reader resolves such a pair as
      // revoke. So flipping an override must also delete the opposite effect,
      // and Clear must delete EVERY matching row, not just the first one.
      const { effect, deleteIds } = planUserOverrideWrite(grants, row.key, { capability: 'view', action })
      if (action === 'clear') {
        for (const id of deleteIds) await revokeUserAccessGrant(id)
        pushToast('success', `Cleared the override on ${row.label}. It now follows the role.`)
      } else {
        // Write the wanted effect BEFORE dropping the opposite one: a grant plus
        // revoke pair resolves to revoke, so this order can never open access
        // mid-flight if a later call fails.
        await setUserAccessGrant({ userId: selectedUserId, moduleKey: row.key, capability: 'view', effect })
        for (const id of deleteIds) await revokeUserAccessGrant(id)
        pushToast('success', `${action === 'grant' ? 'Allowed' : 'Denied'} ${row.label} for ${displayName(selectedUser)}.`)
      }
      await loadAccess(selectedUserId)
    } catch (err) {
      pushToast('error', toUserMessage(err, 'Could not apply the override.'))
    } finally {
      setBusyKey('')
    }
  }, [selectedUserId, overridesLocked, grants, pushToast, selectedUser, loadAccess])

  const applyRoleOverride = useCallback(async (row, enabled) => {
    if (!selectedRole || overridesLocked) return
    setBusyKey(row.key)
    try {
      await saveModulePermissions([{ role: selectedRole, module_key: row.key, enabled }])
      pushToast('success', `${enabled ? 'Allowed' : 'Denied'} ${row.label} for the ${selectedRole} role.`)
      await loadPerms()
    } catch (err) {
      pushToast('error', toUserMessage(err, 'Could not update the role permission.'))
    } finally {
      setBusyKey('')
    }
  }, [selectedRole, overridesLocked, pushToast, loadPerms])

  const subjectChosen = mode === 'user' ? !!selectedUser : !!selectedRole
  const previewError = mode === 'user' ? accessError : permError
  const statsReady = !!previewRows && !previewError
  const stat = (v) => (statsReady ? v : 'N/A')

  // A role-wide deny changes access for everyone holding the role, so it is
  // confirmed first. Allow and every per-user change stay one click.
  const onRoleOverride = useCallback((row, enabled) => {
    if (!enabled) { setConfirmRoleDeny(row); return }
    applyRoleOverride(row, true)
  }, [applyRoleOverride])

  return (
    <div className="space-y-4">
      <Note icon={SlidersHorizontal}>
        Pick a role or a single user, preview exactly which modules they can reach (their sidebar), and
        force allow or deny on any module. User changes are per-user grants; role changes update the role
        baseline for everyone with that role. Changes reach an affected user on their next refresh.
      </Note>

      <Segmented ariaLabel="Subject type" size="md" value={mode} onChange={setMode}
        options={[
          { key: 'user', label: <><Users size={14} aria-hidden="true" />By user</> },
          { key: 'role', label: <><KeyRound size={14} aria-hidden="true" />By role</> },
        ]} />

      {result && (
        result.kind === 'error'
          ? <ErrorState message={result.message} />
          : <div role="status"><Note tone="accent" icon={Check}>{result.message}</Note></div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-4">
        {mode === 'user' ? (
          <UserDirectory users={users} error={usersError} onRetry={loadUsers} refreshing={usersRefreshing}
            selectedId={selectedUserId} onSelect={setSelectedUserId} />
        ) : (
          <RolePicker
            permMap={permMap}
            error={permError}
            refreshing={permRefreshing}
            onRefresh={loadPerms}
            roleOptions={roleOptions}
            selectedRole={selectedRole}
            onSelect={setSelectedRole}
          />
        )}

        <div className="min-w-0">
          {!subjectChosen ? (
            <Panel>
              <EmptyState icon={SlidersHorizontal} title={`Pick a ${mode === 'user' ? 'user' : 'role'} to preview`}
                reason={`Choose a ${mode === 'user' ? 'user from the directory' : 'role from the list'} to see which modules they can reach, then allow or deny any module.`} />
            </Panel>
          ) : (
            <div className="space-y-4">
              <Panel>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-gray-800 flex items-center justify-center shrink-0 text-sm font-semibold text-gray-300" aria-hidden="true">
                    {mode === 'user'
                      ? displayName(selectedUser).slice(0, 2).toUpperCase()
                      : <KeyRound size={18} className="text-orange-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-gray-100 flex items-center gap-1.5">
                      {mode === 'user' ? displayName(selectedUser) : `${selectedRole} role`}
                      {overridesLocked && <Crown size={14} className="text-amber-400" aria-label="Full access" />}
                    </h3>
                    <p className="text-xs text-gray-400 truncate">
                      {mode === 'user'
                        ? (selectedUser.email || selectedUser.username || 'No email')
                        : 'Baseline access for every user with this role'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {mode === 'user' && (
                      <>
                        <Badge icon={ShieldCheck}>{access?.role || selectedUser.role || 'No role'}</Badge>
                        <Badge icon={Globe}>{countryLabel(
                          access?.country ?? selectedUser.country,
                          isSuperSubject || COUNTRY_SEES_ALL_ROLES.has(access?.role || selectedUser.role),
                        )}</Badge>
                      </>
                    )}
                    {overridesLocked && <Badge tone="warning" icon={Crown}>Full access</Badge>}
                  </div>
                </div>
              </Panel>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile label="Modules" value={stat(counts.total)} onClick={() => setModuleFilter('all')} active={moduleFilter === 'all'} />
                <StatTile label="Allowed" tone="good" value={stat(counts.allowed)} onClick={() => setModuleFilter('allowed')} active={moduleFilter === 'allowed'} />
                <StatTile label="Denied" tone="danger" value={stat(counts.denied)} onClick={() => setModuleFilter('denied')} active={moduleFilter === 'denied'} />
                {mode === 'user' ? (
                  <StatTile label="Overridden" tone="warning" value={stat(counts.overridden)} sub="Per-user grant or revoke"
                    onClick={() => setModuleFilter('overridden')} active={moduleFilter === 'overridden'} />
                ) : (
                  <StatTile label="Coverage" tone="accent" sub="Share of modules allowed"
                    value={statsReady && counts.total ? `${Math.round((counts.allowed / counts.total) * 100)}%` : 'N/A'} />
                )}
              </div>

              {overridesLocked && (
                <Note tone="warning" icon={Crown}>
                  Admin and Super Admin always have full access and cannot be reduced. Overrides are disabled for this subject.
                </Note>
              )}

              <Toolbar>
                <Segmented role="group" ariaLabel="Show modules" value={moduleFilter} onChange={setModuleFilter}
                  options={MODULE_FILTERS.filter((f) => mode === 'user' || f.key !== 'overridden').map((f) => ({ key: f.key, label: f.label }))} />
                <SearchInput value={moduleSearch} onChange={setModuleSearch} placeholder="Search module or reason" className="flex-1 min-w-[180px]" />
              </Toolbar>

              {previewRows === null && !previewError ? (
                <Panel><LoadingState label="Resolving access" rows={5} /></Panel>
              ) : previewError ? (
                <ErrorState message={previewError} onRetry={mode === 'user' ? () => loadAccess(selectedUserId) : loadPerms} />
              ) : visibleGroups.length === 0 ? (
                <Panel><EmptyState icon={SlidersHorizontal} title="No modules match" reason="Nothing matches this filter and search." /></Panel>
              ) : (
                <div className="space-y-4">
                  {visibleGroups.map((g) => (
                    <Panel key={g.group} flush className="overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-gray-800 bg-gray-900/60">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-300">{g.group}</h4>
                      </div>
                      <ul>
                        {g.rows.map((row) => (
                          <ModuleRow
                            key={row.key}
                            row={row}
                            mode={mode}
                            locked={overridesLocked}
                            busy={busyKey === row.key}
                            onUserOverride={applyUserOverride}
                            onRoleOverride={onRoleOverride}
                          />
                        ))}
                      </ul>
                    </Panel>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!confirmRoleDeny}
        title="Deny this module for the whole role?"
        subtitle={confirmRoleDeny ? `${confirmRoleDeny.label} for ${selectedRole}` : undefined}
        onClose={() => { if (!busyKey) setConfirmRoleDeny(null) }}
        width="max-w-md"
        footer={(
          <>
            <Btn onClick={() => setConfirmRoleDeny(null)} disabled={!!busyKey}>Cancel</Btn>
            <Btn variant="danger" icon={Ban} busy={!!busyKey}
              onClick={async () => { const row = confirmRoleDeny; await applyRoleOverride(row, false); setConfirmRoleDeny(null) }}>
              Deny for role
            </Btn>
          </>
        )}
      >
        <p className="text-sm text-gray-300">
          Every user with the {selectedRole} role loses access to this module on their next refresh, unless they
          hold a per-user grant. You can allow it again at any time.
        </p>
      </Modal>
    </div>
  )
}

/* ---------------- Subpanels ---------------- */

function RolePicker({ permMap, error, refreshing, onRefresh, roleOptions, selectedRole, onSelect }) {
  return (
    <Panel flush className="overflow-hidden flex flex-col max-h-[76vh]">
      <div className="p-3 border-b border-gray-800">
        <PanelHeader icon={KeyRound} title="Roles" subtitle={permMap && !error ? `${roleOptions.length} roles` : undefined}
          actions={<Btn size="xs" variant="quiet" icon={RefreshCw} busy={refreshing} title="Refresh roles" ariaLabel="Refresh roles" onClick={onRefresh} />} />
      </div>
      <div className="overflow-y-auto flex-1">
        {permMap === null ? (
          <div className="p-3"><LoadingState label="Loading roles" rows={5} /></div>
        ) : error ? (
          <div className="p-3"><ErrorState message={error} onRetry={onRefresh} /></div>
        ) : (
          <ul aria-label="Roles">
            {roleOptions.map((r) => {
              const on = r === selectedRole
              const isFull = FULL_ACCESS_ROLES.has(r)
              return (
                <li key={r}>
                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    aria-pressed={on}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-gray-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500 ${
                      on ? 'bg-orange-950/30' : 'hover:bg-gray-900/60'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center shrink-0" aria-hidden="true">
                      <KeyRound size={14} className="text-orange-400" />
                    </div>
                    <p className="min-w-0 flex-1 text-sm font-medium text-gray-100 truncate flex items-center gap-1.5">
                      {r}
                      {isFull && <Crown size={12} className="text-amber-400 shrink-0" aria-label="Full access" />}
                    </p>
                    <ChevronRight size={14} className={`shrink-0 ${on ? 'text-orange-400' : 'text-gray-500'}`} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Panel>
  )
}

function ModuleRow({ row, mode, locked, busy, onUserOverride, onRoleOverride }) {
  return (
    <li className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-gray-800/60 last:border-b-0 hover:bg-gray-900/40">
      <div className="shrink-0">
        {row.allowed
          ? <CheckCircle2 size={17} className="text-emerald-400" aria-label="Allowed" />
          : <XCircle size={17} className="text-red-400" aria-label="Denied" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-100 truncate flex items-center gap-2">
          {row.label}
          {mode === 'user' && row.override === 'grant' && <Badge tone="good">Grant</Badge>}
          {mode === 'user' && row.override === 'revoke' && <Badge tone="danger">Revoke</Badge>}
        </p>
        <p className="text-[11px] text-gray-400 truncate">{row.reason || 'N/A'}</p>
      </div>
      <div className="shrink-0 flex items-center gap-1" role="group" aria-label={`${row.label} access`}>
        {locked ? (
          <span className="text-[11px] text-gray-400 px-2">Locked</span>
        ) : mode === 'user' ? (
          <>
            <Btn size="xs" icon={Check} variant={row.override === 'grant' ? 'good' : 'ghost'} busy={busy} aria-pressed={row.override === 'grant'}
              title="Allow (per-user grant)" onClick={() => onUserOverride(row, 'grant')}>Allow</Btn>
            <Btn size="xs" icon={Ban} variant={row.override === 'revoke' ? 'danger' : 'ghost'} disabled={busy} aria-pressed={row.override === 'revoke'}
              title="Deny (per-user revoke)" onClick={() => onUserOverride(row, 'revoke')}>Deny</Btn>
            <Btn size="xs" icon={RotateCcw} disabled={busy || !row.override}
              title="Clear the override and follow the role" onClick={() => onUserOverride(row, 'clear')}>Clear</Btn>
          </>
        ) : (
          <>
            <Btn size="xs" icon={Check} variant={row.allowed ? 'good' : 'ghost'} busy={busy} aria-pressed={row.allowed}
              title="Allow this module for the role" onClick={() => onRoleOverride(row, true)}>Allow</Btn>
            <Btn size="xs" icon={Ban} variant={!row.allowed ? 'danger' : 'ghost'} disabled={busy} aria-pressed={!row.allowed}
              title="Deny this module for the role" onClick={() => onRoleOverride(row, false)}>Deny</Btn>
          </>
        )}
      </div>
    </li>
  )
}
