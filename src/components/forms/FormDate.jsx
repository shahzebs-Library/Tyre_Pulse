/**
 * FormDate - labelled date input wired to react-hook-form.
 * Thin wrapper over FormField with type="date"; values stay ISO strings
 * (YYYY-MM-DD), matching existing Supabase payload shapes.
 */
import { forwardRef } from 'react'
import FormField from './FormField'

const FormDate = forwardRef(function FormDate(props, ref) {
  return <FormField type="date" ref={ref} {...props} />
})

export default FormDate
