import { describe, it, expect } from 'vitest'
import {
  CONTROLS, evaluateControls, readinessScore, filterByFramework, domainSummary,
  failedSources, evidencePackRows, activeAttestation, EVIDENCE_COLUMNS,
} from '../lib/complianceControls'

const NOW = new Date('2026-09-24T12:00:00Z').getTime()
const ago = (days) => new Date(NOW - days * 86400000).toISOString()
const ahead = (days) => new Date(NOW + days * 86400000).toISOString()

const POSTURE_IDS = ['rls_disabled', 'anon_table_grants', 'anon_definer_functions', 'definer_search_path', 'owner_views',
  'truncate_grants', 'super_admin_mfa', 'super_admin_count', 'plain_admins', 'public_buckets']

function healthy() {
  return {
    posture: { ok: true, data: { score: 99, checks: POSTURE_IDS.map((id) => ({ id, title: id, status: 'pass', count: 0 })) } },
    scans: { ok: true, data: [{ id: 's1', ran_at: ago(2), score: 99 }] },
    breakGlass: { ok: true, data: [{ id: 1, created_at: ago(1) }] },
    accessReviews: { ok: true, data: [{ id: 'r1', name: 'Q3', status: 'closed', closed_at: ago(10) }] },
    seals: { ok: true, data: ['audit_log_v2', 'access_audit', 'console_sessions'].map((source) => ({ source, day: '2026-09-23' })) },
    backups: { ok: true, data: [{ id: 'b1', taken_at: ago(0.5), table_count: 8 }] },
    consoleSessions: { ok: true, data: [{ id: 'c1', created_at: ago(1) }] },
    config: { ok: true, data: { two_factor_required: 'true', password_min_length: '12', session_timeout_hours: '8', max_login_attempts: '5', audit_retention_days: '365', backup_enabled: 'true' } },
    attestations: { ok: true, data: [] },
  }
}

const byId = (rs) => Object.fromEntries(rs.map((r) => [r.id, r]))

describe('complianceControls', () => {
  it('every control maps to at least one framework and has unique ids', () => {
    const ids = CONTROLS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of CONTROLS) expect((c.soc2?.length || 0) + (c.iso?.length || 0)).toBeGreaterThan(0)
  })

  it('healthy evidence passes every automated control; manual controls need attestation', () => {
    const rs = byId(evaluateControls(healthy(), NOW))
    for (const c of CONTROLS) {
      expect(rs[c.id].status).toBe(c.manual ? 'manual' : 'pass')
    }
  })

  it('a failed source makes dependent controls unknown, never pass', () => {
    const ev = healthy()
    ev.posture = { ok: false, error: 'boom' }
    ev.backups = { ok: false, error: 'boom' }
    const rs = byId(evaluateControls(ev, NOW))
    expect(rs['AC-RLS'].status).toBe('unknown')
    expect(rs['AUTH-MFA'].status).toBe('unknown')
    expect(rs['BAK-NIGHTLY'].status).toBe('unknown')
    expect(rs['AC-REVIEW'].status).toBe('pass')
    expect(failedSources(ev).map((f) => f.key).sort()).toEqual(['backups', 'posture'])
  })

  it('missing evidence object entirely is unknown, not pass', () => {
    const rs = evaluateControls({}, NOW)
    for (const r of rs) expect(r.status).toBe('unknown')
    expect(readinessScore(rs).score).toBeNull()
  })

  it('a posture check absent from the latest scan is unknown', () => {
    const ev = healthy()
    ev.posture.data.checks = ev.posture.data.checks.filter((c) => c.id !== 'rls_disabled')
    expect(byId(evaluateControls(ev, NOW))['AC-RLS'].status).toBe('unknown')
  })

  it('worst posture status wins across grouped checks', () => {
    const ev = healthy()
    ev.posture.data.checks.find((c) => c.id === 'owner_views').status = 'fail'
    expect(byId(evaluateControls(ev, NOW))['AC-DB-PRIV'].status).toBe('fail')
  })

  it('access review ages into warn and fail; none ever run is fail', () => {
    const ev = healthy()
    ev.accessReviews.data[0].closed_at = ago(100)
    expect(byId(evaluateControls(ev, NOW))['AC-REVIEW'].status).toBe('warn')
    ev.accessReviews.data[0].closed_at = ago(200)
    expect(byId(evaluateControls(ev, NOW))['AC-REVIEW'].status).toBe('fail')
    ev.accessReviews.data = []
    expect(byId(evaluateControls(ev, NOW))['AC-REVIEW'].status).toBe('fail')
  })

  it('stale backup warns then fails; backup switched off fails', () => {
    const ev = healthy()
    ev.backups.data[0].taken_at = ago(2)
    expect(byId(evaluateControls(ev, NOW))['BAK-NIGHTLY'].status).toBe('warn')
    ev.backups.data[0].taken_at = ago(5)
    expect(byId(evaluateControls(ev, NOW))['BAK-NIGHTLY'].status).toBe('fail')
    const ev2 = healthy()
    ev2.config.data.backup_enabled = 'false'
    expect(byId(evaluateControls(ev2, NOW))['BAK-NIGHTLY'].status).toBe('fail')
  })

  it('password length bands and 2FA requirement off warns', () => {
    const ev = healthy()
    ev.config.data.password_min_length = '8'
    ev.config.data.two_factor_required = 'false'
    const rs = byId(evaluateControls(ev, NOW))
    expect(rs['AUTH-PASSWORD'].status).toBe('warn')
    expect(rs['AUTH-MFA'].status).toBe('warn')
  })

  it('a missing seal source fails, a stale one warns', () => {
    const ev = healthy()
    ev.seals.data = ev.seals.data.filter((s) => s.source !== 'access_audit')
    expect(byId(evaluateControls(ev, NOW))['LOG-SEALS'].status).toBe('fail')
    const ev2 = healthy()
    ev2.seals.data[0].day = '2026-09-10'
    expect(byId(evaluateControls(ev2, NOW))['LOG-SEALS'].status).toBe('warn')
  })

  it('attestations: active passes, near expiry warns, expired or withdrawn reverts to manual', () => {
    const ev = healthy()
    ev.attestations.data = [{ id: 'a1', control_id: 'AUTH-LEAKED-PW', note: 'on', attested_at: ago(1), expires_at: ahead(90) }]
    expect(byId(evaluateControls(ev, NOW))['AUTH-LEAKED-PW'].status).toBe('pass')
    ev.attestations.data[0].expires_at = ahead(5)
    expect(byId(evaluateControls(ev, NOW))['AUTH-LEAKED-PW'].status).toBe('warn')
    ev.attestations.data[0].expires_at = ago(1)
    expect(byId(evaluateControls(ev, NOW))['AUTH-LEAKED-PW'].status).toBe('manual')
    ev.attestations.data[0].expires_at = ahead(90)
    ev.attestations.data[0].withdrawn_at = ago(0.1)
    expect(activeAttestation(ev.attestations.data, 'AUTH-LEAKED-PW', NOW)).toBeNull()
    ev.attestations = { ok: false, error: 'x' }
    expect(byId(evaluateControls(ev, NOW))['AUTH-LEAKED-PW'].status).toBe('unknown')
  })

  it('readiness counts manual as not evidenced and excludes unknown', () => {
    const rs = [
      { status: 'pass' }, { status: 'warn' }, { status: 'fail' }, { status: 'manual' }, { status: 'unknown' },
    ]
    const r = readinessScore(rs)
    expect(r.score).toBe(Math.round((1.5 / 4) * 100))
    expect(r.evaluated).toBe(4)
    expect(r.coveragePct).toBe(80)
  })

  it('a throwing evaluator is recorded as unknown', () => {
    const rs = evaluateControls({}, NOW, [{ id: 'X', domain: 'D', soc2: ['CC1'], evaluate: () => { throw new Error('x') } }])
    expect(rs[0].status).toBe('unknown')
  })

  it('framework filter, domain summary and evidence pack rows', () => {
    const rs = evaluateControls(healthy(), NOW)
    expect(filterByFramework(rs, 'soc2').length).toBe(rs.length)
    expect(filterByFramework(rs, 'iso').length).toBe(rs.length)
    const doms = domainSummary(rs)
    expect(doms.reduce((a, d) => a + d.total, 0)).toBe(rs.length)
    const rows = evidencePackRows(rs, '2026-09-24T12:00:00Z')
    expect(rows).toHaveLength(rs.length)
    expect(Object.keys(rows[0])).toEqual(EVIDENCE_COLUMNS)
    expect(rows[0].status).toBe('Needs attestation')
  })
})
