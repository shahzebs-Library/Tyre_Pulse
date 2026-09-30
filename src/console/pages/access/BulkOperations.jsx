/**
 * BulkOperations.jsx - apply one access change to many users at once, inside the
 * console Access Control host.
 *
 * Two server-side batch actions, both super-admin-only RPCs surfaced through
 * src/lib/api/adminAccess.js:
 *   - Set role   -> adminAccess.bulkSetRole(ids, role). The DB honours a
 *     last-super-admin lockout guard and never demotes a super admin, so the
 *     returned count can be lower than the selection; we report the real count.
 *   - Grant / revoke a capability -> adminAccess.bulkSetGrant({ userIds,
 *     moduleKey, capability, effect, expiresAt }). Only View is enforced today;
 *     other capabilities are stored for progressive enforcement and labelled so.
 *
 * Nothing is applied without an explicit confirm modal that restates the exact
 * change and the number of users it touches. The role list unions the built-in
 * roles, any custom roles and every role already present in the directory so no
 * assignable role is ever missing.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, RefreshCw, Crown, Check, Layers, ShieldCheck, UserCog, KeyRound, Ban, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { ACCESS_ROLES } from '../../../lib/moduleCatalog'
import { ACCESS_MODULE_GROUPS as MODULE_GROUPS, ACCESS_MODULE_LABEL as MODULE_LABEL } from '../../../lib/accessCatalog'
import { CAPABILITIES } from '../../../lib/permissionMatrix'
import { listProfiles } from '../../../lib/api/users'
import { listCustomRoles } from '../../../lib/api/customRoles'
import { bulkSetRole, bulkSetGrant } from '../../../lib/api/adminAccess'
import { toUserMessage } from '../../../lib/safeError'
import { displayName } from './UserDirectory'
import {
  Badge, Btn, EmptyState, ErrorState, LoadingState, Modal, Note, Panel, PanelHeader, SearchInput, Segmented,
  Select, StatTile,
} from '../../components/ui'

const INPUT = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

export default function BulkOperations() {
  const [users, setUsers] = useState(null)
  const [usersError, setUsersError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [selected, setSelected] = useState(() => new Set())

  const [customRoles, setCustomRoles] = useState([])
  const [customRolesError, setCustomRolesError] = useState(false)

  // Action mode + form
  const [mode, setMode] = useState('role') // 'role' | 'capability'
  const [roleValue, setRoleValue] = useState('')
  const [moduleKey, setModuleKey] = useState('')
  const [capability, setCapability] = useState('view')
  const [effect, setEffect] = useState('grant')
  const [expiry, setExpiry] = useState('')

  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [result, setResult] = useState('')

  const loadUsers = useCallback(async () => {
    setRefreshing(true); setUsersError('')
    try {
      const rows = await listProfiles()
      setUsers(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setUsersError(toUserMessage(err, 'Could not load the user directory.'))
      setUsers([])
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  useEffect(() => {
    listCustomRoles()
      .then((rows) => { setCustomRoles(Array.isArray(rows) ? rows : []); setCustomRolesError(false) })
      .catch(() => { setCustomRoles([]); setCustomRolesError(true) })
  }, [])

  const roleOptions = useMemo(() => {
    const set = new Set()
    for (const u of users || []) if (u.role) set.add(u.role)
    return Array.from(set).sort()
  }, [users])

  // Assignable roles = built-ins + custom roles + roles seen in the directory.
  const assignableRoles = useMemo(() => {
    const set = new Set(ACCESS_ROLES)
    for (const r of customRoles) if (r?.name) set.add(r.name)
    for (const r of roleOptions) set.add(r)
    return Array.from(set).sort()
  }, [customRoles, roleOptions])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (users || []).filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (!q) return true
      return [displayName(u), u.email, u.username].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [users, search, roleFilter])

  const allVisibleSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selected.has(u.id))

  function toggleUser(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) filteredUsers.forEach((u) => next.delete(u.id))
      else filteredUsers.forEach((u) => next.add(u.id))
      return next
    })
  }
  function clearSelection() { setSelected(new Set()) }

  const selectedIds = useMemo(() => Array.from(selected), [selected])
  const selectedCount = selectedIds.length
  const selectedSupers = useMemo(
    () => (users || []).filter((u) => selected.has(u.id) && u.is_super_admin).length,
    [users, selected],
  )

  const canReview = useMemo(() => {
    if (selectedCount === 0) return false
    if (mode === 'role') return !!roleValue
    return !!moduleKey
  }, [selectedCount, mode, roleValue, moduleKey])

  const capMeta = CAPABILITIES.find((c) => c.key === capability)
  const plural = (n) => `${n} user${n === 1 ? '' : 's'}`

  const applyChange = useCallback(async () => {
    setApplying(true); setApplyError('')
    try {
      let count
      if (mode === 'role') {
        count = await bulkSetRole(selectedIds, roleValue)
        setResult(`${count} of ${plural(selectedCount)} set to ${roleValue}.`)
      } else {
        count = await bulkSetGrant({
          userIds: selectedIds,
          moduleKey,
          capability,
          effect,
          expiresAt: expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null,
        })
        const label = MODULE_LABEL[moduleKey] || moduleKey
        setResult(`${effect === 'revoke' ? 'Revoke' : 'Grant'} applied to ${plural(count)}: ${capability} on ${label}.`)
      }
      setConfirming(false)
      if (mode === 'role') await loadUsers() // roles changed, refresh the directory
    } catch (err) {
      setApplyError(toUserMessage(err, 'Could not apply the bulk change.'))
    } finally {
      setApplying(false)
    }
  }, [mode, selectedIds, selectedCount, roleValue, moduleKey, capability, effect, expiry, loadUsers])

  const na = users === null || !!usersError
  const destructive = mode === 'role' || effect === 'revoke'

  return (
    <div className="space-y-4">
      <Note icon={Layers}>
        Apply one change to many users at once. Set a role for the whole selection, or grant or revoke a
        capability on a module. Nothing is applied until you confirm. Role changes honour the server
        last-super-admin guard, so the confirmed count can be lower than the number selected.
      </Note>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Users" icon={Users} value={na ? 'N/A' : users.length} sub={users === null ? 'Loading' : usersError ? 'Could not load' : 'In the directory'} />
        <StatTile label="Shown" value={na ? 'N/A' : filteredUsers.length} sub="After search and role filter" />
        <StatTile label="Selected" tone={selectedCount ? 'accent' : 'default'} value={selectedCount} sub="Will receive the change" />
        <StatTile label="Super admins selected" icon={Crown} tone={selectedSupers ? 'warning' : 'default'} value={na ? 'N/A' : selectedSupers} sub="Never demoted by a role change" />
      </div>

      {result && <div role="status"><Note tone="accent" icon={Check}>{result}</Note></div>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_1fr] gap-4">
        {/* Left: multi-select user directory */}
        <Panel flush className="overflow-hidden flex flex-col max-h-[78vh]">
          <div className="p-3 border-b border-gray-800 space-y-2">
            <PanelHeader icon={Users} title="Users"
              subtitle={na ? undefined : `${filteredUsers.length} of ${users.length} shown`}
              actions={<Btn size="xs" variant="quiet" icon={RefreshCw} busy={refreshing} title="Refresh users" ariaLabel="Refresh users" onClick={loadUsers} />} />
            <SearchInput value={search} onChange={setSearch} placeholder="Search name or email" />
            <Select value={roleFilter} onChange={setRoleFilter} ariaLabel="Filter users by role"
              options={[{ value: 'all', label: 'All roles' }, ...roleOptions.map((r) => ({ value: r, label: r }))]} />
            <div className="flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-orange-500" checked={allVisibleSelected}
                  disabled={filteredUsers.length === 0} onChange={toggleSelectAllVisible} />
                Select all shown
              </label>
              {selectedCount > 0 && <Btn size="xs" variant="quiet" onClick={clearSelection}>Clear ({selectedCount})</Btn>}
            </div>
          </div>

          <div className="overflow-y-auto flex-1">
            {users === null ? (
              <div className="p-3"><LoadingState label="Loading users" rows={5} /></div>
            ) : usersError ? (
              <div className="p-3"><ErrorState message={usersError} onRetry={loadUsers} /></div>
            ) : filteredUsers.length === 0 ? (
              <EmptyState icon={Users}
                title={users.length === 0 ? 'No users found' : 'No users match'}
                reason={users.length === 0 ? 'The user directory returned no accounts.' : 'Nothing matches this search and role.'} />
            ) : (
              <ul aria-label="Users">
                {filteredUsers.map((u) => {
                  const on = selected.has(u.id)
                  return (
                    <li key={u.id}>
                      <label className={`w-full px-3 py-2.5 flex items-center gap-2.5 border-b border-gray-800/60 cursor-pointer transition-colors ${
                        on ? 'bg-orange-950/30' : 'hover:bg-gray-900/60'
                      }`}>
                        <input type="checkbox" className="w-4 h-4 accent-orange-500 shrink-0" checked={on} onChange={() => toggleUser(u.id)} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-100 truncate flex items-center gap-1.5">
                            {displayName(u)}
                            {u.is_super_admin && <Crown size={12} className="text-amber-400 shrink-0" aria-label="Super admin" />}
                          </p>
                          <p className="text-xs text-gray-400 truncate">{u.email || u.username || 'No email'}</p>
                        </div>
                        <Badge tone={u.role === 'Admin' ? 'accent' : 'default'}>{u.role || 'No role'}</Badge>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Panel>

        {/* Right: action builder */}
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader icon={Layers} title="Bulk action" subtitle={`${plural(selectedCount)} selected`} />

            <div className="mb-4">
              <Segmented role="group" ariaLabel="Bulk action type" value={mode} onChange={setMode}
                options={[
                  { key: 'role', label: <><UserCog size={13} aria-hidden="true" />Set role</> },
                  { key: 'capability', label: <><KeyRound size={13} aria-hidden="true" />Grant or revoke</> },
                ]} />
            </div>

            {mode === 'role' ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor="bulk-role" className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold block mb-1.5">New role</label>
                  <Select id="bulk-role" value={roleValue} onChange={setRoleValue} placeholder="Select a role"
                    options={assignableRoles.map((r) => ({ value: r, label: r }))} />
                </div>
                {customRolesError && (
                  <Note tone="warning">Custom roles could not be loaded, so only built-in roles and roles already in use are listed.</Note>
                )}
                <p className="text-xs text-gray-400 inline-flex items-start gap-1.5">
                  <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                  Super admins in the selection are never demoted by this action; they are skipped server side.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label htmlFor="bulk-module" className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold block mb-1.5">Module</label>
                  <select id="bulk-module" className={INPUT} value={moduleKey} onChange={(e) => setModuleKey(e.target.value)}>
                    <option value="">Select a module</option>
                    {MODULE_GROUPS.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="bulk-cap" className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold block mb-1.5">Capability</label>
                    <Select id="bulk-cap" value={capability} onChange={setCapability}
                      options={CAPABILITIES.filter((c) => c.key !== 'delete').map((c) => ({ value: c.key, label: `${c.label}${c.enforced ? '' : ' (stored only)'}` }))} />
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Effect</p>
                    <Segmented role="group" ariaLabel="Effect" value={effect} onChange={setEffect}
                      options={[
                        { key: 'grant', label: <><CheckCircle2 size={13} aria-hidden="true" />Grant</> },
                        { key: 'revoke', label: <><Ban size={13} aria-hidden="true" />Revoke</> },
                      ]} />
                  </div>
                </div>
                <div>
                  <label htmlFor="bulk-expiry" className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold block mb-1.5">Expiry (optional)</label>
                  <input id="bulk-expiry" type="date" className={INPUT} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                  <p className="text-[11px] text-gray-400 mt-1">Leave blank for a permanent override.</p>
                </div>
                {capMeta && !capMeta.enforced && (
                  <Note tone="warning" icon={AlertTriangle}>
                    The {capMeta.label} capability is stored for progressive enforcement and is not gated by the app yet.
                  </Note>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-gray-800">
              <p className="text-xs text-gray-400">
                {selectedCount === 0 ? 'Select one or more users to enable a bulk action.' : 'You will review the exact change before it is applied.'}
              </p>
              <Btn variant="primary" onClick={() => { setApplyError(''); setResult(''); setConfirming(true) }} disabled={!canReview}>
                Review and apply
              </Btn>
            </div>
          </Panel>
        </div>
      </div>

      <Modal
        open={confirming}
        title="Confirm bulk change"
        subtitle={`${plural(selectedCount)} affected`}
        onClose={() => { if (!applying) setConfirming(false) }}
        width="max-w-md"
        footer={(
          <>
            <Btn onClick={() => setConfirming(false)} disabled={applying}>Cancel</Btn>
            <Btn variant={destructive ? 'danger' : 'primary'} icon={Check} onClick={applyChange} busy={applying}>
              {applying ? 'Applying...' : 'Apply change'}
            </Btn>
          </>
        )}
      >
        {applyError && <div className="mb-3"><ErrorState message={applyError} /></div>}
        <p className="text-sm text-gray-300 break-words">
          {mode === 'role' ? (
            <>Set role <span className="text-gray-100 font-medium">{roleValue}</span> for{' '}
              <span className="text-gray-100 font-medium">{plural(selectedCount)}</span>.</>
          ) : (
            <><span className={effect === 'revoke' ? 'text-red-300 font-medium' : 'text-emerald-300 font-medium'}>{effect === 'revoke' ? 'Revoke' : 'Grant'}</span>{' '}
              the <span className="text-gray-100 font-medium">{capability}</span> capability on{' '}
              <span className="text-gray-100 font-medium">{MODULE_LABEL[moduleKey] || moduleKey}</span> for{' '}
              <span className="text-gray-100 font-medium">{plural(selectedCount)}</span>
              {expiry ? <> until <span className="text-gray-100 font-medium">{expiry}</span></> : ''}.</>
          )}
        </p>
        {mode === 'role' && selectedSupers > 0 && (
          <p className="text-xs text-amber-200 mt-2">{plural(selectedSupers)} in the selection {selectedSupers === 1 ? 'is a super admin and' : 'are super admins and'} will be skipped.</p>
        )}
      </Modal>
    </div>
  )
}
