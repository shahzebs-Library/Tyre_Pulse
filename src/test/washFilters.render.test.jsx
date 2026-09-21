import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WashAdvancedFilters from '../components/washing/WashAdvancedFilters'
import { filterWashes } from '../lib/washAnalytics'

const defaults = {
  search: '', status: 'all', site: 'all', area: 'all', type: 'all', region: 'all',
  vehicleType: 'all', enteredBy: 'all', correctedBy: 'all', washedBy: 'all',
  bay: 'all', photos: 'all', chemicals: 'all', checklist: 'all', corrections: 'all',
  dateBasis: 'wash', from: '', to: '',
}
const rows = [
  { id: '1', asset_no: 'TM-1', site: 'North', region: 'Central', wash_type: 'Full', status: 'Completed', created_by: 'u1', entry_name: 'Aisha' },
  { id: '2', asset_no: 'TM-2', site: 'South', region: 'Central', wash_type: 'Exterior', status: 'Scheduled', created_by: 'u2', entry_name: 'Omar' },
  { id: '3', asset_no: 'TM-3', site: 'West', region: 'Western', wash_type: 'Full', status: 'Completed', created_by: 'u1', entry_name: 'Aisha' },
]

function Harness({ initial = defaults }) {
  const [filters, setFilters] = useState(initial)
  const filtered = filterWashes(rows, filters)
  return <WashAdvancedFilters rows={rows} value={filters} onChange={setFilters} onClear={() => setFilters(defaults)} statuses={['Completed', 'Scheduled']} resultCount={filtered.length} canUseFleetFields scope="test" />
}

describe('washing filter bar', () => {
  it('matches the inspection pattern and clears every active field', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('3 shown')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search washing records'), { target: { value: 'Aisha' } })
    expect(screen.getByText('2 of 3 shown')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Site: all' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Site' })).getByRole('menuitemcheckbox', { name: 'North' }))
    expect(screen.getByRole('button', { name: /Filters \(1\)/ })).toBeInTheDocument()
    expect(screen.getByText('Site: North')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('3 shown')).toBeInTheDocument()
    expect(screen.queryByLabelText('Active washing filters')).not.toBeInTheDocument()
  })

  it('opens restored filters and shows recorder names rather than IDs', () => {
    render(<Harness initial={{ ...defaults, enteredBy: 'u1', dateBasis: 'received' }} />)
    expect(screen.getByRole('button', { name: /Filters \(2\)/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Entered by: Aisha')).toBeInTheDocument()
    expect(screen.getByText('Date basis: Received date')).toBeInTheDocument()
  })
})
