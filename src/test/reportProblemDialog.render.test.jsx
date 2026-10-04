import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/api/userIssues', () => ({
  submitUserIssue: vi.fn(),
  currentWebContext: () => ({ platform: 'web', app_version: '2.1.0', device: 'Chrome', os: 'Windows', page: '/inspections' }),
}))

import ReportProblemDialog from '../components/support/ReportProblemDialog'

afterEach(cleanup)

describe('ReportProblemDialog', () => {
  it('shows the attached context and blocks an empty report', async () => {
    const submit = vi.fn()
    render(<ReportProblemDialog open onClose={() => {}} submit={submit} />)
    expect(screen.getByText(/Page: \/inspections/)).toBeTruthy()
    expect(screen.getByText(/App version: 2\.1\.0/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Send report/ }))
    expect(await screen.findByText(/describe the problem in a few words/i)).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it('prefills the reference id, sends a valid report and confirms', async () => {
    const submit = vi.fn(() => Promise.resolve({ id: 'x', linkedLogs: 2 }))
    render(<ReportProblemDialog open onClose={() => {}} referenceId="ERR-ABCD1234" submit={submit} />)
    expect(screen.getByText(/Reference: ERR-ABCD1234/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/What went wrong/), { target: { value: 'The page went blank after saving' } })
    fireEvent.click(screen.getByRole('button', { name: /Send report/ }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(submit.mock.calls[0][0]).toMatchObject({
      description: 'The page went blank after saving', category: 'bug', severity: 'medium', referenceId: 'ERR-ABCD1234',
    })
    expect(await screen.findByText(/Your report was sent/)).toBeTruthy()
    expect(screen.getByText(/attached 2 recent error records/)).toBeTruthy()
  })

  it('shows a safe message when sending fails', async () => {
    const submit = vi.fn(() => Promise.reject(new Error('Too many reports in the last hour. Please try again later')))
    render(<ReportProblemDialog open onClose={() => {}} submit={submit} />)
    fireEvent.change(screen.getByLabelText(/What went wrong/), { target: { value: 'Report export is empty' } })
    fireEvent.change(screen.getByLabelText(/What kind of problem/), { target: { value: 'data_wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /Send report/ }))
    expect(await screen.findByText(/Too many reports/)).toBeTruthy()
  })
})
