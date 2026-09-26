/**
 * TabBar - a page's main view switch (kit Segmented with tab semantics),
 * wired to useUrlTab by the caller so the active view lives in ?tab=.
 */
import { Segmented } from '../../components/ui'

export default function TabBar({ tabs, value, onChange, label = 'Page sections' }) {
  return (
    <div className="border-b border-gray-800 pb-3">
      <Segmented ariaLabel={label} value={value} onChange={onChange} options={tabs} />
    </div>
  )
}
