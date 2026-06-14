import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, EyeOff, ArrowRight, Mail, AlertCircle, CheckCircle2,
  Loader2, AtSign, Hash, Zap, Sun, Moon, Wifi, WifiOff,
  BarChart3, Shield, Smartphone, Brain, TrendingUp, Bell,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'
import TpLogo from '../assets/logo.svg'
import TwoFactorChallenge from '../components/TwoFactorChallenge'

/* ── CSS injected once ────────────────────────────────────────────────────── */
const STYLES = `
@keyframes tp-spin       { to { transform: rotate(360deg); } }
@keyframes tp-spin-rev   { to { transform: rotate(-360deg); } }
@keyframes tp-pulse-ring {
  0%,100% { transform: scale(1);   opacity: 0.5; }
  50%      { transform: scale(1.3); opacity: 0; }
}
@keyframes tp-float {
  0%,100% { transform: translateY(0); }
  50%      { transform: translateY(-12px); }
}
@keyframes tp-scan {
  0%   { transform: translateY(-100%); opacity:0; }
  10%  { opacity: 0.5; }
  90%  { opacity: 0.5; }
  100% { transform: translateY(100vh); opacity:0; }
}
@keyframes tp-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
@keyframes tp-fade-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes tp-counter {
  0%   { content: '127'; }
  50%  { content: '128'; }
  100% { content: '129'; }
}
.tp-spin     { animation: tp-spin     4s  linear       infinite; transform-origin: center; }
.tp-spin-rev { animation: tp-spin-rev 6s  linear       infinite; transform-origin: center; }
.tp-float    { animation: tp-float    4s  ease-in-out  infinite; }
.tp-btn-shine {
  position: relative; overflow: hidden;
}
.tp-btn-shine::after {
  content: ''; position: absolute;
  top: 0; left: -100%; width: 60%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
  animation: tp-shimmer 2.8s ease-in-out infinite;
  pointer-events: none;
}
.tp-pulse-ring {
  position: absolute; inset: -6px; border-radius: 50%;
  border: 2px solid rgba(22,163,74,0.5);
  animation: tp-pulse-ring 2.2s ease-out infinite;
}
.tp-feature-card {
  animation: tp-fade-up 0.4s ease-out both;
}
`

/* ── Spinning Tyre ───────────────────────────────────────────────────────── */
function Tyre({ size = 120, reverse = false, opacity = 1, className = '' }) {
  const cx = size / 2
  const R  = size / 2 - 2
  const r1 = R * 0.76
  const r2 = R * 0.54
  const r3 = R * 0.17
  const spokes = 5
  const treads = 24
  const id = `t-${size}-${reverse ? 'r' : 'f'}`
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      className={className}
      style={{ display:'block', opacity, filter:`drop-shadow(0 0 10px rgba(22,163,74,0.6))` }}>
      <defs>
        <radialGradient id={`rb-${id}`} cx="50%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#1a2e1a"/>
          <stop offset="100%" stopColor="#060c06"/>
        </radialGradient>
        <radialGradient id={`rm-${id}`} cx="40%" cy="30%" r="70%">
          <stop offset="0%"   stopColor="#4ade80" stopOpacity="0.85"/>
          <stop offset="45%"  stopColor="#16a34a" stopOpacity="0.8"/>
          <stop offset="100%" stopColor="#052010"/>
        </radialGradient>
        <radialGradient id={`rh-${id}`} cx="35%" cy="30%" r="65%">
          <stop offset="0%"  stopColor="#86efac"/>
          <stop offset="100%" stopColor="#16a34a"/>
        </radialGradient>
      </defs>
      <g className={reverse ? 'tp-spin-rev' : 'tp-spin'}>
        {/* rubber */}
        <circle cx={cx} cy={cx} r={R} fill={`url(#rb-${id})`}/>
        {/* treads */}
        {Array.from({length:treads}).map((_,i) => {
          const a1 = (i/treads)*360, a2 = ((i+0.58)/treads)*360
          const toRad = a => a*Math.PI/180
          const oR = R, iR = r1+1
          const pts = [
            [cx+oR*Math.cos(toRad(a1)), cx+oR*Math.sin(toRad(a1))],
            [cx+oR*Math.cos(toRad(a2)), cx+oR*Math.sin(toRad(a2))],
            [cx+iR*Math.cos(toRad(a2)), cx+iR*Math.sin(toRad(a2))],
            [cx+iR*Math.cos(toRad(a1)), cx+iR*Math.sin(toRad(a1))],
          ]
          return (
            <path key={i}
              d={`M${pts[0].join(',')} A${oR},${oR} 0 0,1 ${pts[1].join(',')} L${pts[2].join(',')} A${iR},${iR} 0 0,0 ${pts[3].join(',')} Z`}
              fill={i%2===0 ? 'rgba(74,222,128,0.22)' : 'rgba(0,0,0,0.35)'}
            />
          )
        })}
        {/* rim */}
        <circle cx={cx} cy={cx} r={r1} fill={`url(#rm-${id})`}/>
        <circle cx={cx} cy={cx} r={r1+1} fill="none" stroke="rgba(0,0,0,0.7)" strokeWidth="2.5"/>
        {/* spokes */}
        {Array.from({length:spokes}).map((_,i) => {
          const a = (i/spokes)*360*Math.PI/180
          const w = r1*0.13
          const perp = a + Math.PI/2
          const x1 = cx+r3*1.1*Math.cos(a), y1 = cx+r3*1.1*Math.sin(a)
          const x2 = cx+r2*0.95*Math.cos(a), y2 = cx+r2*0.95*Math.sin(a)
          return (
            <polygon key={i}
              points={`${x1+w*0.6*Math.cos(perp)},${y1+w*0.6*Math.sin(perp)} ${x1-w*0.6*Math.cos(perp)},${y1-w*0.6*Math.sin(perp)} ${x2-w*0.35*Math.cos(perp)},${y2-w*0.35*Math.sin(perp)} ${x2+w*0.35*Math.cos(perp)},${y2+w*0.35*Math.sin(perp)}`}
              fill="rgba(74,222,128,0.75)" stroke="rgba(134,239,172,0.4)" strokeWidth="0.5"
            />
          )
        })}
        {/* inner */}
        <circle cx={cx} cy={cx} r={r2} fill="rgba(2,12,5,0.96)" stroke="rgba(74,222,128,0.35)" strokeWidth="1.5"/>
        {Array.from({length:8}).map((_,i) => {
          const a = (i/8)*360*Math.PI/180
          return <line key={i} x1={cx+(r3+1)*Math.cos(a)} y1={cx+(r3+1)*Math.sin(a)} x2={cx+r2*0.82*Math.cos(a)} y2={cx+r2*0.82*Math.sin(a)} stroke="rgba(22,163,74,0.15)" strokeWidth="0.8"/>
        })}
        {/* hub */}
        <circle cx={cx} cy={cx} r={r3+2} fill="rgba(3,12,4,0.98)" stroke="rgba(74,222,128,0.5)" strokeWidth="1.2"/>
        <circle cx={cx} cy={cx} r={r3}   fill={`url(#rh-${id})`}/>
        <circle cx={cx} cy={cx} r={r3*0.5} fill="rgba(2,8,3,0.9)"/>
        <circle cx={cx-r3*0.18} cy={cx-r3*0.18} r={r3*0.2} fill="rgba(255,255,255,0.28)"/>
      </g>
    </svg>
  )
}

/* ── Feature pill ────────────────────────────────────────────────────────── */
function FeatureChip({ icon: Icon, label, delay = 0 }) {
  return (
    <div className="tp-feature-card flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl"
      style={{
        background: 'rgba(22,163,74,0.1)',
        border: '1px solid rgba(22,163,74,0.22)',
        animationDelay: `${delay}s`,
      }}>
      <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(22,163,74,0.18)', border: '1px solid rgba(22,163,74,0.3)' }}>
        <Icon size={14} color="#4ade80" strokeWidth={2}/>
      </div>
      <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,0.8)' }}>{label}</span>
    </div>
  )
}

const ID_MODES = [
  { value: 'email',    label: 'Email',      icon: Mail,   placeholder: 'you@company.com', type: 'email' },
  { value: 'username', label: 'Username',   icon: AtSign, placeholder: 'your_username',   type: 'text' },
  { value: 'empid',    label: 'Employee ID',icon: Hash,   placeholder: 'EMP-1042',         type: 'text' },
]

const FEATURES = [
  { icon: BarChart3,  label: 'AI-Powered Fleet Analytics' },
  { icon: Brain,      label: 'Predictive Maintenance' },
  { icon: Bell,       label: 'Real-Time Alerts' },
  { icon: Shield,     label: 'Full RCA Engine' },
  { icon: TrendingUp, label: 'Cost Per KM Tracking' },
  { icon: Smartphone, label: 'Offline-Ready Mobile' },
]

export default function Login() {
  const { signIn, user, loading: authLoading } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate            = useNavigate()

  // Navigate to dashboard once auth state resolves — avoids race with async fetchProfile
  useEffect(() => {
    if (!authLoading && user) navigate('/', { replace: true })
  }, [user, authLoading, navigate])

  const [tab, setTab]                 = useState('login')
  const [idMode, setIdMode]           = useState('email')
  const [identifier, setIdentifier]   = useState('')
  const [password, setPassword]       = useState('')
  const [confirm, setConfirm]         = useState('')
  const [fullName, setFullName]       = useState('')
  const [signupUsername, setSignupUsername] = useState('')
  const [employeeId, setEmployeeId]   = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [signupDone, setSignupDone]   = useState(false)
  const [showLoginPw, setShowLoginPw] = useState(false)
  const [showSignupPw, setShowSignupPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [forgotMode, setForgotMode]   = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent]   = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)
  const [isOnline, setIsOnline]       = useState(navigator.onLine)
  const [mfaState, setMfaState]       = useState(null) // { factorId } when MFA challenge needed

  // Track network status
  useEffect(() => {
    const on  = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const sessionExpired = localStorage.getItem('tp_session_expired') === '1'
  const accessRevoked  = localStorage.getItem('tp_access_revoked')  === '1'
  useEffect(() => {
    if (sessionExpired) localStorage.removeItem('tp_session_expired')
    if (accessRevoked)  localStorage.removeItem('tp_access_revoked')
  }, [])

  const currentMode = ID_MODES.find(m => m.value === idMode)

  async function handleLogin(e) {
    e.preventDefault()
    if (!isOnline) { setError('No internet connection. Please check your network.'); return }
    setError(''); setLoading(true)
    const result = await signIn(identifier, password)
    if (result?.mfaRequired) {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const factor = factors?.totp?.[0]
      if (factor) {
        setMfaState({ factorId: factor.id })
      } else {
        setError('MFA is required but no authenticator factor found.')
      }
      setLoading(false)
      return
    }
    if (result) { setError(result.message || 'Login failed'); setLoading(false) }
    // on success: useEffect above handles navigation once AuthContext resolves user + profile
  }

  async function handleSignup(e) {
    e.preventDefault(); setError('')
    if (password !== confirm)   { setError('Passwords do not match'); return }
    if (password.length < 6)    { setError('Password must be at least 6 characters'); return }
    if (!signupUsername.trim()) { setError('Username is required'); return }
    setLoading(true)
    const { data, error: authErr } = await supabase.auth.signUp({ email: signupEmail, password })
    if (authErr) { setError(authErr.message); setLoading(false); return }
    if (data?.user) {
      const { error: pErr } = await supabase.from('profiles').insert({
        id: data.user.id, username: signupUsername.trim(),
        full_name: fullName.trim() || null, employee_id: employeeId.trim() || null,
        role: 'Reporter', region: 'KSA', approved: false,
      })
      if (pErr && pErr.code !== '42501' && pErr.code !== '23505')
        console.warn('Profile insert warning:', pErr.message)
    }
    setSignupDone(true); setLoading(false)
  }

  async function handleForgot(e) {
    e.preventDefault(); setError(''); setForgotLoading(true)
    const { error: fErr } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: window.location.origin + '/reset-password',
    })
    if (fErr) setError(fErr.message); else setForgotSent(true)
    setForgotLoading(false)
  }

  function switchTab(val) { setTab(val); setError(''); setSignupDone(false); setForgotMode(false); setForgotSent(false) }
  function switchIdMode(val) { setIdMode(val); setIdentifier(''); setError('') }

  const inputStyle = (field) => ({
    width: '100%',
    padding: '11px 14px',
    background: 'rgba(255,255,255,0.055)',
    border: `1.5px solid ${focusedField === field ? 'rgba(74,222,128,0.65)' : 'rgba(255,255,255,0.1)'}`,
    borderRadius: 12,
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: '0.01em',
    transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
    boxShadow: focusedField === field ? '0 0 0 3px rgba(22,163,74,0.15), 0 0 20px rgba(22,163,74,0.08)' : 'none',
    outline: 'none',
    backdropFilter: 'blur(8px)',
  })

  const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 700,
    color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em',
    textTransform: 'uppercase', marginBottom: 7,
  }

  return (
    <>
      <style>{STYLES}</style>

      {/* Page background follows the theme; the auth card stays a premium panel */}
      <div style={{ minHeight:'100vh', display:'flex', background:'var(--login-bg)', position:'relative', overflow:'hidden' }}>

        {/* ── Background layers ──────────────────────────────────────────── */}
        {/* Deep radial glow */}
        <div style={{
          position:'fixed', inset:0, pointerEvents:'none',
          background:'radial-gradient(ellipse 80% 60% at 20% 50%, rgba(22,163,74,0.14) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 50%, rgba(4,80,30,0.1) 0%, transparent 55%)',
        }}/>
        {/* Grid */}
        <div style={{
          position:'fixed', inset:0, pointerEvents:'none',
          backgroundImage: 'linear-gradient(rgba(22,163,74,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(22,163,74,0.07) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}/>
        {/* Scan line */}
        <div style={{
          position:'fixed', left:0, right:0, height:2, top:0,
          background:'linear-gradient(90deg, transparent, rgba(22,163,74,0.5), rgba(74,222,128,0.7), rgba(22,163,74,0.5), transparent)',
          animation:'tp-scan 9s ease-in-out infinite',
          pointerEvents:'none',
        }}/>

        {/* ── Theme toggle ────────────────────────────────────────────────── */}
        <button
          onClick={toggleTheme}
          title={isDark ? 'Light mode' : 'Dark mode'}
          style={{
            position:'fixed', top:16, right:16, zIndex:100,
            width:40, height:40, borderRadius:12,
            background:'rgba(22,163,74,0.12)', border:'1.5px solid rgba(22,163,74,0.28)',
            color:'#4ade80', display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', transition:'all 0.2s',
            boxShadow:'0 4px 20px rgba(0,0,0,0.4)',
            backdropFilter:'blur(12px)',
          }}
        >
          {isDark ? <Moon size={16}/> : <Sun size={16}/>}
        </button>

        {/* Network status pill */}
        <div style={{
          position:'fixed', top:16, left:'50%', transform:'translateX(-50%)',
          zIndex:100, display:'flex', alignItems:'center', gap:6,
          padding:'5px 12px', borderRadius:999,
          background: isOnline ? 'rgba(22,163,74,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${isOnline ? 'rgba(22,163,74,0.25)' : 'rgba(239,68,68,0.3)'}`,
          transition:'all 0.4s',
        }}>
          {isOnline
            ? <><Wifi size={11} color="#4ade80"/><span style={{fontSize:10, fontWeight:700, color:'#4ade80', letterSpacing:'0.06em'}}>CONNECTED</span></>
            : <><WifiOff size={11} color="#f87171"/><span style={{fontSize:10, fontWeight:700, color:'#f87171', letterSpacing:'0.06em'}}>OFFLINE</span></>
          }
        </div>

        {/* ── LEFT PANEL (desktop) ─────────────────────────────────────────── */}
        <div style={{
          display:'none',
          flexDirection:'column',
          justifyContent:'center',
          padding:'60px 56px',
          flex:'0 0 48%',
          position:'relative',
        }}
          className="lg-panel">

          {/* Big background tyre */}
          <div style={{ position:'absolute', right:-60, top:'50%', transform:'translateY(-50%)', opacity:0.08, pointerEvents:'none' }}>
            <Tyre size={500} reverse/>
          </div>

          {/* Brand */}
          <div style={{ marginBottom:48 }}>
            <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
              <div style={{
                width:52, height:52, borderRadius:16, display:'flex', alignItems:'center', justifyContent:'center',
                background:'linear-gradient(135deg, rgba(22,163,74,0.22), rgba(4,20,10,0.9))',
                border:'1.5px solid rgba(22,163,74,0.4)',
                boxShadow:'0 0 30px rgba(22,163,74,0.3)',
              }}>
                <img src={TpLogo} alt="TyrePulse" style={{width:30, height:30}}/>
              </div>
              <div>
                <div style={{fontSize:26, fontWeight:800, color:'#fff', letterSpacing:'-0.03em', lineHeight:1}}>TyrePulse</div>
                <div style={{fontSize:11, color:'rgba(74,222,128,0.7)', letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:600, marginTop:2}}>Fleet Intelligence</div>
              </div>
            </div>

            <h2 style={{ fontSize:36, fontWeight:800, color:'#fff', lineHeight:1.2, letterSpacing:'-0.03em', margin:'0 0 12px' }}>
              Smarter Fleet.<br/>
              <span style={{ background:'linear-gradient(135deg, #4ade80, #22c55e)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
                Lower Costs.
              </span>
            </h2>
            <p style={{ fontSize:14, color:'rgba(255,255,255,0.45)', lineHeight:1.6, margin:0, maxWidth:340 }}>
              Enterprise-grade tyre lifecycle management, AI-powered analytics, and real-time fleet intelligence — all in one platform.
            </p>
          </div>

          {/* Features grid */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, maxWidth:380 }}>
            {FEATURES.map((f, i) => (
              <FeatureChip key={f.label} icon={f.icon} label={f.label} delay={i * 0.08}/>
            ))}
          </div>

          {/* Stats row */}
          <div style={{ display:'flex', gap:32, marginTop:40 }}>
            {[['10K+','Tyres Tracked'],['99.9%','Uptime SLA'],['3s','Avg Alert Time']].map(([val, lbl]) => (
              <div key={lbl}>
                <div style={{fontSize:22, fontWeight:800, color:'#4ade80', letterSpacing:'-0.02em'}}>{val}</div>
                <div style={{fontSize:11, color:'rgba(255,255,255,0.35)', fontWeight:500, marginTop:2}}>{lbl}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT PANEL / Single Column Mobile ──────────────────────────── */}
        <div style={{
          flex:1, display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center',
          padding:'24px 20px',
          minHeight:'100vh',
        }}>

          {/* Mobile-only brand */}
          <motion.div
            initial={{ opacity:1, y:-16 }}
            animate={{ opacity:1, y:0 }}
            transition={{ duration:0.45, ease:[0.22,1,0.36,1] }}
            style={{ textAlign:'center', marginBottom:24 }}
            className="mobile-brand"
          >
            <div style={{ display:'flex', justifyContent:'center', marginBottom:10 }}>
              <div style={{ position:'relative' }}>
                <div className="tp-pulse-ring" style={{ inset:-10 }}/>
                <Tyre size={76} opacity={0.95}/>
              </div>
            </div>
            <div style={{fontSize:24, fontWeight:800, color:'#fff', letterSpacing:'-0.03em'}}>TyrePulse</div>
            <div style={{fontSize:11, color:'rgba(74,222,128,0.65)', letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:600, marginTop:3}}>Fleet Intelligence Platform</div>
          </motion.div>

          {/* Session expired banner */}
          <AnimatePresence>
            {sessionExpired && (
              <motion.div
                initial={{ opacity:0, y:-8, height:0 }}
                animate={{ opacity:1, y:0, height:'auto' }}
                exit={{ opacity:0, height:0 }}
                style={{
                  display:'flex', alignItems:'center', gap:8,
                  padding:'10px 14px', borderRadius:12, marginBottom:12,
                  fontSize:13, color:'#fcd34d',
                  background:'rgba(234,179,8,0.08)',
                  border:'1px solid rgba(234,179,8,0.2)',
                  width:'100%', maxWidth:420,
                }}
              >
                <AlertCircle size={14} style={{flexShrink:0}}/>
                Session expired after inactivity. Please sign in again.
              </motion.div>
            )}
          </AnimatePresence>

          {/* Access revoked banner */}
          <AnimatePresence>
            {accessRevoked && (
              <motion.div
                initial={{ opacity:0, y:-8, height:0 }}
                animate={{ opacity:1, y:0, height:'auto' }}
                exit={{ opacity:0, height:0 }}
                style={{
                  display:'flex', alignItems:'center', gap:8,
                  padding:'10px 14px', borderRadius:12, marginBottom:12,
                  fontSize:13, color:'#fca5a5',
                  background:'rgba(239,68,68,0.08)',
                  border:'1px solid rgba(239,68,68,0.25)',
                  width:'100%', maxWidth:420,
                }}
              >
                <AlertCircle size={14} style={{flexShrink:0}}/>
                Your account access has been suspended. Contact your administrator.
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main card */}
          <motion.div
            initial={{ opacity:1, y:20, scale:0.98 }}
            animate={{ opacity:1, y:0, scale:1 }}
            transition={{ duration:0.5, ease:[0.22,1,0.36,1] }}
            style={{ width:'100%', maxWidth:420 }}
          >
            <div style={{
              background:'var(--login-card-bg)',
              border:'1.5px solid var(--login-card-border)',
              borderRadius:24,
              padding:'28px 28px 32px',
              boxShadow:'var(--login-card-shadow)',
              backdropFilter:'blur(32px)',
              position:'relative',
              overflow:'hidden',
            }}>

              {/* Top glow stripe */}
              <div style={{
                position:'absolute', top:0, left:'15%', right:'15%', height:1,
                background:'linear-gradient(90deg, transparent, rgba(74,222,128,0.7), transparent)',
              }}/>

              {/* Tabs */}
              {!forgotMode && (
                <div style={{ display:'flex', marginBottom:24, gap:4 }}>
                  {[['login','Sign In'],['signup','Create Account']].map(([val,label]) => (
                    <button key={val} onClick={() => switchTab(val)} style={{
                      flex:1, padding:'9px 0', fontSize:13, fontWeight:700,
                      border:'none', borderRadius:10,
                      background: tab===val ? 'rgba(22,163,74,0.18)' : 'transparent',
                      boxShadow: tab===val ? 'inset 0 0 0 1.5px rgba(22,163,74,0.38)' : 'inset 0 0 0 1.5px rgba(255,255,255,0.06)',
                      color: tab===val ? '#4ade80' : 'rgba(255,255,255,0.35)',
                      cursor:'pointer', transition:'all 0.2s',
                    }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity:0, height:0, marginBottom:0 }}
                    animate={{ opacity:1, height:'auto', marginBottom:16 }}
                    exit={{ opacity:0, height:0, marginBottom:0 }}
                    style={{
                      display:'flex', alignItems:'flex-start', gap:9,
                      padding:'11px 14px', borderRadius:12, fontSize:13,
                      color:'#fca5a5', background:'rgba(239,68,68,0.1)',
                      border:'1.5px solid rgba(239,68,68,0.25)', lineHeight:1.5,
                    }}
                  >
                    <AlertCircle size={15} style={{flexShrink:0, marginTop:1}}/>
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── LOGIN FORM ───────────────────────────────────────────── */}
              {tab === 'login' && !forgotMode && (
                <motion.form key="login"
                  initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-12 }}
                  transition={{ duration:0.2 }}
                  onSubmit={handleLogin}
                  style={{ display:'flex', flexDirection:'column', gap:18 }}
                >
                  {/* ID mode selector */}
                  <div>
                    <div style={labelStyle}>Sign in with</div>
                    <div style={{
                      display:'flex', gap:4, padding:4,
                      background:'rgba(255,255,255,0.03)',
                      border:'1.5px solid rgba(255,255,255,0.07)',
                      borderRadius:12,
                    }}>
                      {ID_MODES.map(({ value, label, icon: Icon }) => (
                        <button key={value} type="button" onClick={() => switchIdMode(value)} style={{
                          flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                          padding:'7px 0', borderRadius:9, fontSize:11, fontWeight:700,
                          border: idMode===value ? '1.5px solid rgba(22,163,74,0.42)' : '1.5px solid transparent',
                          background: idMode===value ? 'rgba(22,163,74,0.16)' : 'transparent',
                          color: idMode===value ? '#4ade80' : 'rgba(255,255,255,0.3)',
                          cursor:'pointer', transition:'all 0.18s',
                        }}>
                          <Icon size={11}/>{label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Identifier input */}
                  <AnimatePresence mode="wait">
                    <motion.div key={idMode}
                      initial={{ opacity:0, x:8 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-8 }}
                      transition={{ duration:0.15 }}
                    >
                      <div style={labelStyle}>{currentMode.label}</div>
                      <div style={{ position:'relative' }}>
                        <div style={{
                          position:'absolute', left:13, top:'50%', transform:'translateY(-50%)',
                          color: focusedField==='id' ? '#4ade80' : 'rgba(255,255,255,0.28)',
                          transition:'color 0.2s', pointerEvents:'none',
                        }}>
                          <currentMode.icon size={15}/>
                        </div>
                        <input
                          type={currentMode.type}
                          style={{ ...inputStyle('id'), paddingLeft:40 }}
                          placeholder={currentMode.placeholder}
                          value={identifier}
                          onChange={e => setIdentifier(e.target.value)}
                          onFocus={() => setFocusedField('id')}
                          onBlur={() => setFocusedField(null)}
                          required autoFocus autoComplete="username"
                        />
                      </div>
                    </motion.div>
                  </AnimatePresence>

                  {/* Password */}
                  <div>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
                      <span style={labelStyle}>Password</span>
                      <button type="button"
                        onClick={() => { setForgotMode(true); setForgotEmail(idMode==='email' ? identifier : ''); setError('') }}
                        style={{ fontSize:11, color:'rgba(74,222,128,0.6)', background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:600, transition:'color 0.2s', letterSpacing:'0.02em' }}
                        onMouseEnter={e => e.target.style.color='#4ade80'}
                        onMouseLeave={e => e.target.style.color='rgba(74,222,128,0.6)'}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div style={{ position:'relative' }}>
                      <input
                        type={showLoginPw ? 'text' : 'password'}
                        style={{ ...inputStyle('pw'), paddingRight:44 }}
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onFocus={() => setFocusedField('pw')}
                        onBlur={() => setFocusedField(null)}
                        required autoComplete="current-password"
                      />
                      <button type="button" onClick={() => setShowLoginPw(v => !v)} style={{
                        position:'absolute', right:13, top:'50%', transform:'translateY(-50%)',
                        color:'rgba(255,255,255,0.3)', background:'none', border:'none',
                        cursor:'pointer', padding:4, transition:'color 0.2s', display:'flex',
                      }}
                        onMouseEnter={e => e.currentTarget.style.color='rgba(255,255,255,0.7)'}
                        onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.3)'}
                      >
                        {showLoginPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                      </button>
                    </div>
                  </div>

                  {/* Submit */}
                  <button type="submit" disabled={loading || !isOnline} className="tp-btn-shine" style={{
                    width:'100%', padding:'13px', borderRadius:14, border:'none',
                    background: loading
                      ? 'rgba(22,163,74,0.3)'
                      : !isOnline
                        ? 'rgba(107,114,128,0.3)'
                        : 'linear-gradient(135deg, #16a34a 0%, #15803d 55%, #166534 100%)',
                    color:'#fff', fontSize:14, fontWeight:700,
                    cursor: (loading || !isOnline) ? 'not-allowed' : 'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    boxShadow: loading || !isOnline ? 'none' : '0 4px 28px rgba(22,163,74,0.4), 0 0 0 1px rgba(74,222,128,0.12)',
                    transition:'all 0.2s', letterSpacing:'0.01em',
                    marginTop:4,
                  }}>
                    {loading ? <Loader2 size={16} className="animate-spin"/> : <Zap size={16}/>}
                    {loading ? 'Signing in…' : !isOnline ? 'No Connection' : 'Sign In'}
                    {!loading && isOnline && <ArrowRight size={15}/>}
                  </button>

                  {/* Divider with PWA hint */}
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.07)' }}/>
                    <span style={{ fontSize:10, color:'rgba(255,255,255,0.22)', fontWeight:600, letterSpacing:'0.06em', whiteSpace:'nowrap' }}>
                      INSTALL AS APP
                    </span>
                    <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.07)' }}/>
                  </div>
                  <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap' }}>
                    {[
                      { icon:'📱', label:'Add to Home Screen' },
                      { icon:'💻', label:'Desktop PWA' },
                    ].map(({ icon, label }) => (
                      <div key={label} style={{
                        display:'flex', alignItems:'center', gap:5,
                        padding:'5px 12px', borderRadius:8,
                        background:'rgba(255,255,255,0.03)',
                        border:'1px solid rgba(255,255,255,0.07)',
                        fontSize:11, color:'rgba(255,255,255,0.3)', fontWeight:500,
                      }}>
                        <span style={{fontSize:12}}>{icon}</span>{label}
                      </div>
                    ))}
                  </div>
                </motion.form>
              )}

              {/* ── FORGOT PASSWORD ───────────────────────────────────────── */}
              {forgotMode && !forgotSent && (
                <motion.form key="forgot"
                  initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-12 }}
                  transition={{ duration:0.2 }}
                  onSubmit={handleForgot}
                  style={{ display:'flex', flexDirection:'column', gap:16 }}
                >
                  <div>
                    <button type="button" onClick={() => { setForgotMode(false); setError('') }}
                      style={{ fontSize:12, color:'rgba(74,222,128,0.6)', background:'none', border:'none', cursor:'pointer', padding:0, marginBottom:14, fontWeight:600 }}>
                      ← Back to sign in
                    </button>
                    <div style={{ fontSize:20, fontWeight:800, color:'#fff', marginBottom:5, letterSpacing:'-0.02em' }}>Reset Password</div>
                    <div style={{ fontSize:13, color:'rgba(255,255,255,0.4)', lineHeight:1.5 }}>Enter your email and we'll send a reset link instantly.</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Email address</div>
                    <input type="email" style={inputStyle('forgot')} placeholder="you@company.com"
                      value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                      onFocus={() => setFocusedField('forgot')} onBlur={() => setFocusedField(null)}
                      required autoFocus/>
                  </div>
                  <button type="submit" disabled={forgotLoading} className="tp-btn-shine" style={{
                    width:'100%', padding:'13px', borderRadius:14, border:'none',
                    background:'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:forgotLoading?'not-allowed':'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    boxShadow:'0 4px 24px rgba(22,163,74,0.35)',
                  }}>
                    {forgotLoading ? <Loader2 size={16} className="animate-spin"/> : <Mail size={16}/>}
                    {forgotLoading ? 'Sending…' : 'Send Reset Link'}
                  </button>
                </motion.form>
              )}

              {/* Forgot sent success */}
              {forgotMode && forgotSent && (
                <motion.div initial={{ opacity:0, scale:0.95 }} animate={{ opacity:1, scale:1 }}
                  style={{ textAlign:'center', padding:'8px 0' }}>
                  <div style={{
                    width:64, height:64, borderRadius:20, margin:'0 auto 18px',
                    background:'rgba(22,163,74,0.12)', border:'1.5px solid rgba(22,163,74,0.3)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    boxShadow:'0 0 40px rgba(22,163,74,0.25)',
                  }}>
                    <CheckCircle2 size={30} style={{color:'#4ade80'}}/>
                  </div>
                  <div style={{fontSize:18, fontWeight:800, color:'#fff', marginBottom:8, letterSpacing:'-0.02em'}}>Reset link sent!</div>
                  <div style={{fontSize:13, color:'rgba(255,255,255,0.4)', lineHeight:1.6}}>Check your inbox — link expires in 60 minutes.</div>
                  <button onClick={() => { setForgotMode(false); setForgotSent(false) }} style={{
                    marginTop:22, width:'100%', padding:'12px', borderRadius:14, border:'none',
                    background:'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer',
                    boxShadow:'0 4px 24px rgba(22,163,74,0.3)',
                  }}>Back to Sign In</button>
                </motion.div>
              )}

              {/* ── SIGNUP FORM ───────────────────────────────────────────── */}
              {tab === 'signup' && !signupDone && (
                <motion.form key="signup"
                  initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-12 }}
                  transition={{ duration:0.2 }}
                  onSubmit={handleSignup}
                  style={{ display:'flex', flexDirection:'column', gap:14 }}
                >
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div>
                      <div style={labelStyle}>Full Name</div>
                      <input style={inputStyle('fname')} placeholder="Your name"
                        value={fullName} onChange={e => setFullName(e.target.value)}
                        onFocus={() => setFocusedField('fname')} onBlur={() => setFocusedField(null)}/>
                    </div>
                    <div>
                      <div style={labelStyle}>Username *</div>
                      <input style={inputStyle('uname')} placeholder="username"
                        value={signupUsername} onChange={e => setSignupUsername(e.target.value)}
                        onFocus={() => setFocusedField('uname')} onBlur={() => setFocusedField(null)} required/>
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Employee ID</div>
                    <input style={inputStyle('empid')} placeholder="EMP-1042 (optional)"
                      value={employeeId} onChange={e => setEmployeeId(e.target.value)}
                      onFocus={() => setFocusedField('empid')} onBlur={() => setFocusedField(null)}/>
                  </div>
                  <div>
                    <div style={labelStyle}>Email *</div>
                    <input type="email" style={inputStyle('semail')} placeholder="you@company.com"
                      value={signupEmail} onChange={e => setSignupEmail(e.target.value)}
                      onFocus={() => setFocusedField('semail')} onBlur={() => setFocusedField(null)} required/>
                  </div>
                  {[
                    { field:'spw',  show:showSignupPw,  set:setShowSignupPw,  val:password,  setVal:setPassword,  label:'Password *' },
                    { field:'scpw', show:showConfirmPw, set:setShowConfirmPw, val:confirm,   setVal:setConfirm,   label:'Confirm Password *' },
                  ].map(({ field, show, set, val, setVal, label }) => (
                    <div key={field}>
                      <div style={labelStyle}>{label}</div>
                      <div style={{ position:'relative' }}>
                        <input type={show ? 'text' : 'password'} style={{ ...inputStyle(field), paddingRight:44 }}
                          placeholder="••••••••" value={val} onChange={e => setVal(e.target.value)}
                          onFocus={() => setFocusedField(field)} onBlur={() => setFocusedField(null)} required/>
                        <button type="button" onClick={() => set(v => !v)} style={{
                          position:'absolute', right:13, top:'50%', transform:'translateY(-50%)',
                          color:'rgba(255,255,255,0.3)', background:'none', border:'none', cursor:'pointer', padding:4, display:'flex',
                        }}>
                          {show ? <EyeOff size={15}/> : <Eye size={15}/>}
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Strength indicator */}
                  {password.length > 0 && (
                    <div>
                      <div style={{ display:'flex', gap:4, marginBottom:5 }}>
                        {[1,2,3,4].map(i => {
                          const strength = password.length >= 12 && /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4
                            : password.length >= 10 ? 3
                            : password.length >= 8 ? 2 : 1
                          const active = i <= strength
                          return (
                            <div key={i} style={{
                              flex:1, height:3, borderRadius:999, transition:'background 0.3s',
                              background: active
                                ? strength >= 4 ? '#22c55e' : strength >= 3 ? '#84cc16' : strength >= 2 ? '#f59e0b' : '#ef4444'
                                : 'rgba(255,255,255,0.08)',
                            }}/>
                          )
                        })}
                      </div>
                      <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', fontWeight:600 }}>
                        {password.length < 8 ? 'Too short' : password.length < 10 ? 'Fair' : password.length < 12 ? 'Good' : 'Strong'}
                      </div>
                    </div>
                  )}

                  <div style={{
                    padding:'10px 14px', borderRadius:12, fontSize:12,
                    color:'rgba(255,255,255,0.38)', lineHeight:1.55,
                    background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)',
                  }}>
                    🔒 New accounts require admin approval before access is granted.
                  </div>

                  <button type="submit" disabled={loading} className="tp-btn-shine" style={{
                    width:'100%', padding:'13px', borderRadius:14, border:'none',
                    background: loading ? 'rgba(22,163,74,0.3)' : 'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:loading?'not-allowed':'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    boxShadow: loading ? 'none' : '0 4px 28px rgba(22,163,74,0.4)',
                  }}>
                    {loading && <Loader2 size={16} className="animate-spin"/>}
                    {loading ? 'Creating account…' : 'Create Account'}
                    {!loading && <ArrowRight size={15}/>}
                  </button>
                </motion.form>
              )}

              {/* Signup success */}
              {tab === 'signup' && signupDone && (
                <motion.div initial={{ opacity:0, scale:0.95 }} animate={{ opacity:1, scale:1 }}
                  style={{ textAlign:'center', padding:'8px 0' }}>
                  <div style={{
                    width:64, height:64, borderRadius:20, margin:'0 auto 18px',
                    background:'rgba(234,179,8,0.1)', border:'1.5px solid rgba(234,179,8,0.25)',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:30,
                    boxShadow:'0 0 40px rgba(234,179,8,0.2)',
                  }}>⏳</div>
                  <div style={{fontSize:18, fontWeight:800, color:'#fff', marginBottom:8, letterSpacing:'-0.02em'}}>Account Submitted!</div>
                  <div style={{fontSize:13, color:'rgba(255,255,255,0.4)', lineHeight:1.6, maxWidth:280, margin:'0 auto'}}>
                    Pending admin approval. You'll receive access once an administrator reviews your request.
                  </div>
                  <button onClick={() => switchTab('login')} style={{
                    marginTop:22, width:'100%', padding:'12px', borderRadius:14, border:'none',
                    background:'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer',
                    boxShadow:'0 4px 24px rgba(22,163,74,0.3)',
                  }}>Back to Sign In</button>
                </motion.div>
              )}
            </div>

            {/* Footer */}
            <motion.div
              initial={{ opacity:1 }} animate={{ opacity:1 }} transition={{ delay:0.55 }}
              style={{ textAlign:'center', marginTop:20, display:'flex', flexDirection:'column', gap:6 }}
            >
              <p style={{ fontSize:11, color:'rgba(255,255,255,0.18)', letterSpacing:'0.04em' }}>
                © 2026 TyrePulse · Enterprise Fleet Intelligence
              </p>
              <div style={{ display:'flex', justifyContent:'center', gap:16 }}>
                {['Privacy','Terms','Support'].map(label => (
                  <span key={label} style={{ fontSize:10, color:'rgba(255,255,255,0.15)', fontWeight:600, cursor:'default', letterSpacing:'0.04em' }}>
                    {label}
                  </span>
                ))}
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Responsive split — show left panel on large screens */}
      <style>{`
        @media (min-width: 1024px) {
          .lg-panel { display: flex !important; }
          .mobile-brand { display: none !important; }
        }
      `}</style>

      {/* MFA challenge modal — shown after password succeeds but AAL2 is required */}
      <TwoFactorChallenge
        open={!!mfaState}
        factorId={mfaState?.factorId}
        onSuccess={() => { setMfaState(null) }}
        onCancel={() => { setMfaState(null); setLoading(false) }}
      />
    </>
  )
}
