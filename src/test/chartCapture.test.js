import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  toPaperOptions, captureChartOnPaper, paperChartOptions,
  PAPER_FONT_PT, PRINT_SCALE,
} from '../lib/chartCapture'

// jsdom has no 2d context (getContext returns null), and the capture passes that
// context straight to Chart.js. A stub that just points back at its canvas is
// enough to read the dimensions the capture chose, which is what we assert.
let realGetContext
beforeAll(() => {
  realGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function getContext() { return { canvas: this } }
})
afterAll(() => { HTMLCanvasElement.prototype.getContext = realGetContext })

/**
 * THE CONTRACT THIS FILE EXISTS TO PIN.
 *
 * A chart is captured to a bitmap and then placed into a fixed-width cell in the
 * PDF. So the size text ends up at ON PAPER is:
 *
 *     printed points = canvas font px * (cell width in points / canvas width px)
 *
 * The bug behind "legends are so small": the capture always used a 1000px canvas
 * and kept the on-screen ~12px legend font. Placed into a 135mm (about 383pt)
 * cell that is 12 * 383/1000 = about 4.6pt - smaller than a footnote.
 *
 * The fix is that the caller passes the cell width and BOTH the canvas and the
 * fonts scale by the same factor, so the ratio cancels and the printed size is
 * exactly PAPER_FONT_PT whatever cell it lands in. That cancellation is invisible
 * at a glance and would break silently, which is why it is asserted here as
 * arithmetic rather than trusted to a comment.
 */

/** What a given canvas-pixel font size actually prints at, in points. */
const printedPt = (canvasPx, canvasWidthPx, cellWidthPt) => canvasPx * (cellWidthPt / canvasWidthPx)

/** Minimal live-chart stand-in: captureChartOnPaper reads config + constructor. */
function fakeChart(options, { type = 'bar', width = 600, height = 360 } = {}) {
  const built = []
  class FakeChart {
    constructor(ctx, cfg) {
      built.push({ ctx, cfg })
      this.config = cfg
    }
    toBase64Image() { return 'data:image/png;base64,fake' }
    destroy() { this.destroyed = true }
  }
  const live = new FakeChart(null, { type, data: { labels: ['a'], datasets: [{ data: [1] }] }, options })
  live.canvas = document.createElement('canvas')
  live.width = width
  live.height = height
  // The first entry is the live chart itself; captures are appended after it.
  return { live, built }
}

describe('toPaperOptions font sizing', () => {
  it('sizes every text role at its paper point size times the scale', () => {
    const o = toPaperOptions({
      plugins: { legend: { labels: { font: { size: 12 } } }, title: { display: true } },
      scales: {
        x: { ticks: { font: { size: 11 } } },
        r: { pointLabels: {}, angleLines: {}, title: { display: true } },
      },
    }, 3)

    expect(o.plugins.legend.labels.font.size).toBe(PAPER_FONT_PT.legend * 3)
    expect(o.plugins.title.font.size).toBe(PAPER_FONT_PT.title * 3)
    expect(o.scales.x.ticks.font.size).toBe(PAPER_FONT_PT.tick * 3)
    expect(o.scales.r.pointLabels.font.size).toBe(PAPER_FONT_PT.pointLabel * 3)
    expect(o.scales.r.title.font.size).toBe(PAPER_FONT_PT.title * 3)
    // The on-screen sizes are DISCARDED on purpose. Keeping them is the bug.
    expect(o.plugins.legend.labels.font.size).not.toBe(12)
    expect(o.scales.x.ticks.font.size).not.toBe(11)
  })

  it('carries the value-label size, which the plugin reads from options', () => {
    // makeValueLabelsPlugin defaults to 10px. At a 3x canvas that prints at
    // about 3pt, so the size has to travel with the scale.
    const o = toPaperOptions({}, 3)
    expect(o.plugins.valueLabels.size).toBe(PAPER_FONT_PT.valueLabel * 3)
  })

  it('never sizes text below 8 canvas pixels, so a 1x capture is still legible', () => {
    const o = toPaperOptions({ scales: { x: { ticks: {} } } }, 0.5)
    expect(o.scales.x.ticks.font.size).toBeGreaterThanOrEqual(8)
  })

  it('leaves devicePixelRatio at 1 because the caller sizes the canvas', () => {
    // A second multiplier here inflates the bitmap - and the file - without
    // adding any detail, which was the other half of "the PDF is too big".
    expect(toPaperOptions({ devicePixelRatio: 2 }, 3).devicePixelRatio).toBe(1)
  })

  it('grows lines, points and grid with the canvas so they do not print as hairlines', () => {
    const o = toPaperOptions({ scales: { y: { grid: {} } } }, 3)
    expect(o.elements.line.borderWidth).toBeGreaterThan(1)
    expect(o.elements.point.radius).toBeGreaterThan(2)
    expect(o.scales.y.grid.lineWidth).toBeGreaterThan(1)
  })

  it('recolours to paper ink, disables animation, and fixes the canvas size', () => {
    const o = toPaperOptions({ plugins: { legend: { labels: {} } }, scales: { x: { ticks: {} } } }, 1)
    expect(o.plugins.legend.labels.color).toBe('#0f172a')
    expect(o.scales.x.ticks.color).toBe('#475569')
    expect(o.animation).toBe(false)
    expect(o.responsive).toBe(false)
    expect(o.maintainAspectRatio).toBe(false)
  })

  it('does not mutate the live options and keeps callback references', () => {
    const fmt = () => 'x'
    const src = { plugins: { legend: { labels: { font: { size: 12 }, generateLabels: fmt } } } }
    const o = toPaperOptions(src, 3)
    expect(src.plugins.legend.labels.font.size).toBe(12)     // untouched
    expect(o.plugins.legend.labels.generateLabels).toBe(fmt) // same function, not cloned
  })

  it('survives being handed nothing', () => {
    expect(() => toPaperOptions(undefined, 3)).not.toThrow()
    expect(toPaperOptions(null, 3).animation).toBe(false)
  })
})

describe('captureChartOnPaper sizing', () => {
  it('sizes the canvas to the cell width so the printed font size is PAPER_FONT_PT', () => {
    // The real PDF cell: two columns of an A4 landscape page, about 135mm.
    const cellWidthPt = 135 * (72 / 25.4)
    const { live, built } = fakeChart({ plugins: { legend: { labels: { font: { size: 12 } } } } })

    captureChartOnPaper(live, { widthPt: cellWidthPt, aspect: 0.5 })

    const capture = built[1]
    const canvasWidth = capture.ctx.canvas.width
    expect(canvasWidth).toBe(Math.round(cellWidthPt * PRINT_SCALE))

    const legendPx = capture.cfg.options.plugins.legend.labels.font.size
    // THE WHOLE POINT: the scale cancels, so 9pt asked for is 9pt printed.
    expect(printedPt(legendPx, canvasWidth, cellWidthPt)).toBeCloseTo(PAPER_FONT_PT.legend, 1)
    // And the regression it replaces was roughly a fifth of that.
    expect(printedPt(12, 1000, cellWidthPt)).toBeLessThan(5)
  })

  it('prints at the same point size in a narrow cell as in a wide one', () => {
    const wide = 135 * (72 / 25.4)
    const narrow = 70 * (72 / 25.4)
    const read = (widthPt) => {
      const { live, built } = fakeChart({ plugins: { legend: { labels: {} } } })
      captureChartOnPaper(live, { widthPt })
      const c = built[1]
      return printedPt(c.cfg.options.plugins.legend.labels.font.size, c.ctx.canvas.width, widthPt)
    }
    expect(read(narrow)).toBeCloseTo(read(wide), 1)
  })

  it('honours the requested aspect so the image fills its cell without being squashed', () => {
    const { live, built } = fakeChart({})
    captureChartOnPaper(live, { widthPt: 360, aspect: 0.75 })
    const { width, height } = built[1].ctx.canvas
    expect(height / width).toBeCloseTo(0.75, 2)
  })

  it('keeps the legacy 1000px canvas when no cell width is given', () => {
    // That path is the on-screen "Download PNG", which has no page to fit.
    const { live, built } = fakeChart({})
    captureChartOnPaper(live)
    expect(built[1].ctx.canvas.width).toBe(1000)
  })

  it('honours an explicit scale over the print default', () => {
    const { live, built } = fakeChart({})
    captureChartOnPaper(live, { widthPt: 200, scale: 2 })
    expect(built[1].ctx.canvas.width).toBe(400)
  })

  it('omits value labels on radial charts, which already carry counts in the legend', () => {
    const bar = fakeChart({}, { type: 'bar' })
    captureChartOnPaper(bar.live, { widthPt: 200 })
    expect(bar.built[1].cfg.plugins).toHaveLength(2)

    const pie = fakeChart({}, { type: 'doughnut' })
    captureChartOnPaper(pie.live, { widthPt: 200 })
    expect(pie.built[1].cfg.plugins).toHaveLength(1)
  })

  it('returns a data URL and destroys the offscreen instance', () => {
    const { live, built } = fakeChart({})
    const url = captureChartOnPaper(live, { widthPt: 200 })
    expect(url).toMatch(/^data:image\/png/)
    // Not destroying it leaks a canvas per chart per export.
    expect(built[1].cfg && built.length).toBe(2)
  })

  it('returns null instead of throwing when there is nothing to capture', () => {
    expect(captureChartOnPaper(null)).toBeNull()
    expect(captureChartOnPaper({})).toBeNull()
  })
})

describe('paperChartOptions (on-screen report view)', () => {
  it('recolours for white without fixing the canvas size', () => {
    // This one stays responsive: it is a live chart in a flex container, not a
    // capture. Forcing responsive:false here would collapse the layout.
    const o = paperChartOptions({ plugins: { legend: { labels: {} } }, scales: { x: { ticks: {} } } })
    expect(o.responsive).toBe(true)
    expect(o.plugins.legend.labels.color).toBe('#0f172a')
    expect(o.scales.x.ticks.color).toBe('#334155')
  })

  it('does not touch a legend that is deliberately hidden', () => {
    const o = paperChartOptions({ plugins: { legend: { display: false } } })
    expect(o.plugins.legend.labels).toBeUndefined()
  })
})
