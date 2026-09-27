/**
 * ConsoleSessions - super-admin "Sessions & Devices" console page.
 *
 * A pure console page (navy + orange theme, useConsoleAuth for the admin gate).
 * Two sections:
 *   1. Users & Devices - every user's login + device (push token) state, with
 *      Lock / Unlock (via the existing admin_update_profile path) and Clear push
 *      token (V273 admin_clear_push_token RPC) row actions. Search + role /
 *      locked / device filters. Excel export.
 *   2. Recent console activity - the console_sessions audit trail (who did what,
 *      when, to which target).
 *
 * HONESTY: "Clear push token" removes the push notification channel for a device;
 * it does NOT revoke the user's auth session. True session revocation needs a
 * service-role edge function and is NOT built here - the banner says so.
 *
 * Both reads throw on failure and are loaded independently, so a failed read
 * shows its own error with Retry and never renders as "no users" or "no
 * activity"; the headline tiles read N/A until the user list has loaded. The
 * Admin column used to print a raw uuid; it now resolves the admin's
 * name from the same profiles read and falls back to the id.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MonitorSmartphone, ShieldAlert, Lock, Unlock, Smartphone, BellOff,
  FileSpreadsheet, FileText, History, CheckCircle2, Users, Clock, ArrowUpRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Btn, SearchInput, Select, Toolbar, Segmented,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal, Code,
} from '../components/ui'
import { TrendChart, BarsChart } from '../components/ui/charts'
import { dailySeries } from '../../lib/consoleCharts'
import {
  listUserDevices, listConsoleSessions, lockUser, clearPushToken,
} from '../../lib/api/consoleSessions'
import { toUserMessage } from '../../lib/safeError'
import KnownConsoleDevices from './sessions/KnownConsoleDevices'
import { exportConsoleRows, sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { PageHeader, useUrlTab, useRefreshStamp, usePaged, Pager, Drawer, DetailList, AttentionList } from './shared/pageKit'
import ExportButtons from './shared/ExportButtons'

const TABS = ['users', 'activity', 'devices', 'insights']

const ACTIVITY_LIMIT = 200
const TREND_DAYS = 30

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Country reach as the database enforces it (V309): Admin sees every country,
 * an ALL or * entry grants every country, and for anyone else an empty scope
 * means no country access, not all of them.
 */
export function countryLabel(c, role) {
  if (role === 'Admin') return 'All countries'
  const arr = (Array.isArray(c) ? c : [c]).map((x) => String(x ?? '').trim()).filter(Boolean)
  if (arr.some((x) => ['ALL', '*'].includes(x.toUpperCase()))) return 'All countries'
  return arr.length ? arr.join(', ') : 'No country access'
}

/**
 * How recently each user last signed in, in five buckets. `profiles` records
 * only the LAST sign-in per user, not every sign-in, so this is recency of the
 * user base rather than a count of sign-ins.
 */
export function recencyBuckets(users = [], now = Date.now()) {
  const b = { day: 0, week: 0, month: 0, older: 0, never: 0 }
  for (const u of users || []) {
    const t = u?.last_login_at ? new Date(u.last_login_at).getTime() : NaN
    if (!Number.isFinite(t)) { b.never += 1; continue }
    const age = (now - t) / 86400000
    if (age <= 1) b.day += 1
    else if (age <= 7) b.week += 1
    else if (age <= 30) b.month += 1
    else b.older += 1
  }
  return [
    { key: 'day', label: 'Last 24 hours', value: b.day },
    { key: 'week', label: '1 to 7 days', value: b.week },
    { key: 'month', label: '8 to 30 days', value: b.month },
    { key: 'older', label: 'Over 30 days', value: b.older },
    { key: 'never', label: 'Never signed in', value: b.never },
  ]
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function ConsoleSessions() {
  const { admin } = useConsoleAuth()

  const [devices, setDevices] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)          // users and devices could not be read
  const [activityError, setActivityError] = useState(null) // console activity could not be read
  const [actionError, setActionError] = useState(null)     // lock, clear or export failed
  const [busyId, setBusyId] = useState(null)
  const [confirmLock, setConfirmLock] = useState(null)
  const [exporting, setExporting] = useState('')
  const { sort, setSort, onSort } = useTableSort({ key: 'last_login_at', dir: 'desc' })

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [lockedFilter, setLockedFilter] = useState('all') // all | locked | active
  const [deviceFilter, setDeviceFilter] = useState('all') // all | with | without

  // Pending "clear push token" confirmation: the device row, or null.
  const [confirmClear, setConfirmClear] = useState(null)
  const [detail, setDetail] = useState(null)
  const [activitySearch, setActivitySearch] = useState('')
  const [tab, setTab] = useUrlTab(TABS, 'users')
  const { refreshedAt, stamp } = useRefreshStamp()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null); setActivityError(null)
    // Independent reads: one failing must not blank the other.
    const [d, s] = await Promise.allSettled([listUserDevices(), listConsoleSessions({ limit: ACTIVITY_LIMIT })])
    if (d.status === 'fulfilled') setDevices(d.value)
    else { setDevices([]); setError(toUserMessage(d.reason, 'Could not load users and devices.')) }
    if (s.status === 'fulfilled') setSessions(s.value)
    else { setSessions([]); setActivityError(toUserMessage(s.reason, 'Could not load console activity.')) }
    setLoading(false)
    stamp()
  }, [stamp])

  useEffect(() => { load() }, [load])

  const roles = useMemo(() => {
    const set = new Set()
    for (const d of devices) if (d.role) set.add(d.role)
    return Array.from(set).sort()
  }, [devices])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return devices.filter((d) => {
      if (roleFilter !== 'all' && d.role !== roleFilter) return false
      if (lockedFilter === 'locked' && !d.locked) return false
      if (lockedFilter === 'active' && d.locked) return false
      if (deviceFilter === 'with' && !d.has_device) return false
      if (deviceFilter === 'without' && d.has_device) return false
      if (!q) return true
      return (
        String(d.full_name || '').toLowerCase().includes(q) ||
        String(d.username || '').toLowerCase().includes(q)
      )
    })
  }, [devices, search, roleFilter, lockedFilter, deviceFilter])
  const sorted = useMemo(() => sortRows(filtered, sort, {
    name: (d) => d.full_name || d.username,
    country: (d) => countryLabel(d.country, d.role),
    status: (d) => (d.locked ? 1 : 0),
    device: (d) => (d.has_device ? d.push_token_updated_at || '1' : null),
  }), [filtered, sort])

  const counts = useMemo(() => ({
    total: devices.length,
    locked: devices.filter((d) => d.locked).length,
    withDevice: devices.filter((d) => d.has_device).length,
    active7: devices.filter((d) => {
      const t = d.last_login_at ? new Date(d.last_login_at).getTime() : NaN
      return Number.isFinite(t) && Date.now() - t <= 7 * 86400000
    }).length,
  }), [devices])

  const nameById = useMemo(() => {
    const m = new Map()
    devices.forEach((d) => m.set(d.id, d.full_name || d.username || null))
    return m
  }, [devices])

  const recency = useMemo(() => recencyBuckets(devices), [devices])
  const activity = useMemo(() => dailySeries(sessions, (s) => s.created_at, TREND_DAYS), [sessions])
  const activityCapped = sessions.length >= ACTIVITY_LIMIT
  const hasFilters = !!(search || roleFilter !== 'all' || lockedFilter !== 'all' || deviceFilter !== 'all')
  const clearFilters = () => { setSearch(''); setRoleFilter('all'); setLockedFilter('all'); setDeviceFilter('all') }

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function handleLock(row, locked) {
    setBusyId(row.id)
    setActionError(null)
    try {
      await lockUser(row.id, locked)
      setDevices((prev) => prev.map((d) => (d.id === row.id ? { ...d, locked } : d)))
      setDetail((d) => (d && d.id === row.id ? { ...d, locked } : d))
      setConfirmLock(null)
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not change the account lock.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleClearPush() {
    const row = confirmClear
    if (!row) return
    setConfirmClear(null)
    setBusyId(row.id)
    setActionError(null)
    try {
      await clearPushToken(row.id)
      setDevices((prev) => prev.map((d) => (
        d.id === row.id ? { ...d, has_device: false, push_token_updated_at: new Date().toISOString() } : d
      )))
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not clear the device.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleExport(format) {
    setExporting(format); setActionError(null)
    try {
      await exportConsoleRows({
        rows: sorted,
        title: 'Users and Devices',
        format,
        columns: [
          { key: 'full_name', header: 'Name' },
          { key: 'username', header: 'Username' },
          { key: 'role', header: 'Role' },
          { key: 'country', header: 'Country', value: (d) => countryLabel(d.country, d.role) },
          { key: 'locked', header: 'Status', value: (d) => (d.locked ? 'Locked' : 'Active') },
          { key: 'has_device', header: 'Has device', value: (d) => (d.has_device ? 'Yes' : 'No') },
          { key: 'push_token_updated_at', header: 'Device updated', value: (d) => (d.has_device ? fmtDateTime(d.push_token_updated_at) : '') },
          { key: 'last_login_at', header: 'Last login', value: (d) => fmtDateTime(d.last_login_at) },
          { key: 'login_count', header: 'Login count', value: (d) => d.login_count ?? 0 },
        ],
      })
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Please try again.'))
    } finally {
      setExporting('')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────────

  const val = (n) => (loading || error ? 'N/A' : n)
  const pagedUsers = usePaged(sorted, 25, `${search}|${roleFilter}|${lockedFilter}|${deviceFilter}|${sort?.key}|${sort?.dir}`)
  const adminName = (s) => (s.admin_id ? (nameById.get(s.admin_id) || String(s.admin_id).slice(0, 8)) : 'N/A')
  const targetName = (s) => `${s.target_type ? `${s.target_type}: ` : ''}${s.target_id ? (nameById.get(s.target_id) || s.target_id) : 'N/A'}`
  const visibleActivity = useMemo(() => searchRows(sessions, activitySearch, [
    (s) => adminName(s), (s) => s.action, (s) => targetName(s),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [sessions, activitySearch, nameById])
  const pagedActivity = usePaged(visibleActivity, 25, activitySearch)

  const neverSignedIn = recency.find((r) => r.key === 'never')?.value || 0
  const dormant = recency.find((r) => r.key === 'older')?.value || 0
  const attention = []
  if (!error && !loading) {
    if (counts.locked) attention.push({ key: 'locked', tone: 'warning', title: `${counts.locked} account${counts.locked === 1 ? ' is' : 's are'} locked`,
      detail: 'Check each lock is still intended; a forgotten lock blocks someone from their work.',
      action: { label: 'Show locked', onClick: () => { setLockedFilter('locked'); setTab('users') } } })
    if (dormant) attention.push({ key: 'dormant', tone: 'info', title: `${dormant} user${dormant === 1 ? ' has' : 's have'} not signed in for over 30 days`,
      detail: 'Dormant accounts are the usual first candidates in an access review.',
      action: { label: 'Review', onClick: () => { setSort({ key: 'last_login_at', dir: 'asc' }); setTab('users') } } })
    if (neverSignedIn) attention.push({ key: 'never', tone: 'info', title: `${neverSignedIn} user${neverSignedIn === 1 ? ' has' : 's have'} never signed in`,
      detail: 'Often an account set up for someone who never started, or who uses a different login.' })
  }

  function actionsFor(d) {
    const busy = busyId === d.id
    return (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {d.locked ? (
          <Btn size="xs" variant="good" icon={Unlock} busy={busy} onClick={() => handleLock(d, false)}>Unlock</Btn>
        ) : (
          <Btn size="xs" variant="danger" icon={Lock} busy={busy} onClick={() => { setActionError(null); setDetail(null); setConfirmLock(d) }}>Lock</Btn>
        )}
        <Btn size="xs" icon={BellOff} disabled={busy || !d.has_device}
          title={d.has_device ? 'Clear push token' : 'No device to clear'}
          onClick={() => { setDetail(null); setConfirmClear(d) }}>Clear device</Btn>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={MonitorSmartphone} title="Sessions & Devices"
        purpose={`${admin?.full_name ? `Signed in as ${admin.full_name}. ` : ''}Review who is signing in, which devices carry a push token, and lock accounts or clear devices.`}
        actions={(
          <>
            <Btn icon={FileSpreadsheet} onClick={() => handleExport('excel')} busy={exporting === 'excel'} disabled={loading || !!error || filtered.length === 0}>Export Excel</Btn>
            <Btn icon={FileText} onClick={() => handleExport('pdf')} busy={exporting === 'pdf'} disabled={loading || !!error || filtered.length === 0}>PDF</Btn>
          </>
        )}
        refreshedAt={refreshedAt} onRefresh={load} refreshing={loading} />

      {error && !loading && <ErrorState message={error} onRetry={load} />}
      {actionError && <ErrorState message={actionError} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Users" value={val(counts.total)} icon={Users}
          onClick={() => { setLockedFilter('all'); setDeviceFilter('all'); setTab('users') }} />
        <StatTile label="Signed in, last 7 days" value={val(counts.active7)} tone="good" icon={Clock}
          sub={loading || error || !counts.total ? undefined : `${Math.round((counts.active7 / counts.total) * 100)}% of users`}
          onClick={() => setTab('insights')} />
        <StatTile label="With a device" value={val(counts.withDevice)} icon={Smartphone}
          onClick={() => { setDeviceFilter(deviceFilter === 'with' ? 'all' : 'with'); setTab('users') }} active={deviceFilter === 'with'}
          sub="Carry a push token" />
        <StatTile label="Locked" value={val(counts.locked)} tone={counts.locked ? 'danger' : 'default'} icon={Lock}
          onClick={() => { setLockedFilter(lockedFilter === 'locked' ? 'all' : 'locked'); setTab('users') }} active={lockedFilter === 'locked'} />
      </div>

      <Segmented ariaLabel="Sessions views" value={tab} onChange={setTab} options={[
        { key: 'users', label: 'Users and devices', count: loading || error ? null : counts.total },
        { key: 'activity', label: 'Console activity', count: loading || activityError ? null : sessions.length },
        { key: 'devices', label: 'Known console devices' },
        { key: 'insights', label: 'Insights' },
      ]} />

      {tab === 'users' && (
        <div role="tabpanel" aria-label="Users and devices" className="space-y-4">
          <AttentionList ready={!loading && !error} items={attention} />
          <Note icon={ShieldAlert} tone="accent">
            Locking an account blocks future sign-in. Clearing a push token stops server-sent notifications to
            that device. Neither ends an already-open browser session: to sign someone out everywhere, use
            {' '}<Link to="/console/users" className="text-orange-300 underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">Users</Link>, Sign out everywhere.
          </Note>
          <Panel flush>
            <div className="p-4 pb-3 space-y-3">
              <PanelHeader icon={Users} title="Users & Devices" subtitle={loading || error ? undefined : `${filtered.length} of ${counts.total} users shown. Select a row for detail.`} />
              <Toolbar>
                <SearchInput value={search} onChange={setSearch} placeholder="Search by name or username" className="flex-1 min-w-[180px]" />
                <Select value={roleFilter} onChange={setRoleFilter} ariaLabel="Filter by role" className="w-40"
                  options={[{ value: 'all', label: 'All roles' }, ...roles.map((r) => ({ value: r, label: r }))]} />
                <Select value={lockedFilter} onChange={setLockedFilter} ariaLabel="Filter by status" className="w-36" options={[
                  { value: 'all', label: 'Any status' },
                  { value: 'active', label: 'Active only' },
                  { value: 'locked', label: 'Locked only' },
                ]} />
                <Select value={deviceFilter} onChange={setDeviceFilter} ariaLabel="Filter by device" className="w-36" options={[
                  { value: 'all', label: 'Any device' },
                  { value: 'with', label: 'Has device' },
                  { value: 'without', label: 'No device' },
                ]} />
                {hasFilters && <Btn variant="quiet" onClick={clearFilters}>Clear</Btn>}
              </Toolbar>
            </div>

            {loading ? (
              <div className="px-4"><LoadingState label="Loading users" rows={6} /></div>
            ) : error ? (
              <EmptyState icon={Users} title="Users unavailable" reason="The user list could not be read. Use Retry above." />
            ) : devices.length === 0 ? (
              <EmptyState icon={Users} title="No users to show" reason="The user list returned no accounts." />
            ) : filtered.length === 0 ? (
              <EmptyState title="No users match your filters" reason="Every user is hidden by the current search or filters."
                action={<Btn onClick={clearFilters}>Clear filters</Btn>} />
            ) : (
              <>
                <Table className="border-0 rounded-none">
                  <THead>
                    <Th sortKey="name" sort={sort} onSort={onSort}>User</Th>
                    <Th sortKey="role" sort={sort} onSort={onSort}>Role</Th>
                    <Th sortKey="country" sort={sort} onSort={onSort}>Country</Th>
                    <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
                    <Th sortKey="device" sort={sort} onSort={onSort}>Device</Th>
                    <Th sortKey="last_login_at" sort={sort} onSort={onSort}>Last login</Th>
                    <Th align="right" sortKey="login_count" sort={sort} onSort={onSort}>Logins</Th>
                    <Th align="right">Actions</Th>
                  </THead>
                  <tbody>
                    {pagedUsers.pageRows.map((d) => (
                      <Tr key={d.id} onClick={() => setDetail(d)} ariaLabel={`Open ${d.full_name || d.username || 'user'}`}>
                        <Td>
                          <p className="text-gray-100 font-medium">{d.full_name || 'Unnamed'}</p>
                          <p className="text-[11px] text-gray-400">{d.username || 'No username'}</p>
                        </Td>
                        <Td className="text-gray-300">{d.role || 'N/A'}</Td>
                        <Td className="text-gray-300">{countryLabel(d.country, d.role)}</Td>
                        <Td>{d.locked ? <Badge tone="danger" icon={Lock}>Locked</Badge> : <Badge tone="good">Active</Badge>}</Td>
                        <Td nowrap>
                          {d.has_device
                            ? <Badge tone="good" icon={Smartphone} title={`Updated ${fmtDateTime(d.push_token_updated_at)}`}>{fmtDateTime(d.push_token_updated_at)}</Badge>
                            : <Badge tone="quiet">None</Badge>}
                        </Td>
                        <Td nowrap className="text-gray-400">{fmtDateTime(d.last_login_at)}</Td>
                        <Td align="right" className="text-gray-300 tabular-nums">{d.login_count ?? 0}</Td>
                        <Td align="right">{actionsFor(d)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager {...pagedUsers} onPage={pagedUsers.setPage} />
              </>
            )}
          </Panel>
        </div>
      )}

      {tab === 'activity' && (
        <div role="tabpanel" aria-label="Console activity">
          <Panel flush>
            <div className="p-4 pb-3 space-y-3">
              <PanelHeader icon={History} title="Recent console activity"
                subtitle={activityCapped ? `The latest ${ACTIVITY_LIMIT} console actions, newest first` : 'Every console action on record, newest first'}
                actions={!activityError && (
                  <ExportButtons rows={visibleActivity} title="Console activity" columns={[
                    { key: 'created_at', header: 'When', value: (x) => fmtDateTime(x.created_at) },
                    { key: 'admin', header: 'Admin', value: adminName },
                    { key: 'action', header: 'Action', value: (x) => (x.action ? String(x.action).replace(/_/g, ' ') : '') },
                    { key: 'target', header: 'Target', value: targetName },
                  ]} />
                )} />
              {!activityError && sessions.length > 0 && (
                <SearchInput value={activitySearch} onChange={setActivitySearch} placeholder="Search admin, action or target" className="max-w-sm" />
              )}
            </div>
            {loading ? (
              <div className="px-4"><LoadingState label="Loading activity" /></div>
            ) : activityError ? (
              <div className="px-4 pb-4"><ErrorState message={activityError} onRetry={load} /></div>
            ) : sessions.length === 0 ? (
              <EmptyState icon={History} title="No console activity recorded"
                reason="Actions taken in the console appear here as they happen." />
            ) : visibleActivity.length === 0 ? (
              <EmptyState title="No actions match" reason="Nothing in the recent activity matches the search." />
            ) : (
              <>
                <Table className="border-0 rounded-none">
                  <THead>
                    <Th>When</Th>
                    <Th>Admin</Th>
                    <Th>Action</Th>
                    <Th>Target</Th>
                  </THead>
                  <tbody>
                    {pagedActivity.pageRows.map((x) => (
                      <Tr key={x.id}>
                        <Td nowrap className="text-gray-400 tabular-nums">{fmtDateTime(x.created_at)}</Td>
                        <Td className="text-gray-300">
                          {x.admin_id ? (nameById.get(x.admin_id) || <Code title={x.admin_id}>{String(x.admin_id).slice(0, 8)}</Code>) : 'N/A'}
                        </Td>
                        <Td><Badge>{x.action ? String(x.action).replace(/_/g, ' ') : 'N/A'}</Badge></Td>
                        <Td className="text-gray-400">{targetName(x)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager {...pagedActivity} onPage={pagedActivity.setPage} />
              </>
            )}
          </Panel>
        </div>
      )}

      {tab === 'devices' && (
        <div role="tabpanel" aria-label="Known console devices"><KnownConsoleDevices /></div>
      )}

      {tab === 'insights' && (
        <div role="tabpanel" aria-label="Insights" className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader icon={Clock} title="Last sign-in recency"
              subtitle="When each user last signed in. Profiles record only the latest sign-in, not every one." />
            {loading ? <LoadingState rows={3} /> : error ? (
              <EmptyState title="Not available" reason="The user list could not be read." />
            ) : (
              <>
                <BarsChart bars={recency.map((r) => ({ label: r.label, value: r.value }))}
                  summary={recency.map((r) => `${r.label} ${r.value}`).join(', ')}
                  emptyText="No users to show." />
                {counts.total > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <p className="text-[11px] text-gray-400">Device coverage: {counts.withDevice} of {counts.total} users carry a push token</p>
                    <ProportionBar total={counts.total} segments={[
                      { label: 'With a device', value: counts.withDevice, tone: 'good' },
                      { label: 'No device', value: counts.total - counts.withDevice, tone: 'muted' },
                    ]} />
                  </div>
                )}
              </>
            )}
          </Panel>
          <Panel>
            <PanelHeader icon={History} title="Console activity per day"
              subtitle={activityCapped
                ? `Last ${TREND_DAYS} days, drawn from the latest ${ACTIVITY_LIMIT} console actions only`
                : `Last ${TREND_DAYS} days, ${activity.total} console action${activity.total === 1 ? '' : 's'}`} />
            {loading ? <LoadingState rows={3} /> : activityError ? (
              <ErrorState message={activityError} onRetry={load} />
            ) : (
              <TrendChart labels={activity.labels} series={[{ label: 'Actions', values: activity.values }]} height={200}
                summary={`${activity.total} console actions in the last ${TREND_DAYS} days`}
                emptyText="No console activity in the last 30 days." />
            )}
          </Panel>
        </div>
      )}

      <Drawer open={!!detail} title={detail ? (detail.full_name || detail.username || 'User') : ''} subtitle={detail?.username}
        onClose={() => setDetail(null)} footer={detail ? actionsFor(detail) : null}>
        {detail && (
          <>
            <DetailList items={[
              ['Role', detail.role],
              ['Country', countryLabel(detail.country, detail.role)],
              ['Status', detail.locked ? 'Locked' : 'Active'],
              ['Last login', fmtDateTime(detail.last_login_at)],
              ['Logins', String(detail.login_count ?? 0)],
              ['Device', detail.has_device ? `Push token, updated ${fmtDateTime(detail.push_token_updated_at)}` : 'None'],
            ]} />
            <Link to="/console/users" className="inline-flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              Manage role, scope or sign out everywhere in Users <ArrowUpRight size={11} aria-hidden="true" />
            </Link>
          </>
        )}
      </Drawer>

      <Modal
        open={!!confirmClear}
        width="max-w-md"
        title="Clear push token"
        onClose={() => setConfirmClear(null)}
        footer={(
          <>
            <Btn onClick={() => setConfirmClear(null)}>Cancel</Btn>
            <Btn variant="primary" icon={CheckCircle2} onClick={handleClearPush}>Clear device</Btn>
          </>
        )}
      >
        {confirmClear && (
          <div className="space-y-3">
            <p className="text-xs text-gray-300 leading-relaxed">
              Remove the push notification token for{' '}
              <span className="font-semibold text-gray-100">{confirmClear.full_name || confirmClear.username || 'this user'}</span>?
              Their device will stop receiving server-sent notifications until they sign in again on that device.
            </p>
            <p className="text-[11px] text-gray-400">This does not lock the account or end an open session.</p>
          </div>
        )}
      </Modal>

      <Modal
        open={!!confirmLock}
        width="max-w-md"
        title="Lock this account?"
        subtitle={confirmLock ? (confirmLock.full_name || confirmLock.username || 'This user') : undefined}
        onClose={() => { if (!busyId) setConfirmLock(null) }}
        footer={(
          <>
            <Btn onClick={() => setConfirmLock(null)} disabled={!!busyId}>Cancel</Btn>
            <Btn variant="danger" icon={Lock} busy={!!busyId} onClick={() => handleLock(confirmLock, true)}>Lock account</Btn>
          </>
        )}
      >
        {actionError && <div className="mb-3"><ErrorState message={actionError} /></div>}
        <p className="text-xs text-gray-300 leading-relaxed">
          They cannot sign in to the app until the account is unlocked. The change is recorded in the audit trail.
        </p>
      </Modal>
    </div>
  )
}
