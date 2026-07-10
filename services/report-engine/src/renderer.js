// ─────────────────────────────────────────────────────────────────────────────
// renderer.js — HTML → PDF via a shared, lazily-launched Chromium instance.
//
// One browser is reused across requests (launch is expensive); each request gets
// its own isolated page/context. Concurrency is bounded so a burst of requests
// cannot exhaust memory. Callers pass a validated ReportDefinition.
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright'
import { buildReportHtml, footerTemplate } from './templates/reportTemplate.js'

let _browserPromise = null
const MAX_CONCURRENT = Number(process.env.REPORT_MAX_CONCURRENCY || 3)
let _active = 0
const _queue = []

async function getBrowser() {
  if (!_browserPromise) {
    _browserPromise = chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  }
  return _browserPromise
}

function acquireSlot() {
  if (_active < MAX_CONCURRENT) {
    _active++
    return Promise.resolve()
  }
  return new Promise((resolve) => _queue.push(resolve))
}
function releaseSlot() {
  _active--
  const next = _queue.shift()
  if (next) {
    _active++
    next()
  }
}

/**
 * @param {import('./reportSchema.js').ReportDefinition} def
 * @returns {Promise<Buffer>} the PDF bytes
 */
export async function renderPdf(def) {
  await acquireSlot()
  const browser = await getBrowser()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    // Chart images are inline data URLs and logos may be remote; give the network
    // a moment but never hang forever on a slow logo host.
    await page.setContent(buildReportHtml(def), { waitUntil: 'networkidle', timeout: 15000 })
    return await page.pdf({
      format: 'A4',
      landscape: def.orientation !== 'portrait',
      printBackground: true,
      margin: { top: '10mm', bottom: '14mm', left: '8mm', right: '8mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(def),
    })
  } finally {
    await context.close()
    releaseSlot()
  }
}

export async function closeBrowser() {
  if (_browserPromise) {
    const b = await _browserPromise
    await b.close()
    _browserPromise = null
  }
}
