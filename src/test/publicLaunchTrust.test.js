import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = path => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

describe('public launch trust surfaces', () => {
  it('publishes support, status and legal routes without the authenticated shell', () => {
    const app = read('src/App.jsx')
    expect(app).toContain('<Route path="/terms"')
    expect(app).toContain('<Route path="/support"')
    expect(app).toContain('<Route path="/status"')
    expect(app).toContain('<Route path="/privacy"')
  })

  it('links every trust destination from the sign-in footer', () => {
    const login = read('src/pages/Login.jsx')
    for (const route of ['/privacy', '/terms', '/support', '/status']) {
      expect(login).toContain(`'${route}'`)
    }
  })

  it('does not claim live health when a monitored status URL is absent', () => {
    const status = read('src/pages/PublicStatus.jsx')
    expect(status).toContain('This page never guesses service health')
    expect(status).toContain('No automated service-health claim is shown')
    expect(status).toContain('VITE_STATUS_PAGE_URL')
  })
})
