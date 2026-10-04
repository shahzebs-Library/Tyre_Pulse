/**
 * Largest tables with kind, rows, size, share; search, kind chips, select,
 * export, and a detail drawer per table. Loading areas can be selected; their
 * archive is shown honestly as waiting on the owner (it would remove data).
 */
import { useEffect, useMemo, useState } from 'react'
import { Download, PanelRightOpen, Archive, GitCompare, Lightbulb, Lock } from 'lucide-react'
import {
  Panel, PanelHeader, Badge, Btn, SearchInput, Segmented, Table, THead, Th, Tr, Td, EmptyState, ErrorState, LoadingState, Note, ImpactBox,
} from '../../components/ui'
import { Drawer } from '../shared/pageKit'
import { BarCell, PanelFoot, MetricRow, useLoad } from '../runtime/runtimeParts'
import { fmtBytes, fmtInt, fmtPct, fmtRiyadh, concentration } from '../../../lib/databaseCenter'
import { getTableDetail } from '../../../lib/api/databaseCenter'
import { exportConsoleRows } from '../../../lib/consoleTable'

const CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'business', label: 'Business data' },
  { key: 'log', label: 'Logs' },
  { key: 'loading', label: 'Loading areas' },
  { key: 'safety', label: 'Safety copies' },
]

export default function TablesPanel({ tables, tableCount, allBytes, dbBytes, loading, error, onRetry, full = false, onBrowse }) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const [selected, setSelected] = useState(() => new Set())
  const [open, setOpen] = useState(null)

  const counts = useMemo(() => {
    const c = { all: tables?.length || 0 }
    for (const t of tables || []) c[t.kind] = (c[t.kind] || 0) + 1
    return c
  }, [tables])
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (tables || [])
      .filter((t) => kind === 'all' || t.kind === kind)
      .filter((t) => !term || `${t.label} ${t.description} ${t.kindLabel}`.toLowerCase().includes(term))
      .slice(0, full ? 40 : 12)
  }, [tables, q, kind, full])
  const conc = concentration(tables || [], tableCount, allBytes)
  const maxBytes = (tables || [])[0]?.bytes || 1
  const sel = (tables || []).filter((t) => selected.has(t.key))
  const selBytes = sel.reduce((s, t) => s + t.bytes, 0)
  const selLoading = sel.length > 0 && sel.every((t) => t.kind === 'loading')
  const audit = (tables || []).find((t) => t.name === 'audit_log_v2')

  function toggle(key) {
    setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  async function exportRows() {
    await exportConsoleRows({
      rows: (tables || []).map((t) => ({ ...t, size: fmtBytes(t.bytes), share: fmtPct(t.share) })),
      title: 'Largest database tables',
      columns: [
        { key: 'label', header: 'Table' }, { key: 'description', header: 'What it holds' }, { key: 'kindLabel', header: 'Kind' },
        { key: 'rows', header: 'Rows (estimate)' }, { key: 'size', header: 'Size on disk' }, { key: 'share', header: 'Share of database' },
        { key: 'deadRows', header: 'Rows waiting cleanup' },
      ],
    })
  }

  return (
    <Panel flush>
      <div className="p-4 pb-3">
        <PanelHeader title="Largest tables"
          subtitle={conc.tableCount == null ? 'Sizes from the database catalogue' : `${conc.shown} of ${fmtInt(conc.tableCount)} tables hold ${conc.pct ?? 'N/A'}% of the space`}
          actions={<Btn icon={Download} onClick={exportRows} disabled={!tables?.length}>Export</Btn>} />
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Find a table" className="w-full sm:w-64" />
          <Segmented role="group" ariaLabel="Table kind" value={kind} onChange={setKind}
            options={CHIPS.map((c) => ({ ...c, count: c.key === 'all' ? undefined : counts[c.key] || 0 }))} />
        </div>
      </div>
      {sel.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-y border-orange-800/40 bg-orange-950/20 text-xs">
          <span className="font-semibold text-gray-200">{sel.length} selected</span>
          <span className="text-gray-400 truncate">{sel.map((t) => t.label).join(', ')}, {fmtBytes(selBytes)}</span>
          <span className="flex-1" />
          <Btn size="xs" icon={Archive} disabled title="Archiving a loading-area table moves it out of the database. Needs owner decision.">
            Archive to storage
          </Btn>
          {onBrowse && <Btn size="xs" icon={GitCompare} onClick={() => onBrowse(sel[0])}>Compare with live</Btn>}
          <Btn size="xs" variant="quiet" onClick={() => setSelected(new Set())}>Clear</Btn>
        </div>
      )}
      {sel.length > 0 && (
        <div className="px-4 py-2">
          <Note tone="warning" icon={Lock}>
            {selLoading
              ? 'Archive to storage is not switched on: it would export the table to a file and then remove it from the database. That removes data, so it waits on an owner decision.'
              : 'Only loading-area tables can be archived, and archiving itself waits on an owner decision.'}
          </Note>
        </div>
      )}
      {loading && !tables ? <div className="px-4 pb-4"><LoadingState label="Reading table sizes" rows={5} /></div>
        : error ? <div className="px-4 pb-4"><ErrorState message={error} onRetry={onRetry} /></div>
          : !rows.length ? <EmptyState title="No table matches" reason={q ? 'Nothing matches that search in this kind.' : 'No tables of this kind.'} />
            : (
              <Table className="border-0 rounded-none">
                <THead>
                  <Th className="w-8"><span className="sr-only">Select</span></Th>
                  <Th>Table</Th><Th>Kind</Th><Th align="right">Rows</Th><Th>Size on disk</Th><Th align="right">Share</Th><Th><span className="sr-only">Details</span></Th>
                </THead>
                <tbody>
                  {rows.map((t) => (
                    <Tr key={t.key}>
                      <Td>
                        <input type="checkbox" checked={selected.has(t.key)} onChange={() => toggle(t.key)}
                          aria-label={`Select ${t.label}`} className="accent-orange-500" />
                      </Td>
                      <Td>
                        <p className="font-mono text-[11.5px] font-semibold text-gray-200 break-all">{t.label}</p>
                        {t.description && <p className="text-[11px] text-gray-500">{t.description}</p>}
                      </Td>
                      <Td nowrap><Badge tone={t.kindTone}>{t.kindLabel}</Badge></Td>
                      <Td align="right" nowrap className="tabular-nums">{fmtInt(t.rows)}</Td>
                      <Td><BarCell pct={t.bytes / maxBytes * 100} label={fmtBytes(t.bytes)} tone={t.kind === 'log' && t.bytes > 5e8 ? 'warning' : 'info'} /></Td>
                      <Td align="right" nowrap className="tabular-nums">{fmtPct(t.share)}</Td>
                      <Td align="right">
                        <Btn size="xs" variant="quiet" icon={PanelRightOpen} title={`Details for ${t.label}`} onClick={() => setOpen(t)} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
      <PanelFoot icon={Lightbulb}>
        Row counts here are the database's own estimates from its last statistics run. They can be far off on tables that change a lot, so treat them as a rough size. Opening a table under 300 MB gives an exact count.
        {audit ? ` The audit trail is ${fmtBytes(audit.bytes)}, so most of it is read from disk rather than memory.` : ''}
      </PanelFoot>
      <TableDrawer table={open} dbBytes={dbBytes} onClose={() => setOpen(null)} onBrowse={onBrowse} />
    </Panel>
  )
}

function TableDrawer({ table, dbBytes, onClose, onBrowse }) {
  const detail = useLoad(() => (table ? getTableDetail(table.schema, table.name) : Promise.resolve(null)), { auto: false })
  const reload = detail.reload
  const key = table?.key
  useEffect(() => { if (key) reload() }, [key, reload])
  const d = detail.data?.ok ? detail.data : null
  return (
    <Drawer open={!!table} onClose={onClose} width="max-w-2xl"
      title={<span className="font-mono">{table?.label}</span>}
      subtitle={table ? <span className="flex flex-wrap items-center gap-2"><Badge tone={table.kindTone}>{table.kindLabel}</Badge>{table.description}</span> : null}
      footer={(
        <>
          {onBrowse && table?.schema === 'public' && <Btn variant="primary" onClick={() => { onBrowse(table); onClose() }}>Browse rows</Btn>}
          <Btn onClick={onClose}>Close</Btn>
        </>
      )}>
      {detail.loading && !d ? <LoadingState label="Reading the table" rows={4} />
        : detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} />
          : detail.data && !detail.data.ok ? <EmptyState title="Table not found" reason="It may have been renamed or removed since the list was read." />
            : d && (
              <>
                <div className="rounded-xl border border-gray-800 overflow-hidden">
                  <MetricRow items={[
                    { label: 'Rows', value: d.rows == null ? fmtInt(d.rows_estimate) : fmtInt(d.rows), sub: d.rows == null ? 'estimate, table too large to count here' : 'exact count' },
                    { label: 'Total size', value: fmtBytes(d.total_bytes), sub: dbBytes ? `${fmtPct(d.total_bytes / dbBytes * 100)} of the database` : undefined },
                    { label: 'Data', value: fmtBytes(d.heap_bytes), sub: 'rows on disk' },
                    { label: 'Indexes', value: fmtBytes(d.index_bytes), sub: `${d.indexes?.length ?? 0} indexes` },
                  ]} />
                </div>
                <section>
                  <h3 className="text-xs font-semibold text-gray-300 mb-2">Upkeep</h3>
                  <dl className="grid grid-cols-[11rem_1fr] gap-x-3 gap-y-1.5 text-xs">
                    <dt className="text-gray-500">Rows waiting cleanup</dt><dd className="text-gray-200 tabular-nums">{fmtInt(d.dead_rows)}</dd>
                    <dt className="text-gray-500">Last cleanup</dt><dd className="text-gray-200">{fmtRiyadh(d.last_vacuum)}</dd>
                    <dt className="text-gray-500">Last statistics update</dt><dd className="text-gray-200">{fmtRiyadh(d.last_analyze)}</dd>
                    <dt className="text-gray-500">Columns</dt><dd className="text-gray-200">{fmtInt(d.columns)}</dd>
                    <dt className="text-gray-500">Row access rules</dt><dd className="text-gray-200">{d.rls ? 'On (company and country walled)' : 'Off'}</dd>
                    <dt className="text-gray-500">In the nightly copy</dt>
                    <dd className={d.in_nightly_copy ? 'text-gray-200' : 'text-amber-300'}>
                      {d.in_nightly_copy ? (table.name === 'work_orders' ? 'Listed, but skipped as too large. Covered by the platform restore.' : 'Yes') : 'No. Covered by the platform restore only.'}
                    </dd>
                    <dt className="text-gray-500">Changes since stats reset</dt>
                    <dd className="text-gray-200 tabular-nums">{fmtInt(d.inserts)} added, {fmtInt(d.updates)} changed, {fmtInt(d.deletes)} removed</dd>
                    <dt className="text-gray-500">Reads</dt>
                    <dd className="text-gray-200 tabular-nums">{fmtInt(d.index_scans)} by index, {fmtInt(d.seq_scans)} full scans</dd>
                  </dl>
                </section>
                {Array.isArray(d.indexes) && d.indexes.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-300 mb-2">Indexes</h3>
                    <Table>
                      <THead><Th>Index</Th><Th align="right">Size</Th><Th align="right">Used</Th></THead>
                      <tbody>
                        {d.indexes.slice(0, 25).map((i) => (
                          <Tr key={i.name}>
                            <Td className="font-mono text-[11px] break-all">{i.name}{i.unique ? ' (unique)' : ''}</Td>
                            <Td align="right" nowrap>{fmtBytes(i.bytes)}</Td>
                            <Td align="right" nowrap className="tabular-nums">{fmtInt(i.scans)}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </section>
                )}
                <ImpactBox what={`Opening ${table.label} is read only.`} change="Browsing opens a read-only view. Nothing changes."
                  who="Nobody." undo="Nothing to undo." />
              </>
            )}
    </Drawer>
  )
}
