/**
 * The open job card list (listWorkOrdersPage openOnly) is only fast because the
 * partial index work_orders_open_opened_idx (migration 20261124135000) has the
 * same predicate as the PostgREST filter. The planner proves implication by
 * matching the clauses, so the token list and its order must stay identical.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const client = readFileSync(resolve(root, 'src/lib/api/workOrders.js'), 'utf8').replace(/\r/g, '')
const migration = readFileSync(resolve(root, 'supabase/migrations/20261124135000_inv_read_timeouts.sql'), 'utf8').replace(/\r/g, '')

describe('open job card index matches the client filter', () => {
  it('uses the same closed tokens in the same order', () => {
    const list = client.match(/const CLOSED_STATUS_TOKENS = \[([^\]]+)\]/)
    expect(list).toBeTruthy()
    const tokens = list[1].split(',').map((t) => t.trim().replace(/^'|'$/g, ''))
    const pred = migration.match(/create index if not exists work_orders_open_opened_idx[\s\S]*?where \(status is null or \(([^;]+)\)\);/)
    expect(pred).toBeTruthy()
    const indexTokens = [...pred[1].matchAll(/not ilike '([^']+)'/g)].map((m) => m[1])
    expect(indexTokens).toEqual(tokens)
  })

  it('still sends the filter as status is null OR all not-ilike', () => {
    expect(client).toContain("q.or(`status.is.null,and(${CLOSED_STATUS_TOKENS.map((t) => `status.not.ilike.${t}`).join(',')})`)")
  })
})
