import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="bar" />,
  Line: () => <div data-testid="line" />,
  Doughnut: () => <div data-testid="doughnut" />,
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

import WidgetRenderer from '../components/dashboard/WidgetRenderer'

const slice = rows => ({ rows, error: null, loaded: true })

describe('WidgetRenderer: mockup widgets', () => {
  it('Open Work Orders shows the exact open count, or N/A', () => {
    render(<WidgetRenderer widgetId="open-work-orders" slice={slice({ total: 100, closed: 90, open: 10 })} />)
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.getByText(/of 100 job cards/)).toBeTruthy()
  })

  it('Fleet Location says the map is not connected and lists sites', () => {
    render(<WidgetRenderer widgetId="fleet-location" slice={slice([{ site: 'NHC' }, { site: 'NHC' }, { site: 'JED' }])} />)
    expect(screen.getByText(/Map view not connected yet/)).toBeTruthy()
    expect(screen.getByText('NHC')).toBeTruthy()
  })

  it('empty sources render honest empty states', () => {
    const { unmount } = render(<WidgetRenderer widgetId="utilisation-trend" slice={slice([])} />)
    expect(screen.getByText(/No telematics utilisation/)).toBeTruthy()
    unmount()
    render(<WidgetRenderer widgetId="workshop-jobs" slice={slice([])} />)
    expect(screen.getByText(/No job cards opened/)).toBeTruthy()
  })

  it('trend indicator gives no change when the earlier period had nothing', () => {
    render(<WidgetRenderer widgetId="work-orders-trend" slice={slice({ current: 5, previous: 0, pct: null, direction: null })} />)
    expect(screen.getByText(/so no change is shown/)).toBeTruthy()
  })

  it('progress, badge, heat map and timeline render real rows', () => {
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const a = render(<WidgetRenderer widgetId="inspection-progress" slice={slice([{ scheduled_date: `${ym}-01`, status: 'Done' }, { scheduled_date: `${ym}-02` }])} />)
    expect(screen.getByText('50%')).toBeTruthy(); a.unmount()
    const b = render(<WidgetRenderer widgetId="data-freshness" slice={slice({ overall: 'stale', items: [{ table: 'work_orders', label: 'Job cards', days: 4, status: 'stale' }] })} />)
    expect(screen.getByText('Getting stale')).toBeTruthy(); b.unmount()
    const c = render(<WidgetRenderer widgetId="inspection-heatmap" slice={slice([{ site: 'NHC', inspection_date: '2026-10-05' }])} />)
    expect(screen.getByRole('grid')).toBeTruthy(); c.unmount()
    render(<WidgetRenderer widgetId="activity-timeline" slice={slice([{ type: 'accident', at: '2026-10-05T09:00:00Z', title: 'Accident ACC-1', sub: 'TM2' }])} />)
    expect(screen.getByText('Accident ACC-1')).toBeTruthy()
  })

  it('Note and Image render saved content without loading data, and block unsafe URLs', () => {
    const a = render(<WidgetRenderer widgetId="text-note" slice={undefined} config={{ title: 'Shift', text: 'Starts 19:00' }} />)
    expect(screen.getByText('Starts 19:00')).toBeTruthy(); a.unmount()
    const b = render(<WidgetRenderer widgetId="image-logo" slice={undefined} config={{ url: 'https://x.test/a.png', caption: 'Logo' }} />)
    expect(screen.getByAltText('Logo').getAttribute('src')).toBe('https://x.test/a.png'); b.unmount()
    render(<WidgetRenderer widgetId="image-logo" slice={undefined} config={{ url: 'javascript:alert(1)' }} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/No image yet/)).toBeTruthy()
  })
})
