import { describe, it, expect, beforeEach, vi } from 'vitest'
import { chartVarResolverPlugin } from '../lib/chartVarPlugin'

// Drive the plugin's beforeLayout hook the way Chart.js would, with a fake
// chart carrying options + data that use CSS var() colour tokens.
function run(chart) {
  chartVarResolverPlugin.beforeLayout(chart)
  return chart
}

describe('chartVarResolverPlugin', () => {
  beforeEach(() => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      getPropertyValue: (name) =>
        ({
          '--panel': '#111827',
          '--hairline': '#374151',
          '--text-muted': '#7e8c84',
        })[name] || '',
    }))
  })

  it('resolves var() tokens in nested options to computed colours', () => {
    const chart = {
      options: {
        plugins: {
          tooltip: {
            backgroundColor: 'var(--panel)',
            borderColor: 'var(--hairline)',
          },
        },
        scales: { x: { grid: { color: 'var(--text-muted)' } } },
      },
      data: { datasets: [] },
    }
    run(chart)
    expect(chart.options.plugins.tooltip.backgroundColor).toBe('#111827')
    expect(chart.options.plugins.tooltip.borderColor).toBe('#374151')
    expect(chart.options.scales.x.grid.color).toBe('#7e8c84')
  })

  it('resolves var() tokens inside dataset colour arrays', () => {
    const chart = {
      options: {},
      data: {
        datasets: [{ borderColor: 'var(--panel)', backgroundColor: ['var(--hairline)', '#fff'] }],
      },
    }
    run(chart)
    expect(chart.data.datasets[0].borderColor).toBe('#111827')
    expect(chart.data.datasets[0].backgroundColor).toEqual(['#374151', '#fff'])
  })

  it('honours a fallback when the token is undefined', () => {
    const chart = { options: { color: 'var(--missing, #abcdef)' }, data: {} }
    run(chart)
    expect(chart.options.color).toBe('#abcdef')
  })

  it('leaves non-var colour strings untouched', () => {
    const chart = { options: { color: '#123456', border: 'rgba(0,0,0,0.5)' }, data: {} }
    run(chart)
    expect(chart.options.color).toBe('#123456')
    expect(chart.options.border).toBe('rgba(0,0,0,0.5)')
  })

  it('does not throw on cyclic references', () => {
    const a = { color: 'var(--panel)' }
    a.self = a
    expect(() => run({ options: a, data: {} })).not.toThrow()
    expect(a.color).toBe('#111827')
  })
})
