/**
 * Fitment rule create/edit modal and delete confirmation for the Fitment
 * Validation page. Pure presentation: the page owns the state and handlers.
 * Only size, tread and lifecycle fields are enforced by the engine; age,
 * retread and dual-pair fields are stored for policy completeness.
 */
import { AlertTriangle, Info, Trash2 } from 'lucide-react'
import Modal from '../ui/Modal'

export default function FitmentRuleModals({
  showRuleModal, closeRuleModal, editingRule, ruleForm, setRule, submitRule,
  ruleSaving, ruleFormError,
  confirmDeleteRule, setConfirmDeleteRule, deletingRule, doDeleteRule, deleteError,
}) {
  return (
    <>
      {/* Rule create / edit modal. The submit button stays INSIDE the form; Modal
          caps the panel to the viewport and scrolls the body only. */}
      {showRuleModal && (
        <Modal
          open
          onClose={closeRuleModal}
          size="lg"
          title={editingRule ? 'Edit fitment rule' : 'New fitment rule'}
        >
          <form onSubmit={submitRule} className="space-y-4">
            <div>
              <label className="label" htmlFor="fr-name">Rule name (required)</label>
              <input id="fr-name" className="input w-full min-h-[44px]" placeholder="e.g. Steer axle, highway tractors" value={ruleForm.rule_name} maxLength={200} onChange={(e) => setRule('rule_name', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="fr-types">Applies to vehicle types (comma-separated, blank = all)</label>
                <input id="fr-types" className="input w-full min-h-[44px]" placeholder="e.g. tractor, rigid_truck" value={ruleForm.applies_to_vehicle_types} onChange={(e) => setRule('applies_to_vehicle_types', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fr-axles">Applies to axle roles (comma-separated, blank = all)</label>
                <input id="fr-axles" className="input w-full min-h-[44px]" placeholder="e.g. steer, drive" value={ruleForm.applies_to_axle_roles} onChange={(e) => setRule('applies_to_axle_roles', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fr-sizes">Approved sizes (comma-separated, blank = any)</label>
              <input id="fr-sizes" className="input w-full min-h-[44px]" placeholder="e.g. 315/80R22.5, 295/80R22.5" value={ruleForm.approved_sizes} onChange={(e) => setRule('approved_sizes', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="label" htmlFor="fr-tread">Min tread (mm)</label>
                <input id="fr-tread" className="input w-full min-h-[44px]" type="number" step="0.1" min="0" value={ruleForm.min_tread_depth_mm} onChange={(e) => setRule('min_tread_depth_mm', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fr-age">Max age (years)</label>
                <input id="fr-age" className="input w-full min-h-[44px]" type="number" step="0.5" min="0" value={ruleForm.max_tyre_age_years} onChange={(e) => setRule('max_tyre_age_years', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fr-retreads">Max retreads</label>
                <input id="fr-retreads" className="input w-full min-h-[44px]" type="number" step="1" min="0" value={ruleForm.max_retread_count} onChange={(e) => setRule('max_retread_count', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fr-dual">Max dual difference (mm)</label>
                <input id="fr-dual" className="input w-full min-h-[44px]" type="number" step="0.1" min="0" value={ruleForm.max_tread_delta_dual_mm} onChange={(e) => setRule('max_tread_delta_dual_mm', e.target.value)} />
              </div>
            </div>
            <fieldset className="flex flex-wrap gap-4">
              <legend className="sr-only">Policy switches</legend>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer min-h-[44px]">
                <input type="checkbox" className="accent-[var(--accent)] w-4 h-4" checked={ruleForm.allow_retread} onChange={(e) => setRule('allow_retread', e.target.checked)} /> Allow retread
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer min-h-[44px]">
                <input type="checkbox" className="accent-[var(--accent)] w-4 h-4" checked={ruleForm.require_matching_pair} onChange={(e) => setRule('require_matching_pair', e.target.checked)} /> Require matching pair
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer min-h-[44px]">
                <input type="checkbox" className="accent-[var(--accent)] w-4 h-4" checked={ruleForm.is_active} onChange={(e) => setRule('is_active', e.target.checked)} /> Active
              </label>
            </fieldset>
            <div>
              <label className="label" htmlFor="fr-notes">Notes (optional)</label>
              <textarea id="fr-notes" className="input w-full min-h-[60px] resize-y" placeholder="e.g. GCC steer-axle policy" value={ruleForm.notes} maxLength={8000} onChange={(e) => setRule('notes', e.target.value)} />
            </div>

            <p className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              Age, retread and dual-pair fields are stored for policy completeness but are not evaluated on this dataset (source data absent). Size, tread and lifecycle checks are enforced.
            </p>

            {ruleFormError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-400 border border-red-500/30 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {ruleFormError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeRuleModal} className="btn-secondary text-sm min-h-[44px]" disabled={ruleSaving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={ruleSaving}>
                {ruleSaving ? 'Saving...' : editingRule ? 'Save changes' : 'Create rule'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDeleteRule && (
        <Modal
          open
          onClose={() => { if (!deletingRule) setConfirmDeleteRule(null) }}
          size="sm"
          title="Delete fitment rule"
          footer={(
            <>
              <button type="button" onClick={() => setConfirmDeleteRule(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deletingRule}>Cancel</button>
              <button type="button" onClick={doDeleteRule} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deletingRule}>
                {deletingRule ? 'Deleting...' : 'Delete rule'}
              </button>
            </>
          )}
        >
          <div className="flex items-start gap-3">
            <Trash2 size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-sm text-[var(--text-secondary)]">Delete <span className="font-semibold text-[var(--text-primary)]">{confirmDeleteRule.rule_name}</span>? This cannot be undone.</p>
          </div>
          {deleteError && <p role="alert" className="mt-3 text-sm text-red-400">{deleteError}</p>}
        </Modal>
      )}
    </>
  )
}
