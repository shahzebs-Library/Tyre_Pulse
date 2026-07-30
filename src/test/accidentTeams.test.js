import { describe, it, expect } from 'vitest'
import {
  TEAM_DEFS, TEAM_KEYS, buildTeamDistribution, filesForTeam, teamForWorkstream,
} from '../lib/accidentTeams'

const teamOf = (dist, key) => dist.find((t) => t.key === key)

describe('accidentTeams', () => {
  it('defines the five top-level teams and every workstream maps to exactly one', () => {
    expect(TEAM_KEYS).toEqual(['fleet', 'hse', 'insurance', 'workshop', 'finance'])
    const all = TEAM_DEFS.flatMap((t) => t.workstreams)
    expect(new Set(all).size).toBe(all.length) // no workstream owned by two teams
    expect(teamForWorkstream('insurance')).toBe('insurance')
    expect(teamForWorkstream('repair')).toBe('workshop')
    expect(teamForWorkstream('finance')).toBe('finance')
    expect(teamForWorkstream('nope')).toBeNull()
  })

  it('routes each team its own inputs, marking present vs missing honestly', () => {
    const rec = {
      incident_date: '2026-07-20', location: 'NHC', asset_no: 'TM650', driver_name: 'A. Khan',
      police_report_no: '', // missing
      insurer: 'Tawuniya', policy_no: 'P-1', claim_amount: 12000,
      repair_type: 'internal', workshop_name: '', // partial
      final_amount: 0, // zero money is NOT present
    }
    const dist = buildTeamDistribution(rec, [])
    const fleet = teamOf(dist, 'fleet')
    const byKey = Object.fromEntries(fleet.inputs.map((i) => [i.key, i]))
    expect(byKey.incident_date.present).toBe(true)
    expect(byKey.incident_date.value).toBe('2026-07-20')
    expect(byKey.police_report_no.present).toBe(false)

    const ins = teamOf(dist, 'insurance')
    const insByKey = Object.fromEntries(ins.inputs.map((i) => [i.key, i]))
    expect(insByKey.insurer.present).toBe(true)
    expect(insByKey.claim_amount.present).toBe(true) // 12000 > 0

    const fin = teamOf(dist, 'finance')
    const finByKey = Object.fromEntries(fin.inputs.map((i) => [i.key, i]))
    expect(finByKey.final_amount.present).toBe(false) // money 0 is not present
  })

  it('routes uploaded files to the owning team by category, with accident photos to Fleet', () => {
    const rec = {
      photos: ['storage://a/photo1.jpg', 'storage://a/photo2.jpg'],
      documents: [
        { category: 'police_report', name: 'Police report.pdf', url: 'storage://a/police.pdf' },
        { category: 'najm_report', name: 'Najm.pdf', url: 'storage://a/najm.pdf' },
        { category: 'quotation', name: 'Quote.pdf', url: 'storage://a/quote.pdf' },
      ],
    }
    const fleetFiles = filesForTeam(rec, 'fleet')
    expect(fleetFiles.map((f) => f.name)).toContain('Police report.pdf')
    expect(fleetFiles.filter((f) => f.category === 'accident_photo')).toHaveLength(2)

    expect(filesForTeam(rec, 'insurance').map((f) => f.name)).toEqual(['Najm.pdf'])
    expect(filesForTeam(rec, 'workshop').map((f) => f.name)).toEqual(['Quote.pdf'])
    // finance owns none of these categories
    expect(filesForTeam(rec, 'finance')).toHaveLength(0)
  })

  it('routes the incident-form document slots to their teams', () => {
    const rec = {
      documents: [
        { category: 'driving_license', name: 'Licence', url: 'data:image/png;base64,x' },
        { category: 'resident_id', name: 'ID', url: 'data:image/png;base64,x' },
        { category: 'registration', name: 'Reg', url: 'data:image/png;base64,x' },
        { category: 'taqdeer_estimation', name: 'Taqdeer', url: 'storage://a/t.pdf' },
      ],
    }
    expect(filesForTeam(rec, 'fleet').map((f) => f.name).sort()).toEqual(['ID', 'Licence', 'Reg'])
    expect(filesForTeam(rec, 'insurance').map((f) => f.name)).toEqual(['Taqdeer'])
  })

  it('honours the route: required workstreams reflect the case, coverage is honest', () => {
    // A minor uninsured case: no insurance workstream required -> insurance team
    // has nothing required and thus a null work coverage (never a flattering 100).
    const rec = { severity: 'minor', repair_type: 'internal', repair_cost: 500 }
    const dist = buildTeamDistribution(rec, [])
    const ins = teamOf(dist, 'insurance')
    expect(ins.requiredCount).toBe(0)
    expect(ins.workPct).toBeNull()

    const fleet = teamOf(dist, 'fleet')
    expect(fleet.requiredCount).toBeGreaterThan(0)
    expect(fleet.workPct).toBe(0) // required work exists but none completed yet
  })

  it('reflects explicit workstream rows (owner + completed status) in the team view', () => {
    const rec = { insurer: 'Tawuniya', policy_no: 'P-1', claim_amount: 5000 } // insurance in play
    const rows = [
      { workstream: 'insurance', status: 'completed', owner_id: 'u1', owner_role: 'Insurance Officer' },
    ]
    const dist = buildTeamDistribution(rec, rows)
    const ins = teamOf(dist, 'insurance')
    const ws = ins.workstreams.find((w) => w.key === 'insurance')
    expect(ws.status).toBe('completed')
    expect(ws.ownerId).toBe('u1')
    expect(ws.required).toBe(true)
    expect(ins.doneCount).toBe(1)
    expect(ins.workPct).toBe(100)
  })

  it('surfaces the workstream audit timestamps for the trail', () => {
    const rec = { insurer: 'Tawuniya', policy_no: 'P-1', claim_amount: 5000 }
    const rows = [{
      workstream: 'insurance', status: 'completed', owner_id: 'u1',
      assigned_at: '2026-07-20T08:00:00Z', started_at: '2026-07-20T09:00:00Z',
      completed_at: '2026-07-21T14:20:00Z', updated_by: 'u1',
    }]
    const ws = buildTeamDistribution(rec, rows).find((t) => t.key === 'insurance')
      .workstreams.find((w) => w.key === 'insurance')
    expect(ws.assignedAt).toBe('2026-07-20T08:00:00Z')
    expect(ws.completedAt).toBe('2026-07-21T14:20:00Z')
    expect(ws.updatedBy).toBe('u1')
  })
})
