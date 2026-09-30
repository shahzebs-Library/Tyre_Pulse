import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { toUserMessage } from '../lib/safeError'

/**
 * The Accidents bulk-delete catch rendered `e.message` straight into the page.
 * The thrown value is the raw PostgREST error (e.g. a foreign-key violation), so
 * table/constraint names reached the user. It now goes through toUserMessage,
 * which still passes our own plain-language "No rows were deleted" sentence.
 */
const SRC = readFileSync(join(process.cwd(), 'src/pages/Accidents.jsx'), 'utf8')

describe('accidents bulk delete error sanitisation', () => {
  it('routes the bulk-delete failure through toUserMessage', () => {
    expect(SRC).not.toMatch(/setBulkError\(e\.message/)
    expect(SRC).toMatch(/setBulkError\(toUserMessage\(e,/)
  })

  it('hides raw database text but keeps the app\'s own sentence', () => {
    const raw = { code: '23503', message: 'update or delete on table "accidents" violates foreign key constraint "accident_parts_accident_id_fkey"' }
    expect(toUserMessage(raw, 'Bulk delete failed.')).not.toMatch(/foreign key|accident_parts/)
    const own = new Error('No rows were deleted. You may not have permission (Admin only) or they were already removed.')
    expect(toUserMessage(own, 'Bulk delete failed.')).toBe(own.message)
  })
})
