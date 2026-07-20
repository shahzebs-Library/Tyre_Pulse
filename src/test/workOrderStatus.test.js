import { describe, it, expect } from 'vitest'
import {
  WO_STATUSES, WO_STATUS_LABEL, KANBAN_COLUMNS,
  normalizeWoStatus, woKanbanColumn, isOpenWoStatus, isClosedWoStatus,
} from '../lib/workOrderStatus.js'

describe('workOrderStatus', () => {
  it('exposes the canonical Title Case set + labels', () => {
    expect(WO_STATUSES).toContain('In Progress')
    expect(WO_STATUSES).toContain('Quality Inspection')
    expect(WO_STATUS_LABEL['In Progress']).toBe('In Progress')
  })

  it('folds lowercase_underscore engine tokens to Title Case', () => {
    expect(normalizeWoStatus('in_progress')).toBe('In Progress')
    expect(normalizeWoStatus('quality_inspection')).toBe('Quality Inspection')
    expect(normalizeWoStatus('waiting_parts')).toBe('Waiting for Parts')
    expect(normalizeWoStatus('waiting_approval')).toBe('Waiting for Approval')
    expect(normalizeWoStatus('awaiting_assignment')).toBe('Awaiting Assignment')
    expect(normalizeWoStatus('on_hold')).toBe('On Hold')
  })

  it('is idempotent on canonical Title Case', () => {
    for (const s of WO_STATUSES) expect(normalizeWoStatus(s)).toBe(s)
  })

  it('handles case / space / hyphen variants and synonyms', () => {
    expect(normalizeWoStatus('IN PROGRESS')).toBe('In Progress')
    expect(normalizeWoStatus('in-progress')).toBe('In Progress')
    expect(normalizeWoStatus('  In   Progress ')).toBe('In Progress')
    expect(normalizeWoStatus('qc')).toBe('Quality Inspection')
    expect(normalizeWoStatus('Awaiting Parts')).toBe('Waiting for Parts')
    expect(normalizeWoStatus('Open')).toBe('New')
    expect(normalizeWoStatus('Closed')).toBe('Completed')
    expect(normalizeWoStatus('done')).toBe('Completed')
  })

  it('passes unknown values through trimmed (never crashes)', () => {
    expect(normalizeWoStatus('Something Custom')).toBe('Something Custom')
    expect(normalizeWoStatus('  weird  ')).toBe('weird')
    expect(normalizeWoStatus(null)).toBe('')
    expect(normalizeWoStatus(undefined)).toBe('')
    expect(normalizeWoStatus('')).toBe('')
  })

  it('buckets a job into its kanban column', () => {
    expect(woKanbanColumn('in_progress')).toBe('In Progress')
    expect(woKanbanColumn('New')).toBe('New')
    expect(woKanbanColumn('quality_inspection')).toBe('Quality Inspection')
    // Statuses without a column fall back so the job is never dropped.
    expect(woKanbanColumn('On Hold')).toBe('Awaiting Assignment')
    expect(woKanbanColumn('')).toBe('Awaiting Assignment')
    expect(KANBAN_COLUMNS).toContain(woKanbanColumn('anything-unknown'))
  })

  it('Overdue wins when overdue and not Completed/Cancelled', () => {
    expect(woKanbanColumn('in_progress', { overdue: true })).toBe('Overdue')
    expect(woKanbanColumn('Assigned', { overdue: true })).toBe('Overdue')
    // A completed or cancelled job is never shown as Overdue.
    expect(woKanbanColumn('Completed', { overdue: true })).toBe('Completed')
    expect(woKanbanColumn('cancelled', { overdue: true })).toBe('Awaiting Assignment')
  })

  it('classifies open vs closed', () => {
    expect(isClosedWoStatus('Completed')).toBe(true)
    expect(isClosedWoStatus('closed')).toBe(true)
    expect(isClosedWoStatus('cancelled')).toBe(true)
    expect(isOpenWoStatus('in_progress')).toBe(true)
    expect(isOpenWoStatus('Overdue')).toBe(true)
    expect(isOpenWoStatus('On Hold')).toBe(true)
    expect(isOpenWoStatus('')).toBe(true)
  })
})
