/**
 * Mobile App Control - the owner's one screen for the field phones.
 *
 * Exists because the two questions that kept needing an engineer were
 * "what version is out there?" and "how do I force everyone to update?".
 * Both are answered and actioned here, in plain English, with an interlock
 * that REFUSES the one dangerous mistake: requiring a version newer than
 * anything released, which would lock every phone out with nothing to
 * update to.
 */
import { useEffect, useState } from 'react'
import { Smartphone, ShieldAlert, Rocket, RefreshCw, Save, Bell } from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Btn, LoadingState, ErrorState,
} from '../components/ui'
import { getMobileOps, setMobileMinVersion, setMobileLatestVersion } from '../../lib/api/mobileOps'
import { gateRisk, gateSummary } from '../../lib/mobileOps'
import { toUserMessage } from '../../lib/safeError'
import { useConsoleAuth } from '../ConsoleAuthContext'

export default function ConsoleMobileApp() {
  const { logAction } = useConsoleAuth()
  const [ops, setOps] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [minDraft, setMinDraft] = useState('')
  const [latestDraft, setLatestDraft] = useState('')
  const [saving, setSaving] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const o = await getMobileOps()
      setOps(o)
      setMinDraft(o.minVersion || '')
      setLatestDraft(o.latestVersion || '')
      if (!o.configOk) setError('Could not read the app settings. The figures shown may be incomplete.')
    } catch (e) { setError(toUserMessage(e, 'Could not load the mobile overview.')) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const risk = ops ? gateRisk(minDraft, latestDraft || ops.latestVersion) : null
  const minChanged = ops && minDraft.trim() !== (ops.minVersion || '')
  const latestChanged = ops && latestDraft.trim() !== (ops.latestVersion || '')

  async function saveMin() {
    if (!risk || risk.level === 'blocked') return
    setSaving('min'); setMsg('')
    try {
      await setMobileMinVersion(minDraft.trim())
      await logAction('set_mobile_min_version', null, 'system', { value: minDraft.trim() })
      setMsg(minDraft.trim() ? `Saved. Phones below ${minDraft.trim()} must now update.` : 'Saved. The update gate is now off.')
      await load()
    } catch (e) { setMsg(toUserMessage(e, 'Could not save.')) }
    setSaving('')
  }

  async function saveLatest() {
    setSaving('latest'); setMsg('')
    try {
      await setMobileLatestVersion(latestDraft.trim())
      await logAction('set_mobile_latest_version', null, 'system', { value: latestDraft.trim() })
      setMsg(`Recorded ${latestDraft.trim()} as the newest released build.`)
      await load()
    } catch (e) { setMsg(toUserMessage(e, 'Could not save.')) }
    setSaving('')
  }

  if (loading) return <LoadingState label="Loading mobile overview" />

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Mobile App Control</h1>
          <p className="text-sm text-gray-500 mt-0.5">The field phones: what version is out, who is on it, and the forced-update rule.</p>
        </div>
        <Btn icon={RefreshCw} onClick={load}>Refresh</Btn>
      </div>

      <ErrorState message={error} onRetry={load} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile icon={Rocket} label="Newest released build" value={ops?.latestVersion || 'Not recorded'}
          sub="the version on Google Play right now" tone={ops?.latestVersion ? 'good' : 'warning'} />
        <StatTile icon={ShieldAlert} label="Required minimum" value={ops?.minVersion || 'Gate off'}
          sub={ops?.minVersion ? 'older phones must update' : 'no phone is ever blocked'} tone={ops?.minVersion ? 'info' : 'quiet'} />
        <StatTile icon={Bell} label="Devices registered for alerts" value={ops?.activeDevices ?? 'N/A'}
          sub={`${ops?.usersWithPush ?? 'N/A'} users can receive push`} tone="quiet" />
      </div>

      <Panel>
        <PanelHeader icon={Smartphone} title="Where things stand"
          subtitle={ops ? gateSummary(ops.minVersion, ops.latestVersion) : ''} />
        <div className="px-4 pb-4 text-xs text-gray-500 leading-relaxed">
          Updates reach phones through Google Play. New builds go to the Internal testing track first
          (instant, no review) and the Closed testing track (needs a short Google review).
          A phone showing an old version simply has not installed the update yet - opening the app's
          Play Store page speeds that up.
        </div>
      </Panel>

      <Panel>
        <PanelHeader icon={ShieldAlert} title="Forced-update rule" tone="warning"
          subtitle="Phones on a version OLDER than this are shown an update screen and cannot continue until they update." />
        <div className="px-4 pb-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Required minimum version</span>
              <input value={minDraft} onChange={(e) => setMinDraft(e.target.value)} placeholder="e.g. 1.3.2 (blank = gate off)"
                className="w-56 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-orange-600 focus:outline-none" />
            </label>
            <Btn icon={Save} variant="primary" onClick={saveMin} busy={saving === 'min'}
              disabled={!minChanged || (risk && risk.level === 'blocked')}>
              Save rule
            </Btn>
          </div>
          {risk && minChanged && (
            <Note tone={risk.level === 'blocked' ? 'danger' : risk.level === 'off' ? 'quiet' : 'good'}>
              {risk.level === 'blocked' ? 'Refused: ' : ''}{risk.reason}
            </Note>
          )}
          <Note tone="quiet">
            Safety rule built in: the minimum can never be set ABOVE the newest released build.
            That mistake would lock every phone out with nothing to update to, so this page refuses it
            rather than warning about it.
          </Note>
        </div>
      </Panel>

      <Panel>
        <PanelHeader icon={Rocket} title="Record a new release"
          subtitle="After a new build ships on Google Play, record its version here so the safety rule above always checks against the truth." />
        <div className="px-4 pb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Newest released version</span>
            <input value={latestDraft} onChange={(e) => setLatestDraft(e.target.value)} placeholder="e.g. 1.3.3"
              className="w-56 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-orange-600 focus:outline-none" />
          </label>
          <Btn icon={Save} onClick={saveLatest} busy={saving === 'latest'} disabled={!latestChanged}>Record release</Btn>
        </div>
      </Panel>

      {msg && <p className="text-xs text-gray-400">{msg}</p>}
    </div>
  )
}
