/**
 * shellFlag.test.js - the app-shell rollout flag (`new_shell`).
 *
 * WHAT THIS ASSERTS, AND WHAT IT DOES NOT.
 *
 * It asserts the DECISION: given what system_config holds, does the app pick
 * the new shell or the frozen LegacyLayout fallback? That decision lives in
 * exactly one function, shouldUseNewShell() in lib/api/systemConfig.js, and
 * src/App.jsx calls that function and nothing else. So these tests exercise the
 * real production code path with no mocking.
 *
 * It deliberately does NOT render App.jsx to check which component comes back.
 * App.jsx pulls in the auth/settings/tenant providers, the Supabase client and
 * the whole route table; standing that up in jsdom would test the harness far
 * more than the flag, and no other test in this repo imports App. The wiring
 * that the test therefore cannot see is the single line
 * `const Shell = useNew ? Layout : LegacyLayout` in App.jsx's AppShell - that
 * one line is verified by reading it, not by this file. Everything the flag
 * decides before that line is covered here.
 *
 * The bias is FAIL-FORWARD: anything we cannot read or cannot parse resolves to
 * the new shell. A rollback to a frozen shell should only ever happen because
 * an administrator explicitly asked for it, never because a value was blank,
 * misspelt or unreachable.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  shouldUseNewShell, NEW_SHELL_KEY, CONFIG_DEFAULTS, ENFORCEMENT_STATUS,
  primeConfigCache, configBool,
} from '../lib/api/systemConfig'

/** Prime the config cache as SettingsContext does after a full read. */
const withConfig = (map) => primeConfigCache(map)

describe('new_shell flag - which app shell renders', () => {
  beforeEach(() => { withConfig({}) })

  it('defaults to the NEW shell when the key is unset', () => {
    // The common case by far: nobody has ever touched this row.
    expect(shouldUseNewShell()).toBe(true)
  })

  it('defaults to the NEW shell before the config cache is primed', () => {
    // A cold load reads the flag before SettingsContext has fetched anything.
    // The default must win here; App.jsx additionally holds first paint until
    // the read settles, so this default never becomes a visible shell swap.
    withConfig({ some_other_key: 'x' })
    expect(shouldUseNewShell()).toBe(true)
  })

  it('selects the LEGACY shell when explicitly turned off', () => {
    withConfig({ [NEW_SHELL_KEY]: 'false' })
    expect(shouldUseNewShell()).toBe(false)
  })

  it('accepts the other honest ways of writing off', () => {
    for (const off of ['false', 'FALSE', '0', 'off', 'no', 'No']) {
      withConfig({ [NEW_SHELL_KEY]: off })
      expect(shouldUseNewShell(), `"${off}" should mean off`).toBe(false)
    }
  })

  it('selects the NEW shell when explicitly turned on', () => {
    for (const on of ['true', 'TRUE', '1', 'on', 'yes']) {
      withConfig({ [NEW_SHELL_KEY]: on })
      expect(shouldUseNewShell(), `"${on}" should mean on`).toBe(true)
    }
  })

  it('falls back to the NEW shell on a junk value, not to the legacy one', () => {
    // Fail FORWARD. A value nobody can parse means somebody typed something we
    // do not understand; rolling the whole app back to a frozen shell on that
    // basis would be a silent, unrequested regression.
    for (const junk of ['banana', 'maybe', '{}', '  ', 'null', 'undefined', '2']) {
      withConfig({ [NEW_SHELL_KEY]: junk })
      expect(shouldUseNewShell(), `"${junk}" should fall forward to the new shell`).toBe(true)
    }
  })

  it('treats an empty string as unset rather than as off', () => {
    // A cleared textbox is not a decision to roll back.
    withConfig({ [NEW_SHELL_KEY]: '' })
    expect(shouldUseNewShell()).toBe(true)
  })

  it('reads a real boolean as well as the stored string form', () => {
    withConfig({ [NEW_SHELL_KEY]: false })
    expect(shouldUseNewShell()).toBe(false)
    withConfig({ [NEW_SHELL_KEY]: true })
    expect(shouldUseNewShell()).toBe(true)
  })
})

describe('new_shell flag - registration', () => {
  beforeEach(() => { withConfig({}) })

  it('declares the new shell as the default, so the flag turns it OFF not ON', () => {
    // If this ever flipped to false the new shell would be hidden behind an
    // opt-in nobody set, and every user would silently get the frozen fallback.
    expect(CONFIG_DEFAULTS[NEW_SHELL_KEY]).toBe(true)
  })

  it('is registered as actually enforced, naming the real enforcement site', () => {
    // ENFORCEMENT_STATUS is what the console System Configuration page badges
    // each control with. Claiming 'active' for a control nothing reads is the
    // exact dishonesty that registry exists to prevent, so the entry has to
    // point at the file that really makes the decision.
    const entry = ENFORCEMENT_STATUS[NEW_SHELL_KEY]
    expect(entry).toBeTruthy()
    expect(entry.status).toBe('active')
    expect(entry.where).toMatch(/App\.jsx/)
  })

  it('is the only interpretation of the key - shouldUseNewShell wraps configBool', () => {
    // Guards against a second, drifting reader appearing elsewhere: the helper
    // must agree with the central getter for every input.
    for (const v of ['false', 'true', 'banana', '', undefined]) {
      withConfig(v === undefined ? {} : { [NEW_SHELL_KEY]: v })
      expect(shouldUseNewShell()).toBe(configBool(NEW_SHELL_KEY, true))
    }
  })
})
