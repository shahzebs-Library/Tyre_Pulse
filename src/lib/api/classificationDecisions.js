/**
 * classificationDecisions.js - what the classifier moved and what it kept (V392),
 * and the path to change it.
 *
 * The read is one RPC. The WRITE deliberately goes through the material master:
 * `setMaterial` records the human decision against the item code, and
 * `applyReviewedDecisions` re-applies every reviewed decision to the
 * transactions already loaded. That is the single existing lever - this module
 * adds no second way to change a category, it just puts the lever where the
 * person is looking at the problem.
 *
 * `reclassify_from_master` and `reclassify_revert` have existed in the database
 * since V368 and had never been callable from anywhere in the app, so reviewing
 * an item fixed future rows only and left the money already loaded where it was.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

/**
 * Decisions for a window, grouped by item code so the result can be acted on.
 *
 * @param {object} [opts]
 * @param {string} [opts.country]  one country, or 'All'/omitted for every country
 * @param {string} [opts.from]     YYYY-MM-DD inclusive
 * @param {string} [opts.to]       YYYY-MM-DD inclusive
 * @param {'moved'|'kept'|'unlabelled'|'all'} [opts.view='moved']
 * @param {string} [opts.search]   item code or description
 * @param {number} [opts.limit=200]
 * @returns {Promise<{ok:boolean, view:string, countries:Array, items:Array}>}
 */
export async function getClassificationDecisions(opts = {}) {
  const { country, from, to, view = 'moved', search, limit = 200 } = opts
  const { data, error } = await supabase.rpc('get_classification_decisions', {
    p_country: country && country !== 'All' ? country : null,
    p_from: from || null,
    p_to: to || null,
    p_view: view,
    p_search: search && String(search).trim() ? String(search).trim() : null,
    p_limit: limit,
  })
  if (error) {
    // An older backend simply has no view to show. That is an absence, not a
    // failure, and it must not turn the page into an error screen.
    if (/could not find the function|does not exist/i.test(error.message || '')) {
      return { ok: false, view, countries: [], items: [] }
    }
    throw new Error(toUserMessage(error, 'Could not load the classification decisions.'))
  }
  return {
    ok: data?.ok !== false,
    view: data?.view || view,
    countries: Array.isArray(data?.countries) ? data.countries : [],
    items: Array.isArray(data?.items) ? data.items : [],
    limit: data?.limit ?? limit,
  }
}

/**
 * Re-apply every reviewed master decision to the transactions already loaded.
 *
 * ALWAYS preview first. The dry run reports exactly which rows and how much
 * money would move, per country and per direction, and touches nothing - this
 * is the only path in the system that moves historical money, so it should
 * never run unseen.
 *
 * @param {boolean} [dryRun=true]
 * @returns {Promise<object>} {rows_that_change, moves[], dry_run, batch_id?}
 */
export async function applyReviewedDecisions(dryRun = true) {
  const { data, error } = await supabase.rpc('reclassify_from_master', { p_dry_run: dryRun !== false })
  if (error) throw new Error(toUserMessage(error, 'Could not apply the reviewed decisions.'))
  return data || {}
}

/**
 * Put one applied batch back exactly as it was. The before-state of every row is
 * recorded before the change, which is what makes this exact rather than a
 * re-derivation.
 */
export async function revertDecisionBatch(batchId) {
  if (!batchId) throw new Error('Nothing to undo.')
  const { data, error } = await supabase.rpc('reclassify_revert', { p_batch_id: batchId })
  if (error) throw new Error(toUserMessage(error, 'Could not undo that change.'))
  return data || {}
}
