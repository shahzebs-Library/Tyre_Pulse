/**
 * EffectivePermissions.jsx - the headline "what can this user actually do, and
 * why" viewer inside the console Access Control host.
 *
 * A user's real reach is not just their role: a per-user grant can open a module
 * the role cannot reach, a revoke can close one it normally can, and a super
 * admin bypasses everything. This screen resolves all of that server-side via
 * adminAccess.getEffectiveAccess(userId) and renders the resolution per module:
 * Role allows | Override | Capabilities | Final | Why. The module table can be
 * searched, sorted and exported so an auditor can hand the answer on.
 *
 * All data is read-only here (this is an explainer, not an editor - use the
 * Per-User Grants tab to change anything). The console guard already guarantees
 * a super-admin operator, so getEffectiveAccess never 42501s in practice; we
 * still surface a clean error state if the RPC fails for any reason.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Crown, Eye, CheckCircle2, XCircle, Globe, ShieldCheck,
  FileSpreadsheet, FileText,
} from 'lucide-react'
import { MODULE_LABEL } from '../../../lib/moduleCatalog'
import { CAPABILITIES } from '../../../lib/permissionMatrix'
import { listProfiles } from '../../../lib/api/users'
import { getEffectiveAccess } from '../../../lib/api/adminAccess'
import { toUserMessage } from '../../../lib/safeError'
import UserDirectory, { displayName } from './UserDirectory'
import { exportConsoleRows, searchRows, sortRows, useTableSort } from '../../../lib/consoleTable'
import { usePaged, Pager } from '../accessKit'
import {
  Badge, Btn, EmptyState, ErrorState, LoadingState, Note, Panel, PanelHeader, SearchInput, Segmented,
  StatTile, Table, THead, Th, Tr, Td, Toolbar,
} from '../../components/ui'

// Capability columns rendered in the matrix (view is the only one enforced today).
const CAP_COLS = CAPABILITIES.filter((c) =>
  ['view', 'create', 'edit', 'delete', 'export'].includes(c.key),
)

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

function capEffect(caps, key) {
  const v = caps && typeof caps === 'object' ? caps[key] : null
  return v === 'grant' || v === 'revoke' ? v : null
}

export default function EffectivePermissions() {
  const [users, setUsers] = useState(null) // null = loading
  const [usersError, setUsersError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  const [access, setAccess] = useState(null) // null = loading (when a user is selected)
  const [accessError, setAccessError] = useState('')
  const [moduleFilter, setModuleFilter] = useState('all')
  const [moduleSearch, setModuleSearch] = useState('')
  const [exporting, setExporting] = useState('')
  const [exportError, setExportError] = useState('')
  const { sort, onSort } = useTableSort({ key: 'label', dir: 'asc' })

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

  const loadAccess = useCallback(async (userId) => {
    if (!userId) { setAccess(null); return }
    setAccess(null); setAccessError('')
    try {
      const data = await getEffectiveAccess(userId)
      setAccess(data && typeof data === 'object' ? data : { modules: [] })
    } catch (err) {
      setAccessError(toUserMessage(err, 'Could not resolve effective access for this user.'))
      setAccess({ modules: [] })
    }
  }, [])

  useEffect(() => { loadAccess(selectedId) }, [selectedId, loadAccess])

  const modules = useMemo(
    () => (access?.modules || []).map((m) => ({ ...m, label: MODULE_LABEL[m.key] || m.key })),
    [access?.modules],
  )
  const isSuper = !!access?.is_super

  const counts = useMemo(() => {
    let allowed = 0, denied = 0, overridden = 0
    for (const m of modules) {
      if (m.final) allowed += 1; else denied += 1
      if (m.override) overridden += 1
    }
    return { allowed, denied, overridden, total: modules.length }
  }, [modules])

  const visibleModules = useMemo(() => {
    const byState = modules.filter((m) => {
      if (moduleFilter === 'allowed') return !!m.final
      if (moduleFilter === 'denied') return !m.final
      if (moduleFilter === 'overridden') return !!m.override
      return true
    })
    const searched = searchRows(byState, moduleSearch, ['label', 'key', 'reason'])
    return sortRows(searched, sort, {
      final: (m) => (m.final ? 1 : 0),
      role_allows: (m) => (m.role_allows ? 1 : 0),
    })
  }, [modules, moduleFilter, moduleSearch, sort])

  const paged = usePaged(visibleModules, 25, `${selectedId}|${moduleFilter}|${moduleSearch}|${sort?.key}|${sort?.dir}`)

  async function runExport(format) {
    if (!selectedUser) return
    setExporting(format); setExportError('')
    try {
      await exportConsoleRows({
        rows: visibleModules,
        title: `Effective Access ${displayName(selectedUser)}`,
        format,
        columns: [
          { key: 'label', header: 'Module' },
          { key: 'role_allows', header: 'Role allows', value: (m) => (m.role_allows ? 'Yes' : 'No') },
          { key: 'override', header: 'Override', value: (m) => m.override || 'None' },
          ...CAP_COLS.map((c) => ({ key: `cap_${c.key}`, header: c.label, value: (m) => capEffect(m.caps, c.key) || 'Role' })),
          { key: 'final', header: 'Final', value: (m) => (m.final ? 'Allowed' : 'Denied') },
          { key: 'reason', header: 'Why' },
        ],
      })
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not create the export file.'))
    } finally {
      setExporting('')
    }
  }

  const accessLoading = !!selectedUser && access === null
  const statValue = (v) => (accessLoading || accessError ? 'N/A' : v)

  return (
    <div className="space-y-4">
      <Note icon={Eye}>
        The definitive answer to what a person can actually do, and why. Access is resolved server side
        from the role baseline plus per-user grants and revokes. A super admin bypasses every gate.
        Capability columns marked stored are recorded but not yet enforced by the app.
      </Note>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-4">
        <UserDirectory users={users} error={usersError} onRetry={loadUsers} refreshing={refreshing}
          selectedId={selectedId} onSelect={setSelectedId} />

        {/* Right: resolved access */}
        <div className="min-w-0">
          {!selectedUser ? (
            <Panel>
              <EmptyState icon={Eye} title="Select a user"
                reason="Choose someone from the directory to see exactly which modules they can reach and the reason behind every decision." />
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
                      {(selectedUser.is_super_admin || isSuper) && <Crown size={14} className="text-amber-400" aria-label="Super admin" />}
                    </h3>
                    <p className="text-xs text-gray-400 truncate">{selectedUser.email || selectedUser.username}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge icon={ShieldCheck}>{access?.role || selectedUser.role || 'No role'}</Badge>
                    <Badge icon={Globe}>{countryLabel(
                      access?.country ?? selectedUser.country,
                      isSuper || selectedUser.is_super_admin || COUNTRY_SEES_ALL_ROLES.has(access?.role || selectedUser.role),
                    )}</Badge>
                    {(selectedUser.is_super_admin || isSuper) && <Badge tone="warning" icon={Crown}>Super admin</Badge>}
                  </div>
                </div>
              </Panel>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile label="Modules" value={statValue(counts.total)} onClick={() => setModuleFilter('all')} active={moduleFilter === 'all'} />
                <StatTile label="Allowed" tone="good" value={statValue(counts.allowed)} onClick={() => setModuleFilter('allowed')} active={moduleFilter === 'allowed'} />
                <StatTile label="Denied" tone="danger" value={statValue(counts.denied)} onClick={() => setModuleFilter('denied')} active={moduleFilter === 'denied'} />
                <StatTile label="Overridden" tone="warning" value={statValue(counts.overridden)} sub="Per-user grant or revoke"
                  onClick={() => setModuleFilter('overridden')} active={moduleFilter === 'overridden'} />
              </div>

              {isSuper && (
                <Note tone="warning" icon={Crown}>
                  This user is a super admin and bypasses all module and capability gates. Every module below
                  resolves to allowed regardless of role or grants.
                </Note>
              )}

              <Panel>
                <PanelHeader icon={ShieldCheck} title="Module resolution"
                  subtitle={accessLoading || accessError ? undefined : `${visibleModules.length} of ${modules.length} modules shown`}
                  actions={(
                    <>
                      <Btn icon={FileSpreadsheet} onClick={() => runExport('excel')} busy={exporting === 'excel'} disabled={accessLoading || !!accessError || visibleModules.length === 0}>Excel</Btn>
                      <Btn icon={FileText} onClick={() => runExport('pdf')} busy={exporting === 'pdf'} disabled={accessLoading || !!accessError || visibleModules.length === 0}>PDF</Btn>
                    </>
                  )} />
                <Toolbar className="mb-3">
                  <Segmented role="group" ariaLabel="Show modules" value={moduleFilter} onChange={setModuleFilter}
                    options={MODULE_FILTERS.map((f) => ({ key: f.key, label: f.label }))} />
                  <SearchInput value={moduleSearch} onChange={setModuleSearch} placeholder="Search module or reason" className="flex-1 min-w-[180px]" />
                </Toolbar>
                {exportError && <div className="mb-3"><ErrorState message={exportError} /></div>}

                {accessLoading ? (
                  <LoadingState label="Resolving access" rows={5} />
                ) : accessError ? (
                  <ErrorState message={accessError} onRetry={() => loadAccess(selectedId)} />
                ) : visibleModules.length === 0 ? (
                  <EmptyState icon={Eye}
                    title={modules.length === 0 ? 'No modules resolved' : 'No modules match'}
                    reason={modules.length === 0 ? 'The access resolver returned no modules for this user.' : 'Nothing matches this filter and search.'} />
                ) : (
                  <Table>
                    <THead>
                      <Th sortKey="label" sort={sort} onSort={onSort}>Module</Th>
                      <Th align="center" sortKey="role_allows" sort={sort} onSort={onSort}>Role</Th>
                      <Th align="center" sortKey="override" sort={sort} onSort={onSort}>Override</Th>
                      {CAP_COLS.map((c) => (
                        <Th key={c.key} align="center">
                          <span title={c.description}>{c.label}{!c.enforced && <span className="block text-[9px] font-normal text-gray-500">stored</span>}</span>
                        </Th>
                      ))}
                      <Th align="center" sortKey="final" sort={sort} onSort={onSort}>Final</Th>
                      <Th sortKey="reason" sort={sort} onSort={onSort}>Why</Th>
                    </THead>
                    <tbody>
                      {paged.pageRows.map((m) => (
                        <Tr key={m.key}>
                          <Td><span className="text-gray-100 font-medium">{m.label}</span></Td>
                          <Td align="center">
                            {m.role_allows
                              ? <CheckCircle2 size={15} className="inline text-emerald-400" aria-label="Role allows" />
                              : <XCircle size={15} className="inline text-gray-500" aria-label="Role does not allow" />}
                          </Td>
                          <Td align="center">
                            {m.override === 'grant' ? <Badge tone="good">Grant</Badge>
                              : m.override === 'revoke' ? <Badge tone="danger">Revoke</Badge>
                                : <span className="text-gray-400">None</span>}
                          </Td>
                          {CAP_COLS.map((c) => {
                            const eff = capEffect(m.caps, c.key)
                            return (
                              <Td key={c.key} align="center">
                                {eff === 'grant' ? <CheckCircle2 size={13} className="inline text-emerald-400" aria-label="Granted" />
                                  : eff === 'revoke' ? <XCircle size={13} className="inline text-red-400" aria-label="Revoked" />
                                    : <span className="text-gray-500 text-[11px]">Role</span>}
                              </Td>
                            )
                          })}
                          <Td align="center">
                            {m.final
                              ? <Badge tone="good" icon={CheckCircle2}>Allowed</Badge>
                              : <Badge tone="danger" icon={XCircle}>Denied</Badge>}
                          </Td>
                          <Td className="text-gray-300 max-w-[280px] break-words">{m.reason || 'N/A'}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                {!accessLoading && !accessError && <Pager {...paged} onPage={paged.setPage} className="border-t-0 px-0" />}
                <p className="text-[11px] text-gray-400 mt-3">
                  A tick or cross in a capability column is an explicit per-user grant or revoke. Role means the
                  capability is inherited from the role.
                </p>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
