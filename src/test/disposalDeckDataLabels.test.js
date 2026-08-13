import { describe, it, expect } from 'vitest'
import { slideChartConfig } from '../lib/assetDisposalDeckRender'

// The owner reported the disposal deck's PowerPoint charts had no data labels.
// Every surface - the builder preview, the captured PNG that becomes the slide,
// the offscreen render and the PDF - is driven by this one config object, so
// these assertions cover all four.
const slide = (viz) => ({ id: 's1', kind: 'chart', viz, title: 'Spend', labels: ['MP049', 'MP042'], values: [406470, 399402] })

describe('chart slides carry their numbers', () => {
  it('a bar chart enables value labels and ships the plugin that draws them', () => {
    const cfg = slideChartConfig(slide('bar'), { paper: true })
    expect(cfg.options.plugins.valueLabels.enabled).toBe(true)
    expect(cfg.plugins).toHaveLength(1)
    expect(cfg.plugins[0].id).toBe('valueLabels')
  })

  it('leaves room above the bars so the tallest label is not clipped', () => {
    const cfg = slideChartConfig(slide('bar'), { paper: true })
    expect(cfg.options.layout.padding.top).toBeGreaterThan(0)
  })

  it('a horizontal bar reserves room to the RIGHT, where its labels sit', () => {
    const cfg = slideChartConfig(slide('bar_h'), { paper: true })
    expect(cfg.options.layout.padding.right).toBeGreaterThan(0)
  })

  it('a doughnut puts its numbers in the legend, not on the slices', () => {
    const cfg = slideChartConfig(slide('doughnut'), { paper: true })
    expect(typeof cfg.options.plugins.legend.labels.generateLabels).toBe('function')
    // The slice plugin is deliberately absent: a number drawn inside a thin
    // slice is unreadable and collides with its neighbours.
    expect(cfg.plugins).toHaveLength(0)
    const legend = cfg.options.plugins.legend.labels.generateLabels({
      data: { labels: ['MP049', 'MP042'], datasets: [{ data: [406470, 399402], backgroundColor: ['#1', '#2'] }] },
    })
    expect(legend[0].text).toBe('MP049 (406,470)')
  })

  it('label ink follows paper vs screen, so it is legible on both', () => {
    const onPaper = slideChartConfig(slide('bar'), { paper: true }).options.plugins.valueLabels.color
    const onScreen = slideChartConfig(slide('bar'), { paper: false }).options.plugins.valueLabels.color
    expect(onPaper).not.toBe(onScreen)
  })

  it('label size scales with the print capture, not fixed at screen pixels', () => {
    const small = slideChartConfig(slide('bar'), { paper: true, fontScale: 1 }).options.plugins.valueLabels.size
    const big = slideChartConfig(slide('bar'), { paper: true, fontScale: 3 }).options.plugins.valueLabels.size
    expect(big).toBeGreaterThan(small)
  })
})
