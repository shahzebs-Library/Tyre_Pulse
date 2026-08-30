import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = path => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

describe('asset management route does not collide with production bundles', () => {
  it('uses a canonical application route outside Vite /assets', () => {
    const app = read('src/App.jsx')
    expect(app).toContain('path="/asset-management"')
    expect(app).toContain('path="/asset-management/:assetNo"')
    expect(app).not.toContain('path="/assets"')
    expect(app).not.toContain('path="/assets/:assetNo"')
  })

  it('redirects legacy product URLs while preserving static asset caching', () => {
    const config = JSON.parse(read('vercel.json'))
    expect(config.headers).toContainEqual(expect.objectContaining({ source: '/assets/(.*)' }))
    expect(config.redirects).toContainEqual({ source: '/assets', destination: '/asset-management', permanent: true })
  })

  it('contains no product navigation targets under the static namespace', () => {
    for (const path of ['src/components/Layout.jsx', 'src/components/LegacyLayout.jsx', 'src/lib/commandSearch.js']) {
      expect(read(path)).not.toMatch(/(?:to|path):?\s*['"]\/assets(?:\/|['"])/)
    }
  })
})
