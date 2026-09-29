/**
 * QR label print history service over qr_print_jobs (org + country isolated).
 * Reads throw on failure so the page shows error + Retry; writes are
 * best-effort from the page (a failed save never blocks a print).
 */
import { supabase } from './supabase'
import { applyCountry, unwrap } from './api/_client'
import { fromPrintJobRow } from './qrLabelsView'

const COLS = 'id,country,batch_no,label_type,action,items,labels,label_size,codes,created_by_name,created_at'

export async function listPrintJobs({ country, limit = 500 } = {}) {
  const q = applyCountry(supabase.from('qr_print_jobs').select(COLS), country)
  const rows = unwrap(await q.order('created_at', { ascending: false }).order('id', { ascending: true }).limit(Math.min(limit, 1000))) || []
  return rows.map(fromPrintJobRow)
}

export async function savePrintJob(row) {
  const rec = unwrap(await supabase.from('qr_print_jobs').insert(row).select(COLS).single())
  return rec ? fromPrintJobRow(rec) : null
}
