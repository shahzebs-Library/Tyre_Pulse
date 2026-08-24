import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// t returns the key, which drives the component's English-fallback path. That is
// deliberate: it proves a missing translation renders real words, not a key path.
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: k => k, lang: 'en' }),
}))

const { default: JobCardForm } = await import('../components/workorders/JobCardForm')
const { JOB_CARD_SECTIONS, editableFields, toPayload } = await import('../lib/jobCard')

const VALID = {
  asset_no: 'TM100',
  status: 'New',
  priority: 'Medium',
  work_type: 'Repair',
  opened_at: '2026-08-20T06:00',
  parts_used: [],
}

function setup(overrides = {}) {
  const onSave = vi.fn()
  const onChange = vi.fn()
  const utils = render(
    <JobCardForm
      value={{ ...VALID, ...(overrides.value || {}) }}
      onChange={overrides.onChange || onChange}
      row={overrides.row ?? null}
      mode={overrides.mode || 'create'}
      locked={overrides.locked || false}
      onSave={onSave}
      onCancel={vi.fn()}
      saving={false}
      assetLookup={overrides.assetLookup}
      currency="SAR"
    />,
  )
  return { ...utils, onSave, onChange }
}

describe('JobCardForm covers the whole job card', () => {
  it('renders every catalog section', () => {
    setup()
    for (const s of JOB_CARD_SECTIONS) {
      expect(screen.getByText(s.label)).toBeTruthy()
    }
  })

  it('exposes the job-card fields the old 16-field form left unreachable', () => {
    // These are the point of the whole change: they were loaded from the ERP
    // export and could not be seen or edited.
    const { container } = setup()
    const labels = Array.from(container.querySelectorAll('label')).map(l => l.textContent)
    for (const expected of [
      'RFR Number', 'MR No', 'SCO No',
      'Asset Description', 'Plate No', 'Truck Category', 'Head / Tail',
      'Scope', 'Work Location',
      'Production Out', 'Workshop In', 'Workshop Out', 'Production In',
      'Total Breakdown Hours', 'Standard Hours',
      'Waiting for Parts (hrs)', 'Waiting for Manpower (hrs)',
    ]) {
      expect(labels.some(l => l && l.includes(expected))).toBe(true)
    }
  })

  it('is driven by the catalog, so it cannot silently drop a field', () => {
    const { container } = setup()
    const labels = Array.from(container.querySelectorAll('label')).map(l => l.textContent || '')
    // Every editable field must have a label rendered somewhere in the form.
    const missing = editableFields()
      .filter(f => !labels.some(l => l.includes(f.label)))
      .map(f => f.key)
    expect(missing).toEqual([])
  })

  it('renders a read-only field as text, never as an input', () => {
    const { container } = setup({ row: { source_row: '42', custom_data: { raised_by: '10012679' } } })
    const inputNames = Array.from(container.querySelectorAll('input, textarea, select'))
      .map(el => el.getAttribute('list') || '')
    // source_row and raised_by are provenance: they must not be editable.
    expect(inputNames.some(n => n.includes('source_row'))).toBe(false)
    expect(screen.getByText('10012679')).toBeTruthy()
  })
})

describe('JobCardForm validation', () => {
  it('blocks the save on a missing required field', () => {
    const { onSave } = setup({ value: { asset_no: '' } })
    fireEvent.click(screen.getByText(/Create job card/i))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does NOT block on a chronology warning', () => {
    // A job card is filled in over days; a half-complete flow is the normal
    // state, so an out-of-order pair must warn and still save.
    const { onSave } = setup({
      value: {
        production_out_at: '2026-08-20T10:00',
        started_at: '2026-08-20T06:00',
      },
    })
    fireEvent.click(screen.getByText(/Create job card/i))
    expect(onSave).toHaveBeenCalled()
  })
})

describe('JobCardForm asset auto-fill', () => {
  it('never overwrites a value the user already typed', async () => {
    const onChange = vi.fn()
    const assetLookup = vi.fn(async () => ({
      registration_no: 'FROM-MASTER',
      vehicle_type: 'TR-MIXER',
      model: 'MASTER MODEL',
      site: 'MASTER SITE',
    }))
    setup({
      value: { asset_no: 'TM100', plate_no: 'TYPED-BY-USER', site: '' },
      onChange,
      assetLookup,
    })
    // Let the debounce and the lookup settle.
    await new Promise(r => setTimeout(r, 600))

    const written = onChange.mock.calls.map(([k, v]) => `${k}=${v}`)
    // The empty field was filled...
    expect(written).toContain('site=MASTER SITE')
    // ...and the typed one was left alone.
    expect(written.some(w => w.startsWith('plate_no='))).toBe(false)
  })
})

describe('what actually gets saved', () => {
  it('never includes total_cost, which is a generated column', () => {
    expect(toPayload({ ...VALID, total_cost: 4321 })).not.toHaveProperty('total_cost')
  })
})
