/**
 * Storage dialogs: the bucket drawer, the retention rule dialog and the
 * duplicates review drawer. Nothing here deletes a file:
 *   - a retention rule is RECORDED (enabled = false). No cleanup job reads it
 *     yet; running it on a schedule needs an owner decision.
 *   - duplicates are listed for review. Removing copies needs an edge function
 *     that first re-points records to the kept file (owner decision).
 * Every change asks for a reason and is audited by the server function.
 */
import { useEffect, useMemo, useState } from 'react'
import { Download, Search, Save, Trash2, Copy, Ruler } from 'lucide-react'
import {
  Btn, Badge, Note, Table, THead, Th, Tr, Td, LoadingState, ErrorState, EmptyState, ImpactBox, Modal,
  ConfirmImpactDialog, SearchInput, Segmented,
} from '../../components/ui'
import { Drawer } from '../shared/pageKit'
import {
  fmtBytes, fmtInt, BUCKET_INFO, FOLDER_INFO, isEvidenceBucket, allowedTypesLabel, retentionLabel, fileTitle, MB,
} from '../../../lib/storageCenter'
import { fmtRiyadh } from '../../../lib/databaseCenter'
import {
  listBucketFiles, listDuplicateFiles, previewRetention, saveRetentionRule, removeRetentionRule, setBucketFileLimit, signedFileLink,
} from '../../../lib/api/storageCenter'
import { setRetentionDays } from '../../../lib/api/tenantExport'
import { exportConsoleRows } from '../../../lib/consoleTable'
import { toUserMessage } from '../../../lib/safeError'
import { useConsoleAuth } from '../../ConsoleAuthContext'

const FIELD = 'w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

/** Open one file through a 60 second signed link. */
export async function openFile(bucket, name, onError) {
  try {
    const url = await signedFileLink(bucket, name)
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch (e) { onError?.(toUserMessage(e, 'This file could not be opened.')) }
}

// ── bucket drawer ────────────────────────────────────────────────────────────
export function BucketDrawer({ bucket, folders = [], rules, tenantExportDays, onClose, onChanged, onAddRule }) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [files, setFiles] = useState({ rows: null, total: null, error: '' })
  const [linkErr, setLinkErr] = useState('')
  const [limitOpen, setLimitOpen] = useState(false)
  const [limitMb, setLimitMb] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const id = bucket?.id

  useEffect(() => { setSearch(''); setQ(''); setLinkErr(''); setErr('') }, [id])
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => {
    if (!id) return undefined
    let off = false
    setFiles((f) => ({ ...f, rows: null, error: '' }))
    listBucketFiles(id, { search: q || null, limit: 50 })
      .then((r) => { if (!off) setFiles({ rows: r?.rows || [], total: r?.total ?? null, error: '' }) })
      .catch((e) => { if (!off) setFiles({ rows: null, total: null, error: toUserMessage(e, 'The file list could not be read.') }) })
    return () => { off = true }
  }, [id, q])

  if (!bucket) return null
  const ret = retentionLabel(bucket.id, rules, tenantExportDays)
  const bucketFolders = folders.filter((f) => f.bucket === bucket.id)
  const limitNow = Number(bucket.file_size_limit) || null
  const nextBytes = Math.round(Number(limitMb) * MB)
  const limitValid = Number.isFinite(nextBytes) && nextBytes >= MB && nextBytes <= 500 * MB

  async function saveLimit({ reason }) {
    setBusy(true); setErr('')
    try {
      await setBucketFileLimit(bucket.id, nextBytes, reason)
      setLimitOpen(false); onChanged?.()
    } catch (e) { setErr(toUserMessage(e, 'The file limit could not be changed.')) } finally { setBusy(false) }
  }

  return (
    <Drawer open={!!bucket} onClose={onClose} width="max-w-2xl" title={bucket.id}
      subtitle={BUCKET_INFO[bucket.id]?.description || 'Storage bucket'}
      footer={<Btn onClick={onClose}>Close</Btn>}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg overflow-hidden border border-gray-800 bg-gray-800">
        {[
          ['Files', fmtInt(bucket.files)], ['Size', fmtBytes(bucket.bytes)],
          ['Added this month', fmtInt(bucket.files_month)], ['Last upload', bucket.last_upload ? fmtRiyadh(bucket.last_upload, { time: true }) : 'None'],
        ].map(([k, v]) => (
          <div key={k} className="bg-gray-950 px-3 py-2"><p className="text-[10px] text-gray-500">{k}</p><p className="text-xs font-semibold text-gray-200 tabular-nums">{v}</p></div>
        ))}
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-300">Settings</h3>
        <dl className="text-xs divide-y divide-gray-800 rounded-lg border border-gray-800">
          {[
            ['Access', bucket.public ? 'Public: anyone with the path can read' : 'Private: signed, expiring links only'],
            ['File limit', limitNow ? `${fmtBytes(limitNow, { digits: 0 })} per file` : 'No limit set'],
            ['Allowed types', allowedTypesLabel(bucket.allowed_mime_types)],
            ['Retention', `${ret.text} (${ret.runs})`],
            ['Delete permission for app users', bucket.has_delete_policy ? 'Yes, a delete rule exists' : 'None: app users cannot delete files here'],
            ['Files older than 60 days', `${fmtInt(bucket.older_60_files)} (${fmtBytes(bucket.older_60_bytes)})`],
            ['Exact copies', `${fmtInt(bucket.duplicate_files)} (${fmtBytes(bucket.duplicate_bytes)})`],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[10rem_1fr] gap-2 px-3 py-2"><dt className="text-gray-500">{k}</dt><dd className="text-gray-300 break-words">{v}</dd></div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Btn icon={Ruler} onClick={() => { setLimitMb(limitNow ? String(Math.round(limitNow / MB)) : '20'); setLimitOpen(true) }}>Change file limit</Btn>
          <Btn icon={Save} onClick={() => onAddRule?.(bucket.id)}>Set retention rule</Btn>
        </div>
        {err && <ErrorState message={err} />}
      </section>

      {bucketFolders.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-300">Folders</h3>
          <ul className="rounded-lg border border-gray-800 divide-y divide-gray-800">
            {bucketFolders.map((f) => (
              <li key={f.folder} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className="flex-1 min-w-0">
                  <span className="font-mono text-gray-200">{f.folder}/</span>
                  <span className="block text-[11px] text-gray-500">{FOLDER_INFO[`${bucket.id}/${f.folder}`] || 'Folder'}, {fmtInt(f.files)} files</span>
                </span>
                <span className="tabular-nums text-gray-300">{fmtBytes(f.bytes)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-gray-300">Recent files {files.total != null && <span className="font-normal text-gray-500">({fmtInt(files.total)} match)</span>}</h3>
          <SearchInput value={search} onChange={setSearch} placeholder="Find a file by name" ariaLabel="Find a file in this bucket" className="w-56" />
        </div>
        {linkErr && <ErrorState message={linkErr} />}
        {files.error ? <ErrorState message={files.error} />
          : !files.rows ? <LoadingState label="Reading files" rows={4} />
            : !files.rows.length ? <EmptyState icon={Search} title="No files" reason={q ? 'No file name matches this search.' : 'This bucket holds no files.'} />
              : (
                <Table>
                  <THead><Th>File</Th><Th align="right">Size</Th><Th>Added</Th><Th align="right"><span className="sr-only">Open</span></Th></THead>
                  <tbody>
                    {files.rows.map((f) => (
                      <Tr key={f.name}>
                        <Td className="max-w-[16rem]"><span className="block truncate text-gray-200" title={f.name}>{fileTitle(bucket.id, f.name)}</span>
                          <span className="block truncate font-mono text-[10px] text-gray-500" title={f.name}>{f.name}</span></Td>
                        <Td align="right" className="tabular-nums">{fmtBytes(f.bytes)}</Td>
                        <Td nowrap>{fmtRiyadh(f.created_at, { time: true })}</Td>
                        <Td align="right"><Btn size="xs" icon={Download} ariaLabel={`Open ${f.name}`} onClick={() => openFile(bucket.id, f.name, setLinkErr)}>Open</Btn></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
        <p className="text-[11px] text-gray-500">Newest 50 shown. Opening a file makes a link that expires after 60 seconds.</p>
      </section>

      <ConfirmImpactDialog open={limitOpen} title={`Change the file limit for ${bucket.id}`} confirmLabel="Save limit" requireReason
        busy={busy} readyExtra={limitValid} onCancel={() => setLimitOpen(false)} onConfirm={saveLimit}
        impact={{
          tone: limitNow && nextBytes < limitNow ? 'warning' : 'info',
          what: `Largest single file allowed from now on: ${limitValid ? fmtBytes(nextBytes, { digits: 0 }) : 'enter 1 to 500 MB'}.`,
          change: `Now ${limitNow ? fmtBytes(limitNow, { digits: 0 }) : 'no limit'}. Files already stored are not touched. Largest stored file is ${fmtBytes(bucket.largest_bytes)}.`,
          who: 'Anyone uploading to this bucket. A lower limit refuses bigger uploads with an error.',
          undo: 'Yes. Set the limit back here.',
        }}>
        <label className="block">
          <span className="block text-[11px] font-semibold text-gray-400 mb-1">Limit per file (MB, 1 to 500)</span>
          <input type="number" min={1} max={500} value={limitMb} onChange={(e) => setLimitMb(e.target.value)} className={FIELD} aria-label="File limit in MB" />
        </label>
      </ConfirmImpactDialog>
    </Drawer>
  )
}

// ── retention rule dialog ────────────────────────────────────────────────────
const DAY_OPTS = [30, 60, 180]

export function RetentionDialog({ open, buckets = [], rules = [], tenantExportDays, initialBucket, onClose, onSaved }) {
  const { logAction } = useConsoleAuth()
  const choosable = useMemo(() => buckets.map((b) => b.id), [buckets])
  const [bucket, setBucket] = useState('')
  const [days, setDays] = useState(60)
  const [custom, setCustom] = useState('')
  const [prefix, setPrefix] = useState('')
  const [minMb, setMinMb] = useState('')
  const [preview, setPreview] = useState({ data: null, error: '', loading: false })
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')

  const existing = rules.find((r) => r.bucket === bucket) || null
  useEffect(() => {
    if (!open) return
    const b = initialBucket || choosable.find((x) => x === 'import-files') || choosable[0] || ''
    const r = rules.find((x) => x.bucket === b)
    setBucket(b); setDays(r?.older_than_days || (b === 'tenant-exports' ? tenantExportDays || 7 : 60)); setCustom('')
    setPrefix(r?.prefix || ''); setMinMb(r?.min_bytes ? String(Math.round(r.min_bytes / MB)) : '')
    setReason(''); setTyped(''); setErr(''); setDone('')
  }, [open, initialBucket]) // eslint-disable-line react-hooks/exhaustive-deps

  const evidence = isEvidenceBucket(bucket)
  const isExports = bucket === 'tenant-exports'
  const effDays = Number(custom) > 0 ? Math.round(Number(custom)) : days
  const minBytes = Number(minMb) > 0 ? Math.round(Number(minMb) * MB) : null

  useEffect(() => {
    if (!open || !bucket || evidence || !(effDays >= 1)) { setPreview({ data: null, error: '', loading: false }); return undefined }
    let off = false
    setPreview((p) => ({ ...p, loading: true, error: '' }))
    const t = setTimeout(() => {
      previewRetention({ bucket, prefix: prefix.trim() || null, minBytes, olderThanDays: effDays })
        .then((d) => { if (!off) setPreview({ data: d, error: '', loading: false }) })
        .catch((e) => { if (!off) setPreview({ data: null, error: toUserMessage(e, 'The preview could not run.'), loading: false }) })
    }, 250)
    return () => { off = true; clearTimeout(t) }
  }, [open, bucket, effDays, prefix, minBytes, evidence])

  const typedWord = isExports ? 'SAVE' : 'RULE'
  const ready = !evidence && effDays >= 1 && (isExports ? effDays <= 90 : effDays <= 3650)
    && reason.trim().length >= 3 && typed.trim() === typedWord && !busy && !done

  async function save() {
    setBusy(true); setErr('')
    try {
      if (isExports) {
        await setRetentionDays(effDays)
        try { await logAction?.('tenant_export_retention_set', null, 'storage_bucket', { days: effDays, reason: reason.trim() }) } catch { /* audit best effort */ }
        setDone(`Company exports are now deleted after ${effDays} days. The nightly job at 05:40 Riyadh applies it.`)
      } else {
        await saveRetentionRule({ id: existing?.id || null, bucket, prefix: prefix.trim() || null, minBytes, olderThanDays: effDays, reason: reason.trim() })
        setDone('Rule saved and recorded in the audit log. It is not applied: no file is deleted until an owner approves a cleanup job.')
      }
      onSaved?.()
    } catch (e) { setErr(toUserMessage(e, 'The rule could not be saved.')) } finally { setBusy(false) }
  }
  async function remove() {
    if (!existing) return
    setBusy(true); setErr('')
    try {
      await removeRetentionRule(existing.id, reason.trim())
      setDone('Rule removed. Files in this bucket are kept forever again.'); onSaved?.()
    } catch (e) { setErr(toUserMessage(e, 'The rule could not be removed.')) } finally { setBusy(false) }
  }

  const p = preview.data
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} width="max-w-2xl"
      title={existing ? `Edit retention rule for ${bucket}` : 'Add a retention rule'}
      subtitle="Choose how long files are kept. You see exactly which files a rule covers before it is saved."
      footer={(
        <>
          {existing && !isExports && !done && (
            <Btn variant="danger" icon={Trash2} busy={busy} disabled={reason.trim().length < 3 || busy} onClick={remove}>Remove rule</Btn>
          )}
          <Btn onClick={onClose} disabled={busy}>{done ? 'Close' : 'Cancel'}</Btn>
          {!done && <Btn variant="primary" icon={Save} busy={busy} disabled={!ready} onClick={save}>{isExports ? 'Save and apply' : 'Save rule'}</Btn>}
        </>
      )}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-400 mb-1">Bucket</span>
            <select value={bucket} onChange={(e) => { setBucket(e.target.value); setDone('') }} className={FIELD} aria-label="Bucket">
              {choosable.map((b) => <option key={b} value={b}>{b}{isEvidenceBucket(b) ? ' (evidence)' : ''}</option>)}
            </select>
          </label>
          <div>
            <span className="block text-[11px] font-semibold text-gray-400 mb-1">Delete files older than</span>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented ariaLabel="Days kept" role="group" value={Number(custom) > 0 ? 'custom' : days}
                onChange={(v) => { if (v !== 'custom') { setDays(v); setCustom('') } }}
                options={[...DAY_OPTS.map((d) => ({ key: d, label: `${d} days` })), { key: 'custom', label: 'Custom' }]} disabled={evidence} />
              <input type="number" min={1} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="days" disabled={evidence}
                className={`${FIELD} w-20`} aria-label="Custom number of days" />
            </div>
          </div>
          {!isExports && (
            <>
              <label className="block">
                <span className="block text-[11px] font-semibold text-gray-400 mb-1">Only this folder (optional)</span>
                <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="for example photos/" disabled={evidence} className={FIELD} />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-gray-400 mb-1">Only files larger than (MB, optional)</span>
                <input type="number" min={0} value={minMb} onChange={(e) => setMinMb(e.target.value)} disabled={evidence} className={FIELD} />
              </label>
            </>
          )}
        </div>

        {evidence ? (
          <Note tone="warning">
            {bucket} holds evidence (tyre history, accidents or fines). A delete rule here needs owner decision: it must name who approves it and how
            records that point at these files are kept. Nothing can be saved for this bucket from here.
          </Note>
        ) : preview.error ? <ErrorState message={preview.error} />
          : preview.loading && !p ? <LoadingState label="Counting the files this rule covers" rows={2} />
            : p && (
              <>
                <ImpactBox tone={p.files > 0 ? 'warning' : 'info'}
                  what={`This rule covers ${fmtInt(p.files)} of ${fmtInt(p.bucket_files)} files in ${bucket} (${fmtBytes(p.bytes)}).`}
                  stats={[
                    { label: 'Files covered today', value: fmtInt(p.files) },
                    { label: 'Space', value: fmtBytes(p.bytes) },
                    { label: 'Oldest covered', value: p.oldest ? fmtRiyadh(p.oldest) : 'None' },
                  ]}
                  change={isExports
                    ? `Export files older than ${effDays} days are deleted by the existing nightly job at 05:40 Riyadh.`
                    : 'Saving records the rule only. Existing files would go on the next nightly run once a cleanup job is approved, which needs owner decision. Until then nothing is deleted.'}
                  who={isExports ? 'Admins who download company exports: links older than this stop working.' : 'Nobody today. Later, anyone opening an old file after a cleanup run.'}
                  undo={isExports ? 'Deleted export files cannot be restored. The rule itself can be changed here.' : 'Yes. Remove or edit the rule here; no file is touched by saving it.'} />
                {Array.isArray(p.sample) && p.sample.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-400 hover:text-gray-200">Oldest {p.sample.length} files it covers</summary>
                    <ul className="mt-2 rounded-lg border border-gray-800 divide-y divide-gray-800">
                      {p.sample.map((s) => (
                        <li key={s.name} className="flex gap-3 px-3 py-1.5">
                          <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-gray-300" title={s.name}>{s.name}</span>
                          <span className="tabular-nums text-gray-400">{fmtBytes(s.bytes)}</span>
                          <span className="text-gray-500">{fmtRiyadh(s.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}

        {!evidence && !done && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-400 mb-1">Reason (goes to the audit log)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this rule?" className={FIELD} autoComplete="off" />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-400 mb-1">Type <span className="font-mono text-gray-200">{typedWord}</span> to confirm</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} autoComplete="off"
                className={`${FIELD} font-mono`} aria-label={`Type ${typedWord} to confirm`} />
            </label>
          </div>
        )}
        {err && <ErrorState message={err} />}
        {done && <Note tone="accent">{done}</Note>}
        {!isExports && retentionLabel(bucket, rules, tenantExportDays).rule && !done && (
          <p className="text-[11px] text-gray-500">This bucket already has a rule. Saving replaces it; removing it needs a reason.</p>
        )}
      </div>
    </Modal>
  )
}

// ── duplicates review ────────────────────────────────────────────────────────
export function DuplicatesDrawer({ open, onClose }) {
  const [bucket, setBucket] = useState('all')
  const [state, setState] = useState({ rows: null, error: '' })
  const [linkErr, setLinkErr] = useState('')
  useEffect(() => {
    if (!open) return undefined
    let off = false
    setState({ rows: null, error: '' })
    listDuplicateFiles(bucket === 'all' ? null : bucket, 300)
      .then((rows) => { if (!off) setState({ rows, error: '' }) })
      .catch((e) => { if (!off) setState({ rows: null, error: toUserMessage(e, 'The copies could not be listed.') }) })
    return () => { off = true }
  }, [open, bucket])

  const rows = state.rows || []
  const extra = rows.reduce((s, g) => s + (Number(g.extra_bytes) || 0), 0)
  const copies = rows.reduce((s, g) => s + (Number(g.copies) - 1 || 0), 0)

  async function exportRows() {
    await exportConsoleRows({
      title: 'Storage exact copies',
      rows: rows.map((g) => ({ ...g, size: fmtBytes(g.bytes), extra: fmtBytes(g.extra_bytes), extras: (g.extras || []).join(' ; ') })),
      columns: [{ key: 'bucket', header: 'Bucket' }, { key: 'kept', header: 'Oldest file (kept)' }, { key: 'extras', header: 'Extra copies' },
        { key: 'copies', header: 'Copies' }, { key: 'size', header: 'Size each' }, { key: 'extra', header: 'Space in copies' }],
    })
  }

  return (
    <Drawer open={open} onClose={onClose} width="max-w-3xl" title="Exact copies"
      subtitle="Files with the same checksum and size as an earlier file in the same bucket."
      footer={(<><Btn icon={Download} onClick={exportRows} disabled={!rows.length}>Export list</Btn><Btn onClick={onClose}>Close</Btn></>)}>
      <Segmented ariaLabel="Bucket" value={bucket} onChange={setBucket}
        options={[{ key: 'all', label: 'All buckets' }, { key: 'tyre-photos', label: 'tyre-photos' }, { key: 'import-files', label: 'import-files' }]} />
      {linkErr && <ErrorState message={linkErr} />}
      {state.error ? <ErrorState message={state.error} />
        : !state.rows ? <LoadingState label="Matching checksums" rows={5} />
          : !rows.length ? <EmptyState icon={Copy} title="No exact copies" reason="Every stored file has unique content." />
            : (
              <>
                <ImpactBox tone="warning" what={`${fmtInt(copies)} extra copies in ${fmtInt(rows.length)} groups, ${fmtBytes(extra)} in total.`}
                  change="Removing copies would keep the oldest file and delete the rest, after moving every record that points at a copy to the kept file."
                  who="Nobody would see a change; photos keep opening."
                  undo="No for the files. That is why removal waits: it needs owner decision and an edge function that re-points records first." />
                <Table>
                  <THead><Th>Kept (oldest)</Th><Th align="right">Copies</Th><Th align="right">Space in copies</Th><Th>First and last</Th></THead>
                  <tbody>
                    {rows.map((g) => (
                      <Tr key={`${g.bucket}/${g.kept}`}>
                        <Td className="max-w-[18rem]">
                          <span className="block text-[10px] text-gray-500">{g.bucket}</span>
                          <button type="button" onClick={() => openFile(g.bucket, g.kept, setLinkErr)} title={g.kept}
                            className="block max-w-full truncate text-left font-mono text-[11px] text-gray-200 hover:text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">{g.kept}</button>
                          {(g.extras || []).slice(0, 3).map((x) => <span key={x} className="block truncate font-mono text-[10px] text-gray-500" title={x}>copy: {x}</span>)}
                          {(g.extras || []).length > 3 && <span className="block text-[10px] text-gray-500">and {g.extras.length - 3} more</span>}
                        </Td>
                        <Td align="right" className="tabular-nums">{fmtInt(g.copies)}</Td>
                        <Td align="right" className="tabular-nums">{fmtBytes(g.extra_bytes)}</Td>
                        <Td nowrap>{fmtRiyadh(g.first_at)} to {fmtRiyadh(g.last_at)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <div className="flex items-center gap-2">
                  <Btn variant="danger" icon={Trash2} disabled title="Needs owner decision">Remove extra copies</Btn>
                  <Badge tone="warning">Needs owner decision</Badge>
                </div>
              </>
            )}
    </Drawer>
  )
}
