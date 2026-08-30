import { describe, expect, it } from 'vitest'
import { NAV_GROUPS } from '../console/components/ConsoleLayout'
import { buildConsoleCommands, filterConsoleCommands } from '../console/components/ConsoleCommandPalette'

describe('Super Admin command palette', () => {
  const commands = buildConsoleCommands(NAV_GROUPS)

  it('exposes every governed console capability once', () => {
    const routes = commands.map((item) => item.to)
    expect(commands.length).toBeGreaterThan(40)
    expect(new Set(routes).size).toBe(routes.length)
    expect(commands.every((item) => item.description.length > 20)).toBe(true)
  })

  it('searches names, groups, and plain-English capability descriptions', () => {
    expect(filterConsoleCommands(commands, 'user').some((item) => item.to === '/console/users')).toBe(true)
    expect(filterConsoleCommands(commands, 'restore deleted').some((item) => item.to === '/console/backups')).toBe(true)
    expect(filterConsoleCommands(commands, 'AI').length).toBeGreaterThan(1)
    expect(filterConsoleCommands(commands, 'no-such-capability')).toEqual([])
  })
})
