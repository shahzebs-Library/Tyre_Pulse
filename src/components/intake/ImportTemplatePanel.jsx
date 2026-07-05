import { useState } from 'react'
import { Download, ChevronDown, ChevronRight, FileSpreadsheet, Info } from 'lucide-react'
import { downloadTemplateCsv, templateFieldGuide, TEMPLATE_MODULES } from '../../lib/import/templates'

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
      <div className="w-full flex items-center gap-2 px-4 py-3 bg-sky-950/30">
        <FileSpreadsheet size={16} className="text-sky-400" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Import template — {supported.label}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {guide.length} columns · {requiredCount} required · headers pre-arranged to auto-map at 100%
          </p>
        </div>
        <button
          onClick={() => downloadTemplateCsv(module)}
          className="px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm flex items-center gap-2 shrink-0"
        >
          <Download size={15} /> Download CSV
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          className="p-2 rounded-lg hover:bg-sky-900/40 text-sky-300 shrink-0"
          title={open ? 'Hide columns' : 'Show all columns'}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-sky-800/40 p-4 space-y-3">
          <p className="text-xs text-[var(--text-secondary)] flex items-start gap-1.5">
            <Info size={14} className="text-sky-400 shrink-0 mt-0.5" />
            Fill the template and upload it — every column below is recognised automatically. You can
            keep extra columns; unknown columns are preserved as custom fields, never dropped. Column
            order does not matter. Leave a cell blank when you don&apos;t have the value.
          </p>
          <div className="overflow-x-auto border border-[var(--card-border)] rounded-lg max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-800/60 text-gray-400 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Column header</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Required</th>
                </tr>
              </thead>
              <tbody>
                {guide.map((g) => (
                  <tr key={g.key} className="border-t border-[var(--card-border)]">
                    <td className="px-3 py-1.5 text-[var(--text-primary)] font-medium">
                      {g.label}
                      {g.derived && <span className="ml-2 text-[10px] text-amber-400">(auto-split by Qty)</span>}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--text-muted)] capitalize">{g.type}</td>
                    <td className="px-3 py-1.5">
                      {g.required
                        ? <span className="text-red-400 font-semibold">Required</span>
                        : <span className="text-gray-500">Optional</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {module === 'tyre' && (
            <p className="text-[11px] text-amber-300/90 leading-relaxed">
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
