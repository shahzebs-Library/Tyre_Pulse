/**
 * FormActions - submit/cancel row with loading state.
 *
 *   <FormActions saving={isSubmitting} onCancel={onClose}
 *                submitLabel={t('save')} savingLabel={t('saving')}
 *                cancelLabel={t('cancel')} />
 *
 * White text is only ever on the solid-colour primary button (btn-primary).
 */
import { Loader2 } from 'lucide-react'

export default function FormActions({
  saving = false,
  onCancel,
  submitLabel = 'Save',
  savingLabel = 'Saving...',
  cancelLabel = 'Cancel',
  align = 'end',
  className = '',
}) {
  return (
    <div className={`flex gap-2 ${align === 'end' ? 'justify-end' : ''} pt-1 ${className}`}>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--input-bg)] rounded-lg disabled:opacity-50"
        >
          {cancelLabel}
        </button>
      )}
      <button type="submit" disabled={saving} className="btn-primary gap-1.5 disabled:opacity-50">
        {saving && <Loader2 size={13} className="animate-spin" />}
        {saving ? savingLabel : submitLabel}
      </button>
    </div>
  )
}
