import { useCallback, useMemo, useRef } from 'react'
import { useLanguage } from '../../contexts/LanguageContext'
import { workstreamName, eventLabel } from '../../lib/accidentOwnership'

/**
 * Translated labels for the accident ownership screens (settings tabs, case
 * header, task inbox, who-holds-what). Strings live in the accidentOwnership
 * locale namespace; anything the dictionary does not carry (a custom role, a
 * new step) falls back to the English text from lib/accidentOwnership.
 */
const NS = 'accidentOwnership'

export default function useAccidentOwnershipText() {
  const { t, language } = useLanguage()
  // t's identity can change on every render (the no-provider fallback builds a
  // new one each time); reading it through a ref keeps tx stable so loaders that
  // list it as a dependency do not refetch in a loop.
  const tRef = useRef(t)
  tRef.current = t
  const tx = useCallback((key, vars) => tRef.current(`${NS}.${key}`, vars), [])
  // A lookup that returns the fallback when the key is not in the dictionary.
  const look = useCallback((key, fallback) => {
    const full = `${NS}.${key}`
    const v = tRef.current(full)
    return v && v !== full ? v : fallback
  }, [])

  return useMemo(() => {
    const step = (key) => look(`steps.${key}`, workstreamName(key))
    const role = (name) => (name ? look(`roles.${name}`, name) : '')
    const event = (key) => look(`events.${String(key || '').replace(/\./g, '_')}`, eventLabel(key))
    const severity = (field) => tx(`severity.${String(field).replace('sla_minutes_', '')}`)
    const days = (value) => {
      if (value === null || value === undefined || value === '') return tx('common.na')
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) return tx('common.na')
      if (n < 1) return tx('common.today')
      const r = Math.round(n * 10) / 10
      return tx(r === 1 ? 'common.day' : 'common.days', { n: r })
    }
    const slaMinutes = (min) => {
      const n = Number(min)
      if (min === null || min === undefined || min === '' || !Number.isFinite(n) || n <= 0) return tx('common.notSet')
      if (n % 1440 === 0) return n === 1440 ? tx('common.slaDay') : tx('common.slaDays', { n: n / 1440 })
      if (n % 60 === 0) return tx('common.slaHours', { n: n / 60 })
      return tx('common.slaMinutes', { n })
    }
    const slaState = (task) => (task?.overdue ? tx('sla.breached') : look(`sla.${task?.sla_state}`, tx('sla.none')))
    const anyRole = (r) => tx('common.anyRole', { role: role(r) })
    const holder = (row) => {
      if (!row) return tx('common.nobody')
      if (row.holder_name) return row.holder_name
      if (row.holder_role) return anyRole(row.holder_role)
      return tx('common.noOwner')
    }
    const gap = (g) => look(`gaps.${g.key}`, g.label)
    const ruleSummary = (rule, nameById = {}) => {
      if (!rule) return tx('common.nobody')
      const parts = []
      if (rule.notify_owner) parts.push(tx('notify.stepOwner'))
      for (const r of rule.roles || []) parts.push(role(r))
      for (const id of rule.user_ids || []) parts.push(nameById[id] || tx('common.namedPerson'))
      if (rule.notify_driver) parts.push(tx('notify.driver'))
      let s = parts.length ? parts.join(', ') : tx('common.nobody')
      if (rule.only_when_serious) s += tx('notify.summarySerious', { cost: Number(rule.serious_cost || 20000).toLocaleString() })
      if (rule.event_key === 'accident.stalled') {
        s += rule.stalled_days ? tx('notify.summaryStalled', { n: rule.stalled_days }) : tx('notify.summaryNoDays')
      }
      return s
    }
    return { tx, step, role, event, severity, days, slaMinutes, slaState, anyRole, holder, gap, ruleSummary }
  }, [tx, look, language]) // eslint-disable-line react-hooks/exhaustive-deps
}
