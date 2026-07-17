/**
 * Inspection report PDF - builds a single-inspection PDF and shares it via the
 * device share sheet. Mirrors the HTML->PDF pattern used by app/(app)/reports.
 *
 * The tyre positions are rendered as an HTML layout grid + a per-position table,
 * each coloured by condition (Good=green, Worn=amber, Damaged/Puncture/Flat=red,
 * Missing=grey) so the shared report matches the in-app detail view exactly.
 */

import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { supabase } from './supabase'
import { getPositionsForVehicle } from './types'

// ── Condition colour system (semantic, fixed hex - shared with the detail view) ──
const COND_GREEN = '#16a34a'
const COND_AMBER = '#ca8a04'
const COND_RED = '#dc2626'
const COND_GREY = '#94a3b8'

/**
 * Resolve a display colour from a raw tyre condition (or legacy risk) value.
 * Accepts condition names (Good/Worn/Damaged/Puncture/Flat/Missing) and the
 * older risk vocabulary (none/low/medium/high/critical) so mixed data renders
 * consistently.
 */
export function conditionColor(raw: any): string {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s || s === 'none') return COND_GREY
  if (s.includes('good') || s === 'low') return COND_GREEN
  if (s.includes('worn') || s === 'medium') return COND_AMBER
  if (s.includes('miss')) return COND_GREY
  if (
    s.includes('damag') || s.includes('punct') || s.includes('flat') ||
    s === 'high' || s === 'critical'
  ) return COND_RED
  return COND_GREY
}

/** Best-effort human label for a recorded condition cell. */
export function conditionLabel(c: any): string {
  if (!c) return 'Not recorded'
  return String(c.condition ?? c.risk ?? 'Recorded')
}

export interface InspectionForReport {
  id?: string | null
  title?: string | null
  site?: string | null
  asset_no?: string | null
  vehicle_type?: string | null
  inspector?: string | null
  inspection_date?: string | null
  status?: string | null
  notes?: string | null
  tyre_conditions?: Record<string, any> | null
}

function esc(v: any): string {
  return v == null || v === ''
    ? '-'
    : String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function orderedPositions(insp: InspectionForReport): string[] {
  const conditions = insp.tyre_conditions ?? {}
  const layout = getPositionsForVehicle(insp.vehicle_type ?? '') ?? []
  const keys = Object.keys(conditions)
  // Preferred vehicle layout first, then any extra recorded positions not in it.
  const extra = keys.filter(k => !layout.includes(k))
  const ordered = [...layout.filter(p => keys.includes(p) || layout.length > 0), ...extra]
  return ordered.length ? ordered : keys
}

const css = `
  * { font-family: -apple-system, Helvetica, Arial, sans-serif; box-sizing: border-box; }
  body { color: #0f172a; padding: 24px; font-size: 12px; margin: 0; }
  h1  { font-size: 20px; margin: 0 0 2px; color: #0f172a; }
  h2  { font-size: 13px; color: #16a34a; border-bottom: 2px solid #dcfce7; padding-bottom: 4px; margin: 20px 0 8px; }
  .sub { color: #64748b; font-size: 11px; margin-bottom: 16px; }
  .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
  .mcard { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; min-width: 130px; }
  .ml { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .mv { font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #f8fafc; padding: 6px 8px; text-align: left; font-size: 11px; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
  .pos { font-weight: 800; }
  .cbadge { display: inline-block; padding: 2px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; color: #fff; }
  .grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .cell { border-radius: 8px; padding: 8px 10px; min-width: 90px; color: #fff; }
  .cell-pos { font-size: 13px; font-weight: 800; }
  .cell-cond { font-size: 11px; font-weight: 700; opacity: 0.95; margin-top: 2px; }
  .cell-sub { font-size: 10px; opacity: 0.9; margin-top: 2px; }
  .notes { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #334155; line-height: 18px; white-space: pre-wrap; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 4px 0 10px; font-size: 11px; color: #64748b; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  footer { margin-top: 24px; font-size: 10px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 10px; }
`

export function buildInspectionHtml(insp: InspectionForReport): string {
  const conditions = insp.tyre_conditions ?? {}
  const positions = orderedPositions(insp)
  const recorded = positions.filter(p => conditions[p])

  const dateLabel = insp.inspection_date || '-'
  const title = insp.title || 'Tyre Inspection'

  const legend = `
    <div class="legend">
      <span><span class="dot" style="background:${COND_GREEN}"></span>Good</span>
      <span><span class="dot" style="background:${COND_AMBER}"></span>Worn</span>
      <span><span class="dot" style="background:${COND_RED}"></span>Damaged / Puncture / Flat</span>
      <span><span class="dot" style="background:${COND_GREY}"></span>Missing / Not recorded</span>
    </div>`

  const grid = positions.length
    ? `<div class="grid">
        ${positions.map(pos => {
          const c = conditions[pos]
          const color = conditionColor(c?.condition ?? c?.risk)
          const sub = [
            c?.tread_depth_mm ? `${c.tread_depth_mm}mm` : (c?.tread_depth != null ? `${c.tread_depth}mm` : null),
            c?.pressure_psi ? `${c.pressure_psi} psi` : (c?.pressure != null ? `${c.pressure} psi` : null),
          ].filter(Boolean).join(' | ')
          return `<div class="cell" style="background:${color}">
            <div class="cell-pos">${esc(pos)}</div>
            <div class="cell-cond">${c ? esc(conditionLabel(c)) : 'Not recorded'}</div>
            ${sub ? `<div class="cell-sub">${esc(sub)}</div>` : ''}
          </div>`
        }).join('')}
      </div>`
    : `<p class="sub">No tyre positions recorded.</p>`

  const rows = recorded.length
    ? `<table>
        <tr><th>Position</th><th>Condition</th><th>Tread</th><th>Pressure</th><th>Serial</th><th>Notes</th></tr>
        ${recorded.map(pos => {
          const c = conditions[pos]
          const color = conditionColor(c?.condition ?? c?.risk)
          const tread = c?.tread_depth_mm ? `${c.tread_depth_mm} mm` : (c?.tread_depth != null ? `${c.tread_depth} mm` : '-')
          const pressure = c?.pressure_psi ? `${c.pressure_psi} psi` : (c?.pressure != null ? `${c.pressure} psi` : '-')
          const serial = c?.serial_number ?? c?.serial ?? '-'
          return `<tr>
            <td class="pos">${esc(pos)}</td>
            <td><span class="cbadge" style="background:${color}">${esc(conditionLabel(c))}</span></td>
            <td>${esc(tread)}</td>
            <td>${esc(pressure)}</td>
            <td>${esc(serial)}</td>
            <td>${esc(c?.notes)}</td>
          </tr>`
        }).join('')}
      </table>`
    : `<p class="sub">No tyre conditions were recorded for this inspection.</p>`

  return `<!doctype html><html><head><meta charset="utf-8"/><style>${css}</style></head><body>
    <h1>${esc(title)}</h1>
    <p class="sub">Tyre Inspection Report</p>
    <div class="meta">
      <div class="mcard"><div class="ml">Asset</div><div class="mv">${esc(insp.asset_no)}</div></div>
      <div class="mcard"><div class="ml">Vehicle Type</div><div class="mv">${esc(insp.vehicle_type)}</div></div>
      <div class="mcard"><div class="ml">Site</div><div class="mv">${esc(insp.site)}</div></div>
      <div class="mcard"><div class="ml">Date</div><div class="mv">${esc(dateLabel)}</div></div>
      <div class="mcard"><div class="ml">Inspector</div><div class="mv">${esc(insp.inspector)}</div></div>
      <div class="mcard"><div class="ml">Status</div><div class="mv">${esc(insp.status)}</div></div>
    </div>
    <h2>Tyre Layout (${positions.length})</h2>
    ${legend}
    ${grid}
    <h2>Recorded Conditions (${recorded.length})</h2>
    ${rows}
    ${insp.notes ? `<h2>Notes</h2><div class="notes">${esc(insp.notes)}</div>` : ''}
    <footer>Generated ${new Date().toLocaleString()} | TyrePulse Inspector</footer>
  </body></html>`
}

function safeFileName(insp: InspectionForReport): string {
  const raw = `Inspection ${insp.asset_no ?? ''} ${insp.inspection_date ?? ''}`.trim()
  return raw.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Inspection'
}

/** Build the PDF for an already-loaded inspection and open the share sheet. Throws on failure. */
export async function shareInspectionPdf(insp: InspectionForReport): Promise<void> {
  const html = buildInspectionHtml(insp)
  const { uri } = await Print.printToFileAsync({ html })
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: safeFileName(insp),
      UTI: 'com.adobe.pdf',
    })
  }
}

/** Fetch a synced inspection by id, then build + share its PDF. Throws on failure. */
export async function shareInspectionById(id: string): Promise<void> {
  const { data, error } = await supabase.from('inspections')
    .select('id,title,site,asset_no,vehicle_type,inspector,inspection_date,status,notes,tyre_conditions')
    .eq('id', id).single()
  if (error) throw error
  if (!data) throw new Error('Inspection not found.')
  await shareInspectionPdf(data as InspectionForReport)
}
