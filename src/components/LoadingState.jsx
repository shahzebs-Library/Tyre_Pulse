import { RefreshCw } from 'lucide-react'

export default function LoadingState({ message = 'Loading…', fullPage = false }) {
  return (
    <div className={`flex items-center justify-center gap-3 text-gray-400 ${fullPage ? 'h-screen' : 'py-16'}`}>
      <RefreshCw className="w-5 h-5 animate-spin" />
      <span className="text-sm">{message}</span>
    </div>
  )
}
