/**
 * FormSelect - labelled <select> wired to react-hook-form.
 *
 * Options accept either strings or { value, label } objects:
 *   <FormSelect label="Risk" options={['Critical','High']} placeholder="None"
 *               error={errors.risk_level} {...register('risk_level')} />
 */
import { forwardRef } from 'react'
import { fieldInputClass, FieldError, FieldLabel } from './FormField'

const FormSelect = forwardRef(function FormSelect(
  { label, error, required = false, options = [], placeholder, className = '', wrapperClassName = '', id, name, children, ...rest },
  ref,
) {
  const fieldId = id || (name ? `field-${name}` : undefined)
  const errorId = error && fieldId ? `${fieldId}-error` : undefined
  return (
    <div className={wrapperClassName}>
      <FieldLabel label={label} htmlFor={fieldId} required={required} />
      <select
        id={fieldId}
        name={name}
        ref={ref}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId}
        className={`${fieldInputClass(!!error)} ${className}`}
        {...rest}
      >
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((opt) => {
          const value = typeof opt === 'object' ? opt.value : opt
          const text = typeof opt === 'object' ? opt.label : opt
          return <option key={value} value={value}>{text}</option>
        })}
        {children}
      </select>
      <FieldError error={error} id={errorId} />
    </div>
  )
})

export default FormSelect
