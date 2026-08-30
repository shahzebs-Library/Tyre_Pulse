/**
 * Apply the client-side view controls to a server-bounded ledger window.
 * This is deliberately pure so the same truth is testable independently of UI.
 */
export function filterLedgerRows(rows, columns, { query = '', state = '', stateField = null } = {}) {
  const needle = String(query).trim().toLocaleLowerCase()
  const searchableColumns = (Array.isArray(columns) ? columns : [])
    .filter((column) => !String(column?.key || '').startsWith('__'))

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (stateField === 'active' && state) {
      const isActive = row?.active !== false
      if ((state === 'active') !== isActive) return false
    }

    if (stateField === 'rejected' && state) {
      const isRejected = row?.rejected === true
        || ['true', 'yes', '1', 'rejected'].includes(String(row?.rejected ?? '').toLocaleLowerCase())
      if ((state === 'rejected') !== isRejected) return false
    }

    if (!needle) return true
    return searchableColumns.some((column) => {
      const value = row?.[column.key]
      return value != null && String(value).toLocaleLowerCase().includes(needle)
    })
  })
}
