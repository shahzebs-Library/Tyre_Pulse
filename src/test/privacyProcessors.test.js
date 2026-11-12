// AI-7: the privacy policy said only Sentry receives data. It now lists every
// outside company the code really sends data to. This test scans the code so
// the page cannot fall behind again: a new external host in an edge function
// or in the web app must be added to src/lib/privacyProcessors.js (or to the
// short allowlist below with a reason) before the build is green.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { PRIVACY_PROCESSORS, PROCESSOR_WHEN_LABEL, processorForHost } from '../lib/privacyProcessors'

const ROOT = process.cwd()
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'test' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, exts, out)
    else if (exts.some((e) => name.endsWith(e))) out.push(full)
  }
  return out
}

// Hosts that are not a data processor: build-time module registries, our own
// domains, documentation links and placeholders a user never contacts.
const NOT_A_PROCESSOR = [
  /(^|\.)deno\.land$/, /(^|\.)esm\.sh$/,                       // Deno import registries (build time)
  /(^|\.)tyrepulse\.app$/, /(^|\.)tyre-pulse-eezl\.vercel\.app$/, // our own sites
  /(^|\.)w3\.org$/,                                             // XML namespaces
  /(^|\.)example\.(com|org)$/, /your-?company\.com$/, /yourcompany\.com$/, // placeholders
  /(^|\.)github\.com$/,                                         // a link to our own release workflow
  /(^|\.)google\.com$/,                                         // a map LINK the user chooses to open
  /(^|\.)play\.google\.com$/, /(^|\.)apps\.apple\.com$/,        // store links
]

function externalHosts(files) {
  const hosts = new Map()
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/https:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)) {
      const host = m[1].toLowerCase()
      if (NOT_A_PROCESSOR.some((re) => re.test(host))) continue
      if (!hosts.has(host)) hosts.set(host, path.relative(ROOT, f))
    }
  }
  return hosts
}

describe('privacy processor list', () => {
  it('names every company the audit found, in plain words', () => {
    const ids = PRIVACY_PROCESSORS.map((p) => p.id)
    for (const id of ['supabase', 'vercel', 'anthropic', 'google_ai', 'openai', 'sentry', 'posthog', 'resend', 'push', 'open_meteo', 'stripe']) {
      expect(ids).toContain(id)
    }
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PRIVACY_PROCESSORS) {
      expect(p.name.length).toBeGreaterThan(2)
      expect(p.data.length).toBeGreaterThan(20)
      expect(p.why.length).toBeGreaterThan(5)
      expect(PROCESSOR_WHEN_LABEL[p.when]).toBeTruthy()
      expect(p.hosts.length).toBeGreaterThan(0)
    }
  })

  it('says the hard things plainly', () => {
    const by = Object.fromEntries(PRIVACY_PROCESSORS.map((p) => [p.id, p]))
    expect(by.anthropic.data).toMatch(/photo/i)
    expect(by.anthropic.data).toMatch(/question/i)
    expect(by.google_ai.data).toMatch(/photo/i)
    expect(by.openai.data).toMatch(/knowledge/i)
    expect(by.open_meteo.data).toMatch(/city/i)
    expect(by.open_meteo.data).toMatch(/Never your own location/)
    expect(by.stripe.when).toBe('not_live')
    expect(by.posthog.when).toBe('optional')
  })

  it('contains no dash punctuation', () => {
    const text = JSON.stringify(PRIVACY_PROCESSORS)
    expect(text).not.toMatch(/[–—]/)
  })

  it('covers every external host an edge function calls', () => {
    const hosts = externalHosts(walk(path.join(ROOT, 'supabase/functions'), ['.ts']))
    const missing = [...hosts].filter(([h]) => !processorForHost(h)).map(([h, f]) => `${h} (${f})`)
    expect(missing).toEqual([])
    // and the scan really found the providers (guards against a vacuous pass)
    for (const h of ['api.anthropic.com', 'api.openai.com', 'api.resend.com', 'generativelanguage.googleapis.com', 'exp.host', 'fcm.googleapis.com', 'api.twilio.com', 'api.stripe.com']) {
      expect(hosts.has(h)).toBe(true)
    }
  })

  it('covers every external host the web app calls', () => {
    const hosts = externalHosts(walk(path.join(ROOT, 'src'), ['.js', '.jsx']))
    const missing = [...hosts].filter(([h]) => !processorForHost(h)).map(([h, f]) => `${h} (${f})`)
    expect(missing).toEqual([])
    for (const h of ['api.open-meteo.com', 'us.i.posthog.com', 'challenges.cloudflare.com', 'fonts.googleapis.com']) {
      expect(hosts.has(h)).toBe(true)
    }
  })
})

describe('privacy and deletion pages', () => {
  const privacy = read('src/pages/Privacy.jsx')
  const deletion = read('src/pages/DataDeletion.jsx')

  it('the privacy page renders the shared list and no longer claims Sentry is the only recipient', () => {
    expect(privacy).toContain("from '../lib/privacyProcessors'")
    expect(privacy).toContain('PRIVACY_PROCESSORS.map')
    expect(privacy).not.toMatch(/only data shared with a third party/i)
    expect(privacy).toMatch(/Who receives your data/)
  })

  it('the deletion page points at the list and is honest about copies already sent', () => {
    expect(deletion).toContain('href="/privacy"')
    expect(deletion).toMatch(/cannot\s+recall/)
  })

  it('neither page uses dash punctuation', () => {
    expect(privacy).not.toMatch(/[–—]/)
    expect(deletion).not.toMatch(/[–—]/)
  })
})

describe('privacy page render', () => {
  it('shows every company and what it receives', async () => {
    const React = (await import('react')).default
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { default: Privacy } = await import('../pages/Privacy')
    const html = renderToStaticMarkup(React.createElement(Privacy))
    for (const p of PRIVACY_PROCESSORS) expect(html).toContain(p.name.replace(/&/g, '&amp;'))
    expect(html).toContain('Anthropic')
    expect(html).toContain('Not in use yet')
  })
})
