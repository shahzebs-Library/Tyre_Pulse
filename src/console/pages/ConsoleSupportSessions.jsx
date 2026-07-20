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
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LifeBuoy, ShieldCheck, Clock, Play, Square, RefreshCw, AlertTriangle,
  Loader2, Eye, Pencil, Building2,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { supabase } from '../../lib/api/_client'
import {
  startSupportSession, endSupportSession, getCurrentSupportSession,
} from '../../lib/api/supportSessions'
import { toUserMessage } from '../../lib/safeError'

const DURATIONS = [15, 30, 60, 120, 240]

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
  const [error, setError]       = useState('')
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
      .limit(50)
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
    if (!targetOrg) { setError('Select a target organisation.'); return }
    if (!reason.trim()) { setError('A reason is required to start a support session.'); return }
    setStarting(true); setError('')
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
      setError(toUserMessage(e, 'Could not start the support session.'))
    } finally {
      setStarting(false)
    }
  }

  async function handleEnd() {
    if (!current?.id) return
    setEnding(true); setError('')
    try {
      await endSupportSession(current.id)
      logAction?.('support_session_end', current.target_org_id, 'organisation', { id: current.id })
      setCurrent(null)
      setRecent(await loadRecent())
    } catch (e) {
      setError(toUserMessage(e, 'Could not end the support session.'))
    } finally {
      setEnding(false)
    }
  }

  const remaining = current ? minutesLeft(current.expires_at, nowMs) : null

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <LifeBuoy size={18} className="text-orange-400" /> Support Sessions
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Authorize a time-boxed, audited window to inspect one customer organisation during a support engagement.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-sky-950/30 border border-sky-800/40">
        <ShieldCheck size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-200">Starting a session records and audits the authorization only. It does not yet retarget what data your reads return. Every start and end is logged.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-950/40 border border-red-800/50">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Active session */}
      {current && (
        <div className="rounded-xl border border-orange-800/50 bg-orange-950/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.3)' }}>
                <Eye size={16} className="text-orange-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white flex items-center gap-2">
                  Inspecting {nameFor(current.target_org_id)}
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                    current.mode === 'edit'
                      ? 'text-amber-300 border-amber-800/50 bg-amber-900/20'
                      : 'text-gray-300 border-gray-700 bg-gray-800/50'
                  }`}>{current.mode === 'edit' ? 'EDIT' : 'READ ONLY'}</span>
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
            <button onClick={handleEnd} disabled={ending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#dc2626,#ef4444)' }}>
              {ending ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />} End session
            </button>
          </div>
          {current.reason && <p className="text-[11px] text-gray-400 mt-3 border-t border-orange-900/40 pt-2">Reason: {current.reason}</p>}
        </div>
      )}

      {/* Start form */}
      {!current && (
        <div className="rounded-xl border border-gray-800 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Play size={14} className="text-orange-400" /> Start a support session
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Target organisation</label>
              <div className="relative">
                <Building2 size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <select value={targetOrg} onChange={(e) => setTargetOrg(e.target.value)}
                  className="w-full h-9 bg-gray-800/80 border border-gray-700 rounded-lg pl-8 pr-3 text-xs text-white focus:outline-none focus:border-orange-500">
                  <option value="">Select an organisation</option>
                  {(orgs || []).map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Duration (minutes)</label>
              <div className="flex flex-wrap gap-1.5">
                {DURATIONS.map((m) => (
                  <button key={m} type="button" onClick={() => setMinutes(m)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] border ${minutes === m ? 'bg-orange-600 border-orange-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'}`}>
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Reason (required)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="Why you need to inspect this organisation"
              className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500 resize-none" />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Mode</label>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setMode('read_only')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] border ${mode === 'read_only' ? 'bg-orange-600 border-orange-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'}`}>
                <Eye size={12} /> Read only
              </button>
              <button type="button" onClick={() => setMode('edit')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] border ${mode === 'edit' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'}`}>
                <Pencil size={12} /> Edit
              </button>
            </div>
          </div>

          <button onClick={handleStart} disabled={starting || !targetOrg || !reason.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
            {starting ? <><Loader2 size={12} className="animate-spin" /> Starting...</> : <><Play size={12} /> Start session</>}
          </button>
        </div>
      )}

      {/* Recent sessions */}
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800 text-xs font-semibold text-gray-300 flex items-center gap-2">
          <Clock size={13} className="text-gray-500" /> Recent sessions
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-7 h-7 text-orange-500 animate-spin" />
          </div>
        ) : recent.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-14">No support sessions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800/60">
                  <th className="px-4 py-2 font-semibold">Organisation</th>
                  <th className="px-4 py-2 font-semibold">Mode</th>
                  <th className="px-4 py-2 font-semibold">Reason</th>
                  <th className="px-4 py-2 font-semibold">Started</th>
                  <th className="px-4 py-2 font-semibold">Ended</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {recent.map((r) => (
                  <tr key={r.id} className="hover:bg-black/20">
                    <td className="px-4 py-2.5 text-gray-200 font-medium">{nameFor(r.target_org_id)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                        r.mode === 'edit'
                          ? 'text-amber-300 border-amber-800/50 bg-amber-900/20'
                          : 'text-gray-400 border-gray-700 bg-gray-800/50'
                      }`}>{r.mode === 'edit' ? 'EDIT' : 'READ ONLY'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 max-w-[220px] truncate" title={r.reason || ''}>{r.reason || 'N/A'}</td>
                    <td className="px-4 py-2.5 text-gray-400">{fmtDateTime(r.started_at)}</td>
                    <td className="px-4 py-2.5 text-gray-400">{r.ended_at ? fmtDateTime(r.ended_at) : 'N/A'}</td>
                    <td className="px-4 py-2.5">
                      {r.active && !r.ended_at ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-green-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Active
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-500">Ended</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
