/**
 * ShareBlockView - renders ONE custom-board block on a white report surface.
 *
 * The SINGLE renderer shared by the public TV viewer (src/pages/ReportShare.jsx,
 * custom-board mode) and the builder live preview
 * (src/components/display/ReportShareBuilder.jsx). It takes a block + the aggregate
 * snapshot, resolves the block's data via the pure engine
 * (src/lib/reportShareLayout.resolveBlock), and paints a KPI tile / chart / gauge /
 * heatmap / table / heading. Charts come from the shared light option builders
 * (src/lib/reportShareCharts) so a block looks the same everywhere.
 *
 * Styling is inline + pinned light (white card, dark text) so the block renders
 * identically on the public light board and inside the dark app builder preview.
 * It always fills its container (height 100%), so a board grid cell sizes it. No
 * em / en dashes, arrows, middle dots or curly quotes.
 */
import EChart from '../charts/EChart'
import { resolveBlock } from '../../lib/reportShareLayout'
import {
  fmtInt, sparkOption, comboOption, claimsOption, seriesOption,
  breakdownOption, gaugeOption, heatmapOption,
} from '../../lib/reportShareCharts'

const CARD = {
  height: '100%', width: '100%', minHeight: 0, minWidth: 0,
  display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
  background: '#ffffff', border: '1px solid rgba(16,24,40,0.10)', borderRadius: 14,
  padding: 14, boxShadow: '0 1px 3px rgba(16,24,40,0.06)', overflow: 'hidden',
}
const TITLE = { fontSize: 13, fontWeight: 700, color: '#334155', margin: 0, letterSpacing: 0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const BODY = { flex: 1, minHeight: 0, position: 'relative' }
const EMPTY = { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 8 }

function priorityTone(p) {
  const k = String(p || '').toLowerCase()
  if (k.includes('crit')) return { bg: '#fee2e2', fg: '#b91c1c' }
  if (k.includes('high')) return { bg: '#ffedd5', fg: '#c2410c' }
  if (k.includes('med')) return { bg: '#fef3c7', fg: '#b45309' }
  return { bg: '#f1f5f9', fg: '#475569' }
}
function statusTone(s) {
  const k = String(s || '').toLowerCase()
  if (k.includes('progress') || k.includes('open') || k.includes('await') || k.includes('assign')) return { bg: '#dbeafe', fg: '#1d4ed8' }
  if (k.includes('hold') || k.includes('pend') || k.includes('wait')) return { bg: '#fef3c7', fg: '#b45309' }
  if (k.includes('complete') || k.includes('closed') || k.includes('done')) return { bg: '#dcfce7', fg: '#15803d' }
  return { bg: '#f1f5f9', fg: '#475569' }
}
const safe = (v) => (v == null || v === '' ? 'N/A' : String(v))

function Empty({ text }) {
  return <div style={EMPTY}>{text || 'No data for this period.'}</div>
}

// ── KPI tile ────────────────────────────────────────────────────────────────────
function KpiBlock({ r }) {
  const hasSpark = Array.isArray(r.spark) && r.spark.length > 1 && r.spark.some((n) => Number(n) > 0)
  return (
    <div style={{ ...CARD, justifyContent: 'space-between' }}>
      <div style={{ ...TITLE, fontSize: 12, color: '#64748b' }}>{r.label}</div>
      <div style={{ fontSize: 'clamp(26px, 4.2vw, 52px)', fontWeight: 800, color: '#0f172a', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
        {fmtInt(r.value)}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {r.money ? 'value' : 'count'}
        </span>
        {hasSpark && (
          <div style={{ width: '58%', height: 30 }}>
            <EChart option={sparkOption(r.spark, r.accent || 0)} ariaLabel={`${r.label} trend`} style={{ height: 30, minHeight: 30 }} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Table (open job cards / PM due) ─────────────────────────────────────────────
function TableBlock({ r, title }) {
  const isPm = r.which === 'pm'
  const rows = Array.isArray(r.rows) ? r.rows : []
  const th = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, padding: '6px 8px', position: 'sticky', top: 0, background: '#f8fafc' }
  const td = { fontSize: 13, color: '#0f172a', padding: '6px 8px', borderTop: '1px solid #eef2f7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }
  const pill = (t) => ({ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: t.bg, color: t.fg })
  return (
    <div style={CARD}>
      {title && <div style={{ ...TITLE, marginBottom: 8 }}>{title}</div>}
      <div style={{ ...BODY, overflow: 'auto' }}>
        {rows.length === 0 ? <Empty text={isPm ? 'No maintenance due.' : 'No open job cards.'} /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              {isPm ? (
                <tr><th style={th}>Plan</th><th style={th}>Asset</th><th style={th}>Due</th><th style={th}>Priority</th></tr>
              ) : (
                <tr><th style={th}>Job Card</th><th style={th}>Asset</th><th style={th}>Site</th><th style={th}>Status</th><th style={th}>Priority</th></tr>
              )}
            </thead>
            <tbody>
              {rows.map((row, i) => isPm ? (
                <tr key={i}>
                  <td style={td}>{safe(row.name)}</td>
                  <td style={td}>{safe(row.asset_no)}</td>
                  <td style={td}>{safe(row.next_due)}</td>
                  <td style={td}><span style={pill(priorityTone(row.priority))}>{safe(row.priority)}</span></td>
                </tr>
              ) : (
                <tr key={i}>
                  <td style={td}>{safe(row.wo_no)}</td>
                  <td style={td}>{safe(row.asset_no)}</td>
                  <td style={td}>{safe(row.site)}</td>
                  <td style={td}><span style={pill(statusTone(row.status))}>{safe(row.status)}</span></td>
                  <td style={td}><span style={pill(priorityTone(row.priority))}>{safe(row.priority)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Text / heading ──────────────────────────────────────────────────────────────
function TextBlock({ r }) {
  return (
    <div style={{ ...CARD, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: 'clamp(18px, 2.4vw, 30px)', fontWeight: 800, color: '#0f172a', lineHeight: 1.15 }}>
        {r.text || ' '}
      </div>
    </div>
  )
}

// ── Chart card wrapper ──────────────────────────────────────────────────────────
function ChartCard({ title, showTitle, empty, emptyText, option, aria }) {
  return (
    <div style={CARD}>
      {showTitle && title && <div style={{ ...TITLE, marginBottom: 8 }}>{title}</div>}
      {empty ? <Empty text={emptyText} /> : (
        <div style={BODY}>
          <EChart option={option} ariaLabel={aria || title || 'chart'} style={{ height: '100%', minHeight: 0 }} />
        </div>
      )}
    </div>
  )
}

/**
 * @param {{ block: object, snapshot: object }} props
 */
export default function ShareBlockView({ block, snapshot }) {
  const r = resolveBlock(block, snapshot)
  const title = block?.showTitle === false ? '' : (block?.title || '')

  switch (r.kind) {
    case 'kpi':
      return <KpiBlock r={r} />
    case 'text':
      return <TextBlock r={r} />
    case 'table':
      return <TableBlock r={r} title={block?.showTitle === false ? '' : (block?.title || (r.which === 'pm' ? 'Maintenance Due' : 'Open Job Cards'))} />
    case 'series':
      return <ChartCard title={title} showTitle={block?.showTitle !== false} empty={r.empty} option={seriesOption(r.labels, r.data, r.viz, r.accent)} aria={title} />
    case 'breakdown':
      return <ChartCard title={title} showTitle={block?.showTitle !== false} empty={r.empty} option={breakdownOption(r.items, r.viz)} aria={title} />
    case 'combo':
      return <ChartCard title={title} showTitle={block?.showTitle !== false} empty={r.empty} option={comboOption(r.labels, r.spend, r.accidents)} aria={title} />
    case 'claims':
      return <ChartCard title={title} showTitle={block?.showTitle !== false} empty={r.empty} option={claimsOption(r.labels, r.claimed, r.recovered)} aria={title} />
    case 'heatmap':
      return <ChartCard title={title} showTitle={block?.showTitle !== false} empty={r.empty} emptyText="No incidents to map." option={heatmapOption(r.rows)} aria={title} />
    case 'gauge':
      return <ChartCard title={title} showTitle={block?.showTitle !== false} empty={false} option={gaugeOption(r.value, r.label, r.accent)} aria={title} />
    default:
      return <div style={CARD}><Empty text="Nothing to show." /></div>
  }
}
