import { describe, expect, it } from 'vitest'
import { loadEcharts } from '../components/charts/EChart'

describe('lean ECharts runtime', () => {
  it('loads the registered runtime once and exposes the chart API', async () => {
    const first = await loadEcharts()
    const second = await loadEcharts()
    expect(first).toBe(second)
    expect(first.init).toBeTypeOf('function')
    expect(first.getInstanceByDom).toBeTypeOf('function')
  }, 60_000)
})
