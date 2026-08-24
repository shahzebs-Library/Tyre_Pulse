// ─────────────────────────────────────────────────────────────────────────────
// JobCardDetail.jsx - the whole uploaded job card, read only.
//
// Iterates the SAME catalog the form writes (src/lib/jobCard.js), so the detail
// view and the editor can never describe different cards. An absent value reads
// "Not recorded" - never a dash, never 0, never a blank cell that looks like a
// measurement of zero.
// ─────────────────────────────────────────────────────────────────────────────
import { Edit2, Info } from 'lucide-react'
import {
  JOB_CARD_SECTIONS,
  fieldsForSection,
  readField,
  jobCardCompleteness,
  erpReportedCost,
  erpLineItems,
} from '../../lib/jobCard'
import { formatDateTime } from '../../lib/formatters'
import JobCardFlow from './JobCardFlow'

const NOT_RECORDED = 'Not recorded'

/** Render one field's stored value for display. */
function displayValue(row, field) {
  const v = readField(row, field.key)
  if (v === null || v === undefined || String(v).trim() === '') return NOT_RECORDED
  if (field.type === 'datetime') return formatDateTime(v)
  return String(v)
}

export default function JobCardDetail({ row, now = Date.now(), currency = '', onEdit, canEdit = false }) {
  if (!row) return null

  const completeness = jobCardCompleteness(row)
  const erpCost = erpReportedCost(row)
  const erpTasks = erpLineItems(row)

  return (
    <div className="space-y-4">
      {/* ── Header: completeness + edit ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2 py-1 rounded-full bg-[var(--surface-3)] text-[var(--text-secondary)]">
            Card completeness: {completeness.filled} of {completeness.total} fields recorded
            {completeness.pct === null ? '' : ` (${completeness.pct}%)`}
          </span>
        </div>
        {canEdit && (
          <button type="button" onClick={onEdit} className="btn-secondary text-xs">
            <Edit2 size={13} className="inline mr-1" />
            Edit job card
          </button>
        )}
      </div>

      {/* ── The availability flow ───────────────────────────────────────────── */}
      <JobCardFlow row={row} now={now} />

      {/* ── Every catalog field, by section ─────────────────────────────────── */}
      {JOB_CARD_SECTIONS.map(section => {
        const fields = fieldsForSection(section.key)
        if (!fields.length) return null
        return (
          <div key={section.key} className="border border-[var(--border-bright)] rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-[var(--surface-2)]">
              <div className="text-[var(--text-primary)] text-xs font-semibold">{section.label}</div>
              <p className="text-[var(--text-muted)] text-[10px] mt-0.5">{section.hint}</p>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              {fields.map(f => {
                const shown = displayValue(row, f)
                const absent = shown === NOT_RECORDED
                return (
                  <div key={f.key}>
                    <div className="text-[var(--text-muted)] text-[10px]">{f.label}</div>
                    <div className={`text-sm mt-0.5 break-words ${
                      absent ? 'text-[var(--text-muted)] italic' : 'text-[var(--text-primary)]'
                    }`}>
                      {shown}
                      {!absent && f.type === 'money' && currency ? ` ${currency}` : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* ── ERP reported cost: read only, kept apart on purpose ─────────────── */}
      {erpCost && (
        <div className="border border-[var(--border-bright)] rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-[var(--surface-2)]">
            <div className="text-[var(--text-primary)] text-xs font-semibold">As reported by the ERP</div>
            <p className="text-[var(--text-muted)] text-[10px] mt-0.5 flex items-center gap-1">
              <Info size={10} />
              Read only. The expense grid is the authoritative cost source, so these are never written back
              and never added to the app own cost.
            </p>
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Spare parts', erpCost.spareParts],
              ['Tyre', erpCost.tyre],
              ['Oil', erpCost.oil],
              ['Others', erpCost.others],
              ['Manpower', erpCost.manpower],
              ['Total parts', erpCost.totalParts],
              ['Total repair', erpCost.totalRepair],
            ].map(([label, v]) => (
              <div key={label}>
                <div className="text-[var(--text-muted)] text-[10px]">{label}</div>
                <div className={`text-sm mt-0.5 ${v === null ? 'text-[var(--text-muted)] italic' : 'text-[var(--text-primary)]'}`}>
                  {v === null ? 'N/A' : `${v} ${currency}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ERP task lines. Nothing renders when there are none. ────────────── */}
      {erpTasks.length > 0 && (
        <div className="border border-[var(--border-bright)] rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-[var(--surface-2)]">
            <div className="text-[var(--text-primary)] text-xs font-semibold">Job card task lines (from ERP)</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--text-muted)] text-[10px]">
                  <th className="text-left px-4 py-2">Task</th>
                  <th className="text-left px-4 py-2">Detail</th>
                  <th className="text-left px-4 py-2">Action taken</th>
                  <th className="text-right px-4 py-2">Qty</th>
                </tr>
              </thead>
              <tbody>
                {erpTasks.map((li, i) => (
                  <tr key={i} className="border-t border-[var(--border-bright)]">
                    <td className="px-4 py-2 text-[var(--text-primary)]">{li.task || NOT_RECORDED}</td>
                    <td className="px-4 py-2 text-[var(--text-secondary)]">{li.detail || NOT_RECORDED}</td>
                    <td className="px-4 py-2 text-[var(--text-secondary)]">{li.action || NOT_RECORDED}</td>
                    <td className="px-4 py-2 text-right text-[var(--text-secondary)]">{li.qty ?? NOT_RECORDED}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
