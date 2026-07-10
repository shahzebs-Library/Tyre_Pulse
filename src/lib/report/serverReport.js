// ─────────────────────────────────────────────────────────────────────────────
// serverReport.js — optional bridge to the server-side Playwright report engine.
//
// When VITE_REPORT_SERVICE_URL is set, PDF exports can be rendered server-side
// for print-grade layout (services/report-engine). This module POSTs the same
// report-definition payload the client engine builds and streams back a PDF.
// Callers are expected to fall back to the client engine on any thrown error, so
// a misconfigured or unreachable service never blocks the user.
// ─────────────────────────────────────────────────────────────────────────────

function serviceUrl() {
  const raw = import.meta.env?.VITE_REPORT_SERVICE_URL
  return raw ? String(raw).replace(/\/$/, '') : ''
}

/** True when a server report engine is configured. */
export function isServerReportsEnabled() {
  return serviceUrl().length > 0
}

/** Trigger a browser download of a Blob. */
function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Render a report definition to PDF via the server engine and download it.
 * @param {object} definition  payload from buildReportDefinition()
 * @throws when the service is not configured or returns a non-2xx response
 */
export async function generateServerPdf(definition) {
  const base = serviceUrl()
  if (!base) throw new Error('Report service not configured')

  const key = import.meta.env?.VITE_REPORT_API_KEY
  const res = await fetch(`${base}/reports/pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-Report-Key': key } : {}),
    },
    body: JSON.stringify(definition),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Report service ${res.status} ${detail.slice(0, 200)}`)
  }
  const blob = await res.blob()
  saveBlob(blob, `${definition.fileName || 'report'}.pdf`)
}
