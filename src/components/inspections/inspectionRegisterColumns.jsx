import { Link } from 'react-router-dom'
import { Camera, ClipboardList, Eye, FileText, Pencil, Trash2, CheckCircle2 } from 'lucide-react'
import { trackingLink } from '../../lib/tyreChangeTracking'
import { isObservationType, isTrainingType, SEVERITIES } from '../../lib/inspectionsAnalytics'

/**
 * Column definitions for the Inspections register (EnterpriseTable).
 *
 * The badge colours are SEMANTIC (status and severity) and every badge also
 * prints its word, so colour is never the only signal. The action cell stops
 * propagation, so a click on an action never also opens the record.
 */
export const STATUS_CONFIG = {
  Scheduled: { color: 'text-blue-400', bg: 'bg-blue-900/30', border: 'border-blue-700/50' },
  'In Progress': { color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700/50' },
  Done: { color: 'text-green-400', bg: 'bg-green-900/30', border: 'border-green-700/50' },
  Overdue: { color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-700/50' },
  Cancelled: { color: 'text-[var(--text-secondary)]', bg: 'bg-[var(--surface-2)]', border: 'border-[var(--border-bright)]' },
}

export const SEV_CONFIG = {
  Low: { color: 'text-green-400', bg: 'bg-green-900/20', border: 'border-green-700/40' },
  Medium: { color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-700/40' },
  High: { color: 'text-orange-400', bg: 'bg-orange-900/20', border: 'border-orange-700/40' },
  Critical: { color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-700/40' },
}

const SEV_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i + 1]))
// Blank sorts last whichever way the column is sorted.
const blankToUndef = (v) => (v == null || v === '' ? undefined : v)

const ACTION_BTN = 'inline-flex items-center justify-center gap-1 min-h-[32px] min-w-[32px] text-xs px-2 py-1 rounded border transition-colors'
const NEUTRAL_BTN = `${ACTION_BTN} bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] border-[var(--border-bright)]`

export function buildRegisterColumns({
  t, flagMap, pdfBusyId,
  onView, onMarkDone, onRaiseAction, onEdit, onExportPdf, onDelete,
}) {
  return [
    {
      id: 'inspection_type',
      header: t('inspections.table.type'),
      accessorFn: (r) => blankToUndef(r.inspection_type),
      sortUndefined: 'last',
      size: 130,
      cell: ({ row }) => {
        const r = row.original
        const isObs = isObservationType(r.inspection_type)
        const isTrn = isTrainingType(r.inspection_type)
        return (
          <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${
            isObs ? 'bg-purple-900/20 text-purple-400 border-purple-700/40'
              : isTrn ? 'bg-blue-900/20 text-blue-400 border-blue-700/40'
                : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
          }`}>
            {r.inspection_type || 'N/A'}
          </span>
        )
      },
      meta: { exportHeader: 'Type' },
    },
    {
      id: 'title',
      header: t('inspections.table.title'),
      accessorFn: (r) => blankToUndef(r.title),
      sortUndefined: 'last',
      size: 240,
      cell: ({ row }) => {
        const r = row.original
        return (
          <span className="text-[var(--text-primary)] font-medium text-sm inline-flex items-center gap-1 max-w-[260px]" title={r.title}>
            <span className="truncate">{r.title || 'Untitled'}</span>
            {r.photo_data && <Camera className="w-3 h-3 shrink-0 text-[var(--text-muted)]" aria-label={t('inspections.row.titleHasPhoto')} />}
            {r.linked_action_id && <ClipboardList className="w-3 h-3 shrink-0 text-yellow-500" aria-label={t('inspections.row.titleActionRaised')} />}
          </span>
        )
      },
    },
    {
      id: 'site',
      header: t('inspections.table.site'),
      accessorFn: (r) => blankToUndef(r.site),
      sortUndefined: 'last',
      cell: ({ getValue }) => <span className="text-[var(--text-secondary)] text-sm">{getValue() ?? 'N/A'}</span>,
    },
    {
      id: 'asset_no',
      header: t('inspections.table.asset'),
      accessorFn: (r) => blankToUndef(r.asset_no),
      sortUndefined: 'last',
      cell: ({ row }) => {
        const r = row.original
        const due = r.asset_no ? flagMap?.[r.asset_no]?.count || 0 : 0
        return (
          <div className="font-mono text-xs text-[var(--text-secondary)]">
            <span className="block">{r.asset_no || 'N/A'}</span>
            {due > 0 && (
              /* The flag GOES somewhere: straight to this vehicle's flagged tyres.
                 The row click opens the inspection, so this must not bubble. */
              <Link
                to={trackingLink({ asset: r.asset_no })}
                onClick={(e) => e.stopPropagation()}
                className="inline-block mt-0.5 px-1.5 py-px rounded-full text-[10px] font-sans font-medium whitespace-nowrap underline"
                style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.3)' }}
                title={`See which tyres are due on ${r.asset_no} and whether they have been replaced`}
              >
                Tyres due ({due})
              </Link>
            )}
          </div>
        )
      },
    },
    {
      id: 'scheduled_date',
      header: t('inspections.table.date'),
      accessorFn: (r) => blankToUndef(r.scheduled_date),
      sortUndefined: 'last',
      cell: ({ getValue }) => <span className="text-[var(--text-secondary)] text-xs tabular-nums">{getValue() ?? 'N/A'}</span>,
    },
    {
      id: 'severity',
      header: t('inspections.table.severity'),
      accessorFn: (r) => SEV_RANK[r.severity],
      sortUndefined: 'last',
      cell: ({ row }) => {
        const sev = row.original.severity
        if (!sev) return <span className="text-xs text-[var(--text-muted)]">N/A</span>
        const cfg = SEV_CONFIG[sev] || SEV_CONFIG.Medium
        return <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>{sev}</span>
      },
      meta: { exportValue: (r) => r.severity || 'N/A' },
    },
    {
      id: 'status',
      header: t('inspections.table.status'),
      accessorFn: (r) => blankToUndef(r.status),
      sortUndefined: 'last',
      cell: ({ row }) => {
        const s = row.original.status
        const cfg = STATUS_CONFIG[s] || STATUS_CONFIG.Scheduled
        return <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${cfg.bg} ${cfg.color} ${cfg.border}`}>{s || 'N/A'}</span>
      },
    },
    {
      id: 'inspector',
      header: t('inspections.table.inspector'),
      accessorFn: (r) => blankToUndef(r.inspector || r.attendees),
      sortUndefined: 'last',
      cell: ({ getValue }) => <span className="text-[var(--text-secondary)] text-xs">{getValue() ?? 'N/A'}</span>,
    },
    {
      id: 'actions',
      header: t('inspections.table.actions'),
      enableSorting: false,
      enableHiding: false,
      size: 260,
      meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const isObs = isObservationType(r.inspection_type)
        const label = r.title || r.asset_no || 'inspection'
        return (
          <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => onView(r)} className={NEUTRAL_BTN}
              title={t('inspections.row.titleOpenRecord')} aria-label={`Open ${label}`}>
              <Eye size={12} aria-hidden />
            </button>
            {r.status !== 'Done' && r.status !== 'Cancelled' && (
              <button type="button" onClick={() => onMarkDone(r)}
                className={`${ACTION_BTN} whitespace-nowrap bg-green-900/30 text-green-500 hover:bg-green-900/50 border-green-700/50`}>
                <CheckCircle2 size={12} aria-hidden /> {t('inspections.row.done')}
              </button>
            )}
            {isObs && r.status === 'Done' && !r.linked_action_id && (
              <button type="button" onClick={() => onRaiseAction(r)}
                className={`${ACTION_BTN} whitespace-nowrap bg-yellow-900/20 text-yellow-600 hover:bg-yellow-900/40 border-yellow-700/40`}>
                {t('inspections.row.raiseAction')}
              </button>
            )}
            {r.linked_action_id && (
              <span className="text-xs px-2 py-1 rounded bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border-bright)] whitespace-nowrap">
                {t('inspections.row.actionRaised')}
              </span>
            )}
            <button type="button" onClick={() => onEdit(r)} className={NEUTRAL_BTN}>
              <Pencil size={12} aria-hidden /> {t('inspections.row.edit')}
            </button>
            <button type="button" onClick={() => onExportPdf(r)} disabled={pdfBusyId === r.id}
              className={`${NEUTRAL_BTN} disabled:opacity-50`}
              title={t('inspections.row.titleExportPdf')} aria-label={`${t('inspections.row.titleExportPdf')}: ${label}`}>
              <FileText size={12} aria-hidden />
            </button>
            <button type="button" onClick={() => onDelete(r)}
              className={`${ACTION_BTN} bg-red-900/20 text-red-500 hover:bg-red-900/40 border-red-800/50`}>
              <Trash2 size={12} aria-hidden /> {t('inspections.row.del')}
            </button>
          </div>
        )
      },
    },
  ]
}
