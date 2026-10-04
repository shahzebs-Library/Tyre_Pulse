/**
 * Mobile app gate for the Developer Center: the forced-update minimum, the
 * newest released build, and who a change affects measured on ACTIVE phones
 * (opened in the last 7 days), not only installs (Sentry release health).
 *
 * The guard (never above the latest released version) is the same gateRisk
 * the old Mobile App page used; the raise dialog needs a reason and the new
 * version typed, and the change is audited. system_config.updated_by is now
 * stamped by a trigger, so "who changed it" is recorded from today.
 */
import { useMemo, useState } from 'react'
import { Smartphone, ShieldCheck, AlertTriangle, ArrowUpCircle, Bell, Tag } from 'lucide-react'
import {
  Panel, PanelHeader, Badge, Btn, Note, LoadingState, ErrorState, ImpactBox, ConfirmImpactDialog, ProportionBar,
} from '../../components/ui'
import { gateRisk } from '../../../lib/mobileOps'
import { latestRisk } from '../mobileApp/releaseGuard'
import { setMobileMinVersion, setMobileLatestVersion } from '../../../lib/api/mobileOps'
import { adoptionSummary, gateForced, fmtInt, riyadhDay, riyadhTime, compareVersions } from '../../../lib/engineeringCenter'
import { toUserMessage } from '../../../lib/safeError'
import { useConsoleAuth } from '../../ConsoleAuthContext'

export function useAdoption(adoption, config) {
  const min = config?.mobile_min_version?.value || ''
  const latest = config?.mobile_latest_version?.value || ''
  return useMemo(() => adoptionSummary(adoption?.by_version || [], min, latest), [adoption, min, latest])
}

export default function GatePanel({ config, adoption, loading, error, onRetry, onChanged, raiseOpen, setRaiseOpen }) {
  const { logAction } = useConsoleAuth()
  const [recordOpen, setRecordOpen] = useState(false)
  const [flash, setFlash] = useState('')
  const min = config?.mobile_min_version?.value || ''
  const latest = config?.mobile_latest_version?.value || ''
  const flutterMin = config?.flutter_min_version?.value || ''
  const changedAt = config?.mobile_min_version?.updatedAt
  const changedBy = config?.mobile_min_version?.updatedBy
  const a = useAdoption(adoption, config)

  if (loading) return <Panel><LoadingState label="Loading the app gate" rows={6} /></Panel>
  if (error) return <Panel><PanelHeader icon={Smartphone} title="Mobile app gate" /><ErrorState message={error} onRetry={onRetry} /></Panel>

  const belowRows = a.belowRows || []
  const belowText = belowRows.map((r) => `${fmtInt(r.installs)} on ${r.version || 'unknown'}`).join(' and ')
  const guardOk = gateRisk(min, latest).level !== 'blocked'

  return (
    <Panel>
      <PanelHeader icon={Smartphone} title="Mobile app gate" subtitle="Forces old phones to update"
        actions={<Badge tone={guardOk ? 'good' : 'danger'}>{guardOk ? 'Guard on' : 'Guard failing'}</Badge>} />
      {flash && <div className="mb-3"><Note tone="accent">{flash}</Note></div>}
      <div className="grid grid-cols-3 gap-3 text-xs mb-3">
        <div><p className="text-gray-500 text-[11px]">Minimum Android version</p><p className="font-mono text-gray-100 mt-0.5">{min || 'Not set'}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Changed {changedAt ? `${riyadhDay(changedAt)} ${riyadhTime(changedAt)}` : 'N/A'}. Who: {changedBy ? 'recorded in the audit log' : 'not recorded'}</p></div>
        <div><p className="text-gray-500 text-[11px]">Latest released</p><p className="font-mono text-gray-100 mt-0.5">{latest || 'Not recorded'}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{config?.mobile_latest_version?.updatedAt ? `Changed ${riyadhDay(config.mobile_latest_version.updatedAt)}` : 'N/A'}</p></div>
        <div><p className="text-gray-500 text-[11px]">Minimum Flutter version</p><p className="font-mono text-gray-100 mt-0.5">{flutterMin || 'Not set'}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Separate key, fails open</p></div>
      </div>

      <Note icon={ShieldCheck}>Guard: the minimum can never be saved above the latest released version, so no phone can be locked out with nothing to update to.</Note>

      {a.belowInstalls ? (
        <div className="mt-3"><Note icon={AlertTriangle} tone="warning">
          <b>{fmtInt(a.belowInstalls)} phone{a.belowInstalls === 1 ? ' is' : 's are'} below the minimum.</b> {belowText}. They see &quot;Update required&quot; at sign-in.
          {a.belowActive === 0 ? ` None of the ${fmtInt(a.belowInstalls)} has opened the app in 7 days;` : ` ${fmtInt(a.belowActive)} opened the app in 7 days;`} {fmtInt(a.latestActive)} of the {fmtInt(a.latestInstalls)} on {latest || 'the latest'} have.
        </Note></div>
      ) : null}

      <div className="grid grid-cols-3 gap-px rounded-lg overflow-hidden border border-gray-800 mt-3 text-xs">
        <Tile label={`On ${latest || 'latest'}`} value={fmtInt(a.latestInstalls)} sub="installs" />
        <Tile label="Active 7 days" value={fmtInt(a.latestActive)} sub={`of ${fmtInt(a.latestInstalls)}`} />
        <Tile label="Old, active 7d" value={fmtInt(a.belowActive)} sub={`of ${fmtInt(a.belowInstalls)}`} />
      </div>
      {a.rows.length > 0 && (
        <div className="mt-3 space-y-1">
          <ProportionBar segments={a.rows.map((r) => ({ label: r.version || 'unknown', value: r.installs, tone: r.version && latest && compareVersions(r.version, latest) >= 0 ? 'good' : 'danger' }))} />
          <p className="font-mono text-[10px] text-gray-500">{a.rows.map((r) => `${r.version || 'unknown'}: ${r.installs}`).join('  ')}</p>
        </div>
      )}

      <div className="mt-3">
        <ImpactBox tone="warning" what={`${fmtInt(a.belowInstalls)} installs run a version older than ${min || 'the minimum'}, ${a.belowActive === 0 ? 'none active this week' : `${fmtInt(a.belowActive)} active this week`}.`}
          change="Nothing until you change a number. Raising the minimum forces older phones to update."
          who={`${fmtInt(a.belowInstalls)} installs, ${fmtInt(a.belowActive)} people who used the app in the last 7 days. ${fmtInt(a.latestInstalls)} already on ${latest || 'the latest'} are not affected.`}
          undo="Yes. Lower the minimum and phones sign in again." />
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <Btn variant="primary" icon={ArrowUpCircle} onClick={() => setRaiseOpen(true)}>Raise minimum</Btn>
        <Btn icon={Bell} disabled title="No sender for a push aimed at one app version exists yet. Phones below the minimum already see Update required at sign-in.">Notify the {fmtInt(a.belowInstalls)} phones</Btn>
        <Btn icon={Tag} onClick={() => setRecordOpen(true)}>Record a release</Btn>
      </div>
      <p className="text-[10px] text-gray-500 mt-2">Notify is not available: there is no version-targeted push sender. A soft &quot;update recommended&quot; prompt needs an app build (builds are frozen by the owner).</p>

      {raiseOpen && <RaiseDialog open={raiseOpen} onClose={() => setRaiseOpen(false)} min={min} latest={latest} adoption={adoption}
        logAction={logAction} onSaved={(v) => { setRaiseOpen(false); setFlash(`Minimum Android version set to ${v}.`); onChanged?.() }} />}
      {recordOpen && <RecordDialog open={recordOpen} onClose={() => setRecordOpen(false)} min={min} latest={latest}
        logAction={logAction} onSaved={(v) => { setRecordOpen(false); setFlash(`${v} recorded as the newest Android release.`); onChanged?.() }} />}
    </Panel>
  )
}

function Tile({ label, value, sub }) {
  return (
    <div className="bg-gray-900/60 px-3 py-2">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-100 tabular-nums">{value}</p>
      <p className="text-[10px] text-gray-500">{sub}</p>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs font-mono text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

export function RaiseDialog({ open, onClose, min, latest, adoption, onSaved, logAction }) {
  const [value, setValue] = useState(min || latest || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const risk = gateRisk(value, latest)
  const f = gateForced(adoption?.by_version || [], value)
  const blocked = risk.level === 'blocked' || !value.trim()
  async function save({ reason }) {
    setBusy(true); setErr('')
    try {
      await setMobileMinVersion(value.trim())
      try { await logAction?.('update_config', null, 'system_config', { keys: ['mobile_min_version'], from: min, to: value.trim(), reason }) } catch { /* audit best effort */ }
      onSaved?.(value.trim())
    } catch (e) { setErr(toUserMessage(e, 'The minimum could not be saved. Nothing was changed.')) } finally { setBusy(false) }
  }
  return (
    <ConfirmImpactDialog open={open} title="Raise minimum Android version?" danger requireReason
      typedWord={blocked ? undefined : value.trim()} readyExtra={!blocked}
      confirmLabel={`Force update on ${fmtInt(f.forced)} phones`} busy={busy} error={err}
      onCancel={onClose} onConfirm={save}
      impact={{
        tone: 'danger',
        what: `${fmtInt(f.forced)} installs run an older app; ${fmtInt(f.forcedActive)} opened it in 7 days.`,
        change: `These phones show "Update required" and cannot sign in until they update from Play.`,
        who: `${fmtInt(f.forced)} installs, ${fmtInt(f.forcedActive)} active this week. ${fmtInt(f.notAffected)} phones on ${value || 'the new minimum'} or newer keep working.`,
        undo: 'Yes. Lower the minimum again at any time.',
        stats: [{ label: 'Forced to update', value: fmtInt(f.forced) }, { label: 'Of those, active 7 days', value: fmtInt(f.forcedActive) }, { label: 'Not affected', value: fmtInt(f.notAffected) }],
      }}>
      <label className="block">
        <span className="block text-[11px] font-semibold text-gray-400 mb-1">New minimum version</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} aria-label="New minimum version" />
      </label>
      <Note icon={ShieldCheck} tone={risk.level === 'blocked' ? 'danger' : 'default'}>
        {risk.level === 'blocked' ? `Refused: ${risk.reason}` : `Guard passed: ${value || 'the value'} is not above the latest released version ${latest || 'N/A'}. Anything higher is refused.`}
      </Note>
    </ConfirmImpactDialog>
  )
}

function RecordDialog({ open, onClose, min, latest, onSaved, logAction }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const risk = latestRisk(value, min, latest)
  async function save({ reason }) {
    setBusy(true); setErr('')
    try {
      await setMobileLatestVersion(value.trim())
      try { await logAction?.('update_config', null, 'system_config', { keys: ['mobile_latest_version'], from: latest, to: value.trim(), reason }) } catch { /* audit best effort */ }
      onSaved?.(value.trim())
    } catch (e) { setErr(toUserMessage(e, 'The release could not be recorded.')) } finally { setBusy(false) }
  }
  return (
    <ConfirmImpactDialog open={open} title="Record an Android release" requireReason readyExtra={risk.level !== 'blocked'}
      confirmLabel="Record release" busy={busy} error={err} onCancel={onClose} onConfirm={save}
      impact={{ tone: 'info', what: 'Record the version that is live on Google Play.', change: 'The gate guard uses this as the highest minimum you can set.', who: 'No phone changes; this is a record only.', undo: 'Yes. Record the correct version again.' }}>
      <label className="block">
        <span className="block text-[11px] font-semibold text-gray-400 mb-1">Version live on Google Play</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={latest || '1.6.0'} className={inputCls} aria-label="Released version" />
      </label>
      {value && <Note tone={risk.level === 'blocked' ? 'danger' : risk.level === 'warn' ? 'warning' : 'default'}>{risk.reason}</Note>}
    </ConfirmImpactDialog>
  )
}
