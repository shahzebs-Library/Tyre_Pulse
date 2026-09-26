/**
 * erpSyncHistory - reads behind the ERP Sync "load history" panel.
 *
 * import_batches and expense_import_rejects are small today but grow with every
 * upload, so both are paged with an id tiebreak and a ceiling; `truncated` is
 * reported so the page never implies it read everything when it did not.
 * Each source settles independently: one failure never blanks the others.
 */
import { supabase, fetchAllPages, applyCountry } from './_client'
import { getUploadCoverageDetail } from './uploadCoverage'

export const HISTORY_MAX = 5000

const BATCH_COLS = 'id,country,module,sheet,source_system,approval_status,import_status,total_rows,error_rows,duplicate_rows,imported_rows,skipped_rows,created_at,completed_at'
const REJECT_COLS = 'id,uploaded_country,detected_country,work_order_no,item_code,item_description,value_amount,source_row,created_at,reject_reason'

async function readBatches(country) {
  const { data, error, truncated } = await fetchAllPages((from, to) => applyCountry(
    supabase.from('import_batches').select(BATCH_COLS)
      .order('created_at', { ascending: false }).order('id'),
    country,
  ).range(from, to), { max: HISTORY_MAX })
  if (error) throw error
  return { rows: data || [], truncated: !!truncated }
}

async function readRejects(country) {
  const { data, error, truncated } = await fetchAllPages((from, to) => {
    let q = supabase.from('expense_import_rejects').select(REJECT_COLS)
      .order('created_at', { ascending: false }).order('id')
    if (country && country !== 'All') q = q.or(`uploaded_country.eq.${country},detected_country.eq.${country}`)
    return q.range(from, to)
  }, { max: HISTORY_MAX })
  if (error) throw error
  return { rows: data || [], truncated: !!truncated }
}

/**
 * @param {{country?:string, days?:number}} [opts]
 * @returns {Promise<{batches, rejects, coverage, failed:string[]}>}
 */
export async function loadErpHistory({ country, days = 30 } = {}) {
  const [b, r, c] = await Promise.allSettled([readBatches(country), readRejects(country), getUploadCoverageDetail({ days, country })])
  const failed = []
  if (b.status === 'rejected') failed.push('batches')
  if (r.status === 'rejected') failed.push('rejects')
  if (c.status === 'rejected') failed.push('coverage')
  return {
    batches: b.status === 'fulfilled' ? b.value : { rows: [], truncated: false },
    rejects: r.status === 'fulfilled' ? r.value : { rows: [], truncated: false },
    coverage: c.status === 'fulfilled' ? c.value : { ok: false, countries: [], files: [] },
    failed,
  }
}
