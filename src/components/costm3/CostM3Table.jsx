/**
 * The one table the Cost per M3 module uses.
 *
 * There were three styles across four files - a bordered table with a raised
 * header, a plain one with a hairline row, and a third inside the rejections
 * panel - so the same figures looked like different kinds of thing depending on
 * which panel you were reading. Alignment, zebra striping and the empty state
 * all differed too, which is worse than ugly: a right-aligned number in one
 * panel and a left-aligned one in the next reads as a different sort of number.
 *
 * Columns are declared, not hand-written as markup, so a new panel cannot
 * quietly invent a fourth style.
 *
 * @param {object} props
 * @param {Array}  props.columns  [{ key, header, align:'left'|'right', width, cellClass, render(row) }]
 * @param {Array}  props.rows
 * @param {string} [props.rowKey='id'] field, or a function, giving each row its key
 * @param {string} [props.title]
 * @param {ReactNode} [props.actions] right-aligned controls beside the title
 * @param {boolean}[props.loading]
 * @param {string} [props.empty]   what to say when there is nothing
 * @param {string} [props.footnote]
 * @param {ReactNode} [props.foot] a totals row rendered inside <tfoot>
 * @param {boolean}[props.dense]   tighter rows, for a summary beside another
 * @param {boolean}[props.alignTop] top-align cells, for rows carrying a stacked
 *   block (the rejection reasons list) beside one-line figures - centred cells
 *   would float the month away from the reasons it belongs to
 * @param {Function}[props.onRowClick]
 */
export default function CostM3Table({
  columns = [],
  rows = [],
  rowKey = 'id',
  title,
  actions,
  loading = false,
  empty = 'Nothing to show for this period.',
  footnote,
  foot,
  dense = false,
  alignTop = false,
  onRowClick,
}) {
  const pad = dense ? 'px-3 py-1.5' : 'px-3 py-2'
  const keyOf = (row, i) => {
    if (typeof rowKey === 'function') return rowKey(row, i)
    const v = row?.[rowKey]
    return v == null ? i : v
  }

  return (
    <div className="min-w-0">
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          {title && (
            <h3
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              {title}
            </h3>
          )}
          {actions}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full text-sm border-collapse">
          <thead style={{ background: 'var(--surface-raised, var(--bg-elevated))' }}>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`${pad} font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  style={{ color: 'var(--text-secondary)', width: c.width }}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className={`${pad} text-center`} style={{ color: 'var(--text-secondary)' }}>
                  Loading...
                </td>
              </tr>
            ) : !rows.length ? (
              // "Nothing matched" and "we could not look" are different
              // statements; the caller owns the wording so it can say which.
              <tr>
                <td colSpan={columns.length} className={`${pad} text-center`} style={{ color: 'var(--text-secondary)' }}>
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={keyOf(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                  style={{ borderTop: '1px solid var(--border-subtle)' }}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`${pad} ${alignTop ? 'align-top' : ''} ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${c.cellClass || ''}`}
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {c.render ? c.render(row, i) : (row?.[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {foot && rows.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border-subtle)', background: 'var(--surface-raised, var(--bg-elevated))' }}>
                {foot}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {footnote && (
        <p className="mt-2 text-xs" style={{ color: 'var(--text-dim)' }}>{footnote}</p>
      )}
    </div>
  )
}

/**
 * The headline figures every panel opens with (rows, totals, period covered)
 * were four separate grids of tiles in three different shapes. The owner asked
 * for every summary area to read as a table, so they share these two columns:
 * a measure on the left, its figure right-aligned on the right.
 *
 * Rows are `{ key, label, value, strong }`; `strong` bolds the one figure the
 * panel is really about, which is what the larger tile used to convey.
 */
export const MEASURE_COLUMNS = [
  { key: 'label', header: 'Measure', align: 'left' },
  {
    key: 'value',
    header: 'Value',
    align: 'right',
    render: (r) => <span className={r.strong ? 'font-bold' : 'font-semibold'}>{r.value}</span>,
  },
]
