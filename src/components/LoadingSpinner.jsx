export default function LoadingSpinner({ size = 'lg' }) {
  const s = size === 'lg' ? 'h-8 w-8' : 'h-5 w-5'
  return (
    <div className="flex items-center justify-center min-h-screen" role="status" aria-live="polite">
      <div aria-hidden="true" className={`${s} animate-spin rounded-full border-2 border-gray-700 border-t-blue-500`} />
      <span className="sr-only">Loading</span>
    </div>
  )
}
