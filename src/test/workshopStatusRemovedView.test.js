import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DISPOSITIONS, REMOVED_STATUS, availableActions, filterRemoved, needsReason, reasonValid,
  removedSites, removedStatus, sortRemoved, summarizeRemoved, activeRemovedFilterCount,
} from '../lib/workshopStatus/removedView'

const ALL = { disposition: true, restore: true, archive: true, soft_delete: true, permanent_delete: true }
const released = { id: 'a', asset_no: 'TM2', site: 'NHC', current_active: false, removed_at: '2026-10-05T08:00:00Z', previous_current_stage: 'Waiting for Parts' }
const archived = { id: 'b', asset_no: 'TM1', site: 'JED', current_active: false, removed_at: '2026-10-06T08:00:00Z', archived_at: '2026-10-07T08:00:00Z', final_disposition: 'repair_completed' }
const deleted = { id: 'c', asset_no: 'TM3', site: 'NHC', current_active: false, removed_at: null, deleted_at: '2026-10-07T09:00:00Z' }

describe('removedView', () => {
  it('dispositions mirror the SQL check and the writer list', () => {
    const foundation = readFileSync('supabase/migrations/20261007090000_workshop_status_foundation.sql', 'utf8')
    const writer = readFileSync('supabase/migrations/20261007130000_workshop_status_removed_recovery.sql', 'utf8')
    const grab = (sql, anchor) => {
      const i = sql.indexOf(anchor)
      const block = sql.slice(i, sql.indexOf(')', sql.indexOf("'other'", i)) + 1)
      return [...block.matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
    }
    expect(grab(foundation, 'final_disposition in')).toEqual([...DISPOSITIONS])
    expect(grab(writer, 'v_disp = any (array[')).toEqual([...DISPOSITIONS])
  })

  it('status follows deleted > archived > released', () => {
    expect(removedStatus(released)).toBe(REMOVED_STATUS.RELEASED)
    expect(removedStatus(archived)).toBe(REMOVED_STATUS.ARCHIVED)
    expect(removedStatus({ ...archived, deleted_at: 'x' })).toBe(REMOVED_STATUS.DELETED)
  })

  it('offers only the actions the state and permissions allow', () => {
    expect(availableActions(released, ALL)).toEqual(['disposition', 'restore', 'archive', 'soft_delete'])
    expect(availableActions(archived, ALL)).toEqual(['disposition', 'unarchive', 'soft_delete'])
    expect(availableActions(deleted, ALL)).toEqual(['undelete', 'permanent_delete'])
    expect(availableActions(released, { restore: true })).toEqual(['restore'])
    expect(availableActions(released, {})).toEqual([])
    expect(availableActions({ ...released, current_active: true }, ALL)).toEqual([])
  })

  it('reason rules match the server', () => {
    expect(needsReason('disposition')).toBe(false)
    expect(needsReason('restore')).toBe(true)
    expect(reasonValid('  abcd ')).toBe(false)
    expect(reasonValid('abcde')).toBe(true)
    expect(reasonValid(null)).toBe(false)
  })

  it('filters, sorts and summarises', () => {
    const rows = [released, archived, deleted]
    expect(filterRemoved(rows, { status: 'archived' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRemoved(rows, { disposition: 'none' }).map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterRemoved(rows, { site: 'nhc' }).map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterRemoved(rows, { search: 'parts' }).map((r) => r.id)).toEqual(['a'])
    expect(sortRemoved(rows).map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(removedSites(rows)).toEqual(['JED', 'NHC'])
    expect(summarizeRemoved(rows)).toEqual({ total: 3, released: 1, archived: 1, deleted: 1, awaitingDisposition: 1, withDisposition: 1 })
    expect(activeRemovedFilterCount({ search: 'x', status: 'archived', site: 'NHC' })).toBe(2)
  })
})
