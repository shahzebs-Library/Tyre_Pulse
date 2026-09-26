/**
 * CountryScope.jsx - the console editor for a user's country scope
 * (profiles.country, a text[]) inside the Access Control host.
 *
 * The country array is the data-visibility boundary: RESTRICTIVE RLS
 * (app_can_see_country) limits a member to rows tagged with one of their
 * countries. Admin / Director / super-admin roles see every country regardless
 * of this field. For every other role an EMPTY array means NO country access
 * (they see no country-tagged records until one is assigned), and an "all"/"*"
 * entry grants every country. This screen surfaces that honestly and lets a
 * super admin add or remove country chips, then persist via
 * adminAccess.setUserCountry (a security-definer, super-admin-only RPC).
 *
 * Writes are optimistic-free: we save, then re-read the directory so the list
 * reflects the authoritative stored value. The result is reported inline, as a
 * success note or a mapped error (no raw Postgres text ever reaches the user).
 * Admin and super admin see every country; Director is country-scoped (the DB
 * gate app_can_see_country admits all countries only for super and Admin).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, Crown, Globe, X, Plus, Check, Save, MapPin, ShieldCheck, Ban, FileSpreadsheet, FileText,
} from 'lucide-react'
import { listProfiles } from '../../../lib/api/users'
import { setUserCountry } from '../../../lib/api/adminAccess'
import { toUserMessage } from '../../../lib/safeError'
import { exportConsoleRows } from '../../../lib/consoleTable'
import UserDirectory, { displayName } from './UserDirectory'
import {
  Badge, Btn, EmptyState, ErrorState, Note, Panel, PanelHeader, StatTile, Toolbar,
} from '../../components/ui'

// GCC baseline scope list; the real set is unioned with whatever countries the
// directory already uses so no stored value is ever hidden from the editor.
const BASE_COUNTRIES = ['KSA', 'UAE', 'Egypt', 'Oman', 'Qatar', 'Bahrain', 'Kuwait']

// Only super-admins and Admins see every country regardless of scope
// (the DB gate app_can_see_country grants all-countries only to
// app_is_org_admin = super OR Admin; Director is country-scoped).
const SEES_ALL_ROLES = new Set(['Admin'])

function normaliseCountry(country) {
  if (!country) return []
  const arr = Array.isArray(country) ? country : [country]
  return Array.from(new Set(arr.map((c) => String(c).trim()).filter(Boolean)))
}

// An "all"/"*" sentinel in the country array grants every country.
function isAllCountries(country) {
  return Array.isArray(country) && country.some((c) => ['ALL', '*'].includes(String(c ?? '').trim().toUpperCase()))
}

// Roles that see every country regardless of the stored scope.
function roleSeesAll(u) {
  return !!u && (u.is_super_admin === true || SEES_ALL_ROLES.has(u.role))
}

/** all | scoped | none, the three honest states of a user's country reach. */
export function scopeState(u) {
  const scope = normaliseCountry(u?.country)
  if (roleSeesAll(u) || isAllCountries(scope)) return 'all'
  return scope.length ? 'scoped' : 'none'
}

function scopeLabel(u) {
  const st = scopeState(u)
  if (st === 'all') return 'All countries'
  if (st === 'none') return 'No country access'
  return normaliseCountry(u.country).join(', ')
}

export default function CountryScope() {
  const [users, setUsers] = useState(null)
  const [usersError, setUsersError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  const [draft, setDraft] = useState([]) // string[]
  const [baseline, setBaseline] = useState([]) // stored value, for dirty check
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState('')
  const [exporting, setExporting] = useState('')
  const [exportError, setExportError] = useState('')

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

  const selectedUser = useMemo(
    () => (users || []).find((u) => u.id === selectedId) || null,
    [users, selectedId],
  )

  // Hydrate the editor whenever the selected user (or the fresh directory) changes.
  useEffect(() => {
    if (!selectedUser) { setDraft([]); setBaseline([]); return }
    const stored = normaliseCountry(selectedUser.country)
    setDraft(stored)
    setBaseline(stored)
    setCustom('')
    setSaveError('')
  }, [selectedUser])

  const selectUser = (id) => { setSelectedId(id); setSaved('') }

  // Country palette = base list + every value already used in the directory.
  const countryPalette = useMemo(() => {
    const set = new Set(BASE_COUNTRIES)
    for (const u of users || []) for (const c of normaliseCountry(u.country)) set.add(c)
    return Array.from(set).sort()
  }, [users])

  const summary = useMemo(() => {
    const out = { total: 0, all: 0, scoped: 0, none: 0 }
    for (const u of users || []) { out.total += 1; out[scopeState(u)] += 1 }
    return out
  }, [users])

  const dirty = useMemo(() => {
    if (draft.length !== baseline.length) return true
    const b = new Set(baseline)
    return draft.some((c) => !b.has(c))
  }, [draft, baseline])

  function addCountry(c) {
    const v = String(c).trim()
    if (!v) return
    setDraft((prev) => (prev.includes(v) ? prev : [...prev, v]))
  }
  function removeCountry(c) {
    setDraft((prev) => prev.filter((x) => x !== c))
  }
  function addCustom() {
    if (!custom.trim()) return
    addCountry(custom)
    setCustom('')
  }

  const save = useCallback(async () => {
    if (!selectedUser) return
    setSaving(true); setSaveError(''); setSaved('')
    try {
      await setUserCountry(selectedUser.id, draft)
      const sa = roleSeesAll(selectedUser) || isAllCountries(draft)
      setSaved(draft.length
        ? `Saved: ${displayName(selectedUser)} is now scoped to ${draft.join(', ')}.`
        : sa
          ? `Saved: ${displayName(selectedUser)} sees all countries through their role.`
          : `Saved: ${displayName(selectedUser)} now has no country access.`)
      setBaseline(draft)
      // Re-read so the directory reflects the authoritative stored value.
      await loadUsers()
    } catch (err) {
      setSaveError(toUserMessage(err, 'Could not update the country scope.'))
    } finally {
      setSaving(false)
    }
  }, [selectedUser, draft, loadUsers])

  async function runExport(format) {
    setExporting(format); setExportError('')
    try {
      await exportConsoleRows({
        rows: users || [],
        title: 'User Country Scope',
        format,
        columns: [
          { key: 'name', header: 'User', value: displayName },
          { key: 'email', header: 'Email' },
          { key: 'role', header: 'Role' },
          { key: 'scope', header: 'Country scope', value: scopeLabel },
        ],
      })
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not create the export file.'))
    } finally {
      setExporting('')
    }
  }

  const seesAll = selectedUser && roleSeesAll(selectedUser)
  const na = users === null || !!usersError

  return (
    <div className="space-y-4">
      <Note icon={Globe}>
        The country scope limits which records a user can see. Admin and super admin see every country
        regardless of this field. For every other role an empty scope means no country access; an "all"
        entry grants every country. Database row security (app_can_see_country) is the real boundary; this
        editor sets the stored value it reads.
      </Note>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Users" icon={Users} value={na ? 'N/A' : summary.total} sub={users === null ? 'Loading' : usersError ? 'Could not load' : 'In the directory'} />
        <StatTile label="All countries" icon={Globe} tone="accent" value={na ? 'N/A' : summary.all} sub="Role or all entry" />
        <StatTile label="Scoped" icon={MapPin} tone="good" value={na ? 'N/A' : summary.scoped} sub="Limited to named countries" />
        <StatTile label="No country access" icon={Ban} tone={summary.none ? 'warning' : 'default'} value={na ? 'N/A' : summary.none} sub="See no country records" />
      </div>

      <Toolbar className="justify-end">
        <Btn icon={FileSpreadsheet} onClick={() => runExport('excel')} busy={exporting === 'excel'} disabled={na || summary.total === 0}>Export scopes (Excel)</Btn>
        <Btn icon={FileText} onClick={() => runExport('pdf')} busy={exporting === 'pdf'} disabled={na || summary.total === 0}>PDF</Btn>
      </Toolbar>
      {exportError && <ErrorState message={exportError} />}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-4">
        <UserDirectory users={users} error={usersError} onRetry={loadUsers} refreshing={refreshing}
          selectedId={selectedId} onSelect={selectUser} describe={scopeLabel} />

        <div className="min-w-0">
          {!selectedUser ? (
            <Panel>
              <EmptyState icon={Globe} title="Select a user"
                reason="Choose someone from the directory to review and edit which countries they can see." />
            </Panel>
          ) : (
            <div className="space-y-4">
              <Panel>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-gray-800 flex items-center justify-center shrink-0 text-sm font-semibold text-gray-300" aria-hidden="true">
                    {displayName(selectedUser).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-gray-100 flex items-center gap-1.5">
                      {displayName(selectedUser)}
                      {selectedUser.is_super_admin && <Crown size={14} className="text-amber-400" aria-label="Super admin" />}
                    </h3>
                    <p className="text-xs text-gray-400 truncate">{selectedUser.email || selectedUser.username}</p>
                  </div>
                  <Badge icon={ShieldCheck}>{selectedUser.role || 'No role'}</Badge>
                </div>
                {seesAll && (
                  <div className="mt-3">
                    <Note tone="warning" icon={Crown}>
                      This role sees every country regardless of the scope below. Any value here is stored but does
                      not restrict what they can see.
                    </Note>
                  </div>
                )}
              </Panel>

              <Panel>
                <PanelHeader icon={MapPin} title="Assigned countries"
                  subtitle={draft.length ? `${draft.length} selected` : seesAll ? 'Sees all countries through the role' : 'Empty means no country access'} />

                {draft.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-center">
                    <p className="text-sm text-gray-400">
                      {seesAll
                        ? <>No countries assigned. This role <span className="text-gray-100 font-medium">sees every country</span> regardless of this scope.</>
                        : <>No countries assigned. This user has <span className="text-gray-100 font-medium">no country access</span> and cannot see country-tagged records until you assign one.</>}
                    </p>
                  </div>
                ) : (
                  <ul className="flex flex-wrap gap-2" aria-label="Assigned countries">
                    {draft.map((c) => (
                      <li key={c} className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-full bg-orange-500/15 text-orange-200 border border-orange-700/50 text-sm">
                        <Globe size={12} aria-hidden="true" /> {c}
                        <Btn size="xs" variant="quiet" icon={X} title={`Remove ${c}`} ariaLabel={`Remove ${c}`} onClick={() => removeCountry(c)} className="!px-1 !py-0.5" />
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mt-4 mb-2">Add from list</p>
                <div className="flex flex-wrap gap-1.5">
                  {countryPalette.map((c) => {
                    const on = draft.includes(c)
                    return (
                      <Btn key={c} size="sm" icon={on ? Check : Plus} aria-pressed={on}
                        className={on ? '!border-orange-600/60 !text-orange-200 !bg-orange-950/30' : ''}
                        onClick={() => (on ? removeCountry(c) : addCountry(c))}>
                        {c}
                      </Btn>
                    )
                  })}
                </div>

                <label htmlFor="country-scope-custom" className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold mt-4 mb-2">
                  Add another country
                </label>
                <div className="flex gap-2">
                  <input
                    id="country-scope-custom"
                    className="flex-1 px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                    placeholder="Type a country code or name"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
                  />
                  <Btn icon={Plus} onClick={addCustom} disabled={!custom.trim()}>Add</Btn>
                </div>

                {saveError && <div className="mt-4"><ErrorState message={saveError} onRetry={save} /></div>}
                {saved && !dirty && (
                  <div className="mt-4" role="status"><Note tone="accent" icon={Check}>{saved}</Note></div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-4 border-t border-gray-800">
                  <p className="text-xs text-gray-400">{dirty ? 'You have unsaved changes.' : 'No changes since last save.'}</p>
                  <div className="flex items-center gap-2">
                    <Btn onClick={() => { setDraft(baseline); setCustom('') }} disabled={!dirty || saving}>Reset</Btn>
                    <Btn variant="primary" icon={Save} onClick={save} busy={saving} disabled={!dirty}>
                      {saving ? 'Saving...' : 'Save scope'}
                    </Btn>
                  </div>
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
