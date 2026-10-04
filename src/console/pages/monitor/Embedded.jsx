/**
 * Embedded - renders an older console page whole, as a tab of a Control Center
 * screen. Nothing of the old page is dropped: it keeps its own tabs (under its
 * own URL parameter, so the two tab bars never fight over ?tab=), filters,
 * exports and actions.
 */
import { Suspense } from 'react'
import { LoadingState, Panel } from '../../components/ui'

export default function Embedded({ page: Page, label, param = 'sub' }) {
  return (
    <Suspense fallback={<Panel><LoadingState label={`Loading ${label}`} rows={4} /></Panel>}>
      <div className="space-y-4" data-embedded={label}>
        <Page tabParam={param} />
      </div>
    </Suspense>
  )
}

/** "Moved here from" strip under a screen header. */
export function MovedFrom({ items = [], onPick }) {
  if (!items.length) return null
  return (
    <p className="text-[11px] text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>Moved here from</span>
      {items.map((it) => (
        <button key={it.key} type="button" onClick={() => onPick?.(it.key)}
          className="rounded border border-gray-800 px-1.5 py-0.5 text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
          {it.label}
        </button>
      ))}
      <span>Every feature of those pages has a home on this screen.</span>
    </p>
  )
}
