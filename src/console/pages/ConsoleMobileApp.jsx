/**
 * Mobile App Control - the owner's one screen for the FLUTTER field app
 * (tyre_pulse_flutter, Play package com.shahzebrahman.tyrepulse).
 *
 * Owner rule 2026-10-04: every mobile control refers to the Flutter app. The
 * retired Expo app keeps a read-only "Retired app" tab; nothing is removed.
 *
 * Two questions kept needing an engineer: "what version is out there?" and
 * "how do I force everyone to update?". Both are answered and actioned here,
 * with an interlock that REFUSES the one dangerous mistake: requiring a
 * version newer than anything released, which would lock every phone out with
 * nothing to update to.
 *
 * THE INTERLOCK, both directions, on the page AND on the server
 * (admin_set_flutter_version, migration 20261004105000):
 *   - the minimum is judged against the SAVED newest release (flutter_latest_version),
 *     never an unsaved draft;
 *   - recording a release BELOW the saved minimum is refused too;
 *   - junk is refused, because the Flutter app fails open on it
 *     (tyre_pulse_flutter/lib/core/auth/app_version.dart).
 * Every save needs a reason (system_config_history) and is audited (logAction).
 * Raising the minimum is a red action with a typed confirmation.
 * A failed read of the settings disables both saves.
 *
 * Tabs (?tab= or the tabParam the host passes): overview | gate | releases |
 * pipeline | history | login | retired.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Smartphone, ShieldAlert, Rocket, Save, Bell, Users, History, Layers, Image as ImageIcon, GitBranch, Archive,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Btn, Badge, LoadingState, ErrorState, Segmented, EmptyState, SearchInput,
  Table, THead, Th, Tr, Td, ImpactBox, ConfirmImpactDialog, Toolbar,
} from '../components/ui'
import { BarsChart } from '../components/ui/charts'
import { getFlutterOps, setFlutterVersion, listFlutterVersionHistory } from '../../lib/api/mobileOps'
import {
  gateRisk, gateSummary, compareVersions, parseVersion, FLUTTER_APP, VERSION_FILTERS, filterVersionRows,
} from '../../lib/mobileOps'
import { toUserMessage } from '../../lib/safeError'
import { sortRows, useTableSort } from '../../lib/consoleTable'
import { useConsoleAuth } from '../ConsoleAuthContext'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, AttentionList, ConsoleLink, TabPanel, whenText, ageText } from './shared/pageKit'
import { getFlutterDeviceVersions } from './mobileApp/deviceVersions'
import { latestRisk, gateImpact, behindLatest } from './mobileApp/releaseGuard'
import LoginArtworkPanel from './mobileApp/LoginArtworkPanel'
import { ReleasePipelinePanel, VersionHistoryPanel, RetiredAppPanel } from './mobileApp/FlutterPanels'

const nf = new Intl.NumberFormat('en-US')
const TABS = ['overview', 'gate', 'releases', 'pipeline', 'history', 'login', 'retired']
const INPUT = 'w-56 max-w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50'
const VERSION_EXPORT = [
  { key: 'app_version', header: 'App version', value: (r) => r.app_version || 'Not reported by device' },
  { key: 'platform', header: 'Platform', value: (r) => r.platform || 'Not reported by device' },
  { key: 'devices', header: 'Active devices' },
  { key: 'seen_30d', header: 'Seen in last 30 days' },
  { key: 'last_seen', header: 'Last seen' },
]

export default function ConsoleMobileApp({ tabParam = 'tab' } = {}) {
  const { logAction } = useConsoleAuth()
  const [ops, setOps] = useState(null)
  const [devices, setDevices] = useState(null)
  const [devicesError, setDevicesError] = useState('')
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [readAt, setReadAt] = useState(null)
  const [minDraft, setMinDraft] = useState('')
  const [latestDraft, setLatestDraft] = useState('')
  const [saving, setSaving] = useState('')
  const [msg, setMsg] = useState('')
  const [msgIsError, setMsgIsError] = useState(false)
  const [confirm, setConfirm] = useState(null) // 'min' | 'latest' | null
  const [confirmError, setConfirmError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [tab, setTab] = useUrlTab(TABS, 'overview', tabParam)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const [o, d, h] = await Promise.allSettled([getFlutterOps(), getFlutterDeviceVersions(), listFlutterVersionHistory(50)])
    if (o.status === 'fulfilled' && o.value) {
      setOps(o.value)
      setMinDraft(o.value.minVersion || '')
      setLatestDraft(o.value.latestVersion || '')
      if (!o.value.configOk) setError('Could not read the app settings. The versions shown may be incomplete, so saving is switched off until they can be read.')
    } else {
      setOps(null)
      setError(toUserMessage(o.reason, 'Could not load the Flutter app overview.'))
    }
    if (d.status === 'fulfilled' && d.value) { setDevices(d.value); setDevicesError('') } else {
      setDevices(null); setDevicesError(toUserMessage(d.reason, 'The device install base could not be read.'))
    }
    if (h.status === 'fulfilled') { setHistory(h.value || []); setHistoryError('') } else {
      setHistory(null); setHistoryError(toUserMessage(h.reason, 'The change history could not be read.'))
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
  const raising = minChanged && !!minDraft.trim() && (!ops?.minVersion || compareVersions(minDraft.trim(), ops.minVersion) > 0)
  const impact = useMemo(() => gateImpact(minDraft, devices?.byVersion), [minDraft, devices])
  const savedImpact = useMemo(() => gateImpact(ops?.minVersion, devices?.byVersion), [ops, devices])
  const behind = useMemo(() => (devices ? behindLatest(ops?.latestVersion, devices.byVersion) : null), [ops, devices])

  async function commit(which, { reason }) {
    const value = which === 'min' ? minDraft.trim() : latestDraft.trim()
    setSaving(which); setMsg(''); setMsgIsError(false); setConfirmError('')
    try {
      await setFlutterVersion(which, value, reason)
      await logAction?.(which === 'min' ? 'set_flutter_min_version' : 'set_flutter_latest_version', null, 'system', { value, reason })
      setConfirm(null)
      setMsg(which === 'min'
        ? (value ? `Saved. Flutter phones below ${value} must now update.` : 'Saved. The Flutter update gate is now off.')
        : `Recorded ${value} as the newest released Flutter build.`)
      await load()
    } catch (e) { setConfirmError(toUserMessage(e, 'Could not save.')) }
    setSaving('')
  }

  const { sort, onSort } = useTableSort({ key: 'devices', dir: 'desc' })
  const filteredRows = useMemo(() => filterVersionRows(devices?.byVersion || [], {
    search, filter, min: ops?.minVersion, latest: ops?.latestVersion,
  }), [devices, search, filter, ops])
  const versionRows = useMemo(() => sortRows(filteredRows, sort, {
    app_version: (r) => (parseVersion(r.app_version) ? parseVersion(r.app_version).map((n) => String(n).padStart(5, '0')).join('.') : null),
  }), [filteredRows, sort])
  const versionBars = useMemo(() => [...(devices?.byVersion || [])]
    .sort((a, b) => compareVersions(b.app_version, a.app_version))
    .map((r) => ({ label: `${r.app_version || 'Not reported by device'}${r.platform ? ` (${r.platform})` : ''}`, value: Number(r.devices) || 0 })), [devices])

  if (loading && !ops && !error) return <LoadingState label="Loading the Flutter app overview" />

  const attention = []
  if (ops && configOk) {
    if (!ops.latestVersion) {
      attention.push({ key: 'nolatest', tone: 'warning', text: 'No released Flutter version is recorded, so the forced-update rule cannot be checked or set.', actionLabel: 'Record a release', onAction: () => setTab('releases') })
    }
    if (devices && devices.active === 0) {
      attention.push({ key: 'nodevices', tone: 'info', text: 'No phone has registered the Flutter app for notifications yet. Devices appear after a tester installs a Flutter build and signs in.', actionLabel: 'Release path', onAction: () => setTab('pipeline') })
    }
    if (behind != null && behind > 0) {
      attention.push({ key: 'behind', tone: 'warning', text: `${nf.format(behind)} active ${behind === 1 ? 'phone is' : 'phones are'} still below the newest release ${ops.latestVersion}.`, actionLabel: 'See versions', onAction: () => { setFilter('behind'); setTab('overview') } })
    }
    if (!ops.minVersion && behind) {
      attention.push({ key: 'gateoff', tone: 'info', text: 'The forced-update gate is off, so those phones are never asked to update.', actionLabel: 'Update gate', onAction: () => setTab('gate') })
    }
    if (devices?.expoActive) {
      attention.push({ key: 'expo', tone: 'info', text: `${nf.format(devices.expoActive)} ${devices.expoActive === 1 ? 'device is' : 'devices are'} still registered by the retired Expo app.`, actionLabel: 'Retired app', onAction: () => setTab('retired') })
    }
    const stale = (devices?.byVersion || []).reduce((a, r) => a + Math.max(0, (Number(r.devices) || 0) - (Number(r.seen_30d) || 0)), 0)
    if (stale) {
      attention.push({ key: 'stale', tone: 'info', text: `${nf.format(stale)} registered ${stale === 1 ? 'device has' : 'devices have'} not opened the app in 30 days. They keep receiving push until revoked.`, to: '/console/sessions', actionLabel: 'Sessions & Devices' })
    }
  }

  const tileVersion = (v, empty) => (!ops ? 'N/A' : !configOk ? 'N/A' : v || empty)
  const minValue = minDraft.trim()
  const latestValue = latestDraft.trim()

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        icon={Smartphone}
        title="Mobile App Control"
        purpose={`The Flutter field app (${FLUTTER_APP.packageId}): which version is out, who is on it, and the forced-update rule.`}
        refreshedAt={readAt}
        onRefresh={load}
        refreshing={loading}
        meta={ops?.updatedAt ? <span>Update rule last changed {ageText(ops.updatedAt) || whenText(ops.updatedAt)}</span> : null}
      />

      <ErrorState message={error} onRetry={load} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatTile icon={Rocket} label="Newest Flutter release" value={tileVersion(ops?.latestVersion, 'Not recorded')}
          sub={`on the ${FLUTTER_APP.track} track`} tone={ops?.latestVersion && configOk ? 'good' : 'warning'}
          onClick={() => setTab('releases')} active={tab === 'releases'} />
        <StatTile icon={ShieldAlert} label="Required minimum" value={tileVersion(ops?.minVersion, 'Gate off')}
          sub={!configOk ? 'could not be read' : ops?.minVersion ? 'older phones must update' : 'no phone is ever blocked'}
          tone={ops?.minVersion ? 'accent' : 'muted'} onClick={() => setTab('gate')} active={tab === 'gate'} />
        <StatTile icon={Smartphone} label="Active Flutter devices" value={devices ? nf.format(devices.active) : 'N/A'}
          sub={devices ? `${nf.format(devices.seen7d)} opened the app in 7 days` : 'install base unreadable'}
          onClick={() => setTab('overview')} active={tab === 'overview'} />
        <StatTile icon={Layers} label="Behind newest release" value={behind == null ? 'N/A' : nf.format(behind)}
          tone={behind ? 'warning' : 'good'} sub={behind == null ? 'needs a recorded release and the install base' : `of ${nf.format(devices?.active || 0)} active devices`} />
        <StatTile icon={Bell} label="Users who can get push" value={devices ? nf.format(devices.users) : 'N/A'}
          sub={devices ? 'with a registered Flutter device' : 'install base unreadable'} tone="muted" />
      </div>

      {ops && configOk && <AttentionList items={attention} clear="Every active Flutter phone is on the newest release." />}

      {ops && (
        <nav aria-label="Mobile app views">
          <Segmented ariaLabel="Mobile app views" value={tab} onChange={setTab} options={[
            { key: 'overview', label: <><Users size={13} aria-hidden="true" />Install base</>, count: devices ? devices.byVersion.length : null },
            { key: 'gate', label: <><ShieldAlert size={13} aria-hidden="true" />Forced update</> },
            { key: 'releases', label: <><Rocket size={13} aria-hidden="true" />Record a release</> },
            { key: 'pipeline', label: <><GitBranch size={13} aria-hidden="true" />Release path</> },
            { key: 'history', label: <><History size={13} aria-hidden="true" />Change history</>, count: history ? history.length : null },
            { key: 'login', label: <><ImageIcon size={13} aria-hidden="true" />Login pictures</> },
            { key: 'retired', label: <><Archive size={13} aria-hidden="true" />Retired app</> },
          ]} />
        </nav>
      )}

      {ops && tab === 'overview' && (
        <TabPanel label="Install base">
          <Panel>
            <PanelHeader icon={Smartphone} title="Where things stand"
              subtitle={configOk ? gateSummary(ops.minVersion, ops.latestVersion) : 'The app settings could not be read.'} />
            <p className="text-xs text-gray-500 leading-relaxed">
              Flutter builds reach phones through Google Play, {FLUTTER_APP.track} track of {FLUTTER_APP.packageId}.
              A phone showing an old version simply has not installed the update yet. Only phones that registered
              for notifications are counted here; the retired Expo app is counted separately on the Retired app tab.
            </p>
          </Panel>
          <Panel>
            <PanelHeader icon={Layers} title="Devices by app version"
              subtitle="Active registered Flutter phones and the version each last reported. Revoked devices are not counted."
              actions={<ExportButtons rows={versionRows} columns={VERSION_EXPORT} title="Flutter Devices by Version" disabled={!devices} />} />
            {devicesError ? (
              <ErrorState message={devicesError} onRetry={load} />
            ) : !devices ? (
              <LoadingState label="Reading the install base" rows={3} />
            ) : devices.byVersion.length === 0 ? (
              <EmptyState icon={Smartphone} title="No registered Flutter devices"
                reason="No phone has registered the Flutter app for notifications yet. Devices register when a tester installs a Flutter build and signs in." />
            ) : (
              <div className="space-y-3">
                <Toolbar>
                  <SearchInput value={search} onChange={setSearch} placeholder="Search version or platform" className="w-full sm:w-64" />
                  <Segmented role="group" ariaLabel="Filter devices" value={filter} onChange={setFilter}
                    options={VERSION_FILTERS.map((f) => ({ key: f.key, label: f.label }))} />
                </Toolbar>
                <div className="grid gap-4 lg:grid-cols-2">
                  <BarsChart bars={versionBars} valueFormat={(v) => nf.format(v)}
                    summary={versionBars.map((b) => `${b.label} ${b.value}`).join(', ')} emptyText="No devices." />
                  {versionRows.length === 0 ? (
                    <EmptyState icon={Layers} title="No version matches" reason="Clear the search or pick another filter." />
                  ) : (
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
                                <span className="font-mono text-gray-200">{r.app_version || 'Not reported by device'}</span>{' '}
                                {isLatest && <Badge tone="good">Newest</Badge>}
                                {blocked && <Badge tone="danger">Must update</Badge>}
                              </Td>
                              <Td>{r.platform || 'Not reported by device'}</Td>
                              <Td align="right">{nf.format(Number(r.devices) || 0)}</Td>
                              <Td align="right">{nf.format(Number(r.seen_30d) || 0)}</Td>
                              <Td nowrap><span className="text-gray-500" title={whenText(r.last_seen)}>{ageText(r.last_seen) || 'N/A'}</span></Td>
                            </Tr>
                          )
                        })}
                      </tbody>
                    </Table>
                  )}
                </div>
              </div>
            )}
          </Panel>
        </TabPanel>
      )}

      {ops && tab === 'gate' && (
        <TabPanel label="Forced update">
          <Panel>
            <PanelHeader icon={ShieldAlert} title="Forced-update rule (Flutter app)" tone="warning"
              subtitle="Flutter phones on a version OLDER than this see an update screen after sign-in and cannot continue until they update. Their saved work stays on the phone." />
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Required minimum version</span>
                  <input value={minDraft} onChange={(e) => setMinDraft(e.target.value)} placeholder="e.g. 0.1.1 (blank = gate off)"
                    disabled={!configOk} className={INPUT} aria-label="Required minimum version" />
                </label>
                <Btn icon={Save} variant={raising ? 'danger' : 'primary'} onClick={() => { setConfirmError(''); setConfirm('min') }} busy={saving === 'min'}
                  disabled={!configOk || !minChanged || (risk && risk.level === 'blocked')}>
                  Save rule
                </Btn>
                {minChanged && <Btn onClick={() => setMinDraft(ops.minVersion || '')}>Undo</Btn>}
              </div>
              <ImpactBox tone="warning"
                change={`Sets system_config.${FLUTTER_APP.minKey}. Blank turns the gate off.`}
                who="Every Flutter phone below the minimum, on its next sign-in or return to the app."
                undo="Yes. Lower or clear the minimum and blocked phones carry on at their next check." />
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
                Safety rule built in, checked here and again by the server: the minimum can never be set ABOVE the
                newest released Flutter build on record. That mistake would lock every phone out with nothing to
                update to. Record a new release first, then raise the minimum. Text that is not a version number is
                refused, because the app ignores it.
              </Note>
            </div>
          </Panel>
        </TabPanel>
      )}

      {ops && tab === 'releases' && (
        <TabPanel label="Record a release">
          <Panel>
            <PanelHeader icon={Rocket} title="Record a new Flutter release"
              subtitle={`After a new build is live on the ${FLUTTER_APP.track} track, record its version name here so the safety rule always checks against the truth.`} />
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Newest released version</span>
                  <input value={latestDraft} onChange={(e) => setLatestDraft(e.target.value)} placeholder="e.g. 0.1.1"
                    disabled={!configOk} className={INPUT} aria-label="Newest released version" />
                </label>
                <Btn icon={Save} onClick={() => { setConfirmError(''); setConfirm('latest') }} busy={saving === 'latest'}
                  disabled={!configOk || !latestChanged || relRisk?.level === 'blocked'}>Record release</Btn>
                {latestChanged && <Btn onClick={() => setLatestDraft(ops.latestVersion || '')}>Undo</Btn>}
              </div>
              <ImpactBox
                change={`Sets system_config.${FLUTTER_APP.latestKey}. No phone sees anything different.`}
                who="Nobody directly. It is the ceiling the forced-update minimum is checked against."
                undo="Yes. Record the correct version at any time." />
              {relRisk && latestChanged && (
                <Note tone={relRisk.level === 'blocked' ? 'danger' : relRisk.level === 'warn' ? 'warning' : 'accent'}>
                  {relRisk.level === 'blocked' ? 'Refused: ' : ''}{relRisk.reason}
                </Note>
              )}
              <p className="text-xs text-gray-500">
                Use the version name from {FLUTTER_APP.versionSource}. Devices that already report this version: {devices && parseVersion(latestDraft)
                  ? nf.format((devices.byVersion || []).filter((r) => r.app_version && compareVersions(r.app_version, latestDraft) === 0).reduce((a, r) => a + (Number(r.devices) || 0), 0))
                  : 'N/A'}.
              </p>
              <p className="text-xs text-gray-500">Push reach and device sign-outs are managed in <ConsoleLink plain to="/console/sessions">Sessions & Devices</ConsoleLink>.</p>
            </div>
          </Panel>
        </TabPanel>
      )}

      {ops && tab === 'pipeline' && (
        <TabPanel label="Release path">
          <ReleasePipelinePanel latestVersion={configOk ? ops.latestVersion : ''} />
        </TabPanel>
      )}

      {ops && tab === 'history' && (
        <TabPanel label="Change history">
          <VersionHistoryPanel rows={history} error={historyError} loading={loading} onRetry={load} />
        </TabPanel>
      )}

      {tab === 'login' && (
        <TabPanel label="Login pictures">
          <LoginArtworkPanel onSaved={(json) => logAction?.('set_mobile_login_art', null, 'system', { value: json })} />
        </TabPanel>
      )}

      {ops && tab === 'retired' && (
        <TabPanel label="Retired app">
          <RetiredAppPanel retired={ops.retired} expoActive={devices ? devices.expoActive : null} configOk={configOk} />
        </TabPanel>
      )}

      {msg && (msgIsError
        ? <ErrorState message={msg} />
        : <p className="text-xs text-gray-400" role="status">{msg}</p>)}

      <ConfirmImpactDialog
        open={confirm === 'min'}
        title={!minValue ? 'Turn the Flutter update gate off?' : raising ? 'Force Flutter phones to update?' : 'Lower the Flutter minimum?'}
        danger={raising}
        confirmLabel="Save rule"
        requireReason
        typedWord={raising ? minValue : undefined}
        busy={saving === 'min'}
        error={confirmError}
        readyExtra={configOk && risk?.level !== 'blocked'}
        onCancel={() => setConfirm(null)}
        onConfirm={(r) => commit('min', r)}
        impact={{
          tone: raising ? 'danger' : 'info',
          what: !minValue ? 'No Flutter phone will be asked to update.'
            : `Every Flutter phone older than ${minValue} sees an update screen on its next check.`,
          stats: devices && impact.gated ? [
            { label: 'Would be blocked', value: nf.format(impact.behind) },
            { label: 'Unaffected', value: nf.format(impact.ok) },
            { label: 'No version', value: nf.format(impact.unknown) },
          ] : undefined,
          who: devices ? `${nf.format(devices.active)} active Flutter devices on record.` : 'The install base could not be read.',
          undo: 'Yes. Lower or clear the minimum again.',
        }} />

      <ConfirmImpactDialog
        open={confirm === 'latest'}
        title="Record this Flutter release?"
        confirmLabel="Record release"
        requireReason
        busy={saving === 'latest'}
        error={confirmError}
        readyExtra={configOk && relRisk?.level !== 'blocked'}
        onCancel={() => setConfirm(null)}
        onConfirm={(r) => commit('latest', r)}
        impact={{
          what: `Records ${latestValue || 'this version'} as the newest Flutter build on Google Play.`,
          change: 'The forced-update minimum may now be raised up to this version.',
          who: 'Nobody directly. Phones are unaffected until the minimum changes.',
          undo: 'Yes. Record the correct version at any time.',
        }} />
    </div>
  )
}
