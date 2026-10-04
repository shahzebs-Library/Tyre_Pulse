import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { shapeReach, retryImpact, pushStats } from '../lib/api/deliveryHealth'
import { schedulePauseImpact } from '../lib/api/automationHealth'
import { ruleImpact, isEvaluatedMetric, metricLabel, ALERT_METRICS } from '../lib/api/alertRules'

describe('delivery reach and retry', () => {
  it('shapes reach and keeps a missing field as null, never 0', () => {
    expect(shapeReach({ ok: true, flutter_devices: 0, retired_devices: 130 })).toMatchObject({ flutterDevices: 0, retiredDevices: 130, flutterPeople: null })
    expect(shapeReach({ ok: false })).toBeNull()
    expect(shapeReach(null)).toBeNull()
  })
  it('names the Flutter app and FCM in the retry impact', () => {
    const r = retryImpact(3, 0)
    expect(r.what).toMatch(/3 failed pushes/)
    expect(r.who).toMatch(/Flutter app/)
    expect(retryImpact(1, null).who).toMatch(/could not be read/)
  })
  it('counts skipped pushes apart from queued ones', () => {
    const s = pushStats([{ status: 'skipped' }, { status: 'pending' }, { status: 'delivered' }])
    expect(s.skipped).toBe(1)
    expect(s.queued).toBe(1)
    expect(s.delivered).toBe(1)
  })
})

describe('automation impact', () => {
  it('describes pausing and resuming a schedule', () => {
    expect(schedulePauseImpact({ name: 'Weekly', active: true, frequency: 'weekly' }, 2).change).toMatch(/stops emailing/)
    expect(schedulePauseImpact({ name: 'Weekly', active: false }, 0).who).toMatch(/No recipients/)
  })
})

describe('alert rule honesty', () => {
  it('says email is not sent and who is told', () => {
    expect(ruleImpact({ metric: 'open_accidents', notifyInApp: true, notifyEmail: true, active: true }).who).toMatch(/does not send email/)
    expect(ruleImpact({ metric: 'open_accidents', notifyInApp: false, notifyEmail: true }).who).toMatch(/Nobody/)
  })
  it('flags the legacy metric the hourly check never computes', () => {
    expect(isEvaluatedMetric('low_pressure')).toBe(false)
    expect(metricLabel('low_pressure')).toMatch(/not checked/)
    expect(ALERT_METRICS.every((m) => isEvaluatedMetric(m.key))).toBe(true)
  })
})
