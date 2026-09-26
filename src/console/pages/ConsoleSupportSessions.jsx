/**
 * ConsoleSupportSessions - platform-owner SUPPORT SESSIONS console (V318).
 *
 * A support session is a time-boxed, reason-required, read-only-by-default,
 * fully-audited authorization for a super-admin to inspect ONE customer
 * organisation during a support engagement.
 *
 *   1. Pick a target organisation, enter a REQUIRED reason, choose a duration
 *      (minutes, default 30) and a mode (read only / edit), then Start.
 *   2. The caller's CURRENT active session is shown with target org, mode and a
 *      live expiry countdown, plus an End button.
 *   3. A table of recent sessions (RLS already restricts to super-admin).
 *
 * IMPORTANT: this RECORDS / AUTHORIZES / AUDITS and DISPLAYS only. It does NOT
 * change app_current_org() or retarget reads to the inspected org (a deliberate,
 * separate follow-up). Super-admin only (the whole /console is gated). No raw
 * Supabase errors reach the UI; no em/en dashes.
 *
 * A session row whose expires_at has passed but was never ended still carries
 * active=true in the table. The list used to call those "Active", which told the
 * reader an authorization was open when it had already lapsed; they now read
 * "Expired".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LifeBuoy, ShieldCheck, Clock, Play, Square, RefreshCw, Eye, Pencil, Building2, Timer,
  FileSpreadsheet, FileText,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, Select, Toolbar, SearchInput, Modal,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { exportConsoleRows, sortRows, useTableSort } from '../../lib/consoleTable'
import { TrendChart } from '../components/ui/charts'
import { dailySeries } from '../../lib/consoleCharts'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { supabase } from '../../lib/api/_client'
import {
  startSupportSession, endSupportSession, getCurrentSupportSession,
} from '../../lib/api/supportSessions'
import { toUserMessage } from '../../lib/safeError'

const DURATIONS = [15, 30, 60, 120, 240]
const RECENT_LIMIT = 200
const TREND_DAYS = 30

/** active | expired | ended, from the row itself and the current clock. */
export function sessionState(row, nowMs = Date.now()) {
  if (!row) return 'ended'
  if (row.ended_at || row.active === false) return 'ended'
  const exp = row.expires_at ? new Date(row.expires_at).getTime() : NaN
  if (Number.isFinite(exp) && exp <= nowMs) return 'expired'
  return 'active'
}

const STATE_BADGE = {
  active: { label: 'Active', tone: 'good' },
  expired: { label: 'Expired', tone: 'warning' },
  ended: { label: 'Ended', tone: 'quiet' },
}

function ModeBadge({ mode }) {
  return mode === 'edit'
    ? <Badge tone="warning" icon={Pencil}>Edit</Badge>
    : <Badge tone="default" icon={Eye}>Read only</Badge>
}

const fmtDateTime = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

/** Whole minutes remaining until `expiresAt` (>= 0), or null when unknown. */
function minutesLeft(expiresAt, nowMs) {
  if (!expiresAt) return null
  const t = new Date(expiresAt).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.ceil((t - nowMs) / 60000))
}

export default function ConsoleSupportSessions() {
  const { orgs, logAction } = useConsoleAuth()

  const [targetOrg, setTargetOrg] = useState('')
  const [reason, setReason]       = useState('')
  const [minutes, setMinutes]     = useState(30)
  const [mode, setMode]           = useState('read_only')

  const [current, setCurrent]   = useState(null)
  const [recent, setRecent]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')      // the page could not be read
  const [actionError, setActionError] = useState('') // start, end or export failed
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [search, setSearch]     = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [modeFilter, setModeFilter] = useState('all')
  const [exporting, setExporting] = useState('')
  const { sort, onSort } = useTableSort({ key: 'started_at', dir: 'desc' })
  const [starting, setStarting] = useState(false)
  const [ending, setEnding]     = useState(false)
  const [nowMs, setNowMs]       = useState(() => Date.now())

  // Map org id -> name so target orgs on session rows always show a label.
  const orgName = useMemo(() => {
    const m = new Map()
    ;(orgs || []).forEach((o) => m.set(o.id, o.name))
    return m
  }, [orgs])
  const nameFor = useCallback((id) => orgName.get(id) || id || 'N/A', [orgName])

  const loadRecent = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('support_sessions')
      .select('id, target_org_id, reason, mode, started_at, expires_at, ended_at, active, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(RECENT_LIMIT)
    if (err) throw err
    return data || []
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [cur, rows] = await Promise.all([getCurrentSupportSession(), loadRecent()])
      setCurrent(cur)
      setRecent(rows)
    } catch (e) {
      setCurrent(null); setRecent([])
      setError(toUserMessage(e, 'Could not load support sessions.'))
    } finally {
      setLoading(false)
    }
  }, [loadRecent])

  useEffect(() => { load() }, [load])

  // Tick every 30s so the countdown stays fresh while a session is active.
  useEffect(() => {
    if (!current) return undefined
    const id = setInterval(() => setNowMs(Date.now()), 30000)
    return () => clearInterval(id)
  }, [current])

  async function handleStart() {
    if (!targetOrg) { setActionError('Select a target organisation.'); return }
    if (!reason.trim()) { setActionError('A reason is required to start a support session.'); return }
    setStarting(true); setActionError('')
    try {
      const row = await startSupportSession(targetOrg, reason.trim(), Number(minutes) || 30, mode)
      logAction?.('support_session_start', targetOrg, 'organisation', { minutes: Number(minutes) || 30, mode })
      setReason('')
      setNowMs(Date.now())
      // Prefer the authoritative current-session read, but fall back to the
      // returned row so the panel updates even if the read degrades.
      const cur = await getCurrentSupportSession()
      setCurrent(cur || row)
      setRecent(await loadRecent())
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not start the support session.'))
    } finally {
      setStarting(false)
    }
  }

  async function handleEnd() {
    if (!current?.id) return
    setEnding(true); setActionError('')
    try {
      await endSupportSession(current.id)
      logAction?.('support_session_end', current.target_org_id, 'organisation', { id: current.id })
      setCurrent(null)
      setConfirmEnd(false)
      setRecent(await loadRecent())
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not end the support session.'))
    } finally {
      setEnding(false)
    }
  }

  const remaining = current ? minutesLeft(current.expires_at, nowMs) : null

  const stats = useMemo(() => {
    const orgsSeen = new Set()
    let edit = 0; let open = 0; let durTotal = 0; let durN = 0
    recent.forEach((r) => {
      if (r.target_org_id) orgsSeen.add(r.target_org_id)
      if (r.mode === 'edit') edit += 1
      if (sessionState(r, nowMs) === 'active') open += 1
      const s = new Date(r.started_at).getTime()
      const e = new Date(r.ended_at || r.expires_at).getTime()
      if (Number.isFinite(s) && Number.isFinite(e) && e >= s) { durTotal += (e - s) / 60000; durN += 1 }
    })
    return { orgs: orgsSeen.size, edit, open, avgMin: durN ? Math.round(durTotal / durN) : null }
  }, [recent, nowMs])

  const trend = useMemo(() => dailySeries(recent, (r) => r.started_at || r.created_at, TREND_DAYS), [recent])
  const capped = recent.length >= RECENT_LIMIT
  const na = loading || !!error

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = recent.filter((r) => {
      if (stateFilter !== 'all' && sessionState(r, nowMs) !== stateFilter) return false
      if (modeFilter !== 'all' && r.mode !== modeFilter) return false
      if (q && !`${nameFor(r.target_org_id)} ${r.reason || ''}`.toLowerCase().includes(q)) return false
      return true
    })
    return sortRows(rows, sort, { org: (r) => nameFor(r.target_org_id), state: (r) => sessionState(r, nowMs) })
  }, [recent, search, stateFilter, modeFilter, sort, nowMs, nameFor])

  async function runExport(format) {
    setExporting(format); setActionError('')
    try {
      await exportConsoleRows({
        rows: visible,
        title: 'Support Sessions',
        format,
        columns: [
          { key: 'org', header: 'Organisation', value: (r) => nameFor(r.target_org_id) },
          { key: 'mode', header: 'Mode', value: (r) => (r.mode === 'edit' ? 'Edit' : 'Read only') },
          { key: 'reason', header: 'Reason' },
          { key: 'started_at', header: 'Started', value: (r) => fmtDateTime(r.started_at) },
          { key: 'expires_at', header: 'Expires', value: (r) => fmtDateTime(r.expires_at) },
          { key: 'ended_at', header: 'Ended', value: (r) => (r.ended_at ? fmtDateTime(r.ended_at) : '') },
          { key: 'state', header: 'Status', value: (r) => STATE_BADGE[sessionState(r, nowMs)].label },
        ],
      })
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not create the export file.'))
    } finally {
      setExporting('')
    }
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><LifeBuoy size={18} className="text-orange-400" /> Support Sessions</h1>
          <p className="text-xs text-gray-400 mt-1">Authorize a time-boxed, audited window to inspect one customer organisation during a support engagement.</p>
        </div>
        <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
      </header>

      <Note icon={ShieldCheck} tone="accent">
        Starting a session records and audits the authorization only. It does not yet retarget what data your reads return. Every start and end is logged.
      </Note>

      <ErrorState message={error} onRetry={load} />
      <ErrorState message={actionError} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Sessions listed" value={na ? 'N/A' : recent.length}
          sub={capped ? `Latest ${RECENT_LIMIT} only` : 'All on record'} icon={Clock} />
        <StatTile label="Open now" value={na ? 'N/A' : stats.open} tone={stats.open ? 'accent' : 'default'} icon={Eye} />
        <StatTile label="Edit mode" value={na ? 'N/A' : stats.edit} tone={stats.edit ? 'warning' : 'default'}
          sub="Sessions that allowed changes" icon={Pencil} />
        <StatTile label="Average length" value={na || stats.avgMin == null ? 'N/A' : `${stats.avgMin}m`}
          sub={na ? undefined : `${stats.orgs} organisation${stats.orgs === 1 ? '' : 's'} inspected`} icon={Timer} />
      </div>

      {current ? (
        <Panel tone="accent">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-orange-500/15 border border-orange-700/50">
                <Eye size={16} className="text-orange-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-100 flex items-center gap-2">
                  Inspecting {nameFor(current.target_org_id)} <ModeBadge mode={current.mode} />
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                  <Clock size={10} />
                  {remaining == null
                    ? `Started ${fmtDateTime(current.started_at)}`
                    : remaining === 0
                      ? 'Expired'
                      : `Ends in ${remaining}m (${fmtDateTime(current.expires_at)})`}
                </p>
              </div>
            </div>
            <Btn variant="danger" icon={Square} busy={ending} onClick={() => { setActionError(''); setConfirmEnd(true) }}>End session</Btn>
          </div>
          {current.reason && <p className="text-[11px] text-gray-400 mt-3 border-t border-orange-800/40 pt-2">Reason: {current.reason}</p>}
        </Panel>
      ) : error ? null : (
        <Panel>
          <PanelHeader icon={Play} title="Start a support session"
            subtitle="Pick one organisation, say why, and choose how long the window stays open." />
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="support-session-org" className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 mb-1.5">
                  <Building2 size={12} className="text-gray-500" aria-hidden="true" /> Target organisation
                </label>
                <Select id="support-session-org" value={targetOrg} onChange={setTargetOrg} placeholder="Select an organisation"
                  options={(orgs || []).map((o) => ({ value: o.id, label: o.name }))} />
              </div>
              <div>
                <p className="block text-[11px] font-semibold text-gray-400 mb-1.5">Duration</p>
                <Segmented role="group" ariaLabel="Session duration" value={minutes} onChange={setMinutes}
                  options={DURATIONS.map((m) => ({ key: m, label: `${m}m` }))} />
              </div>
            </div>

            <div>
              <label htmlFor="support-session-reason" className="block text-[11px] font-semibold text-gray-400 mb-1.5">Reason (required)</label>
              <textarea id="support-session-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                placeholder="Why you need to inspect this organisation"
                className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-700 focus-visible:ring-2 focus-visible:ring-orange-500 resize-none" />
            </div>

            <div>
              <p className="block text-[11px] font-semibold text-gray-400 mb-1.5">Mode</p>
              <Segmented role="group" ariaLabel="Session mode" value={mode} onChange={setMode} options={[
                { key: 'read_only', label: 'Read only', hint: 'Inspect without changing anything' },
                { key: 'edit', label: 'Edit', hint: 'Allows changes; use only when needed' },
              ]} />
            </div>

            <Toolbar>
              <Btn variant="primary" size="md" icon={Play} busy={starting}
                disabled={!targetOrg || !reason.trim()} onClick={handleStart}>
                {starting ? 'Starting...' : 'Start session'}
              </Btn>
            </Toolbar>
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader icon={Clock} title="Sessions started per day"
          subtitle={capped
            ? `Last ${TREND_DAYS} days, drawn from the latest ${RECENT_LIMIT} sessions only`
            : `Last ${TREND_DAYS} days, ${trend.total} session${trend.total === 1 ? '' : 's'} in the window`} />
        {loading ? <LoadingState rows={3} /> : error ? (
          <p className="text-xs text-gray-400">Unavailable because the session list could not be read.</p>
        ) : (
          <TrendChart labels={trend.labels} series={[{ label: 'Sessions', values: trend.values }]} height={170}
            summary={`${trend.total} support sessions started in the last ${TREND_DAYS} days`}
            emptyText="No support sessions started in the last 30 days." />
        )}
      </Panel>

      <Panel flush>
        <div className="p-4 pb-2">
          <PanelHeader icon={Clock} title="Recent sessions"
            subtitle={na ? undefined : `${visible.length} of ${recent.length} shown${capped ? `, latest ${RECENT_LIMIT} on record` : ''}`}
            actions={(
              <>
                <Btn icon={FileSpreadsheet} onClick={() => runExport('excel')} busy={exporting === 'excel'} disabled={na || visible.length === 0}>Excel</Btn>
                <Btn icon={FileText} onClick={() => runExport('pdf')} busy={exporting === 'pdf'} disabled={na || visible.length === 0}>PDF</Btn>
              </>
            )} />
          <Toolbar className="mt-1">
            <SearchInput value={search} onChange={setSearch} placeholder="Search organisation or reason" className="flex-1 min-w-[200px]" />
            <Select value={stateFilter} onChange={setStateFilter} ariaLabel="Filter by status" className="w-36"
              options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'expired', label: 'Expired' }, { value: 'ended', label: 'Ended' }]} />
            <Select value={modeFilter} onChange={setModeFilter} ariaLabel="Filter by mode" className="w-36"
              options={[{ value: 'all', label: 'All modes' }, { value: 'read_only', label: 'Read only' }, { value: 'edit', label: 'Edit' }]} />
          </Toolbar>
        </div>
        {loading ? <div className="px-4"><LoadingState label="Loading sessions" /></div> : error ? (
          <EmptyState title="Sessions unavailable" reason="The session list could not be read. Use Retry above." />
        ) : recent.length === 0 ? (
          <EmptyState title="No support sessions yet" reason="No super admin has opened a support window yet." />
        ) : visible.length === 0 ? (
          <EmptyState title="No sessions match" reason="Nothing matches this search, status and mode." />
        ) : (
          <Table className="border-0 rounded-none">
            <THead>
              <Th sortKey="org" sort={sort} onSort={onSort}>Organisation</Th>
              <Th sortKey="mode" sort={sort} onSort={onSort}>Mode</Th>
              <Th sortKey="reason" sort={sort} onSort={onSort}>Reason</Th>
              <Th sortKey="started_at" sort={sort} onSort={onSort}>Started</Th>
              <Th sortKey="ended_at" sort={sort} onSort={onSort}>Ended</Th>
              <Th sortKey="state" sort={sort} onSort={onSort}>Status</Th>
            </THead>
            <tbody>
              {visible.map((r) => {
                const st = STATE_BADGE[sessionState(r, nowMs)]
                return (
                  <Tr key={r.id}>
                    <Td className="text-gray-200 font-medium">{nameFor(r.target_org_id)}</Td>
                    <Td><ModeBadge mode={r.mode} /></Td>
                    <Td className="text-gray-300 max-w-[240px] truncate"><span title={r.reason || ''}>{r.reason || 'N/A'}</span></Td>
                    <Td nowrap className="text-gray-400">{fmtDateTime(r.started_at)}</Td>
                    <Td nowrap className="text-gray-400">{r.ended_at ? fmtDateTime(r.ended_at) : 'N/A'}</Td>
                    <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <Modal
        open={confirmEnd}
        title="End this support session?"
        subtitle={current ? `Inspecting ${nameFor(current.target_org_id)}` : undefined}
        onClose={() => { if (!ending) setConfirmEnd(false) }}
        width="max-w-md"
        footer={(
          <>
            <Btn onClick={() => setConfirmEnd(false)} disabled={ending}>Cancel</Btn>
            <Btn variant="danger" icon={Square} busy={ending} onClick={handleEnd}>End now</Btn>
          </>
        )}
      >
        {actionError && <div className="mb-3"><ErrorState message={actionError} /></div>}
        <p className="text-sm text-gray-300">Inspection of the organisation stops immediately and the end is recorded in the audit trail.</p>
      </Modal>
    </div>
  )
}
