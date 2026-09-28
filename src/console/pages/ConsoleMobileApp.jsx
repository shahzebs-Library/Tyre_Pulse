/**
 * Mobile App Control - the owner's one screen for the field phones.
 *
 * Exists because the two questions that kept needing an engineer were
 * "what version is out there?" and "how do I force everyone to update?".
 * Both are answered and actioned here, in plain English, with an interlock
 * that REFUSES the one dangerous mistake: requiring a version newer than
 * anything released, which would lock every phone out with nothing to
 * update to.
 *
 * THE INTERLOCK, both directions:
 *   - the minimum is judged against the SAVED newest release, never an unsaved
 *     draft, so typing a higher release number cannot unlock a higher minimum
 *     until that release is actually recorded;
 *   - recording a release BELOW the saved minimum is refused too, because it
 *     strands the gate in exactly the same way.
 * A failed read of the settings disables both saves: nothing is changed from
 * figures we could not confirm.
 *
 * Layout: header, five tiles, "needs attention", then tabs
 * (?tab=overview | gate | releases).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Smartphone, ShieldAlert, Rocket, Save, Bell, Users, History, Layers, Image as ImageIcon } from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Btn, Badge, LoadingState, ErrorState, Modal, Segmented, EmptyState,
  Table, THead, Th, Tr, Td,
} from '../components/ui'
import { BarsChart } from '../components/ui/charts'
import { getMobileOps, setMobileMinVersion, setMobileLatestVersion } from '../../lib/api/mobileOps'
import { gateRisk, gateSummary, compareVersions, parseVersion } from '../../lib/mobileOps'
import { toUserMessage } from '../../lib/safeError'
import { sortRows, useTableSort } from '../../lib/consoleTable'
import { useConsoleAuth } from '../ConsoleAuthContext'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, AttentionList, ConsoleLink, TabPanel, whenText, ageText } from './shared/pageKit'
import { getDeviceVersions } from './mobileApp/deviceVersions'
import { latestRisk, gateImpact, behindLatest } from './mobileApp/releaseGuard'
import LoginArtworkPanel from './mobileApp/LoginArtworkPanel'

const nf = new Intl.NumberFormat('en-US')
const TABS = ['overview', 'gate', 'releases', 'login']
const INPUT = 'w-56 max-w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50'
const VERSION_EXPORT = [
  { key: 'app_version', header: 'App version', value: (r) => r.app_version || 'Unknown' },
  { key: 'platform', header: 'Platform', value: (r) => r.platform || 'Unknown' },
  { key: 'devices', header: 'Active devices' },
  { key: 'seen_30d', header: 'Seen in last 30 days' },
  { key: 'last_seen', header: 'Last seen' },
]

export default function ConsoleMobileApp() {
  const { logAction } = useConsoleAuth()
  const [ops, setOps] = useState(null)
  const [devices, setDevices] = useState(null)
  const [devicesError, setDevicesError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [readAt, setReadAt] = useState(null)
  const [minDraft, setMinDraft] = useState('')
  const [latestDraft, setLatestDraft] = useState('')
  const [saving, setSaving] = useState('')
  const [msg, setMsg] = useState('')
  const [msgIsError, setMsgIsError] = useState(false)
  const [confirmMin, setConfirmMin] = useState(false)
  const [tab, setTab] = useUrlTab(TABS, 'overview')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const [o, d] = await Promise.allSettled([getMobileOps(), getDeviceVersions()])
    if (o.status === 'fulfilled') {
      setOps(o.value)
      setMinDraft(o.value.minVersion || '')
      setLatestDraft(o.value.latestVersion || '')
      if (!o.value.configOk) setError('Could not read the app settings. The versions shown may be incomplete, so saving is switched off until they can be read.')
    } else {
      setOps(null)
      setError(toUserMessage(o.reason, 'Could not load the mobile overview.'))
    }
    if (d.status === 'fulfilled') { setDevices(d.value); setDevicesError('') } else {
      setDevices(null); setDevicesError(toUserMessage(d.reason, 'The device install base could not be read.'))
    }
    setReadAt(Date.now())
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const configOk = !!ops?.configOk
  // Judged against the SAVED release on record, never the unsaved draft.
  const risk = ops ? gateRisk(minDraft, ops.latestVersion) : null
  const relRisk = ops ? latestRisk(latestDraft, ops.minVersion, ops.latestVersion) : null
  const minChanged = ops && minDraft.trim() !== (ops.minVersion || '')
  const latestChanged = ops && latestDraft.trim() !== (ops.latestVersion || '')
  const impact = useMemo(() => gateImpact(minDraft, devices?.byVersion), [minDraft, devices])
  const savedImpact = useMemo(() => gateImpact(ops?.minVersion, devices?.byVersion), [ops, devices])
  const behind = useMemo(() => (devices ? behindLatest(ops?.latestVersion, devices.byVersion) : null), [ops, devices])

  async function saveMin() {
    if (!configOk || !risk || risk.level === 'blocked') return
    setConfirmMin(false)
    setSaving('min'); setMsg(''); setMsgIsError(false)
    try {
      await setMobileMinVersion(minDraft.trim())
      await logAction('set_mobile_min_version', null, 'system', { value: minDraft.trim() })
      setMsg(minDraft.trim() ? `Saved. Phones below ${minDraft.trim()} must now update.` : 'Saved. The update gate is now off.')
      await load()
    } catch (e) { setMsg(toUserMessage(e, 'Could not save.')); setMsgIsError(true) }
    setSaving('')
  }

  async function saveLatest() {
    if (!configOk || !relRisk || relRisk.level === 'blocked') return
    setSaving('latest'); setMsg(''); setMsgIsError(false)
    try {
      await setMobileLatestVersion(latestDraft.trim())
      await logAction('set_mobile_latest_version', null, 'system', { value: latestDraft.trim() })
      setMsg(`Recorded ${latestDraft.trim()} as the newest released build.`)
      await load()
    } catch (e) { setMsg(toUserMessage(e, 'Could not save.')); setMsgIsError(true) }
    setSaving('')
  }

  const { sort, onSort } = useTableSort({ key: 'devices', dir: 'desc' })
  const versionRows = useMemo(() => sortRows(devices?.byVersion || [], sort, {
    app_version: (r) => (parseVersion(r.app_version) ? parseVersion(r.app_version).map((n) => String(n).padStart(5, '0')).join('.') : null),
  }), [devices, sort])
  const versionBars = useMemo(() => [...(devices?.byVersion || [])]
    .sort((a, b) => compareVersions(b.app_version, a.app_version))
    .map((r) => ({ label: `${r.app_version || 'Unknown'}${r.platform ? ` (${r.platform})` : ''}`, value: Number(r.devices) || 0 })), [devices])

  if (loading && !ops && !error) return <LoadingState label="Loading mobile overview" />

  const attention = []
  if (ops && configOk) {
    if (!ops.latestVersion) {
      attention.push({ key: 'nolatest', tone: 'warning', text: 'No released version is recorded, so the forced-update rule cannot be checked or set.', actionLabel: 'Record a release', onAction: () => setTab('releases') })
    }
    if (behind != null && behind > 0) {
      attention.push({ key: 'behind', tone: 'warning', text: `${nf.format(behind)} active ${behind === 1 ? 'phone is' : 'phones are'} still below the newest release ${ops.latestVersion}.`, actionLabel: 'See versions', onAction: () => setTab('overview') })
    }
    if (!ops.minVersion && behind) {
      attention.push({ key: 'gateoff', tone: 'info', text: 'The forced-update gate is off, so those phones are never asked to update.', actionLabel: 'Update gate', onAction: () => setTab('gate') })
    }
    const stale = (devices?.byVersion || []).reduce((a, r) => a + Math.max(0, (Number(r.devices) || 0) - (Number(r.seen_30d) || 0)), 0)
    if (stale) {
      attention.push({ key: 'stale', tone: 'info', text: `${nf.format(stale)} registered ${stale === 1 ? 'device has' : 'devices have'} not opened the app in 30 days. They keep receiving push until revoked.`, to: '/console/sessions', actionLabel: 'Sessions & Devices' })
    }
  }

  const tileVersion = (v, empty) => (!ops ? 'N/A' : !configOk ? 'N/A' : v || empty)

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        icon={Smartphone}
        title="Mobile App Control"
        purpose="The field phones: what version is out, who is on it, and the forced-update rule."
        refreshedAt={readAt}
        onRefresh={load}
        refreshing={loading}
        meta={ops?.updatedAt ? <span>Update rule last changed {ageText(ops.updatedAt) || whenText(ops.updatedAt)}</span> : null}
      />

      <ErrorState message={error} onRetry={load} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatTile icon={Rocket} label="Newest released build" value={tileVersion(ops?.latestVersion, 'Not recorded')}
          sub="the version on Google Play right now" tone={ops?.latestVersion && configOk ? 'good' : 'warning'}
          onClick={() => setTab('releases')} active={tab === 'releases'} />
        <StatTile icon={ShieldAlert} label="Required minimum" value={tileVersion(ops?.minVersion, 'Gate off')}
          sub={!configOk ? 'could not be read' : ops?.minVersion ? 'older phones must update' : 'no phone is ever blocked'}
          tone={ops?.minVersion ? 'accent' : 'muted'} onClick={() => setTab('gate')} active={tab === 'gate'} />
        <StatTile icon={Smartphone} label="Active devices" value={devices ? nf.format(devices.active) : 'N/A'}
          sub={devices ? `${nf.format(devices.seen7d)} opened the app in 7 days` : 'install base unreadable'}
          onClick={() => setTab('overview')} active={tab === 'overview'} />
        <StatTile icon={Layers} label="Behind newest release" value={behind == null ? 'N/A' : nf.format(behind)}
          tone={behind ? 'warning' : 'good'} sub={behind == null ? 'needs a recorded release' : `of ${nf.format(devices?.active || 0)} active devices`} />
        <StatTile icon={Bell} label="Users who can get push" value={ops?.usersWithPush ?? 'N/A'}
          sub={devices ? `${nf.format(devices.users)} users have a registered device` : 'from user profiles'} tone="muted" />
      </div>

      {ops && configOk && <AttentionList items={attention} clear="Every active phone is on the newest release." />}

      {ops && (
        <nav aria-label="Mobile app views">
          <Segmented ariaLabel="Mobile app views" value={tab} onChange={setTab} options={[
            { key: 'overview', label: <><Users size={13} aria-hidden="true" />Install base</>, count: devices ? devices.byVersion.length : null },
            { key: 'gate', label: <><ShieldAlert size={13} aria-hidden="true" />Forced update</> },
            { key: 'releases', label: <><History size={13} aria-hidden="true" />Record a release</> },
            { key: 'login', label: <><ImageIcon size={13} aria-hidden="true" />Login pictures</> },
          ]} />
        </nav>
      )}

      {ops && tab === 'overview' && (
        <TabPanel label="Install base">
          <Panel>
            <PanelHeader icon={Smartphone} title="Where things stand"
              subtitle={configOk ? gateSummary(ops.minVersion, ops.latestVersion) : 'The app settings could not be read.'} />
            <p className="text-xs text-gray-500 leading-relaxed">
              Updates reach phones through Google Play. New builds go to the Internal testing track first
              (instant, no review) and the Closed testing track (needs a short Google review).
              A phone showing an old version simply has not installed the update yet - opening the app's
              Play Store page speeds that up.
            </p>
          </Panel>
          <Panel>
            <PanelHeader icon={Layers} title="Devices by app version"
              subtitle="Active registered phones and the version each last reported. Revoked devices are not counted."
              actions={<ExportButtons rows={versionRows} columns={VERSION_EXPORT} title="Mobile Devices by Version" disabled={!devices} />} />
            {devicesError ? (
              <ErrorState message={devicesError} onRetry={load} />
            ) : !devices ? (
              <LoadingState label="Reading the install base" rows={3} />
            ) : devices.byVersion.length === 0 ? (
              <EmptyState icon={Smartphone} title="No registered devices" reason="No phone has registered for notifications yet. Devices register when a user signs in to the field app." />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <BarsChart bars={versionBars} valueFormat={(v) => nf.format(v)}
                  summary={versionBars.map((b) => `${b.label} ${b.value}`).join(', ')} emptyText="No devices." />
                <Table>
                  <THead>
                    <Th sortKey="app_version" sort={sort} onSort={onSort}>Version</Th>
                    <Th sortKey="platform" sort={sort} onSort={onSort}>Platform</Th>
                    <Th align="right" sortKey="devices" sort={sort} onSort={onSort}>Devices</Th>
                    <Th align="right" sortKey="seen_30d" sort={sort} onSort={onSort}>Seen 30d</Th>
                    <Th sortKey="last_seen" sort={sort} onSort={onSort}>Last seen</Th>
                  </THead>
                  <tbody>
                    {versionRows.map((r) => {
                      const isLatest = ops.latestVersion && r.app_version && compareVersions(r.app_version, ops.latestVersion) === 0
                      const blocked = ops.minVersion && parseVersion(r.app_version) && compareVersions(r.app_version, ops.minVersion) < 0
                      return (
                        <Tr key={`${r.app_version}:${r.platform}`}>
                          <Td nowrap>
                            <span className="font-mono text-gray-200">{r.app_version || 'Unknown'}</span>{' '}
                            {isLatest && <Badge tone="good">Newest</Badge>}
                            {blocked && <Badge tone="danger">Must update</Badge>}
                          </Td>
                          <Td>{r.platform || 'Unknown'}</Td>
                          <Td align="right">{nf.format(Number(r.devices) || 0)}</Td>
                          <Td align="right">{nf.format(Number(r.seen_30d) || 0)}</Td>
                          <Td nowrap><span className="text-gray-500" title={whenText(r.last_seen)}>{ageText(r.last_seen) || 'N/A'}</span></Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </Panel>
        </TabPanel>
      )}

      {ops && tab === 'gate' && (
        <TabPanel label="Forced update">
          <Panel>
            <PanelHeader icon={ShieldAlert} title="Forced-update rule" tone="warning"
              subtitle="Phones on a version OLDER than this are shown an update screen and cannot continue until they update." />
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Required minimum version</span>
                  <input value={minDraft} onChange={(e) => setMinDraft(e.target.value)} placeholder="e.g. 1.3.2 (blank = gate off)"
                    disabled={!configOk} className={INPUT} />
                </label>
                <Btn icon={Save} variant="primary" onClick={() => (minDraft.trim() ? setConfirmMin(true) : saveMin())} busy={saving === 'min'}
                  disabled={!configOk || !minChanged || (risk && risk.level === 'blocked')}>
                  Save rule
                </Btn>
                {minChanged && <Btn onClick={() => setMinDraft(ops.minVersion || '')}>Undo</Btn>}
              </div>
              {risk && minChanged && (
                <Note tone={risk.level === 'blocked' ? 'danger' : risk.level === 'off' ? 'default' : 'accent'}>
                  {risk.level === 'blocked' ? 'Refused: ' : ''}{risk.reason}
                </Note>
              )}
              {minChanged && devices && impact.gated && risk?.level !== 'blocked' && (
                <Note icon={Users} tone={impact.behind ? 'warning' : 'default'}>
                  Impact: {nf.format(impact.behind)} of {nf.format(impact.total)} active {impact.total === 1 ? 'device' : 'devices'} would see the update screen on their next launch
                  {impact.unknown ? ` (${nf.format(impact.unknown)} more report no version, so they cannot be judged)` : ''}.
                </Note>
              )}
              {!minChanged && ops.minVersion && devices && (
                <p className="text-xs text-gray-400">
                  Right now {nf.format(savedImpact.behind)} active {savedImpact.behind === 1 ? 'device is' : 'devices are'} below {ops.minVersion} and must update.
                </p>
              )}
              {devicesError && <Note tone="warning">The install base could not be read, so the number of phones affected cannot be shown.</Note>}
              <Note>
                Safety rule built in: the minimum can never be set ABOVE the newest released build on record.
                That mistake would lock every phone out with nothing to update to, so this page refuses it
                rather than warning about it. Record a new release first, then raise the minimum.
              </Note>
            </div>
          </Panel>
        </TabPanel>
      )}

      {ops && tab === 'releases' && (
        <TabPanel label="Record a release">
          <Panel>
            <PanelHeader icon={Rocket} title="Record a new release"
              subtitle="After a new build ships on Google Play, record its version here so the safety rule always checks against the truth." />
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Newest released version</span>
                  <input value={latestDraft} onChange={(e) => setLatestDraft(e.target.value)} placeholder="e.g. 1.3.3"
                    disabled={!configOk} className={INPUT} />
                </label>
                <Btn icon={Save} onClick={saveLatest} busy={saving === 'latest'}
                  disabled={!configOk || !latestChanged || relRisk?.level === 'blocked'}>Record release</Btn>
                {latestChanged && <Btn onClick={() => setLatestDraft(ops.latestVersion || '')}>Undo</Btn>}
              </div>
              {relRisk && latestChanged && (
                <Note tone={relRisk.level === 'blocked' ? 'danger' : relRisk.level === 'warn' ? 'warning' : 'accent'}>
                  {relRisk.level === 'blocked' ? 'Refused: ' : ''}{relRisk.reason}
                </Note>
              )}
              <p className="text-xs text-gray-500">
                Devices that already report this version: {devices && parseVersion(latestDraft)
                  ? nf.format((devices.byVersion || []).filter((r) => r.app_version && compareVersions(r.app_version, latestDraft) === 0).reduce((a, r) => a + (Number(r.devices) || 0), 0))
                  : 'N/A'}. Testers see new builds first on the Play testing tracks.
              </p>
              <p className="text-xs text-gray-500">Push reach and device sign-outs are managed in <ConsoleLink plain to="/console/sessions">Sessions & Devices</ConsoleLink>.</p>
            </div>
          </Panel>
        </TabPanel>
      )}

      {tab === 'login' && (
        <TabPanel label="Login pictures">
          <LoginArtworkPanel onSaved={(json) => logAction?.('set_mobile_login_art', null, 'system', { value: json })} />
        </TabPanel>
      )}

      {msg && (msgIsError
        ? <ErrorState message={msg} />
        : <p className="text-xs text-gray-400" role="status">{msg}</p>)}

      <Modal open={confirmMin} onClose={() => setConfirmMin(false)} width="max-w-md"
        title="Force phones to update?"
        subtitle="Phones below this version cannot continue until they install the update."
        footer={(
          <>
            <Btn onClick={() => setConfirmMin(false)}>Cancel</Btn>
            <Btn variant="primary" icon={Save} onClick={saveMin} busy={saving === 'min'}
              disabled={!configOk || risk?.level === 'blocked'}>Save rule</Btn>
          </>
        )}>
        <p className="text-sm text-gray-300">
          Every phone running a version older than <span className="font-semibold text-gray-100">{minDraft.trim()}</span> will
          see an update screen on its next launch.
          {devices && impact.gated ? ` That is ${nf.format(impact.behind)} of the ${nf.format(impact.total)} active devices on record.` : ''}
        </p>
      </Modal>
    </div>
  )
}
