import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { buildCsv, escapeCsvValue } from '../lib/tableExport'

// ── fixtures ─────────────────────────────────────────────────────────────────
const DATA = [
  ...Array.from({ length: 59 }, (_, i) => ({
    id: `veh-${i + 1}`,
    name: `Vehicle ${String(i + 1).padStart(2, '0')}`,
    status: i % 2 === 0 ? 'Active' : 'Retired',
    qty: 100 - i,
  })),
  { id: 'veh-zebra', name: 'Zebra Special', status: 'Active', qty: 1 },
]

const COLUMNS = [
  { accessorKey: 'name', header: 'Name', meta: { filterVariant: 'text' } },
  { accessorKey: 'status', header: 'Status', meta: { filterVariant: 'select', filterOptions: ['Active', 'Retired'] } },
  { accessorKey: 'qty', header: 'Qty' },
]

function renderTable(props = {}) {
  return render(
    <EnterpriseTable
      columns={COLUMNS}
      data={DATA}
      getRowId={r => r.id}
      searchDebounceMs={0}
      {...props}
    />
  )
}

function bodyRows(container) {
  // Data rows only (skeleton/empty rows have a single full-width cell).
  return [...container.querySelectorAll('tbody tr')].filter(
    tr => tr.querySelectorAll('td').length > 1
  )
}

afterEach(() => cleanup())

// ── rendering ────────────────────────────────────────────────────────────────
describe('EnterpriseTable rendering', () => {
  it('renders headers and paginates to the initial page size', () => {
    const { container } = renderTable()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(bodyRows(container)).toHaveLength(25)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('shows the empty state when there is no data', () => {
    renderTable({ data: [], emptyMessage: 'Nothing here' })
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('shows the error state with a working retry button', () => {
    const onRetry = vi.fn()
    renderTable({ error: 'Boom failed', onRetry })
    expect(screen.getByText('Boom failed')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders skeleton rows while loading', () => {
    const { container } = renderTable({ loading: true, skeletonRows: 4 })
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4)
    expect(bodyRows(container)).toHaveLength(0)
  })
})

// ── search / filter / sort ───────────────────────────────────────────────────
describe('EnterpriseTable search, filter, sort', () => {
  it('filters rows via the debounced global search', async () => {
    const { container } = renderTable()
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'Zebra' } })
    await waitFor(() => expect(bodyRows(container)).toHaveLength(1))
    expect(screen.getByText('Zebra Special')).toBeInTheDocument()
  })

  it('filters rows via a per-column select filter', () => {
    const { container } = renderTable()
    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'Retired' } })
    const rows = bodyRows(container)
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach(tr => expect(tr.textContent).toContain('Retired'))
  })

  it('sorts by a column when its header is clicked', () => {
    const { container } = renderTable()
    // Numeric columns sort descending first in TanStack v8.
    fireEvent.click(screen.getByText('Qty'))
    expect(bodyRows(container)[0].textContent).toContain('Vehicle 01') // qty 100 = largest
    fireEvent.click(screen.getByText('Qty'))
    expect(bodyRows(container)[0].textContent).toContain('Zebra Special') // qty 1 = smallest
  })
})

// ── pagination / selection ───────────────────────────────────────────────────
describe('EnterpriseTable pagination and selection', () => {
  it('changes page size via the selector', () => {
    const { container } = renderTable()
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } })
    expect(bodyRows(container)).toHaveLength(50)
  })

  it('navigates to the next page', () => {
    const { container } = renderTable()
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(bodyRows(container)).toHaveLength(25)
  })

  it('selects rows and exposes them to the bulk-actions slot', () => {
    renderTable({
      enableRowSelection: true,
      bulkActions: (rows, clear) => (
        <button onClick={clear}>Bulk ({rows.length})</button>
      ),
    })
    fireEvent.click(screen.getAllByLabelText('Select row')[0])
    expect(screen.getByText('Bulk (1)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Bulk (1)'))
    expect(screen.queryByText(/^Bulk \(/)).not.toBeInTheDocument()
  })

  it('toggles column visibility from the Columns menu', () => {
    const { container } = renderTable()
    expect(container.querySelectorAll('thead tr:first-child th')).toHaveLength(3)
    fireEvent.click(screen.getByTitle('Show / hide columns'))
    fireEvent.click(screen.getByRole('checkbox', { name: /Qty/i }))
    expect(container.querySelectorAll('thead tr:first-child th')).toHaveLength(2)
  })
})

// ── CSV helpers ──────────────────────────────────────────────────────────────
describe('tableExport CSV helpers', () => {
  it('escapes quotes, commas, and newlines per RFC 4180', () => {
    expect(escapeCsvValue('plain')).toBe('plain')
    expect(escapeCsvValue('a,b')).toBe('"a,b"')
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCsvValue(null)).toBe('')
    expect(escapeCsvValue(undefined)).toBe('')
  })

  it('neutralises formula-injection payloads but keeps negative numbers', () => {
    expect(escapeCsvValue('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(escapeCsvValue('@cmd')).toBe("'@cmd")
    expect(escapeCsvValue('+alert(1)')).toBe("'+alert(1)")
    expect(escapeCsvValue('-12.5')).toBe('-12.5')
    expect(escapeCsvValue(-42)).toBe('-42')
  })

  it('builds a BOM-prefixed CSV document with CRLF line endings', () => {
    const csv = buildCsv(['A', 'B'], [['1', 'x,y'], ['2', 'z']])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1)).toBe('A,B\r\n1,"x,y"\r\n2,z')
  })
})
