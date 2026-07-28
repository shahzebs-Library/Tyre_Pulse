/**
 * The Accident Analytics report as PowerPoint.
 *
 * WHY IT EXISTS: the deck and the PDF used to be different reports. The Report
 * Builder had a PPTX export of its own block layout, so anyone comparing the two
 * found the same title over different content. This renders the SAME payload the
 * PDF renders - the same charts, the same KPI tiles with the same basis notes,
 * the same caveats - so the two cannot drift.
 *
 * The chart images are captured once by the caller and handed in, so a chart
 * shown on screen, printed and presented are all the same picture.
 *
 * 16:9, one chart per slide. A slide is read from across a room, so cramming
 * four onto it would repeat exactly the mistake that made the PDF unreadable.
 */

const INK = '0F172A'
const MUTED = '475569'
const ACCENT = 'EA580C'
const AMBER = 'B45309'
const LINE = 'E2E8F0'

/** 16:9 at pptxgenjs's default 10 x 5.625 inch. */
const W = 10
const H = 5.625

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

/**
 * @param {object} payload            from buildAnalyticsPayload()
 * @param {Array}  payload.chartList  [{key,title,data,chart}]
 * @param {Array}  payload.kpis       [[label, value, basisNote]]
 * @param {object} payload.intel      buildAccidentIntelligence result
 * @param {object} opts
 * @param {(c:object)=>string|null} opts.imageFor   chart -> PNG data URL
 * @param {(data:object)=>string}   opts.digestFor  chart data -> one-line digest
 * @param {string} opts.filename
 * @param {boolean} [opts.save=true]  false returns base64 for e-mailing
 */
export async function renderAccidentAnalyticsPptx(payload, opts = {}) {
  const { chartList = [], kpis = [], intel = {}, company = 'TyrePulse', stamp = '', scope = '', total = 0 } = payload || {}
  const { imageFor, digestFor, filename = 'Accident Analytics', save = true } = opts

  const { default: PptxGen } = await import('pptxgenjs')
  const pptx = new PptxGen()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = company
  pptx.title = 'Accident Analytics Summary'

  const footer = (slide, note) => {
    slide.addShape(pptx.ShapeType.line, {
      x: 0.5, y: H - 0.55, w: W - 1, h: 0, line: { color: LINE, width: 1 },
    })
    slide.addText(clean(note || `${company}  |  ${stamp}  |  ${scope}`), {
      x: 0.5, y: H - 0.5, w: W - 1, h: 0.3, fontSize: 9, color: MUTED,
    })
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  const title = pptx.addSlide()
  title.addText('Accident Analytics Summary', {
    x: 0.6, y: 1.6, w: W - 1.2, h: 0.9, fontSize: 34, bold: true, color: INK,
  })
  title.addText(clean(`${company}   ·   ${total} incidents   ·   ${scope}   ·   ${stamp}`), {
    x: 0.6, y: 2.5, w: W - 1.2, h: 0.5, fontSize: 14, color: MUTED,
  })
  footer(title, 'Generated from Tyre Pulse. Figures carry the number of incidents they are measured on.')

  // ── KPI slide. Two rows of four, matching the PDF exactly. ─────────────────
  if (kpis.length) {
    const k = pptx.addSlide()
    k.addText('Headline figures', { x: 0.5, y: 0.35, w: W - 1, h: 0.5, fontSize: 22, bold: true, color: INK })
    const perRow = 4
    const cw = (W - 1) / perRow
    const ch = 1.35
    kpis.forEach(([label, value, basis], i) => {
      const col = i % perRow
      const row = Math.floor(i / perRow)
      const x = 0.5 + col * cw
      const y = 1.15 + row * (ch + 0.25)
      k.addShape(pptx.ShapeType.roundRect, {
        x: x + 0.05, y, w: cw - 0.1, h: ch, fill: { color: 'F8FAFC' },
        line: { color: LINE, width: 1 }, rectRadius: 0.06,
      })
      k.addText(clean(value), {
        x: x + 0.05, y: y + 0.12, w: cw - 0.1, h: 0.5,
        fontSize: 20, bold: true, color: INK, align: 'center', shrinkText: true,
      })
      k.addText(clean(label).toUpperCase(), {
        x: x + 0.05, y: y + 0.62, w: cw - 0.1, h: 0.3,
        fontSize: 9, color: MUTED, align: 'center',
      })
      // The basis is the whole reason this deck is trustworthy; it is not
      // decoration and it is not dropped to make the slide tidier.
      if (basis) {
        k.addText(clean(basis), {
          x: x + 0.05, y: y + 0.92, w: cw - 0.1, h: 0.3,
          fontSize: 8, color: AMBER, align: 'center', italic: true,
        })
      }
    })
    footer(k)
  }

  // ── One chart per slide, with its digest underneath ────────────────────────
  for (const c of chartList) {
    const img = typeof imageFor === 'function' ? imageFor(c) : null
    const slide = pptx.addSlide()
    slide.addText(clean(c.title), {
      x: 0.5, y: 0.3, w: W - 1, h: 0.45, fontSize: 20, bold: true, color: INK,
    })
    if (img) {
      slide.addImage({ data: img, x: 0.7, y: 0.9, w: W - 1.4, h: H - 2.0 })
    } else {
      slide.addText('This chart could not be captured.', {
        x: 0.7, y: 2.4, w: W - 1.4, h: 0.5, fontSize: 12, color: MUTED, align: 'center',
      })
    }
    const digest = typeof digestFor === 'function' ? digestFor(c.data) : ''
    footer(slide, digest || `${company}  |  ${stamp}  |  ${scope}`)
  }

  // ── What the figures rest on. The slide people forget to include. ──────────
  const caveats = intel.caveats || []
  const repeats = intel.repeats || []
  const dups = intel.duplicates || []
  if (caveats.length || repeats.length || dups.length) {
    const s = pptx.addSlide()
    s.addText('What these figures rest on', {
      x: 0.5, y: 0.35, w: W - 1, h: 0.5, fontSize: 22, bold: true, color: INK,
    })
    let y = 1.0
    const block = (heading, items, colour = INK) => {
      if (!items.length || y > H - 1.2) return
      s.addText(heading, { x: 0.5, y, w: W - 1, h: 0.3, fontSize: 12, bold: true, color: ACCENT })
      y += 0.34
      const shown = items.slice(0, Math.max(1, Math.floor((H - 1.1 - y) / 0.3)))
      s.addText(shown.map((t) => ({ text: clean(t), options: { bullet: true, breakLine: true } })), {
        x: 0.6, y, w: W - 1.2, h: shown.length * 0.3, fontSize: 10.5, color: colour,
      })
      y += shown.length * 0.3 + 0.16
    }
    block('Read these first', caveats.map((c) => c.text))
    block('Vehicles in more than one incident', repeats.slice(0, 6).map((r) =>
      `${r.asset}: ${r.incidents} incidents, ${r.first} to ${r.last}`
      + (r.meanGapDays != null ? `, about ${r.meanGapDays} days apart` : '')), MUTED)
    block('Same vehicle and day, worth a check', dups.slice(0, 6).map((d) =>
      `${d.asset} on ${d.date}: ${d.count} records, `
      + (d.identical ? 'nothing distinguishes them' : `differ on ${d.differingFields.join(', ')}`)), MUTED)
    footer(s)
  }

  if (save === false) return pptx.write({ outputType: 'base64' })
  await pptx.writeFile({ fileName: `${filename}.pptx` })
  return null
}
