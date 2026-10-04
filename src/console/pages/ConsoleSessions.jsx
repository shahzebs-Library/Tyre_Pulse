/**
 * ConsoleSessions - "Sessions & Devices" (also the Sessions and devices tab of
 * Users, tabParam="stab", where it shows a compact section header).
 *
 *   Users and devices  every account's sign-in state and phones, with Lock /
 *                      Unlock (reason + typed confirm, audited) and Stop push.
 *   Phones (new)       every row of user_devices via admin_list_user_devices
 *                      (migration 20261004104000). MOBILE = FLUTTER ONLY: a
 *                      non-Expo (FCM) token is the Flutter app; an Expo token is
 *                      shown as "Retired app (read-only)". Stop push to ONE
 *                      phone (admin_revoke_user_device, reason required).
 *   Console activity   the console_sessions audit trail.
 *   Known console devices, Insights.
 *
 * HONESTY: stopping push does NOT end an open session; "Sign out everywhere"
 * in Users does. Every read fails on its own with Retry and never renders as
 * "no users" or "no phones"; an unreadable figure reads N/A.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MonitorSmartphone, ShieldAlert, Lock, Unlock, Smartphone, BellOff,
  FileSpreadsheet, FileText, History, CheckCircle2, Users, Clock, ArrowUpRight, Archive, BellRing,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Btn, SearchInput, Select, Toolbar, Segmented,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Code, ConfirmImpactDialog,
} from '../components/ui'
import { TrendChart, BarsChart } from '../components/ui/charts'
import { dailySeries } from '../../lib/consoleCharts'
import {
  listUserDevices, listConsoleSessions, lockUser, clearPushToken,
} from '../../lib/api/consoleSessions'
import { toUserMessage } from '../../lib/safeError'
import KnownConsoleDevices from './sessions/KnownConsoleDevices'
import { exportConsoleRows, sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { useUrlTab, useRefreshStamp, usePaged, Pager, Drawer, DetailList, AttentionList } from './shared/pageKit'
import { SectionTop, ImpactLine, isEmbedded } from './platform/SectionKit'
import { listAllDevices, revokeDevice } from '../../lib/api/consolePeopleControls'
import { APP_LABEL, DEVICE_IDLE_DAYS, deviceSummary, filterDevices, daysSince, deviceTail } from '../../lib/consolePeopleControls'
import ExportButtons from './shared/ExportButtons'

const TABS = ['users', 'phones', 'activity', 'devices', 'insights']

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

export default function ConsoleSessions({ tabParam = 'tab' } = {}) {
  const embedded = isEmbedded(tabParam)
  const { admin, logAction } = useConsoleAuth()
  const [phones, setPhones] = useState([])
  const [phonesError, setPhonesError] = useState(null)
  const [phoneApp, setPhoneApp] = useState('all')
  const [phoneState, setPhoneState] = useState('all')
  const [phoneSearch, setPhoneSearch] = useState('')
  const [stopPhone, setStopPhone] = useState(null)
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [notice, setNotice] = useState('')

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
  const [tab, setTab] = useUrlTab(TABS, 'users', tabParam)
  const { refreshedAt, stamp } = useRefreshStamp()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null); setActivityError(null)
    // Independent reads: one failing must not blank the other.
    const [d, s, ph] = await Promise.allSettled([listUserDevices(), listConsoleSessions({ limit: ACTIVITY_LIMIT }), listAllDevices()])
    if (ph.status === 'fulfilled') { setPhones(ph.value); setPhonesError(null) }
    else { setPhones([]); setPhonesError(toUserMessage(ph.reason, 'Could not load the phone list.')) }
    if (d.status === 'fulfilled') setDevices(d.value)
    else { setDevices([]); setError(toUserMessage(d.reason, 'Could not load users and devices.')) }
    if (s.status === 'fulfilled') setSessions(s.value)
    else { setSessions([]); setActivityError(toUserMessage(s.reason, 'Could not load console activity.')) }
    setLoading(false)
    stamp()
  }, [stamp])

  useEffect(() => { load() }, [load])

  // Phones per person, from user_devices (Flutter = FCM token; an Expo token is the retired app).
  const phoneByUser = useMemo(() => {
    const m = new Map()
    for (const p of phones) {
      if (!p.user_id || p.revoked) continue
      const cur = m.get(p.user_id) || { flutter: 0, retired: 0 }
      if (p.app === 'flutter') cur.flutter += 1
      else if (p.app === 'retired_expo') cur.retired += 1
      m.set(p.user_id, cur)
    }
    return m
  }, [phones])
  const phoneOf = useCallback((d) => (phonesError ? null : (phoneByUser.get(d.id) || { flutter: 0, retired: 0 })), [phoneByUser, phonesError])
  const phoneStats = useMemo(() => deviceSummary(phones), [phones])
  const visiblePhones = useMemo(() => filterDevices(phones, { app: phoneApp, state: phoneState, search: phoneSearch }), [phones, phoneApp, phoneState, phoneSearch])
  const pagedPhones = usePaged(visiblePhones, 25, `${phoneApp}|${phoneState}|${phoneSearch}`)

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
      const ph = phoneOf(d)
      if (deviceFilter === 'with' && !(ph && ph.flutter > 0)) return false
      if (deviceFilter === 'without' && ph && ph.flutter > 0) return false
      if (deviceFilter === 'retired' && !(ph && ph.retired > 0)) return false
      if (!q) return true
      return (
        String(d.full_name || '').toLowerCase().includes(q) ||
        String(d.username || '').toLowerCase().includes(q)
      )
    })
  }, [devices, search, roleFilter, lockedFilter, deviceFilter, phoneOf])
  const sorted = useMemo(() => sortRows(filtered, sort, {
    name: (d) => d.full_name || d.username,
    country: (d) => countryLabel(d.country, d.role),
    status: (d) => (d.locked ? 1 : 0),
    device: (d) => { const ph = phoneOf(d); return ph ? ph.flutter * 1000 + ph.retired : null },
  }), [filtered, sort, phoneOf])

  const counts = useMemo(() => ({
    total: devices.length,
    locked: devices.filter((d) => d.locked).length,
    withDevice: phonesError ? null : devices.filter((d) => (phoneByUser.get(d.id)?.flutter || 0) > 0).length,
    retiredDevice: phonesError ? null : devices.filter((d) => (phoneByUser.get(d.id)?.retired || 0) > 0).length,
    active7: devices.filter((d) => {
      const t = d.last_login_at ? new Date(d.last_login_at).getTime() : NaN
      return Number.isFinite(t) && Date.now() - t <= 7 * 86400000
    }).length,
  }), [devices, phoneByUser, phonesError])

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

  async function handleLock(row, locked, reason) {
    setBusyId(row.id)
    setActionError(null)
    try {
      await lockUser(row.id, locked)
      await logAction?.(locked ? 'lock_user' : 'unlock_user', row.id, 'user', { reason: reason || null, from: 'sessions' })
      setDevices((prev) => prev.map((d) => (d.id === row.id ? { ...d, locked } : d)))
      setDetail((d) => (d && d.id === row.id ? { ...d, locked } : d))
      setConfirmLock(null)
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not change the account lock.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleClearPush(reason) {
    const row = confirmClear
    if (!row) return
    setConfirmClear(null)
    setBusyId(row.id)
    setActionError(null)
    try {
      await clearPushToken(row.id)
      await logAction?.('clear_push_token', row.id, 'user', { reason: reason || null })
      setPhones((prev) => prev.map((p) => (p.user_id === row.id ? { ...p, revoked: true } : p)))
      setDevices((prev) => prev.map((d) => (
        d.id === row.id ? { ...d, has_device: false, push_token_updated_at: new Date().toISOString() } : d
      )))
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not clear the device.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleStopPhone(reason) {
    if (!stopPhone) return
    setPhoneBusy(true); setActionError(null); setNotice('')
    try {
      await revokeDevice(stopPhone.id, reason)
      setPhones((prev) => prev.map((p) => (p.id === stopPhone.id ? { ...p, revoked: true } : p)))
      setNotice(`Push stopped for one ${APP_LABEL[stopPhone.app] || 'device'} of ${stopPhone.full_name || 'this person'}.`)
      setStopPhone(null)
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not stop push to this device.'))
    } finally {
      setPhoneBusy(false)
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
          { key: 'flutter', header: 'Flutter app devices', value: (d) => { const ph = phoneOf(d); return ph ? ph.flutter : 'N/A' } },
          { key: 'retired', header: 'Retired app devices', value: (d) => { const ph = phoneOf(d); return ph ? ph.retired : 'N/A' } },
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
      detail: 'Most are drivers set up ahead of the Flutter app. Owner ruling: do not lock these accounts.' })
    if (!phonesError && phoneStats.retiredActive > 0 && phoneStats.flutterActive === 0) attention.push({ key: 'flutter', tone: 'warning',
      title: 'No phone has the Flutter app registered yet',
      detail: `${phoneStats.retiredActive} phone${phoneStats.retiredActive === 1 ? ' still carries' : 's still carry'} only the retired app. Push reaches Flutter phones once people install the new build and sign in.`,
      action: { label: 'Show phones', onClick: () => setTab('phones') } })
  }

  function actionsFor(d) {
    const busy = busyId === d.id
    return (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {d.locked ? (
          <Btn size="xs" variant="good" icon={Unlock} busy={busy} onClick={() => handleLock(d, false, 'unlocked from sessions')}>Unlock</Btn>
        ) : (
          <Btn size="xs" variant="danger" icon={Lock} busy={busy} onClick={() => { setActionError(null); setDetail(null); setConfirmLock(d) }}>Lock</Btn>
        )}
        <Btn size="xs" icon={BellOff} disabled={busy || !(d.has_device || (phoneOf(d) && (phoneOf(d).flutter + phoneOf(d).retired) > 0))}
          title="Stop push to every phone of this person"
          onClick={() => { setDetail(null); setConfirmClear(d) }}>Clear device</Btn>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <SectionTop embedded={embedded} icon={MonitorSmartphone} title="Sessions & Devices"
        purpose={`${admin?.full_name ? `Signed in as ${admin.full_name}. ` : ''}Who is signing in, which phones can receive push (Flutter app), and lock accounts or stop push to a phone.`}
        actions={(
          <>
            <Btn icon={FileSpreadsheet} onClick={() => handleExport('excel')} busy={exporting === 'excel'} disabled={loading || !!error || filtered.length === 0}>Export Excel</Btn>
            <Btn icon={FileText} onClick={() => handleExport('pdf')} busy={exporting === 'pdf'} disabled={loading || !!error || filtered.length === 0}>PDF</Btn>
          </>
        )}
        refreshedAt={refreshedAt} onRefresh={load} refreshing={loading} />

      {error && !loading && <ErrorState message={error} onRetry={load} />}
      {actionError && <ErrorState message={actionError} />}
      {notice && <Note icon={CheckCircle2} tone="accent">{notice}</Note>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Users" value={val(counts.total)} icon={Users}
          onClick={() => { setLockedFilter('all'); setDeviceFilter('all'); setTab('users') }} />
        <StatTile label="Signed in, last 7 days" value={val(counts.active7)} tone="good" icon={Clock}
          sub={loading || error || !counts.total ? undefined : `${Math.round((counts.active7 / counts.total) * 100)}% of users`}
          onClick={() => setTab('insights')} />
        <StatTile label="On the Flutter app" value={counts.withDevice == null ? 'N/A' : val(counts.withDevice)} icon={Smartphone}
          onClick={() => { setDeviceFilter(deviceFilter === 'with' ? 'all' : 'with'); setTab('users') }} active={deviceFilter === 'with'}
          sub={phonesError ? 'Phone list could not be read' : 'People with a Flutter phone that gets push'} />
        <StatTile label="Retired app only" value={counts.retiredDevice == null ? 'N/A' : val(counts.retiredDevice)} icon={Archive}
          onClick={() => { setDeviceFilter(deviceFilter === 'retired' ? 'all' : 'retired'); setTab('users') }} active={deviceFilter === 'retired'}
          sub="Read-only history, the old app" />
        <StatTile label="Locked" value={val(counts.locked)} tone={counts.locked ? 'danger' : 'default'} icon={Lock}
          onClick={() => { setLockedFilter(lockedFilter === 'locked' ? 'all' : 'locked'); setTab('users') }} active={lockedFilter === 'locked'} />
      </div>

      <Segmented ariaLabel="Sessions views" value={tab} onChange={setTab} options={[
        { key: 'users', label: 'Users and devices', count: loading || error ? null : counts.total },
        { key: 'phones', label: 'Phones', count: loading || phonesError ? null : phoneStats.total },
        { key: 'activity', label: 'Console activity', count: loading || activityError ? null : sessions.length },
        { key: 'devices', label: 'Known console devices' },
        { key: 'insights', label: 'Insights' },
      ]} />

      {tab === 'users' && (
        <div role="tabpanel" aria-label="Users and devices" className="space-y-4">
          <AttentionList ready={!loading && !error} items={attention} />
          <Note icon={ShieldAlert} tone="accent">
            Locking an account blocks future sign-in. Stopping push ends server-sent notifications to that
            person&apos;s phones (Flutter app, and any retired-app token still on record). Neither ends an already-open browser session: to sign someone out everywhere, use
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
                  { value: 'with', label: 'Flutter phone' },
                  { value: 'without', label: 'No Flutter phone' },
                  { value: 'retired', label: 'Retired app phone' },
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
                        <Td nowrap><PhoneCell ph={phoneOf(d)} /></Td>
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

      {tab === 'phones' && (
        <div role="tabpanel" aria-label="Phones" className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Flutter phones getting push" icon={BellRing} value={phonesError ? 'N/A' : phoneStats.flutterActive}
              tone={!phonesError && phoneStats.flutterActive === 0 ? 'warning' : 'good'}
              sub={phonesError ? 'Could not be read' : phoneStats.flutterActive === 0 ? 'Nobody has signed in on a Flutter build yet' : `${phoneStats.flutterPeople} people`}
              onClick={() => { setPhoneApp('flutter'); setPhoneState('active') }} active={phoneApp === 'flutter' && phoneState === 'active'} />
            <StatTile label="Retired app phones" icon={Archive} value={phonesError ? 'N/A' : phoneStats.retiredActive}
              sub="Read-only: the old app, no new builds" onClick={() => { setPhoneApp('retired_expo'); setPhoneState('active') }}
              active={phoneApp === 'retired_expo' && phoneState === 'active'} />
            <StatTile label={`Idle over ${DEVICE_IDLE_DAYS} days`} icon={Clock} value={phonesError ? 'N/A' : phoneStats.idle}
              tone={phoneStats.idle ? 'warning' : 'default'} sub="Still registered, not seen lately"
              onClick={() => { setPhoneApp('all'); setPhoneState('idle') }} active={phoneState === 'idle'} />
            <StatTile label="Push stopped" icon={BellOff} value={phonesError ? 'N/A' : phoneStats.stopped}
              onClick={() => { setPhoneApp('all'); setPhoneState('stopped') }} active={phoneState === 'stopped'} />
          </div>
          <Panel flush>
            <div className="p-4 pb-3 space-y-3">
              <PanelHeader icon={Smartphone} title="Registered phones"
                subtitle={phonesError ? undefined : `${visiblePhones.length} of ${phoneStats.total} shown. Phones register when someone signs in on the app.`}
                actions={!phonesError && (
                  <ExportButtons rows={visiblePhones} title="Registered phones" columns={[
                    { key: 'full_name', header: 'Person', value: (x) => x.full_name || x.username || 'N/A' },
                    { key: 'role', header: 'Role' },
                    { key: 'app', header: 'App', value: (x) => APP_LABEL[x.app] || x.app },
                    { key: 'app_version', header: 'Version', value: (x) => x.app_version || 'Not reported' },
                    { key: 'last_seen_at', header: 'Last seen', value: (x) => fmtDateTime(x.last_seen_at) },
                    { key: 'revoked', header: 'Push', value: (x) => (x.revoked ? 'Stopped' : 'On') },
                  ]} />
                )} />
              <Toolbar>
                <SearchInput value={phoneSearch} onChange={setPhoneSearch} placeholder="Search person or role" className="w-full sm:flex-1 sm:min-w-[180px]" />
                <Select value={phoneApp} onChange={setPhoneApp} ariaLabel="Filter by app" className="w-full sm:w-44" options={[
                  { value: 'all', label: 'Any app' }, { value: 'flutter', label: 'Flutter app' }, { value: 'retired_expo', label: 'Retired app' },
                ]} />
                <Select value={phoneState} onChange={setPhoneState} ariaLabel="Filter by push state" className="w-full sm:w-40" options={[
                  { value: 'all', label: 'Any state' }, { value: 'active', label: 'Push on' }, { value: 'idle', label: 'Idle' }, { value: 'stopped', label: 'Push stopped' },
                ]} />
              </Toolbar>
              <ImpactLine change="Stop push removes one phone from server-sent notifications. The account, its data and its sign-in are untouched."
                who="Only the person who owns that phone." />
            </div>
            {loading ? <div className="px-4"><LoadingState label="Loading phones" rows={5} /></div> : phonesError ? (
              <div className="px-4 pb-4"><ErrorState message={phonesError} onRetry={load} /></div>
            ) : phones.length === 0 ? (
              <EmptyState icon={Smartphone} title="No phones registered" reason="No one has signed in on the mobile app with notifications allowed." />
            ) : visiblePhones.length === 0 ? (
              <EmptyState title="No phones match" reason="Clear the search or filters to see every phone."
                action={<Btn onClick={() => { setPhoneApp('all'); setPhoneState('all'); setPhoneSearch('') }}>Clear filters</Btn>} />
            ) : (
              <>
                <Table className="border-0 rounded-none">
                  <THead><Th>Person</Th><Th>App</Th><Th>Version</Th><Th>Device</Th><Th>Last seen</Th><Th>Push</Th><Th align="right">Action</Th></THead>
                  <tbody>
                    {pagedPhones.pageRows.map((x) => {
                      const age = daysSince(x.last_seen_at)
                      return (
                        <Tr key={x.id}>
                          <Td>
                            <p className="text-gray-100 font-medium">{x.full_name || 'Unnamed'}</p>
                            <p className="text-[11px] text-gray-400">{x.role || 'No role'}</p>
                          </Td>
                          <Td>{x.app === 'flutter' ? <Badge tone="good" icon={Smartphone}>Flutter app</Badge> : x.app === 'retired_expo' ? <Badge tone="quiet" icon={Archive}>Retired app (read-only)</Badge> : <Badge tone="quiet">Unknown</Badge>}</Td>
                          <Td className="text-gray-300 tabular-nums">{x.app_version || 'Not reported'}</Td>
                          <Td className="text-gray-400">{deviceTail(x.device_tail) || 'N/A'}</Td>
                          <Td nowrap className={age !== null && age > DEVICE_IDLE_DAYS ? 'text-amber-300' : 'text-gray-400'}>{fmtDateTime(x.last_seen_at)}</Td>
                          <Td>{x.revoked ? <Badge tone="quiet">Stopped</Badge> : <Badge tone="good">On</Badge>}</Td>
                          <Td align="right">
                            <Btn size="xs" icon={BellOff} variant="danger" disabled={x.revoked} onClick={() => { setActionError(null); setStopPhone(x) }}>Stop push</Btn>
                          </Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
                <Pager {...pagedPhones} onPage={pagedPhones.setPage} />
              </>
            )}
          </Panel>
          {!phonesError && Object.keys(phoneStats.versions).length > 0 && (
            <Panel>
              <PanelHeader icon={Smartphone} title="Flutter app versions in use" subtitle="Phones getting push, by the version they report" />
              <BarsChart bars={Object.entries(phoneStats.versions).map(([label, value]) => ({ label, value }))}
                summary={Object.entries(phoneStats.versions).map(([k, v]) => `${k} ${v}`).join(', ')} emptyText="No Flutter phones yet." />
            </Panel>
          )}
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
                    {counts.withDevice == null ? (
                      <p className="text-[11px] text-gray-400">Phone coverage: N/A, the phone list could not be read.</p>
                    ) : (
                      <>
                        <p className="text-[11px] text-gray-400">Phone coverage: {counts.withDevice} of {counts.total} users have a Flutter phone that gets push; {counts.retiredDevice} still only have the retired app.</p>
                        <ProportionBar total={counts.total} segments={[
                          { label: 'Flutter app', value: counts.withDevice, tone: 'good' },
                          { label: 'Retired app only', value: Math.max(0, counts.retiredDevice - counts.withDevice), tone: 'warning' },
                          { label: 'No phone', value: Math.max(0, counts.total - Math.max(counts.withDevice, counts.retiredDevice)), tone: 'muted' },
                        ]} />
                      </>
                    )}
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
              ['Flutter app phones', phoneOf(detail) ? String(phoneOf(detail).flutter) : 'N/A'],
              ['Retired app phones', phoneOf(detail) ? String(phoneOf(detail).retired) : 'N/A'],
              ['Retired app token on profile', detail.has_device ? `Yes, updated ${fmtDateTime(detail.push_token_updated_at)}` : 'No'],
            ]} />
            <Link to="/console/users" className="inline-flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              Manage role, scope or sign out everywhere in Users <ArrowUpRight size={11} aria-hidden="true" />
            </Link>
          </>
        )}
      </Drawer>

      <ConfirmImpactDialog
        open={!!confirmClear}
        title="Stop push to every phone of this person"
        confirmLabel="Stop push"
        danger
        requireReason
        impact={confirmClear ? {
          what: `Stop server-sent notifications for ${confirmClear.full_name || confirmClear.username || 'this user'}.`,
          change: 'Every registered phone of theirs stops receiving push, and the retired-app token on their profile is cleared.',
          who: 'Only this person. They keep their account and can still sign in.',
          undo: 'Yes. Push comes back the next time they sign in on the app.',
        } : undefined}
        onCancel={() => setConfirmClear(null)}
        onConfirm={({ reason }) => handleClearPush(reason)}
      />

      <ConfirmImpactDialog
        open={!!confirmLock}
        title="Lock this account?"
        confirmLabel="Lock account"
        danger
        requireReason
        typedWord="LOCK"
        busy={!!busyId}
        error={actionError}
        impact={confirmLock ? {
          tone: 'danger',
          what: `Lock ${confirmLock.full_name || confirmLock.username || 'this user'}.`,
          change: 'They cannot sign in to the web or the app until unlocked. An open session can keep working until its token expires; use Sign out everywhere in Users to end it now.',
          who: `${confirmLock.full_name || 'This person'}${confirmLock.role ? ` (${confirmLock.role})` : ''}.`,
          undo: 'Yes. Unlock at any time.',
        } : undefined}
        onCancel={() => { if (!busyId) setConfirmLock(null) }}
        onConfirm={({ reason }) => handleLock(confirmLock, true, reason)}
      />

      <ConfirmImpactDialog
        open={!!stopPhone}
        title="Stop push to this phone"
        confirmLabel="Stop push"
        danger
        requireReason
        busy={phoneBusy}
        error={actionError}
        impact={stopPhone ? {
          what: `One ${APP_LABEL[stopPhone.app] || 'phone'} of ${stopPhone.full_name || 'this person'}, last seen ${fmtDateTime(stopPhone.last_seen_at)}.`,
          change: 'This phone stops receiving server-sent notifications. Their other phones are not touched.',
          who: 'Only this person, on this phone.',
          undo: 'Yes. The phone registers again the next time they sign in on it.',
        } : undefined}
        onCancel={() => { if (!phoneBusy) setStopPhone(null) }}
        onConfirm={({ reason }) => handleStopPhone(reason)}
      />
    </div>
  )
}

/** Phone column: Flutter devices first, the retired app shown as read-only history. */
function PhoneCell({ ph }) {
  if (!ph) return <span className="text-[11px] text-gray-500">N/A</span>
  if (ph.flutter > 0) return <Badge tone="good" icon={Smartphone}>Flutter app{ph.flutter > 1 ? ` x${ph.flutter}` : ''}</Badge>
  if (ph.retired > 0) return <Badge tone="quiet" icon={Archive}>Retired app</Badge>
  return <Badge tone="quiet">None</Badge>
}
