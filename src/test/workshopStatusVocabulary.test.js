import { describe, it, expect } from 'vitest'
import { summarizeTechnicians } from '../lib/technicianScorecard'
import { WO_STATUSES, normalizeWoStatus, isClosedWoStatus } from '../lib/workOrderStatus'

/**
 * Regression guard for the retired work-order status vocabulary.
 *
 * The Technician Scorecard used to bucket "open" work against the retired token
 * set ['open', 'in progress', 'awaiting parts'], and Workshop Management used
 * ['Open','In Progress','Awaiting Parts']. Neither list contains the canonical
 * statuses the app actually writes today (New / Awaiting Assignment / Assigned /
 * Waiting for Parts / Waiting for Approval / Quality Inspection / On Hold), so a
 * technician whose whole queue sat in any of those read Open = 0.
 *
 * These tests pin the buckets to workOrderStatus.js so the two vocabularies can
 * never drift apart again.
 */

/** Mirror of the derived open set both surfaces use. */
const OPEN_STATUSES = WO_STATUSES.filter((s) => !isClosedWoStatus(s))

describe('technicianScorecard status buckets follow workOrderStatus.js', () => {
  it('counts every canonical non-terminal status as open', () => {
    const orders = OPEN_STATUSES.map((status, i) => ({
      id: i, technician_name: 'Sam', status, total_cost: 0,
    }))
    const { rows } = summarizeTechnicians(orders)
    expect(rows).toHaveLength(1)
    expect(rows[0].jobs).toBe(OPEN_STATUSES.length)
    expect(rows[0].open).toBe(OPEN_STATUSES.length)
    expect(rows[0].completed).toBe(0)
    expect(rows[0].cancelled).toBe(0)
  })

  it('counts Waiting for Parts as open (the retired token was "awaiting parts")', () => {
    const { rows } = summarizeTechnicians([
      { id: 1, technician_name: 'Sam', status: 'Waiting for Parts' },
    ])
    expect(rows[0].open).toBe(1)
  })

  it('counts the newer assignment / approval / QC statuses as open', () => {
    const { rows } = summarizeTechnicians([
      { id: 1, technician_name: 'Sam', status: 'New' },
      { id: 2, technician_name: 'Sam', status: 'Awaiting Assignment' },
      { id: 3, technician_name: 'Sam', status: 'Assigned' },
      { id: 4, technician_name: 'Sam', status: 'Waiting for Approval' },
      { id: 5, technician_name: 'Sam', status: 'Quality Inspection' },
      { id: 6, technician_name: 'Sam', status: 'On Hold' },
    ])
    expect(rows[0].open).toBe(6)
  })

  it('folds legacy stored tokens onto the same bucket as their canonical value', () => {
    // 'Open' -> New, 'Awaiting Parts' -> Waiting for Parts: both still open.
    const { rows: openRows } = summarizeTechnicians([
      { id: 1, technician_name: 'Sam', status: 'Open' },
      { id: 2, technician_name: 'Sam', status: 'Awaiting Parts' },
      { id: 3, technician_name: 'Sam', status: 'in_progress' },
    ])
    expect(openRows[0].open).toBe(3)

    // 'Closed' / 'Done' -> Completed, so they count toward completion rate.
    const { rows: doneRows } = summarizeTechnicians([
      { id: 1, technician_name: 'Sam', status: 'Closed', created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-03T00:00:00Z' },
      { id: 2, technician_name: 'Sam', status: 'done', created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-03T00:00:00Z' },
    ])
    expect(doneRows[0].completed).toBe(2)
    expect(doneRows[0].completionRate).toBe(100)
    expect(doneRows[0].avgTurnaround).toBe(2)

    // 'canceled' (US spelling) -> Cancelled, not silently uncounted.
    const { rows: cxRows } = summarizeTechnicians([
      { id: 1, technician_name: 'Sam', status: 'canceled' },
    ])
    expect(cxRows[0].cancelled).toBe(1)
    expect(cxRows[0].open).toBe(0)
  })

  it('keeps terminal statuses out of the open bucket', () => {
    const { rows } = summarizeTechnicians([
      { id: 1, technician_name: 'Sam', status: 'Completed' },
      { id: 2, technician_name: 'Sam', status: 'Cancelled' },
    ])
    expect(rows[0].open).toBe(0)
    expect(rows[0].completed).toBe(1)
    expect(rows[0].cancelled).toBe(1)
  })

  it('leaves a blank or unrecognised status out of every bucket', () => {
    const { rows } = summarizeTechnicians([
      { id: 1, technician_name: 'Sam', status: '' },
      { id: 2, technician_name: 'Sam' },
      { id: 3, technician_name: 'Sam', status: 'Sent to vendor' },
    ])
    expect(rows[0].jobs).toBe(3)
    expect(rows[0].open).toBe(0)
    expect(rows[0].completed).toBe(0)
    expect(rows[0].cancelled).toBe(0)
  })
})

describe('Workshop Management open-job predicate', () => {
  // Same derivation as src/pages/WorkshopManagement.jsx isOpenJob.
  const OPEN_SET = new Set(OPEN_STATUSES)
  const isOpenJob = (o) => OPEN_SET.has(normalizeWoStatus(o?.status))

  it('treats every canonical non-terminal status as an open job', () => {
    for (const status of OPEN_STATUSES) {
      expect(isOpenJob({ status })).toBe(true)
    }
  })

  it('no longer misses Waiting for Parts, Assigned or Quality Inspection', () => {
    // The retired list ['Open','In Progress','Awaiting Parts'] excluded all three.
    const retired = ['Open', 'In Progress', 'Awaiting Parts']
    for (const status of ['Waiting for Parts', 'Assigned', 'Quality Inspection']) {
      expect(retired.includes(status)).toBe(false)
      expect(isOpenJob({ status })).toBe(true)
    }
  })

  it('excludes Completed and Cancelled', () => {
    expect(isOpenJob({ status: 'Completed' })).toBe(false)
    expect(isOpenJob({ status: 'Cancelled' })).toBe(false)
    expect(isOpenJob({ status: 'Closed' })).toBe(false)
  })

  it('excludes a blank or unrecognised status', () => {
    expect(isOpenJob({ status: '' })).toBe(false)
    expect(isOpenJob({})).toBe(false)
    expect(isOpenJob({ status: 'Sent to vendor' })).toBe(false)
  })

  it('normalises a stored legacy token before bucketing', () => {
    expect(isOpenJob({ status: 'Open' })).toBe(true)
    expect(isOpenJob({ status: 'awaiting_parts' })).toBe(true)
    expect(isOpenJob({ status: 'on hold' })).toBe(true)
  })
})
