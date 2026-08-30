import { Link } from 'react-router-dom'
import TpLogo from '../../assets/logo.svg'

export default function PublicTrustPage({ title, eyebrow, intro, children }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:py-12">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 px-6 py-7 sm:px-9">
          <Link to="/login" className="inline-flex items-center gap-3 text-slate-950" aria-label="TyrePulse sign in">
            <img src={TpLogo} alt="" className="h-10 w-10" />
            <span className="text-lg font-extrabold">TyrePulse</span>
          </Link>
          {eyebrow && <p className="mt-7 text-xs font-bold uppercase tracking-wider text-green-700">{eyebrow}</p>}
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{title}</h1>
          {intro && <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{intro}</p>}
        </header>
        <div className="space-y-7 px-6 py-7 text-sm leading-6 text-slate-700 sm:px-9">{children}</div>
        <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 px-6 py-5 text-xs font-semibold text-slate-600 sm:px-9">
          <Link className="hover:text-green-700" to="/login">Sign in</Link>
          <Link className="hover:text-green-700" to="/privacy">Privacy</Link>
          <Link className="hover:text-green-700" to="/terms">Terms</Link>
          <Link className="hover:text-green-700" to="/support">Support</Link>
          <Link className="hover:text-green-700" to="/status">Service status</Link>
        </footer>
      </div>
    </main>
  )
}

export function PublicSection({ title, children }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-bold text-slate-950">{title}</h2>
      {children}
    </section>
  )
}
