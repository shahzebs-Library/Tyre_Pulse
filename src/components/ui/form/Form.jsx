/**
 * Form - react-hook-form + zod wrapper (roadmap item 2). Wire a zod schema
 * from src/lib/validation/schemas.js and get submit-state handling, resolver
 * validation and context for the Field components in one line:
 *
 *   <Form schema={tyreRecordSchema} defaultValues={{...}} onSubmit={save}>
 *     <TextField name="asset_no" label="Asset No" required />
 *     ...
 *   </Form>
 */
import { useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'

export default function Form({
  schema,
  defaultValues,
  onSubmit,
  children,
  submitLabel = 'Save',
  cancelLabel = null,
  onCancel = null,
  className = '',
}) {
  const methods = useForm({
    resolver: schema ? zodResolver(schema) : undefined,
    defaultValues,
    mode: 'onBlur',
  })
  const [submitError, setSubmitError] = useState(null)

  const handle = methods.handleSubmit(async values => {
    setSubmitError(null)
    try {
      await onSubmit(values, methods)
    } catch (e) {
      setSubmitError(e?.message || 'Something went wrong while saving.')
    }
  })

  return (
    <FormProvider {...methods}>
      <form onSubmit={handle} noValidate className={`space-y-4 ${className}`}>
        {children}
        {submitError && (
          <p role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
            {submitError}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          {cancelLabel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={methods.formState.isSubmitting}
              className="px-4 py-2 text-sm text-gray-300 border border-gray-600 rounded-lg hover:border-gray-500 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="submit"
            disabled={methods.formState.isSubmitting}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {methods.formState.isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </form>
    </FormProvider>
  )
}
