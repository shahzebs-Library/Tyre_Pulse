import { describe, it, expect } from 'vitest'
import {
  LOGIN_ARTWORK, LOGIN_COUNTRIES, parseLoginArt, serializeLoginArt, defaultLoginArt, changedFromDefault,
} from '../lib/mobileLoginArt'
import fs from 'node:fs'
import path from 'node:path'

describe('mobileLoginArt', () => {
  it('defaults every country to its own landmark', () => {
    expect(parseLoginArt(null)).toEqual(defaultLoginArt())
    expect(defaultLoginArt()).toEqual({
      saudi_arabia: 'saudi_landmark', united_arab_emirates: 'uae_landmark', egypt: 'egypt_landmark',
    })
  })

  it('reads an object, a JSON string and a double-quoted JSON string', () => {
    const m = { saudi_arabia: 'fleet_machines' }
    expect(parseLoginArt(m).saudi_arabia).toBe('fleet_machines')
    expect(parseLoginArt(JSON.stringify(m)).saudi_arabia).toBe('fleet_machines')
    expect(parseLoginArt(JSON.stringify(JSON.stringify(m))).saudi_arabia).toBe('fleet_machines')
  })

  it('drops unknown pictures and countries instead of storing a key the phone cannot draw', () => {
    const m = parseLoginArt({ saudi_arabia: 'nope', mars: 'fleet_machines', egypt: 42 })
    expect(m).toEqual(defaultLoginArt())
    expect(JSON.parse(serializeLoginArt({ mars: 'x' }))).toEqual(defaultLoginArt())
  })

  it('treats junk as the defaults', () => {
    expect(parseLoginArt('not json')).toEqual(defaultLoginArt())
    expect(parseLoginArt('[1,2]')).toEqual(defaultLoginArt())
  })

  it('reports which countries moved off their landmark', () => {
    expect(changedFromDefault({ egypt: 'fleet_machines' })).toEqual(['egypt'])
  })

  it('every preview image exists and every default is a catalog entry', () => {
    for (const a of LOGIN_ARTWORK) {
      expect(fs.existsSync(path.join('public', a.preview))).toBe(true)
    }
    const keys = new Set(LOGIN_ARTWORK.map((a) => a.key))
    for (const c of LOGIN_COUNTRIES) expect(keys.has(c.defaultArt)).toBe(true)
  })

  it('matches the Flutter mirror keys', () => {
    const dart = fs.readFileSync('tyre_pulse_flutter/lib/features/auth/domain/login_artwork.dart', 'utf8')
    for (const a of LOGIN_ARTWORK) expect(dart).toContain(`'${a.key}'`)
    const countries = fs.readFileSync('tyre_pulse_flutter/lib/features/auth/domain/login_country.dart', 'utf8')
    for (const c of LOGIN_COUNTRIES) expect(countries).toContain(`'${c.key}'`)
  })
})
