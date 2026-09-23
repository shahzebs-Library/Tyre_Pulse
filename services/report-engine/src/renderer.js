// ─────────────────────────────────────────────────────────────────────────────
// renderer.js — HTML → PDF via a shared, lazily-launched Chromium instance.
//
// One browser is reused across requests (launch is expensive); each request gets
// its own isolated page/context. Concurrency is bounded so a burst of requests
// cannot exhaust memory. Callers pass a validated ReportDefinition.
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright'
import { isIP } from 'node:net'
import { buildReportHtml, footerTemplate } from './templates/reportTemplate.js'

export function allowedLogoUrl(value, origins) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password &&
      !isIP(url.hostname.replace(/^\[|\]$/g, '')) &&
      url.hostname.includes('.') && !url.hostname.endsWith('.local') &&
      !url.hostname.endsWith('.localhost') && origins.includes(url.origin)
  } catch { return false }
}

export async function routeReportImage(route, origins) {
  const request = route.request()
  if (request.method() !== 'GET' || request.resourceType() !== 'image' ||
      !allowedLogoUrl(request.url(), origins)) return route.abort('blockedbyclient')
  try {
    // Never follow redirects from even a trusted image origin.
    const response = await route.fetch({ maxRedirects: 0, timeout: 5000 })
    if (response.status() !== 200 ||
        !/^image\/(png|jpeg|gif|webp)(;|$)/i.test(response.headers()['content-type'] || '')) {
      return await route.abort('blockedbyclient')
    }
    return await route.fulfill({ response })
  } catch { return route.abort('failed') }
}

export function createPdfRenderer({
  launch = () => chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] }),
  maxConcurrent = Number(process.env.REPORT_MAX_CONCURRENCY || 3),
  logoOrigins = (process.env.REPORT_LOGO_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
} = {}) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) throw new Error('Invalid REPORT_MAX_CONCURRENCY')
  let _browserPromise = null
  let _active = 0
  const _queue = []

  async function getBrowser() {
    if (!_browserPromise) {
      const pending = Promise.resolve().then(launch).then(browser => {
        browser.on('disconnected', () => {
          if (_browserPromise === pending) _browserPromise = null
        })
        return browser
      }).catch(error => {
        if (_browserPromise === pending) _browserPromise = null
        throw error
      })
      _browserPromise = pending
    }
    return _browserPromise
  }

  function acquireSlot() {
    if (_active < maxConcurrent) {
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
  async function renderPdf(def) {
    const logo = def.branding?.logo_data || def.branding?.logo_url
    if (logo && !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo) &&
        !allowedLogoUrl(logo, logoOrigins)) throw new Error('Report logo origin is not allowed')
    await acquireSlot()
    let context
    try {
      const browser = await getBrowser()
      context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' })
      await context.route('**/*', route => routeReportImage(route, logoOrigins))
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
      try { await context?.close() } finally { releaseSlot() }
    }
  }

  async function closeBrowser() {
    const pending = _browserPromise
    _browserPromise = null
    if (pending) await (await pending).close()
  }
  return { renderPdf, closeBrowser }
}

const renderer = createPdfRenderer()
export const renderPdf = renderer.renderPdf
export const closeBrowser = renderer.closeBrowser
