import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PlannerWorkQueue from '../components/inspection-planner/PlannerWorkQueue'

vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: key => key }) }))

const asset = (asset_no, overrides = {}) => ({
  asset_no, site: 'North', status: 'Overdue', last_inspection: '2026-08-01',
  due_date: '2026-08-31', days_overdue: 10, last_risk: 'Low', inspector: 'Previous Inspector',
  ...overrides,
})

function Harness({ rows, ...props }) {
  const [filterStatus, setFilterStatus] = useState('All')
  const [selectedBulk, setSelectedBulk] = useState([])
  return <MemoryRouter><PlannerWorkQueue rows={rows} today="2026-09-10" filterStatus={filterStatus}
    onFilterStatusChange={setFilterStatus} selectedBulk={selectedBulk} onSelectionChange={setSelectedBulk}
    onSchedule={vi.fn()} onBulkSchedule={vi.fn()} {...props} /></MemoryRouter>
}

describe('inspection planner work queue', () => {
  it('combines filters and distinguishes never inspected from overdue and due today', () => {
    render(<Harness rows={[
      asset('OLD'), asset('NEW', { status: 'No History', last_inspection: null, due_date: null, days_overdue: null }),
      asset('TODAY', { status: 'Due Soon', due_date: '2026-09-10', days_overdue: 0, last_risk: 'High' }),
      asset('LATER', { status: 'Due Soon', due_date: '2026-09-12', days_overdue: -2 }),
    ]} />)
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'No History' } })
    expect(screen.getByText('NEW')).toBeInTheDocument()
    expect(screen.queryByText('OLD')).not.toBeInTheDocument()
    expect(screen.queryByText(/9999/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Due Today' } })
    expect(screen.getByText('TODAY')).toBeInTheDocument()
    expect(screen.queryByText('LATER')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Risk'), { target: { value: 'Low' } })
    expect(screen.getByText('No assets match these filters.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    fireEvent.change(screen.getByLabelText('Search assets or inspectors'), { target: { value: ' old ' } })
    expect(screen.getByText('OLD')).toBeInTheDocument()
    expect(screen.queryByText('NEW')).not.toBeInTheDocument()
  })

  it('selects only the visible page and preserves selection across filters and pages', () => {
    render(<Harness rows={Array.from({ length: 55 }, (_, index) => asset(`A${String(index).padStart(2, '0')}`))} />)
    fireEvent.click(screen.getByLabelText('Select visible page'))
    expect(screen.getByRole('button', { name: 'Schedule selected (50)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ui.table.next' }))
    expect(screen.getByLabelText('Select A50')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('Select A50'))
    expect(screen.getByRole('button', { name: 'Schedule selected (51)' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search assets or inspectors'), { target: { value: 'A54' } })
    expect(screen.getByText('51 selected across all pages and filters')).toBeInTheDocument()
    expect(screen.getByLabelText('Select visible page')).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('button', { name: /Schedule selected/ })).not.toBeInTheDocument()
  })

  it('shows the existing appointment and only filters scheduled unassigned assets', () => {
    render(<Harness canViewAsset rows={[
      asset('NO-APPOINTMENT'), asset('ASSIGNED', { nextSchedule: { inspection_date: '2026-09-11', inspection_time: '09:30:00', inspector_name: 'Aisha' } }),
      asset('UNASSIGNED', { nextSchedule: { inspection_date: '2026-09-12', inspector_name: '' } }),
    ]} />)
    expect(screen.getByText('2026-09-11 09:30')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ASSIGNED' })).toHaveAttribute('href', '/vehicle/ASSIGNED')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Unassigned' } })
    expect(screen.getByText('UNASSIGNED')).toBeInTheDocument()
    expect(screen.queryByText('NO-APPOINTMENT')).not.toBeInTheDocument()
    expect(screen.queryByText('ASSIGNED')).not.toBeInTheDocument()
  })

  it('keeps equal asset numbers in different countries distinct and disables unavailable scheduling', () => {
    render(<Harness canSchedule={false} rows={[
      asset('SHARED', { country: 'KSA', row_key: 'KSA:SHARED' }),
      asset('SHARED', { country: 'UAE', row_key: 'UAE:SHARED' }),
    ]} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SHARED (KSA)' }))
    expect(screen.getByRole('checkbox', { name: 'Select SHARED (UAE)' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Schedule selected (1)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Schedule SHARED (KSA)' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select visible page' }))
    expect(screen.getByRole('button', { name: 'Schedule selected (2)' })).toBeInTheDocument()
  })
})
