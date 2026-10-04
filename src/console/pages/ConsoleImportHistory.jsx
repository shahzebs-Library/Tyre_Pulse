/**
 * ConsoleImportHistory - super-admin view of every data load (V364).
 *
 * Four tabs. The first two exist because there are genuinely two kinds of
 * import and only one of them was ever recorded; the last two answer the two
 * questions people actually ask after uploading - did I miss a day, and what
 * did the system change about my file:
 *
 *   Uploads   - files loaded through the app. import_files already stored a sha256
 *               of every file, so a repeat upload of identical content is flagged
 *               with the date it was first imported. That warning existed in the
 *               data all along and was never shown to anyone.
 *   Activity  - loads done straight through the Supabase Table Editor, which write
 *               no upload record at all. Reconstructed from insertion-time clusters
 *               on the destination table. Two clusters of the SAME row count within
 *               a few minutes is the signature of a resent chunk, and those are
 *               called out in amber.
 *
 *   Coverage  - which days have data and which are empty, for the sources that
 *               have actually behaved like a daily feed.
 *   Decisions - where the classifier disagreed with the file's own Spare/Tyre/
 *               Oil columns, with the money attached and an override per item.
 *
 * The first three are read-only. The decisions tab is the one place that can
 * change a category, and it writes through the material master rather than
 * touching transactions directly. No raw SQL, no em/en dashes. Super-admin only
 * (the whole /console is gated).
 *
 * The active tab lives in ?tab= so a link can open a view directly. The two
 * tables here are paged; an upload opens its full record in a modal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  History, AlertTriangle, FileUp, Info, Activity, CopyX,
  CalendarDays, Shuffle, FileText, CheckCircle2, XCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  listImportHistory, listUnloggedImports, flagSuspiciousClusters, importRowSummary,
  importRowOutcome, OUTCOME_META,
} from '../../lib/api/importHistory'
import { listDuplicateTargets } from '../../lib/api/duplicateControl'
import { toUserMessage } from '../../lib/safeError'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, DetailGrid } from './shared/pageKit'
import UploadCoveragePanel from './importHistory/UploadCoveragePanel'
import DecisionsPanel from './importHistory/DecisionsPanel'
import {
  Btn, ErrorState, Badge, LoadingState, EmptyState, Panel, PanelHeader, Note, StatTile,
  SearchInput, Select, Toolbar, Segmented, Table, THead, Th, Tr, Td, Modal,
} from '../components/ui'

const fmtNum = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A')
const fmtTime = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 16).replace('T', ' ')
}
const fmtBytes = (n) => {
  const b = Number(n)
  if (!Number.isFinite(b) || b <= 0) return 'N/A'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// Derived sort keys: the outcome is a label, the repeat flag a boolean.
const UPLOAD_ACCESSORS = {
  outcome: (r) => OUTCOME_META[importRowOutcome(r)].label,
  repeat: (r) => (r.reupload_of ? 1 : 0),
}

const UPLOAD_EXPORT = [
  { key: 'file', header: 'File', value: (r) => r.filename || 'N/A' },
  { key: 'module', header: 'Module', value: (r) => r.module || 'N/A' },
  { key: 'country', header: 'Country', value: (r) => r.country || 'N/A' },
  { key: 'uploaded_at', header: 'Uploaded at', value: (r) => fmtTime(r.uploaded_at) },
  { key: 'size', header: 'Size', value: (r) => fmtBytes(r.size_bytes) },
  { key: 'outcome', header: 'Outcome', value: (r) => OUTCOME_META[importRowOutcome(r)].label },
  { key: 'rows_read', header: 'Rows read', value: (r) => r.total_rows ?? 0 },
  { key: 'rows_imported', header: 'Rows imported', value: (r) => r.imported_rows ?? 0 },
  { key: 'duplicates_flagged', header: 'Duplicates flagged', value: (r) => r.duplicate_rows ?? 0 },
  { key: 'errors', header: 'Errors', value: (r) => r.error_rows ?? 0 },
  { key: 'same_file_imported_before', header: 'Same file imported before', value: (r) => (r.reupload_of ? fmtTime(r.reupload_first_seen) : 'No') },
]
const ACTIVITY_EXPORT = [
  { key: 'landed', header: 'Landed', value: (c) => fmtTime(c.inserted_at) },
  { key: 'country', header: 'Country', value: (c) => c.country || 'N/A' },
  { key: 'rows', header: 'Rows', value: (c) => c.rows ?? 0 },
  { key: 'note', header: 'Note', value: (c) => (c.suspicious ? `Same size as ${fmtTime(c.pairedWith)}` : 'Looks normal') },
]
const TABS = ['uploads', 'activity', 'coverage', 'decisions']

export default function ConsoleImportHistory({ tabParam = 'tab' } = {}) {
  const [tab, setTab] = useUrlTab(TABS, 'uploads', tabParam)
  const [detail, setDetail] = useState(null)
  const [loadedAt, setLoadedAt] = useState(null)
  const [clustersAt, setClustersAt] = useState(null)
  const [rows, setRows] = useState([])
  const [targets, setTargets] = useState([])
  const [targetKey, setTargetKey] = useState('parts_expense')
  const [clusters, setClusters] = useState([])
  const [loading, setLoading] = useState(true)
  const [clusterLoading, setClusterLoading] = useState(false)
  const [error, setError] = useState('')
  const [clusterError, setClusterError] = useState('')
  const [search, setSearch] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('')
  const [onlyRepeats, setOnlyRepeats] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [h, t] = await Promise.all([listImportHistory(200), listDuplicateTargets()])
      setRows(Array.isArray(h) ? h : []); setTargets(Array.isArray(t) ? t : [])
      setLoadedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load import history.'))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadClusters = useCallback(async (key) => {
    setClusterError(''); setClusterLoading(true)
    try {
      const c = await listUnloggedImports(key, 80)
      setClusters(Array.isArray(c) ? c : [])
      setClustersAt(new Date())
    } catch (e) {
      setClusterError(toUserMessage(e, 'Could not load import activity.'))
      setClusters([])
    } finally {
      setClusterLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'activity') loadClusters(targetKey) }, [tab, targetKey, loadClusters])

  const flagged = useMemo(() => flagSuspiciousClusters(clusters), [clusters])
  const suspiciousCount = useMemo(() => flagged.filter((c) => c.suspicious).length, [flagged])
  const reuploads = useMemo(() => rows.filter((r) => r.reupload_of), [rows])

  const stats = useMemo(() => {
    let imported = 0; let errors = 0; let unfinished = 0
    for (const r of rows) {
      imported += Number(r.imported_rows) || 0
      errors += Number(r.error_rows) || 0
      if (importRowOutcome(r) === 'unfinished') unfinished += 1
    }
    return { files: rows.length, imported, errors, unfinished }
  }, [rows])

  const moduleOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.module).filter(Boolean))
    return [...set].sort().map((m) => ({ value: m, label: m }))
  }, [rows])

  const filtered = useMemo(() => {
    const narrowed = rows.filter((r) => {
      if (moduleFilter && r.module !== moduleFilter) return false
      if (outcomeFilter && importRowOutcome(r) !== outcomeFilter) return false
      if (onlyRepeats && !r.reupload_of) return false
      return true
    })
    return searchRows(narrowed, search, ['filename', 'module', 'country'])
  }, [rows, search, moduleFilter, outcomeFilter, onlyRepeats])

  const uploadsSort = useTableSort({ key: 'uploaded_at', dir: 'desc' })
  const uploadsSorted = useMemo(() => sortRows(filtered, uploadsSort.sort, UPLOAD_ACCESSORS), [filtered, uploadsSort.sort])
  const uploadsPaged = usePaged(uploadsSorted, 25)
  const activitySort = useTableSort({ key: 'inserted_at', dir: 'desc' })
  const activitySorted = useMemo(() => sortRows(flagged, activitySort.sort), [flagged, activitySort.sort])
  const activityPaged = usePaged(activitySorted, 25)
  const activityTarget = targets.find((t) => t.key === targetKey)

  const tabs = [
    { key: 'uploads', label: <><FileUp size={13} aria-hidden="true" /> Uploads</>, count: loading || error ? null : rows.length, hint: 'Files loaded through the app, and repeats of the same file' },
    { key: 'activity', label: <><Activity size={13} aria-hidden="true" /> Load activity</>, hint: 'Loads done straight through the database, reconstructed' },
    { key: 'coverage', label: <><CalendarDays size={13} aria-hidden="true" /> Daily coverage</>, hint: 'Which days have data and which are empty' },
    { key: 'decisions', label: <><Shuffle size={13} aria-hidden="true" /> What we changed</>, hint: 'Where we filed something differently from your file' },
  ]
  const filtersActive = search || moduleFilter || outcomeFilter || onlyRepeats

  return (
    <div className="space-y-5">
      {/* Coverage and decisions load their own data and carry their own
          refresh, so a second one here would be a button that does nothing
          on two of the four tabs. */}
      <PageHeader
        icon={History}
        title="Import History"
        purpose="Every data load, who did it, and whether the same file has been imported before."
        refreshedAt={tab === 'activity' ? clustersAt : loadedAt}
        onRefresh={tab === 'uploads' || tab === 'activity' ? () => (tab === 'activity' ? loadClusters(targetKey) : load()) : undefined}
        refreshing={tab === 'activity' ? clusterLoading : loading}
      />

      <Segmented ariaLabel="Import history views" options={tabs} value={tab} onChange={setTab} />

      {tab === 'coverage' ? (
        <UploadCoveragePanel />
      ) : tab === 'decisions' ? (
        <DecisionsPanel />
      ) : tab === 'uploads' ? (
        loading ? (
          <LoadingState label="Loading import history" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile label="Uploads recorded" value={fmtNum(stats.files)} icon={FileText} sub="Latest 200 files" />
              <StatTile label="Rows imported" value={fmtNum(stats.imported)} icon={CheckCircle2} tone={stats.imported ? 'good' : 'default'} />
              <StatTile label="Repeat uploads" value={fmtNum(reuploads.length)} icon={CopyX}
                tone={reuploads.length ? 'warning' : 'default'} sub="Same file content seen before"
                onClick={reuploads.length ? () => setOnlyRepeats((v) => !v) : undefined} active={onlyRepeats} />
              <StatTile label="Never approved" value={fmtNum(stats.unfinished)} icon={XCircle}
                tone={stats.unfinished ? 'warning' : 'default'} sub={`${fmtNum(stats.errors)} row errors in total`}
                onClick={stats.unfinished ? () => setOutcomeFilter((v) => (v === 'unfinished' ? '' : 'unfinished')) : undefined}
                active={outcomeFilter === 'unfinished'} />
            </div>

            {reuploads.length > 0 && (
              <Note icon={AlertTriangle} tone="warning">
                {reuploads.length === 1
                  ? '1 file has been uploaded more than once.'
                  : `${reuploads.length} files have been uploaded more than once.`}
                {' '}They are marked below. Check{' '}
                <Link to="/console/duplicates" className="underline hover:text-amber-100 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">Duplicate Control</Link>
                {' '}if any of them added rows.
              </Note>
            )}

            {rows.length === 0 ? (
              <EmptyState icon={FileUp} title="No uploads recorded yet"
                reason="Files loaded straight through the Supabase Table Editor do not appear here; see the Load activity tab." />
            ) : (
              <Panel>
                <PanelHeader icon={FileUp} title="Uploaded files"
                  subtitle={`${fmtNum(filtered.length)} of ${fmtNum(rows.length)} shown`}
                  actions={<ExportButtons rows={uploadsSorted} columns={UPLOAD_EXPORT} title="TyrePulse Import History" />} />
                <Toolbar className="mb-3">
                  <SearchInput value={search} onChange={setSearch} placeholder="Search file, module or country" className="w-full sm:w-72" />
                  <Select value={moduleFilter} onChange={setModuleFilter} placeholder="All modules" options={moduleOptions} ariaLabel="Filter by module" className="w-40" />
                  <Select value={outcomeFilter} onChange={setOutcomeFilter} placeholder="All outcomes" ariaLabel="Filter by outcome" className="w-44"
                    options={Object.entries(OUTCOME_META).map(([value, m]) => ({ value, label: m.label }))} />
                  {filtersActive && (
                    <Btn variant="quiet" onClick={() => { setSearch(''); setModuleFilter(''); setOutcomeFilter(''); setOnlyRepeats(false) }}>Clear filters</Btn>
                  )}
                </Toolbar>
                {filtered.length === 0 ? (
                  <EmptyState title="No uploads match these filters" reason="Clear the filters to see every recorded upload." />
                ) : (
                  <>
                  <Table>
                    <THead>
                        <Th sortKey="filename" sort={uploadsSort.sort} onSort={uploadsSort.onSort}>File</Th>
                        <Th sortKey="module" sort={uploadsSort.sort} onSort={uploadsSort.onSort}>Module</Th>
                        <Th sortKey="country" sort={uploadsSort.sort} onSort={uploadsSort.onSort}>Country</Th>
                        <Th sortKey="uploaded_at" sort={uploadsSort.sort} onSort={uploadsSort.onSort}>When</Th>
                        <Th sortKey="imported_rows" sort={uploadsSort.sort} onSort={uploadsSort.onSort}>Rows</Th>
                        <Th sortKey="repeat" sort={uploadsSort.sort} onSort={uploadsSort.onSort}>Repeat upload</Th>
                      </THead>
                    <tbody>
                      {uploadsPaged.pageRows.map((r, i) => {
                        const meta = OUTCOME_META[importRowOutcome(r)]
                        return (
                          <Tr key={`${r.file_id}-${r.batch_id || i}`} tone={r.reupload_of ? 'warning' : undefined}
                            onClick={() => setDetail(r)} ariaLabel={`Details for ${r.filename || 'upload'}`}>
                            <Td>
                              <p className="text-gray-200 truncate max-w-[260px]" title={r.filename}>{r.filename || 'N/A'}</p>
                              <p className="text-[10px] text-gray-400">{fmtBytes(r.size_bytes)}</p>
                            </Td>
                            <Td className="text-gray-400">{r.module || 'N/A'}</Td>
                            <Td className="text-gray-400">{r.country || 'N/A'}</Td>
                            <Td className="text-gray-400 tabular-nums" nowrap>{fmtTime(r.uploaded_at)}</Td>
                            <Td>
                              {/* The badge answers "is this finished?" at a glance.
                                  A staged draft and a completed load both showed
                                  0 imported and were impossible to tell apart. */}
                              <p className="text-gray-300 flex items-center gap-1.5 flex-wrap">
                                <Badge tone={meta.tone}>{meta.label}</Badge>
                                {importRowSummary(r)}
                              </p>
                              {Number(r.duplicate_rows) > 0 && (
                                <p className="text-[10px] text-amber-400">{fmtNum(r.duplicate_rows)} flagged as duplicate</p>
                              )}
                              {Number(r.error_rows) > 0 && (
                                <p className="text-[10px] text-red-400">{fmtNum(r.error_rows)} errors</p>
                              )}
                            </Td>
                            <Td>
                              {r.reupload_of ? (
                                <Badge tone="warning" icon={CopyX}>Same file as {fmtTime(r.reupload_first_seen)}</Badge>
                              ) : (
                                <span className="text-[10px] text-gray-400">First time</span>
                              )}
                            </Td>
                          </Tr>
                        )
                      })}
                    </tbody>
                  </Table>
                  <Pager {...uploadsPaged} label="uploads" />
                  </>
                )}
              </Panel>
            )}
          </>
        )
      ) : (
        <>
          <Note icon={Info} tone="accent">
            Loads done straight through the Supabase Table Editor leave no upload record, so
            this rebuilds them from when the rows actually landed. Two loads of the SAME row
            count within a few minutes usually means one upload was sent twice.
          </Note>

          {loading ? (
            <LoadingState label="Loading tables" rows={1} />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : (
            <Segmented role="group" ariaLabel="Destination table" value={targetKey} onChange={setTargetKey}
              options={targets.map((t) => ({ key: t.key, label: t.label }))} />
          )}

          {suspiciousCount > 0 && (
            <Note icon={AlertTriangle} tone="warning">
              {suspiciousCount} load(s) here match another load of the same size.{' '}
              <Link to="/console/duplicates" className="underline hover:text-amber-100 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                Check Duplicate Control
              </Link>{' '}to see whether they actually added duplicate rows.
            </Note>
          )}

          {clusterLoading ? (
            <LoadingState label="Loading load activity" />
          ) : clusterError ? (
            <ErrorState message={clusterError} onRetry={() => loadClusters(targetKey)} />
          ) : flagged.length === 0 ? (
            <EmptyState icon={Activity} title="No load activity recorded for this table"
              reason="Nothing has landed in this table recently, or every load went through the app and is on the Uploads tab." />
          ) : (
            <Panel>
              <PanelHeader icon={Activity} title="Reconstructed loads"
                subtitle={`${fmtNum(flagged.length)} loads, ${fmtNum(suspiciousCount)} look like a resent chunk`}
                actions={<ExportButtons rows={activitySorted} columns={ACTIVITY_EXPORT} title={`TyrePulse Load Activity ${activityTarget?.label || targetKey}`} />} />
              <div>
                <Table>
                  <THead>
                      <Th sortKey="inserted_at" sort={activitySort.sort} onSort={activitySort.onSort}>Landed</Th>
                      <Th sortKey="country" sort={activitySort.sort} onSort={activitySort.onSort}>Country</Th>
                      <Th sortKey="rows" sort={activitySort.sort} onSort={activitySort.onSort} align="right">Rows</Th>
                      <Th>Note</Th>
                    </THead>
                  <tbody>
                    {activityPaged.pageRows.map((c, i) => (
                      <Tr key={`${c.inserted_at}-${i}`} tone={c.suspicious ? 'warning' : undefined}>
                        <Td className="text-gray-300 tabular-nums" nowrap>{fmtTime(c.inserted_at)}</Td>
                        <Td className="text-gray-400">{c.country || 'N/A'}</Td>
                        <Td align="right" className="text-gray-200 tabular-nums">{fmtNum(c.rows)}</Td>
                        <Td>
                          {c.suspicious ? (
                            <span className="text-[10px] text-amber-300 flex items-center gap-1">
                              <CopyX size={10} aria-hidden="true" /> same size as {fmtTime(c.pairedWith)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400">Looks normal</span>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager {...activityPaged} label="loads" />
              </div>
            </Panel>
          )}
        </>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.filename || 'Upload'}
        subtitle={detail ? `${detail.module || 'Unknown module'} | ${detail.country || 'No country'}` : undefined}
        footer={<Btn onClick={() => setDetail(null)}>Close</Btn>}>
        {detail && (() => {
          const meta = OUTCOME_META[importRowOutcome(detail)]
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <span className="text-xs text-gray-400">{importRowSummary(detail)}</span>
              </div>
              <DetailGrid items={[
                ['Uploaded at', fmtTime(detail.uploaded_at)],
                ['Size', fmtBytes(detail.size_bytes)],
                ['Rows read', fmtNum(detail.total_rows ?? 0)],
                ['Rows imported', fmtNum(detail.imported_rows ?? 0)],
                ['Flagged as duplicate', fmtNum(detail.duplicate_rows ?? 0)],
                ['Errors', fmtNum(detail.error_rows ?? 0)],
                ['File id', detail.file_id],
                ['Batch id', detail.batch_id],
                ['Same file first seen', detail.reupload_of ? fmtTime(detail.reupload_first_seen) : 'First time'],
              ]} />
              {detail.reupload_of && (
                <Note icon={AlertTriangle} tone="warning">
                  This file has the same content as one imported on {fmtTime(detail.reupload_first_seen)}.{' '}
                  <Link to="/console/duplicates" className="underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">Check Duplicate Control</Link>{' '}
                  for rows it may have added twice.
                </Note>
              )}
              {Number(detail.error_rows) > 0 && (
                <Note icon={AlertTriangle} tone="danger">
                  {fmtNum(detail.error_rows)} rows were rejected when this file was imported.
                </Note>
              )}
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
