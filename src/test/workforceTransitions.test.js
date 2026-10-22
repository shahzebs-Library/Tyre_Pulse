import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TRANSITIONS, availableActions, reasonMessage } from '../lib/workforceTransitions.js'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r/g, '')
const sql = read('../../supabase/migrations/20261023090000_workforce_transitions_and_estimation.sql')
const dart = read('../../tyre_pulse_flutter/lib/features/my_work/domain/workforce_transition.dart')

function sqlCases() {
  const out = {}
  const re = /WHEN '(\w+)'\s+THEN v_from:=ARRAY\[([^\]]*)\]; v_to:='(\w+)';( v_manager_action:=true;)?/g
  let m
  while ((m = re.exec(sql))) {
    out[m[1]] = {
      from: [...m[2].matchAll(/'(\w+)'/g)].map(x => x[1]),
      to: m[3],
      manager: Boolean(m[4]),
    }
  }
  return out
}

function dartCases() {
  const out = {}
  const re = /(\w+)\(\s*wire: '(\w+)',\s*label: '[^']*',\s*from: <String>\[([^\]]*)\],\s*to: '(\w+)',\s*noteRequired: (true|false),/g
  let m
  while ((m = re.exec(dart))) {
    out[m[2]] = {
      from: [...m[3].matchAll(/'(\w+)'/g)].map(x => x[1]),
      to: m[4],
      noteRequired: m[5] === 'true',
    }
  }
  return out
}

describe('workforce transition vocabulary parity', () => {
  const s = sqlCases()

  it('parsed all eight actions from the SQL', () => {
    expect(Object.keys(s).sort()).toEqual(Object.keys(TRANSITIONS).sort())
  })

  it('web table matches the SQL CASE block', () => {
    for (const [key, t] of Object.entries(TRANSITIONS)) {
      expect(s[key].from, key).toEqual(t.from)
      expect(s[key].to, key).toBe(t.to)
      expect(s[key].manager, key).toBe(t.actor === 'manager')
    }
  })

  it('web note rule matches the SQL note-required list', () => {
    const m = sql.match(/IF p_action IN \(([^)]*)\) AND v_note IS NULL/)
    const required = [...m[1].matchAll(/'(\w+)'/g)].map(x => x[1]).sort()
    const web = Object.entries(TRANSITIONS).filter(([, t]) => t.noteRequired).map(([k]) => k).sort()
    expect(web).toEqual(required)
  })

  it('Dart enum matches the SQL for every assignee action', () => {
    const d = dartCases()
    const assignee = Object.entries(s).filter(([, v]) => !v.manager).map(([k]) => k).sort()
    expect(Object.keys(d).sort()).toEqual(assignee)
    for (const key of assignee) {
      expect(d[key].from, key).toEqual(s[key].from)
      expect(d[key].to, key).toBe(s[key].to)
      expect(d[key].noteRequired, key).toBe(TRANSITIONS[key].noteRequired)
    }
  })
})

describe('availableActions', () => {
  it('offers the assignee only their own actions', () => {
    expect(availableActions('assigned', { isAssignee: true })).toEqual(['accept', 'start'])
    expect(availableActions('in_progress', { isAssignee: true })).toEqual(['block', 'complete'])
    expect(availableActions('blocked', { isAssignee: true })).toEqual(['resume'])
    expect(availableActions('submitted', { isAssignee: true })).toEqual([])
  })

  it('offers review to managers, but not on their own work', () => {
    expect(availableActions('submitted', { isManager: true })).toEqual(['verify', 'return', 'cancel'])
    expect(availableActions('submitted', { isManager: true, isAssignee: true })).toEqual(['cancel'])
  })

  it('offers nothing to a viewer who is neither', () => {
    expect(availableActions('assigned', {})).toEqual([])
  })

  it('explains refusals in plain words and never invents a reason', () => {
    expect(reasonMessage('self_review')).toMatch(/cannot review/)
    expect(reasonMessage('invalid_transition', 'in_progress')).toMatch(/in progress/)
    expect(reasonMessage('weird')).toBe('The update was not accepted.')
  })
})
