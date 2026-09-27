import { useState } from 'react'
import { Download, ChevronDown, ChevronRight, FileSpreadsheet, Info } from 'lucide-react'
import { downloadTemplateCsv, templateFieldGuide, TEMPLATE_MODULES } from '../../lib/import/templates'
import EnterpriseTable from '../ui/EnterpriseTable'
import { compareValues } from '../../lib/consoleTable'

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

const GUIDE_COLUMNS = [
  {
    id: 'label', header: 'Column header', accessorFn: (g) => g.label, sortingFn: valueSort,
    cell: ({ row: { original: g } }) => (
      <span className="text-[var(--text-primary)] font-medium">
        {g.label}
        {g.derived && <span className="ml-2 text-[10px] text-amber-500">(auto-split by Qty)</span>}
      </span>
    ),
  },
  {
    id: 'type', header: 'Type', accessorFn: (g) => g.type, sortingFn: valueSort,
    meta: { filterVariant: 'select' },
    cell: ({ getValue }) => <span className="text-[var(--text-muted)] capitalize">{getValue()}</span>,
  },
  {
    id: 'required', header: 'Required', accessorFn: (g) => (g.required ? 'Required' : 'Optional'), sortingFn: valueSort,
    meta: { filterVariant: 'select' },
    cell: ({ getValue }) => (getValue() === 'Required'
      ? <span className="text-red-500 font-semibold">Required</span>
      : <span className="text-[var(--text-muted)]">Optional</span>),
  },
]

/**
 * Import Template panel for the Data Intake Center.
 *
 * Gives the operator a ready-to-fill CSV (headers pre-arranged to auto-map at
 * 100%) plus an explicit column reference: which fields are required, which are
 * optional, and what each one powers. This is the answer to "what columns do we
 * have so I can arrange my file to get 100% data" — the template IS the answer,
 * always generated live from the same field registry the mapper uses.
 */
export default function ImportTemplatePanel({ module }) {
  const [open, setOpen] = useState(false)
  const supported = TEMPLATE_MODULES.find((m) => m.module === module)
  if (!supported) return null

  const guide = templateFieldGuide(module)
  const requiredCount = guide.filter((g) => g.required).length

  return (
    <div className="card p-0 overflow-hidden border border-sky-800/40">
      <div className="w-full flex flex-wrap items-center gap-2 px-4 py-3 bg-sky-500/10">
        <FileSpreadsheet size={16} className="text-sky-400" />
        <div className="flex-1 min-w-[180px]">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Import template: {supported.label}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {guide.length} columns · {requiredCount} required · headers pre-arranged to auto-map at 100%
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadTemplateCsv(module)}
          className="px-3 min-h-[44px] rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm flex items-center gap-2 shrink-0"
        >
          <Download size={15} aria-hidden="true" /> Download CSV
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg hover:bg-sky-500/15 text-sky-500 shrink-0"
          title={open ? 'Hide columns' : 'Show all columns'}
          aria-label={open ? 'Hide columns' : 'Show all columns'}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-sky-800/40 p-4 space-y-3">
          <p className="text-xs text-[var(--text-secondary)] flex items-start gap-1.5">
            <Info size={14} className="text-sky-400 shrink-0 mt-0.5" />
            Fill the template and upload it. Every column below is recognised automatically. You can
            keep extra columns; unknown columns are preserved as custom fields, never dropped. Column
            order does not matter. Leave a cell blank when you don&apos;t have the value.
          </p>
          <EnterpriseTable
            columns={GUIDE_COLUMNS}
            data={guide}
            getRowId={(g) => String(g.key)}
            initialPageSize={25}
            searchPlaceholder="Search column headers"
            exportFileName={`Import Template Columns ${supported.label}`}
            reportMeta={{ title: `Import template columns: ${supported.label}` }}
            emptyMessage="No columns match this search."
          />
          {module === 'tyre' && (
            <p className="text-[11px] text-amber-500 leading-relaxed">
              Cost columns: put the <span className="font-semibold">per-tyre price</span> in
              &ldquo;Unit Cost / Tyre&rdquo;, OR put the <span className="font-semibold">line total</span>
              {' '}(price already multiplied by quantity, as most ERP exports give) in &ldquo;Total
              Amount&rdquo; and the system divides it by Quantity automatically. Do not fill both.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
