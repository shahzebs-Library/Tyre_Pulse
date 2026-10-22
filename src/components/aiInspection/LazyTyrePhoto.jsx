import { useEffect, useRef, useState } from 'react'
import { photoUrlResolver } from '../../lib/photoUrlCache'

/**
 * A tyre photograph that only asks for its signed URL once it is near the viewport,
 * through the shared cache (one request per distinct ref, bounded concurrency).
 */
export default function LazyTyrePhoto({ photoRef, alt, className = '', unavailable = 'Photo unavailable. Check storage permissions.' }) {
  const host = useRef(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [state, setState] = useState({ url: null, failed: false })
  useEffect(() => {
    if (visible || !host.current) return undefined
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() }
    }, { rootMargin: '200px' })
    io.observe(host.current)
    return () => io.disconnect()
  }, [visible])
  useEffect(() => {
    if (!visible || !photoRef) return undefined
    let alive = true
    setState({ url: null, failed: false })
    photoUrlResolver.get(photoRef).then(url => { if (alive) setState({ url, failed: !url }) })
    return () => { alive = false }
  }, [visible, photoRef])
  return <div ref={host}>
    {state.url
      ? <a href={state.url} target="_blank" rel="noopener noreferrer"><img src={state.url} loading="lazy" decoding="async" className={className} alt={alt}/></a>
      : <div className={'flex items-center justify-center text-xs text-[var(--text-muted)] bg-[var(--panel-2)] '+className}>{state.failed ? unavailable : (visible ? 'Resolving secure photo…' : 'Photo loads when visible')}</div>}
  </div>
}
