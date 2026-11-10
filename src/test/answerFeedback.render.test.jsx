import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
const { default: AnswerFeedback } = await import('../components/ai/AnswerFeedback')

const msg = { dbMessageId: 12, conversationId: 'c', agents: ['analyst'], grounded: true, rawCoverage: [], promptVersion: 'v1' }

describe('AnswerFeedback', () => {
  it('renders nothing for an unsaved answer', () => {
    const { container } = render(<AnswerFeedback message={{ dbMessageId: null }} submit={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('records a thumbs up with the answer context', async () => {
    const submit = vi.fn().mockResolvedValue({ id: 'x' })
    render(<AnswerFeedback message={msg} submit={submit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Helpful answer' }))
    await waitFor(() => expect(screen.getByText(/recorded for review/)).toBeTruthy())
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ assistantMessageId: 12, verdict: 'up', promptVersion: 'v1' }))
  })

  it('thumbs down opens a correction form and sends it', async () => {
    const submit = vi.fn().mockResolvedValue({ id: 'x' })
    render(<AnswerFeedback message={msg} submit={submit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not helpful answer' }))
    fireEvent.change(screen.getByLabelText(/What was wrong/), { target: { value: 'wrong_figure' } })
    fireEvent.change(screen.getByLabelText(/Correct answer/), { target: { value: 'CPK 0.029' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).toMatchObject({ verdict: 'down', category: 'wrong_figure', expectedAnswer: 'CPK 0.029' })
  })

  it('shows a safe message when saving fails', async () => {
    const submit = vi.fn().mockRejectedValue(Object.assign(new Error('relation "ai_feedback" violates row-level security'), { code: '42501' }))
    render(<AnswerFeedback message={msg} submit={submit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Helpful answer' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/row-level|ai_feedback/)
  })
})
