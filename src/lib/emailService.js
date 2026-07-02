// emailService.js — Report email generation and delivery
import { supabase } from './supabase'

// jspdf is heavy (~400 KB) — load it on first use, never with the page chunk.
let jsPDF, autoTable
async function ensurePdf() {
  if (!jsPDF) {
    const [j, a] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    jsPDF = j.default
    autoTable = a.default
  }
}

/**
 * Generate a PDF report and return it as a base64 string.
 *
 * @param {string} title - Main report title
 * @param {string} subtitle - Subtitle / period label
 * @param {string[]} columns - Table column headers
 * @param {(string|number)[][]} rows - Table body rows
 * @param {[string, string][]} summaryRows - Optional KPI summary rows [label, value]
 * @returns {string} Base64-encoded PDF (no data URI prefix)
 */
export async function generateReportPdf(title, subtitle, columns, rows, summaryRows = []) {
  await ensurePdf()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // ── Header band ──────────────────────────────────────────────────────────────
  doc.setFillColor(15, 23, 42)        // slate-900
  doc.rect(0, 0, 297, 32, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('TyrePulse', 14, 13)

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(title, 14, 22)

  doc.setFontSize(8)
  doc.setTextColor(156, 163, 175)     // gray-400
  doc.text(subtitle, 14, 29)
  doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}`, 205, 29)

  // ── KPI summary table ────────────────────────────────────────────────────────
  let startY = 40
  if (summaryRows.length > 0) {
    autoTable(doc, {
      startY,
      head: [['Metric', 'Value']],
      body: summaryRows,
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 },
    })
    startY = (doc.lastAutoTable?.finalY ?? startY) + 10
  }

  // ── Main data table ──────────────────────────────────────────────────────────
  // Coerce every cell to a string so a stray number/undefined/object from a
  // caller can never make jsPDF-autoTable throw and break the emailed report.
  const safeBody = (rows || []).map(row =>
    Array.isArray(row) ? row.map(c => (c == null ? '' : String(c))) : row
  )
  autoTable(doc, {
    startY,
    head: [columns],
    body: safeBody,
    theme: 'striped',
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      overflow: 'linebreak',
      textColor: [30, 41, 59],        // slate-800
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: 255,
      fontSize: 9,
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
    didDrawPage: (hookData) => {
      // Repeat header band on continuation pages
      if (hookData.pageNumber > 1) {
        doc.setFillColor(15, 23, 42)
        doc.rect(0, 0, 297, 14, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.text('TyrePulse', 14, 9)
        doc.setFont('helvetica', 'normal')
        doc.text(title, 50, 9)
      }
    },
  })

  // ── Footer on every page ─────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(156, 163, 175)
    doc.text(
      `TyrePulse Fleet Intelligence — Confidential — Page ${i} of ${pageCount}`,
      14,
      202
    )
    doc.text('www.tyrepulse.app', 240, 202)
  }

  // Return base64 content only (no data URI prefix)
  return doc.output('datauristring').split(',')[1]
}

/**
 * Send a report email via the Supabase `send-email` Edge Function.
 *
 * @param {object} opts
 * @param {string|string[]} opts.to - Recipient email address(es)
 * @param {string} opts.subject - Email subject line
 * @param {string} opts.bodyHtml - HTML body content
 * @param {string|null} [opts.pdfBase64] - Base64 PDF attachment (optional)
 * @param {string} [opts.pdfName] - Attachment filename
 * @returns {Promise<{success: boolean, id: string}>}
 */
export async function sendReportEmail({ to, subject, bodyHtml, pdfBase64 = null, pdfName = 'tyrepulse-report.pdf' }) {
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: {
      to,
      subject,
      body: bodyHtml,
      ...(pdfBase64 ? {
        attachmentBase64: pdfBase64,
        attachmentName: pdfName,
        attachmentType: 'application/pdf',
      } : {}),
    },
  })

  if (error) throw new Error(error.message || 'Edge Function invocation failed')
  if (data?.error) throw new Error(data.error)

  return data
}

/**
 * Build a branded HTML email body from KPI data.
 *
 * @param {Record<string, string|number>} kpiData - Key/value metrics to display
 * @param {string} period - Report period label (e.g. "June 2026")
 * @returns {string} HTML string
 */
export function buildFleetSummaryEmail(kpiData, period) {
  const rows = Object.entries(kpiData)
    .map(([k, v]) => `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 10px 8px; color: #64748b; font-size: 14px;">${escapeHtml(String(k))}</td>
        <td style="padding: 10px 8px; color: #0f172a; font-weight: 600; font-size: 14px; text-align: right;">
          ${escapeHtml(String(v))}
        </td>
      </tr>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TyrePulse Fleet Report</title>
</head>
<body style="margin: 0; padding: 24px; background: #f1f5f9; font-family: Arial, Helvetica, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto;">

    <!-- Header -->
    <div style="background: #0f172a; padding: 28px 28px 20px; border-radius: 12px 12px 0 0;">
      <table style="width: 100%;">
        <tr>
          <td>
            <div style="color: #3b82f6; font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px;">
              TYREPULSE
            </div>
            <h1 style="color: #fff; margin: 0; font-size: 22px; font-weight: 700;">Fleet Intelligence Report</h1>
            <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 13px;">${escapeHtml(period)}</p>
          </td>
          <td style="text-align: right; vertical-align: top;">
            <div style="background: #1e3a5f; color: #93c5fd; font-size: 11px; padding: 4px 12px; border-radius: 20px; display: inline-block;">
              ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- KPI Section -->
    <div style="background: #fff; padding: 24px 28px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
      <h2 style="color: #1e293b; font-size: 15px; margin: 0 0 16px 0; font-weight: 600;">Key Performance Metrics</h2>
      <table style="width: 100%; border-collapse: collapse;">
        ${rows}
      </table>
    </div>

    <!-- Attachment notice -->
    ${Object.keys(kpiData).length > 0 ? `
    <div style="background: #eff6ff; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; padding: 16px 28px;">
      <p style="margin: 0; color: #1d4ed8; font-size: 13px;">
        <strong>📎 PDF Report Attached</strong> — A full detailed report with data tables is attached to this email.
      </p>
    </div>` : ''}

    <!-- Footer -->
    <div style="background: #f8fafc; padding: 20px 28px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
      <p style="color: #94a3b8; font-size: 11px; margin: 0; line-height: 1.6;">
        This report was generated automatically by <strong>TyrePulse Fleet Intelligence Platform</strong>.<br>
        This message is confidential and intended for the named recipient only.<br>
        &copy; ${new Date().getFullYear()} TyrePulse. All rights reserved.
      </p>
    </div>

  </div>
</body>
</html>`
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Escape characters that have special meaning in HTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
