import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import NotInUseNotice from './NotInUseNotice'

/**
 * NotInUseNotice for a page that does not hold its own row count: counts the
 * module's table once (head-only, so no rows are fetched; RLS scopes it to the
 * reader's company) and shows the "nothing recorded yet" line only while the
 * table is empty. A failed count renders nothing: "we could not look" must not
 * read as "there is nothing".
 *
 * @param {string} table  the module's table, e.g. "purchase_orders"
 * @param {string} label  plural noun for the sentence, e.g. "purchase orders"
 * @param {string} [hint] how data gets here
 */
export default function TableNotInUse({ table, label, hint }) {
  const [count, setCount] = useState(null)
  useEffect(() => {
    let live = true
    supabase.from(table).select('id', { count: 'exact', head: true })
      .then(({ count: n, error }) => { if (live) setCount(error ? null : (n ?? null)) })
      .catch(() => { if (live) setCount(null) })
    return () => { live = false }
  }, [table])
  return <NotInUseNotice count={count} label={label} hint={hint} />
}
