// PDF timing and equivalence harness driver. Synthetic data only; never touches a real project.
//
//   export PDF_HARNESS_OUT=/some/folder/outside/the/repository
//   node e2e/pdf/make_photos.mjs "$PDF_HARNESS_OUT/photos"
//   npx vite build --config e2e/pdf/vite.config.mjs
//   node e2e/pdf/run.mjs            # writes $PDF_HARNESS_OUT/results.json and prints a summary
//
// Measures, in headless Chromium, with the REAL generator and renderer hook:
//   - library load, photo download, decode/resize, and total generation for 4 / 12 / 14 photos
//   - the same under simulated network profiles (photos are served locally, so the profile
//     is what stands in for a real connection) and under a 4x CPU slowdown
//   - first download (generate + store) versus repeat download (stored) through getOrCreatePdf
//   - two people asking at once, and a bulk ZIP
//   - that the generator output is unchanged by caching (text and image count per page)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './browser.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = process.env.PDF_HARNESS_OUT
if (!out) throw new Error('Set PDF_HARNESS_OUT')
const port = Number(process.env.PDF_HARNESS_PORT || 5197)
const base = `http://127.0.0.1:${port}`

const server = spawn('npx', ['vite', 'preview', '--config', path.join(here, 'vite.config.mjs')], { env: process.env, stdio: 'ignore', detached: true })
const stop = () => { try { process.kill(-server.pid) } catch { /* already gone */ } }
process.on('exit', stop)
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)) }

const browser = await launch()
async function open({ net = null, cpu = 1, fixedTime = null } = {}) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('PAGE ERROR', e.message))
  if (fixedTime) await page.clock.setFixedTime(new Date(fixedTime))
  const cdp = await ctx.newCDPSession(page)
  if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down * 125000, uploadThroughput: net.up * 125000 })
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  await page.goto(base)
  await page.waitForFunction(() => window.__ready === true)
  return { page, close: () => ctx.close() }
}
const call = (page, fn, ...args) => page.evaluate(([f, a]) => window.__h[f](...a), [fn, args])
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const results = { generatedAt: new Date().toISOString(), note: 'Synthetic inspections and synthetic photos. Headless Chromium on the build machine; photos served from localhost.' }

// 1. cold library load
{ const { page, close } = await open(); results.libLoadColdMs = await call(page, 'libLoad'); results.libLoadWarmMs = await call(page, 'libLoad'); await close() }

// 2. generation, local network, per photo count (first = cold libraries, then 3 warm runs)
results.generation = []
for (const n of [4, 12, 14]) {
  const { page, close } = await open()
  const cold = await call(page, 'generate', n)
  const warm = []
  for (let i = 0; i < 3; i++) warm.push(await call(page, 'generate', n))
  const shrink = await call(page, 'shrinkOnly', n)
  const w = warm[Math.floor(warm.length / 2)]
  results.generation.push({ photos: n, coldTotalMs: cold.totalMs, warmTotalMs: median(warm.map((x) => x.totalMs)), photoDownloadMs: median(warm.map((x) => x.photoDownloadMs)),
    decodeResizeMs: shrink, sha256Ms: w.sha256Ms, photoBytes: w.photoBytes, pdfBytes: w.pdfBytes, warnings: w.warnings.length })
  await close()
}

// 3. the same 12-photo report under simulated connections and a slower processor
results.profiles = []
for (const p of [
  { name: 'office wifi (20 Mbps down, 40 ms)', net: { down: 20, up: 10, latency: 40 }, cpu: 1 },
  { name: 'site 4G (9 Mbps down, 170 ms)', net: { down: 9, up: 3, latency: 170 }, cpu: 1 },
  { name: 'weak 3G (1.6 Mbps down, 300 ms)', net: { down: 1.6, up: 0.75, latency: 300 }, cpu: 1 },
  { name: 'office wifi, 4x slower processor', net: { down: 20, up: 10, latency: 40 }, cpu: 4 },
]) {
  const { page, close } = await open(p)
  await call(page, 'libLoad')
  const runs = []
  for (let i = 0; i < 2; i++) runs.push(await call(page, 'generate', 12))
  results.profiles.push({ profile: p.name, photos: 12, totalMs: median(runs.map((x) => x.totalMs)), photoDownloadMs: median(runs.map((x) => x.photoDownloadMs)) })
  await close()
}

// 4. first versus repeat download through the cache service (each backend call costs `latency` ms)
results.flow = []
for (const [n, net] of [[4, { down: 20, up: 10, latency: 40 }], [12, { down: 20, up: 10, latency: 40 }], [14, { down: 20, up: 10, latency: 40 }], [12, { down: 9, up: 3, latency: 170 }]]) {
  const { page, close } = await open({ net })
  await call(page, 'libLoad')
  const f = await call(page, 'flow', n, net.latency * 2)       // request + response
  results.flow.push({ photos: n, roundTripMs: net.latency * 2, firstMs: f.first.ms, firstStored: f.first.stored, firstCalls: f.first.calls.filter((c) => /pdf_cache|upload|sign/.test(c)),
    repeatMs: f.second.ms, repeatCached: f.second.cached, repeatCalls: f.second.calls.filter((c) => /pdf_cache|upload|sign/.test(c)), thirdMs: f.third.ms, verifiedBytes: f.verifiedBytes })
  await close()
}

// 5. two people at once; bulk ZIP
{ const { page, close } = await open(); await call(page, 'libLoad')
  results.concurrent = await call(page, 'concurrent', 12, 60)
  results.bulk = [await call(page, 'bulk', 20, 20, 60), await call(page, 'bulk', 20, 10, 60), await call(page, 'bulk', 50, 50, 60)]
  results.observation = await call(page, 'observation', 12).then((o) => ({ photos: o.photos, totalMs: o.totalMs, photoDownloadMs: o.photoDownloadMs, pdfBytes: o.pdfBytes, warnings: o.warnings }))
  await close() }

// 6. the documents are unchanged by caching: same text and image count on every page
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
async function describe(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const text = (await page.getTextContent()).items.map((it) => it.str).join('|')
    const ops = await page.getOperatorList()
    const images = ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject).length
    pages.push({ text, images, ops: ops.fnArray.length })
  }
  return pages
}
{ const { page, close } = await open({ fixedTime: '2026-11-15T10:00:00Z' })
  const a = await describe(await call(page, 'inspectionBytes', 12, false))
  const b = await describe(await call(page, 'inspectionBytes', 12, true))
  const saved = await call(page, 'observationSaved', 12)
  const o1 = await describe(saved.bytes)
  const o2 = await describe((await call(page, 'observation', 12)).bytes)
  const same = (x, y) => x.length === y.length && x.every((p, i) => p.text === y[i].text && p.images === y[i].images && p.ops === y[i].ops)
  results.equivalence = {
    inspection: { pages: a.length, images: a.reduce((s, p) => s + p.images, 0), textChars: a.reduce((s, p) => s + p.text.length, 0), identical: same(a, b) },
    observation: { pages: o1.length, images: o1.reduce((s, p) => s + p.images, 0), textChars: o1.reduce((s, p) => s + p.text.length, 0), identical: same(o1, o2), savedName: saved.name },
  }
  await close() }

await browser.close(); stop()
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
const bad = !results.equivalence.inspection.identical || !results.equivalence.observation.identical
  || results.concurrent.generations !== 1 || results.flow.some((f) => !f.repeatCached || !f.firstStored)
if (bad) { console.error('HARNESS CHECK FAILED'); process.exit(1) }
console.log('HARNESS CHECKS PASSED')
