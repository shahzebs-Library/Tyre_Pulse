import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import useLatestRequest from '../lib/useLatestRequest'

/**
 * The bug this exists to stop: two loads in flight, the SLOW one finishes last
 * and paints the old window's data under the new window's filters. Nothing
 * errors, so it reads as bad data rather than as a bug.
 */
function Harness() {
  const latest = useLatestRequest()
  const [shown, setShown] = useState('none')
  const [busy, setBusy] = useState(false)

  async function load(label, promise) {
    const stale = latest.begin()
    setBusy(true)
    const value = await promise
    if (stale()) return
    setShown(`${label}:${value}`)
    setBusy(false)
  }

  window.__load = load
  window.__cancel = latest.cancel
  return <div>{shown}{busy ? ' (busy)' : ''}</div>
}

const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

describe('useLatestRequest', () => {
  it('drops a slow first answer when a second question has been asked', async () => {
    render(<Harness />)
    const first = deferred()
    const second = deferred()

    act(() => { window.__load('old-window', first.promise) })
    act(() => { window.__load('new-window', second.promise) })

    // The second finishes first, then the first arrives late.
    await act(async () => { second.resolve('B'); await second.promise })
    expect(screen.getByText(/new-window:B/)).toBeInTheDocument()

    await act(async () => { first.resolve('A'); await first.promise })

    // The late answer must NOT overwrite the current one.
    expect(screen.getByText(/new-window:B/)).toBeInTheDocument()
    expect(screen.queryByText(/old-window/)).toBeNull()
  })

  it('lets a lone request through untouched', async () => {
    render(<Harness />)
    const only = deferred()
    act(() => { window.__load('only', only.promise) })
    await act(async () => { only.resolve('X'); await only.promise })
    expect(screen.getByText('only:X')).toBeInTheDocument()
  })

  it('leaves the busy flag owned by the newest request', async () => {
    // The stale request must not clear `busy` either, or the newer load appears
    // finished while it is still running.
    render(<Harness />)
    const first = deferred()
    const second = deferred()
    act(() => { window.__load('one', first.promise) })
    act(() => { window.__load('two', second.promise) })

    await act(async () => { first.resolve('A'); await first.promise })
    expect(screen.getByText(/\(busy\)/)).toBeInTheDocument()

    await act(async () => { second.resolve('B'); await second.promise })
    expect(screen.queryByText(/\(busy\)/)).toBeNull()
  })

  it('cancel() makes everything in flight stale, for unmount cleanup', async () => {
    render(<Harness />)
    const only = deferred()
    act(() => { window.__load('gone', only.promise) })
    act(() => { window.__cancel() })
    await act(async () => { only.resolve('X'); await only.promise })
    expect(screen.queryByText(/gone/)).toBeNull()
  })
})
