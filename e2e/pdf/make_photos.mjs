// Synthetic tyre-like photos for the PDF timing harness, drawn on a canvas in headless
// Chromium. No real photo is used. Sized like what the phones upload (1280 px long edge;
// the production bucket averages about 0.21 MB per object).
import { launch } from './browser.mjs'
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2]
if (!out) throw new Error('usage: node make_photos.mjs <folder outside the repository>')
fs.mkdirSync(out, { recursive: true })
const browser = await launch()
const page = await browser.newPage()
let total = 0
for (let i = 1; i <= 14; i++) {
  const b64 = await page.evaluate((seed) => {
    let s = seed * 9973
    const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
    const c = document.createElement('canvas'); c.width = 1280; c.height = 960
    const g = c.getContext('2d')
    const base = 60 + Math.floor(rnd() * 60)
    g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, 1280, 960)
    for (let k = 0; k < 2600; k++) {
      const v = Math.floor(rnd() * 200)
      g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1 + rnd() * 4
      g.beginPath(); g.ellipse(rnd() * 1280, rnd() * 960, 2 + rnd() * 45, 2 + rnd() * 45, 0, 0, 7); g.stroke()
    }
    g.strokeStyle = '#0f0f0f'; g.lineWidth = 120; g.beginPath(); g.arc(640, 480, 340, 0, 7); g.stroke()
    const img = g.getImageData(0, 0, 1280, 960)
    for (let p = 0; p < img.data.length; p += 4) { const n = (rnd() - 0.5) * 34; img.data[p] += n; img.data[p + 1] += n; img.data[p + 2] += n }
    g.putImageData(img, 0, 0)
    return c.toDataURL('image/jpeg', 0.6).split(',')[1]
  }, i)
  const buf = Buffer.from(b64, 'base64')
  total += buf.length
  fs.writeFileSync(path.join(out, `photo_${i}.jpg`), buf)
}
await browser.close()
console.log(`14 photos, average ${Math.round(total / 14 / 1024)} KB`)
