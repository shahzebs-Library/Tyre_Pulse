/**
 * Stock reconciliation (read only). Ledger against balance, the old stock
 * quantity against the quantity on hand, quantity with no movements, reserved
 * quantity, negative stock, unvalued quantity and unlinked lines. Each check
 * shows its count; picking one lists the stock lines behind it, with an Excel
 * export. Nothing here changes stock: corrections go through the normal
 * posting and approval routes.
 */
import { useMemo, useState } from 'react'
import { Scale, AlertTriangle, Link2Off, Download, RefreshCw, Ban, PackageX, Coins, Layers, BookX } from 'lucide-react'
import { KitTable, Kpi } from '../commandCenter/kit'
import { loadStockReconcile } from '../../lib/api/stockReconcile'
import { reconcileExportRows, isDemoLine } from '../../lib/inventory/stockReconcile'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, ErrorNote, NotSetUp, Note, StatusPill, SearchBox, SectionCard, alignNumeric, fmtDateTime } from './InvUi'

const ICONS = {
  ledger_drift: Scale, stock_qty_diff: Layers, qty_no_ledger: BookX, reserved_mismatch: Ban,
  negative: AlertTriangle, unvalued: Coins, unlinked: Link2Off, not_in_catalogue: PackageX,
}
const KPI_TONE = { bad: 't-red', warning: 't-amber', muted: 't-blue' }
const PAGE = 100

const qty = (v) => (v === null || v === undefined ? <span className="cc-na">N/A</span> : formatQty(v))

export default function StockReconcilePanel({ scope, can }) {
  const q = useInvQuery(() => loadStockReconcile(scope), [scope?.country, scope?.site])
  const [active, setActive] = useState('ledger_drift')
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState('')
  const canExport = typeof can === 'function' ? can('export') : false

  const check = q.data?.checks?.find((c) => c.key === active) || null
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = check?.rows || []
    if (!term) return list
    return list.filter((r) => [r.site, r.description, r.country, r.id].some((v) => String(v || '').toLowerCase().includes(term)))
  }, [check, search])

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what="stock lines" />

  const doExport = async () => {
    if (!check) return
    setExporting(true); setExportErr('')
    try {
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      const data = reconcileExportRows({ ...check, rows })
      const keys = ['check', 'stock_id', 'country', 'site', 'description', 'qty_on_hand', 'ledger_qty', 'stock_qty', 'qty_reserved', 'ledger_reserved', 'unvalued_qty', 'movements', 'difference', 'demo']
      const headers = ['Check', 'Stock line', 'Country', 'Site', 'Description', 'On hand', 'Ledger', 'Old stock qty', 'Reserved', 'Reserved in ledger', 'Unvalued qty', 'Movements', 'Difference', 'Data']
      await exportToExcel(data, keys, headers, reportFileName('Stock reconciliation', check.label, scope?.country || 'All countries'), 'Reconciliation')
    } catch {
      setExportErr('The file could not be created. Try again.')
    } finally { setExporting(false) }
  }

  const columns = [
    { key: 'site', header: 'Site', cell: (r) => r.site || <span className="cc-na">N/A</span> },
    { key: 'description', header: 'Description', cell: (r) => (
      <span>{r.description || <span className="cc-na">N/A</span>}{isDemoLine(r) && <> <StatusPill value="demo" tone="muted" label="Demo" /></>}</span>
    ) },
    { key: 'qty_on_hand', header: 'On hand', numeric: true, cell: (r) => qty(r.qty_on_hand) },
    ...(active === 'ledger_drift' || active === 'qty_no_ledger' ? [
      { key: 'ledger_qty', header: 'Ledger', numeric: true, cell: (r) => qty(r.ledger_qty) },
      { key: 'movement_count', header: 'Movements', numeric: true, cell: (r) => qty(r.movement_count) },
    ] : []),
    ...(active === 'stock_qty_diff' ? [{ key: 'stock_qty', header: 'Old stock qty', numeric: true, cell: (r) => qty(r.stock_qty) }] : []),
    ...(active === 'reserved_mismatch' ? [
      { key: 'qty_reserved', header: 'Reserved', numeric: true, cell: (r) => qty(r.qty_reserved) },
      { key: 'ledger_reserved', header: 'Reserved in ledger', numeric: true, cell: (r) => qty(r.ledger_reserved) },
    ] : []),
    ...(active === 'unvalued' ? [{ key: 'unvalued_qty', header: 'Unvalued qty', numeric: true, cell: (r) => qty(r.unvalued_qty) }] : []),
    ...(['ledger_drift', 'stock_qty_diff'].includes(active) ? [{ key: 'difference', header: 'Difference', numeric: true, cell: (r) => qty(r.difference) }] : []),
  ]

  const loading = q.loading && !q.data
  return (
    <div className="inv-hub">
      <Note>
        Read only. These checks compare each stock line with its own movement ledger. Nothing is corrected from here;
        a correction is posted through a stock movement or an approved adjustment so the ledger stays the record.
      </Note>
      {q.data?.truncated && (
        <Note tone="warn" title="Not every line was read">
          The scope holds more lines than this screen reads at once. Narrow the country or site to check the rest.
        </Note>
      )}
      <div className="inv-kpis">
        {(q.data?.checks || Array.from({ length: 8 }, (_, i) => ({ key: `s${i}`, label: '...', count: 0 }))).map((c) => (
          <Kpi key={c.key} icon={ICONS[c.key] || Scale} tone={c.count ? (KPI_TONE[c.tone] || 't-amber') : 't-green'}
            value={c.count} display={c.skipped ? 'N/A' : undefined} label={c.label} loading={loading}
            title={c.help} onClick={c.help ? () => { setActive(c.key); setSearch(''); setShown(PAGE) } : undefined} />
        ))}
      </div>
      {check && (
        <SectionCard
          title={`${check.label} (${check.skipped ? 'not checked' : formatQty(check.count)})`}
          sub={`${check.help}${q.data ? ` Lines checked: ${formatQty(q.data.total)}. Read ${fmtDateTime(q.data.generatedAt)}.` : ''}`}
          action={(
            <div className="inv-actions">
              <button type="button" className="cc-btn-ghost" onClick={q.retry} disabled={q.loading}>
                <RefreshCw size={14} aria-hidden="true" /> Refresh
              </button>
              {canExport && (
                <button type="button" className="cc-btn-ghost" onClick={doExport} disabled={exporting || !rows.length}>
                  <Download size={14} aria-hidden="true" /> {exporting ? 'Preparing...' : 'Excel'}
                </button>
              )}
            </div>
          )}>
          {exportErr && <ErrorNote error={exportErr} />}
          {check.skipped
            ? <Note tone="warn">The catalogue links could not be read, so this check was not run.</Note>
            : (
              <>
                <div className="inv-toolbar">
                  <SearchBox value={search} onChange={(v) => { setSearch(v); setShown(PAGE) }} placeholder="Search site or description" />
                </div>
                <div className="inv-scroll">
                  <KitTable compact columns={alignNumeric(columns)} rows={rows.slice(0, shown)} loading={loading}
                    empty={search ? 'No lines match the search.' : 'No lines fail this check.'} />
                </div>
                {rows.length > shown && (
                  <button type="button" className="cc-btn-ghost" onClick={() => setShown((n) => n + PAGE)}>
                    Show more ({formatQty(rows.length - shown)} left)
                  </button>
                )}
              </>
            )}
        </SectionCard>
      )}
    </div>
  )
}
