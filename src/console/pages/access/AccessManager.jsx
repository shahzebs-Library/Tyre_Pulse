/**
 * AccessManager.jsx - the EASY, one-screen access-control editor.
 *
 * A single tree (nav group -> module -> sub-module) with a plain ON/OFF access
 * (view) toggle on every row and an "Advanced" disclosure for the finer
 * capabilities (create/edit/delete/export/approve). It edits access for a whole
 * ROLE or for one specific USER, with presets, group bulk-apply, search and a
 * live effective-access preview beside the toggles.
 *
 * REUSE, do NOT reinvent:
 *   - Registry/tree           -> src/lib/moduleCatalog.js (MODULE_GROUPS, SUBMODULES, FULL_REGISTRY)
 *   - Role defaults + caps     -> src/lib/permissionMatrix.js (defaultViewAccess, CAPABILITIES, resolveCapability)
 *   - Role view persistence    -> src/lib/api/modulePermissions.js (listGlobalPermissions, saveModulePermissions)
 *   - Role non-view caps store  -> src/lib/permissionMatrix.js (get/savePermissionOverrides) [app_settings]
 *   - Per-user grants           -> src/lib/api/accessGrants.js (list/set/revokeUserAccessGrant)
 *   - User directory            -> src/lib/api/users.js (listProfiles)
 *
 * HONESTY (labelled throughout): only the `view` capability on the 37 BASE
 * modules is enforced by the app today (AuthContext.hasPermission + ModuleRoute).
 * Sub-module keys ('parent:child') and the non-view capabilities are STORED for
 * progressive enforcement and gate nothing yet; the UI says "(stored only)".
 * Role sub-module view is persisted as a module_permissions row on the composite
 * key (free text, harmlessly ignored by base-module enforcement); role non-view
 * caps live in the existing app_settings overrides (base modules only); every
 * per-user override (any capability, base or sub) is a user_access_grants row.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Search, ChevronRight, ChevronDown, ChevronsDownUp,
  ChevronsUpDown, Crown, Save, Loader2, Check, X, RotateCcw, Info,
  AlertTriangle, SlidersHorizontal, UserCog, Eye, Ban, RefreshCw,
  FolderTree, Zap,
} from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  MODULE_GROUPS, SUBMODULES, ACCESS_ROLES, REGISTRY_LABEL, isSubmoduleKey,
} from '../../../lib/moduleCatalog'
import {
  CAPABILITIES, defaultViewAccess, resolveCapability,
  getPermissionOverrides, savePermissionOverrides,
} from '../../../lib/permissionMatrix'
import { listGlobalPermissions, saveModulePermissions } from '../../../lib/api/modulePermissions'
import { listProfiles } from '../../../lib/api/users'
import {
  listUserGrants, setUserAccessGrant, revokeUserAccessGrant,
} from '../../../lib/api/accessGrants'
import { toUserMessage } from '../../../lib/safeError'

// Capabilities beyond `view` (the Advanced row). view is the big ON/OFF toggle.
const EXTRA_CAPS = CAPABILITIES.filter((c) => c.key !== 'view')
const CAP_KEYS = CAPABILITIES.map((c) => c.key)

const ROLE_TINT = {
  Admin: 'text-purple-300', Manager: 'text-blue-300', Director: 'text-indigo-300',
  Reporter: 'text-cyan-300', Inspector: 'text-green-300', 'Tyre Man': 'text-amber-300',
  Driver: 'text-[var(--text-secondary)]',
}

// Access presets (the easy ladder). Each lists which capabilities it turns on.
const PRESETS = [
  { key: 'none',    label: 'No access', caps: [] },
  { key: 'viewer',  label: 'Viewer',    caps: ['view'] },
  { key: 'editor',  label: 'Editor',    caps: ['view', 'create', 'edit'] },
  { key: 'manager', label: 'Manager',   caps: ['view', 'create', 'edit', 'delete', 'export'] },
  { key: 'full',    label: 'Full',      caps: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
]
const presetCapMap = (preset) => Object.fromEntries(CAP_KEYS.map((c) => [c, preset.caps.includes(c)]))

function displayName(u) {
  return u?.full_name || u?.username || u?.email || 'Unnamed user'
}

// ── Pure state builders (kept simple + local) ────────────────────────────────

/** Does this role have ANY explicit global module_permissions rows? */
function roleHasDbRows(viewMap, role) {
  const rows = viewMap?.[role]
  return !!rows && typeof rows === 'object' && Object.keys(rows).length > 0
}

/**
 * Effective per-node access for a ROLE, mirroring getEffectiveMatrix semantics:
 *  - base module view: DB rows win when present, else the hardcoded default.
 *  - base module caps: override wins, else defaults to the module's view default.
 *  - sub-module view: explicit composite row wins, else inherits the parent.
 *  - Admin is always fully allowed.
 * @returns {{ view: Record<string,boolean>, caps: Record<string,Record<string,boolean>> }}
 */
function buildRoleState(role, viewMap, overrides) {
  const isAdmin = role === 'Admin'
  const hasRows = roleHasDbRows(viewMap, role)
  const view = {}
  const caps = {}
  for (const g of MODULE_GROUPS) {
    for (const m of g.modules) {
      const baseView = isAdmin
        ? true
        : hasRows
          ? viewMap[role][m.key] === true
          : defaultViewAccess(role, m.key)
      view[m.key] = baseView
      const ov = overrides?.[role]?.[m.key] || {}
      caps[m.key] = {}
      for (const c of EXTRA_CAPS) {
        caps[m.key][c.key] = isAdmin ? true : c.key in ov ? ov[c.key] === true : baseView
      }
      for (const s of SUBMODULES[m.key] || []) {
        const explicit = viewMap?.[role] && Object.prototype.hasOwnProperty.call(viewMap[role], s.key)
        view[s.key] = isAdmin ? true : explicit ? viewMap[role][s.key] === true : baseView
        // Sub-module non-view caps are not stored for roles; mirror sub view.
        caps[s.key] = Object.fromEntries(EXTRA_CAPS.map((c) => [c.key, view[s.key]]))
      }
    }
  }
  return { view, caps }
}

/** Index grant rows: key -> capability -> effect -> grantId. */
function indexGrants(rows) {
  const idx = {}
  for (const r of rows || []) {
    const cap = r.capability || 'view'
    ;((idx[r.module_key] ||= {})[cap] ||= {})[r.effect] = r.id
  }
  return idx
}

/**
 * Effective per-node access for a USER = role baseline overlaid with grants.
 * Super admins bypass everything (all true).
 */
function buildUserState(user, roleState, grantIdx) {
  const isSuper = user?.is_super_admin === true
  const role = user?.role
  const view = {}
  const caps = {}
  const allKeys = Object.keys(roleState.view)
  for (const key of allKeys) {
    const sub = isSubmoduleKey(key)
    const parent = sub ? key.split(':', 1)[0] : key
    // baseline for a sub-module = its parent's role baseline (nothing enforces the sub key).
    const baseView = sub ? roleState.view[parent] : roleState.view[key]
    view[key] = isSuper
      ? true
      : resolveCapability({ role, isSuperAdmin: isSuper, roleAllows: baseView, override: grantEffect(grantIdx, key, 'view') })
    caps[key] = {}
    for (const c of EXTRA_CAPS) {
      const baseCap = sub ? roleState.caps[parent]?.[c.key] : roleState.caps[key]?.[c.key]
      caps[key][c.key] = isSuper
        ? true
        : resolveCapability({ role, isSuperAdmin: isSuper, roleAllows: baseCap === true, override: grantEffect(grantIdx, key, c.key) })
    }
  }
  return { view, caps }
}

function grantEffect(idx, key, cap) {
  const e = idx?.[key]?.[cap]
  if (!e) return undefined
  if (e.revoke) return 'revoke' // revoke wins
  if (e.grant) return 'grant'
  return undefined
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AccessManager() {
  const { profile, isSuperAdmin } = useAuth()
  const isAdmin = profile?.role === 'Admin' || isSuperAdmin === true
  const canWriteRole = isAdmin // set_module_permissions: Admin or super
  const canWriteUser = isSuperAdmin === true // set_user_access_grant: super only

  const [mode, setMode] = useState('role') // 'role' | 'user'
  const [selectedRole, setSelectedRole] = useState('Manager')
  const [selectedUserId, setSelectedUserId] = useState(null)

  // Loaded globals (shared by both modes)
  const [viewMap, setViewMap] = useState(null)
  const [overrides, setOverrides] = useState(null)
  const [users, setUsers] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  // Per-user grants for the selected user
  const [grantIdx, setGrantIdx] = useState({})
  const [grantsLoading, setGrantsLoading] = useState(false)

  // Draft + baseline
  const [baseline, setBaseline] = useState(null) // loaded effective state
  const [draft, setDraft] = useState(null)        // edited state
  const [roleBaseline, setRoleBaseline] = useState(null) // user mode: role-only baseline for reset/diff

  // UI
  const [search, setSearch] = useState('')
  const [uSearch, setUSearch] = useState('')
  const [uRoleFilter, setURoleFilter] = useState('all')
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())
  const [openAdvanced, setOpenAdvanced] = useState(() => new Set())
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

  // ── Load globals ────────────────────────────────────────────────────────────
  const loadGlobals = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const [vm, ov, us] = await Promise.all([
        listGlobalPermissions(),
        getPermissionOverrides(),
        listProfiles(),
      ])
      setViewMap(vm || {})
      setOverrides(ov || {})
      setUsers(Array.isArray(us) ? us : [])
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load access data.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadGlobals() }, [loadGlobals])

  const selectedUser = useMemo(
    () => (users || []).find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId],
  )

  // ── Build baseline/draft when selection changes ───────────────────────────────
  const buildRole = useCallback(() => {
    if (!viewMap || !overrides) return
    const state = buildRoleState(selectedRole, viewMap, overrides)
    setBaseline(state)
    setRoleBaseline(null)
    setDraft(structuredClone(state))
  }, [selectedRole, viewMap, overrides])

  const buildUser = useCallback(async (user) => {
    if (!user || !viewMap || !overrides) { setBaseline(null); setDraft(null); return }
    setGrantsLoading(true)
    try {
      const rows = await listUserGrants(user.id)
      const idx = indexGrants(rows)
      setGrantIdx(idx)
      const rState = buildRoleState(user.role, viewMap, overrides)
      setRoleBaseline(rState)
      const uState = buildUserState(user, rState, idx)
      setBaseline(uState)
      setDraft(structuredClone(uState))
    } catch (err) {
      flash(toUserMessage(err, 'Could not load grants for this user.'), true)
      setBaseline(null); setDraft(null)
    } finally {
      setGrantsLoading(false)
    }
  }, [viewMap, overrides, flash])

  useEffect(() => {
    if (loading) return
    if (mode === 'role') buildRole()
    else buildUser(selectedUser)
  }, [loading, mode, selectedRole, selectedUser, buildRole, buildUser])

  // ── Dirty detection ────────────────────────────────────────────────────────
  const dirtyKeys = useMemo(() => {
    const s = new Set()
    if (!baseline || !draft) return s
    for (const key of Object.keys(draft.view)) {
      if (draft.view[key] !== baseline.view[key]) { s.add(key); continue }
      const dc = draft.caps[key] || {}, bc = baseline.caps[key] || {}
      for (const c of EXTRA_CAPS) if (dc[c.key] !== bc[c.key]) { s.add(key); break }
    }
    return s
  }, [baseline, draft])
  const dirtyCount = dirtyKeys.size

  // ── Mutators ─────────────────────────────────────────────────────────────────
  const capEditable = useCallback((key) => {
    // Non-view caps are editable for base modules always, and for sub-modules
    // only in USER mode (grants store any capability; roles have no sub-cap store).
    if (mode === 'user') return true
    return !isSubmoduleKey(key)
  }, [mode])

  function setNode(key, patch) {
    setDraft((d) => {
      if (!d) return d
      const next = { view: { ...d.view }, caps: { ...d.caps } }
      if ('view' in patch) next.view[key] = patch.view
      if (patch.caps) next.caps[key] = { ...(d.caps[key] || {}), ...patch.caps }
      return next
    })
  }

  function toggleView(key) {
    if (!draft) return
    setNode(key, { view: !draft.view[key] })
  }

  function toggleCap(key, cap) {
    if (!draft || !capEditable(key)) return
    setNode(key, { caps: { [cap]: !(draft.caps[key]?.[cap] === true) } })
  }

  const applyPresetToKeys = useCallback((preset, keys) => {
    const capMap = presetCapMap(preset)
    setDraft((d) => {
      if (!d) return d
      const next = { view: { ...d.view }, caps: { ...d.caps } }
      for (const key of keys) {
        next.view[key] = capMap.view
        if (capEditable(key)) {
          next.caps[key] = Object.fromEntries(EXTRA_CAPS.map((c) => [c.key, capMap[c.key]]))
        } else {
          // sub-module in role mode: caps mirror view (non-editable)
          next.caps[key] = Object.fromEntries(EXTRA_CAPS.map((c) => [c.key, capMap.view]))
        }
      }
      return next
    })
    setNotice(''); setErrorMsg('')
  }, [capEditable])

  function resetRowToRole(key) {
    // USER mode only: revert this node to the role baseline (Save deletes grants).
    if (!roleBaseline) return
    const sub = isSubmoduleKey(key)
    const parent = sub ? key.split(':', 1)[0] : key
    const bView = sub ? roleBaseline.view[parent] : roleBaseline.view[key]
    const bCaps = {}
    for (const c of EXTRA_CAPS) bCaps[c.key] = (sub ? roleBaseline.caps[parent]?.[c.key] : roleBaseline.caps[key]?.[c.key]) === true
    setNode(key, { view: bView, caps: bCaps })
  }

  function discard() {
    setDraft(baseline ? structuredClone(baseline) : null)
    setNotice(''); setErrorMsg('')
  }

  // ── Tree (filtered) ──────────────────────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    return MODULE_GROUPS.map((g) => {
      const modules = g.modules
        .map((m) => {
          const subs = (SUBMODULES[m.key] || []).filter(
            (s) => !q || s.label.toLowerCase().includes(q) || s.key.includes(q),
          )
          const selfMatch = !q || m.label.toLowerCase().includes(q) || m.key.includes(q)
          if (selfMatch) return { ...m, subs: SUBMODULES[m.key] || [] }
          if (subs.length) return { ...m, subs }
          return null
        })
        .filter(Boolean)
      return modules.length ? { ...g, modules } : null
    }).filter(Boolean)
  }, [search])

  const visibleKeys = useMemo(() => {
    const keys = []
    for (const g of filteredGroups) {
      for (const m of g.modules) {
        keys.push(m.key)
        for (const s of m.subs) keys.push(s.key)
      }
    }
    return keys
  }, [filteredGroups])

  function toggleGroup(name) {
    setCollapsedGroups((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })
  }
  function toggleAdvanced(key) {
    setOpenAdvanced((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  const expandAll = () => setCollapsedGroups(new Set())
  const collapseAll = () => setCollapsedGroups(new Set(MODULE_GROUPS.map((g) => g.group)))

  // ── Effective preview (live, from draft) ──────────────────────────────────────
  const effective = useMemo(() => {
    if (!draft) return { viewable: [], overrides: 0, total: 0 }
    const baseNodes = MODULE_GROUPS.flatMap((g) => g.modules)
    const viewable = baseNodes.filter((m) => draft.view[m.key])
    let ovCount = 0
    if (mode === 'user' && roleBaseline) {
      for (const key of Object.keys(draft.view)) {
        const sub = isSubmoduleKey(key)
        const parent = sub ? key.split(':', 1)[0] : key
        const bView = sub ? roleBaseline.view[parent] : roleBaseline.view[key]
        if (draft.view[key] !== bView) ovCount += 1
      }
    }
    return { viewable, overrides: ovCount, total: baseNodes.length }
  }, [draft, mode, roleBaseline])

  // ── Save ─────────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!draft || !baseline || dirtyCount === 0 || saving) return
    setSaving(true); setErrorMsg(''); setNotice('')
    try {
      if (mode === 'role') {
        if (!canWriteRole) throw new Error('Only an Admin can change role access.')
        // 1) view changes (base + sub) via the enforced module_permissions path
        const viewChanges = []
        for (const key of Object.keys(draft.view)) {
          if (draft.view[key] !== baseline.view[key]) {
            viewChanges.push({ role: selectedRole, module_key: key, enabled: draft.view[key] })
          }
        }
        if (viewChanges.length) await saveModulePermissions(viewChanges)

        // 2) base-module non-view caps -> app_settings overrides (merge, keep other roles)
        const roleOverride = {}
        for (const g of MODULE_GROUPS) {
          for (const m of g.modules) {
            const def = defaultViewAccess(selectedRole, m.key)
            const cell = {}
            for (const c of EXTRA_CAPS) {
              const val = draft.caps[m.key]?.[c.key] === true
              if (val !== def) cell[c.key] = val
            }
            if (Object.keys(cell).length) roleOverride[m.key] = cell
          }
        }
        const nextOverrides = { ...(overrides || {}) }
        if (Object.keys(roleOverride).length) nextOverrides[selectedRole] = roleOverride
        else delete nextOverrides[selectedRole]
        await savePermissionOverrides(nextOverrides)

        // refresh globals so baseline reflects the DB
        const [vm, ov] = await Promise.all([listGlobalPermissions(), getPermissionOverrides()])
        setViewMap(vm || {}); setOverrides(ov || {})
        const fresh = buildRoleState(selectedRole, vm || {}, ov || {})
        setBaseline(fresh); setDraft(structuredClone(fresh))
        flash(
          viewChanges.length
            ? `Saved. ${viewChanges.length} view change${viewChanges.length !== 1 ? 's' : ''} apply on each user's next load; other capabilities and sub-modules are stored for progressive enforcement.`
            : 'Saved. Capability changes are stored for progressive enforcement.',
        )
      } else {
        if (!canWriteUser) throw new Error('Only a Super Admin can change per-user access.')
        if (!selectedUser || !roleBaseline) throw new Error('Select a user first.')
        // Reconcile each changed node/capability into user_access_grants.
        let writes = 0, deletes = 0
        for (const key of dirtyKeys) {
          const sub = isSubmoduleKey(key)
          const parent = sub ? key.split(':', 1)[0] : key
          for (const cap of CAP_KEYS) {
            const desired = cap === 'view' ? draft.view[key] : draft.caps[key]?.[cap] === true
            const base = cap === 'view'
              ? (sub ? roleBaseline.view[parent] : roleBaseline.view[key])
              : (sub ? roleBaseline.caps[parent]?.[cap] === true : roleBaseline.caps[key]?.[cap] === true)
            const existing = grantIdx?.[key]?.[cap] || {}
            if (desired === base) {
              // reset: drop any override rows on this key/cap
              if (existing.grant) { await revokeUserAccessGrant(existing.grant); deletes += 1 }
              if (existing.revoke) { await revokeUserAccessGrant(existing.revoke); deletes += 1 }
            } else {
              const want = desired ? 'grant' : 'revoke'
              const opp = desired ? 'revoke' : 'grant'
              if (existing[opp]) { await revokeUserAccessGrant(existing[opp]); deletes += 1 }
              if (!existing[want]) {
                await setUserAccessGrant({ userId: selectedUser.id, moduleKey: key, capability: cap, effect: want })
                writes += 1
              }
            }
          }
        }
        // reload grants -> rebuild baseline/draft
        const rows = await listUserGrants(selectedUser.id)
        const idx = indexGrants(rows)
        setGrantIdx(idx)
        const uState = buildUserState(selectedUser, roleBaseline, idx)
        setBaseline(uState); setDraft(structuredClone(uState))
        flash(`Saved. ${writes} override${writes !== 1 ? 's' : ''} set, ${deletes} reset to role. Only View on base modules is enforced today; the rest are stored.`)
      }
    } catch (err) {
      flash(toUserMessage(err, 'Could not save access changes. Your edits are still here, try again.'), true)
    } finally {
      setSaving(false)
    }
  }, [draft, baseline, dirtyCount, dirtyKeys, saving, mode, canWriteRole, canWriteUser, selectedRole, selectedUser, overrides, roleBaseline, grantIdx, flash])

  // ── User directory (user mode) ────────────────────────────────────────────────
  const roleOptions = useMemo(() => {
    const set = new Set()
    for (const u of users || []) if (u.role) set.add(u.role)
    return Array.from(set).sort()
  }, [users])

  const filteredUsers = useMemo(() => {
    const q = uSearch.trim().toLowerCase()
    return (users || []).filter((u) => {
      if (uRoleFilter !== 'all' && u.role !== uRoleFilter) return false
      if (!q) return true
      return displayName(u).toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q) ||
        String(u.username || '').toLowerCase().includes(q)
    })
  }, [users, uSearch, uRoleFilter])

  const readOnly = mode === 'role' ? !canWriteRole : !canWriteUser

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-24">
      {/* Intro */}
      <div className="flex items-start gap-2">
        <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
        <p className="text-xs text-[var(--text-muted)] max-w-3xl">
          Turn access on or off for every module and the tabs inside it, for a whole role or for one
          person. Use a preset to set a sensible level in one click, then Save. Only View on the base
          modules is enforced today; sub-modules and the create, edit, delete, export and approve
          capabilities are stored for progressive enforcement and are labelled "stored only".
        </p>
      </div>

      {/* Mode + subject selector */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-[var(--input-border)] overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('role')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
                mode === 'role' ? 'bg-[var(--surface-3)] text-[var(--brand-bright)]' : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
              }`}
            ><UserCog size={15} /> Edit a role</button>
            <button
              type="button"
              onClick={() => setMode('user')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-l border-[var(--input-border)] ${
                mode === 'user' ? 'bg-[var(--surface-3)] text-[var(--brand-bright)]' : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
              }`}
            ><Users size={15} /> Edit a user</button>
          </div>

          {mode === 'role' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {ACCESS_ROLES.map((r) => {
                const on = r === selectedRole
                const locked = r === 'Admin'
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setSelectedRole(r)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      on
                        ? 'bg-[var(--surface-3)] border-[var(--border-bright)] text-[var(--brand-bright)]'
                        : `bg-[var(--input-bg)] border-[var(--input-border)] hover:text-[var(--text-primary)] ${ROLE_TINT[r] || 'text-[var(--text-secondary)]'}`
                    }`}
                    title={locked ? 'Admin always has full access' : `Edit ${r} access`}
                  >
                    {r}{locked && ' (full)'}
                  </button>
                )
              })}
            </div>
          ) : (
            <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
              <ChevronRight size={13} /> Pick a person below, then edit their access on the right.
            </span>
          )}

          {readOnly && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-900/20 border border-amber-800/50 rounded-full px-2.5 py-1">
              <AlertTriangle size={12} /> Read only: {mode === 'role' ? 'saving role access needs Admin.' : 'saving per-user access needs Super Admin.'}
            </span>
          )}
        </div>

        {mode === 'role' && selectedRole === 'Admin' && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-900/15 border border-amber-800/40 text-xs text-amber-200">
            <Crown size={13} className="mt-0.5 shrink-0" /> Admin always has full access to every module and capability. Edits here are ignored for Admin.
          </div>
        )}
      </div>

      {/* Load / error states */}
      {loading ? (
        <div className="card flex items-center justify-center py-16 text-[var(--text-muted)]">
          <Loader2 size={20} className="animate-spin mr-2 text-[var(--brand-bright)]" /> Loading access data...
        </div>
      ) : loadError ? (
        <div className="card flex flex-col items-center justify-center py-14 text-center gap-3">
          <AlertTriangle size={24} className="text-red-400" />
          <p className="text-sm text-red-300">{loadError}</p>
          <button onClick={loadGlobals} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw size={14} /> Retry</button>
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-4 ${mode === 'user' ? 'xl:grid-cols-[minmax(0,300px)_1fr_minmax(0,260px)]' : 'xl:grid-cols-[1fr_minmax(0,280px)]'}`}>
          {/* User directory (user mode only) */}
          {mode === 'user' && (
            <div className="card !p-0 overflow-hidden flex flex-col max-h-[78vh] order-2 xl:order-1">
              <div className="p-3 border-b border-[var(--input-border)] space-y-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                  <Users size={15} className="text-[var(--brand-bright)]" /> Users
                  {Array.isArray(users) && <span className="text-[var(--text-muted)] font-normal">({filteredUsers.length})</span>}
                </h3>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input className="input pl-8 py-1.5 text-sm w-full" placeholder="Search name or email..." value={uSearch} onChange={(e) => setUSearch(e.target.value)} />
                </div>
                <select className="input py-1.5 text-sm w-full" value={uRoleFilter} onChange={(e) => setURoleFilter(e.target.value)}>
                  <option value="all">All roles</option>
                  {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="overflow-y-auto flex-1">
                {filteredUsers.length === 0 ? (
                  <div className="p-8 text-center text-[var(--text-muted)]">
                    <Users size={22} className="mx-auto mb-2 opacity-60" />
                    <p className="text-sm">No users match.</p>
                  </div>
                ) : (
                  <ul>
                    {filteredUsers.map((u) => {
                      const on = u.id === selectedUserId
                      return (
                        <li key={u.id}>
                          <button
                            onClick={() => setSelectedUserId(u.id)}
                            className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--input-border)]/50 transition-colors ${on ? 'bg-[var(--brand-subtle,rgba(34,197,94,0.12))]' : 'hover:bg-[var(--input-bg)]/50'}`}
                          >
                            <div className="w-8 h-8 rounded-full bg-[var(--input-bg)] flex items-center justify-center shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                              {displayName(u).slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-[var(--text-primary)] truncate flex items-center gap-1.5">
                                {displayName(u)}
                                {u.is_super_admin && <Crown size={12} className="text-amber-400 shrink-0" />}
                              </p>
                              <p className="text-xs text-[var(--text-muted)] truncate">{u.email || u.username || 'No email'}</p>
                            </div>
                            <span className={`text-[11px] font-medium shrink-0 ${ROLE_TINT[u.role] || 'text-[var(--text-secondary)]'}`}>{u.role || 'No role'}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Tree editor */}
          <div className="min-w-0 order-1 xl:order-2">
            {mode === 'user' && !selectedUser ? (
              <div className="card flex flex-col items-center justify-center text-center py-16">
                <UserCog size={30} className="text-[var(--text-muted)] opacity-70 mb-3" />
                <p className="text-[var(--text-primary)] font-medium">Select a user</p>
                <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">Choose someone from the list to edit exactly what they can reach, on top of their role.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Toolbar */}
                <div className="card !py-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input className="input pl-8 py-1.5 text-sm w-full" placeholder="Find a module or tab..." value={search} onChange={(e) => setSearch(e.target.value)} />
                      {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={13} /></button>}
                    </div>
                    <button onClick={expandAll} className="btn-secondary text-xs inline-flex items-center gap-1.5" title="Expand all groups"><ChevronsUpDown size={13} /> Expand</button>
                    <button onClick={collapseAll} className="btn-secondary text-xs inline-flex items-center gap-1.5" title="Collapse all groups"><ChevronsDownUp size={13} /> Collapse</button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold inline-flex items-center gap-1.5 mr-1"><Zap size={12} /> Apply preset to all shown</span>
                    {PRESETS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        disabled={readOnly}
                        onClick={() => applyPresetToKeys(p, visibleKeys)}
                        title={p.caps.length ? `Grant: ${p.caps.join(', ')}` : 'Remove all access'}
                        className="px-2.5 py-1 rounded-lg text-xs border bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--brand-bright)] hover:border-[var(--border-bright)] disabled:opacity-40 transition-colors"
                      >{p.label}</button>
                    ))}
                  </div>
                </div>

                {/* Tree */}
                <div className="card !p-0 overflow-hidden">
                  {filteredGroups.length === 0 ? (
                    <div className="p-10 text-center text-[var(--text-muted)]">
                      <FolderTree size={24} className="mx-auto mb-2 opacity-60" />
                      <p className="text-sm">No modules match "{search}".</p>
                    </div>
                  ) : filteredGroups.map((g) => {
                    const collapsed = collapsedGroups.has(g.group)
                    const groupKeys = g.modules.flatMap((m) => [m.key, ...m.subs.map((s) => s.key)])
                    return (
                      <div key={g.group} className="border-b border-[var(--input-border)] last:border-b-0">
                        {/* Group header */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--surface-1)]">
                          <button onClick={() => toggleGroup(g.group)} className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {g.group}
                          </button>
                          <div className="ml-auto flex items-center gap-1">
                            {PRESETS.map((p) => (
                              <button
                                key={p.key}
                                type="button"
                                disabled={readOnly}
                                onClick={() => applyPresetToKeys(p, groupKeys)}
                                className="px-1.5 py-0.5 rounded text-[10px] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--brand-bright)] disabled:opacity-40"
                                title={`Set this group to ${p.label}`}
                              >{p.label}</button>
                            ))}
                          </div>
                        </div>

                        {!collapsed && g.modules.map((m) => (
                          <div key={m.key}>
                            <NodeRow
                              node={{ key: m.key, label: m.label, level: 0 }}
                              draft={draft} dirty={dirtyKeys.has(m.key)}
                              readOnly={readOnly} mode={mode}
                              capEditable={capEditable(m.key)}
                              advancedOpen={openAdvanced.has(m.key)}
                              onToggleView={() => toggleView(m.key)}
                              onToggleCap={(c) => toggleCap(m.key, c)}
                              onToggleAdvanced={() => toggleAdvanced(m.key)}
                              onResetRow={mode === 'user' ? () => resetRowToRole(m.key) : null}
                            />
                            {m.subs.map((s) => (
                              <NodeRow
                                key={s.key}
                                node={{ key: s.key, label: s.label, level: 1 }}
                                draft={draft} dirty={dirtyKeys.has(s.key)}
                                readOnly={readOnly} mode={mode}
                                capEditable={capEditable(s.key)}
                                advancedOpen={openAdvanced.has(s.key)}
                                onToggleView={() => toggleView(s.key)}
                                onToggleCap={(c) => toggleCap(s.key, c)}
                                onToggleAdvanced={() => toggleAdvanced(s.key)}
                                onResetRow={mode === 'user' ? () => resetRowToRole(s.key) : null}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>

                <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                  <Info size={12} /> A row indented under a module is a tab inside it. Sub-module and non-view toggles are stored for progressive enforcement (labelled "stored only").
                </p>
              </div>
            )}
          </div>

          {/* Effective preview */}
          {(mode === 'role' || selectedUser) && (
            <div className="order-3">
              <div className="card sticky top-4 space-y-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                  <Eye size={15} className="text-[var(--brand-bright)]" /> Effective access
                </h3>
                {mode === 'role' ? (
                  <p className="text-xs text-[var(--text-muted)]">What <span className={`font-semibold ${ROLE_TINT[selectedRole] || ''}`}>{selectedRole}</span> can view after your edits.</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-[var(--input-bg)] flex items-center justify-center shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                      {displayName(selectedUser).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate flex items-center gap-1.5">{displayName(selectedUser)}{selectedUser.is_super_admin && <Crown size={12} className="text-amber-400" />}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{selectedUser.role || 'No role'}</p>
                    </div>
                  </div>
                )}

                {mode === 'user' && selectedUser?.is_super_admin && (
                  <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-amber-900/15 border border-amber-800/40 text-[11px] text-amber-200">
                    <Crown size={12} className="mt-0.5 shrink-0" /> Super admin bypasses all gates. Overrides are stored but do not restrict this user.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Modules viewable" value={`${effective.viewable.length}/${effective.total}`} tint="text-green-300" />
                  <Stat label={mode === 'user' ? 'Overrides vs role' : 'Unsaved changes'} value={mode === 'user' ? effective.overrides : dirtyCount} tint={mode === 'user' ? 'text-amber-300' : 'text-[var(--text-primary)]'} />
                </div>

                <div className="max-h-[42vh] overflow-y-auto pr-1 space-y-1">
                  {effective.viewable.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)] py-3 text-center">No modules viewable.</p>
                  ) : effective.viewable.map((m) => (
                    <div key={m.key} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <Check size={12} className="text-green-400 shrink-0" /> <span className="truncate">{m.label}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--text-muted)]">Preview reflects View access. Only base-module View is enforced today.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Save bar */}
      {dirtyCount > 0 && !readOnly && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl px-5 py-3 shadow-lg bg-[var(--surface-3)]" style={{ border: '1px solid var(--border-bright)' }}>
          <span className="text-sm text-[var(--text-secondary)]"><span className="font-semibold text-[var(--text-primary)]">{dirtyCount}</span> unsaved change{dirtyCount !== 1 ? 's' : ''}</span>
          <button onClick={discard} disabled={saving} className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-40"><RotateCcw size={13} /> Discard</button>
          <button onClick={save} disabled={saving} className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-40">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      )}

      {/* Notice / error */}
      {(notice || errorMsg) && (
        <div className={`fixed bottom-4 right-4 z-40 max-w-sm rounded-xl px-4 py-2.5 text-sm flex items-start gap-2 ${errorMsg ? 'text-red-300 bg-red-900/20 border border-red-800/50' : 'text-green-300 bg-green-900/20 border border-green-800/50'}`}>
          {errorMsg ? <AlertTriangle size={15} className="mt-0.5 shrink-0" /> : <Check size={15} className="mt-0.5 shrink-0" />} {errorMsg || notice}
        </div>
      )}

      {grantsLoading && (
        <div className="fixed bottom-4 left-4 z-40 text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading grants...</div>
      )}
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────
function NodeRow({ node, draft, dirty, readOnly, mode, capEditable, advancedOpen, onToggleView, onToggleCap, onToggleAdvanced, onResetRow }) {
  const sub = node.level === 1
  const on = draft?.view?.[node.key] === true
  const caps = draft?.caps?.[node.key] || {}
  const activeExtra = EXTRA_CAPS.filter((c) => caps[c.key]).length

  return (
    <div className={`${dirty ? 'bg-amber-500/5' : ''}`} style={{ borderBottom: '1px solid var(--table-cell-border)' }}>
      <div className={`flex items-center gap-2 px-3 py-2 ${sub ? 'pl-9' : ''}`}>
        {sub && <span className="text-[var(--text-muted)] shrink-0"><ChevronRight size={12} /></span>}
        <div className="min-w-0 flex-1">
          <span className={`text-sm ${sub ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)] font-medium'}`}>{node.label}</span>
          {sub && <span className="ml-2 text-[9px] uppercase tracking-wide text-[var(--text-muted)] opacity-70">stored only</span>}
          {dirty && <span className="ml-2 text-[9px] uppercase tracking-wide text-amber-300">changed</span>}
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={onToggleAdvanced}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors ${advancedOpen ? 'border-[var(--border-bright)] text-[var(--brand-bright)] bg-[var(--surface-3)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          title="Show create, edit, delete, export and approve"
        >
          <SlidersHorizontal size={11} /> Advanced{activeExtra > 0 && <span className="text-[var(--brand-bright)]">({activeExtra})</span>}
        </button>

        {/* Reset to role (user mode) */}
        {mode === 'user' && onResetRow && (
          <button type="button" onClick={onResetRow} disabled={readOnly} className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30" title="Reset this row to the role default">
            <RotateCcw size={13} />
          </button>
        )}

        {/* ON/OFF view toggle */}
        <button
          type="button"
          onClick={onToggleView}
          disabled={readOnly}
          role="switch"
          aria-checked={on}
          aria-label={`${node.label} access`}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${on ? 'bg-green-500/80' : 'bg-[var(--input-bg)] border border-[var(--input-border)]'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      {/* Advanced capabilities */}
      {advancedOpen && (
        <div className={`px-3 pb-2.5 ${sub ? 'pl-9' : ''}`}>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--input-bg)]/50 border border-[var(--input-border)] p-2">
            {!capEditable ? (
              <span className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1.5">
                <Ban size={11} /> Fine capabilities for a tab are set per user (choose "Edit a user").
              </span>
            ) : EXTRA_CAPS.map((c) => {
              const cOn = caps[c.key] === true
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onToggleCap(c.key)}
                  disabled={readOnly}
                  title={`${c.description} (stored, not yet enforced)`}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-40 ${cOn ? 'text-green-300 bg-green-900/20 border-green-800/50' : 'text-[var(--text-muted)] bg-[var(--btn-2-bg)] border-[var(--btn-2-border)] hover:text-[var(--text-secondary)]'}`}
                >
                  {cOn ? <Check size={10} /> : <X size={10} />} {c.label}<span className="text-[8px] uppercase tracking-wide opacity-60">stored</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tint }) {
  return (
    <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-tight">{label}</p>
      <p className={`text-base font-bold ${tint}`}>{value}</p>
    </div>
  )
}
