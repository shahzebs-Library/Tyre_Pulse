import { Suspense, lazy, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import CommandCenter from '../components/commandCenter/CommandCenter'
import { RouteLoading } from '../components/ProtectedRoute'

// The earlier detailed dashboard stays one click away. It loads only when opened,
// so the home screen does not pay for its reads on every visit.
const Dashboard = lazy(() => import('./Dashboard'))

export default function CommandCenterPage() {
  const [open, setOpen] = useState(false)
  return (
    <div className="cc" style={{ gap: 14 }}>
      <CommandCenter />
      <div className="cc-more">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <div style={{ textAlign: 'left' }}>Detailed analytics<br /><span>Tyre cost, risk and trend charts, exports and filters</span></div>
          {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        </button>
      </div>
      {open && <Suspense fallback={<RouteLoading />}><Dashboard /></Suspense>}
    </div>
  )
}
