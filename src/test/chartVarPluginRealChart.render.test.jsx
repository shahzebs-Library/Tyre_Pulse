/**
 * Real Chart.js + the real global chartVarResolverPlugin.
 *
 * Every other chart test mocks chart.js / react-chartjs-2, which is exactly why
 * the /console crash of 2026-09-26 shipped: chartVarPlugin enumerated
 * chart.options, which is Chart.js's option-resolver Proxy, and a for...in over
 * it throws "'getOwnPropertyDescriptor' on proxy: trap reported
 * non-configurability for property 'color'". A mock cannot reproduce a Proxy
 * invariant violation, so these tests use NOTHING mocked from chart.js.
 *
 * Two assertions per chart, because the fixed plugin wraps its walk in a
 * try/catch: "did not throw" alone would pass even if the walk regressed back
 * to chart.options (the TypeError would be swallowed). So each chart also
 * carries a var() colour and the test asserts it was RESOLVED, which only
 * happens when the walk over the options and data actually completes.
 *
 * Mutation-tested: reverting the plugin to walk chart.options (with or without
 * the try/catch) fails the TrendChart and BarsChart cases with the exact
 * production TypeError / an unresolved var(). The doughnut and the hand-built
 * bar chart do not reach the offending descriptor on their own, so the console
 * component cases are the load-bearing ones - keep them.
 *
 * jsdom has no canvas; src/test/setup.js installs a browser-shaped 2D context
 * stub and a no-op ResizeObserver, which is enough for Chart.js to initialise,
 * run update() and fire the plugin hooks.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Chart, registerables } from 'chart.js'
import { chartVarResolverPlugin } from '../lib/chartVarPlugin'
import { TrendChart, BarsChart, ShareChart } from '../console/components/ui/charts'

const TOKEN = '--tp-chart-test-ink'
const TOKEN_VALUE = 'rgb(18, 52, 86)'
const VAR = `var(${TOKEN})`

beforeAll(() => {
  Chart.register(...registerables)
  Chart.register(chartVarResolverPlugin)
  document.documentElement.style.setProperty(TOKEN, TOKEN_VALUE)
})

afterAll(() => {
  Chart.unregister(chartVarResolverPlugin)
  document.documentElement.style.removeProperty(TOKEN)
})

afterEach(() => {
  cleanup()
  Object.values(Chart.instances).forEach((c) => c.destroy())
})

const liveCharts = () => Object.values(Chart.instances)

describe('chartVarResolverPlugin against the real Chart.js resolver Proxy', () => {
  it('jsdom resolves the test token (guards the assertions below)', () => {
    expect(getComputedStyle(document.documentElement).getPropertyValue(TOKEN).trim()).toBe(TOKEN_VALUE)
  })

  it('new Chart(...) + update() does not throw and resolves var() in options and data', () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    let chart
    expect(() => {
      chart = new Chart(canvas, {
        type: 'bar',
        data: { labels: ['a', 'b'], datasets: [{ label: 'x', data: [1, 2], backgroundColor: VAR }] },
        options: {
          responsive: false,
          animation: false,
          color: VAR,
          plugins: { tooltip: { backgroundColor: VAR }, legend: { labels: { color: VAR } } },
          scales: { x: { ticks: { color: VAR } }, y: { grid: { color: VAR } } },
        },
      })
      chart.update()
    }).not.toThrow()
    expect(chart.config.options.color).toBe(TOKEN_VALUE)
    expect(chart.config.options.scales.x.ticks.color).toBe(TOKEN_VALUE)
    expect(chart.config.options.plugins.tooltip.backgroundColor).toBe(TOKEN_VALUE)
    expect(chart.config.data.datasets[0].backgroundColor).toBe(TOKEN_VALUE)
    // The resolver Proxy must still be readable after the pass.
    expect(chart.options.plugins.legend.labels.color).toBe(TOKEN_VALUE)
    chart.destroy()
    canvas.remove()
  })

  it('TrendChart mounts on the real Chart.js and the plugin completes its walk', () => {
    expect(() => render(
      <TrendChart labels={['Mon', 'Tue', 'Wed']} series={[{ label: 'Sign-ins', values: [3, 5, 2], color: VAR }]} />,
    )).not.toThrow()
    const charts = liveCharts()
    expect(charts).toHaveLength(1)
    expect(() => charts[0].update()).not.toThrow()
    expect(charts[0].config.data.datasets[0].borderColor).toBe(TOKEN_VALUE)
  })

  it('BarsChart mounts on the real Chart.js and the plugin completes its walk', () => {
    expect(() => render(
      <BarsChart bars={[{ label: 'KSA', value: 4, color: VAR }, { label: 'UAE', value: 2 }]} valueFormat={(v) => `${v}`} />,
    )).not.toThrow()
    const charts = liveCharts()
    expect(charts).toHaveLength(1)
    expect(() => charts[0].update()).not.toThrow()
    expect(charts[0].config.data.datasets[0].backgroundColor[0]).toBe(TOKEN_VALUE)
  })

  it('ShareChart mounts on the real Chart.js and the plugin completes its walk', () => {
    expect(() => render(
      <ShareChart parts={[{ label: 'Open', value: 3, color: VAR }, { label: 'Closed', value: 7 }]} />,
    )).not.toThrow()
    const charts = liveCharts()
    expect(charts).toHaveLength(1)
    expect(() => charts[0].update()).not.toThrow()
    expect(charts[0].config.data.datasets[0].backgroundColor[0]).toBe(TOKEN_VALUE)
  })
})
