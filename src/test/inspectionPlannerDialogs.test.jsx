import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BulkModal, ScheduleModal } from '../components/inspection-planner/PlannerDialogs'

vi.mock('../components/workflow/EntityApprovalPanel', () => ({ default: ({ onStateChange }) => <button onClick={() => onStateChange({ isActive: true })}>Lock approval</button> }))
const workflow = vi.hoisted(() => ({ loading: false, error: null, isActive: false, isLocked: false, refresh: vi.fn() }))
vi.mock('../hooks/useEntityWorkflow', () => ({ useEntityWorkflow: () => workflow }))
beforeEach(() => Object.assign(workflow, { loading: false, error: null, isActive: false, isLocked: false }))
afterEach(cleanup)
const assets = [{ asset_no: 'A1', site: 'Site 1' }, { asset_no: 'A2', site: 'Site 1' }]
const prefill = { id: 's1', asset_no: 'A1', inspection_date: '2026-09-10', inspection_time: '08:00', inspector_name: 'Inspector', status: 'Completed', priority: 'High' }
const change = (name, value) => fireEvent.change(screen.getByLabelText(name), { target: { value } })

describe('inspection scheduling dialogs', () => {
  it.each([{ loading: true }, { error: 'Unable to read state' }, { isActive: true }, { isLocked: true }])('blocks editing while approval is unverified or locked %j', (state) => {
    Object.assign(workflow, state)
    const onSave = vi.fn()
    render(<ScheduleModal assets={assets} prefill={prefill} onSave={onSave} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).not.toHaveBeenCalled()
    if (state.error) expect(screen.getByRole('alert')).toHaveTextContent('Approval status could not be verified')
  })
  it('blocks oversized batches before building a preview or saving', () => {
    const onSave = vi.fn()
    render(<BulkModal selected={Array.from({ length: 501 }, (_, i) => ({ asset_no: `A${i}` }))} onSave={onSave} onClose={vi.fn()} />)
    change('Inspector *', 'Inspector')
    expect(screen.getByRole('alert')).toHaveTextContent('Schedule up to 500 vehicles at a time')
    expect(screen.queryByLabelText('Schedule preview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schedule All' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Schedule All' }))
    expect(onSave).not.toHaveBeenCalled()
  })
  it('preserves status on edit and displays save failures inside the accessible dialog', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Could not save this inspection. Please try again.'))
    render(<ScheduleModal assets={assets} prefill={prefill} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'Completed', id: 's1', priority: 'High' })))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })
  it.each([
    { inspection_date: '2026-02-30' },
    { inspection_date: '' },
    { inspection_time: '99:99' },
    { inspection_time: '24:00' },
    { inspection_time: '' },
  ])('rejects invalid appointment values %j', (invalid) => {
    const onSave = vi.fn()
    render(<ScheduleModal assets={assets} prefill={{ ...prefill, ...invalid }} onSave={onSave} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).not.toHaveBeenCalled()
  })
  it('blocks saves when scheduling permission is revoked', () => {
    render(<ScheduleModal assets={assets} prefill={prefill} canSchedule={false} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
  it('rejects arbitrary assets and whitespace inspector names, and respects approval locks', () => {
    render(<ScheduleModal assets={assets} prefill={prefill} onSave={vi.fn()} onClose={vi.fn()} />)
    change('Asset No *', 'unknown')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    change('Asset No *', 'A1')
    change('Inspector *', '   ')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    change('Inspector *', 'Inspector')
    fireEvent.click(screen.getByText('Lock approval'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
  it('requires conflicts to be reviewed and resets acknowledgement when the time changes', () => {
    render(<ScheduleModal assets={assets} prefill={{ ...prefill, status: 'Scheduled' }} schedule={[{ ...prefill, id: 'other', status: 'Scheduled' }]} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    change('Time *', '09:00')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
  it('validates reversed ranges and separates same-day appointments without persisting spacing', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(<BulkModal selected={assets} onSave={onSave} onClose={vi.fn()} />)
    change('Inspector *', '  Inspector  ')
    change('Start date', '2026-09-10')
    change('End date', '2026-09-09')
    expect(screen.getByRole('button', { name: 'Schedule All' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('valid date range')
    change('End date', '2026-09-10')
    expect(screen.getByLabelText('Schedule preview')).toHaveTextContent('08:30')
    fireEvent.click(screen.getByRole('button', { name: 'Schedule All' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const items = onSave.mock.calls[0][0]
    expect(items.map(i => i.inspection_time)).toEqual(['08:00', '08:30'])
    expect(items[0].inspector_name).toBe('Inspector')
    expect(items[0]).not.toHaveProperty('spacing')
    expect(items[0]).not.toHaveProperty('duration')
  })
  it('excludes unselected weekdays and shows failed bulk saves', async () => {
    render(<BulkModal selected={assets} onSave={vi.fn().mockResolvedValue(false)} onClose={vi.fn()} />)
    change('Inspector *', 'Inspector')
    change('Start date', '2026-09-10')
    change('End date', '2026-09-11')
    fireEvent.click(screen.getByLabelText('Thu'))
    expect(screen.getByLabelText('Schedule preview')).not.toHaveTextContent('2026-09-10')
    fireEvent.click(screen.getByRole('button', { name: 'Schedule All' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the schedule')
  })
})
