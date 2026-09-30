import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * /recall-tracker is Admin-only, and /recalls/:recallId is linked ONLY from it,
 * but the detail route carried no guard at all, so any signed-in role could open
 * a recall (tyre serials, affected assets) by typing the URL. The detail must be
 * at least as strict as its list, and share its module key so a per-user grant
 * for the Recall Tracker also opens its detail pages.
 */
const APP = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8')

function routeLine(path) {
  const line = APP.split('\n').find((l) => l.includes(`path="${path}"`))
  expect(line, `route ${path} not found`).toBeTruthy()
  return line
}

describe('recall detail route guard', () => {
  it('guards /recalls/:recallId like /recall-tracker', () => {
    const list = routeLine('/recall-tracker')
    const detail = routeLine('/recalls/:recallId')
    expect(list).toMatch(/RoleRoute allowed=\{\['Admin'\]\}/)
    expect(detail).toMatch(/RoleRoute allowed=\{\['Admin'\]\}/)
    expect(detail).toMatch(/moduleKey="recall_tracker"/)
  })
})
