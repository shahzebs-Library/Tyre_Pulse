/**
 * Storage page panels. Read only: every action here either opens a dialog
 * (ConfirmImpactDialog, retention dialog, drawers) or links elsewhere.
 * Figures come from admin_storage_summary; a missing figure reads N/A.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  HardDrive, TrendingUp, ListChecks, Boxes, Clock3, FileStack, Building2, Copy, SearchCheck, Lock, Download, Info, ShieldCheck,
} from 'lucide-react'
import {
  Panel, PanelHeader, Badge, Btn, Segmented, SearchInput, Table, THead, Th, Tr, Td, EmptyState, ErrorState, LoadingState, ImpactBox,
} from '../../components/ui'
import { BarsChart } from '../../components/ui/charts'
import { BarCell, ListRow, PanelFoot } from '../runtime/runtimeParts'
import {
  fmtBytes, fmtInt, BUCKET_INFO, FOLDER_INFO, isEvidenceBucket, allowedTypesLabel, retentionLabel, bucketChipCounts, fileTitle,
} from '../../../lib/storageCenter'
import { fmtRiyadh } from '../../../lib/databaseCenter'
import { exportConsoleRows } from '../../../lib/consoleTable'
import { openFile } from './StorageDialogs'

const pct = (a, b) => (Number(b) ? (Number(a) / Number(b)) * 100 : 0)
const SPACE_TONES = ['bg-orange-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-gray-500', 'bg-gray-600', 'bg-gray-700']

export function SpacePanel({ buckets, folders, total }) {
  const used = (buckets || []).filter((b) => Number(b.bytes) > 0)
  const top = used[0]
  const topFolders = (folders || []).filter((f) => f.bucket === top?.id).slice(0, 6)
  return (
    <Panel>
      <PanelHeader icon={HardDrive} title="Where the space goes"
        subtitle={top && total ? `${(pct(top.bytes, total)).toFixed(1)}% is ${top.id}` : 'Share of stored bytes by bucket'} />
      {!used.length ? <EmptyState icon={HardDrive} title="Nothing stored" reason="No bucket holds a file yet." /> : (
        <>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-800" role="img"
            aria-label={used.map((b) => `${b.id} ${pct(b.bytes, total).toFixed(1)}%`).join(', ')}>
            {used.map((b, i) => (
              <div key={b.id} className={SPACE_TONES[i] || 'bg-gray-700'} style={{ width: `${Math.max(pct(b.bytes, total), 0.4)}%` }} title={`${b.id}: ${fmtBytes(b.bytes)}`} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {used.map((b, i) => (
              <li key={b.id} className="flex items-center gap-1.5 text-gray-400">
                <span className={`h-2 w-2 rounded-sm ${SPACE_TONES[i] || 'bg-gray-700'}`} aria-hidden="true" />
                {b.id} <span className="tabular-nums text-gray-200">{fmtBytes(b.bytes)}</span>
              </li>
            ))}
          </ul>
          {topFolders.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold text-gray-400 mb-1.5">Inside {top.id}</p>
              <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
                {topFolders.map((f) => (
                  <li key={f.folder} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_9rem_auto] items-center gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-mono text-[11px] text-gray-200 truncate">{top.id}/{f.folder}/</span>
                      <span className="block text-[10px] text-gray-500 truncate">{FOLDER_INFO[`${top.id}/${f.folder}`] || 'Folder'}, {fmtInt(f.files)} files</span>
                    </span>
                    <span className="hidden sm:block"><BarCell pct={pct(f.bytes, top.bytes)} label={`${pct(f.bytes, top.bytes).toFixed(1)}%`} tone="accent" width="w-16" /></span>
                    <span className="text-xs tabular-nums text-gray-300">{fmtBytes(f.bytes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

export function GrowthPanel({ series, buckets, largestPhoto }) {
  const [mode, setMode] = useState('bytes')
  const photos = (buckets || []).find((b) => b.id === 'tyre-photos')
  const avg = photos && Number(photos.files) ? Number(photos.bytes) / Number(photos.files) : null
  const bars = (series?.points || []).map((p) => ({
    label: p.label,
    value: mode === 'bytes' ? Math.round((p.bytes / (1024 * 1024)) * 10) / 10 : p.files,
    color: p.estimate ? 'rgba(249,115,22,0.35)' : undefined,
  }))
  return (
    <Panel>
      <PanelHeader icon={TrendingUp} title="Growth per month" subtitle="New files added"
        actions={<Segmented ariaLabel="Growth measure" value={mode} onChange={setMode}
          options={[{ key: 'bytes', label: 'Size' }, { key: 'files', label: 'Files' }]} />} />
      <BarsChart horizontal={false} bars={bars} height={200} yLabel={mode === 'bytes' ? 'MB' : 'Files'}
        valueFormat={(v) => (mode === 'bytes' ? `${v} MB` : `${fmtInt(v)} files`)}
        summary={series?.latest ? `${series.latest.label}: ${fmtBytes(series.latest.bytes)} in ${fmtInt(series.latest.files)} files` : 'No uploads in the last 12 months'}
        emptyText="No file was added in the last 12 months." />
      <div className="mt-3 grid grid-cols-3 gap-px rounded-lg overflow-hidden border border-gray-800 bg-gray-800">
        {[
          ['Last 7 days', photos ? fmtInt(photos.files_7d) : 'N/A', 'tyre photos'],
          ['Average photo', avg ? fmtBytes(avg, { digits: 0 }) : 'N/A', largestPhoto ? `largest ${fmtBytes(largestPhoto)}` : 'no photos'],
          ['At this pace', series?.yearPace ? `+${fmtBytes(series.yearPace, { digits: 0 })}` : 'N/A', 'over 12 months'],
        ].map(([k, v, s]) => (
          <div key={k} className="bg-gray-950/60 px-3 py-2"><p className="text-[10px] text-gray-500">{k}</p>
            <p className="text-sm font-semibold text-gray-100 tabular-nums">{v}</p><p className="text-[10px] text-gray-500">{s}</p></div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Light bars are an estimate that repeats {series?.latest?.label || 'the latest month'}. Phones already shrink photos before upload.
      </p>
    </Panel>
  )
}

export function RecommendationsPanel({ items, onAct, generatedAt }) {
  const acts = items.filter((i) => i.tone === 'warning').length
  return (
    <Panel flush>
      <div className="p-4 pb-2">
        <PanelHeader icon={ListChecks} title="Recommendations"
          subtitle={generatedAt ? `Checked against every file at ${fmtRiyadh(generatedAt, { date: false, time: true })} Riyadh` : 'Checked against every file'}
          actions={<Badge tone={acts ? 'warning' : 'good'}>{acts ? `${acts} to act on` : 'Nothing to act on'}</Badge>} />
      </div>
      {!items.length ? <EmptyState icon={ListChecks} title="Nothing to recommend" reason="No copies, no uncovered buckets and no growth were found." /> : (
        <ul className="divide-y divide-gray-800 border-t border-gray-800">
          {items.map((r) => (
            <ListRow key={r.key} tone={r.tone} title={r.title} sub={r.body}
              right={<Btn size="xs" onClick={() => onAct(r.target)}>{r.action}</Btn>} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function BucketsPanel({ buckets, rules, tenantExportDays, onOpen, onRule, onScan }) {
  const [search, setSearch] = useState('')
  const [chip, setChip] = useState('all')
  const [selected, setSelected] = useState(() => new Set())
  const counts = bucketChipCounts(buckets, rules, tenantExportDays)
  const rows = useMemo(() => (buckets || []).filter((b) => {
    const ret = retentionLabel(b.id, rules, tenantExportDays)
    if (chip === 'used' && !Number(b.files)) return false
    if (chip === 'empty' && Number(b.files)) return false
    if (chip === 'rule' && ret.text === 'Keep forever') return false
    const q = search.trim().toLowerCase()
    return !q || b.id.includes(q) || (BUCKET_INFO[b.id]?.description || '').toLowerCase().includes(q)
  }), [buckets, rules, tenantExportDays, chip, search])
  const publicCount = (buckets || []).filter((b) => b.public).length
  const sel = (buckets || []).filter((b) => selected.has(b.id))

  function toggle(id) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  async function exportList() {
    await exportConsoleRows({
      title: 'Storage buckets',
      rows: rows.map((b) => ({
        id: b.id, description: BUCKET_INFO[b.id]?.description || '', files: b.files, size: fmtBytes(b.bytes),
        limit: b.file_size_limit ? fmtBytes(b.file_size_limit, { digits: 0 }) : 'No limit', allowed: allowedTypesLabel(b.allowed_mime_types),
        access: b.public ? 'Public' : 'Private', retention: retentionLabel(b.id, rules, tenantExportDays).text,
      })),
      columns: [{ key: 'id', header: 'Bucket' }, { key: 'description', header: 'Holds' }, { key: 'files', header: 'Files' }, { key: 'size', header: 'Size' },
        { key: 'limit', header: 'File limit' }, { key: 'allowed', header: 'Allowed' }, { key: 'access', header: 'Access' }, { key: 'retention', header: 'Retention' }],
    })
  }

  return (
    <Panel flush>
      <div className="p-4 pb-3 space-y-3">
        <PanelHeader icon={Boxes} title="Buckets"
          subtitle={publicCount ? `${publicCount} public` : `All ${counts.all} private. Files are only reachable through signed, expiring links`}
          actions={<Btn icon={Download} onClick={exportList} disabled={!rows.length}>Export list</Btn>} />
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Find a bucket or folder" ariaLabel="Find a bucket" className="w-full sm:w-60" />
          <Segmented ariaLabel="Bucket filter" value={chip} onChange={setChip} options={[
            { key: 'all', label: 'All', count: counts.all }, { key: 'used', label: 'In use', count: counts.used },
            { key: 'empty', label: 'Empty', count: counts.empty }, { key: 'rule', label: 'With a retention rule', count: counts.rule },
          ]} />
        </div>
        {sel.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-800/50 bg-orange-950/20 px-3 py-2 text-xs">
            <span className="text-gray-200">{sel.length} selected</span>
            <span className="text-gray-500 truncate">{sel.map((b) => `${b.id}, ${fmtInt(b.files)} files, ${fmtBytes(b.bytes)}`).join('; ')}</span>
            <span className="flex-1" />
            <Btn size="xs" onClick={() => onRule(sel[0].id)}>Set retention rule</Btn>
            <Btn size="xs" onClick={onScan}>Run orphan scan</Btn>
            <Btn size="xs" onClick={() => setSelected(new Set())}>Clear</Btn>
          </div>
        )}
      </div>
      {!rows.length ? <EmptyState icon={Boxes} title="No bucket matches" reason="Change the search or the filter." /> : (
        <Table>
          <THead>
            <Th><span className="sr-only">Select</span></Th><Th>Bucket</Th><Th align="right">Files</Th><Th align="right">Size</Th>
            <Th>File limit</Th><Th>Allowed</Th><Th>Access</Th><Th>Retention</Th>
          </THead>
          <tbody>
            {rows.map((b) => {
              const ret = retentionLabel(b.id, rules, tenantExportDays)
              return (
                <Tr key={b.id} onClick={() => onOpen(b)} ariaLabel={`Open bucket ${b.id}`}>
                  <Td><input type="checkbox" checked={selected.has(b.id)} aria-label={`Select ${b.id}`}
                    onClick={(e) => e.stopPropagation()} onChange={() => toggle(b.id)} className="accent-orange-500" /></Td>
                  <Td className="max-w-[16rem]"><span className="block font-mono text-[11.5px] text-gray-200">{b.id}</span>
                    <span className="block text-[11px] text-gray-500 truncate">{BUCKET_INFO[b.id]?.description || 'Storage bucket'}</span></Td>
                  <Td align="right" className="tabular-nums">{fmtInt(b.files)}</Td>
                  <Td align="right" className="tabular-nums">{fmtBytes(b.bytes)}</Td>
                  <Td nowrap>{b.file_size_limit ? `${fmtBytes(b.file_size_limit, { digits: 0 })} per file` : 'No limit'}</Td>
                  <Td>{allowedTypesLabel(b.allowed_mime_types)}</Td>
                  <Td><Badge tone={b.public ? 'danger' : 'good'} icon={Lock}>{b.public ? 'Public' : 'Private'}</Badge></Td>
                  <Td nowrap>{ret.text}</Td>
                </Tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  )
}

export function RetentionRulesPanel({ buckets, rules, tenantExportDays, onEdit }) {
  const imp = (buckets || []).find((b) => b.id === 'import-files')
  const rows = (buckets || []).filter((b) => Number(b.files) > 0 || rules.some((r) => r.bucket === b.id) || b.id === 'tenant-exports')
  return (
    <Panel flush>
      <div className="p-4 pb-3">
        <PanelHeader icon={Clock3} title="Retention rules" subtitle="How long files are kept"
          actions={<Btn onClick={() => onEdit(null)}>Add rule</Btn>} />
      </div>
      <Table>
        <THead><Th>Bucket</Th><Th>Rule</Th><Th>Runs</Th><Th>Note</Th><Th align="right"><span className="sr-only">Edit</span></Th></THead>
        <tbody>
          {rows.map((b) => {
            const ret = retentionLabel(b.id, rules, tenantExportDays)
            const evidence = isEvidenceBucket(b.id)
            const note = b.id === 'tenant-exports' ? 'Applied by the nightly export cleanup'
              : evidence ? (b.id === 'accident-photos' ? 'Legal evidence, do not delete' : 'Evidence for tyre history')
                : b.id === 'import-files' && imp ? `${fmtInt(imp.older_60_files)} files older than 60 days` : ret.rule ? `Saved by ${ret.rule.created_by ? 'a super admin' : 'the system'}` : ''
            return (
              <Tr key={b.id}>
                <Td className="font-mono text-[11.5px]">{b.id}</Td>
                <Td nowrap>{ret.text}</Td>
                <Td nowrap><Badge tone={ret.applied ? 'good' : ret.rule ? 'warning' : 'quiet'}>{ret.runs}</Badge></Td>
                <Td className="text-gray-500">{note}</Td>
                <Td align="right">
                  {evidence ? <Badge tone="warning">Needs owner decision</Badge> : <Btn size="xs" onClick={() => onEdit(b.id)}>Edit</Btn>}
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </Table>
      <PanelFoot icon={Info}>
        Accident, tyre and fine files are evidence. A delete rule on them needs owner decision. Rules on other buckets are saved but not applied until an owner approves a cleanup job; only company exports are deleted automatically today.
      </PanelFoot>
    </Panel>
  )
}

export function LargestFilesPanel({ largest, onError }) {
  const rows = largest || []
  return (
    <Panel flush>
      <div className="p-4 pb-3">
        <PanelHeader icon={FileStack} title="Largest files" subtitle="Photos are small; uploads are the big ones" />
      </div>
      {!rows.length ? <EmptyState icon={FileStack} title="No files" reason="Nothing is stored yet." /> : (
        <Table>
          <THead><Th>Bucket</Th><Th>File</Th><Th align="right">Size</Th><Th>Added</Th><Th align="right"><span className="sr-only">Open</span></Th></THead>
          <tbody>
            {rows.map((f) => (
              <Tr key={`${f.bucket}/${f.name}`}>
                <Td className="font-mono text-[11px] text-gray-400">{f.bucket}</Td>
                <Td className="max-w-[16rem]"><span className="block truncate text-gray-200" title={f.name}>{fileTitle(f.bucket, f.name)}</span>
                  {f.has_copy && <span className="block text-[10px] text-amber-300">Has an exact copy (same checksum)</span>}</Td>
                <Td align="right" className="tabular-nums">{fmtBytes(f.bytes)}</Td>
                <Td nowrap>{fmtRiyadh(f.created_at)}</Td>
                <Td align="right"><Btn size="xs" icon={Download} ariaLabel={`Open ${f.name}`} onClick={() => openFile(f.bucket, f.name, onError)}>Open</Btn></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  )
}

export function CompaniesPanel({ companies, totalBytes }) {
  const rows = companies || []
  const inFolders = rows.reduce((s, c) => s + (Number(c.bytes) || 0), 0)
  return (
    <Panel flush>
      <div className="p-4 pb-2">
        <PanelHeader icon={Building2} title="By company" subtitle="Against plan storage" />
      </div>
      <ul className="divide-y divide-gray-800 border-t border-gray-800">
        {rows.map((c) => (
          <ListRow key={c.folder} tone={Number(c.members) ? 'good' : 'warning'} title={c.org_name || `Folder ${String(c.folder).slice(0, 8)}`}
            sub={`${fmtInt(c.files)} files in ${c.buckets}, ${fmtRiyadh(c.first_at)} to ${fmtRiyadh(c.last_at)}${Number(c.members) ? '' : ', company has no members today'}`}
            right={<><p className="text-xs tabular-nums text-gray-200">{fmtBytes(c.bytes)}</p><p className="text-[10px] text-gray-500">limit N/A</p></>} />
        ))}
        <ListRow tone="default" title="Photos and files with no company folder"
          sub="Photos are not split by company folder today, so they cannot be counted per company."
          right={<><p className="text-xs tabular-nums text-gray-200">{fmtBytes(Math.max(0, Number(totalBytes || 0) - inFolders))}</p><p className="text-[10px] text-gray-500">limit N/A</p></>} />
      </ul>
      <PanelFoot icon={Info}>Plan limits apply once billing is live. Until then there is no storage limit to compare against (N/A).</PanelFoot>
    </Panel>
  )
}

export function DuplicatesPanel({ buckets, onReview }) {
  const withDup = (buckets || []).filter((b) => Number(b.duplicate_files) > 0)
  const files = withDup.reduce((s, b) => s + Number(b.duplicate_files), 0)
  const bytes = withDup.reduce((s, b) => s + Number(b.duplicate_bytes), 0)
  const why = { 'tyre-photos': 'Same photo uploaded twice, often a retried upload', 'import-files': 'Same ERP file uploaded more than once' }
  return (
    <Panel flush>
      <div className="p-4 pb-2">
        <PanelHeader icon={Copy} title="Duplicates" subtitle={files ? `${fmtInt(files)} copies, ${fmtBytes(bytes)}` : 'No exact copies'}
          actions={<Btn onClick={onReview} disabled={!files}>Review</Btn>} />
      </div>
      {files > 0 && (
        <>
          <ul className="divide-y divide-gray-800 border-t border-gray-800">
            {withDup.map((b) => (
              <ListRow key={b.id} tone="warning" title={b.id} sub={why[b.id] || 'Same content stored more than once'}
                right={<><p className="text-xs tabular-nums text-gray-200">{fmtBytes(b.duplicate_bytes)}</p><p className="text-[10px] text-gray-500">{fmtInt(b.duplicate_files)} copies</p></>} />
            ))}
          </ul>
          <div className="p-4 pt-3">
            <ImpactBox tone="info" what={`${fmtInt(files)} files have the same content as an earlier file (matched by checksum and size).`}
              change="Removing copies would keep the oldest file and delete the rest, after moving records that point at a copy to the kept one."
              who={`Nobody would see a change; photos keep opening. ${fmtBytes(bytes)} would be freed.`}
              undo="No for the files. Removal needs owner decision and an edge function that re-points records first; today you can review and export." />
          </div>
        </>
      )}
    </Panel>
  )
}

export function OrphansPanel({ scan, buckets, onScan, busy }) {
  const r = scan?.result || null
  const empty = (buckets || []).filter((b) => !Number(b.files)).map((b) => b.id)
  return (
    <Panel flush>
      <div className="p-4 pb-2">
        <PanelHeader icon={SearchCheck} title="Orphan files"
          subtitle={scan ? `Last scan ${fmtRiyadh(scan.ran_at, { time: true })}` : 'Not scanned yet'}
          actions={<Btn busy={busy} onClick={onScan}>Run scan</Btn>} />
      </div>
      <ul className="divide-y divide-gray-800 border-t border-gray-800">
        {r ? (
          <>
            <ListRow tone={r.unrecorded_imports?.files ? 'warning' : 'good'} title={`${fmtInt(r.unrecorded_imports?.files)} upload files with no import record`}
              sub={r.unrecorded_imports?.files ? `${fmtBytes(r.unrecorded_imports.bytes)}. Files in import-files that no import batch points at.` : 'Every upload file belongs to an import.'} />
            <ListRow tone={r.unrecorded_exports?.files ? 'warning' : 'good'} title={`${fmtInt(r.unrecorded_exports?.files)} export files with no export job`}
              sub={r.unrecorded_exports?.files ? fmtBytes(r.unrecorded_exports.bytes) : 'Every export part belongs to a job.'} />
            <ListRow tone={r.memberless_company_files?.files ? 'warning' : 'good'} title={`${fmtInt(r.memberless_company_files?.files)} files in a company folder with no members`}
              sub={r.memberless_company_files?.files ? `${fmtBytes(r.memberless_company_files.bytes)}. ${(r.memberless_company_files.sample || []).slice(0, 2).map((s) => s.org_name || 'unknown company').join(', ')}` : 'Every company folder has members.'} />
            <ListRow tone="default" title="Photos kept after a record is deleted" sub="Photo references are spread over many tables, so this count is not checked (N/A). Rotation and specification files stay by design." right={<Badge tone="quiet">Unknown count</Badge>} />
          </>
        ) : (
          <ListRow tone="warning" title="No orphan scan has run" sub="Unused files are unknown until a scan runs. The scan only reads; it deletes nothing." />
        )}
        <ListRow tone={empty.length ? 'default' : 'good'} title={`${empty.length} empty bucket${empty.length === 1 ? '' : 's'}`}
          sub={empty.length ? `${empty.join(' and ')} hold 0 files` : 'Every bucket holds files'} right={empty.length ? <Badge tone="quiet">Keep</Badge> : null} />
      </ul>
    </Panel>
  )
}

export function AccessPanel({ buckets }) {
  const list = buckets || []
  const pub = list.filter((b) => b.public)
  const noDelete = list.filter((b) => Number(b.files) > 0 && !b.has_delete_policy).map((b) => b.id)
  return (
    <Panel flush>
      <div className="p-4 pb-2">
        <PanelHeader icon={ShieldCheck} title="Access" subtitle={pub.length ? `${pub.length} public` : 'Private'} />
      </div>
      <ul className="divide-y divide-gray-800 border-t border-gray-800">
        <ListRow tone={pub.length ? 'danger' : 'good'} title="Public buckets"
          sub={pub.length ? `${pub.map((b) => b.id).join(', ')} can be read without signing in.` : `0 of ${list.length}. Nothing is readable without signing in.`}
          right={<Badge tone={pub.length ? 'danger' : 'good'}>{pub.length ? 'Fail' : 'Pass'}</Badge>} />
        <ListRow tone="good" title="Signed links" sub="Files open through links that expire" right={<Badge tone="good">On</Badge>} />
        <ListRow tone="default" title="Delete permission"
          sub={noDelete.length ? `${noDelete.join(', ')} ${noDelete.length === 1 ? 'has' : 'have'} no delete rule, so app users cannot delete those files` : 'Every bucket in use has a delete rule'}
          right={<Badge tone="quiet">By design</Badge>} />
        <ListRow tone="default" title="Security Audit check" sub="The weekly scan checks for public buckets."
          right={<Link to="/console/security-audit" className="text-xs text-orange-300 hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">Open</Link>} />
      </ul>
    </Panel>
  )
}

export function StorageLoading() { return <LoadingState label="Reading every stored file" rows={6} /> }
export function StorageError({ message, onRetry }) { return <ErrorState message={message} onRetry={onRetry} /> }
