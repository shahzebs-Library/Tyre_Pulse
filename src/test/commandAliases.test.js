import { describe, it, expect } from 'vitest'
import {
  NAV_COMMANDS, ACTION_COMMANDS, rankCommands, commandKeywords, scoreCommand,
} from '../lib/commandSearch'

/**
 * Search aliases: the words people type that are not in the label.
 *
 * The pairs below were not invented. Every one was MEASURED against the palette
 * before being added, and each returned nothing at all: this fleet's ERP calls a
 * work order a "job card" (its numbers are literally GCKR/JC/...), the vehicle
 * register is searched by plate and chassis, meters are read off an "hour
 * meter", and a goods receipt is a GRN. Someone typing the only word they know
 * for a thing should not be told the app does not have it.
 */
const ALL = [...NAV_COMMANDS, ...ACTION_COMMANDS]
const top = (q, n = 3) => rankCommands(ALL, q, n).map((c) => c.label)

describe('command search aliases', () => {
  it('finds the page under the word the business actually uses', () => {
    const CASES = [
      ['job card', 'Work Orders'],
      ['jc', 'Work Orders'],
      ['purchase order', 'Procurement'],
      ['plate', 'Fleet Master'],
      ['vin', 'Fleet Master'],
      ['chassis', 'Fleet Master'],
      ['hour meter', 'Engine Hours'],
      ['grn', 'Goods Receipt'],
      ['sso', 'Security Center'],
      ['2fa', 'Security Center'],
      ['api key', 'API & Webhooks'],
    ]
    for (const [query, expected] of CASES) {
      expect(top(query), `"${query}" should surface ${expected}`).toContain(expected)
    }
  })

  it('reads aliases written as a sentence, not only as an array', () => {
    // One command's keywords were a plain sentence, and Array.isArray dropped
    // them silently - those aliases had never matched anything. A sentence is
    // now kept whole AND split, so both a phrase and a single word find it.
    expect(top('who approves')).toContain('Approval Matrix')
    expect(top('signer')).toContain('Approval Matrix')

    expect(commandKeywords({ keywords: 'who approves signer' }))
      .toEqual(['who approves signer', 'who', 'approves', 'signer'])
    expect(commandKeywords({ keywords: ['Job Card'] })).toEqual(['job card'])
    expect(commandKeywords({})).toEqual([])
    expect(commandKeywords(null)).toEqual([])
  })

  it('keeps an alias below a real label match', () => {
    // An alias must never outrank a page whose own name the user typed, or
    // searching "Procurement" could hand back something else entirely.
    const procurement = ALL.find((c) => c.label === 'Procurement')
    const workOrders = ALL.find((c) => c.label === 'Work Orders')
    expect(scoreCommand(procurement, 'procurement')).toBeGreaterThan(
      scoreCommand(workOrders, 'job card'),
    )
    expect(top('work orders')[0]).toBe('Work Orders')
  })

  it('has no alias that just repeats its own label', () => {
    // A duplicate alias is dead weight and hides how thin real coverage is.
    for (const cmd of ALL) {
      const label = cmd.label.toLowerCase()
      for (const k of commandKeywords(cmd)) {
        expect(k, `${cmd.label} repeats its own label as an alias`).not.toBe(label)
      }
    }
  })
})
