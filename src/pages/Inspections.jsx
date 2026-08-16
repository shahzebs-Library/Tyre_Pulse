import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useFilterState } from '../hooks/useFilterState'
import { useScrollRestore } from '../hooks/useScrollRestore'
import { useVirtualizer } from '@tanstack/react-virtual'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import * as inspectionsApi from '../lib/api/inspections'
import * as correctiveActions from '../lib/api/correctiveActions'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToExcel, exportToPdf, exportInspectionDetailPdf, resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'
import { useTenant } from '../contexts/TenantContext'
import { Download, FileText, Camera, ClipboardList, Eye, GraduationCap, CheckSquare, X, Share2, WifiOff, PenLine, Image as ImageIcon, Gauge, Clock, Send, ExternalLink, Trash2, AlertTriangle, ChevronDown } from 'lucide-react'
import SignaturePad from '../components/SignaturePad'
import StatusBadge from '../components/ui/StatusBadge'
import CustomFieldsPanel from '../components/CustomFieldsPanel'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import VehicleTyreDiagram from '../components/VehicleTyreDiagram'
import { legacyPositionCode } from '../lib/tyrePositions'
import { useWakeLock, vibrate, shareOrCopy } from '../hooks/useWakeLock'
import { enqueueInspection, syncPendingInspections, getPendingCount } from '../lib/offlineQueue'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { loadAutoTable } from '../lib/pdfEngine'
import { resolveStorageUrl } from '../lib/storageRefs'
import { getTyreRunningLife } from '../lib/api/tyreRunningLife'
import { shapeRunningLife, lifeDisplay, measureFor } from '../lib/tyreRunningLife'
import { buildAssetFlagMap, damagedPositions, inspectionOverview, siteSummary, defectsForAction, isSevereCondition } from '../lib/inspectionTyreFlags'
import { displayPositionCode, inspectionTypeHint } from '../lib/tyreBay'
import { positionLabelMap, riskForCondition } from '../lib/inspectionView'
import { listSites, siteRegionMap, regionForSite, regionsIn } from '../lib/api/sites'
import { trackingLink, trackTyreChanges, trackingBySite } from '../lib/tyreChangeTracking'
import { loadTyreChangeTracking } from '../lib/api/tyreChangeTracking'
// The shared dialog shell. Imported under an alias because this file still
// carries an older local `Modal` used by four other dialogs; converting those is
// separate work, and a new dialog must not hand-roll its own overlay.
import SharedModal from '../components/ui/Modal'
import { raiseActionsForInspection } from '../lib/api/correctiveActions'
import { getCompanyLogo, getDiagramBg } from '../lib/api/brandLogo'
import InspectionViewerDrawer from '../components/inspection/InspectionViewerDrawer'

/**
 * How long a running-life payload may be reused.
 *
 * get_tyre_running_life costs 832 ms of server time and 2.2 MB for KSA. The
 * page needs it once for its tyre-due flags; every row PDF exported in the next
 * couple of minutes can honestly reuse that same reading rather than paying for
 * it again. Short enough that a genuine tyre change shows up on the next visit.
 */
const RUNNING_LIFE_TTL_MS = 120000

// Report logo: tenant branding wins; otherwise fall back to the org-wide
// company logo set in Console -> Report Colors (system_config.company_logo).
async function brandingForPdf(branding) {
  if (branding?.logo_url) return branding
  try {
    const logo = await getCompanyLogo()
    return logo ? { ...(branding || {}), logo_url: logo } : branding
  } catch { return branding }
}

const STATUS_CONFIG = {
  Scheduled:    { color: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700/50' },
  'In Progress':{ color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700/50' },
  Done:         { color: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700/50' },
  Overdue:      { color: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700/50' },
  Cancelled:    { color: 'text-[var(--text-secondary)]',   bg: 'bg-[var(--surface-2)]',      border: 'border-[var(--border-bright)]' },
}

const SEV_CONFIG = {
  Low:      { color: 'text-green-400',  bg: 'bg-green-900/20',  border: 'border-green-700/40' },
  Medium:   { color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-700/40' },
  High:     { color: 'text-orange-400', bg: 'bg-orange-900/20', border: 'border-orange-700/40' },
  Critical: { color: 'text-red-400',    bg: 'bg-red-900/20',    border: 'border-red-700/40' },
}

// --- Tyre-change flag UI (additive) -----------------------------------------
// Muted slide-style overview card: big numbers, subtle borders, app tokens.
function OverviewSlide({ title, items, footer = null }) {
  return (
    <div className="card flex-1 min-w-[260px]">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {items.map(([label, value, accent]) => (
          <div key={label}>
            <div className="text-2xl font-bold tabular-nums" style={{ color: accent && Number(value) > 0 ? '#b91c1c' : 'var(--text-primary)' }}>
              {value == null ? 'N/A' : value}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">{label}</div>
          </div>
        ))}
      </div>
      {footer && <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">{footer}</div>}
    </div>
  )
}

// Shareable per-site summary: the inspections done AND the tyre-change flags
// they raised, tracked through to replacement. Date range + site filter, PDF and
// Excel export. Every number comes from a pure helper (siteSummary /
// trackingBySite) - no parallel maths on this screen.
//
// The tyre-change half loads on OPEN, not with the page: it is a second read
// (fitment history for the flagged assets) and the register must stay fast for
// the people who never share a summary.
function InspectionSummaryModal({ rows, flagMap, defaultFrom, defaultTo, country, company, branding, onClose }) {
  const [from, setFrom] = useState(defaultFrom || '')
  const [to, setTo] = useState(defaultTo || '')
  const [site, setSite] = useState('')
  const [busy, setBusy] = useState(false)
  const [track, setTrack] = useState({ loading: true, ok: true, reason: '', rows: [] })

  useEffect(() => {
    let alive = true
    ;(async () => {
      const payload = await loadTyreChangeTracking({ country })
      if (!alive) return
      if (!payload.ok) {
        setTrack({ loading: false, ok: false, reason: payload.reason || '', rows: [] })
        return
      }
      const built = trackTyreChanges({
        dueRows: payload.dueRows,
        inspections: payload.inspections,
        actions: payload.actions,
        tyreRecords: payload.tyreRecords,
      })
      setTrack({ loading: false, ok: true, reason: '', rows: built.rows })
    })()
    return () => { alive = false }
  }, [country])

  const sites = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )
  const summary = useMemo(
    () => siteSummary(rows, flagMap, { from, to, site }),
    [rows, flagMap, from, to, site],
  )
  // Flags are a live state ("is this tyre still due"), not an event inside the
  // date range, so only the site filter applies to them - and the note under
  // the table says so rather than letting a reader assume the dates bound both.
  const tracking = useMemo(
    () => trackingBySite(site ? track.rows.filter((r) => (r.site || 'No site') === site) : track.rows),
    [track.rows, site],
  )
  const rangeLabel = `${from || 'Start'} to ${to || 'Today'}${site ? ` | Site: ${site}` : ''}${country && country !== 'All' ? ` | ${country}` : ''}`
  const COLS = ['site', 'inspections', 'vehicles', 'good', 'wear', 'damage', 'tyresDue']
  const HEADS = ['Site', 'Inspections', 'Vehicles', 'Good', 'Wear', 'Damage', 'Tyres due']
  const TCOLS = ['site', 'flagged', 'system', 'user', 'onVehicle', 'replaced', 'removed', 'unknown']
  const THEADS = ['Site', 'Flagged', 'By system', 'By user', 'Still fitted', 'Replaced', 'Removed only', 'Could not tell']
  const hasTracking = track.ok && tracking.rows.length > 0

  async function exportPdf() {
    setBusy(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = await loadAutoTable()
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(await brandingForPdf(branding))
      pdfHeader(doc, 'Inspection and Tyre Change Summary', rangeLabel, company, brand)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 30,
        margin: { left: 14, right: 14 },
        head: [HEADS],
        body: [
          ...summary.rows.map((r) => COLS.map((k) => String(r[k]))),
          COLS.map((k) => String(summary.totals[k])),
        ],
        didParseCell(data) {
          if (data.section === 'body' && data.row.index === summary.rows.length) {
            data.cell.styles.fontStyle = 'bold'
          }
        },
      })
      // The tyre-change half of the report. When it could not be read the PDF
      // SAYS so - a missing table would read as "no tyre was flagged".
      const afterY = (doc.lastAutoTable?.finalY || 30) + 8
      if (hasTracking) {
        autoTable(doc, {
          ...pdfTableTheme(brand.accent),
          startY: afterY,
          margin: { left: 14, right: 14 },
          head: [THEADS],
          body: [
            ...tracking.rows.map((r) => TCOLS.map((k) => String(r[k]))),
            TCOLS.map((k) => String(tracking.totals[k])),
          ],
          didParseCell(data) {
            if (data.section === 'body' && data.row.index === tracking.rows.length) {
              data.cell.styles.fontStyle = 'bold'
            }
          },
        })
      } else {
        // Plain text under the first table rather than the shared empty-state
        // panel, which draws at its own fixed position and would land on top of
        // the inspection table.
        doc.setFontSize(9)
        doc.text(
          track.ok
            ? 'Tyre change flags: none. No tyre is past its expected life, close to it, or recorded as damaged.'
            : 'Tyre change flags could not be read when this report was built, so no tyre change is shown here.',
          14, afterY,
        )
      }
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(`TyrePulse Inspection and Tyre Change Summary ${from || 'all'} to ${to || 'today'}.pdf`)
    } finally { setBusy(false) }
  }

  async function exportExcel() {
    setBusy(true)
    try {
      await exportToExcel(
        [...summary.rows, summary.totals], COLS, HEADS,
        `TyrePulse Inspection Summary ${from || 'all'} to ${to || 'today'}`,
      )
      if (hasTracking) {
        await exportToExcel(
          [...tracking.rows, tracking.totals], TCOLS, THEADS,
          `TyrePulse Tyre Change Flags ${site || 'all sites'}`,
          'Tyre change flags',
        )
      }
    } finally { setBusy(false) }
  }

  return (
    <SharedModal open onClose={onClose} title="Inspection and tyre change summary" size="xl">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }} />
          </label>
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="mt-1 block rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }} />
          </label>
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Site
            <select value={site} onChange={(e) => setSite(e.target.value)}
              className="mt-1 block rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>
              <option value="">All sites</option>
              {sites.map((sv) => <option key={sv} value={sv}>{sv}</option>)}
            </select>
          </label>
          <div className="flex gap-2 ml-auto">
            <button type="button" disabled={busy || !summary.rows.length} onClick={exportExcel}
              className="px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs disabled:opacity-40" style={{ color: 'var(--text-primary)' }}>
              Excel
            </button>
            <button type="button" disabled={busy || !summary.rows.length} onClick={exportPdf}
              className="px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-40" style={{ background: 'var(--brand)', color: '#fff' }}>
              {busy ? 'Working...' : 'Download PDF'}
            </button>
          </div>
        </div>
        {!summary.rows.length ? (
          <p className="text-xs py-6 text-center" style={{ color: 'var(--text-secondary)' }}>No inspections in this range.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-[var(--border-subtle)]" style={{ color: 'var(--text-secondary)' }}>
                {HEADS.map((h, i) => <th key={h} className={`py-1.5 pr-2 ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={r.site} className="border-b border-[var(--border-subtle)]" style={{ color: 'var(--text-primary)' }}>
                  {COLS.map((k, i) => (
                    <td key={k} className={`py-1.5 pr-2 tabular-nums ${i > 0 ? 'text-right' : ''}`}
                      style={k === 'tyresDue' && r.tyresDue > 0 ? { color: '#b91c1c', fontWeight: 600 } : k === 'damage' && r.damage > 0 ? { color: '#b45309', fontWeight: 600 } : undefined}>
                      {r[k]}
                    </td>
                  ))}
                </tr>
              ))}
              <tr style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                {COLS.map((k, i) => <td key={k} className={`py-1.5 pr-2 tabular-nums ${i > 0 ? 'text-right' : ''}`}>{summary.totals[k]}</td>)}
              </tr>
            </tbody>
          </table>
        )}
        <p className="text-[11px] mt-3" style={{ color: 'var(--text-dim)' }}>
          Tyres due counts flagged tyres (past life or due soon) on the vehicles inspected in this range.
        </p>

        {/* Tyre change flags, per site, tracked to replacement. */}
        <div className="mt-5 pt-4 border-t border-[var(--border-subtle)]">
          <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            Tyre change flags by site
          </h4>
          <p className="text-[11px] mb-2" style={{ color: 'var(--text-secondary)' }}>
            Every flagged tyre and what happened to it. Raised by the system means past its expected
            life or due soon; raised by a user means damage or a puncture recorded on an inspection.
          </p>
          {track.loading ? (
            <p className="text-xs py-4" style={{ color: 'var(--text-secondary)' }}>Loading tyre change flags...</p>
          ) : !track.ok ? (
            /* "We could not look" is never printed as a row of zeros. */
            <p className="text-xs py-4" style={{ color: 'var(--text-secondary)' }}>
              Tyre change flags could not be read, so they are not in this summary.
              {track.reason ? ` ${track.reason}` : ''}
            </p>
          ) : !tracking.rows.length ? (
            <p className="text-xs py-4" style={{ color: 'var(--text-secondary)' }}>
              No tyre is currently flagged for change{site ? ` at ${site}` : ''}.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-[var(--border-subtle)]" style={{ color: 'var(--text-secondary)' }}>
                  {THEADS.map((h, i) => <th key={h} className={`py-1.5 pr-2 ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {tracking.rows.map((r) => (
                  <tr key={r.site} className="border-b border-[var(--border-subtle)]" style={{ color: 'var(--text-primary)' }}>
                    {TCOLS.map((k, i) => (
                      <td key={k} className={`py-1.5 pr-2 tabular-nums ${i > 0 ? 'text-right' : ''}`}
                        style={k === 'onVehicle' && r.onVehicle > 0 ? { color: '#b91c1c', fontWeight: 600 } : undefined}>
                        {r[k]}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                  {TCOLS.map((k, i) => <td key={k} className={`py-1.5 pr-2 tabular-nums ${i > 0 ? 'text-right' : ''}`}>{tracking.totals[k]}</td>)}
                </tr>
              </tbody>
            </table>
          )}
          <p className="text-[11px] mt-3" style={{ color: 'var(--text-dim)' }}>
            Replaced is worked out from the tyre consumption you upload: a different tyre fitted on the
            same vehicle at the same wheel after the flag. "Removed only" means the tyre came off and
            nothing has been fitted back. "Could not tell" means the position or the fitment record is
            missing, which is not the same as saying the tyre is still fitted. These figures follow the
            site filter but not the dates, because a flag is a state today rather than an event in the
            date range.
          </p>
        </div>
    </SharedModal>
  )
}

// Immediate flag banner: shown when the vehicle carries tyres at/near end of
// life (judged by the ONE running-life calc via buildAssetFlagMap) or when
// the inspection itself found damaged/punctured positions.
/**
 * Flags the tyres that need changing on the just-inspected vehicle, AND lets the
 * finding become tracked work.
 *
 * Before this, a recorded defect ended at the report - 13 live inspections found
 * damage across 12 assets while the whole system held 3 corrective actions. The
 * button lives HERE, on the one component both the saved checklist and the
 * record detail render, so the flag and the action can never be shown on
 * different surfaces or driven by different rules.
 *
 * `inspection` is optional: an unsaved form has no id to attach an action to, so
 * the button simply does not appear.
 */
function TyreDueBanner({ entry, damaged = [], inspection = null }) {
  const due = entry ? [...(entry.overdue || []), ...(entry.dueSoon || [])] : []
  const [raising, setRaising] = useState(false)
  const [raised, setRaised] = useState(null)   // { created, skipped, failed } | { error }

  const canRaise = Boolean(inspection?.id) && !String(inspection.id).startsWith('offline-')
  const defects = canRaise
    ? defectsForAction(inspection, inspection.asset_no ? { [inspection.asset_no]: entry } : {})
    : []

  const raise = async () => {
    setRaising(true); setRaised(null)
    try {
      setRaised(await raiseActionsForInspection(inspection, defects))
    } catch (e) {
      setRaised({ error: toUserMessage(e) })
    } finally {
      setRaising(false)
    }
  }

  // The fault list covers everything an inspector can record, and wear is most
  // of it. Calling a worn tyre "damage" would misreport what was found, so the
  // two are counted apart and the line says which.
  const severe = damaged.filter((d) => isSevereCondition(d.condition))
  const wornOnly = damaged.filter((d) => !isSevereCondition(d.condition))
  const faultLine = severe.length > 0 && wornOnly.length > 0
    ? 'Damage and worn tyres found on this vehicle'
    : (severe.length > 0 ? 'Damage found on this vehicle' : 'Worn tyres found on this vehicle')

  if (due.length === 0 && damaged.length === 0) return null
  return (
    <div className="rounded-xl border px-4 py-3 mb-4"
      style={{ borderColor: 'rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.07)' }}>
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={15} style={{ color: '#dc2626', flexShrink: 0 }} />
        <span className="text-sm font-semibold" style={{ color: '#ef4444' }}>
          {due.length > 0
            ? `${due.length} tyre${due.length === 1 ? '' : 's'} on this vehicle ${due.length === 1 ? 'is' : 'are'} at or near end of life - due for change`
            : faultLine}
        </span>
      </div>
      {due.length > 0 && (
        <ul className="text-xs space-y-0.5 text-[var(--text-secondary)]">
          {due.slice(0, 8).map((r, i) => (
            <li key={`${r.serial || 'tyre'}-${r.position || i}`} className="font-mono">
              {(r.serial || 'N/A')} at {(r.position || 'N/A')}: remaining {lifeDisplay(r.remainingKm, r.remainingHours)}
            </li>
          ))}
          {due.length > 8 && <li>and {due.length - 8} more</li>}
        </ul>
      )}
      {damaged.length > 0 && (
        <p className="text-xs mt-1 text-[var(--text-secondary)]">
          {/* Named the way the tyre records name it, so this line and the
              diagram above it do not call one wheel two things. */}
          {damaged
            .map((d) => `${displayPositionCode(inspectionTypeHint(inspection), d.position) || 'N/A'} (${d.condition})`)
            .join(', ')}
        </p>
      )}

      {canRaise && defects.length > 0 && (
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            type="button" onClick={raise} disabled={raising}
            className="btn-secondary text-xs flex items-center gap-2 disabled:opacity-60"
          >
            <ClipboardList size={13} />
            {raising ? 'Raising...' : `Raise corrective action (${defects.length})`}
          </button>
          {raised?.error && (
            <span className="text-xs" style={{ color: '#ef4444' }}>{raised.error}</span>
          )}
          {raised && !raised.error && (
            <span className="text-xs text-[var(--text-secondary)]">
              {raised.created.length > 0 && `${raised.created.length} action${raised.created.length === 1 ? '' : 's'} raised. `}
              {raised.skipped > 0 && `${raised.skipped} already open. `}
              {raised.failed.length > 0 && `${raised.failed.length} could not be raised. `}
              {raised.created.length === 0 && raised.skipped > 0 && raised.failed.length === 0
                && 'Nothing new to raise.'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
// ---------------------------------------------------------------------------

const VEHICLE_TYPES = ['Pickup', 'Canter', 'Tri-mixer', 'Concrete pump', 'Wheel loader', 'Skid loader', 'Bus', 'Tata', 'Ashok Leyland']
const RISK_LEVELS   = ['good', 'warning', 'critical', 'none']

const INSPECTION_TYPES   = ['Routine', 'Pressure', 'Visual', 'Full', 'Pre-Trip']
const OBSERVATION_TYPES  = ['Site Observation']
const TRAINING_TYPES     = ['Safety Training', 'Training Session']
const ALL_TYPES = [...INSPECTION_TYPES, ...OBSERVATION_TYPES, ...TRAINING_TYPES]

const STATUSES = ['Scheduled', 'In Progress', 'Done', 'Overdue', 'Cancelled']
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical']

// Position IDs must exactly match VehicleTyreDiagram LAYOUTS tyre ids
const TYRE_POSITIONS = {
  'pickup':        ['FL', 'FR', 'RL', 'RR'],
  'wheel loader':  ['FL', 'FR', 'RL', 'RR'],
  'skid loader':   ['FL', 'FR', 'RL', 'RR'],
  'canter':        ['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo'],
  'tri-mixer':     ['F1L', 'F1R', 'F2L', 'F2R', 'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro'],
  'concrete pump': ['F1L', 'F1R', 'F2L', 'F2R', 'F3L', 'F3R', 'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro'],
  'bus':           ['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo'],
  'tata':          ['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo'],
  'ashok leyland': ['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo'],
}
const DEFAULT_POSITIONS = ['FL', 'FR', 'RL', 'RR']

// Normalise vehicle type to TYRE_POSITIONS key
function normVT(vt) {
  const s = (vt || '').toLowerCase().trim()
  if (s.includes('tri') || s.includes('mixer'))       return 'tri-mixer'
  if (s.includes('concrete') || s.includes('pump'))   return 'concrete pump'
  if (s.includes('wheel') && s.includes('load'))      return 'wheel loader'
  if (s.includes('skid'))                             return 'skid loader'
  if (s.includes('canter'))                           return 'canter'
  if (s.includes('bus'))                              return 'bus'
  if (s.includes('tata'))                             return 'tata'
  if (s.includes('ashok') || s.includes('leyland'))   return 'ashok leyland'
  return 'pickup'
}

// Infer vehicle type from asset number prefix (TM→Tri-mixer, MP→Concrete pump, etc.)
function inferVehicleTypeFromAsset(assetNo) {
  const prefix = ((assetNo || '').match(/^[A-Za-z]+/) || [''])[0].toUpperCase().substring(0, 2)
  const map = { TM: 'Tri-mixer', MP: 'Concrete pump', WL: 'Wheel loader', SL: 'Skid loader', PL: 'Pickup', BH: 'Bus' }
  return map[prefix] || null
}

const EMPTY_FORM = {
  title: '', inspection_type: 'Routine', site: '', asset_no: '', tyre_serial: '',
  scheduled_date: '', status: 'Scheduled', findings: '', inspector: '', notes: '',
  attendees: '', severity: 'Medium', photo_data: null,
  vehicle_type: '', tyre_conditions: {},
}

function isObservationType(t) { return OBSERVATION_TYPES.includes(t) }
function isTrainingType(t)     { return TRAINING_TYPES.includes(t) }

// The DB `inspections.inspection_type` CHECK only allows tyre-inspection types
// (Routine/Pressure/Visual/Full/Pre-Trip). Observation & training records are a
// UI overlay that share the same table, so their display type is persisted in
// the unconstrained `custom_data.record_type` while the constrained column is
// written with a CHECK-valid value. `dbInspectionType` maps a display type to a
// storable value; `resolveRecordType` restores the display type on read.
function dbInspectionType(displayType) {
  return INSPECTION_TYPES.includes(displayType) ? displayType : 'Routine'
}
function resolveRecordType(row) {
  const rt = row?.custom_data?.record_type
  return (isObservationType(rt) || isTrainingType(rt) || INSPECTION_TYPES.includes(rt))
    ? rt
    : row?.inspection_type
}

const CHECKLIST_LABELS = {
  en: {
    title: 'Daily Inspection Checklist',
    asset: 'Asset Number',
    position: 'Position',
    pressure: 'Pressure (PSI)',
    condition: 'Condition',
    tread: 'Tread (mm)',
    notes: 'Notes',
    good: 'Good',
    wear: 'Wear',
    damage: 'Damage',
    puncture: 'Puncture',
    save: 'Save Checklist',
    export: 'Export PDF',
    inspector: 'Inspector',
    site: 'Site',
    no_asset: 'Enter asset number to load vehicle',
  },
  ar: {
    title: 'قائمة الفحص اليومي',
    asset: 'رقم الأصل',
    position: 'الموضع',
    pressure: 'الضغط (PSI)',
    condition: 'الحالة',
    tread: 'عمق المداس (مم)',
    notes: 'ملاحظات',
    good: 'جيد',
    wear: 'تآكل',
    damage: 'تلف',
    puncture: 'ثقب',
    save: 'حفظ القائمة',
    export: 'تصدير PDF',
    inspector: 'المفتش',
    site: 'الموقع',
    no_asset: 'أدخل رقم الأصل لتحميل المركبة',
  },
}

// Column widths for the virtual inspection table grid
const INSP_COL_WIDTHS = [110, 200, 110, 110, 100, 90, 100, 120, 240]

// ── Approval email HTML builder ────────────────────────────────────────────────
function buildApprovalEmailHtml({ assetNo, inspector, date, site, odometer, hourMeter, notes, approvalLink, signature }) {
  const sigBlock = signature
    ? `<img src="${signature}" alt="Inspector Signature" style="max-width:220px;border:1px solid #e5e7eb;border-radius:8px;margin-top:8px;" />`
    : '<p style="color:#9ca3af;font-style:italic;">No digital signature captured</p>'

  const rows = [
    ['Asset / Vehicle', assetNo || '-'],
    ['Inspection Date', date || '-'],
    ['Site', site || '-'],
    ['Inspector', inspector || '-'],
    odometer ? ['Odometer (km)', odometer] : null,
    hourMeter ? ['Hour Meter (hrs)', hourMeter] : null,
  ].filter(Boolean)

  const tableRows = rows.map(([k, v]) => `
    <tr>
      <td style="padding:8px 12px;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;">${k}</td>
      <td style="padding:8px 12px;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #f3f4f6;">${v}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#15803d 0%,#166534 100%);padding:28px 32px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;background:rgba(255,255,255,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:20px;">🔍</span>
        </div>
        <div>
          <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">Tyre Pulse</h1>
          <p style="margin:0;color:#bbf7d0;font-size:13px;">Inspection Approval Request</p>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="margin:0 0 8px;color:#374151;font-size:15px;font-weight:600;">Your approval is required</p>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
        An inspection checklist has been submitted and requires your review and digital signature before it can be finalised.
      </p>

      <!-- Details table -->
      <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:24px;">
        <div style="background:#f9fafb;padding:10px 12px;border-bottom:1px solid #e5e7eb;">
          <span style="font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;">Inspection Details</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">${tableRows}</table>
      </div>

      ${notes ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#166534;">Inspector Notes</p>
        <p style="margin:0;font-size:13px;color:#374151;">${notes}</p>
      </div>` : ''}

      <!-- Inspector Signature -->
      <div style="margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;">Inspector Signature</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
          ${sigBlock}
        </div>
      </div>

      <!-- CTA -->
      <a href="${approvalLink}"
        style="display:block;text-align:center;background:#15803d;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:700;margin-bottom:16px;">
        Review &amp; Sign Inspection →
      </a>

      <p style="margin:0;text-align:center;color:#9ca3af;font-size:12px;">
        This link requires you to be logged in to Tyre Pulse.<br>
        If the button doesn't work, copy this URL: <span style="color:#15803d;word-break:break-all;">${approvalLink}</span>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">Tyre Pulse Fleet Intelligence · This is an automated message</p>
    </div>
  </div>
</body>
</html>`
}

export default function Inspections() {
  const { profile, loading: authLoading } = useAuth()
  const { activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const { t } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const isTyreMan = profile?.role === 'Tyre Man'
  const isAdmin = (profile?.role || '').toLowerCase() === 'admin'
  const [rows, setRows]         = useState([])
  // Multi-select bulk delete (Admin only)
  const [selectedIds, setSelectedIds]     = useState(() => new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [summaryOpen, setSummaryOpen]     = useState(false)
  const [bulkError, setBulkError]         = useState('')
  const [bulkBusy, setBulkBusy]           = useState(false)
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(null)
  // Approval-engine lock for the record open in the edit modal. Set from
  // <EntityApprovalPanel/> onStateChange; while true the record is mid-approval
  // (pending/in_review/returned) or approved, so edits/saves are blocked.
  const [wfLocked, setWfLocked] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState(null)
  // The register's filters live in the URL (useFilterState) so they SURVIVE
  // drilling out to the tyre-change tracking page and pressing Back, and so a
  // filtered view can be shared. The keys are deliberately distinct from the
  // page's existing deep-link params (`asset`, `approve`), which useFilterState
  // leaves untouched.
  const [filters, setFilter, , , setFilters] = useFilterState({
    search: '', status: 'all', site: 'all', region: 'all', inspector: 'all',
    from: '', to: '',
  })
  const filterStatus = filters.status
  const filterSite = filters.site
  // Region is not a column on an inspection - it is read from the site
  // register, so it stays recorded in one place. See siteRegionMap.
  const filterRegion = filters.region
  const filterInspector = filters.inspector
  const [siteRows, setSiteRows]         = useState([])
  // The advanced filters collapse behind one toggle, the same as the accident
  // register: a row of eight controls above a table is read as clutter, and the
  // two people use every day (search and status) stay out here. It opens on
  // arrival when a restored URL already carries one of the collapsed filters -
  // a filter that is applied but hidden reads as a wrong result, not a filter.
  const [showFilters, setShowFilters]   = useState(
    () => filters.site !== 'all' || filters.region !== 'all'
      || filters.inspector !== 'all' || !!filters.from || !!filters.to,
  )
  // Client-side date range on the register (scheduled_date, falling back to
  // completed_date, then created_at). Empty = existing behavior.
  const filterFrom = filters.from
  const filterTo = filters.to
  // Tyre-change flags: per-asset overdue/due-soon tyres from the running-life
  // calc. null = not loaded (still checking, or the read failed).
  const [flagMap, setFlagMap]           = useState(null)
  /**
   * THREE OUTCOMES THAT MUST NEVER LOOK ALIKE: we are still checking, we could
   * not look, and we looked and no tyre is due. The card used to render one
   * line ("Tyre life data unavailable") for the first two and could not say the
   * third at all, so a clean fleet and a broken read were the same screen.
   */
  const [flagStatus, setFlagStatus]     = useState('loading') // loading | ok | error
  const [flagError, setFlagError]       = useState('')
  const [flagReload, setFlagReload]     = useState(0)
  const search = filters.search
  const [deleteId, setDeleteId]         = useState(null)
  const [activeTab, setActiveTab]       = useState('all')
  // Lock TyreMan to checklist tab; switch to checklist if asset param present
  useEffect(() => {
    if (isTyreMan || searchParams.get('asset')) setActiveTab('checklist')
  }, [isTyreMan, searchParams])

  // Approver landing: ?approve=<inspection_id>
  useEffect(() => {
    const approveId = searchParams.get('approve')
    if (!approveId || authLoading) return
    inspectionsApi.getInspectionForPage(approveId)
      .then(data => {
        if (data) { setApproveTarget(data); setShowApproveModal(true) }
      })
      .catch(() => { /* silent - invalid/inaccessible approve link */ })
  }, [searchParams, authLoading])
  // Drops only the consumed approve key, leaving the register's own filter
  // params in place.
  const clearApproveParam = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('approve')
      return next
    }, { replace: true })
  }, [setSearchParams])
  const [raisingAction, setRaisingAction] = useState(null)
  const [selectedTyre, setSelectedTyre]   = useState(null)
  const fileRef = useRef(null)

  // Language toggle for checklist tab
  const [lang, setLang] = useState('en')

  // Checklist tab state
  const [clAsset, setClAsset]         = useState('')
  const [clSite, setClSite]           = useState('')
  const [clDate, setClDate]           = useState(new Date().toISOString().split('T')[0])
  const [clInspector, setClInspector] = useState('')
  const [clFleetInfo, setClFleetInfo] = useState(null)
  const [clPositions, setClPositions] = useState([])
  const [clNotes, setClNotes]         = useState('')
  const [clSaving, setClSaving]       = useState(false)
  const [clSaved, setClSaved]         = useState(null)
  const [clError, setClError]         = useState(null)
  const [clLookingUp, setClLookingUp] = useState(false)
  const [clOffline, setClOffline]     = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  // Hour meter + odometer
  const [clOdometer, setClOdometer]   = useState('')
  const [clHourMeter, setClHourMeter] = useState('')
  // Multi-photo
  const [clPhotos, setClPhotos]       = useState([]) // array of base64 strings
  const cameraInputRef                = useRef(null)
  const galleryInputRef               = useRef(null)
  // Signature
  const [clSignature, setClSignature]         = useState(null) // base64 PNG
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  // Approval workflow
  const [clApprovalStatus, setClApprovalStatus] = useState('done') // 'done' | 'pending_approval' | 'approved'
  const [clApproverEmail, setClApproverEmail]   = useState('')
  const [showApprovalForm, setShowApprovalForm] = useState(false)
  const [clSendingEmail, setClSendingEmail]     = useState(false)
  const [clEmailSent, setClEmailSent]           = useState(false)
  // Approver landing modal (when manager opens ?approve=<id> link)
  const [approveTarget, setApproveTarget]       = useState(null)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [approverSig, setApproverSig]           = useState(null)
  const [showApproverPad, setShowApproverPad]   = useState(false)
  const [approveSubmitting, setApproveSubmitting] = useState(false)
  const [approveMsg, setApproveMsg]             = useState(null)
  // Mobile PDF preview
  const [pdfBlobUrl, setPdfBlobUrl]   = useState(null)
  const [showPdfPreview, setShowPdfPreview] = useState(false)
  const diagramRef     = useRef(null)
  // Offscreen copy of the SAME diagram, always mounted once a checklist is saved,
  // so the PDF report can capture it even though the on-screen form (and its
  // diagram) is replaced by the saved-confirmation view.
  const checklistPdfDiagramRef = useRef(null)
  const [clSelectedPos, setClSelectedPos] = useState(null)
  // Row PDF export: render the live diagram offscreen, then capture its SVG.
  const [pdfRow, setPdfRow] = useState(null)
  const pdfDiagramRef = useRef(null)
  // Read a record in place. Holds an id, not a row: the drawer loads the full
  // record (signatures included, which the register list no longer carries).
  const [viewId, setViewId] = useState(null)
  const [pdfBusyId, setPdfBusyId] = useState(null)

  /**
   * Export one inspection's report.
   *
   * Takes the id, not the list row, because the register list deliberately
   * omits the signature columns and this report prints both signatures. Fetching
   * the one row here is what keeps them off the list read.
   */
  const exportRowPdf = useCallback(async (rowOrId) => {
    const id = typeof rowOrId === 'string' ? rowOrId : rowOrId?.id
    if (!id || pdfBusyId) return
    setPdfBusyId(id)
    try {
      const full = await inspectionsApi.getInspectionForPage(id)
      setPdfRow(full || (typeof rowOrId === 'object' ? rowOrId : null))
    } catch {
      // Fall back to the list row: a report without the signature block beats
      // a button that silently does nothing.
      setPdfRow(typeof rowOrId === 'object' ? rowOrId : null)
    }
  }, [pdfBusyId])

  useEffect(() => {
    if (!pdfRow) return
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        // Photos captured during the inspection: per-position tp-storage refs
        // (mobile) + the row-level photo, resolved to signed URLs. Best-effort -
        // an unresolvable photo is skipped, never a blocked report.
        const photoRefs = []
        // The SAME labels the on-screen photo grid prints (positionLabelMap),
        // so the downloaded copy and the record on screen cannot name one wheel
        // two different ways.
        const pdfPosLabels = positionLabelMap(pdfRow)
        for (const [pos, d] of Object.entries(pdfRow.tyre_conditions || {})) {
          const ref = d && typeof d === 'object' ? (d.photo_url || d.photo_uri) : null
          if (ref) photoRefs.push({ label: pdfPosLabels[pos] || pos, ref })
        }
        if (pdfRow.photo_data) photoRefs.push({ label: 'Inspection photo', ref: pdfRow.photo_data })
        const photos = (await Promise.all(photoRefs.map(async (p) => {
          try { const url = await resolveStorageUrl(p.ref); return url ? { label: p.label, url } : null }
          catch { return null }
        }))).filter(Boolean)

        // Expected life for this asset's fitted tyres (best-effort). Asked for
        // BY ASSET (V526) - this used to pull all 3,595 rows / 2.2 MB on every
        // single row export just to filter down to that asset's dozen.
        // With no asset on the record there is nothing to look up, so we do not
        // ask (an empty asset would read as "no filter" and pull the fleet).
        let lifeRows = []
        if (pdfRow.asset_no) {
          try {
            const payload = await getTyreRunningLife({
              country: pdfRow.country, maxAgeMs: RUNNING_LIFE_TTL_MS, asset: pdfRow.asset_no,
            })
            lifeRows = shapeRunningLife(payload).rows
          } catch { lifeRows = [] }
        }

        // The ACTUAL app diagram (colored per condition + PSI marked), rendered
        // offscreen below - captured so the report embeds the same SVG the
        // operator sees. Falls back to the programmatic map when absent.
        const svgEl = pdfDiagramRef.current?.querySelector('svg[data-tyre-map]') || null
        const diagramBg = (await getDiagramBg().catch(() => '')) || '#000000'
        await exportInspectionDetailPdf(pdfRow, { branding: await brandingForPdf(branding), company, photos, lifeRows, svgEl, diagramBg })
      } finally { if (!cancelled) { setPdfRow(null); setPdfBusyId(null) } }
    }, 80)
    return () => { cancelled = true; clearTimeout(t) }
  }, [pdfRow])

  // Virtual scroll ref for the inspections table
  const tableParentRef = useRef(null)

  // PWA - Screen Wake Lock during inspection
  const { acquire: acquireWakeLock, release: releaseWakeLock } = useWakeLock()

  // Acquire wake lock when checklist tab is active with positions loaded
  useEffect(() => {
    if (activeTab === 'checklist' && clPositions.length > 0) {
      acquireWakeLock()
    } else {
      releaseWakeLock()
    }
    return () => releaseWakeLock()
  }, [activeTab, clPositions.length, acquireWakeLock, releaseWakeLock])

  // Sync offline queue when tab becomes active
  useEffect(() => {
    if (activeTab !== 'checklist') return
    async function syncAndCount() {
      if (navigator.onLine) await syncPendingInspections(supabase)
      const count = await getPendingCount()
      setPendingCount(count)
    }
    syncAndCount()
  }, [activeTab])

  // Master data from fleet
  const [masterSites, setMasterSites]   = useState([])
  const [masterAssets, setMasterAssets] = useState([])

  // Country-scoped, and PAGED inside the service: the unpaged read stopped at
  // PostgREST's 1000-row cap while the fleet holds 1,617, so the tail of the
  // fleet was simply absent from this picker with nothing to say so.
  //
  // Fetched ONLY for the checklist tab, which is the only thing that uses it
  // (the asset datalist and the site select). It used to run on every mount of
  // the page, so opening the register pulled the whole fleet - 1,617 rows over
  // two paged round trips - to populate a picker that was not on screen.
  const fleetLoaded = useRef(null)
  useEffect(() => {
    if (activeTab !== 'checklist') return
    if (fleetLoaded.current === activeCountry) return
    fleetLoaded.current = activeCountry
    inspectionsApi.listInspectionVehicles({ country: activeCountry }).then(data => {
      if (!data) return
      setMasterSites([...new Set(data.map(r => r.site).filter(Boolean))].sort())
      setMasterAssets(data.filter(r => r.asset_no).sort((a, b) => a.asset_no.localeCompare(b.asset_no)))
    }).catch(() => { /* silent - master data best-effort */ })
  }, [activeCountry, activeTab])

  // Geolocation auto-site detection (best-effort) - declared after masterSites
  // so its dependency array is not evaluated before that state exists.
  const geoAttempted = useRef(false)
  useEffect(() => {
    if (activeTab !== 'checklist' || geoAttempted.current) return
    geoAttempted.current = true
    if (!navigator.geolocation || masterSites.length === 0) return
    navigator.geolocation.getCurrentPosition(
      () => { /* future: match to nearest site from geo coordinates */ },
      () => { /* permission denied - ignore */ },
      { timeout: 6000, maximumAge: 60000 }
    )
  }, [activeTab, masterSites])

  useEffect(() => {
    const name = profile?.full_name || profile?.username || ''
    if (name && !clInspector) setClInspector(name)
  }, [profile])

  // Deep-link: /inspections?asset=ASSET_NO - auto-load checklist for scanned vehicle QR
  useEffect(() => {
    const assetParam = searchParams.get('asset')
    if (!assetParam || authLoading) return
    setClAsset(assetParam)
    loadFleetInfo(assetParam)
    // Remove the consumed param so a refresh does not re-trigger. Only that one
    // key is dropped: the register's filters now live in the query string too,
    // and clearing the whole string would wipe them.
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('asset')
      return next
    }, { replace: true })
  }, [searchParams, authLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    // Paginate past the 1000-row cap so the list AND its exports are complete.
    const { data } = await fetchAllPages((from, to) =>
      inspectionsApi.listInspectionsForPage({
        from,
        to,
        country: activeCountry,
        createdBy: profile?.role === 'Tyre Man' && profile?.id ? profile.id : undefined,
      }), { max: 100000 })
    const today = new Date().toISOString().split('T')[0]
    const enriched = (data || []).map(r => ({
      ...r,
      // Restore the display type (observation/training) stored alongside the
      // CHECK-valid inspection_type. Legacy rows fall back to inspection_type.
      inspection_type: resolveRecordType(r),
      status: r.status !== 'Done' && r.status !== 'Cancelled' && r.scheduled_date < today
        ? 'Overdue' : r.status,
    }))
    setRows(enriched)
    setLoading(false)
  }

  // Best-effort: the register must still open when the site list cannot be
  // read. With no sites the region control simply does not render, rather than
  // offering a filter that can never match anything.
  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    listSites({ country: activeCountry })
      .then((r) => { if (!cancelled) setSiteRows(Array.isArray(r) ? r : []) })
      .catch(() => { if (!cancelled) setSiteRows([]) })
    return () => { cancelled = true }
  }, [activeCountry, authLoading])

  useEffect(() => {
    if (authLoading) return
    load()
  }, [activeCountry, authLoading, isTyreMan])

  // Best-effort running-life fetch (never blocks the page): builds the
  // per-asset tyre-due flag map used by the slides, row chips and banners.
  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    // dueOnly: the flag map KEEPS ONLY overdue/due-soon rows, so asking for the
    // whole set and throwing the rest away was a 7.7x over-fetch on every page
    // load (KSA: 465 rows kept of 3,595 pulled, 285 kB instead of 2.2 MB).
    setFlagStatus('loading'); setFlagError('')
    getTyreRunningLife({ country: activeCountry, maxAgeMs: RUNNING_LIFE_TTL_MS, dueOnly: true }).then((payload) => {
      if (cancelled) return
      const shaped = shapeRunningLife(payload)
      if (!shaped.ok) {
        setFlagMap(null)
        setFlagStatus('error')
        setFlagError(payload?.reason || '')
        return
      }
      // An empty map here is a MEASUREMENT, not a gap: we asked the server for
      // every due tyre and it returned none.
      setFlagMap(buildAssetFlagMap(shaped.rows))
      setFlagStatus('ok')
    }).catch((e) => {
      if (cancelled) return
      setFlagMap(null); setFlagStatus('error'); setFlagError(toUserMessage(e))
    })
    return () => { cancelled = true }
  }, [activeCountry, authLoading, flagReload])

  const sites = useMemo(() => [...new Set(rows.map(r => r.site).filter(Boolean))].sort(), [rows])
  const regionMap = useMemo(() => siteRegionMap(siteRows), [siteRows])
  // Only the regions the sites ON SCREEN actually belong to. Listing every
  // region in the register would offer choices that return nothing.
  const regions = useMemo(() => regionsIn(regionMap, sites), [regionMap, sites])
  const inspectors = useMemo(
    () => [...new Set(rows.map(r => r.inspector).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const tabFiltered = useMemo(() => {
    if (activeTab === 'inspections') return rows.filter(r => INSPECTION_TYPES.includes(r.inspection_type))
    if (activeTab === 'observations') return rows.filter(r => isObservationType(r.inspection_type))
    if (activeTab === 'training')     return rows.filter(r => isTrainingType(r.inspection_type))
    return rows
  }, [rows, activeTab])

  const filtered = useMemo(() => {
    let r = tabFiltered
    if (filterStatus !== 'all') r = r.filter(x => x.status === filterStatus)
    if (filterSite !== 'all')   r = r.filter(x => x.site === filterSite)
    // A site the register does not place in a region is EXCLUDED while a region
    // is selected, rather than quietly falling into whichever region is chosen.
    if (filterRegion !== 'all') r = r.filter(x => regionForSite(regionMap, x.site) === filterRegion)
    if (filterInspector !== 'all') r = r.filter(x => x.inspector === filterInspector)
    if (filterFrom || filterTo) {
      // String-safe 'YYYY-MM-DD' prefix comparison (never new Date(string)).
      // A row with no usable date is excluded while a range is active.
      r = r.filter(x => {
        const raw = x.scheduled_date || x.completed_date || x.created_at
        const d = raw ? String(raw).slice(0, 10) : ''
        if (!d) return false
        if (filterFrom && d < filterFrom) return false
        if (filterTo && d > filterTo) return false
        return true
      })
    }
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x =>
        x.title?.toLowerCase().includes(q) ||
        x.site?.toLowerCase().includes(q) ||
        x.asset_no?.toLowerCase().includes(q) ||
        x.tyre_serial?.toLowerCase().includes(q) ||
        x.inspector?.toLowerCase().includes(q) ||
        x.attendees?.toLowerCase().includes(q)
      )
    }
    return r
  }, [tabFiltered, filterStatus, filterSite, filterRegion, filterInspector, regionMap, filterFrom, filterTo, search])

  // Vehicles with tyres due ACROSS THE COUNTRY (the flag map is not limited to
  // the inspections on screen). Lets the card tell "nothing is due anywhere"
  // apart from "nothing is due on the vehicles you are looking at".
  const dueAssetCount = useMemo(() => (flagMap ? Object.keys(flagMap).length : 0), [flagMap])

  // Slide numbers: follow the same date window as the list (from/to only).
  const overview = useMemo(
    () => inspectionOverview(tabFiltered, flagMap || {}, { from: filterFrom, to: filterTo }),
    [tabFiltered, flagMap, filterFrom, filterTo]
  )

  const counts = useMemo(() => {
    const c = { all: rows.length, inspections: 0, observations: 0, training: 0 }
    rows.forEach(r => {
      if (INSPECTION_TYPES.includes(r.inspection_type)) c.inspections++
      else if (isObservationType(r.inspection_type)) c.observations++
      else if (isTrainingType(r.inspection_type)) c.training++
    })
    return c
  }, [rows])

  const statusCounts = useMemo(() => {
    const c = { all: filtered.length, Scheduled: 0, 'In Progress': 0, Done: 0, Overdue: 0, Cancelled: 0 }
    filtered.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    return c
  }, [filtered])

  // Virtualizer for the inspections table
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => tableParentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  })

  // Puts the register back where it was scrolled to when the user returns from
  // the tyre-change tracking page. The list scrolls inside its own fixed-height
  // box, so that element is restored rather than the shell around it.
  useScrollRestore('inspections', !loading && filtered.length > 0, tableParentRef)

  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setForm(f => ({ ...f, photo_data: ev.target.result }))
    reader.readAsDataURL(file)
  }

  // Reset the approval lock whenever a different record is opened in the modal;
  // <EntityApprovalPanel/> re-reports the true state via onStateChange on mount.
  useEffect(() => { setWfLocked(false) }, [form?.id])

  async function save() {
    if (wfLocked) return
    if (!form.title?.trim()) return
    if (!form.site?.trim()) return
    if (!form.scheduled_date) return
    setSaving(true)
    setSaveError(null)
    const displayType = form.inspection_type
    // Send ONLY real, writable columns. Spreading the whole `form` used to leak
    // read-only / generated columns from a loaded edit row into the insert or
    // update, which failed with a raw "column not compatible" database error.
    const WRITABLE_COLS = [
      'title', 'inspection_type', 'site', 'asset_no', 'tyre_serial', 'scheduled_date',
      'completed_date', 'inspection_date', 'status', 'findings', 'inspector', 'notes',
      'attendees', 'severity', 'photo_data', 'vehicle_type', 'tyre_conditions',
      'odometer_km', 'hour_meter', 'pressure_reading', 'approval_status', 'region',
    ]
    const base = {}
    for (const k of WRITABLE_COLS) if (form[k] !== undefined) base[k] = form[k]
    const payload = {
      ...base,
      created_by: profile?.id ?? null,
      // Persist a CHECK-valid inspection_type; carry the true display type
      // (observation/training) in custom_data so it round-trips on read.
      inspection_type: dbInspectionType(displayType),
      custom_data: { ...(form.custom_data || {}), record_type: displayType },
    }

    try {
      if (form.id) {
        await inspectionsApi.patchInspection(form.id, payload)
      } else {
        await inspectionsApi.insertInspection(payload)
      }
      setForm(null)
      await load()
    } catch (error) {
      setSaveError(toUserMessage(error, 'Could not save the inspection. Please check the required fields and try again.'))
    }
    setSaving(false)
  }

  async function markDone(id) {
    try {
      await inspectionsApi.patchInspection(id, {
        status: 'Done',
        completed_date: new Date().toISOString().split('T')[0],
      })
    } catch { /* mirror prior fire-and-forget: proceed to reload regardless */ }
    await load()
  }

  async function confirmDelete() {
    try {
      await inspectionsApi.deleteInspection(deleteId)
    } catch { /* mirror prior fire-and-forget: proceed to reload regardless */ }
    setDeleteId(null)
    await load()
  }

  // ── Multi-select bulk delete (Admin only) ─────────────────────────────────────
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const pageIds = filtered.map(r => r.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id))
  function toggleSelectPage() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allPageSelected) pageIds.forEach(id => next.delete(id))
      else pageIds.forEach(id => next.add(id))
      return next
    })
  }

  async function confirmBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkBusy(true)
    setBulkError('')
    try {
      const ids = [...selectedIds]
      let deleted = 0
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const { data, error } = await supabase
          .from('inspections').delete().in('id', chunk).select('id')
        if (error) throw error
        deleted += data?.length ?? 0
      }
      if (deleted === 0) {
        throw new Error('No rows were deleted. You may not have permission (Admin only) or they were already removed.')
      }
      setBulkDeleteOpen(false)
      setSelectedIds(new Set())
      await load()
    } catch (e) {
      setBulkError(toUserMessage(e, 'Bulk delete failed. Please try again.'))
    } finally {
      setBulkBusy(false)
    }
  }

  async function raiseAction(row, actionTitle) {
    try {
      const data = await correctiveActions.createCorrectiveAction({
        title: actionTitle || `Action from: ${row.title}`,
        description: row.findings || row.notes || '',
        site: row.site,
        asset_no: row.asset_no || null,
        priority: row.severity === 'Critical' ? 'Critical' : row.severity === 'High' ? 'High' : 'Medium',
        status: 'Open',
        // NOTE: corrective_actions has no `source` column — sending it 400s the insert.
        created_by: profile?.id ?? null,
      })
      if (data?.id) {
        await inspectionsApi.patchInspection(row.id, { linked_action_id: data.id })
        await load()
      }
    } catch { /* mirror prior guard: on failure, no link + no reload */ }
    setRaisingAction(null)
  }

  async function loadFleetInfo(assetNo) {
    if (!assetNo.trim()) return
    setClLookingUp(true)
    // Country-scoped: the same asset code in another country is a different
    // machine (V376), so its type and site must not seed this inspection.
    const data = await inspectionsApi.findVehicleByAsset(assetNo.trim(), activeCountry).catch(() => null)
    // Use DB vehicle_type if available, otherwise infer from asset number prefix
    const vehicleType = data?.vehicle_type || inferVehicleTypeFromAsset(assetNo)
    const fleetInfo = data || (vehicleType ? { asset_no: assetNo.trim(), vehicle_type: vehicleType, site: null } : null)
    if (fleetInfo) {
      setClFleetInfo(fleetInfo)
      const vtKey = normVT(vehicleType)
      const positions = TYRE_POSITIONS[vtKey] || DEFAULT_POSITIONS
      setClPositions(positions.map(pos => ({ position: pos, label: legacyPositionCode(vtKey, pos), pressure: '', condition: 'Good', treadDepth: '' })))
      if (fleetInfo.site && !clSite) setClSite(fleetInfo.site)
    } else {
      setClFleetInfo(null)
      setClPositions(DEFAULT_POSITIONS.map(pos => ({ position: pos, label: legacyPositionCode('', pos), pressure: '', condition: 'Good', treadDepth: '' })))
    }
    setClLookingUp(false)
  }

  async function saveChecklist() {
    if (!clAsset.trim() || clPositions.length === 0) return
    setClSaving(true)
    setClError(null)
    setClOffline(false)
    const payload = {
      title: `Daily Tyre Inspection: ${clSite || clAsset}, ${clDate}`,
      inspection_type: 'Routine',
      site: clSite,
      asset_no: clAsset.trim(),
      scheduled_date: clDate,
      status: clApprovalStatus === 'pending_approval' ? 'In Progress' : 'Done',
      completed_date: clDate,
      inspector: clInspector,
      tyre_conditions: clPositions,
      vehicle_type: clFleetInfo?.vehicle_type || (clPositions.length > 0 ? 'Pickup' : null),
      findings: clNotes || null,
      notes: clNotes,
      country: activeCountry !== 'All' ? activeCountry : null,
      created_by: profile?.id ?? null,
      // Extended fields
      odometer_km: clOdometer ? parseFloat(clOdometer) : null,
      hour_meter: clHourMeter ? parseFloat(clHourMeter) : null,
      photo_data: clPhotos.length > 0 ? clPhotos[0] : null, // primary photo (DB compat)
      inspector_signature: clSignature || null,
      approval_status: clApprovalStatus,
      approver_email: clApproverEmail || null,
    }

    // Vibrate on save attempt (success signal pattern)
    vibrate([50, 30, 50])

    try {
      const data = await inspectionsApi.insertInspectionReturning(payload)
      setClSaved(data)
      vibrate([80, 30, 80, 30, 200])
      await load()
    } catch (error) {
      if (!navigator.onLine || error?.message?.includes('fetch')) {
        // Offline - enqueue for later sync
        try {
          await enqueueInspection(payload)
          setClOffline(true)
          setClSaved({ ...payload, id: `offline-${Date.now()}`, asset_no: payload.asset_no, scheduled_date: payload.scheduled_date })
          const count = await getPendingCount()
          setPendingCount(count)
          vibrate([100, 50, 100, 50, 200])
        } catch {
          setClError('Failed to queue offline. Please try again.')
        }
      } else {
        setClError(toUserMessage(error, 'Save failed. Please try again.'))
        vibrate(300)
      }
    }
    setClSaving(false)
  }

  async function exportChecklistPdf(preview = false) {
    if (!clSaved) return
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const tyreData = clPositions.length > 0 ? clPositions
      : (clSaved.tyre_conditions || (() => { try { return JSON.parse(clSaved.findings || '[]') } catch { return [] } })())

    const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pw     = doc.internal.pageSize.width
    const ph     = doc.internal.pageSize.height
    const mx     = 14

    // ── Branded header ─────────────────────────────────────────────────────────
    const brand = await resolvePdfBrand(await brandingForPdf(branding))
    pdfHeader(doc, 'Daily Tyre Inspection Report', `Asset: ${clAsset || clSaved.asset_no || 'N/A'}`, company, brand)

    // ── Empty state: checklist has no tyre positions ──
    if (!tyreData.length) {
      pdfEmptyState(doc, 'No tyre positions recorded for this checklist')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(`TyrePulse_Checklist_${clAsset || clSaved.asset_no || 'report'}.pdf`)
      return
    }

    // ── Asset info grid ─────────────────────────────────────────────────────────
    let y = 28
    const infoItems = [
      ['Asset No',       clAsset || clSaved.asset_no || 'N/A'],
      ['Vehicle Type',   clFleetInfo?.vehicle_type || clSaved.vehicle_type || 'N/A'],
      ['Site',           clSite || clSaved.site || 'N/A'],
      ['Inspector',      clInspector || clSaved.inspector || 'N/A'],
      ['Date',           clDate || clSaved.scheduled_date || 'N/A'],
      ['Tyre Count',     String(tyreData.length)],
      ['Odometer (km)',  clOdometer || clSaved.odometer_km || 'N/A'],
      ['Hour Meter',     clHourMeter || clSaved.hour_meter || 'N/A'],
    ]
    const colW = (pw - mx * 2) / 3
    infoItems.forEach(([label, value], i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      const ix  = mx + col * colW
      const iy  = y + row * 12
      doc.setFontSize(7)
      doc.setTextColor(107, 114, 128)
      doc.setFont('helvetica', 'normal')
      doc.text(label, ix, iy)
      doc.setFontSize(9)
      doc.setTextColor(31, 41, 55)
      doc.setFont('helvetica', 'bold')
      doc.text(String(value), ix, iy + 5)
    })
    const infoRows = Math.ceil(infoItems.length / 3)
    y += infoRows * 12 + 6

    // ── Inspection summary strip - computed from data already loaded, honest
    // N/A when nothing recorded. Muted corporate tones (small dots + dark text,
    // no large colored fills).
    const MUTED = { Good: [22, 101, 52], Wear: [146, 64, 14], Damage: [153, 27, 27], 'No data': [100, 116, 139] }
    const condCounts = { Good: 0, Wear: 0, Damage: 0, 'No data': 0 }
    const recPressures = []
    const recTreads = []
    let lowTread = null
    tyreData.forEach((r) => {
      // Banded through riskForCondition, not by exact word: the field app
      // writes Worn / Flat / Damaged, and an exact-match bucket filed every one
      // of them as "No data" on a report someone signs.
      const band = riskForCondition(r.condition)
      const c = band === 'good' ? 'Good' : band === 'warning' ? 'Wear' : band === 'critical' ? 'Damage' : 'No data'
      condCounts[c] += 1
      const p = Number(r.pressure)
      if (Number.isFinite(p) && p > 0) recPressures.push(p)
      const td = Number(r.treadDepth)
      if (Number.isFinite(td) && td > 0) {
        recTreads.push(td)
        if (!lowTread || td < lowTread.value) lowTread = { pos: r.position || 'N/A', value: td }
      }
    })
    const avgOf = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
    const medianOf = (a) => {
      if (!a.length) return null
      const s = [...a].sort((x, y2) => x - y2)
      const m = Math.floor(s.length / 2)
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    const avgPsi = avgOf(recPressures)
    const avgTread = avgOf(recTreads)
    const medianPsi = medianOf(recPressures)
    const one = (v) => Math.round(v * 10) / 10
    {
      const stripW = pw - mx * 2
      const stripH = 15
      doc.setFillColor(248, 250, 252)
      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.3)
      doc.roundedRect(mx, y, stripW, stripH, 1.5, 1.5, 'FD')
      doc.setFillColor(...brand.accent)
      doc.roundedRect(mx, y, 1.4, stripH, 0.7, 0.7, 'F')
      doc.setFontSize(6.3)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(100, 116, 139)
      doc.text('INSPECTION SUMMARY', mx + 5, y + 4.4, { charSpace: 0.4 })
      // Line 1 - counts with small muted dots
      let cx = mx + 5
      const l1y = y + 8.6
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(8, 12, 28)
      doc.text(`Positions checked: ${tyreData.length}`, cx, l1y)
      cx += doc.getTextWidth(`Positions checked: ${tyreData.length}`) + 7
      doc.setFont('helvetica', 'normal')
      ;['Good', 'Wear', 'Damage', 'No data'].forEach((label) => {
        const txt = `${label} ${condCounts[label]}`
        doc.setFillColor(...MUTED[label])
        doc.circle(cx + 1.2, l1y - 1.1, 1.1, 'F')
        doc.setTextColor(8, 12, 28)
        doc.text(txt, cx + 3.4, l1y)
        cx += doc.getTextWidth(txt) + 10
      })
      // Line 2 - recorded-only averages
      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(51, 65, 85)
      doc.text([
        `Avg pressure: ${avgPsi != null ? `${one(avgPsi)} PSI` : 'N/A'}`,
        `Avg tread: ${avgTread != null ? `${one(avgTread)} mm` : 'N/A'}`,
        `Lowest tread: ${lowTread ? `${lowTread.pos} (${one(lowTread.value)} mm)` : 'N/A'}`,
      ].join('   |   '), mx + 5, y + 13)
      y += stripH + 5
    }

    // ── Vehicle diagram - capture the SAME diagram rendered in the DOM. In the
    // saved view the on-screen form diagram is unmounted, so fall back to the
    // always-mounted offscreen copy so the report is never missing the diagram.
    const svgEl = diagramRef.current?.querySelector('svg[data-tyre-map]')
      || checklistPdfDiagramRef.current?.querySelector('svg[data-tyre-map]')
    const diagramBg = (await getDiagramBg().catch(() => '')) || '#000000'
    if (svgEl) {
      try {
        const svgStr  = new XMLSerializer().serializeToString(svgEl)
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
        const url     = URL.createObjectURL(svgBlob)
        await new Promise((resolve) => {
          const img    = new Image()
          img.onload   = () => {
            const scale   = 2
            const canvas  = document.createElement('canvas')
            const svgW    = svgEl.viewBox?.baseVal?.width  || svgEl.clientWidth  || 400
            const svgH    = svgEl.viewBox?.baseVal?.height || svgEl.clientHeight || 300
            canvas.width  = svgW * scale
            canvas.height = svgH * scale
            const ctx = canvas.getContext('2d')
            ctx.scale(scale, scale)
            ctx.fillStyle = diagramBg
            ctx.fillRect(0, 0, svgW, svgH)
            ctx.drawImage(img, 0, 0, svgW, svgH)
            URL.revokeObjectURL(url)
            const imgData = canvas.toDataURL('image/png')
            const diagW   = pw - mx * 2
            const diagH   = diagW * svgH / svgW
            doc.addImage(imgData, 'PNG', mx, y, diagW, diagH)
            y += diagH + 6
            resolve()
          }
          img.onerror = () => { URL.revokeObjectURL(url); resolve() }
          img.src = url
        })
      } catch (_) { /* fall through to table if SVG capture fails */ }
    }

    // Colour legend - muted corporate tones, small dots + plain dark text
    const legendY = y
    const legendItems = [
      { color: MUTED.Good,      label: 'Good'    },
      { color: MUTED.Wear,      label: 'Wear'    },
      { color: MUTED.Damage,    label: 'Damage'  },
      { color: MUTED['No data'], label: 'No data' },
    ]
    let lx = mx
    legendItems.forEach(({ color, label }) => {
      doc.setFillColor(...color)
      doc.circle(lx + 2, legendY, 1.4, 'F')
      doc.setTextColor(51, 65, 85)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(label, lx + 5, legendY + 1)
      lx += 26
    })

    y = legendY + 8

    // ── Tyre data table ─────────────────────────────────────────────────────────
    // Condition cell: plain white cell, small muted status dot + dark text
    // (no colored cell fills). When 4+ pressures are recorded, each row's
    // pressure is compared to the MEDIAN of recorded values and flagged
    // 'Check' at >15% off - the column is honestly labelled "vs median".
    const flagOn = recPressures.length >= 4 && medianPsi > 0
    const devLabel = (v) => {
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) return 'N/A'
      const dev = (n - medianPsi) / medianPsi
      if (Math.abs(dev) > 0.15) return `Check ${dev > 0 ? '+' : '-'}${Math.round(Math.abs(dev) * 100)}%`
      return 'OK'
    }
    const tblHead = ['Position', 'Pressure (PSI)', 'Condition', 'Tread Depth (mm)']
    if (flagOn) tblHead.push('Pressure vs median')
    const theme = pdfTableTheme(brand.accent)
    autoTable(doc, {
      ...theme,
      styles: { ...theme.styles, fontSize: 7, textColor: [8, 12, 28] },
      startY: y,
      head: [tblHead],
      body: tyreData.map(row => {
        const cells = [
          row.position || 'N/A',
          row.pressure ? `${row.pressure} PSI` : 'N/A',
          row.condition || 'N/A',
          row.treadDepth ? `${row.treadDepth} mm` : 'N/A',
        ]
        if (flagOn) cells.push(devLabel(row.pressure))
        return cells
      }),
      margin:      { left: mx, right: mx },
      didParseCell(data) {
        if (data.section !== 'body') return
        if (data.column.index === 2) {
          // room for the muted status dot; text stays plain dark ink
          data.cell.styles.cellPadding = { left: 6, right: 2.6, top: 2.6, bottom: 2.6 }
          data.cell.styles.textColor = [8, 12, 28]
        }
        if (flagOn && data.column.index === 4 && /^Check/.test(String(data.cell.raw))) {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.textColor = MUTED.Damage
        }
      },
      didDrawCell(data) {
        theme.didDrawCell?.(data)
        if (data.section !== 'body' || data.column.index !== 2) return
        const dot = MUTED[String(data.cell.raw)] || MUTED['No data']
        doc.setFillColor(...dot)
        doc.circle(data.cell.x + 3.2, data.cell.y + data.cell.height / 2, 1.1, 'F')
      },
    })

    // ── Notes ───────────────────────────────────────────────────────────────────
    let finalY = doc.lastAutoTable?.finalY ?? (y + 40)
    finalY += 8

    // ── Expected tyre life (lifecycle - km AND hours), best-effort ─────────────
    try {
      const assetNo = clAsset || clSaved.asset_no
      if (assetNo) {
        // Same per-asset read as the row export (V526): the server sends this
        // asset's tyres, not the whole country's for us to discard.
        const payload = await getTyreRunningLife({ country: activeCountry, asset: assetNo })
        const lifeRows = shapeRunningLife(payload).rows.slice(0, 16)
        if (lifeRows.length) {
          if (finalY + 30 > ph - 20) { doc.addPage(); finalY = 20 }
          doc.setTextColor(8, 12, 28)
          doc.setFontSize(10)
          doc.setFont('helvetica', 'bold')
          doc.text('Expected Tyre Life', mx, finalY)
          finalY += 3
          const n = (v) => (v == null ? 'N/A' : Math.round(v).toLocaleString('en-US'))
          const both = (km, hrs) => (km == null && hrs == null ? 'N/A'
            : [km != null ? `${n(km)} km` : null, hrs != null ? `${n(hrs)} hrs` : null].filter(Boolean).join(' / '))
          autoTable(doc, {
            ...pdfTableTheme(brand.accent),
            startY: finalY,
            margin: { left: mx, right: mx },
            head: [['Position', 'Serial', 'Brand', 'Km run', 'Hours run', 'Current km', 'Expected life', 'Remaining', 'Remaining days', 'Life used']],
            body: lifeRows.map((lr) => [
              lr.position || 'N/A',
              lr.serial || 'N/A',
              lr.brand || 'N/A',
              n(lr.kmRun),
              n(lr.hoursRun),
              n(lr.currentKm),
              both(lr.expectedLifeKm, lr.expectedLifeHours),
              both(lr.remainingKm, lr.remainingHours),
              n(lr.remainingDays),
              (measureFor(lr).used != null ? `${measureFor(lr).used}%` : 'N/A'),
            ]),
          })
          finalY = (doc.lastAutoTable?.finalY ?? finalY) + 8
        }
      }
    } catch { /* best-effort - the checklist report never blocks on lifecycle data */ }

    if (clNotes) {
      doc.setTextColor(8, 12, 28)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text('Notes', mx, finalY)
      finalY += 5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      const lines = doc.splitTextToSize(clNotes, pw - mx * 2)
      doc.text(lines, mx, finalY)
      finalY += lines.length * 4.5 + 6
    }

    // ── Photos (if any) ─────────────────────────────────────────────────────────
    const photos = clPhotos.length > 0 ? clPhotos : (clSaved.photo_data ? [clSaved.photo_data] : [])
    if (photos.length > 0) {
      if (finalY + 60 > ph - 20) { doc.addPage(); finalY = 20 }
      doc.setTextColor(8, 12, 28)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text('Photos', mx, finalY)
      finalY += 5
      const photoW = 40
      const photoH = 30
      const photoCols = Math.floor((pw - mx * 2) / (photoW + 4))
      for (let pi = 0; pi < Math.min(photos.length, 6); pi++) {
        const col = pi % photoCols
        const row = Math.floor(pi / photoCols)
        const px = mx + col * (photoW + 4)
        const py = finalY + row * (photoH + 4)
        try {
          doc.addImage(photos[pi], 'JPEG', px, py, photoW, photoH)
          doc.setDrawColor(209, 213, 219)
          doc.setLineWidth(0.3)
          doc.rect(px, py, photoW, photoH)
        } catch { /* skip bad image */ }
      }
      const photoRows = Math.ceil(Math.min(photos.length, 6) / photoCols)
      finalY += photoRows * (photoH + 4) + 6
    }

    // ── Signature section ───────────────────────────────────────────────────────
    const sigH = 24
    const sigW = 70
    if (finalY + sigH + 20 > ph - 15) { doc.addPage(); finalY = 20 }
    finalY += 4
    doc.setTextColor(8, 12, 28)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Signatures', mx, finalY)
    finalY += 5

    const sig = clSignature || clSaved.inspector_signature
    if (sig) {
      // Inspector signature image
      doc.setDrawColor(209, 213, 219)
      doc.setLineWidth(0.3)
      doc.rect(mx, finalY, sigW, sigH)
      try { doc.addImage(sig, 'PNG', mx, finalY, sigW, sigH) } catch { /* skip */ }
      doc.setFontSize(7)
      doc.setTextColor(107, 114, 128)
      doc.setFont('helvetica', 'normal')
      doc.text(`Inspector: ${clInspector || clSaved.inspector || ''}`, mx, finalY + sigH + 4)
      doc.text(formatDate(new Date()), mx + sigW - 1, finalY + sigH + 4, { align: 'right' })
    } else {
      // Blank line fallback
      doc.setDrawColor(156, 163, 175)
      doc.setLineWidth(0.5)
      doc.line(mx, finalY + sigH, mx + sigW, finalY + sigH)
      doc.setFontSize(7.5)
      doc.setTextColor(107, 114, 128)
      doc.setFont('helvetica', 'normal')
      doc.text('Inspector Signature', mx, finalY + sigH + 4)
    }

    // Approver signature box (blank pending)
    const approverX = mx + sigW + 15
    doc.setDrawColor(209, 213, 219)
    doc.setLineWidth(0.3)
    doc.rect(approverX, finalY, sigW, sigH)
    doc.setFontSize(8)
    doc.setTextColor(156, 163, 175)
    doc.text('Approver Signature', approverX + 2, finalY + 10)
    doc.setFontSize(7)
    doc.text(clApproverEmail ? `Sent to: ${clApproverEmail}` : 'Pending', approverX + 2, finalY + 16)
    doc.setFont('helvetica', 'normal')
    doc.text('Approved by / التوقيع', approverX, finalY + sigH + 4)

    finalY += sigH + 10

    // ── Branded footer on every page ────────────────────────────────────────────
    const totalPages = doc.internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      pdfFooter(doc, i, totalPages, company, brand)
    }

    if (preview) {
      const blob = doc.output('blob')
      const url = URL.createObjectURL(blob)
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(url)
      setShowPdfPreview(true)
    } else {
      doc.save(`TyrePulse_Checklist_${clAsset || clSaved.asset_no || 'report'}.pdf`)
    }
  }

  if (loading || authLoading) return <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">{t('common.loading')}</div>

  const tabConfig = [
    { key: 'all',          label: t('inspections.tabs.all'),          icon: null,            count: counts.all },
    { key: 'inspections',  label: t('inspections.tabs.inspections'),  icon: ClipboardList,   count: counts.inspections },
    { key: 'observations', label: t('inspections.tabs.observations'), icon: Eye,             count: counts.observations },
    { key: 'training',     label: t('inspections.tabs.training'),     icon: GraduationCap,   count: counts.training },
    { key: 'checklist',    label: t('inspections.tabs.checklist'),    icon: CheckSquare,     count: null },
  ]

  const defaultType = activeTab === 'observations' ? 'Site Observation'
    : activeTab === 'training' ? 'Safety Training'
    : 'Routine'

  // Shared grid style for virtual inspection rows
  const inspGridStyle = {
    display: 'grid',
    gridTemplateColumns: (isAdmin ? '44px ' : '') + INSP_COL_WIDTHS.map(w => `${w}px`).join(' '),
    alignItems: 'center',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isTyreMan ? t('inspections.titleTyreMan') : t('inspections.title')}
        subtitle={isTyreMan ? t('inspections.subtitleTyreMan') : t('inspections.subtitle')}
        icon={ClipboardList}
        actions={isTyreMan ? null : (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={async () => { try { await exportToExcel(
                filtered,
                ['inspection_type','title','site','asset_no','scheduled_date','status','severity','inspector','attendees','findings'],
                ['Type','Title','Site','Asset No','Date','Status','Severity','Inspector','Attendees','Findings'],
                'TyrePulse_Inspections'
              ) } catch (e) { setApproveMsg({ type: 'error', text: toUserMessage(e, 'Could not export. Try again.') }) } }}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <Download size={14}/> {t('inspections.actions.excel')}
            </button>
            <button
              onClick={async () => { try { await exportToPdf(
                filtered,
                [
                  {key:'inspection_type',header:'Type'},
                  {key:'title',header:'Title'},
                  {key:'site',header:'Site'},
                  {key:'asset_no',header:'Asset'},
                  {key:'scheduled_date',header:'Date'},
                  {key:'status',header:'Status'},
                  {key:'severity',header:'Severity'},
                  {key:'inspector',header:'Inspector'},
                ],
                'Inspections & Observations',
                'TyrePulse_Inspections',
                'landscape'
              ) } catch (e) { setApproveMsg({ type: 'error', text: toUserMessage(e, 'Could not export. Try again.') }) } }}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <FileText size={14}/> {t('inspections.actions.pdf')}
            </button>
            <button
              className="btn-primary text-sm"
              onClick={() => setForm({ ...EMPTY_FORM, inspection_type: defaultType })}
            >
              {t('inspections.actions.addRecord')}
            </button>
          </div>
        )}
      />

      {/* Tabs - hidden for TyreMan (locked to checklist) */}
      {!isTyreMan && <div className="flex gap-1 p-1 bg-[var(--surface-2)] rounded-lg w-fit flex-wrap">
        {tabConfig.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === key
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {label}
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${activeTab === key ? 'bg-green-500/20 text-green-400' : 'bg-[var(--surface-3)] text-[var(--text-muted)]'}`}>
              {count}
            </span>
          </button>
        ))}
      </div>}

      {/* Checklist tab content */}
      {activeTab === 'checklist' && (
        <div className="space-y-4">
          {clSaved ? (
            <div
              className="card"
              dir={lang === 'ar' ? 'rtl' : undefined}
              style={{ background: clOffline ? '#fffbeb' : undefined, borderColor: clOffline ? '#fde68a' : undefined }}
            >
              <div className="flex items-center gap-3 mb-4">
                {clOffline
                  ? <WifiOff size={20} style={{ color: '#d97706' }} />
                  : <CheckSquare size={20} className="text-green-400" />
                }
                <h3 className="text-lg font-semibold" style={{ color: clOffline ? '#92400e' : undefined }}>
                  {clOffline ? t('inspections.saved.savedOfflineTitle') : t('inspections.saved.savedTitle')}
                </h3>
              </div>
              {clOffline && (
                <p className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                  {t('inspections.saved.offlineNote')}
                </p>
              )}
              <p className="text-[var(--text-secondary)] text-sm mb-4">
                {t('inspections.saved.for')} <span className="text-[var(--text-primary)] font-mono">{clSaved.asset_no}</span> {t('inspections.saved.on')} {clSaved.scheduled_date}{clOffline ? ` ${t('inspections.saved.queuedSuffix')}` : ` ${t('inspections.saved.doneSuffix')}`}
              </p>
              {/* Summary badges */}
              <div className="flex flex-wrap gap-2 mb-2">
                {clPositions.filter(p => p.condition === 'Good').length > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-700/40">
                    {t('inspections.saved.badgeGood', { count: clPositions.filter(p => p.condition === 'Good').length })}
                  </span>
                )}
                {clPositions.filter(p => p.condition === 'Wear').length > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-yellow-900/30 text-yellow-400 border border-yellow-700/40">
                    {t('inspections.saved.badgeWear', { count: clPositions.filter(p => p.condition === 'Wear').length })}
                  </span>
                )}
                {clPositions.filter(p => p.condition === 'Damage' || p.condition === 'Puncture').length > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-red-900/30 text-red-400 border border-red-700/40">
                    {t('inspections.saved.badgeCritical', { count: clPositions.filter(p => p.condition === 'Damage' || p.condition === 'Puncture').length })}
                  </span>
                )}
                {clSignature && (
                  <span className="text-xs px-2 py-1 rounded-full bg-blue-900/30 text-blue-400 border border-blue-700/40">
                    {t('inspections.saved.badgeSigned')}
                  </span>
                )}
                {clPhotos.length > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-purple-900/30 text-purple-400 border border-purple-700/40">
                    {t('inspections.saved.badgePhotos', { count: clPhotos.length })}
                  </span>
                )}
              </div>

              {/* Immediate tyre-change flag for the just-inspected vehicle */}
              <TyreDueBanner
                entry={flagMap?.[clSaved.asset_no || clAsset]}
                damaged={damagedPositions({ tyre_conditions: clPositions })}
                inspection={{ ...clSaved, asset_no: clSaved.asset_no || clAsset, tyre_conditions: clPositions }}
              />

              <div className="flex gap-3 flex-wrap">
                {!clOffline && (
                  <button onClick={() => exportChecklistPdf(false)} className="btn-secondary flex items-center gap-2 text-sm">
                    <FileText size={14} /> {CHECKLIST_LABELS[lang].export}
                  </button>
                )}
                {!clOffline && (
                  <button onClick={() => exportChecklistPdf(true)} className="btn-secondary flex items-center gap-2 text-sm">
                    <ExternalLink size={14} /> {t('inspections.saved.previewPdf')}
                  </button>
                )}
                {!clOffline && navigator.share && (
                  <button
                    onClick={async () => {
                      await shareOrCopy({
                        title: `TyrePulse Inspection: ${clSaved.asset_no}`,
                        text: `Daily tyre inspection for ${clSaved.asset_no} on ${clSaved.scheduled_date} completed. ${clPositions.filter(p => p.condition === 'Puncture' || p.condition === 'Damage').length} critical tyre(s) flagged.`,
                      })
                    }}
                    className="btn-secondary flex items-center gap-2 text-sm"
                  >
                    <Share2 size={14} /> {t('inspections.saved.share')}
                  </button>
                )}
                {!clOffline && (
                  <button
                    onClick={() => setShowApprovalForm(v => !v)}
                    className="btn-secondary flex items-center gap-2 text-sm"
                    style={{ borderColor: '#6366f1', color: '#818cf8' }}
                  >
                    <Send size={14} /> {t('inspections.saved.sendForApproval')}
                  </button>
                )}
                <button onClick={() => {
                  setClSaved(null); setClOffline(false); setClAsset(''); setClPositions([])
                  setClFleetInfo(null); setClNotes(''); setClOdometer(''); setClHourMeter('')
                  setClPhotos([]); setClSignature(null); setClApprovalStatus('done')
                  setClApproverEmail(''); setShowApprovalForm(false)
                  if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null) }
                  setShowPdfPreview(false)
                }}
                  className="btn-primary text-sm">
                  {t('inspections.saved.newChecklist')}
                </button>
              </div>

              {/* Approval workflow panel */}
              {showApprovalForm && !clOffline && (
                <div className="mt-3 p-4 rounded-xl" style={{ background: 'var(--panel-3)', border: '1px solid #4338ca' }}>
                  <h4 className="text-sm font-semibold text-indigo-300 mb-3 flex items-center gap-2">
                    <Send size={14} /> {t('inspections.approval.title')}
                  </h4>
                  <div className="space-y-3">
                    <div>
                      <label className="label text-indigo-300">{t('inspections.approval.approverEmail')}</label>
                      <input
                        type="email"
                        className="input"
                        placeholder={t('inspections.approval.emailPlaceholder')}
                        value={clApproverEmail}
                        onChange={e => setClApproverEmail(e.target.value)}
                        style={{ background: '#312e81', borderColor: '#4338ca', color: '#e0e7ff' }}
                      />
                    </div>
                    <p className="text-xs text-indigo-300/70">
                      {t('inspections.approval.hint')}
                    </p>
                    <button
                      disabled={!clApproverEmail.trim() || clSendingEmail}
                      onClick={async () => {
                        if (!clSaved?.id) return
                        setClSendingEmail(true)
                        // Update DB status
                        try {
                          await inspectionsApi.patchInspection(clSaved.id, {
                            approval_status: 'pending_approval',
                            approver_email: clApproverEmail,
                            status: 'In Progress',
                          })
                        } catch { /* mirror prior fire-and-forget: proceed to send email regardless */ }
                        // Build approval link
                        const approvalLink = `${window.location.origin}/inspections?approve=${clSaved.id}`
                        // Send email via Edge Function
                        await supabase.functions.invoke('send-email', {
                          body: {
                            to: clApproverEmail,
                            subject: `Inspection Approval Required: Asset ${clSaved.asset_no || clAsset}`,
                            body: buildApprovalEmailHtml({
                              assetNo: clSaved.asset_no || clAsset,
                              inspector: clInspector || profile?.full_name || '',
                              date: clDate,
                              site: clSite,
                              odometer: clOdometer,
                              hourMeter: clHourMeter,
                              notes: clNotes,
                              approvalLink,
                              signature: clSignature,
                            }),
                          },
                        })
                        setClSendingEmail(false)
                        setClEmailSent(true)
                        setClApprovalStatus('pending_approval')
                        setShowApprovalForm(false)
                      }}
                      className="btn-primary text-sm w-full disabled:opacity-50"
                      style={{ background: '#4338ca' }}
                    >
                      {clSendingEmail
                        ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" /> {t('inspections.approval.sending')}</>
                        : <><Send size={13} className="inline mr-1" /> {t('inspections.approval.send')}</>
                      }
                    </button>
                  </div>
                </div>
              )}

              {clApprovalStatus === 'pending_approval' && !showApprovalForm && (
                <div className="mt-3 px-3 py-2 rounded-xl flex items-center gap-2 text-sm"
                  style={{ background: 'var(--panel-3)', border: '1px solid #4338ca', color: '#4f46e5' }}>
                  <Send size={14} />
                  <span>
                    {clEmailSent ? t('inspections.approval.sentTo') : t('inspections.approval.awaiting')}{' '}
                    <strong>{clApproverEmail}</strong>
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div
              className={`card space-y-4${lang === 'ar' ? ' text-right' : ''}`}
              dir={lang === 'ar' ? 'rtl' : undefined}
            >
              {/* Offline queue banner */}
              {pendingCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
                  style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e' }}>
                  <WifiOff size={14} />
                  <span>
                    {t('inspections.form.offlineQueued', { count: pendingCount })}
                  </span>
                </div>
              )}

              {/* Card header with language toggle */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">{CHECKLIST_LABELS[lang].title}</h3>
                <div className="flex gap-1 p-0.5 bg-[var(--surface-2)] rounded-lg">
                  {['en', 'ar'].map(l => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                        lang === l
                          ? 'bg-green-600 text-white shadow'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {l === 'en' ? 'EN' : 'AR'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">{CHECKLIST_LABELS[lang].asset}</label>
                  {masterAssets.length > 0 ? (
                    <select
                      className="input"
                      value={clAsset}
                      onChange={e => {
                        setClAsset(e.target.value)
                        if (e.target.value) loadFleetInfo(e.target.value)
                      }}
                    >
                      <option value="">{t('inspections.form.selectAsset')}</option>
                      {masterAssets.map(a => (
                        <option key={a.asset_no} value={a.asset_no}>
                          {a.asset_no}{a.vehicle_type ? ` - ${a.vehicle_type}` : ''}{a.site ? ` (${a.site})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input className="input flex-1" placeholder={t('inspections.form.assetPlaceholder')} value={clAsset}
                        onChange={e => setClAsset(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && loadFleetInfo(clAsset)} />
                      <button onClick={() => loadFleetInfo(clAsset)} disabled={clLookingUp || !clAsset.trim()}
                        className="btn-secondary px-3 text-sm disabled:opacity-50">
                        {clLookingUp ? '...' : t('inspections.form.load')}
                      </button>
                    </div>
                  )}
                  {(clFleetInfo || (clAsset && inferVehicleTypeFromAsset(clAsset))) && (
                    <p className="text-xs text-green-400 mt-1">
                      {clFleetInfo?.vehicle_type || inferVehicleTypeFromAsset(clAsset)} · {(TYRE_POSITIONS[normVT(clFleetInfo?.vehicle_type || inferVehicleTypeFromAsset(clAsset))] || DEFAULT_POSITIONS).length} {t('inspections.form.tyres')}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">{CHECKLIST_LABELS[lang].site}</label>
                  {masterSites.length > 0 ? (
                    <select className="input" value={clSite} onChange={e => setClSite(e.target.value)}>
                      <option value="">{t('inspections.form.selectSite')}</option>
                      {masterSites.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input className="input" placeholder={t('inspections.form.sitePlaceholder')} value={clSite}
                      onChange={e => setClSite(e.target.value)} list="cl-sites" />
                  )}
                  <datalist id="cl-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
                </div>
                <div>
                  <label className="label">{CHECKLIST_LABELS[lang].inspector}</label>
                  <input className="input" placeholder={t('inspections.form.inspectorPlaceholder')} value={clInspector}
                    onChange={e => setClInspector(e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('inspections.form.date')}</label>
                  <input type="date" className="input" value={clDate} onChange={e => setClDate(e.target.value)} />
                </div>
              </div>

              {clPositions.length > 0 && (() => {
                const filledCount = clPositions.filter(p => p.pressure).length
                const unfilledPositions = clPositions.filter(p => !p.pressure)
                const allFilled = unfilledPositions.length === 0
                const posIdx = clPositions.findIndex(p => p.position === clSelectedPos)
                const selPos = posIdx >= 0 ? clPositions[posIdx] : null
                return (
                  <div className="space-y-3">
                    {/* SVG diagram - single source of truth, tap to fill */}
                    <div
                      ref={diagramRef}
                      className="rounded-2xl flex flex-col items-center py-4 px-2"
                      style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}
                    >
                      <p className="text-xs font-medium mb-3" style={{ color: '#6b7280' }}>{t('inspections.form.tapTyre')}</p>
                      <VehicleTyreDiagram
                        vehicleType={clFleetInfo?.vehicle_type || inferVehicleTypeFromAsset(clAsset) || 'Pickup'}
                        positions={clPositions.map(p => ({
                          position: p.position,
                          risk_level: p.condition === 'Good' ? 'good'
                            : p.condition === 'Wear' ? 'warning'
                            : (p.condition === 'Damage' || p.condition === 'Puncture') ? 'critical'
                            : 'none',
                        }))}
                        onPositionClick={({ position }) => setClSelectedPos(position)}
                      />
                    </div>

                    {/* Position chips - tap any to jump, shows fill status */}
                    <div className="flex flex-wrap gap-1.5">
                      {clPositions.map(p => {
                        const has = !!p.pressure
                        const isActive = p.position === clSelectedPos
                        const isPuncture = p.condition === 'Puncture'
                        const isDmg = p.condition === 'Damage' || isPuncture
                        const isWear = p.condition === 'Wear'
                        const bg = isActive ? '#16a34a'
                          : has && isWear ? '#fefce8'
                          : has && isDmg  ? '#fef2f2'
                          : has ? '#f0fdf4'
                          : '#f9fafb'
                        const fg = isActive ? '#ffffff'
                          : has && isWear ? '#854d0e'
                          : has && isDmg  ? '#991b1b'
                          : has ? '#166534'
                          : '#9ca3af'
                        const bd = isActive ? '#16a34a'
                          : has && isWear ? '#fde047'
                          : has && isDmg  ? '#fca5a5'
                          : has ? '#86efac'
                          : '#e5e7eb'
                        return (
                          <button
                            key={p.position}
                            onClick={() => setClSelectedPos(p.position)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold transition-all active:scale-95"
                            style={{ background: bg, color: fg, border: `1.5px solid ${bd}` }}
                          >
                            {p.label || p.position}{has ? ' ✓' : ''}
                            {isPuncture && !isActive && <span className="ml-0.5 text-[9px]">🔴</span>}
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-xs px-0.5" style={{ color: allFilled ? '#16a34a' : '#9ca3af' }}>
                      {allFilled
                        ? t('inspections.form.allFilled', { count: clPositions.length })
                        : t('inspections.form.fillProgress', { filled: filledCount, total: clPositions.length, remaining: unfilledPositions.length })}
                    </p>

                    {/* Bottom sheet for selected position */}
                    {clSelectedPos && selPos && (
                      <PositionSheet
                        pos={selPos}
                        posIdx={posIdx}
                        total={clPositions.length}
                        isLast={posIdx === clPositions.length - 1}
                        unfilledCount={unfilledPositions.length}
                        allFilled={allFilled}
                        lang={lang}
                        onUpdate={(field, val) =>
                          setClPositions(ps => ps.map(p => p.position === clSelectedPos ? { ...p, [field]: val } : p))
                        }
                        onNext={() => {
                          const isOnLast = posIdx === clPositions.length - 1
                          if (isOnLast) {
                            // Re-check unfilled at call time (state may have just changed)
                            const stillUnfilled = clPositions.find((p, i) => i !== posIdx && !p.pressure)
                            if (stillUnfilled) { setClSelectedPos(stillUnfilled.position); return }
                            // All filled - close sheet
                            setClSelectedPos(null)
                            return
                          }
                          setClSelectedPos(clPositions[posIdx + 1].position)
                        }}
                        onPrev={() => { if (posIdx > 0) setClSelectedPos(clPositions[posIdx - 1].position) }}
                        onClose={() => setClSelectedPos(null)}
                      />
                    )}
                  </div>
                )
              })()}

              {clPositions.length === 0 && clAsset.trim() && (
                <p className="text-[var(--text-muted)] text-sm text-center py-4">
                  {CHECKLIST_LABELS[lang].no_asset}
                </p>
              )}

              {/* Odometer + Hour Meter */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label flex items-center gap-1.5"><Gauge size={12} className="text-[var(--text-secondary)]" /> {t('inspections.form.odometer')}</label>
                  <input type="number" className="input" placeholder={t('inspections.form.odometerPlaceholder')} min="0"
                    value={clOdometer} onChange={e => setClOdometer(e.target.value)} />
                </div>
                <div>
                  <label className="label flex items-center gap-1.5"><Clock size={12} className="text-[var(--text-secondary)]" /> {t('inspections.form.hourMeter')}</label>
                  <input type="number" className="input" placeholder={t('inspections.form.hourMeterPlaceholder')} min="0"
                    value={clHourMeter} onChange={e => setClHourMeter(e.target.value)} />
                </div>
              </div>

              {/* Photo capture */}
              <div>
                <label className="label flex items-center gap-1.5"><Camera size={12} className="text-[var(--text-secondary)]" /> {t('inspections.form.photos')}</label>
                <div className="flex gap-2 flex-wrap mb-2">
                  {clPhotos.map((src, i) => (
                    <div key={i} className="relative">
                      <img src={src} alt={`photo-${i}`}
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--hairline)' }} />
                      <button
                        onClick={() => setClPhotos(ps => ps.filter((_, j) => j !== i))}
                        style={{
                          position: 'absolute', top: -6, right: -6, width: 18, height: 18,
                          borderRadius: '50%', background: '#ef4444', border: 'none',
                          color:'var(--panel-ink)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >×</button>
                    </div>
                  ))}
                  {clPhotos.length < 6 && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
                        style={{ background: '#0c4a6e', border: '1.5px solid #0369a1', color: '#7dd3fc' }}
                      >
                        <Camera size={13} /> {t('inspections.form.camera')}
                      </button>
                      <button
                        onClick={() => galleryInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
                        style={{ background: 'var(--panel-3)', border: '1.5px solid #4338ca', color: '#4f46e5' }}
                      >
                        <ImageIcon size={13} /> {t('inspections.form.gallery')}
                      </button>
                    </div>
                  )}
                </div>
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = ev => {
                      // Compress via canvas
                      const img = new Image()
                      img.onload = () => {
                        const MAX = 800
                        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
                        const canvas = document.createElement('canvas')
                        canvas.width = img.width * scale
                        canvas.height = img.height * scale
                        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
                        setClPhotos(ps => [...ps, canvas.toDataURL('image/jpeg', 0.75)])
                      }
                      img.src = ev.target.result
                    }
                    reader.readAsDataURL(file)
                    e.target.value = ''
                  }}
                />
                <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={e => {
                    Array.from(e.target.files || []).slice(0, 6 - clPhotos.length).forEach(file => {
                      const reader = new FileReader()
                      reader.onload = ev => {
                        const img = new Image()
                        img.onload = () => {
                          const MAX = 800
                          const scale = Math.min(1, MAX / Math.max(img.width, img.height))
                          const canvas = document.createElement('canvas')
                          canvas.width = img.width * scale
                          canvas.height = img.height * scale
                          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
                          setClPhotos(ps => [...ps, canvas.toDataURL('image/jpeg', 0.75)])
                        }
                        img.src = ev.target.result
                      }
                      reader.readAsDataURL(file)
                    })
                    e.target.value = ''
                  }}
                />
              </div>

              {/* Inspector Signature */}
              <div>
                <label className="label flex items-center gap-1.5"><PenLine size={12} className="text-[var(--text-secondary)]" /> {t('inspections.form.inspectorSignature')}</label>
                {clSignature ? (
                  <div className="flex items-center gap-3">
                    <img src={clSignature} alt="signature"
                      style={{ height: 56, maxWidth: 180, background: '#fff', borderRadius: 8, border: '1px solid var(--hairline)', padding: 4 }} />
                    <div>
                      <p className="text-xs text-green-400 font-semibold">{t('inspections.form.signedAs', { name: clInspector })}</p>
                      <button onClick={() => setClSignature(null)}
                        className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors mt-0.5">
                        {t('inspections.form.clearSignature')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSignaturePad(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold w-full"
                    style={{ background: '#1a2e1a', border: '1.5px dashed #16a34a', color: '#4ade80' }}
                  >
                    <PenLine size={15} /> {t('inspections.form.tapToSign')}
                  </button>
                )}
              </div>

              <div>
                <label className="label">{CHECKLIST_LABELS[lang].notes}</label>
                <textarea className="input h-20 resize-none" placeholder={t('inspections.form.notesPlaceholder')}
                  value={clNotes} onChange={e => setClNotes(e.target.value)} />
              </div>

              {clError && (
                <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">
                  {clError}
                </div>
              )}
              {clPositions.length > 0 && clPositions.some(p => !p.pressure) && (
                <div className="p-3 rounded-xl flex items-center gap-2 text-sm"
                  style={{ background: '#fefce8', border: '1px solid #fde047', color: '#854d0e' }}>
                  <span>⚠️</span>
                  <span>
                    {t('inspections.form.psiWarning', { count: clPositions.filter(p => !p.pressure).length })}
                  </span>
                </div>
              )}
              <button
                onClick={saveChecklist}
                disabled={clSaving || !clAsset.trim() || clPositions.length === 0 || clPositions.some(p => !p.pressure)}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {clSaving ? t('common.saving') : CHECKLIST_LABELS[lang].save}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Signature Pad Modal */}
      {showSignaturePad && (
        <SignaturePad
          label={t('inspections.form.inspectorSignature')}
          inspectorName={clInspector}
          employeeId={profile?.employee_id || ''}
          onSave={dataUrl => { setClSignature(dataUrl); setShowSignaturePad(false) }}
          onClose={() => setShowSignaturePad(false)}
        />
      )}

      {/* ── Approver Modal (opens when landing via ?approve=<id>) ── */}
      {showApproveModal && approveTarget && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: 'var(--panel)', border: '1px solid var(--hairline)', borderRadius: 20,
            width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
            padding: 24, boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color:'var(--panel-ink)' }}>{t('inspections.approve.title')}</div>
                <div style={{ fontSize: 12, color: 'var(--panel-ink-3)', marginTop: 2 }}>
                  {t('inspections.approve.asset')} <strong style={{ color: 'var(--panel-ink-2)' }}>{approveTarget.asset_no}</strong>
                  {approveTarget.site ? ` · ${approveTarget.site}` : ''}
                  {' · '}{approveTarget.inspection_date || approveTarget.scheduled_date}
                </div>
                {approveTarget.approval_status && (
                  <div style={{ marginTop: 8 }}>
                    <StatusBadge status={approveTarget.approval_status} label={String(approveTarget.approval_status).replace(/_/g, ' ')} size={26} />
                  </div>
                )}
              </div>
              <button onClick={() => { setShowApproveModal(false); clearApproveParam() }}
                style={{ background: 'none', border: 'none', color: 'var(--panel-ink-3)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* Details */}
            <div style={{ background: 'var(--panel-2)', borderRadius: 12, padding: 16, marginBottom: 16, fontSize: 13 }}>
              {[
                [t('inspections.approve.fields.inspector'), approveTarget.inspector_name || approveTarget.inspector],
                [t('inspections.approve.fields.type'), approveTarget.inspection_type],
                [t('inspections.approve.fields.odometer'), approveTarget.odometer_km ? `${approveTarget.odometer_km} km` : null],
                [t('inspections.approve.fields.hourMeter'), approveTarget.hour_meter ? `${approveTarget.hour_meter} hrs` : null],
                [t('inspections.approve.fields.notes'), approveTarget.notes],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: 'var(--panel-ink-4)', minWidth: 100 }}>{k}</span>
                  <span style={{ color: 'var(--panel-ink-2)', fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Additional imported fields */}
            <div style={{ marginBottom: 16 }}>
              <CustomFieldsPanel data={approveTarget.custom_data} title={t('inspections.approve.additionalFields')} />
            </div>

            {/* Inspector signature preview */}
            {approveTarget.inspector_signature && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-ink-4)', textTransform: 'uppercase', marginBottom: 6 }}>{t('inspections.form.inspectorSignature')}</div>
                <img src={approveTarget.inspector_signature} alt="Inspector signature"
                  style={{ maxWidth: 200, border: '1px solid var(--hairline)', borderRadius: 8 }} />
              </div>
            )}

            {/* Approver signature */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-ink-4)', textTransform: 'uppercase', marginBottom: 8 }}>{t('inspections.approve.yourSignature')}</div>
              {approverSig ? (
                <div>
                  <img src={approverSig} alt="Approver signature"
                    style={{ maxWidth: 200, border: '1px solid var(--hairline)', borderRadius: 8 }} />
                  <button onClick={() => setApproverSig(null)}
                    style={{ display: 'block', marginTop: 6, fontSize: 11, color: 'var(--panel-ink-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    {t('inspections.approve.clearResign')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowApproverPad(true)}
                  style={{
                    width: '100%', padding: '14px', borderRadius: 12,
                    border: '2px dashed var(--hairline)', background: 'var(--panel-2)',
                    color: 'var(--panel-ink-3)', fontSize: 13, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <span>✍</span> {t('inspections.approve.tapToSign')}
                </button>
              )}
            </div>

            {/* Status message */}
            {approveMsg && (
              <div style={{
                padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13,
                background: approveMsg.type === 'ok' ? 'rgba(22,163,74,0.15)' : 'rgba(239,68,68,0.15)',
                border: `1px solid ${approveMsg.type === 'ok' ? '#16a34a' : '#ef4444'}`,
                color: approveMsg.type === 'ok' ? '#4ade80' : '#f87171',
              }}>
                {approveMsg.text}
              </div>
            )}

            {/* Actions */}
            {approveTarget.approval_status !== 'approved' && (
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={async () => {
                    setApproveSubmitting(true)
                    try {
                      await inspectionsApi.patchInspection(approveTarget.id, {
                        approval_status: 'rejected',
                        approved_at: new Date().toISOString(),
                        approved_by: profile?.id,
                      })
                    } catch { /* mirror prior fire-and-forget: surface result regardless */ }
                    setApproveMsg({ type: 'err', text: t('inspections.approve.msgRejected') })
                    setApproveSubmitting(false)
                  }}
                  disabled={approveSubmitting}
                  style={{
                    flex: 1, padding: '11px', borderRadius: 10,
                    border: '1.5px solid #ef4444', background: 'transparent',
                    color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {t('inspections.approve.reject')}
                </button>
                <button
                  onClick={async () => {
                    if (!approverSig) { setApproveMsg({ type: 'err', text: t('inspections.approve.msgNeedSignature') }); return }
                    setApproveSubmitting(true)
                    try {
                      await inspectionsApi.patchInspection(approveTarget.id, {
                        approval_status: 'approved',
                        approver_signature: approverSig,
                        approved_at: new Date().toISOString(),
                        approved_by: profile?.id,
                      })
                    } catch { /* mirror prior fire-and-forget: surface result regardless */ }
                    setApproveMsg({ type: 'ok', text: t('inspections.approve.msgApproved') })
                    setApproveSubmitting(false)
                    setApproveTarget(prev => ({ ...prev, approval_status: 'approved', approver_signature: approverSig }))
                  }}
                  disabled={approveSubmitting || !approverSig}
                  style={{
                    flex: 2, padding: '11px', borderRadius: 10, border: 'none',
                    background: approverSig ? '#16a34a' : 'var(--hairline)',
                    color:'var(--panel-ink)', fontSize: 13, fontWeight: 700, cursor: approverSig ? 'pointer' : 'not-allowed',
                  }}
                >
                  {approveSubmitting ? t('common.saving') : t('inspections.approve.approveSign')}
                </button>
              </div>
            )}
            {approveTarget.approval_status === 'approved' && (
              <div style={{ textAlign: 'center', padding: '12px', borderRadius: 10, background: 'rgba(22,163,74,0.15)', border: '1px solid #16a34a', color: '#16a34a', fontWeight: 600 }}>
                {t('inspections.approve.alreadyApproved')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Approver Signature Pad */}
      {showApproverPad && (
        <SignaturePad
          label={t('inspections.approve.approverSignature')}
          inspectorName={profile?.full_name || ''}
          employeeId={profile?.employee_id || ''}
          onSave={dataUrl => { setApproverSig(dataUrl); setShowApproverPad(false) }}
          onClose={() => setShowApproverPad(false)}
        />
      )}

      {/* Mobile PDF Preview Modal */}
      {showPdfPreview && pdfBlobUrl && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'var(--panel)', borderBottom: '1px solid var(--hairline)',
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color:'var(--panel-ink)' }}>
              {t('inspections.pdfPreview.title')} - {clSaved?.asset_no}
            </span>
            <div className="flex gap-2">
              <a
                href={pdfBlobUrl}
                download={`TyrePulse_Checklist_${clSaved?.asset_no || 'report'}.pdf`}
                className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
              >
                <Download size={13} /> {t('inspections.pdfPreview.download')}
              </a>
              <button
                onClick={() => setShowPdfPreview(false)}
                style={{ background: 'var(--hairline)', border: 'none', borderRadius: 8, color:'var(--panel-ink)', cursor: 'pointer', padding: '6px 10px' }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <iframe
            src={pdfBlobUrl}
            style={{ flex: 1, border: 'none', background: '#fff' }}
            title="Inspection PDF Preview"
          />
        </div>
      )}

      {/* Status filter pills, search, and table - hidden in checklist mode */}
      {activeTab !== 'checklist' && <>
      {/* Overview slides: two compact cards with the big clear numbers */}
      {activeTab === 'all' && (
        <div className="flex flex-wrap gap-4">
          <OverviewSlide
            title="Inspections"
            items={[
              ['Inspections done', overview.inspectionsDone],
              ['Vehicles inspected', overview.vehiclesInspected],
              ['Approved', overview.approved],
              ['Pending approval', overview.pendingApproval],
            ]}
          />
          {flagStatus === 'loading' ? (
            <div className="card flex-1 min-w-[260px]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Tyre change flags</p>
              <p className="text-sm text-[var(--text-secondary)]">Checking tyre life...</p>
            </div>
          ) : flagStatus === 'error' ? (
            /* "We could not look" - never dressed up as a count of zero. */
            <div className="card flex-1 min-w-[260px]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Tyre change flags</p>
              <p className="text-sm text-[var(--text-secondary)]">Could not load tyre life data, so no tyre is flagged here.</p>
              {flagError && <p className="mt-1 text-xs text-[var(--text-dim)]">{flagError}</p>}
              <button
                type="button"
                onClick={() => setFlagReload((n) => n + 1)}
                className="mt-2 px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs"
                style={{ color: 'var(--text-primary)' }}
              >
                Retry
              </button>
            </div>
          ) : !overview.vehiclesWithTyresDue ? (
            /* We looked, and nothing is flagged HERE. The two reasons for that
               are different facts, so they are said differently: no tyre is due
               anywhere in this country, versus none is due on the vehicles
               these inspections cover. */
            <div className="card flex-1 min-w-[260px]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Tyre change flags</p>
              <p className="text-sm text-[var(--text-secondary)]">
                {dueAssetCount === 0
                  ? `No tyre is currently due${activeCountry && activeCountry !== 'All' ? ` in ${activeCountry}` : ''}. Nothing is past its expected life or close to it.`
                  : `No tyre is due on the vehicles in these inspections. ${dueAssetCount} other ${dueAssetCount === 1 ? 'vehicle has' : 'vehicles have'} tyres due.`}
              </p>
              <p className="mt-2 text-xs text-[var(--text-dim)]">
                Damaged found in these inspections: {overview.damagedFound}
              </p>
              {dueAssetCount > 0 && (
                <Link
                  to={trackingLink()}
                  className="mt-2 inline-flex items-center gap-1 text-xs underline"
                  style={{ color: 'var(--text-primary)' }}
                >
                  See those vehicles and whether the tyres were replaced
                  <ExternalLink size={12} />
                </Link>
              )}
            </div>
          ) : (
            <OverviewSlide
              title="Tyre change flags"
              items={[
                ['Vehicles with tyres due', overview.vehiclesWithTyresDue, true],
                ['Tyres past life', overview.tyresOverdue, true],
                ['Tyres due soon', overview.tyresDueSoon, true],
                ['Damaged found', overview.damagedFound, true],
              ]}
              /* A count you cannot act on is just a number. This opens the
                 tracked list: which tyre, on which vehicle, and whether the
                 change actually happened. */
              footer={(
                <Link
                  to={trackingLink()}
                  className="inline-flex items-center gap-1 text-xs underline"
                  style={{ color: 'var(--text-primary)' }}
                >
                  See the flagged tyres and whether they were replaced
                  <ExternalLink size={12} />
                </Link>
              )}
            />
          )}
          <button
            type="button"
            onClick={() => setSummaryOpen(true)}
            className="self-start px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-xs font-medium flex items-center gap-1.5"
            style={{ color: 'var(--text-primary)', background: 'var(--surface-2)' }}
          >
            <Share2 size={13} /> Share summary
          </button>
        </div>
      )}
      {summaryOpen && (
        <InspectionSummaryModal
          rows={rows}
          flagMap={flagMap || {}}
          defaultFrom={filterFrom}
          defaultTo={filterTo}
          country={activeCountry}
          company={company}
          branding={branding}
          onClose={() => setSummaryOpen(false)}
        />
      )}
      {/* Read one inspection in place: the recorded readings, meters, photos
          and signatures, without a page load or a downloaded file. */}
      <InspectionViewerDrawer
        inspectionId={viewId}
        onClose={() => setViewId(null)}
        onEdit={(row) => {
          setViewId(null)
          setForm({ ...row, tyre_conditions: row.tyre_conditions ?? {} })
        }}
        onDownload={(row) => exportRowPdf(row)}
        downloading={Boolean(pdfBusyId)}
      />
      <div className="flex flex-wrap gap-2">
        {[['all', t('inspections.filters.status.all'), 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'],
          ['Overdue', t('inspections.filters.status.overdue'), 'bg-red-900/30 text-red-400 border-red-700/50'],
          ['Scheduled', t('inspections.filters.status.scheduled'), 'bg-blue-900/30 text-blue-400 border-blue-700/50'],
          ['In Progress', t('inspections.filters.status.inProgress'), 'bg-yellow-900/30 text-yellow-400 border-yellow-700/50'],
          ['Done', t('inspections.filters.status.done'), 'bg-green-900/30 text-green-400 border-green-700/50'],
        ].map(([val, label, cls]) => (
          <button
            key={val}
            onClick={() => setFilter('status', val)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${cls} ${filterStatus === val ? 'ring-2 ring-white/20' : 'opacity-70 hover:opacity-100'}`}
          >
            {label} ({statusCounts[val] ?? 0})
          </button>
        ))}
      </div>

      {/* Filters - search stays out, everything else collapses behind one
          toggle. Same shape as the accident register, so a person who has
          learned one register has learned both. */}
      {(() => {
        const advanced = [
          filterSite !== 'all', filterRegion !== 'all', filterInspector !== 'all',
          !!filterFrom, !!filterTo,
        ].filter(Boolean).length
        const anyActive = advanced > 0 || !!search
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input className="input flex-1 min-w-48" placeholder={t('inspections.filters.searchPlaceholder')}
                value={search} onChange={e => setFilter('search', e.target.value)} />
              <button
                onClick={() => setShowFilters(v => !v)}
                aria-expanded={showFilters}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                  showFilters || advanced > 0
                    ? 'bg-[var(--input-bg)] text-[var(--text-primary)] border-[var(--input-border)]'
                    : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-primary)]'
                }`}
                title="Show or hide the advanced filters"
              >
                Filters{advanced > 0 ? ` (${advanced})` : ''}
                <ChevronDown size={13} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
              </button>
              {anyActive && (
                <button
                  onClick={() => {
                    setFilters({
                      search: '', site: 'all', region: 'all',
                      inspector: 'all', from: '', to: '',
                    })
                  }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 flex items-center gap-1"
                >
                  <X size={12} /> Clear
                </button>
              )}
              <span className="text-xs text-[var(--text-muted)] ml-auto self-center whitespace-nowrap">
                {filtered.length}{filtered.length !== tabFiltered.length ? ` of ${tabFiltered.length}` : ''} shown
              </span>
            </div>

            {showFilters && (
              <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3">
                {/* Region renders only when the site register actually places
                    these sites in one. An empty dropdown is a control that can
                    only ever return nothing. */}
                {regions.length > 0 && (
                  <select className="input text-sm w-40" value={filterRegion} onChange={e => setFilter('region', e.target.value)}>
                    <option value="all">All regions</option>
                    {regions.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
                <select className="input text-sm w-44" value={filterSite} onChange={e => setFilter('site', e.target.value)}>
                  <option value="all">{t('inspections.filters.allSites')}</option>
                  {sites.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {inspectors.length > 0 && (
                  <select className="input text-sm w-44" value={filterInspector} onChange={e => setFilter('inspector', e.target.value)}>
                    <option value="all">All inspectors</option>
                    {inspectors.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                )}
                <DateField className="text-sm w-40" value={filterFrom} onChange={v => setFilter('from', v)} placeholder="From date" ariaLabel="From date" />
                <DateField className="text-sm w-40" value={filterTo} onChange={v => setFilter('to', v)} placeholder="To date" ariaLabel="To date" min={filterFrom || undefined} />
              </div>
            )}
          </div>
        )
      })()}

      {/* Bulk selection bar (Admin only) */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 bg-blue-950/30 border border-blue-800/50 rounded-xl px-4 py-2.5">
          <span className="text-sm text-blue-200">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 py-1">Clear</button>
            <button onClick={() => { setBulkError(''); setBulkDeleteOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">
              <Trash2 size={14} /> Delete {selectedIds.size}
            </button>
          </div>
        </div>
      )}

      {/* Virtualised Table */}
      <div className="card overflow-x-auto p-0">
        {/* Sticky header */}
        <div
          className="text-left text-[var(--text-secondary)] border-b border-[var(--border-dim)] bg-[var(--surface-1)]"
          style={{ minWidth: `${INSP_COL_WIDTHS.reduce((a, b) => a + b, 0)}px` }}
        >
          <div style={inspGridStyle} className="px-0">
            {isAdmin && (
              <div className="pb-2 pt-3 px-3 flex items-center">
                <input type="checkbox" checked={allPageSelected} onChange={toggleSelectPage} title="Select all shown"
                  className="w-4 h-4 rounded border-[var(--border-bright)] bg-[var(--surface-2)] accent-blue-600 cursor-pointer" />
              </div>
            )}
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">{t('inspections.table.type')}</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">{t('inspections.table.title')}</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">{t('inspections.table.site')}</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">{t('inspections.table.asset')}</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">{t('inspections.table.date')}</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">{t('inspections.table.severity')}</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">{t('inspections.table.status')}</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">{t('inspections.table.inspector')}</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">{t('inspections.table.actions')}</div>
          </div>
        </div>

        {/* Virtual scroll container */}
        <div
          ref={tableParentRef}
          className="overflow-y-auto"
          style={{
            height: filtered.length === 0 ? 'auto' : '600px',
            minWidth: `${INSP_COL_WIDTHS.reduce((a, b) => a + b, 0)}px`,
          }}
        >
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-[var(--text-muted)] text-sm">{t('inspections.states.noRecords')}</div>
          ) : (
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const r = filtered[virtualRow.index]
                const cfg    = STATUS_CONFIG[r.status] || STATUS_CONFIG.Scheduled
                const sevCfg = SEV_CONFIG[r.severity]  || SEV_CONFIG.Medium
                const isObs  = isObservationType(r.inspection_type)
                const isTrn  = isTrainingType(r.inspection_type)

                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                      height: `${virtualRow.size}px`,
                      ...inspGridStyle,
                    }}
                    className={`border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer ${selectedIds.has(r.id) ? 'bg-blue-950/20' : ''}`}
                    role="button"
                    tabIndex={0}
                    title={t('inspections.row.titleOpenRecord')}
                    // Open the record in place. The row is the natural target -
                    // reading what was recorded should not cost a page load or
                    // a downloaded file. Clicks on the checkbox and the action
                    // buttons stop propagation, so those still do their own job.
                    onClick={() => setViewId(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewId(r.id) }
                    }}
                  >
                    {isAdmin && (
                      <div className="px-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)}
                          className="w-4 h-4 rounded border-[var(--border-bright)] bg-[var(--surface-2)] accent-blue-600 cursor-pointer" />
                      </div>
                    )}
                    {/* Type */}
                    <div className="px-3 overflow-hidden">
                      <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${
                        isObs ? 'bg-purple-900/20 text-purple-400 border-purple-700/40'
                        : isTrn ? 'bg-blue-900/20 text-blue-400 border-blue-700/40'
                        : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
                      }`}>
                        {r.inspection_type}
                      </span>
                    </div>

                    {/* Title */}
                    <div className="px-3 text-[var(--text-primary)] font-medium text-sm truncate" title={r.title}>
                      {r.title}
                      {r.photo_data && <Camera className="inline w-3 h-3 ml-1 text-[var(--text-muted)]" title={t('inspections.row.titleHasPhoto')} />}
                      {r.linked_action_id && <ClipboardList className="inline w-3 h-3 ml-1 text-yellow-400" title={t('inspections.row.titleActionRaised')} />}
                    </div>

                    {/* Site */}
                    <div className="px-3 text-[var(--text-secondary)] text-sm truncate">{r.site}</div>

                    {/* Asset */}
                    <div className="px-3 font-mono text-xs text-[var(--text-secondary)] overflow-hidden">
                      <span className="truncate block">{r.asset_no || '-'}</span>
                      {r.asset_no && flagMap?.[r.asset_no]?.count > 0 && (
                        /* The flag now GOES somewhere: the same gesture as
                           clicking an inspection to open that inspection, but
                           straight to this vehicle's flagged tyres. The row
                           click opens the inspection, so this must not bubble. */
                        <Link
                          to={trackingLink({ asset: r.asset_no })}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-block mt-0.5 px-1.5 py-px rounded-full text-[10px] font-sans font-medium whitespace-nowrap underline"
                          style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.3)' }}
                          title={`See which tyres are due on ${r.asset_no} and whether they have been replaced`}
                        >
                          Tyres due ({flagMap[r.asset_no].count})
                        </Link>
                      )}
                    </div>

                    {/* Date */}
                    <div className="px-3 text-[var(--text-secondary)] text-xs tabular-nums">{r.scheduled_date}</div>

                    {/* Severity */}
                    <div className="px-3">
                      {r.severity && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${sevCfg.bg} ${sevCfg.color} ${sevCfg.border}`}>
                          {r.severity}
                        </span>
                      )}
                    </div>

                    {/* Status */}
                    <div className="px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                        {r.status}
                      </span>
                    </div>

                    {/* Inspector */}
                    <div className="px-3 text-[var(--text-secondary)] text-xs truncate">{r.inspector || r.attendees || '-'}</div>

                    {/* Actions */}
                    <div className="px-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 flex-wrap">
                        <button onClick={() => setViewId(r.id)}
                          className="text-xs px-2 py-1 rounded bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] transition-colors"
                          title={t('inspections.row.titleOpenRecord')}>
                          <Eye size={11} className="inline" />
                        </button>
                        {r.status !== 'Done' && r.status !== 'Cancelled' && (
                          <button onClick={() => markDone(r.id)}
                            className="text-xs px-2 py-1 rounded bg-green-900/30 text-green-400 hover:bg-green-900/50 border border-green-700/50 transition-colors whitespace-nowrap">
                            {t('inspections.row.done')}
                          </button>
                        )}
                        {isObs && r.status === 'Done' && !r.linked_action_id && (
                          <button onClick={() => setRaisingAction(r)}
                            className="text-xs px-2 py-1 rounded bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/40 border border-yellow-700/40 transition-colors whitespace-nowrap">
                            {t('inspections.row.raiseAction')}
                          </button>
                        )}
                        {r.linked_action_id && (
                          <span className="text-xs px-2 py-1 rounded bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border-bright)] whitespace-nowrap">
                            {t('inspections.row.actionRaised')}
                          </span>
                        )}
                        <button onClick={() => setForm({ ...r, tyre_conditions: r.tyre_conditions ?? {} })}
                          className="text-xs px-2 py-1 rounded bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] transition-colors">
                          {t('inspections.row.edit')}
                        </button>
                        <button onClick={() => exportRowPdf(r)} disabled={pdfBusyId === r.id}
                          className="text-xs px-2 py-1 rounded bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] transition-colors disabled:opacity-50"
                          title={t('inspections.row.titleExportPdf')}>
                          <FileText size={11} className="inline" />
                        </button>
                        <button onClick={() => setDeleteId(r.id)}
                          className="text-xs px-2 py-1 rounded bg-red-900/20 text-red-400 hover:bg-red-900/40 border border-red-800/50 transition-colors">
                          {t('inspections.row.del')}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      </>}

      {/* Add / Edit Modal */}
      {form !== null && (
        <Modal onClose={() => setForm(null)}>
          <h3 className="text-lg font-bold text-[var(--text-primary)] mb-5">
            {form.id ? t('inspections.modal.editRecord') : t('inspections.modal.addRecord')}
          </h3>

          {/* Immediate tyre-change flag for this vehicle (open detail) */}
          {form.asset_no && (
            <TyreDueBanner entry={flagMap?.[form.asset_no]} damaged={damagedPositions(form)} inspection={form} />
          )}

          {/* Universal Approval & Workflow Engine — inspection approval + lock.
              Only for persisted records (needs a stable entity id). While the
              record is mid-approval or approved, edits/saves are disabled. */}
          {form.id && (
            <div className="mb-5">
              <EntityApprovalPanel
                entityType="inspection"
                entityId={form.id}
                entityLabel={form.asset_no || form.title || form.id}
                context={{
                  pressure: form.tyre_conditions?.[selectedTyre]?.pressure ?? null,
                  tread: form.tread_depth ?? null,
                  odometer: form.odometer_km ?? null,
                  severity: form.severity ?? null,
                  site: form.site ?? null,
                  asset_no: form.asset_no ?? null,
                  inspection_type: form.inspection_type ?? null,
                }}
                onStateChange={({ isActive, isLocked }) => {
                  const locked = !!(isActive || isLocked)
                  setWfLocked((prev) => (prev === locked ? prev : locked))
                }}
                title={t('inspections.approval.title') || 'Inspection Approval'}
              />
              {wfLocked && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertTriangle size={12} /> Locked, in approval
                </div>
              )}
            </div>
          )}

          <fieldset disabled={wfLocked} className="space-y-4 disabled:opacity-60">
            <div>
              <label className="label">{t('inspections.modal.titleField')}</label>
              <input className="input" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder={t('inspections.modal.titlePlaceholder')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('inspections.modal.type')}</label>
                <select className="input" value={form.inspection_type}
                  onChange={e => setForm(f => ({ ...f, inspection_type: e.target.value }))}>
                  <optgroup label={t('inspections.modal.groupInspections')}>
                    {INSPECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                  <optgroup label={t('inspections.modal.groupObservations')}>
                    {OBSERVATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                  <optgroup label={t('inspections.modal.groupTraining')}>
                    {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="label">{t('inspections.modal.status')}</label>
                <select className="input" value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('inspections.modal.siteField')}</label>
                <input className="input" value={form.site}
                  onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                  placeholder={t('inspections.form.sitePlaceholder')} list="insp-sites" />
                <datalist id="insp-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="label">{t('inspections.modal.dateField')}</label>
                <input type="date" className="input" value={form.scheduled_date}
                  onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('inspections.modal.assetNo')}</label>
                <input className="input" value={form.asset_no}
                  onChange={e => setForm(f => ({ ...f, asset_no: e.target.value }))}
                  placeholder={t('inspections.form.assetPlaceholder')} />
              </div>
              {!isTrainingType(form.inspection_type) && (
                <div>
                  <label className="label">{t('inspections.modal.severity')}</label>
                  <select className="input" value={form.severity || 'Medium'}
                    onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                    {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              {isTrainingType(form.inspection_type) && (
                <div>
                  <label className="label">{t('inspections.modal.tyreSerial')}</label>
                  <input className="input" value={form.tyre_serial}
                    onChange={e => setForm(f => ({ ...f, tyre_serial: e.target.value }))}
                    placeholder={t('inspections.modal.serialPlaceholder')} />
                </div>
              )}
            </div>

            {/* Tyre diagram - inspections only */}
            {!isObservationType(form.inspection_type) && !isTrainingType(form.inspection_type) && (
              <div>
                <label className="label">{t('inspections.modal.vehicleType')}</label>
                <select className="input mb-3" value={form.vehicle_type || ''}
                  onChange={e => { setForm(f => ({ ...f, vehicle_type: e.target.value, tyre_conditions: {} })); setSelectedTyre(null) }}>
                  <option value="">{t('inspections.modal.selectVehicleType')}</option>
                  {VEHICLE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>

                {form.vehicle_type && (
                  <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-[var(--border-bright)]">
                    <p className="text-xs text-[var(--text-secondary)] mb-3">{t('inspections.modal.clickTyre')}</p>
                    <VehicleTyreDiagram
                      vehicleType={form.vehicle_type}
                      tyreData={form.tyre_conditions || {}}
                      onTyreClick={(id) => setSelectedTyre(id === selectedTyre ? null : id)}
                      width={180}
                    />

                    {selectedTyre && (
                      <div className="mt-4 p-3 bg-[var(--surface-1)] rounded-lg border border-[var(--border-bright)]">
                        <p className="text-xs font-semibold text-[var(--text-primary)] mb-2">{t('inspections.modal.tyreLabel', { id: selectedTyre })}</p>
                        <div className="flex gap-2 flex-wrap mb-2">
                          {RISK_LEVELS.map(r => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => setForm(f => ({
                                ...f,
                                tyre_conditions: {
                                  ...f.tyre_conditions,
                                  [selectedTyre]: { ...(f.tyre_conditions?.[selectedTyre] ?? {}), risk: r },
                                },
                              }))}
                              className={`text-xs px-2.5 py-1 rounded border capitalize transition-all ${
                                (form.tyre_conditions?.[selectedTyre]?.risk ?? 'none') === r
                                  ? r === 'good'     ? 'bg-green-600 border-green-500 text-white'
                                  : r === 'warning'  ? 'bg-yellow-600 border-yellow-500 text-white'
                                  : r === 'critical' ? 'bg-red-600 border-red-500 text-white'
                                  :                    'bg-gray-600 border-gray-500 text-[var(--text-primary)]'
                                  : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                              }`}
                            >
                              {r === 'none' ? t('inspections.modal.noData') : r}
                            </button>
                          ))}
                        </div>
                        <input
                          type="number"
                          className="input text-xs py-1"
                          placeholder={t('inspections.modal.pressurePlaceholder')}
                          value={form.tyre_conditions?.[selectedTyre]?.pressure ?? ''}
                          onChange={e => setForm(f => ({
                            ...f,
                            tyre_conditions: {
                              ...f.tyre_conditions,
                              [selectedTyre]: { ...(f.tyre_conditions?.[selectedTyre] ?? {}), pressure: e.target.value },
                            },
                          }))}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {isTrainingType(form.inspection_type) ? (
              <div>
                <label className="label">{t('inspections.modal.attendees')}</label>
                <input className="input" value={form.attendees || ''}
                  onChange={e => setForm(f => ({ ...f, attendees: e.target.value }))}
                  placeholder={t('inspections.modal.attendeesPlaceholder')} />
              </div>
            ) : (
              <div>
                <label className="label">{t('inspections.modal.inspectorObserver')}</label>
                <input className="input" value={form.inspector}
                  onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))}
                  placeholder={t('inspections.modal.namePlaceholder')} />
              </div>
            )}

            <div>
              <label className="label">{isTrainingType(form.inspection_type) ? t('inspections.modal.trainingContent') : t('inspections.modal.findings')}</label>
              <textarea className="input h-20 resize-none" value={form.findings}
                onChange={e => setForm(f => ({ ...f, findings: e.target.value }))}
                placeholder={isTrainingType(form.inspection_type) ? t('inspections.modal.topicsPlaceholder') : t('inspections.modal.findingsPlaceholder')} />
            </div>
            <div>
              <label className="label">{t('inspections.modal.notes')}</label>
              <textarea className="input h-16 resize-none" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder={t('inspections.modal.notesPlaceholder')} />
            </div>

            {/* Photo upload */}
            <div>
              <label className="label">{t('inspections.modal.photo')}</label>
              <div className="flex items-center gap-3">
                <button type="button"
                  onClick={() => fileRef.current?.click()}
                  className="btn-secondary text-sm flex items-center gap-2 px-3 py-2">
                  <Camera size={14} /> {form.photo_data ? t('inspections.modal.changePhoto') : t('inspections.modal.uploadPhoto')}
                </button>
                {form.photo_data && (
                  <button type="button" onClick={() => setForm(f => ({ ...f, photo_data: null }))}
                    className="text-xs text-red-400 hover:text-red-300">{t('inspections.modal.remove')}</button>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={handlePhotoChange} />
              </div>
              {form.photo_data && (
                <img src={form.photo_data} alt="Attached" className="mt-2 rounded-lg max-h-48 border border-[var(--border-bright)] object-cover" />
              )}
            </div>

            {form.status === 'Done' && (
              <div>
                <label className="label">{t('inspections.modal.completedDate')}</label>
                <input type="date" className="input" value={form.completed_date || ''}
                  onChange={e => setForm(f => ({ ...f, completed_date: e.target.value }))} />
              </div>
            )}
          </fieldset>
          {saveError && (
            <div className="mt-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">
              {saveError}
            </div>
          )}
          <div className="flex gap-3 mt-4">
            <button onClick={() => { setForm(null); setSaveError(null) }} className="btn-secondary flex-1">{t('common.cancel')}</button>
            <button onClick={save}
              disabled={wfLocked || saving || !form.title?.trim() || !form.site?.trim() || !form.scheduled_date}
              title={wfLocked ? 'Locked, in approval' : undefined}
              className="btn-primary flex-1 disabled:opacity-50">
              {saving ? t('common.saving') : form.id ? t('inspections.modal.saveChanges') : t('common.add')}
            </button>
          </div>
        </Modal>
      )}

      {/* Raise Corrective Action modal */}
      {raisingAction && (
        <RaiseActionModal
          row={raisingAction}
          onConfirm={(title) => raiseAction(raisingAction, title)}
          onClose={() => setRaisingAction(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteId && (
        <Modal onClose={() => setDeleteId(null)}>
          <p className="text-[var(--text-primary)] font-semibold mb-2">{t('inspections.deleteModal.title')}</p>
          <p className="text-[var(--text-secondary)] text-sm mb-5">{t('inspections.deleteModal.warning')}</p>
          <div className="flex gap-3">
            <button onClick={() => setDeleteId(null)} className="btn-secondary flex-1">{t('common.cancel')}</button>
            <button onClick={confirmDelete} className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700">{t('common.delete')}</button>
          </div>
        </Modal>
      )}

      {/* Bulk delete confirm (Admin only) */}
      {bulkDeleteOpen && (
        <Modal onClose={() => { if (!bulkBusy) { setBulkDeleteOpen(false); setBulkError('') } }}>
          <div className="flex gap-3 mb-4">
            <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[var(--text-primary)] font-semibold">Delete {selectedIds.size} record{selectedIds.size !== 1 ? 's' : ''}?</p>
              <p className="text-[var(--text-secondary)] text-sm mt-1">This permanently removes the selected inspection records. This cannot be undone.</p>
            </div>
          </div>
          {bulkError && (
            <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{bulkError}</p>
          )}
          <div className="flex gap-3">
            <button onClick={() => { setBulkDeleteOpen(false); setBulkError('') }} disabled={bulkBusy} className="btn-secondary flex-1">Cancel</button>
            <button onClick={confirmBulkDelete} disabled={bulkBusy}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
              <Trash2 size={14} /> {bulkBusy ? 'Deleting...' : `Delete ${selectedIds.size}`}
            </button>
          </div>
        </Modal>
      )}

      {/* Offscreen live diagram for row PDF export (captured as SVG) */}
      {pdfRow && (
        <div
          ref={pdfDiagramRef}
          aria-hidden
          style={{ position: 'fixed', left: -9999, top: 0, width: 360, opacity: 0, pointerEvents: 'none' }}
        >
          <VehicleTyreDiagram
            vehicleType={pdfRow.vehicle_type || inferVehicleTypeFromAsset(pdfRow.asset_no) || 'Pickup'}
            tyreData={pdfRow.tyre_conditions || {}}
            subLabels={Object.fromEntries(Object.entries(pdfRow.tyre_conditions || {})
              .filter(([, d]) => d && typeof d === 'object' && Number(d.pressure_psi) > 0)
              .map(([pos, d]) => [pos, `${Math.round(Number(d.pressure_psi))} PSI`]))}
            width={340}
          />
        </div>
      )}

      {/* Offscreen copy of the checklist diagram for the "Daily Tyre Inspection
          Report" PDF — always mounted once saved (the on-screen form diagram is
          replaced by the saved-confirmation view), so the report always embeds
          the SAME diagram the operator saw. */}
      {clSaved && (() => {
        const posSource = clPositions.length > 0
          ? clPositions
          : (Array.isArray(clSaved.tyre_conditions) ? clSaved.tyre_conditions
            : (() => { try { return JSON.parse(clSaved.findings || '[]') } catch { return [] } })())
        if (!Array.isArray(posSource) || posSource.length === 0) return null
        return (
          <div
            ref={checklistPdfDiagramRef}
            aria-hidden
            style={{ position: 'fixed', left: -9999, top: 0, width: 360, opacity: 0, pointerEvents: 'none' }}
          >
            <VehicleTyreDiagram
              vehicleType={clFleetInfo?.vehicle_type || clSaved.vehicle_type
                || inferVehicleTypeFromAsset(clAsset || clSaved.asset_no) || 'Pickup'}
              positions={posSource.map(p => ({
                position: p.position,
                risk_level: p.risk_level
                  || (p.condition === 'Good' ? 'good'
                    : p.condition === 'Wear' ? 'warning'
                    : (p.condition === 'Damage' || p.condition === 'Puncture') ? 'critical'
                    : 'none'),
              }))}
              width={340}
            />
          </div>
        )
      })()}
    </div>
  )
}

function PositionSheet({ pos, posIdx, total, isLast, unfilledCount, allFilled, lang, onUpdate, onNext, onPrev, onClose }) {
  const { t } = useLanguage()
  const L = CHECKLIST_LABELS[lang]
  const isPuncture = pos.condition === 'Puncture'
  const showPunctureAlert = isPuncture

  function handleConditionSelect(cond) {
    onUpdate('condition', cond)
    if (cond === 'Puncture' || cond === 'Damage') {
      vibrate([100, 50, 100, 50, 200]) // double buzz for critical
    } else {
      vibrate(40) // light tap for good/wear
    }
  }

  const nextLabel = isLast
    ? allFilled ? t('inspections.position.allDone') : t('inspections.position.fillMore', { count: unfilledCount })
    : t('inspections.position.next')
  const nextBg = isLast && allFilled ? '#166534' : '#16a34a'

  return (
    <div className="fixed inset-0 z-50" style={{ touchAction: 'none' }}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl"
        style={{
          background: '#ffffff',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
        }}
      >
        {/* drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 rounded-full" style={{ background: '#e5e7eb' }} />
        </div>

        <div className="px-5 pt-2">
          {/* header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span
                className="text-base font-mono font-bold px-3 py-1.5 rounded-xl"
                style={{
                  background: isPuncture ? '#fef2f2' : '#f0fdf4',
                  color: isPuncture ? '#991b1b' : '#166534',
                  border: `1.5px solid ${isPuncture ? '#fca5a5' : '#86efac'}`,
                }}
              >
                {pos.label || pos.position}
              </span>
              <span className="text-sm font-medium" style={{ color: '#9ca3af' }}>
                {posIdx + 1} / {total}
                {unfilledCount > 0 && <span className="ml-2 text-xs" style={{ color: '#d97706' }}>{t('inspections.position.unfilled', { count: unfilledCount })}</span>}
              </span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full"
              style={{ background: '#f3f4f6', color: '#6b7280' }}
            >
              <X size={15} />
            </button>
          </div>

          {/* puncture alert banner */}
          {showPunctureAlert && (
            <div className="mb-3 px-3 py-2.5 rounded-xl flex items-center gap-2 text-sm font-semibold"
              style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#991b1b' }}>
              {t('inspections.position.punctureAlert')}
            </div>
          )}

          {/* condition */}
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2.5" style={{ color: '#9ca3af' }}>
            {L.condition}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {[
              { cond: 'Good',     emoji: '✅', activeBg: '#f0fdf4', activeBorder: '#22c55e', activeText: '#166534', label: L.good     },
              { cond: 'Wear',     emoji: '⚠️', activeBg: '#fefce8', activeBorder: '#eab308', activeText: '#854d0e', label: L.wear     },
              { cond: 'Damage',   emoji: '❌', activeBg: '#fef2f2', activeBorder: '#ef4444', activeText: '#991b1b', label: L.damage   },
              { cond: 'Puncture', emoji: '🔴', activeBg: '#fff1f2', activeBorder: '#dc2626', activeText: '#7f1d1d', label: L.puncture },
            ].map(({ cond, emoji, activeBg, activeBorder, activeText, label }) => {
              const on = pos.condition === cond
              return (
                <button
                  key={cond}
                  onClick={() => handleConditionSelect(cond)}
                  className="py-3 rounded-2xl flex flex-col items-center gap-1.5 transition-all active:scale-95"
                  style={{
                    background:   on ? activeBg : '#f9fafb',
                    border:       `2px solid ${on ? activeBorder : '#e5e7eb'}`,
                    color:        on ? activeText : '#9ca3af',
                  }}
                >
                  <span className="text-xl leading-none">{emoji}</span>
                  <span className="text-[10px] font-bold">{label}</span>
                </button>
              )
            })}
          </div>

          {/* psi */}
          <div className="mb-5">
            <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block" style={{ color: '#9ca3af' }}>
              {L.pressure}
            </label>
            <input
              type="number"
              inputMode="numeric"
              placeholder="PSI"
              value={pos.pressure}
              onChange={e => onUpdate('pressure', e.target.value)}
              className="w-full px-3 py-3 rounded-xl text-sm font-semibold"
              style={{ background: '#f9fafb', border: '1.5px solid #e5e7eb', color: '#111827', outline: 'none' }}
              onFocus={e => { e.target.style.borderColor = '#22c55e'; e.target.style.boxShadow = '0 0 0 3px rgba(34,197,94,0.12)' }}
              onBlur={e  => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none' }}
            />
          </div>
          {/* tread disabled - re-enable when data collection is ready
          <div className="mb-5">
            <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block" style={{ color: '#9ca3af' }}>
              {L.tread}
            </label>
            <input type="number" inputMode="decimal" placeholder="mm" value={pos.treadDepth}
              onChange={e => onUpdate('treadDepth', e.target.value)}
              className="w-full px-3 py-3 rounded-xl text-sm font-semibold"
              style={{ background: '#f9fafb', border: '1.5px solid #e5e7eb', color: '#111827', outline: 'none' }}
              onFocus={e => { e.target.style.borderColor = '#22c55e'; e.target.style.boxShadow = '0 0 0 3px rgba(34,197,94,0.12)' }}
              onBlur={e  => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none' }}
            />
          </div> */}

          {/* navigation */}
          <div className="flex gap-2.5">
            {posIdx > 0 && (
              <button
                onClick={onPrev}
                className="flex-1 py-3 rounded-2xl text-sm font-bold"
                style={{ background: '#f3f4f6', color: '#374151', border: '1.5px solid #e5e7eb' }}
              >
                {t('inspections.position.prev')}
              </button>
            )}
            <button
              onClick={onNext}
              className="flex-[2] py-3 rounded-2xl text-sm font-bold text-[var(--text-primary)]"
              style={{ background: nextBg }}
            >
              {nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RaiseActionModal({ row, onConfirm, onClose }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState(`Action: ${row.title}`)
  return (
    <Modal onClose={onClose}>
      <h3 className="text-lg font-bold text-[var(--text-primary)] mb-4">{t('inspections.raiseModal.title')}</h3>
      <p className="text-[var(--text-secondary)] text-sm mb-4">
        {t('inspections.raiseModal.desc')}
      </p>
      <div className="mb-4">
        <label className="label">{t('inspections.raiseModal.actionTitle')}</label>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
      </div>
      <div className="bg-[var(--surface-2)] rounded-lg p-3 text-xs text-[var(--text-secondary)] mb-4 space-y-1">
        <p><span className="text-[var(--text-muted)]">{t('inspections.raiseModal.site')}</span> {row.site}</p>
        <p><span className="text-[var(--text-muted)]">{t('inspections.raiseModal.asset')}</span> {row.asset_no || '-'}</p>
        <p><span className="text-[var(--text-muted)]">{t('inspections.raiseModal.priority')}</span> {row.severity === 'Critical' ? 'Critical' : row.severity === 'High' ? 'High' : 'Medium'}</p>
        {row.findings && <p><span className="text-[var(--text-muted)]">{t('inspections.raiseModal.findings')}</span> {row.findings.slice(0, 100)}{row.findings.length > 100 ? '...' : ''}</p>}
      </div>
      <div className="flex gap-3">
        <button onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
        <button onClick={() => onConfirm(title)} className="btn-primary flex-1">{t('inspections.raiseModal.raiseAction')}</button>
      </div>
    </Modal>
  )
}

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
        {children}
      </div>
    </div>
  )
}
