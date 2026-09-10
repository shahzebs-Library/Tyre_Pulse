import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import DownloadNotice from '../components/ui/DownloadNotice'
afterEach(() => vi.useRealTimers())
it('keeps progress visible, then dismisses the completed download after eight seconds', () => {
  vi.useFakeTimers()
  const dismiss = vi.fn()
  const view = render(<DownloadNotice message="Preparing photos" busy onDismiss={dismiss} />)
  act(() => vi.advanceTimersByTime(12000))
  expect(dismiss).not.toHaveBeenCalled()
  view.rerender(<DownloadNotice message="PDF saved" busy={false} onDismiss={dismiss} />)
  act(() => vi.advanceTimersByTime(8000))
  expect(dismiss).toHaveBeenCalledOnce()
})
it('lets the user close a result or error immediately', () => {
  const dismiss = vi.fn()
  render(<DownloadNotice message="Download failed" busy={false} onDismiss={dismiss} />)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss download message' }))
  expect(dismiss).toHaveBeenCalledOnce()
})
it('cleans up its timer on unmount', () => {
  vi.useFakeTimers()
  const dismiss = vi.fn()
  const view = render(<DownloadNotice message="PDF saved" busy={false} onDismiss={dismiss} />)
  view.unmount()
  act(() => vi.advanceTimersByTime(9000))
  expect(dismiss).not.toHaveBeenCalled()
})
