/**
 * THE BRIDGE CONTRACT, pinned.
 *
 * `activeCountry` is read by 212 files and handed to applyCountry() by 130 API
 * modules. The working context is layered ON TOP of it: every context change must
 * write activeCountry = contextToCountry(context). If that stops happening, every
 * country-scoped read in the app silently reports the wrong country, so this file
 * asserts it against the REAL SettingsProvider rather than the pure helper.
 *
 * Also pinned here: the multi-country switching bug (a user carrying
 * ['KSA','UAE','Egypt'] used to be pinned to KSA forever), and that the reporting
 * scope never writes the operational selection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { createElement, useEffect } from 'react'

// The auth object is held stable inside a test: the real AuthContext exposes
// `user`/`profile` as state, and a mock that rebuilds them every render would
// re-fire every [user] effect in the provider.
const h = vi.hoisted(() => ({
  auth: { user: { id: 'u1' }, profile: null },
  siteRows: [
    { name: 'NHC', country: 'KSA', region: 'CENTRAL' },
    { name: 'DHAHBAN', country: 'KSA', region: 'WESTERN' },
    { name: 'JEBEL ALI', country: 'UAE', region: null },
    { name: 'CAIRO', country: 'Egypt', region: null },
  ],
  sitesError: null,
}))

vi.mock('../lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel }
  return {
    supabase: {
      from: (table) => ({
        select: () => (table === 'sites'
          ? Promise.resolve({ data: h.sitesError ? null : h.siteRows, error: h.sitesError })
          : Promise.resolve({ data: [], error: null })),
      }),
      channel: () => channel,
      removeChannel: () => {},
    },
  }
})
vi.mock('../lib/api/systemConfig', () => ({
  loadSystemConfig: () => Promise.resolve({}),
  configBool: () => false,
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => h.auth,
}))

// createElement rather than JSX: this file is .js, where JSX is not transformed.
import { SettingsProvider, useSettings } from '../contexts/SettingsContext'
import { contextToCountry } from '../lib/workingContext'

let api = null
function Probe() {
  const s = useSettings()
  useEffect(() => { api = s }, [s])
  api = s
  return null
}

const mount = async () => {
  const out = render(createElement(SettingsProvider, null, createElement(Probe)))
  // Let the site-register read resolve so the tree is real, not the fallback.
  await waitFor(() => expect(api.allowedContext.length).toBeGreaterThan(0))
  return out
}

const setContext = async (ctx) => { await act(async () => { api.setWorkingContext(ctx) }) }

beforeEach(() => {
  localStorage.clear()
  api = null
  h.auth = {
    user: { id: 'u1' },
    profile: { id: 'u1', role: 'Admin', is_super_admin: true, country: null, sites: ['ALL'] },
  }
  h.sitesError = null
})

describe('setWorkingContext writes the legacy activeCountry', () => {
  it('sets activeCountry to contextToCountry(ctx) for every level of the tree', async () => {
    await mount()
    for (const ctx of [
      { country: 'KSA', region: null, site: null },
      { country: 'KSA', region: 'CENTRAL', site: 'NHC' },
      { country: 'UAE', region: null, site: 'JEBEL ALI' },
      { country: 'Egypt', region: null, site: null },
    ]) {
      await setContext(ctx)
      expect(api.activeCountry).toBe(contextToCountry(ctx))
    }
  })

  it('drives activeCurrency off the bridged country', async () => {
    await mount()
    await setContext({ country: 'UAE', region: null, site: 'JEBEL ALI' })
    expect(api.activeCurrency).toBe('AED')
    await setContext({ country: 'Egypt', region: null, site: 'CAIRO' })
    expect(api.activeCurrency).toBe('EGP')
  })

  it('keeps contextKey in step and persists both keys', async () => {
    await mount()
    await setContext({ country: 'KSA', region: 'CENTRAL', site: 'NHC' })
    expect(api.contextKey).toBe('KSA|CENTRAL|NHC')
    expect(localStorage.getItem('tp_active_country')).toBe('KSA')
    expect(JSON.parse(localStorage.getItem('tp_working_context')))
      .toEqual({ country: 'KSA', region: 'CENTRAL', site: 'NHC' })
  })

  it('accepts an empty context as a deliberate All for a user who may see every country', async () => {
    await mount()
    await setContext({ country: 'KSA', region: 'CENTRAL', site: 'NHC' })
    await setContext(null)
    expect(api.activeCountry).toBe('All')
    expect(api.workingContext).toEqual({ country: null, region: null, site: null })
    expect(api.contextKey).toBe('All||')
  })

  it('refuses an empty context for a scoped user and keeps them on their country', async () => {
    h.auth = { user: { id: 'u1' }, profile: { id: 'u1', role: 'Manager', country: ['UAE'], sites: ['ALL'] } }
    await mount()
    await setContext(null)
    expect(api.activeCountry).toBe('UAE')
  })

  it('normalizes a context the user may not have before writing anything', async () => {
    h.auth = { user: { id: 'u1' }, profile: { id: 'u1', role: 'Manager', country: ['UAE'], sites: ['ALL'] } }
    await mount()
    await setContext({ country: 'KSA', region: null, site: 'NHC' })
    expect(api.workingContext.country).toBe('UAE')
    expect(api.activeCountry).toBe('UAE')
  })

  it('restores a saved context on mount and bridges it', async () => {
    localStorage.setItem('tp_working_context',
      JSON.stringify({ country: 'Egypt', region: null, site: 'CAIRO' }))
    await mount()
    await waitFor(() => expect(api.activeCountry).toBe('Egypt'))
    expect(api.workingContext.site).toBe('CAIRO')
  })

  it('seeds the context from a legacy activeCountry choice on first load', async () => {
    localStorage.setItem('tp_active_country', 'UAE')
    await mount()
    await waitFor(() => expect(api.workingContext.country).toBe('UAE'))
    expect(api.activeCountry).toBe('UAE')
  })
})

describe('setActiveCountry keeps the legacy contract and fixes the pinning bug', () => {
  it('lets a three-country user switch between all three (was pinned to KSA)', async () => {
    h.auth = { user: { id: 'u1' }, profile: { id: 'u1', role: 'Manager', country: ['KSA', 'UAE', 'Egypt'], sites: ['ALL'] } }
    await mount()
    for (const c of ['UAE', 'Egypt', 'KSA']) {
      await act(async () => { api.setActiveCountry(c) })
      expect(api.activeCountry).toBe(c)
      expect(api.workingContext.country).toBe(c)
    }
    await act(async () => { api.setActiveCountry('All') })
    expect(api.activeCountry).toBe('All')
    expect(api.contextKey).toBe('All||')
  })

  it('locks a single-country user to their country and refuses All', async () => {
    h.auth = { user: { id: 'u1' }, profile: { id: 'u1', role: 'Director', country: ['Egypt'], sites: ['ALL'] } }
    await mount()
    await waitFor(() => expect(api.activeCountry).toBe('Egypt'))
    await act(async () => { api.setActiveCountry('KSA') })
    expect(api.activeCountry).toBe('Egypt')
    await act(async () => { api.setActiveCountry('All') })
    expect(api.activeCountry).toBe('Egypt')
    expect(api.canSwitchWorkingContext).toBe(false)
  })

  it('never widens beyond profile.country', async () => {
    h.auth = { user: { id: 'u1' }, profile: { id: 'u1', role: 'Manager', country: ['KSA', 'UAE'], sites: ['ALL'] } }
    await mount()
    await act(async () => { api.setActiveCountry('Egypt') })
    expect(api.activeCountry).not.toBe('Egypt')
    expect(api.allowedContext.map(n => n.country)).toEqual(['KSA', 'UAE'])
  })

  it('leaves an Admin free to pick All', async () => {
    await mount()
    await act(async () => { api.setActiveCountry('KSA') })
    await act(async () => { api.setActiveCountry('All') })
    expect(api.activeCountry).toBe('All')
    expect(api.canSwitchWorkingContext).toBe(true)
  })
})

describe('reporting scope is independent of the working context', () => {
  it('does not touch activeCountry or the working context', async () => {
    await mount()
    await setContext({ country: 'KSA', region: 'CENTRAL', site: 'NHC' })
    await act(async () => { api.setReportingScope({ countries: ['UAE', 'Egypt'] }) })
    expect(api.reportingScope).toEqual({ countries: ['UAE', 'Egypt'] })
    expect(api.activeCountry).toBe('KSA')
    expect(api.contextKey).toBe('KSA|CENTRAL|NHC')
  })

  it('drops a country the user may not report on', async () => {
    h.auth = { user: { id: 'u1' }, profile: { id: 'u1', role: 'Manager', country: ['KSA'], sites: ['ALL'] } }
    await mount()
    await act(async () => { api.setReportingScope({ countries: ['KSA', 'UAE'] }) })
    expect(api.reportingScope).toEqual({ countries: ['KSA'] })
    expect(api.allowedScopeCountries).toEqual(['KSA'])
  })
})

describe('the site register is best-effort', () => {
  it('still offers the hardcoded countries when the read fails', async () => {
    h.sitesError = { message: 'boom' }
    await mount()
    expect(api.allowedContext.map(n => n.country)).toEqual(['Egypt', 'KSA', 'UAE'])
    await act(async () => { api.setActiveCountry('UAE') })
    expect(api.activeCountry).toBe('UAE')
  })
})
