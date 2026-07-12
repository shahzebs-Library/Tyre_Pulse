import { describe, it, expect } from 'vitest'
import {
  FIELD_TYPES, newField, newFieldId, typeHasOptions, isLayoutField, isValueField,
  blankAnswer, validateAnswer, validateSubmission, validateTemplate, fieldTypeDef,
} from '../lib/checklist/fieldTypes'

describe('checklist fieldTypes registry', () => {
  it('exposes the expected field types', () => {
    const types = FIELD_TYPES.map((f) => f.type)
    expect(types).toEqual(expect.arrayContaining([
      'section', 'text', 'textarea', 'number', 'select', 'multiselect',
      'boolean', 'date', 'rating', 'photo', 'signature',
    ]))
    expect(typeHasOptions('select')).toBe(true)
    expect(typeHasOptions('text')).toBe(false)
    expect(fieldTypeDef('rating').label).toMatch(/rating/i)
  })

  it('newField builds sensible defaults per type', () => {
    const sel = newField('select')
    expect(sel.type).toBe('select')
    expect(sel.options.length).toBeGreaterThan(0)
    expect(sel.id).toBeTruthy()
    const sec = newField('section')
    expect(sec.label).toBeTruthy()
    expect(newFieldId()).not.toBe(newFieldId())
  })

  it('classifies layout vs value fields', () => {
    expect(isLayoutField('section')).toBe(true)
    expect(isValueField('section')).toBe(false)
    expect(isValueField('photo')).toBe(false)
    expect(isValueField('signature')).toBe(false)
    expect(isValueField('number')).toBe(true)
  })

  it('blankAnswer matches the field kind', () => {
    expect(blankAnswer({ type: 'multiselect' })).toEqual([])
    expect(blankAnswer({ type: 'boolean' })).toBeNull()
    expect(blankAnswer({ type: 'rating' })).toBe(0)
    expect(blankAnswer({ type: 'text', default: 'x' })).toBe('x')
  })

  it('validateAnswer enforces required + bounds + options', () => {
    expect(validateAnswer({ type: 'text', label: 'Name', required: true }, '')).toMatch(/required/i)
    expect(validateAnswer({ type: 'text', required: false }, '')).toBeNull()
    expect(validateAnswer({ type: 'number', label: 'Qty', min: 1, max: 10 }, 0)).toMatch(/≥|>=|1/)
    expect(validateAnswer({ type: 'number', min: 1, max: 10 }, 5)).toBeNull()
    expect(validateAnswer({ type: 'select', label: 'C', options: ['a', 'b'] }, 'z')).toMatch(/valid/i)
    expect(validateAnswer({ type: 'multiselect', options: ['a', 'b'] }, ['a', 'z'])).toMatch(/Invalid/i)
    expect(validateAnswer({ type: 'rating' }, 9)).toMatch(/0-5|0/)
    expect(validateAnswer({ type: 'section' }, undefined)).toBeNull()
  })

  it('validateSubmission collects per-field errors and skips layout/media', () => {
    const fields = [
      { id: 'a', type: 'text', label: 'A', required: true },
      { id: 'b', type: 'number', label: 'B', min: 0 },
      { id: 'c', type: 'section', label: 'Heading' },
      { id: 'd', type: 'photo', label: 'Pics' },
    ]
    const res = validateSubmission(fields, { a: '', b: 5 })
    expect(res.valid).toBe(false)
    expect(res.errors.a).toBeTruthy()
    expect(res.errors.c).toBeUndefined()
    expect(res.errors.d).toBeUndefined()
    const ok = validateSubmission(fields, { a: 'hi', b: 5 })
    expect(ok.valid).toBe(true)
  })

  it('validateTemplate flags structural problems', () => {
    expect(validateTemplate({ name: '', fields: [] }).length).toBeGreaterThan(0)
    expect(validateTemplate({ name: 'T', fields: [{ type: 'select', label: 'Pick', options: [] }] }))
      .toEqual(expect.arrayContaining([expect.stringMatching(/option/i)]))
    expect(validateTemplate({ name: 'T', fields: [{ type: 'text', label: 'Ok' }] })).toEqual([])
  })
})
