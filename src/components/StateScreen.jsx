/**
 * StateScreen — a full-height, centered state panel (404, 500, offline,
 * maintenance, loading, generic error, success) built on the illustration
 * system. Theme-aware and accessible; the illustration degrades gracefully if
 * the named asset is missing.
 *
 *   <StateScreen illustration="error/404" title="Page not found"
 *     description="…" action={{ label: 'Go home', onClick }} />
 */
import { Illustration } from './illustrations'

export default function StateScreen({
  illustration,
  title,
  description,
  action = null,        // { label, onClick } or a ReactNode
  secondaryAction = null,
  size = 260,
  className = '',
  children,
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-6 py-16 min-h-[60vh] ${className}`}>
      {illustration && (
        <div className="mb-6">
          <Illustration name={illustration} size={size} title={title || 'Status'} />
        </div>
      )}
      {title && (
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      )}
      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      )}
      {children}
      {(action || secondaryAction) && (
        <div className="mt-6 flex items-center gap-3">
          {action && (
            typeof action === 'object' && 'label' in action
              ? <button onClick={action.onClick} className="btn-primary text-sm">{action.label}</button>
              : action
          )}
          {secondaryAction && (
            typeof secondaryAction === 'object' && 'label' in secondaryAction
              ? <button onClick={secondaryAction.onClick} className="btn-secondary text-sm">{secondaryAction.label}</button>
              : secondaryAction
          )}
        </div>
      )}
    </div>
  )
}
