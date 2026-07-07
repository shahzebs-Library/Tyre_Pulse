/**
 * Field components for the Form kit (react-hook-form context + zod errors).
 * Each renders label, dark-themed input, and the field's validation message
 * with aria-invalid / aria-describedby wired for screen readers.
 */
import { useFormContext } from 'react-hook-form'

const inputClass = invalid =>
  `w-full bg-gray-900 border rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 ` +
  `disabled:opacity-50 focus:outline-none focus:ring-1 ` +
  (invalid
    ? 'border-red-500/70 focus:ring-red-500'
    : 'border-gray-700 focus:ring-orange-500 focus:border-orange-500')

function useField(name) {
  const { register, formState } = useFormContext()
  const error = name.split('.').reduce((e, k) => e?.[k], formState.errors)
  return { register, error, submitting: formState.isSubmitting }
}

export function Field({ name, label, required, hint, children, error }) {
  return (
    <div>
      {label && (
        <label htmlFor={name} className="text-xs text-gray-400 block mb-1">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
      {error && (
        <p id={`${name}-error`} role="alert" className="text-xs text-red-400 mt-1">
          {error.message}
        </p>
      )}
    </div>
  )
}

export function TextField({ name, label, required, hint, placeholder, type = 'text', ...rest }) {
  const { register, error, submitting } = useField(name)
  return (
    <Field name={name} label={label} required={required} hint={hint} error={error}>
      <input
        id={name}
        type={type}
        placeholder={placeholder}
        disabled={submitting}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
        className={inputClass(!!error)}
        {...register(name)}
        {...rest}
      />
    </Field>
  )
}

export function NumberField({ name, label, required, hint, placeholder, step = 'any', ...rest }) {
  const { register, error, submitting } = useField(name)
  return (
    <Field name={name} label={label} required={required} hint={hint} error={error}>
      <input
        id={name}
        type="number"
        step={step}
        placeholder={placeholder}
        disabled={submitting}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
        className={inputClass(!!error)}
        {...register(name, { setValueAs: v => (v === '' || v == null ? undefined : Number(v)) })}
        {...rest}
      />
    </Field>
  )
}

export function SelectField({ name, label, required, hint, options = [], placeholder = 'Select…', ...rest }) {
  const { register, error, submitting } = useField(name)
  return (
    <Field name={name} label={label} required={required} hint={hint} error={error}>
      <select
        id={name}
        disabled={submitting}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
        className={inputClass(!!error)}
        {...register(name)}
        {...rest}
      >
        <option value="">{placeholder}</option>
        {options.map(o => {
          const value = typeof o === 'string' ? o : o.value
          const label2 = typeof o === 'string' ? o : o.label
          return <option key={value} value={value}>{label2}</option>
        })}
      </select>
    </Field>
  )
}

export function DateField({ name, label, required, hint, ...rest }) {
  const { register, error, submitting } = useField(name)
  return (
    <Field name={name} label={label} required={required} hint={hint} error={error}>
      <input
        id={name}
        type="date"
        disabled={submitting}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
        className={inputClass(!!error)}
        {...register(name)}
        {...rest}
      />
    </Field>
  )
}

export function TextAreaField({ name, label, required, hint, placeholder, rows = 3, ...rest }) {
  const { register, error, submitting } = useField(name)
  return (
    <Field name={name} label={label} required={required} hint={hint} error={error}>
      <textarea
        id={name}
        rows={rows}
        placeholder={placeholder}
        disabled={submitting}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
        className={inputClass(!!error)}
        {...register(name)}
        {...rest}
      />
    </Field>
  )
}
