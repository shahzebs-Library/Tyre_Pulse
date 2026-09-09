import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPdfRenderer, allowedLogoUrl, routeReportImage } from '../src/renderer.js'
import { parseReportDefinition } from '../src/reportSchema.js'

const definition = parseReportDefinition({ columns: [{ key: 'asset_no' }] })
function fakeBrowser({ newContext, close } = {}) {
  return {
    on() {}, close: async () => {},
    newContext: newContext || (async options => {
      assert.equal(options.javaScriptEnabled, false)
      assert.equal(options.serviceWorkers, 'block')
      return {
        route: async () => {},
        newPage: async () => ({ setContent: async () => {}, pdf: async () => Buffer.from('pdf') }),
        close: close || (async () => {}),
      }
    }),
  }
}

test('launch rejection releases capacity and retries launching', { timeout: 1000 }, async () => {
  let attempts = 0
  const renderer = createPdfRenderer({ maxConcurrent: 1, launch: async () => {
    if (++attempts === 1) throw new Error('launch failed')
    return fakeBrowser()
  } })
  await assert.rejects(renderer.renderPdf(definition), /launch failed/)
  assert.equal((await renderer.renderPdf(definition)).toString(), 'pdf')
  assert.equal(attempts, 2)
})

test('context creation failure releases capacity', { timeout: 1000 }, async () => {
  let attempts = 0
  const renderer = createPdfRenderer({ maxConcurrent: 1, launch: async () => fakeBrowser({ newContext: async () => {
    if (++attempts === 1) throw new Error('context failed')
    return fakeBrowser().newContext({ javaScriptEnabled: false, serviceWorkers: 'block' })
  } }) })
  await assert.rejects(renderer.renderPdf(definition), /context failed/)
  assert.equal((await renderer.renderPdf(definition)).toString(), 'pdf')
})

test('a disconnected browser is replaced for later requests', async () => {
  let disconnect
  let launches = 0
  const renderer = createPdfRenderer({ launch: async () => {
    launches++
    return { ...fakeBrowser(), on: (event, callback) => { assert.equal(event, 'disconnected'); disconnect = callback } }
  } })
  await renderer.renderPdf(definition)
  disconnect()
  await renderer.renderPdf(definition)
  assert.equal(launches, 2)
})

test('cleanup failure releases capacity for waiting requests', { timeout: 1000 }, async () => {
  let closes = 0
  const renderer = createPdfRenderer({ maxConcurrent: 1, launch: async () => fakeBrowser({ close: async () => {
    if (++closes === 1) throw new Error('close failed')
  } }) })
  const first = renderer.renderPdf(definition)
  const second = renderer.renderPdf(definition)
  await assert.rejects(first, /close failed/)
  assert.equal((await second).toString(), 'pdf')
})

test('remote logos require an exact public HTTPS origin and inline raster logos remain valid', async () => {
  const origins = ['https://images.example.com']
  assert.equal(allowedLogoUrl('https://images.example.com/logo.png', origins), true)
  for (const value of ['http://images.example.com/logo.png', 'https://images.example.com.evil.test/logo.png', 'https://127.0.0.1/logo.png', 'https://[::1]/logo.png', 'https://user:pass@images.example.com/logo.png', 'file:///etc/passwd']) {
    assert.equal(allowedLogoUrl(value, origins), false, value)
  }
  const renderer = createPdfRenderer({ launch: async () => fakeBrowser() })
  assert.equal(allowedLogoUrl('https://127.0.0.1/logo.png', ['https://127.0.0.1']), false)
  assert.equal(allowedLogoUrl('https://[::1]/logo.png', ['https://[::1]']), false)
  await assert.rejects(renderer.renderPdf({ ...definition, branding: { logo_url: 'https://images.example.com/logo.png' } }), /origin is not allowed/)
  const inline = parseReportDefinition({ ...definition, branding: { logo_data: 'data:image/png;base64,aGVsbG8=' } })
  assert.equal((await renderer.renderPdf(inline)).toString(), 'pdf')
  assert.throws(() => parseReportDefinition({ ...definition, branding: { logo_data: 'http://127.0.0.1/logo.png' } }))
})

test('image route blocks untrusted hosts and redirects without fetching redirect targets', async () => {
  let fetches = 0
  let fulfilled = 0
  let aborted = 0
  const route = {
    request: () => ({ method: () => 'GET', resourceType: () => 'image', url: () => 'https://images.example.com/logo.png' }),
    fetch: async options => {
      fetches++
      assert.equal(options.maxRedirects, 0)
      return { status: () => 302, headers: () => ({ location: 'http://127.0.0.1/private' }) }
    },
    abort: async () => { aborted++ },
    fulfill: async () => { fulfilled++ },
  }
  await routeReportImage(route, [])
  assert.equal(fetches, 0)
  await routeReportImage(route, ['https://images.example.com'])
  assert.equal(fetches, 1)
  assert.equal(aborted, 2)
  assert.equal(fulfilled, 0)
  route.fetch = async () => ({ status: () => 200, headers: () => ({ 'content-type': 'image/png' }) })
  await routeReportImage(route, ['https://images.example.com'])
  assert.equal(fulfilled, 1)
})
