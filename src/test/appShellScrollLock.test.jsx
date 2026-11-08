import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import useAppShellScrollLock from '../hooks/useAppShellScrollLock'

function Shell() { useAppShellScrollLock(); return null }

describe('useAppShellScrollLock', () => {
  it('locks document scroll only while a shell is mounted', () => {
    const root = document.documentElement
    expect(root.classList.contains('tp-app-shell')).toBe(false)
    const a = render(<Shell />)
    const b = render(<Shell />)
    expect(root.classList.contains('tp-app-shell')).toBe(true)
    a.unmount()
    expect(root.classList.contains('tp-app-shell')).toBe(true)
    b.unmount()
    expect(root.classList.contains('tp-app-shell')).toBe(false)
  })
})
