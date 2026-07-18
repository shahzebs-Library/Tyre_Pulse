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
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MonitorSmartphone, RefreshCw, Search, Filter, AlertTriangle, X,
  ShieldAlert, Lock, Unlock, Smartphone, BellOff, Download, History,
  CheckCircle2, Users,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listUserDevices, listConsoleSessions, lockUser, clearPushToken,
} from '../../lib/api/consoleSessions'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel } from '../../lib/exportUtils'

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

// ── Small building blocks ───────────────────────────────────────────────────────

function SummaryTile({ label, value, tone, icon: Icon }) {
  const ring = {
    green: 'border-emerald-800/40 bg-emerald-900/10 text-emerald-300',
    amber: 'border-amber-800/40 bg-amber-900/10 text-amber-300',
    red: 'border-red-800/40 bg-red-900/10 text-red-300',
    blue: 'border-blue-800/40 bg-blue-900/10 text-blue-300',
  }[tone] || 'border-gray-800 bg-gray-900/40 text-gray-300'
  return (
    <div className={`rounded-xl border p-3 ${ring}`}>
      <Icon size={16} className="mb-1.5 opacity-80" />
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-[11px] font-semibold mt-0.5">{label}</p>
    </div>
  )
}

function ErrorBar({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-red-800/40 bg-red-900/15 p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-red-300" />
        <p className="text-xs text-red-200">{message}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="text-xs text-red-300 hover:text-white underline">Retry</button>
      )}
    </div>
  )
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
      const [d, s] = await Promise.all([listUserDevices(), listConsoleSessions({ limit: 200 })])
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
  }), [devices])

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function handleLock(row, locked) {
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

  function handleExport() {
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
    exportToExcel(rows, colKeys, headers, 'TyrePulse Users and Devices', 'Users')
  }

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <MonitorSmartphone size={20} className="text-orange-400" /> Sessions &amp; Devices
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {admin?.full_name ? `Signed in as ${admin.full_name}. ` : ''}
            Review who is signing in, which devices carry a push token, and lock accounts or clear devices.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Honest scope banner */}
      <div className="flex items-start gap-2 rounded-xl border border-blue-800/40 bg-blue-900/15 p-3">
        <ShieldAlert size={16} className="text-blue-300 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-200/90 leading-relaxed">
          Locking an account blocks future sign-in. Clearing a push token stops server-sent notifications to
          that device. Neither instantly ends an already-open browser session: true session revocation needs a
          service-role function and is not built here yet.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryTile label="Users" value={counts.total} tone="blue" icon={Users} />
        <SummaryTile label="Locked" value={counts.locked} tone="red" icon={Lock} />
        <SummaryTile label="With a device" value={counts.withDevice} tone="green" icon={Smartphone} />
      </div>

      {error && !loading && <ErrorBar message={error} onRetry={load} />}

      {/* ── Section 1: Users & Devices ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40">
        <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Users size={15} className="text-orange-400" /> Users &amp; Devices
          </h2>
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:text-white text-[11px] border border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={12} /> Export Excel
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap px-4 py-3 border-b border-gray-800">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or username"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-gray-500" />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="py-1.5 pl-2 pr-7 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:border-orange-600"
            >
              <option value="all">All roles</option>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select
              value={lockedFilter}
              onChange={(e) => setLockedFilter(e.target.value)}
              className="py-1.5 pl-2 pr-7 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:border-orange-600"
            >
              <option value="all">Any status</option>
              <option value="active">Active only</option>
              <option value="locked">Locked only</option>
            </select>
            <select
              value={deviceFilter}
              onChange={(e) => setDeviceFilter(e.target.value)}
              className="py-1.5 pl-2 pr-7 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:border-orange-600"
            >
              <option value="all">Any device</option>
              <option value="with">Has device</option>
              <option value="without">No device</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-gray-900/60 animate-pulse" />
            ))}
          </div>
        ) : devices.length === 0 ? (
          <div className="p-8 text-center">
            <Users size={26} className="mx-auto text-gray-700 mb-2" />
            <p className="text-sm font-semibold text-gray-300">No users to show</p>
            <p className="text-xs text-gray-600 mt-1">Nothing was returned. Refresh to try again.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-semibold text-gray-300">No users match your filters</p>
            <button
              onClick={() => { setSearch(''); setRoleFilter('all'); setLockedFilter('all'); setDeviceFilter('all') }}
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white text-xs border border-gray-700"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-2 font-semibold">User</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="px-3 py-2 font-semibold">Country</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Device</th>
                  <th className="px-3 py-2 font-semibold">Last login</th>
                  <th className="px-3 py-2 font-semibold text-right">Logins</th>
                  <th className="px-3 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const busy = busyId === d.id
                  return (
                    <tr key={d.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                      <td className="px-4 py-2.5">
                        <p className="text-white font-medium">{d.full_name || 'Unnamed'}</p>
                        <p className="text-[11px] text-gray-500">{d.username || 'no username'}</p>
                      </td>
                      <td className="px-3 py-2.5 text-gray-300">{d.role || 'N/A'}</td>
                      <td className="px-3 py-2.5 text-gray-400">{countryLabel(d.country)}</td>
                      <td className="px-3 py-2.5">
                        {d.locked ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold border text-red-300 bg-red-900/30 border-red-700/40">Locked</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold border text-emerald-300 bg-emerald-900/30 border-emerald-700/40">Active</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {d.has_device ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-emerald-300" title={`Updated ${fmtDateTime(d.push_token_updated_at)}`}>
                            <span className="h-2 w-2 rounded-full bg-emerald-400" /> {fmtDateTime(d.push_token_updated_at)}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[11px] text-gray-600">
                            <span className="h-2 w-2 rounded-full bg-gray-600" /> None
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 text-[12px]">{fmtDateTime(d.last_login_at)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-300">{d.login_count ?? 0}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {d.locked ? (
                            <button
                              onClick={() => handleLock(d, false)}
                              disabled={busy}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 text-white text-[11px] font-semibold disabled:opacity-50"
                            >
                              <Unlock size={11} /> Unlock
                            </button>
                          ) : (
                            <button
                              onClick={() => handleLock(d, true)}
                              disabled={busy}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-700/80 hover:bg-red-600 text-white text-[11px] font-semibold disabled:opacity-50"
                            >
                              <Lock size={11} /> Lock
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmClear(d)}
                            disabled={busy || !d.has_device}
                            title={d.has_device ? 'Clear push token' : 'No device to clear'}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-[11px] font-semibold border border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <BellOff size={11} /> Clear device
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 2: Recent console activity ───────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40">
        <div className="px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <History size={15} className="text-orange-400" /> Recent console activity
          </h2>
        </div>
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 rounded-lg bg-gray-900/60 animate-pulse" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center">
            <History size={24} className="mx-auto text-gray-700 mb-2" />
            <p className="text-sm font-semibold text-gray-300">No console activity recorded</p>
            <p className="text-xs text-gray-600 mt-1">Actions taken in the console will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Admin</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Target</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                    <td className="px-4 py-2.5 text-gray-400 text-[12px] whitespace-nowrap">{fmtDateTime(s.created_at)}</td>
                    <td className="px-3 py-2.5 text-gray-300 text-[12px]">{s.admin_id || 'N/A'}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700">
                        {s.action || 'N/A'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-400 text-[12px]">
                      {s.target_type ? `${s.target_type}: ` : ''}{s.target_id || 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Clear-push confirm modal */}
      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <BellOff size={15} className="text-amber-400" /> Clear push token
              </h3>
              <button onClick={() => setConfirmClear(null)} className="text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-300 leading-relaxed">
                Remove the push notification token for{' '}
                <span className="font-semibold text-white">{confirmClear.full_name || confirmClear.username || 'this user'}</span>?
                Their device will stop receiving server-sent notifications until they sign in again on that device.
              </p>
              <p className="text-[11px] text-gray-500">
                This does not lock the account or end an open session.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-800">
              <button
                onClick={() => setConfirmClear(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleClearPush}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500"
              >
                <CheckCircle2 size={13} /> Clear device
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
