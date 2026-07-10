// ─────────────────────────────────────────────────────────────────────────────
// reportTemplate.js — report-definition → branded HTML.
//
// Pure string builder (no Playwright), so it is unit-testable on its own. The
// renderer feeds the returned HTML to Chromium for the actual PDF. RTL is honoured
// when locale === 'ar'. All interpolated content is HTML-escaped to prevent
// markup injection from arbitrary cell values.
// ─────────────────────────────────────────────────────────────────────────────

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c])
}

function fmtCell(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return esc(v)
}

function safeColor(c, fallback) {
  return typeof c === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(c.replace('#', '')) ? (c.startsWith('#') ? c : `#${c}`) : fallback
}

/**
 * @param {import('../reportSchema.js').ReportDefinition} def
 * @returns {string} a complete HTML document
 */
export function buildReportHtml(def) {
  const rtl = def.locale === 'ar'
  const accent = safeColor(def.branding?.primary_color, '#16a34a')
  const logo = def.branding?.logo_data || def.branding?.logo_url || ''
  const footer = def.branding?.footer_text || `${def.company || 'Tyre Pulse'} · Confidential`

  const modeLabel = { current: 'Current View', filtered: 'Filtered Report', selected: 'Selected Rows' }[def.exportMode] || def.exportMode

  const filterChips = Object.entries(def.filtersSummary || {})
    .map(([k, v]) => `<span class="chip"><b>${esc(k)}:</b> ${esc(v)}</span>`)
    .join('')

  const kpis = (def.kpis || [])
    .map(
      (k) => `
      <div class="kpi">
        <div class="kpi-label">${esc(k.label)}</div>
        <div class="kpi-value">${esc(k.value)}</div>
        ${k.sub ? `<div class="kpi-sub">${esc(k.sub)}</div>` : ''}
      </div>`,
    )
    .join('')

  const charts = (def.charts || [])
    .map(
      (c) => `
      <figure class="chart">
        ${c.title ? `<figcaption>${esc(c.title)}</figcaption>` : ''}
        <img src="${esc(c.image)}" alt="${esc(c.title || 'chart')}" />
      </figure>`,
    )
    .join('')

  const thead = def.columns
    .map((c) => `<th class="al-${c.align || 'left'}">${esc(c.header || c.key)}</th>`)
    .join('')

  const tbody = def.rows
    .map(
      (row) =>
        `<tr>${def.columns
          .map((c) => `<td class="al-${c.align || 'left'}">${fmtCell(row[c.key])}</td>`)
          .join('')}</tr>`,
    )
    .join('')

  const emptyState = def.rows.length === 0
    ? `<div class="empty">No records for the selected filters.</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Helvetica Neue", Arial, "Segoe UI", sans-serif; color: #0f172a; font-size: 11px; }
  .wrap { padding: 18px 22px; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid var(--accent); padding-bottom: 12px; margin-bottom: 14px; }
  header .logo { height: 40px; max-width: 160px; object-fit: contain; }
  header .titles { flex: 1; }
  header h1 { margin: 0; font-size: 18px; color: #0f172a; }
  header .company { font-size: 10px; color: var(--accent); font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  header .meta { text-align: ${rtl ? 'left' : 'right'}; font-size: 9px; color: #64748b; line-height: 1.5; }
  .chips { margin: 0 0 12px; }
  .chip { display: inline-block; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 999px; padding: 2px 8px; margin: 0 6px 6px 0; font-size: 9px; color: #334155; }
  .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
  .kpi { flex: 1 1 140px; border: 1px solid #e2e8f0; border-top: 3px solid var(--accent); border-radius: 8px; padding: 8px 10px; background: #fff; }
  .kpi-label { font-size: 8.5px; text-transform: uppercase; letter-spacing: .5px; color: #94a3b8; font-weight: 700; }
  .kpi-value { font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 2px; }
  .kpi-sub { font-size: 8.5px; color: #64748b; margin-top: 2px; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  .chart { margin: 0; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; page-break-inside: avoid; }
  .chart figcaption { font-size: 9px; font-weight: 700; color: #475569; margin-bottom: 4px; }
  .chart img { width: 100%; height: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: var(--accent); color: #fff; text-align: ${rtl ? 'right' : 'left'}; padding: 6px 8px; font-size: 9.5px; }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #eef1f5; font-size: 9.5px; }
  tbody tr:nth-child(even) td { background: #f7fafc; }
  .al-right { text-align: ${rtl ? 'left' : 'right'}; }
  .al-center { text-align: center; }
  .empty { padding: 40px; text-align: center; color: #94a3b8; border: 1px dashed #cbd5e1; border-radius: 8px; }
  tr { page-break-inside: avoid; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      ${logo ? `<img class="logo" src="${esc(logo)}" alt="logo" />` : ''}
      <div class="titles">
        ${def.company ? `<div class="company">${esc(def.company)}</div>` : ''}
        <h1>${esc(def.title)}</h1>
      </div>
      <div class="meta">
        ${esc(modeLabel)} · ${def.rows.length.toLocaleString()} records<br/>
        ${def.dateRange ? esc(def.dateRange) + '<br/>' : ''}
        ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))}
      </div>
    </header>

    ${filterChips ? `<div class="chips">${filterChips}</div>` : ''}
    ${kpis ? `<div class="kpis">${kpis}</div>` : ''}
    ${charts ? `<div class="charts">${charts}</div>` : ''}

    ${emptyState || `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`}
  </div>
</body>
</html>`
}

/** Chromium footer template (page numbers + branded footer text). */
export function footerTemplate(def) {
  const footer = (def.branding?.footer_text || `${def.company || 'Tyre Pulse'} · Confidential`)
    .replace(/[<>]/g, '')
  return `<div style="width:100%;font-size:7px;color:#94a3b8;padding:0 12mm;display:flex;justify-content:space-between;">
    <span>${footer}</span>
    <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`
}
