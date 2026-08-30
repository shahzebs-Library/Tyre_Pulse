/**
 * FormField - labelled text/number/textarea input wired to react-hook-form.
 *
 * Usage:
 *   <FormField label="Supplier" error={errors.supplier_name} required
 *              {...register('supplier_name')} />
 *
 * Spread `register(name)` last so name/onChange/onBlur/ref reach the input.
 * Theme: token classes only (works in both light and dark themes).
 */
import { forwardRef } from 'react'
import { AlertTriangle } from 'lucide-react'

export const fieldInputClass = (hasError) =>
  `w-full bg-[var(--input-bg)] border rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] ` +
  `placeholder-[var(--text-dim)] focus:outline-none ` +
  (hasError ? 'border-red-500 focus:border-red-400' : 'border-[var(--input-border)] focus:border-blue-500')

export function FieldError({ error, id }) {
  if (!error?.message) return null
  return (
    <p id={id} role="alert" className="mt-1 flex items-center gap-1 text-xs text-red-400">
      <AlertTriangle size={11} className="flex-shrink-0" /> {error.message}
    </p>
  )
}

export function FieldLabel({ label, htmlFor, required }) {
  if (!label) return null
  return (
    <label htmlFor={htmlFor} className="block text-xs text-[var(--text-muted)] mb-1">
      {label}
      {required && <span className="text-red-400 ml-0.5" aria-hidden="true">*</span>}
    </label>
  )
}

const FormField = forwardRef(function FormField(
  { label, error, required = false, multiline = false, rows = 2, className = '', wrapperClassName = '', id, name, list, children, ...rest },
  ref,
) {
  const fieldId = id || (name ? `field-${name}` : undefined)
  const errorId = error && fieldId ? `${fieldId}-error` : undefined
  const control = multiline ? (
    <textarea
      id={fieldId}
      name={name}
      ref={ref}
      rows={rows}
      required={required}
      aria-required={required || undefined}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={errorId}
      className={`${fieldInputClass(!!error)} resize-none ${className}`}
      {...rest}
    />
  ) : (
    <input
      id={fieldId}
      name={name}
      ref={ref}
      list={list}
      required={required}
      aria-required={required || undefined}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={errorId}
      className={`${fieldInputClass(!!error)} ${className}`}
      {...rest}
    />
  )
  return (
    <div className={wrapperClassName}>
      <FieldLabel label={label} htmlFor={fieldId} required={required} />
      {control}
      {children}
      <FieldError error={error} id={errorId} />
    </div>
  )
})

export default FormField
