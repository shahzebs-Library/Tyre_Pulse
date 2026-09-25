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
 * Both reads degrade to an empty list on any error (the service swallows it),
 * so an empty table says "nothing came back" rather than claiming there are no
 * users. The Admin column used to print a raw uuid; it now resolves the admin's
 * name from the same profiles read and falls back to the id.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MonitorSmartphone, RefreshCw, ShieldAlert, Lock, Unlock, Smartphone, BellOff,
  Download, History, CheckCircle2, Users, Clock,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Btn, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal, Code,
} from '../components/ui'
import { TrendChart, BarsChart } from '../components/ui/charts'
import { dailySeries } from '../../lib/consoleCharts'
import {
  listUserDevices, listConsoleSessions, lockUser, clearPushToken,
} from '../../lib/api/consoleSessions'
import { toUserMessage } from '../../lib/safeError'
import KnownConsoleDevices from './sessions/KnownConsoleDevices'
import { exportToExcel } from '../../lib/exportUtils'

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

function countryLabel(c) {
  if (Array.isArray(c)) return c.length ? c.join(', ') : 'All'
  return c || 'All'
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
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [lockedFilter, setLockedFilter] = useState('all') // all | locked | active
  const [deviceFilter, setDeviceFilter] = useState('all') // all | with | without

  // Pending "clear push token" confirmation: the device row, or null.
  const [confirmClear, setConfirmClear] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [d, s] = await Promise.all([listUserDevices(), listConsoleSessions({ limit: ACTIVITY_LIMIT })])
      setDevices(d)
      setSessions(s)
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

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
    if (locked && typeof window !== 'undefined' && window.confirm && !window.confirm(`Lock ${row.full_name || row.username || 'this user'}? They are signed out of the app until unlocked.`)) return
    setBusyId(row.id)
    setError(null)
    try {
      await lockUser(row.id, locked)
      setDevices((prev) => prev.map((d) => (d.id === row.id ? { ...d, locked } : d)))
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function handleClearPush() {
    const row = confirmClear
    if (!row) return
    setConfirmClear(null)
    setBusyId(row.id)
    setError(null)
    try {
      await clearPushToken(row.id)
      setDevices((prev) => prev.map((d) => (
        d.id === row.id ? { ...d, has_device: false, push_token_updated_at: new Date().toISOString() } : d
      )))
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function handleExport() {
    const rows = filtered.map((d) => ({
      full_name: d.full_name || '',
      username: d.username || '',
      role: d.role || '',
      country: countryLabel(d.country),
      locked: d.locked ? 'Locked' : 'Active',
      has_device: d.has_device ? 'Yes' : 'No',
      push_token_updated_at: fmtDateTime(d.push_token_updated_at),
      last_login_at: fmtDateTime(d.last_login_at),
      login_count: d.login_count ?? 0,
    }))
    const colKeys = ['full_name', 'username', 'role', 'country', 'locked', 'has_device', 'push_token_updated_at', 'last_login_at', 'login_count']
    const headers = ['Name', 'Username', 'Role', 'Country', 'Status', 'Has device', 'Device updated', 'Last login', 'Login count']
    try {
      await exportToExcel(rows, colKeys, headers, 'TyrePulse Users and Devices', 'Users')
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Please try again.'))
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────────

  const val = (n) => (loading ? 'N/A' : n)

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><MonitorSmartphone size={18} className="text-orange-400" /> Sessions &amp; Devices</h1>
          <p className="text-xs text-gray-500 mt-1">
            {admin?.full_name ? `Signed in as ${admin.full_name}. ` : ''}
            Review who is signing in, which devices carry a push token, and lock accounts or clear devices.
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
      </header>

      <Note icon={ShieldAlert} tone="accent">
        Locking an account blocks future sign-in. Clearing a push token stops server-sent notifications to
        that device. Neither instantly ends an already-open browser session: true session revocation needs a
        service-role function and is not built here yet.
      </Note>

      {error && !loading && <ErrorState message={error} onRetry={load} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Users" value={val(counts.total)} icon={Users} />
        <StatTile label="Signed in, last 7 days" value={val(counts.active7)} tone="good" icon={Clock}
          sub={loading || !counts.total ? undefined : `${Math.round((counts.active7 / counts.total) * 100)}% of users`} />
        <StatTile label="With a device" value={val(counts.withDevice)} icon={Smartphone}
          onClick={() => setDeviceFilter(deviceFilter === 'with' ? 'all' : 'with')} active={deviceFilter === 'with'}
          sub="Carry a push token" />
        <StatTile label="Locked" value={val(counts.locked)} tone={counts.locked ? 'danger' : 'default'} icon={Lock}
          onClick={() => setLockedFilter(lockedFilter === 'locked' ? 'all' : 'locked')} active={lockedFilter === 'locked'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader icon={Clock} title="Last sign-in recency"
            subtitle="When each user last signed in. Profiles record only the latest sign-in, not every one." />
          {loading ? <LoadingState rows={3} /> : (
            <>
              <BarsChart bars={recency.map((r) => ({ label: r.label, value: r.value }))}
                summary={recency.map((r) => `${r.label} ${r.value}`).join(', ')}
                emptyText="No users to show." />
              {counts.total > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[11px] text-gray-500">Device coverage: {counts.withDevice} of {counts.total} users carry a push token</p>
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
          {loading ? <LoadingState rows={3} /> : (
            <TrendChart labels={activity.labels} series={[{ label: 'Actions', values: activity.values }]} height={200}
              summary={`${activity.total} console actions in the last ${TREND_DAYS} days`}
              emptyText="No console activity in the last 30 days." />
          )}
        </Panel>
      </div>

      <KnownConsoleDevices />

      <Panel flush>
        <div className="p-4 pb-3 space-y-3">
          <PanelHeader icon={Users} title="Users & Devices" subtitle={`${filtered.length} of ${counts.total} users shown`}
            actions={<Btn icon={Download} onClick={handleExport} disabled={filtered.length === 0}>Export Excel</Btn>} />
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search by name or username" className="flex-1 min-w-[180px]" />
            <Select value={roleFilter} onChange={setRoleFilter} className="w-40"
              options={[{ value: 'all', label: 'All roles' }, ...roles.map((r) => ({ value: r, label: r }))]} />
            <Select value={lockedFilter} onChange={setLockedFilter} className="w-36" options={[
              { value: 'all', label: 'Any status' },
              { value: 'active', label: 'Active only' },
              { value: 'locked', label: 'Locked only' },
            ]} />
            <Select value={deviceFilter} onChange={setDeviceFilter} className="w-36" options={[
              { value: 'all', label: 'Any device' },
              { value: 'with', label: 'Has device' },
              { value: 'without', label: 'No device' },
            ]} />
            {hasFilters && <Btn variant="quiet" onClick={clearFilters}>Clear</Btn>}
          </Toolbar>
        </div>

        {loading ? (
          <div className="px-4"><LoadingState label="Loading users" rows={6} /></div>
        ) : devices.length === 0 ? (
          <EmptyState icon={Users} title="No users to show"
            reason="Nothing came back from the user list. It may be empty or could not be read; refresh to try again."
            action={<Btn icon={RefreshCw} onClick={load}>Refresh</Btn>} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No users match your filters" reason="Every user is hidden by the current search or filters."
            action={<Btn onClick={clearFilters}>Clear filters</Btn>} />
        ) : (
          <Table className="border-0 rounded-none">
            <THead>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Country</Th>
              <Th>Status</Th>
              <Th>Device</Th>
              <Th>Last login</Th>
              <Th align="right">Logins</Th>
              <Th align="right">Actions</Th>
            </THead>
            <tbody>
              {filtered.map((d) => {
                const busy = busyId === d.id
                return (
                  <Tr key={d.id}>
                    <Td>
                      <p className="text-gray-100 font-medium">{d.full_name || 'Unnamed'}</p>
                      <p className="text-[11px] text-gray-500">{d.username || 'No username'}</p>
                    </Td>
                    <Td className="text-gray-300">{d.role || 'N/A'}</Td>
                    <Td className="text-gray-400">{countryLabel(d.country)}</Td>
                    <Td>{d.locked ? <Badge tone="danger" icon={Lock}>Locked</Badge> : <Badge tone="good">Active</Badge>}</Td>
                    <Td nowrap>
                      {d.has_device
                        ? <Badge tone="good" icon={Smartphone} title={`Updated ${fmtDateTime(d.push_token_updated_at)}`}>{fmtDateTime(d.push_token_updated_at)}</Badge>
                        : <Badge tone="quiet">None</Badge>}
                    </Td>
                    <Td nowrap className="text-gray-400">{fmtDateTime(d.last_login_at)}</Td>
                    <Td align="right" className="text-gray-300 tabular-nums">{d.login_count ?? 0}</Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1.5">
                        {d.locked ? (
                          <Btn size="xs" variant="good" icon={Unlock} busy={busy} onClick={() => handleLock(d, false)}>Unlock</Btn>
                        ) : (
                          <Btn size="xs" variant="danger" icon={Lock} busy={busy} onClick={() => handleLock(d, true)}>Lock</Btn>
                        )}
                        <Btn size="xs" icon={BellOff} disabled={busy || !d.has_device}
                          title={d.has_device ? 'Clear push token' : 'No device to clear'}
                          onClick={() => setConfirmClear(d)}>Clear device</Btn>
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel flush>
        <div className="p-4 pb-2">
          <PanelHeader icon={History} title="Recent console activity"
            subtitle={activityCapped ? `The latest ${ACTIVITY_LIMIT} console actions, newest first` : 'Every console action on record, newest first'} />
        </div>
        {loading ? (
          <div className="px-4"><LoadingState label="Loading activity" /></div>
        ) : sessions.length === 0 ? (
          <EmptyState icon={History} title="No console activity recorded"
            reason="Actions taken in the console appear here. An empty list can also mean the trail could not be read." />
        ) : (
          <Table className="border-0 rounded-none">
            <THead>
              <Th>When</Th>
              <Th>Admin</Th>
              <Th>Action</Th>
              <Th>Target</Th>
            </THead>
            <tbody>
              {sessions.map((s) => (
                <Tr key={s.id}>
                  <Td nowrap className="text-gray-400 tabular-nums">{fmtDateTime(s.created_at)}</Td>
                  <Td className="text-gray-300">
                    {s.admin_id ? (nameById.get(s.admin_id) || <Code title={s.admin_id}>{String(s.admin_id).slice(0, 8)}</Code>) : 'N/A'}
                  </Td>
                  <Td><Badge>{s.action ? String(s.action).replace(/_/g, ' ') : 'N/A'}</Badge></Td>
                  <Td className="text-gray-400">
                    {s.target_type ? `${s.target_type}: ` : ''}{s.target_id ? (nameById.get(s.target_id) || s.target_id) : 'N/A'}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

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
            <p className="text-[11px] text-gray-500">This does not lock the account or end an open session.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
