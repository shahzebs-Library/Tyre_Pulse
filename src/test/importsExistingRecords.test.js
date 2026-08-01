import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { table: null, columns: null, probe: null, values: null, country: null, data: [] }

  function from(table) {
    const query = {
      select(columns) {
        state.table = table
        state.columns = columns
        return query
      },
      in(probe, values) {
        state.probe = probe
        state.values = values
        return query
      },
      eq(field, value) {
        if (field === 'country') state.country = value
        return query
      },
      then(resolve, reject) {
        return Promise.resolve({ data: state.data, error: null }).then(resolve, reject)
      },
    }
    return query
  }

  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { existingRecords } = await import('../lib/api/imports')

beforeEach(() => {
  Object.assign(h.state, {
    table: null,
    columns: null,
    probe: null,
    values: null,
    country: null,
    data: [{ id: 't1', country: 'KSA', serial_no: 'SN-1', brand: 'Brand A' }],
  })
})

describe('existingRecords', () => {
  it('does not select preview-only derived fields from the live tyre table', async () => {
    const records = await existingRecords({
      module: 'tyre',
      country: 'KSA',
      rows: [{ country: 'KSA', serial_no: 'SN-1', brand: 'Brand A' }],
    })

    expect(h.state.table).toBe('tyre_records')
    expect(h.state.columns.split(',')).not.toContain('total_amount')
    expect(h.state.probe).toBe('serial_no')
    expect(h.state.values).toEqual(['SN-1'])
    expect(h.state.country).toBe('KSA')
    expect(records.size).toBe(1)
  })
})
