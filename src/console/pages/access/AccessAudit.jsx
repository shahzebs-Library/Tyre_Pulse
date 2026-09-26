/**
 * AccessAudit.jsx - the immutable trail of every access change, inside the
 * console Access Control host.
 *
 * Reads adminAccess.listAccessAudit({ limit, target }) (a super-admin-only,
 * newest-first RPC over the access_audit table). Each row is
 * { id, actor, actor_email, action, target_user, entity, before, after, at }.
 * Read-only forensic view: KPI tiles for the loaded window, a daily activity
 * trend, a sortable filterable table with a compact before-to-after diff, and
 * Excel/PDF export of exactly what is on screen.
 *
 * Target uuids resolve to names through the users directory (listProfiles).
 * If that directory cannot be read the trail still renders, with a note that
 * names are unavailable, rather than silently showing bare ids as if normal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ScrollText, RefreshCw, Crown, ChevronDown, ChevronRight, FileSpreadsheet, FileText,
  Users, UserCheck, UserPlus, UserMinus, Activity,
} from 'lucide-react'
import { listProfiles } from '../../../lib/api/users'
import { listAccessAudit } from '../../../lib/api/adminAccess'
import { toUserMessage } from '../../../lib/safeError'
import { actionKind, diffFields, KIND_TONE, summarizeAudit } from '../../../lib/accessAuditView'
import { dailySeries } from '../../../lib/consoleCharts'
import { exportConsoleRows, sortRows, useTableSort } from '../../../lib/consoleTable'
import { usePaged, Pager, Collapsible } from '../accessKit'
import {
  Badge, Btn, EmptyState, ErrorState, LoadingState, Note, Panel, PanelHeader, SearchInput, Select,
  StatTile, Table, THead, Th, Tr, Td, Toolbar,
} from '../../components/ui'
import { TrendChart } from '../../components/ui/charts'

const LIMIT_OPTIONS = [50, 100, 200, 500]

function displayName(u) {
  return u?.full_name || u?.username || u?.email || 'Unnamed user'
}

function fmtWhen(value) {
  if (!value) return 'N/A'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function AccessAudit() {
  const [rows, setRows] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(100)
  const [entityFilter, setEntityFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [targetFilter, setTargetFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [exporting, setExporting] = useState('')
  const [exportError, setExportError] = useState('')
  const { sort, onSort } = useTableSort({ key: 'at', dir: 'desc' })

  const [users, setUsers] = useState([])
  const [usersError, setUsersError] = useState(false)

  useEffect(() => {
    let alive = true
    listProfiles()
      .then((r) => { if (alive) { setUsers(Array.isArray(r) ? r : []); setUsersError(false) } })
      .catch(() => { if (alive) { setUsers([]); setUsersError(true) } })
    return () => { alive = false }
  }, [])

  const userById = useMemo(() => {
    const m = new Map()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])

  const load = useCallback(async () => {
    setRows(null); setError('')
    try {
      const target = targetFilter === 'all' ? null : targetFilter
      const data = await listAccessAudit({ limit, target })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the access audit trail.'))
      setRows([])
    }
  }, [limit, targetFilter])

  useEffect(() => { load() }, [load])

  const targetName = useCallback((id) => {
    if (!id) return ''
    const u = userById.get(id)
    return u ? displayName(u) : `${String(id).slice(0, 8)}...`
  }, [userById])

  const entityOptions = useMemo(() => {
    const set = new Set()
    for (const r of rows || []) if (r.entity) set.add(r.entity)
    return Array.from(set).sort()
  }, [rows])

  // Prefer target ids present in the trail; fall back to the whole directory so
  // the operator can always pick a target, even after a server-side filter.
  const targetOptions = useMemo(() => {
    const ids = new Set()
    for (const r of rows || []) if (r.target_user) ids.add(r.target_user)
    const list = Array.from(ids).map((id) => ({ value: id, label: targetName(id) }))
    const base = list.length <= 1 ? users.map((u) => ({ value: u.id, label: displayName(u) })) : list
    return base.sort((x, y) => x.label.localeCompare(y.label))
  }, [rows, users, targetName])

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (entityFilter !== 'all' && r.entity !== entityFilter) return false
      if (kindFilter !== 'all' && actionKind(r.action) !== kindFilter) return false
      if (q) {
        const hay = [r.action, r.entity, r.actor_email, targetName(r.target_user)]
          .map((x) => String(x || '').toLowerCase()).join(' ')
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, entityFilter, kindFilter, search, targetName])

  const sorted = useMemo(
    () => sortRows(visibleRows, sort, { target: (r) => targetName(r.target_user), changes: (r) => diffFields(r.before, r.after).length }),
    [visibleRows, sort, targetName],
  )

  const summary = useMemo(() => summarizeAudit(rows || []), [rows])
  const trend = useMemo(() => dailySeries(rows || [], (r) => r.at, 30), [rows])

  function toggleRow(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function runExport(format) {
    setExporting(format); setExportError('')
    try {
      await exportConsoleRows({
        rows: sorted,
        title: 'Access Audit Trail',
        format,
        columns: [
          { key: 'at', header: 'When', value: (r) => fmtWhen(r.at) },
          { key: 'actor_email', header: 'Actor' },
          { key: 'action', header: 'Action' },
          { key: 'entity', header: 'Entity' },
          { key: 'target', header: 'Target user', value: (r) => targetName(r.target_user) },
          { key: 'change', header: 'Change', value: (r) => diffFields(r.before, r.after).map((f) => `${f.key}: ${f.from} to ${f.to}`).join('; ') },
        ],
      })
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not create the export file.'))
    } finally {
      setExporting('')
    }
  }

  const loading = rows === null
  const na = loading || !!error
  const kindTile = (k) => setKindFilter((cur) => (cur === k ? 'all' : k))
  const paged = usePaged(sorted, 25, `${search}|${kindFilter}|${entityFilter}|${targetFilter}|${limit}|${sort?.key}|${sort?.dir}`)

  return (
    <div className="space-y-4">
      <Note icon={ScrollText}>
        Every access change is recorded here: who did it, what changed, and when. This is a read-only,
        newest-first forensic trail. The figures below cover the {limit} most recent entries loaded.
      </Note>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile label="Entries loaded" icon={Activity} value={na ? 'N/A' : summary.total}
          sub={loading ? 'Loading' : error ? 'Could not load' : `Latest ${fmtWhen(summary.latest)}`}
          onClick={() => setKindFilter('all')} active={kindFilter === 'all'} />
        <StatTile label="Actors" icon={Users} value={na ? 'N/A' : summary.actors} sub="People making changes" />
        <StatTile label="Users affected" icon={UserCheck} value={na ? 'N/A' : summary.targets} sub="Distinct targets" />
        <StatTile label="Grants" icon={UserPlus} tone="good" value={na ? 'N/A' : summary.byKind.grant}
          sub="Access added" onClick={() => kindTile('grant')} active={kindFilter === 'grant'} />
        <StatTile label="Removals" icon={UserMinus} tone={summary.byKind.removal ? 'danger' : 'default'} value={na ? 'N/A' : summary.byKind.removal}
          sub="Access taken away" onClick={() => kindTile('removal')} active={kindFilter === 'removal'} />
      </div>

      <Collapsible icon={Activity} title="Access changes per day" subtitle="Last 30 days, from the entries loaded"
        count={na ? null : trend.total}>
        {loading ? <LoadingState label="Loading activity" rows={2} /> : error ? (
          <p className="text-xs text-gray-400">Activity is unavailable because the trail could not be read.</p>
        ) : (
          <TrendChart labels={trend.labels} series={[{ label: 'Changes', values: trend.values }]} height={180}
            summary={`${trend.total} access changes in the last 30 days of the loaded window.`}
            emptyText="No access changes in the last 30 days." />
        )}
      </Collapsible>

      <Panel>
        <PanelHeader icon={ScrollText} title="Audit trail"
          subtitle={na ? undefined : `${sorted.length} of ${rows.length} loaded entries shown`}
          actions={(
            <>
              <Btn icon={FileSpreadsheet} onClick={() => runExport('excel')} busy={exporting === 'excel'} disabled={na || sorted.length === 0}>Excel</Btn>
              <Btn icon={FileText} onClick={() => runExport('pdf')} busy={exporting === 'pdf'} disabled={na || sorted.length === 0}>PDF</Btn>
              <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
            </>
          )} />

        <Toolbar className="mb-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search actor, action, entity or target" className="flex-1 min-w-[200px]" />
          <Select value={kindFilter} onChange={setKindFilter} ariaLabel="Filter by change type" className="w-40"
            options={[
              { value: 'all', label: 'All change types' },
              { value: 'grant', label: 'Grants' }, { value: 'removal', label: 'Removals' },
              { value: 'role', label: 'Role changes' }, { value: 'scope', label: 'Scope changes' },
              { value: 'change', label: 'Updates' }, { value: 'other', label: 'Other' },
            ]} />
          <Select value={entityFilter} onChange={setEntityFilter} ariaLabel="Filter by entity" className="w-40"
            options={[{ value: 'all', label: 'All entities' }, ...entityOptions.map((e) => ({ value: e, label: e }))]} />
          <Select value={targetFilter} onChange={setTargetFilter} ariaLabel="Filter by target user" className="w-48"
            options={[{ value: 'all', label: 'All target users' }, ...targetOptions]} />
          <Select value={String(limit)} onChange={(v) => setLimit(Number(v))} ariaLabel="Entries to load" className="w-32"
            options={LIMIT_OPTIONS.map((n) => ({ value: String(n), label: `Last ${n}` }))} />
        </Toolbar>

        {usersError && (
          <div className="mb-3">
            <Note tone="warning">The user directory could not be read, so target users show as short ids instead of names.</Note>
          </div>
        )}
        {exportError && <div className="mb-3"><ErrorState message={exportError} /></div>}

        {loading ? (
          <LoadingState label="Loading the access audit trail" rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : sorted.length === 0 ? (
          <EmptyState icon={ScrollText}
            title={rows.length === 0 ? 'No access changes recorded' : 'No entries match'}
            reason={rows.length === 0
              ? 'The trail has no entries for the selected target user.'
              : 'Nothing in the loaded entries matches this search and these filters.'} />
        ) : (
          <>
          <Table>
            <THead>
              <Th><span className="sr-only">Expand</span></Th>
              <Th sortKey="at" sort={sort} onSort={onSort}>When</Th>
              <Th sortKey="actor_email" sort={sort} onSort={onSort}>Actor</Th>
              <Th sortKey="action" sort={sort} onSort={onSort}>Action</Th>
              <Th sortKey="entity" sort={sort} onSort={onSort}>Entity</Th>
              <Th sortKey="target" sort={sort} onSort={onSort}>Target user</Th>
              <Th sortKey="changes" sort={sort} onSort={onSort}>Change</Th>
            </THead>
            <tbody>
              {paged.pageRows.map((r) => {
                const fields = diffFields(r.before, r.after)
                const open = expanded.has(r.id)
                const target = userById.get(r.target_user)
                const preview = fields.slice(0, open ? fields.length : 2)
                return (
                  <Tr key={r.id}>
                    <Td>
                      {fields.length > 2 && (
                        <Btn size="xs" variant="quiet" icon={open ? ChevronDown : ChevronRight}
                          title={open ? 'Collapse' : 'Expand'} ariaLabel={open ? 'Collapse change details' : 'Expand change details'}
                          aria-expanded={open} onClick={() => toggleRow(r.id)} />
                      )}
                    </Td>
                    <Td nowrap className="text-gray-300">{fmtWhen(r.at)}</Td>
                    <Td nowrap className="text-gray-200">{r.actor_email || 'N/A'}</Td>
                    <Td nowrap><Badge tone={KIND_TONE[actionKind(r.action)]}>{r.action || 'N/A'}</Badge></Td>
                    <Td nowrap className="text-gray-300">{r.entity || 'N/A'}</Td>
                    <Td nowrap>
                      {r.target_user ? (
                        <span className="inline-flex items-center gap-1.5 text-gray-200">
                          {target?.is_super_admin && <Crown size={11} className="text-amber-400" aria-label="Super admin" />}
                          {targetName(r.target_user)}
                        </span>
                      ) : <span className="text-gray-400">N/A</span>}
                    </Td>
                    <Td>
                      {fields.length === 0 ? (
                        <span className="text-gray-400">No field changes recorded</span>
                      ) : (
                        <div className="space-y-1">
                          {preview.map((f) => (
                            <div key={f.key} className="leading-relaxed break-words">
                              <span className="text-gray-400">{f.key}: </span>
                              <span className="text-red-300">{f.from}</span>
                              <span className="text-gray-400"> to </span>
                              <span className="text-emerald-300">{f.to}</span>
                            </div>
                          ))}
                          {!open && fields.length > 2 && (
                            <button type="button" onClick={() => toggleRow(r.id)}
                              className="text-[11px] text-orange-300 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                              +{fields.length - 2} more
                            </button>
                          )}
                        </div>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
          <Pager {...paged} onPage={paged.setPage} className="border-t-0" />
          </>
        )}
      </Panel>
    </div>
  )
}
