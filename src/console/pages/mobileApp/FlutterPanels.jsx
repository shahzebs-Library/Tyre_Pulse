/**
 * Read-mostly panels for the Mobile App page (Flutter field app):
 *   ReleasePipelinePanel - how a build reaches phones (shown, never triggered)
 *   VersionHistoryPanel  - who changed the Flutter gate or release, and why
 *   RetiredAppPanel      - the retired Expo app's keys, read-only
 *
 * Kept in gray/orange/red/amber families so the console light theme applies.
 */
import { useMemo, useState } from 'react'
import { GitBranch, History, Archive, ExternalLink } from 'lucide-react'
import {
  Panel, PanelHeader, Note, Badge, Code, LoadingState, ErrorState, EmptyState, SearchInput,
  Table, THead, Th, Tr, Td,
} from '../../components/ui'
import ExportButtons from '../shared/ExportButtons'
import { whenText, ageText } from '../shared/pageKit'
import { FLUTTER_APP, RETIRED_EXPO_APP } from '../../../lib/mobileOps'

const nf = new Intl.NumberFormat('en-US')

export function ReleasePipelinePanel({ latestVersion }) {
  const steps = [
    ['Bump the version', `Raise the version name in ${FLUTTER_APP.versionSource}. A build with an unchanged version cannot be told apart on this page.`],
    ['Run the release workflow', `GitHub Actions, "${FLUTTER_APP.workflowName}" (${FLUTTER_APP.workflow}). It runs only when started by hand; nothing on this page starts it.`],
    ['Wait for Google', `The signed build goes to the ${FLUTTER_APP.track} track of ${FLUTTER_APP.packageId}. Closed testing needs a short Google review before testers see it.`],
    ['Record the release here', 'Once testers can install it, record the version on "Record a release" so the safety rule checks against the truth.'],
    ['Only then raise the minimum', 'Raise the forced-update minimum after the new build is live on the track, never before.'],
  ]
  return (
    <Panel>
      <PanelHeader icon={GitBranch} title="How a Flutter release reaches phones"
        subtitle="The release path for the field app. Shown for reference only: no build is started from the console." />
      <ol className="space-y-2">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex gap-3 text-xs">
            <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-gray-800 text-gray-300 grid place-items-center text-[11px] font-semibold">{i + 1}</span>
            <span><span className="text-gray-200 font-medium">{t}.</span> <span className="text-gray-400">{d}</span></span>
          </li>
        ))}
      </ol>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
          <p className="text-[11px] text-gray-500">Play package</p>
          <p className="mt-0.5"><Code>{FLUTTER_APP.packageId}</Code></p>
          <p className="text-[11px] text-gray-500 mt-2">Track</p>
          <p className="text-gray-200">{FLUTTER_APP.track}</p>
          <p className="text-[11px] text-gray-500 mt-2">Newest release on record</p>
          <p className="font-mono text-gray-200">{latestVersion || 'Not recorded'}</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
          <p className="text-[11px] text-gray-500">Release workflow</p>
          <p className="mt-0.5"><Code>{FLUTTER_APP.workflow}</Code></p>
          <a href={FLUTTER_APP.workflowUrl} target="_blank" rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-orange-400 hover:text-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">
            Open the workflow on GitHub <ExternalLink size={12} aria-hidden="true" />
          </a>
          <p className="text-[11px] text-gray-500 mt-2">Production promotion is the owner&apos;s decision in Play Console only.</p>
        </div>
      </div>
    </Panel>
  )
}

const HISTORY_EXPORT = [
  { key: 'changed_at', header: 'When' },
  { key: 'key', header: 'Setting', value: (r) => (r.key === FLUTTER_APP.minKey ? 'Forced-update minimum' : 'Newest release') },
  { key: 'old_value', header: 'From', value: (r) => r.old_value || 'Not set' },
  { key: 'new_value', header: 'To', value: (r) => r.new_value || 'Not set' },
  { key: 'changed_by_name', header: 'Changed by' },
  { key: 'reason', header: 'Reason', value: (r) => r.reason || 'Not recorded' },
]

export function VersionHistoryPanel({ rows, error, loading, onRetry }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows || []
    return (rows || []).filter((r) => [r.old_value, r.new_value, r.reason, r.changed_by_name].join(' ').toLowerCase().includes(s))
  }, [rows, q])
  return (
    <Panel>
      <PanelHeader icon={History} title="Change history"
        subtitle="Every change to the Flutter minimum or newest release, with who made it and the reason they gave."
        actions={<ExportButtons rows={shown} columns={HISTORY_EXPORT} title="Flutter Version Changes" disabled={!rows?.length} />} />
      {error ? <ErrorState message={error} onRetry={onRetry} />
        : loading && !rows ? <LoadingState label="Reading the change history" rows={3} />
          : !rows?.length ? (
            <EmptyState icon={History} title="No changes recorded yet"
              reason="Changes made from this page are recorded here from now on. Earlier edits made outside the console were not logged." />
          ) : (
            <div className="space-y-3">
              <SearchInput value={q} onChange={setQ} placeholder="Search versions, reasons, people" ariaLabel="Search change history" />
              <Table>
                <THead>
                  <Th>When</Th><Th>Setting</Th><Th>From</Th><Th>To</Th><Th>By</Th><Th>Reason</Th>
                </THead>
                <tbody>
                  {shown.map((r) => (
                    <Tr key={r.id}>
                      <Td nowrap><span title={whenText(r.changed_at)} className="text-gray-400">{ageText(r.changed_at) || whenText(r.changed_at)}</span></Td>
                      <Td nowrap>{r.key === FLUTTER_APP.minKey ? 'Minimum' : 'Newest release'}</Td>
                      <Td><span className="font-mono">{r.old_value || 'Not set'}</span></Td>
                      <Td><span className="font-mono text-gray-100">{r.new_value || 'Not set'}</span></Td>
                      <Td>{r.changed_by_name}</Td>
                      <Td className="max-w-xs break-words text-gray-400">{r.reason || 'Not recorded'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {!shown.length && <p className="text-xs text-gray-500">No change matches that search.</p>}
            </div>
          )}
    </Panel>
  )
}

export function RetiredAppPanel({ retired, expoActive, configOk }) {
  return (
    <Panel>
      <PanelHeader icon={Archive} title="Retired app (read-only)"
        subtitle="The old Expo app is no longer built or released. Its settings are shown so nothing is hidden, and nothing here can be changed."
        actions={<Badge tone="quiet">Retired</Badge>} />
      <div className="grid gap-2 sm:grid-cols-4 text-xs">
        <Fact label="Play package" value={<Code>{RETIRED_EXPO_APP.packageId}</Code>} />
        <Fact label="Its minimum (mobile_min_version)" value={!configOk ? 'N/A' : retired?.minVersion || 'Not set'} mono />
        <Fact label="Its last release (mobile_latest_version)" value={!configOk ? 'N/A' : retired?.latestVersion || 'Not recorded'} mono />
        <Fact label="Devices still registered" value={expoActive == null ? 'N/A' : nf.format(expoActive)}
          sub={expoActive == null ? 'install base unreadable' : 'they keep getting push until revoked'} />
      </div>
      <div className="mt-3"><Note>
        These phones are not counted in the Flutter figures above. They stop being relevant once each person
        installs the Flutter app and signs in. Last change to the retired keys: {retired?.updatedAt ? whenText(retired.updatedAt) : 'N/A'}.
      </Note></div>
    </Panel>
  )
}

function Fact({ label, value, sub, mono }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`mt-0.5 text-gray-200 ${mono ? 'font-mono' : ''}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}
