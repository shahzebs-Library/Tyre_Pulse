import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import en from '../locales/en/oemcatalog.json'

vi.mock('../contexts/LanguageContext', () => {
  const get = (key) => key.replace(/^oemcatalog\./, '').split('.').reduce((o, k) => (o ? o[k] : undefined), en)
  const t = (key, vars) => String(get(key) ?? key).replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : `{${k}}`))
  return { useLanguage: () => ({ t, language: 'en', isRTL: false }) }
})

import OemCatalogViewer from '../components/oemCatalog/OemCatalogViewer'
import { ImportReviewPanel, SearchResultsTable, SelectedPartsTable } from '../components/oemCatalog/OemTables'

const row = (i, idx, pn) => ({ id: `r${i}`, index_no: idx, part_no: pn, description: `Part ${i}`, quantity: 1, source_pdf_page: 30, printed_page: '2-14', illustration_pdf_page: 4 })
const group = { page: 4, label: 'Water Supply System', printedPages: ['2-14'], sourcePages: [30], rows: [row(1, '1', '60012345'), row(2, '2', '60012346')] }
const manual = { id: 'm', manufacturer: 'SANY', model: 'SY412C-8/ST', import_summary: { figures: { 'F2-14': { area: 'upper', confidence: 0.95 } } } }

function setup(over = {}) {
  const props = {
    manual, manualOptions: [manual], onChooseManual: vi.fn(), asset: { chassis_no: 'HNGJ1' }, fitment: 'exact',
    groups: [group], activeGroup: group, onOpenGroup: vi.fn(), pdfDoc: null, selectedIndex: '2', onSelectIndex: vi.fn(),
    selectedKeys: new Set(), onAddRows: vi.fn(), onRequestSelected: vi.fn(), onOpenSource: vi.fn(), loading: false, error: '', ...over,
  }
  // The page owns the selected index; keep it in state so a click behaves as on the real page.
  function Harness() {
    const [selectedIndex, setSelectedIndex] = useState(props.selectedIndex)
    return <OemCatalogViewer {...props} selectedIndex={selectedIndex} onSelectIndex={(v) => { props.onSelectIndex(v); setSelectedIndex(v) }} />
  }
  render(<Harness />)
  return props
}

describe('OemCatalogViewer', () => {
  it('shows fitment, breadcrumb, source footer and highlights the selected row', () => {
    setup()
    expect(screen.getByText('Fitment confirmed')).toBeTruthy()
    expect(screen.getByText('Upper part assembly', { selector: 'li' })).toBeTruthy()
    expect(screen.getByText(/Source: SANY Parts Book/)).toBeTruthy()
    expect(document.querySelector('tr[data-selected="true"] .oem-pn').textContent).toBe('60012346')
  })
  it('selects a row on click and adds the selected part', () => {
    const p = setup()
    fireEvent.click(screen.getByText('60012345'))
    expect(p.onSelectIndex).toHaveBeenCalledWith('1')
    fireEvent.click(screen.getByText('Add selected part to work order'))
    // The clicked row is the part that gets added, not whatever index was selected before.
    expect(p.onRequestSelected.mock.calls[0][0].map((r) => r.part_no)).toEqual(['60012345'])
  })
  it('makes every one of ten parts under one callout individually selectable, with asset and location', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...row(i + 1, '5', `PN-${i + 1}`), remark: `Variant ${i + 1}` }))
    const g = { ...group, rows: ten }
    const p = setup({ groups: [g], activeGroup: g, selectedIndex: '5', asset: { asset_no: 'TM514', site: 'NHC', chassis_no: 'HNGJ1' } })
    const picked = () => screen.getByTestId('oem-picked')
    // Callout selected: the whole group of 10 is listed, each with the vehicle's asset and location.
    expect(picked().textContent).toContain('Index 5: 10 parts')
    expect(picked().querySelectorAll('li')).toHaveLength(10)
    expect(document.querySelectorAll('.oem-where')).toHaveLength(10)
    document.querySelectorAll('.oem-where').forEach((el) => expect(el.textContent).toBe('TM514 · NHC'))
    const buttons = screen.getAllByRole('button', { name: /^Select part PN-/ })
    expect(buttons).toHaveLength(10)
    buttons.forEach((btn, i) => {
      fireEvent.click(btn)
      expect(p.onSelectIndex).toHaveBeenLastCalledWith('5')
      expect(btn.getAttribute('aria-pressed')).toBe('true')
      expect(picked().textContent).toContain('Selected part')
      expect(picked().textContent).toContain(`PN-${i + 1}`)
      expect(picked().textContent).toContain('Asset TM514')
      expect(picked().textContent).toContain('Location NHC')
      expect(picked().querySelectorAll('li')).toHaveLength(1)
      fireEvent.click(screen.getByText('Add selected part to work order'))
      expect(p.onRequestSelected.mock.calls.at(-1)[0].map((r) => r.id)).toEqual([`r${i + 1}`])
    })
    expect(p.onRequestSelected).toHaveBeenCalledTimes(10)
  })
  it('says No asset / No location when the vehicle record holds neither', () => {
    setup({ asset: { chassis_no: 'HNGJ1' }, selectedIndex: '2' })
    expect(screen.getByTestId('oem-picked').textContent).toContain('Asset No asset')
    expect(screen.getByTestId('oem-picked').textContent).toContain('Location No location')
  })
  it('uses saved figures (oem_figures) over the import snapshot', () => {
    // Snapshot says upper; the saved figure (admin corrected) says chassis and wins.
    setup({ figureRows: [{ figure_id: 'F2-14', pdf_page: 4, hierarchy: { area: 'chassis', area_confidence: 0.9 }, match_status: 'verified' }] })
    expect(screen.getByText('Chassis', { selector: 'li' })).toBeTruthy()
    expect(screen.queryByText('Upper part assembly', { selector: 'li' })).toBeNull()
  })
  it('follows a group\'s saved figure link before its printed page', () => {
    const linked = { ...group, figureId: 'F9-1' }
    setup({ groups: [linked], activeGroup: linked, figureRows: [{ figure_id: 'F9-1', pdf_page: 4, hierarchy: { area: 'chassis' } }, { figure_id: 'F2-14', pdf_page: 4, hierarchy: { area: 'upper' } }] })
    expect(screen.getByText('Chassis', { selector: 'li' })).toBeTruthy()
  })
  it('flags unconfirmed fitment and disables adding with nothing selected', () => {
    setup({ fitment: 'unconfirmed', selectedIndex: '' })
    expect(screen.getByText('Fitment not confirmed')).toBeTruthy()
    expect(screen.getByText('Add selected part to work order').closest('button').disabled).toBe(true)
  })
})

describe('OemTables', () => {
  it('review panel lists queued rows with reasons', () => {
    const result = { summary: { published: 5, reviewRows: 1, figureCount: 2, duplicatesDropped: 0, areaCounts: { chassis: 1, upper: 1 }, orphanCallouts: [{ pdfPage: 4, indexes: ['9'] }] }, review: [{ figure_id: 'F2-14', row_order: 1, part_no: 'BAD', confidence: 0.3, issues: [{ message: 'Part number too short' }] }] }
    render(<ImportReviewPanel result={result} />)
    expect(screen.getByText('Review queue')).toBeTruthy()
    expect(screen.getByText(/Part number too short/)).toBeTruthy()
    expect(screen.getByText(/1 callout numbers/)).toBeTruthy()
  })
  it('selected parts list shows each part\'s asset code and location', () => {
    const items = [
      { key: 'm:r1', row: row(1, '5', 'PN-1'), manual, figureLabel: 'Water', assetNo: 'TM514', site: 'NHC', requestedQty: 1 },
      { key: 'm:r2', row: row(2, '5', 'PN-2'), manual, figureLabel: 'Water', assetNo: null, site: null, requestedQty: 1 },
    ]
    render(<SelectedPartsTable items={items} onQty={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText('TM514')).toBeTruthy()
    expect(screen.getByText('NHC')).toBeTruthy()
    expect(screen.getByText('No asset')).toBeTruthy()
    expect(screen.getByText('No location')).toBeTruthy()
  })
  it('search results table wires view and add actions', () => {
    const onView = vi.fn(); const onAdd = vi.fn()
    render(<SearchResultsTable entries={[{ ...row(1, '1', '60012345'), manual_id: 'm', manual }]} selectedKeys={new Set()} onView={onView} onAdd={onAdd} />)
    fireEvent.click(screen.getByText('View figure'))
    fireEvent.click(screen.getByText('Add'))
    expect(onView).toHaveBeenCalled(); expect(onAdd).toHaveBeenCalled()
  })
})
