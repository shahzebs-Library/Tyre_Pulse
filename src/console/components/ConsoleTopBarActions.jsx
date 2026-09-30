/**
 * ConsoleTopBarActions - the right side of the console top bar.
 *
 *   - environment badge (this console always talks to the production project)
 *   - live critical count (unresolved critical log rows, last 7 days)
 *   - notifications bell (the same "waiting on you" list as the Overview)
 *   - Quick actions: invite a user, run a security scan, back up now, turn on
 *     maintenance mode. Every action that changes something opens a confirm
 *     with a plain-English impact box first; maintenance mode also needs a
 *     reason and the word PRODUCTION typed out.
 *
 * All reads go through existing services and settle on their own; a count we
 * could not read shows as "?" with a title saying so, never as 0.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, Siren, Zap, ChevronDown, UserPlus, ShieldCheck, DatabaseBackup, Power, ChevronRight,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { ConfirmImpactDialog } from './ui'
import { toUserMessage } from '../../lib/safeError'
import { loadAttentionInputs } from '../../lib/api/consoleAttention'
import { buildAttention } from '../../lib/consoleAttention'
import { loadCriticalCount, loadMaintenanceImpact } from '../../lib/api/consoleOverview'
import { runSecurityScan } from '../../lib/api/securityAudit'
import { createBackupSnapshot } from '../../lib/api/backups'
import { saveSystemConfigValues, loadSystemConfig, configBool } from '../../lib/api/systemConfig'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'
const nf = new Intl.NumberFormat('en-US')

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])
  return { open, setOpen, ref }
}

/** The four actions, their impact wording and what they call. */
export const QUICK_ACTION_IMPACT = {
  scan: {
    title: 'Run a security scan now?',
    what: 'Runs every security check against the live database and records the result.',
    change: 'A new scan row is stored and the security score is recalculated. No data or setting is changed.',
    who: 'Every super admin is notified if the scan finds something new.',
    undo: 'Nothing to undo. The scan only reads and records.',
    tone: 'info',
    confirm: 'Run scan',
  },
  backup: {
    title: 'Take a backup snapshot now?',
    what: 'Copies the core tables into a new backup snapshot.',
    change: 'One new snapshot is added to the backup list. Live data is not touched.',
    who: 'Nobody. The app keeps working while it runs.',
    undo: 'Snapshots are kept for 30 days and purged by the nightly job. Restore only ever re-inserts missing rows.',
    tone: 'info',
    confirm: 'Back up now',
  },
}

export default function ConsoleTopBarActions() {
  const navigate = useNavigate()
  const { logAction } = useConsoleAuth()
  const [critical, setCritical] = useState({ loading: true, value: null })
  const [attention, setAttention] = useState({ loading: true, items: null })
  const bell = usePopover()
  const qa = usePopover()
  const [dialog, setDialog] = useState(null) // 'scan' | 'backup' | 'maintenance'
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [notice, setNotice] = useState('')
  const [impact, setImpact] = useState(null)
  const [maintenanceOn, setMaintenanceOn] = useState(null)

  const refresh = useCallback(async () => {
    const [c, a] = await Promise.allSettled([loadCriticalCount(), loadAttentionInputs()])
    setCritical({ loading: false, value: c.status === 'fulfilled' ? c.value : null })
    setAttention({ loading: false, items: a.status === 'fulfilled' ? buildAttention(a.value) : null })
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 60000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(t)
  }, [notice])

  async function openDialog(kind) {
    qa.setOpen(false)
    setDialogError('')
    setDialog(kind)
    if (kind === 'maintenance') {
      setImpact(null)
      const [imp] = await Promise.allSettled([loadMaintenanceImpact(), loadSystemConfig({ force: true })])
      setImpact(imp.status === 'fulfilled' ? imp.value : { blocked: null, today: null, phones: null })
      setMaintenanceOn(configBool('maintenance_mode', false))
    }
  }

  async function confirm({ reason } = {}) {
    setBusy(true); setDialogError('')
    try {
      if (dialog === 'scan') {
        const p = await runSecurityScan()
        setNotice(p?.score != null ? `Security scan finished. Score ${p.score}.` : 'Security scan finished.')
      } else if (dialog === 'backup') {
        const s = await createBackupSnapshot('manual (console quick action)')
        setNotice(s?.total_rows != null ? `Backup taken: ${nf.format(s.total_rows)} rows in ${s.table_count ?? 'N/A'} tables.` : 'Backup taken.')
      } else if (dialog === 'maintenance') {
        await saveSystemConfigValues({ maintenance_mode: true })
        try { await logAction('update_config', null, 'system', { keys: ['maintenance_mode'], value: 'true', reason }) } catch { /* audit is best effort */ }
        setNotice('Maintenance mode is on. Turn it off in System Settings or the Overview switches.')
      }
      setDialog(null)
      refresh()
    } catch (err) {
      setDialogError(toUserMessage(err, 'That did not work. Nothing was changed.'))
    } finally {
      setBusy(false)
    }
  }

  const critValue = critical.value
  const attnCount = attention.items ? attention.items.length : null
  const spec = dialog && dialog !== 'maintenance' ? QUICK_ACTION_IMPACT[dialog] : null

  return (
    <div className="flex items-center gap-2">
      <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border border-gray-800 text-gray-300"
        title="This console is connected to the live production database">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" aria-hidden="true" />
        Production
      </span>

      <button type="button" onClick={() => navigate('/console/health')}
        title={critValue === null ? 'Could not read the critical count. Open System Health to check.' : 'Unresolved critical errors, last 7 days'}
        aria-label={critValue === null ? 'Critical count unavailable' : `${critValue} critical`}
        className={`${FOCUS} inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border ${critValue > 0 ? 'border-red-800/60 bg-red-950/30 text-red-300' : 'border-gray-800 text-gray-400 hover:text-gray-200'}`}>
        <Siren size={13} aria-hidden="true" />
        <span className="tabular-nums">{critical.loading ? '...' : critValue === null ? '?' : critValue}</span>
        <span className="hidden sm:inline">critical</span>
      </button>

      <div className="relative" ref={bell.ref}>
        <button type="button" onClick={() => bell.setOpen((o) => !o)} aria-expanded={bell.open} aria-haspopup="true"
          aria-label={attnCount === null ? 'Notifications' : `Notifications, ${attnCount} waiting`} title="What is waiting on you"
          className={`${FOCUS} relative inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-800 text-gray-400 hover:text-gray-200`}>
          <Bell size={14} aria-hidden="true" />
          {attnCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">{attnCount}</span>
          )}
        </button>
        {bell.open && (
          <div className="absolute right-0 mt-2 w-80 z-40 rounded-xl border border-gray-800 bg-gray-950 shadow-2xl p-2" role="dialog" aria-label="Waiting on you">
            <p className="px-2 pt-1 pb-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Waiting on you</p>
            {attention.items === null ? (
              <p className="px-2 py-3 text-xs text-gray-400">Could not check right now. Open System Health to be sure.</p>
            ) : attention.items.length === 0 ? (
              <p className="px-2 py-3 text-xs text-gray-400">Nothing is waiting on you.</p>
            ) : attention.items.map((a) => (
              <button key={a.key} type="button" onClick={() => { bell.setOpen(false); navigate(a.to) }}
                className={`${FOCUS} w-full flex items-start gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-gray-800/60`}>
                <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${a.tone === 'danger' ? 'bg-red-500' : a.tone === 'warning' ? 'bg-amber-500' : 'bg-gray-500'}`} aria-hidden="true" />
                <span className="text-xs text-gray-200 flex-1 min-w-0 break-words">{a.text}</span>
                <ChevronRight size={12} className="text-gray-500 mt-0.5 shrink-0" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative" ref={qa.ref}>
        <button type="button" onClick={() => qa.setOpen((o) => !o)} aria-expanded={qa.open} aria-haspopup="menu"
          className={`${FOCUS} inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black`}>
          <Zap size={13} aria-hidden="true" />
          <span className="hidden sm:inline">Quick actions</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {qa.open && (
          <div className="absolute right-0 mt-2 w-72 z-40 rounded-xl border border-gray-800 bg-gray-950 shadow-2xl p-2" role="menu" aria-label="Quick actions">
            <p className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Users</p>
            <MenuItem icon={UserPlus} onClick={() => { qa.setOpen(false); navigate('/console/users') }}>Invite or approve a user</MenuItem>
            <p className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Platform</p>
            <MenuItem icon={ShieldCheck} onClick={() => openDialog('scan')}>Run security scan</MenuItem>
            <MenuItem icon={DatabaseBackup} onClick={() => openDialog('backup')}>Back up now</MenuItem>
            <p className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Danger zone</p>
            <MenuItem icon={Power} danger hint="typed confirm" onClick={() => openDialog('maintenance')}>Turn on maintenance mode</MenuItem>
          </div>
        )}
      </div>

      {notice && (
        <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-200 shadow-2xl">{notice}</div>
      )}

      {spec && (
        <ConfirmImpactDialog open title={spec.title} confirmLabel={spec.confirm} busy={busy} error={dialogError}
          impact={{ what: spec.what, change: spec.change, who: spec.who, undo: spec.undo, tone: spec.tone }}
          onCancel={() => setDialog(null)} onConfirm={confirm} />
      )}
      {dialog === 'maintenance' && (
        <ConfirmImpactDialog open danger requireReason typedWord="PRODUCTION"
          title={maintenanceOn ? 'Maintenance mode is already on' : 'Turn on maintenance mode?'}
          confirmLabel="Turn on maintenance" busy={busy || maintenanceOn === true} error={dialogError}
          impact={{
            tone: 'danger',
            what: 'Everyone except admins is blocked on web and phone until you turn it off.',
            change: 'The maintenance_mode switch is set to on. Signed-in users see the maintenance screen on their next page load.',
            who: 'Every approved user who is not an Admin or super admin.',
            undo: 'Yes. Turn the switch off in System Settings or on the Overview and access returns immediately.',
            stats: [
              { label: 'Users blocked', value: impact ? (impact.blocked === null ? 'N/A' : nf.format(impact.blocked)) : '...' },
              { label: 'Signed in today', value: impact ? (impact.today === null ? 'N/A' : nf.format(impact.today)) : '...' },
              { label: 'Phones registered', value: impact ? (impact.phones === null ? 'N/A' : nf.format(impact.phones)) : '...' },
            ],
          }}
          onCancel={() => setDialog(null)} onConfirm={confirm} />
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, children, onClick, danger, hint }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      className={`${FOCUS} w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 text-xs hover:bg-gray-800/60 ${danger ? 'text-red-300' : 'text-gray-200'}`}>
      <Icon size={13} className={danger ? 'text-red-400' : 'text-gray-500'} aria-hidden="true" />
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[10px] text-red-400/80">{hint}</span>}
    </button>
  )
}
