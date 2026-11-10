/**
 * ImportCostPreview - the tyre cost validation shown BEFORE an expense grid or monthly
 * tyre import is committed. Built from buildImportPreview (src/lib/importCostPreview.js).
 *
 * Per row: Uploaded price -> Proposed price -> Matching source -> Validation result ->
 * Action required. Proposed prices are shown only; nothing here writes a price.
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'
import EnterpriseTable from '../ui/EnterpriseTable'
import { formatCurrency } from '../../lib/formatters'
import { COST_PENDING_LABEL } from '../../lib/tyreCostAudit'
import { needsAttention } from '../../lib/importCostPreview'

const BUCKETS = [
  ['tyre', 'Tyres'], ['spare', 'Spare (incl. tubes, flaps, valves)'], ['service', 'Service'],
  ['repair', 'Repair'], ['warranty', 'Warranty'], ['mixed', 'Mixed tyre + tube'],
]

const TONE = {
  valid: 'text-[var(--success,#16a34a)]',
  price_proposed: 'text-[var(--info,#2563eb)]',
  cost_pending: 'text-[var(--warning,#d97706)]',
  warranty: 'text-[var(--text-secondary)]',
  review: 'text-[var(--warning,#d97706)]',
  invalid: 'text-[var(--danger,#dc2626)]',
  duplicate: 'text-[var(--danger,#dc2626)]',
}

export default function ImportCostPreview({ preview, currency }) {
  const [onlyAttention, setOnlyAttention] = useState(true)
  const data = useMemo(() => {
    const rows = preview?.rows || []
    return onlyAttention ? rows.filter(needsAttention) : rows
  }, [preview, onlyAttention])

  const columns = useMemo(() => {
    const money = (v) => (v == null ? COST_PENDING_LABEL : formatCurrency(v, currency))
    return [
    { id: 'row', header: 'Row', accessorFn: (r) => r.row, size: 70 },
    { id: 'description', header: 'Line', accessorFn: (r) => r.description || 'N/A', size: 240 },
    { id: 'uploaded', header: 'Uploaded price', accessorFn: (r) => (r.bucket === 'tyre' || r.uploaded != null ? money(r.uploaded) : 'N/A'), size: 150 },
    { id: 'proposed', header: 'Proposed price', accessorFn: (r) => (r.proposed == null ? 'None' : formatCurrency(r.proposed, currency)), size: 130 },
    { id: 'source', header: 'Matching source', accessorFn: (r) => r.source || 'None', size: 200 },
    {
      id: 'result', header: 'Validation result', size: 190,
      accessorFn: (r) => [r.label, ...(r.issues || [])].join(': '),
      cell: ({ row }) => (
        <span className={TONE[row.original.result] || ''}>
          {row.original.label}{row.original.issues?.length ? `: ${row.original.issues.join(', ')}` : ''}
        </span>
      ),
    },
    { id: 'action', header: 'Action required', accessorFn: (r) => r.action, size: 220 },
    ]
  }, [currency])

  if (!preview) return null
  const c = preview.counts || {}
  const recon = preview.reconciliation
  const excludedRows = preview.rows.filter((r) => preview.excludedIndexes.has(r.index))

  return (
    <div className="space-y-3" data-testid="import-cost-preview">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[var(--text-secondary)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tyre cost validation</h3>
      </div>
      <p className="text-xs text-[var(--text-tertiary)]">
        Uploaded values import as they are. Proposed prices are shown for review only and are applied
        through the Tyre Cost Audit approval. A missing tyre cost is recorded as {COST_PENDING_LABEL}, never 0.
      </p>
      {preview.indexError && (
        <p role="status" className="text-xs text-[var(--warning,#d97706)]">
          Stored prices could not be loaded ({preview.indexError}). Prices are proposed from this file only.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        {[
          ['Valid', c.valid], ['Price proposed', c.price_proposed], [COST_PENDING_LABEL, c.cost_pending],
          ['Warranty', c.warranty], ['Needs review', c.review], ['Invalid', c.invalid], ['Duplicate', c.duplicate],
        ].map(([label, n]) => (
          <div key={label} className="rounded border border-[var(--border-subtle,#e5e7eb)] px-3 py-2">
            <p className="text-xs text-[var(--text-tertiary)]">{label}</p>
            <p className="font-semibold tabular-nums">{(n || 0).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {recon && (
        <div className="rounded border border-[var(--border-subtle,#e5e7eb)] p-3 text-sm space-y-1" data-testid="import-cost-recon">
          <div className="flex items-center gap-2">
            {recon.reconciles
              ? <CheckCircle2 className="h-4 w-4 text-[var(--success,#16a34a)]" />
              : <AlertTriangle className="h-4 w-4 text-[var(--danger,#dc2626)]" />}
            <span className="font-medium">
              Split {recon.reconciles ? 'reconciles' : 'does not reconcile'} to the file total {formatCurrency(recon.fileTotal, currency)}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5 text-xs text-[var(--text-secondary)]">
            {BUCKETS.map(([k, label]) => (
              <span key={k}>{label}: <span className="tabular-nums">{formatCurrency(recon.totals[k] || 0, currency)}</span></span>
            ))}
          </div>
        </div>
      )}

      {preview.excludedCount > 0 && (
        <div role="alert" className="rounded border border-[var(--danger,#dc2626)]/40 p-3 text-sm" data-testid="import-cost-excluded">
          <p className="font-medium">
            {preview.advisory
              ? `${preview.excludedCount.toLocaleString()} row(s) failed the cost validation. Review them before committing.`
              : `${preview.excludedCount.toLocaleString()} row(s) will NOT be imported${preview.excludedValue != null ? ` (value ${formatCurrency(preview.excludedValue, currency)})` : ''}. All other rows still import.`}
          </p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {excludedRows.slice(0, 50).map((r) => `Row ${r.row} (${r.label})`).join(', ')}
            {excludedRows.length > 50 ? ` and ${excludedRows.length - 50} more` : ''}
          </p>
        </div>
      )}

      <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
        Show only rows that need attention
      </label>
      <EnterpriseTable
        columns={columns}
        data={data}
        getRowId={(r) => String(r.index)}
        enableExport={false}
        enableColumnFilters={false}
        searchPlaceholder="Search validation rows..."
        initialPageSize={25}
        emptyMessage={onlyAttention ? 'Every row is valid.' : 'No rows to validate.'}
      />
    </div>
  )
}
