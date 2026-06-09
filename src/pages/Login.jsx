import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, EyeOff, ArrowRight, Mail, AlertCircle, CheckCircle2,
  Loader2, AtSign, Hash, Zap, Sun, Moon,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'
import TpLogo from '../assets/logo.svg'
import { cn } from '../lib/cn'

/* ── keyframes injected once ─────────────────────────────────────────────── */
const STYLES = `
@keyframes tp-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes tp-spin-slow {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes tp-spin-rev {
  from { transform: rotate(0deg); }
  to   { transform: rotate(-360deg); }
}
@keyframes tp-pulse-glow {
  0%,100% { box-shadow: 0 0 30px rgba(22,163,74,0.35), 0 0 60px rgba(22,163,74,0.15), inset 0 0 20px rgba(22,163,74,0.08); }
  50%      { box-shadow: 0 0 50px rgba(22,163,74,0.55), 0 0 100px rgba(22,163,74,0.25), inset 0 0 30px rgba(22,163,74,0.12); }
}
@keyframes tp-float {
  0%,100% { transform: translateY(0px) scale(1); }
  50%      { transform: translateY(-20px) scale(1.04); }
}
@keyframes tp-float2 {
  0%,100% { transform: translateY(0px) scale(1) rotate(0deg); }
  33%      { transform: translateY(-14px) scale(1.06) rotate(5deg); }
  66%      { transform: translateY(10px) scale(0.97) rotate(-3deg); }
}
@keyframes tp-scan {
  0%   { transform: translateY(-100%); opacity: 0; }
  10%  { opacity: 0.6; }
  90%  { opacity: 0.6; }
  100% { transform: translateY(100vh); opacity: 0; }
}
@keyframes tp-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
@keyframes tp-border-pulse {
  0%,100% { opacity: 0.6; }
  50%      { opacity: 1; }
}
@keyframes tp-grid-drift {
  0%   { background-position: 0 0; }
  100% { background-position: 40px 40px; }
}
@keyframes tp-particle {
  0%   { transform: translateY(0) translateX(0) scale(1); opacity: 0.7; }
  50%  { opacity: 1; }
  100% { transform: translateY(-120px) translateX(30px) scale(0); opacity: 0; }
}

.tp-card-inner {
  position: relative;
  z-index: 1;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid rgba(22,163,74,0.18);
  box-shadow: 0 0 0 1px rgba(74,222,128,0.06), 0 24px 80px rgba(0,0,0,0.7), 0 0 60px rgba(22,163,74,0.08);
}
.tp-tyre-spin {
  animation: tp-spin 4s linear infinite;
  transform-origin: center;
}
.tp-tyre-spin-slow {
  animation: tp-spin-slow 7s linear infinite;
  transform-origin: center;
}
.tp-tyre-spin-rev {
  animation: tp-spin-rev 5s linear infinite;
  transform-origin: center;
}
.tp-input-focus:focus {
  border-color: rgba(22,163,74,0.7) !important;
  box-shadow: 0 0 0 3px rgba(22,163,74,0.12), 0 0 20px rgba(22,163,74,0.1) !important;
  outline: none;
}
.tp-logo-glow {
  animation: tp-pulse-glow 3s ease-in-out infinite;
}
.tp-btn-shine {
  position: relative;
  overflow: hidden;
}
.tp-btn-shine::after {
  content: '';
  position: absolute;
  top: 0; left: -100%;
  width: 60%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
  animation: tp-shimmer 2.5s ease-in-out infinite;
  pointer-events: none;
}
`

const ID_MODES = [
  { value: 'email',    label: 'Email',       icon: Mail,    placeholder: 'you@example.com', type: 'email' },
  { value: 'username', label: 'Username',    icon: AtSign,  placeholder: 'your_username',   type: 'text' },
  { value: 'empid',   label: 'Employee ID',  icon: Hash,    placeholder: 'EMP-1042',        type: 'text' },
]

/* ── Spinning Tyre SVG ───────────────────────────────────────────────────── */
function SpinningTyre({ size = 180, opacity = 1, glowColor = 'rgba(22,163,74,0.5)', spinDuration = '5s', reverse = false }) {
  const cx = size / 2
  const R  = size / 2        // outer rubber
  const r1 = R * 0.78        // inner rubber / rim outer
  const r2 = R * 0.60        // rim inner
  const r3 = R * 0.18        // hub
  const spokes = 6
  const treads = 28

  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ display:'block', filter:`drop-shadow(0 0 18px ${glowColor}) drop-shadow(0 0 6px ${glowColor})`, opacity }}
    >
      <defs>
        {/* Rubber gradient */}
        <radialGradient id={`rub-${size}`} cx="50%" cy="35%" r="60%">
          <stop offset="0%"   stopColor="#2a2a2a"/>
          <stop offset="60%"  stopColor="#111"/>
          <stop offset="100%" stopColor="#080808"/>
        </radialGradient>
        {/* Rim gradient */}
        <radialGradient id={`rim-${size}`} cx="40%" cy="30%" r="70%">
          <stop offset="0%"   stopColor="#4ade80" stopOpacity="0.9"/>
          <stop offset="35%"  stopColor="#16a34a" stopOpacity="0.8"/>
          <stop offset="70%"  stopColor="#064e20" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#022010" stopOpacity="1"/>
        </radialGradient>
        {/* Hub gradient */}
        <radialGradient id={`hub-${size}`} cx="40%" cy="30%" r="70%">
          <stop offset="0%"   stopColor="#86efac"/>
          <stop offset="50%"  stopColor="#4ade80"/>
          <stop offset="100%" stopColor="#16a34a"/>
        </radialGradient>
        {/* Sidewall sheen */}
        <radialGradient id={`sheen-${size}`} cx="30%" cy="25%" r="55%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.12)"/>
          <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>

      {/* Spinning group */}
      <g style={{ animation: `${reverse ? 'tp-spin-rev' : 'tp-spin'} ${spinDuration} linear infinite`, transformOrigin: `${cx}px ${cx}px` }}>

        {/* Outer rubber ring */}
        <circle cx={cx} cy={cx} r={R - 1} fill={`url(#rub-${size})`}/>

        {/* Tread blocks around the circumference */}
        {Array.from({ length: treads }).map((_, i) => {
          const angle  = (i / treads) * 360
          const angle2 = ((i + 0.6) / treads) * 360
          const rad    = (a) => (a * Math.PI) / 180
          const outerR = R - 1
          const innerR = r1 + 2
          const x1 = cx + outerR * Math.cos(rad(angle))
          const y1 = cx + outerR * Math.sin(rad(angle))
          const x2 = cx + outerR * Math.cos(rad(angle2))
          const y2 = cx + outerR * Math.sin(rad(angle2))
          const x3 = cx + innerR * Math.cos(rad(angle2))
          const y3 = cx + innerR * Math.sin(rad(angle2))
          const x4 = cx + innerR * Math.cos(rad(angle))
          const y4 = cx + innerR * Math.sin(rad(angle))
          return (
            <path
              key={i}
              d={`M${x1},${y1} A${outerR},${outerR} 0 0,1 ${x2},${y2} L${x3},${y3} A${innerR},${innerR} 0 0,0 ${x4},${y4} Z`}
              fill={i % 2 === 0 ? 'rgba(74,222,128,0.18)' : 'rgba(0,0,0,0.4)'}
              stroke="rgba(74,222,128,0.08)"
              strokeWidth="0.5"
            />
          )
        })}

        {/* Sidewall sheen */}
        <circle cx={cx} cy={cx} r={R - 1} fill={`url(#sheen-${size})`}/>

        {/* Sidewall ring */}
        <circle cx={cx} cy={cx} r={r1} fill={`url(#rim-${size})`}/>

        {/* Rim shadow ring */}
        <circle cx={cx} cy={cx} r={r1 + 1} fill="none" stroke="rgba(0,0,0,0.8)" strokeWidth="3"/>

        {/* Spokes */}
        {Array.from({ length: spokes }).map((_, i) => {
          const angle = (i / spokes) * 360
          const rad   = (angle * Math.PI) / 180
          const spokeW = r1 * 0.14
          const x1 = cx + r3 * 1.1 * Math.cos(rad)
          const y1 = cx + r3 * 1.1 * Math.sin(rad)
          const x2 = cx + r2 * 0.95 * Math.cos(rad)
          const y2 = cx + r2 * 0.95 * Math.sin(rad)
          const perpRad = rad + Math.PI / 2
          return (
            <g key={i}>
              <polygon
                points={`
                  ${x1 + spokeW * 0.6 * Math.cos(perpRad)},${y1 + spokeW * 0.6 * Math.sin(perpRad)}
                  ${x1 - spokeW * 0.6 * Math.cos(perpRad)},${y1 - spokeW * 0.6 * Math.sin(perpRad)}
                  ${x2 - spokeW * 0.35 * Math.cos(perpRad)},${y2 - spokeW * 0.35 * Math.sin(perpRad)}
                  ${x2 + spokeW * 0.35 * Math.cos(perpRad)},${y2 + spokeW * 0.35 * Math.sin(perpRad)}
                `}
                fill="rgba(74,222,128,0.7)"
                stroke="rgba(134,239,172,0.4)"
                strokeWidth="0.5"
              />
              {/* Spoke highlight */}
              <line
                x1={x1 + spokeW * 0.2 * Math.cos(perpRad)}
                y1={y1 + spokeW * 0.2 * Math.sin(perpRad)}
                x2={x2 + spokeW * 0.2 * Math.cos(perpRad)}
                y2={y2 + spokeW * 0.2 * Math.sin(perpRad)}
                stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" strokeLinecap="round"
              />
            </g>
          )
        })}

        {/* Rim inner ring */}
        <circle cx={cx} cy={cx} r={r2} fill="rgba(2,16,8,0.95)" stroke="rgba(74,222,128,0.3)" strokeWidth="1.5"/>

        {/* Brake disc texture */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * 360 * Math.PI / 180
          return <line key={i}
            x1={cx + (r3 + 2) * Math.cos(a)} y1={cx + (r3 + 2) * Math.sin(a)}
            x2={cx + r2 * 0.85 * Math.cos(a)} y2={cx + r2 * 0.85 * Math.sin(a)}
            stroke="rgba(22,163,74,0.12)" strokeWidth="1"
          />
        })}

        {/* Hub cap */}
        <circle cx={cx} cy={cx} r={r3 + 2} fill="rgba(4,20,10,0.98)" stroke="rgba(74,222,128,0.5)" strokeWidth="1.5"/>
        <circle cx={cx} cy={cx} r={r3} fill={`url(#hub-${size})`}/>
        <circle cx={cx} cy={cx} r={r3 * 0.55} fill="rgba(2,10,5,0.9)"/>
        <circle cx={cx - r3 * 0.15} cy={cx - r3 * 0.15} r={r3 * 0.18} fill="rgba(255,255,255,0.25)"/>
      </g>
    </svg>
  )
}

/* ── Particle component ──────────────────────────────────────────────────── */
function Particle({ style }) {
  return (
    <div style={{
      position: 'absolute',
      width: 3,
      height: 3,
      borderRadius: '50%',
      background: 'rgba(74,222,128,0.8)',
      animation: `tp-particle ${3 + Math.random() * 4}s ease-out infinite`,
      animationDelay: `${Math.random() * 4}s`,
      ...style,
    }} />
  )
}

export default function Login() {
  const { signIn } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate   = useNavigate()

  const [tab, setTab]                   = useState('login')
  const [idMode, setIdMode]             = useState('email')
  const [identifier, setIdentifier]     = useState('')
  const [password, setPassword]         = useState('')
  const [confirm, setConfirm]           = useState('')
  const [fullName, setFullName]         = useState('')
  const [signupUsername, setSignupUsername] = useState('')
  const [employeeId, setEmployeeId]     = useState('')
  const [signupEmail, setSignupEmail]   = useState('')
  const [error, setError]               = useState('')
  const [loading, setLoading]           = useState(false)
  const [signupDone, setSignupDone]     = useState(false)
  const [showLoginPw, setShowLoginPw]   = useState(false)
  const [showSignupPw, setShowSignupPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [forgotMode, setForgotMode]     = useState(false)
  const [forgotEmail, setForgotEmail]   = useState('')
  const [forgotSent, setForgotSent]     = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)

  const sessionExpired = localStorage.getItem('tp_session_expired') === '1'
  useEffect(() => { if (sessionExpired) localStorage.removeItem('tp_session_expired') }, [])

  const currentMode = ID_MODES.find(m => m.value === idMode)

  const particles = Array.from({ length: 18 }, (_, i) => ({
    left: `${5 + (i * 5.5) % 90}%`,
    bottom: `${Math.random() * 30}%`,
    animationDuration: `${3 + (i % 4)}s`,
    animationDelay: `${(i * 0.4) % 4}s`,
  }))

  async function handleLogin(e) {
    e.preventDefault(); setError(''); setLoading(true)
    const err = await signIn(identifier, password)
    if (err) { setError(err.message); setLoading(false) } else navigate('/')
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
    padding: '10px 14px',
    background: 'rgba(3,12,6,0.7)',
    border: `1px solid ${focusedField === field ? 'rgba(22,163,74,0.6)' : 'rgba(255,255,255,0.07)'}`,
    borderRadius: 10,
    color: '#fff',
    fontSize: 14,
    transition: 'border-color 0.2s, box-shadow 0.2s',
    boxShadow: focusedField === field ? '0 0 0 3px rgba(22,163,74,0.12), 0 0 24px rgba(22,163,74,0.08)' : 'none',
    outline: 'none',
  })

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    marginBottom: 6,
  }

  return (
    <>
      <style>{STYLES}</style>
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: '#020704',
        position: 'relative',
        overflow: 'hidden',
      }}>

        {/* Theme toggle — fixed top-right */}
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.3 }}
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            position: 'fixed', top: 18, right: 18, zIndex: 100,
            width: 44, height: 44, borderRadius: 12,
            background: isDark ? 'rgba(22,163,74,0.12)' : 'rgba(22,163,74,0.15)',
            border: `1px solid ${isDark ? 'rgba(22,163,74,0.3)' : 'rgba(22,163,74,0.4)'}`,
            color: isDark ? '#4ade80' : '#15803d',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: isDark
              ? '0 4px 20px rgba(0,0,0,0.4), 0 0 12px rgba(22,163,74,0.15)'
              : '0 4px 20px rgba(0,0,0,0.12), 0 0 12px rgba(22,163,74,0.2)',
            backdropFilter: 'blur(12px)',
            transition: 'all 0.25s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'scale(1.1) rotate(15deg)'
            e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.4), 0 0 20px rgba(22,163,74,0.35)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1) rotate(0deg)'
            e.currentTarget.style.boxShadow = isDark
              ? '0 4px 20px rgba(0,0,0,0.4), 0 0 12px rgba(22,163,74,0.15)'
              : '0 4px 20px rgba(0,0,0,0.12), 0 0 12px rgba(22,163,74,0.2)'
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={isDark ? 'moon' : 'sun'}
              initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.2 }}
            >
              {isDark ? <Moon size={18} /> : <Sun size={18} />}
            </motion.div>
          </AnimatePresence>
        </motion.button>

        {/* Animated grid */}
        <div style={{
          position: 'fixed', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(22,163,74,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(22,163,74,0.04) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          animation: 'tp-grid-drift 8s linear infinite',
        }} />

        {/* Ambient blobs */}
        <div style={{ position:'fixed', inset:0, pointerEvents:'none' }}>
          <div style={{
            position:'absolute', top:'8%', left:'2%', width:600, height:600,
            background:'radial-gradient(circle, rgba(22,163,74,0.18) 0%, transparent 65%)',
            borderRadius:'50%', filter:'blur(70px)',
            animation:'tp-float 8s ease-in-out infinite',
          }}/>
          <div style={{
            position:'absolute', bottom:'5%', right:'3%', width:500, height:500,
            background:'radial-gradient(circle, rgba(22,163,74,0.10) 0%, transparent 65%)',
            borderRadius:'50%', filter:'blur(60px)',
            animation:'tp-float2 11s ease-in-out infinite',
          }}/>
          <div style={{
            position:'absolute', top:'40%', left:'55%', width:300, height:300,
            background:'radial-gradient(circle, rgba(74,222,128,0.06) 0%, transparent 65%)',
            borderRadius:'50%', filter:'blur(50px)',
            animation:'tp-float 6s ease-in-out infinite 2s',
          }}/>
          {/* Scan line */}
          <div style={{
            position:'absolute', left:0, right:0, height:2,
            background:'linear-gradient(90deg, transparent, rgba(22,163,74,0.4), transparent)',
            animation:'tp-scan 7s ease-in-out infinite 1s',
            pointerEvents:'none',
          }}/>
        </div>

        {/* Particles */}
        <div style={{ position:'fixed', inset:0, pointerEvents:'none', overflow:'hidden' }}>
          {particles.map((p, i) => <Particle key={i} style={p} />)}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          style={{ position:'relative', width:'100%', maxWidth:420, zIndex:10 }}
        >
          {/* Top decorative tyre (small, centered above brand) */}
          <div style={{ display:'flex', justifyContent:'center', marginBottom:8 }}>
            <SpinningTyre size={72} opacity={0.7} glowColor="rgba(22,163,74,0.6)" spinDuration="3s"/>
          </div>

          {/* Brand header */}
          <div style={{ textAlign:'center', marginBottom: 32 }}>
            <motion.div
              initial={{ scale: 0.6, opacity: 0, rotate: -10 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ delay: 0.1, duration: 0.5, ease: [0.175,0.885,0.32,1.275] }}
              style={{ display:'inline-block', marginBottom: 20 }}
            >
              <div className="tp-logo-glow" style={{
                width: 88, height: 88, borderRadius: 22,
                background: 'linear-gradient(135deg, rgba(22,163,74,0.25), rgba(4,20,10,0.95))',
                border: '1px solid rgba(22,163,74,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto',
              }}>
                <img src={TpLogo} alt="TyrePulse" style={{ width:52, height:52 }} />
              </div>
            </motion.div>

            <motion.h1
              initial={{ opacity:0, y:8 }}
              animate={{ opacity:1, y:0 }}
              transition={{ delay:0.2, duration:0.4 }}
              style={{ fontSize:32, fontWeight:800, color:'#fff', letterSpacing:'-0.03em', margin:0 }}
            >
              TyrePulse
            </motion.h1>
            <motion.p
              initial={{ opacity:0 }}
              animate={{ opacity:1 }}
              transition={{ delay:0.3 }}
              style={{ fontSize:13, color:'rgba(255,255,255,0.38)', marginTop:6, letterSpacing:'0.1em', textTransform:'uppercase', fontWeight:500 }}
            >
              Fleet Intelligence Platform
            </motion.p>

            {/* Decorative line */}
            <motion.div
              initial={{ scaleX:0 }}
              animate={{ scaleX:1 }}
              transition={{ delay:0.35, duration:0.6, ease:[0.22,1,0.36,1] }}
              style={{
                width:60, height:2, margin:'14px auto 0',
                background:'linear-gradient(90deg, transparent, rgba(22,163,74,0.8), transparent)',
                borderRadius:999,
              }}
            />
          </div>

          {/* Session expired */}
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
                }}
              >
                <AlertCircle size={14} style={{ flexShrink:0 }} />
                Session expired after 30 minutes of inactivity.
              </motion.div>
            )}
          </AnimatePresence>

          {/* Decorative tyres — left & right of the card */}
          <div style={{ position:'relative' }}>
            {/* Left tyre — partially visible */}
            <div style={{
              position:'absolute', left:-90, top:'50%', transform:'translateY(-50%)',
              pointerEvents:'none', zIndex:0,
            }}>
              <SpinningTyre size={200} opacity={0.55} glowColor="rgba(22,163,74,0.4)" spinDuration="6s"/>
            </div>
            {/* Right tyre — partially visible */}
            <div style={{
              position:'absolute', right:-90, top:'50%', transform:'translateY(-50%)',
              pointerEvents:'none', zIndex:0,
            }}>
              <SpinningTyre size={200} opacity={0.55} glowColor="rgba(22,163,74,0.4)" spinDuration="8s" reverse/>
            </div>

            {/* Card */}
            <div className="tp-card-inner" style={{
              background: 'rgba(4,12,7,0.92)',
              backdropFilter: 'blur(24px)',
              padding: '28px 28px',
              position:'relative', zIndex:1,
            }}>

              {/* Inner top glow stripe */}
              <div style={{
                position:'absolute', top:0, left:'10%', right:'10%', height:1,
                background:'linear-gradient(90deg, transparent, rgba(74,222,128,0.6), transparent)',
                animation:'tp-border-pulse 2.5s ease-in-out infinite',
              }}/>

              {/* Tabs */}
              {!forgotMode && (
                <div style={{
                  display:'flex', marginBottom:24,
                  borderBottom:'1px solid rgba(255,255,255,0.06)',
                }}>
                  {[['login','Sign In'],['signup','Create Account']].map(([val,label]) => (
                    <button
                      key={val}
                      onClick={() => switchTab(val)}
                      style={{
                        flex:1, padding:'10px 0', fontSize:13, fontWeight:600,
                        border:'none', borderBottom: `2px solid ${tab===val ? 'rgba(22,163,74,0.9)' : 'transparent'}`,
                        marginBottom:-1,
                        color: tab===val ? '#4ade80' : 'rgba(255,255,255,0.35)',
                        background:'transparent', cursor:'pointer',
                        transition:'all 0.2s',
                        textShadow: tab===val ? '0 0 20px rgba(74,222,128,0.5)' : 'none',
                      }}
                    >
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
                      display:'flex', alignItems:'center', gap:8,
                      padding:'10px 14px', borderRadius:10, fontSize:13,
                      color:'#fca5a5', background:'rgba(239,68,68,0.08)',
                      border:'1px solid rgba(239,68,68,0.2)',
                    }}
                  >
                    <AlertCircle size={14} style={{ flexShrink:0 }} />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── LOGIN FORM ─────────────────────────────────── */}
              {tab === 'login' && !forgotMode && (
                <motion.form
                  key="login"
                  initial={{ opacity:0, x:10 }}
                  animate={{ opacity:1, x:0 }}
                  exit={{ opacity:0, x:-10 }}
                  transition={{ duration:0.2 }}
                  onSubmit={handleLogin}
                  style={{ display:'flex', flexDirection:'column', gap:18 }}
                >
                  {/* ID mode pills */}
                  <div>
                    <div style={labelStyle}>Sign in with</div>
                    <div style={{
                      display:'flex', gap:6, padding:5,
                      background:'rgba(255,255,255,0.03)',
                      border:'1px solid rgba(255,255,255,0.06)',
                      borderRadius:12,
                    }}>
                      {ID_MODES.map(({ value, label, icon: Icon }) => (
                        <button
                          key={value} type="button"
                          onClick={() => switchIdMode(value)}
                          style={{
                            flex:1, display:'flex', alignItems:'center',
                            justifyContent:'center', gap:6,
                            padding:'7px 0', borderRadius:8, fontSize:12, fontWeight:600,
                            border: idMode===value ? '1px solid rgba(22,163,74,0.35)' : '1px solid transparent',
                            background: idMode===value ? 'rgba(22,163,74,0.15)' : 'transparent',
                            color: idMode===value ? '#4ade80' : 'rgba(255,255,255,0.35)',
                            cursor:'pointer', transition:'all 0.2s',
                            textShadow: idMode===value ? '0 0 12px rgba(74,222,128,0.4)' : 'none',
                            boxShadow: idMode===value ? '0 0 12px rgba(22,163,74,0.1)' : 'none',
                          }}
                        >
                          <Icon size={12} />{label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Identifier */}
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={idMode}
                      initial={{ opacity:0, x:8 }}
                      animate={{ opacity:1, x:0 }}
                      exit={{ opacity:0, x:-8 }}
                      transition={{ duration:0.15 }}
                    >
                      <div style={labelStyle}>{currentMode.label}</div>
                      <div style={{ position:'relative' }}>
                        <div style={{
                          position:'absolute', left:12, top:'50%', transform:'translateY(-50%)',
                          color: focusedField==='id' ? 'rgba(74,222,128,0.8)' : 'rgba(255,255,255,0.25)',
                          transition:'color 0.2s', pointerEvents:'none',
                        }}>
                          <currentMode.icon size={15} />
                        </div>
                        <input
                          type={currentMode.type}
                          style={{ ...inputStyle('id'), paddingLeft:38 }}
                          placeholder={currentMode.placeholder}
                          value={identifier}
                          onChange={e => setIdentifier(e.target.value)}
                          onFocus={() => setFocusedField('id')}
                          onBlur={() => setFocusedField(null)}
                          required autoFocus
                        />
                      </div>
                    </motion.div>
                  </AnimatePresence>

                  {/* Password */}
                  <div>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                      <span style={labelStyle}>Password</span>
                      <button
                        type="button"
                        onClick={() => { setForgotMode(true); setForgotEmail(idMode==='email' ? identifier : ''); setError('') }}
                        style={{ fontSize:11, color:'rgba(74,222,128,0.65)', background:'none', border:'none', cursor:'pointer', padding:0, transition:'color 0.2s' }}
                        onMouseEnter={e => e.target.style.color='rgba(74,222,128,1)'}
                        onMouseLeave={e => e.target.style.color='rgba(74,222,128,0.65)'}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div style={{ position:'relative' }}>
                      <input
                        type={showLoginPw ? 'text' : 'password'}
                        style={{ ...inputStyle('pw'), paddingRight:42 }}
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onFocus={() => setFocusedField('pw')}
                        onBlur={() => setFocusedField(null)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPw(v => !v)}
                        style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', color:'rgba(255,255,255,0.3)', background:'none', border:'none', cursor:'pointer', padding:4, transition:'color 0.2s' }}
                        onMouseEnter={e => e.currentTarget.style.color='rgba(255,255,255,0.7)'}
                        onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.3)'}
                      >
                        {showLoginPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                      </button>
                    </div>
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="tp-btn-shine"
                    style={{
                      width:'100%', padding:'13px', borderRadius:12, border:'none',
                      background: loading
                        ? 'rgba(22,163,74,0.3)'
                        : 'linear-gradient(135deg, #16a34a 0%, #15803d 50%, #166534 100%)',
                      color:'#fff', fontSize:14, fontWeight:700, cursor: loading ? 'not-allowed' : 'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                      boxShadow: loading ? 'none' : '0 4px 24px rgba(22,163,74,0.35), 0 0 0 1px rgba(74,222,128,0.15)',
                      transition:'all 0.2s', letterSpacing:'0.01em',
                    }}
                    onMouseEnter={e => { if (!loading) e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(22,163,74,0.5), 0 0 0 1px rgba(74,222,128,0.2)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; if (!loading) e.currentTarget.style.boxShadow = '0 4px 24px rgba(22,163,74,0.35), 0 0 0 1px rgba(74,222,128,0.15)' }}
                  >
                    {loading ? <Loader2 size={16} className="animate-spin"/> : <Zap size={16}/>}
                    {loading ? 'Signing in…' : 'Sign In'}
                    {!loading && <ArrowRight size={15}/>}
                  </button>
                </motion.form>
              )}

              {/* ── FORGOT PASSWORD ────────────────────────────── */}
              {forgotMode && !forgotSent && (
                <motion.form
                  key="forgot"
                  initial={{ opacity:0, x:10 }}
                  animate={{ opacity:1, x:0 }}
                  exit={{ opacity:0, x:-10 }}
                  transition={{ duration:0.2 }}
                  onSubmit={handleForgot}
                  style={{ display:'flex', flexDirection:'column', gap:16 }}
                >
                  <div>
                    <button
                      type="button"
                      onClick={() => { setForgotMode(false); setError('') }}
                      style={{ fontSize:12, color:'rgba(74,222,128,0.65)', background:'none', border:'none', cursor:'pointer', padding:0, marginBottom:12 }}
                    >
                      ← Back to sign in
                    </button>
                    <div style={{ fontSize:18, fontWeight:700, color:'#fff', marginBottom:4 }}>Reset Password</div>
                    <div style={{ fontSize:13, color:'rgba(255,255,255,0.38)' }}>We'll send a reset link to your email.</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Email address</div>
                    <input
                      type="email" style={inputStyle('forgot')}
                      placeholder="you@example.com"
                      value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                      onFocus={() => setFocusedField('forgot')} onBlur={() => setFocusedField(null)}
                      required autoFocus
                    />
                  </div>
                  <button type="submit" disabled={forgotLoading} className="tp-btn-shine" style={{
                    width:'100%', padding:'13px', borderRadius:12, border:'none',
                    background:'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor: forgotLoading ? 'not-allowed' : 'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    boxShadow:'0 4px 24px rgba(22,163,74,0.3)',
                  }}>
                    {forgotLoading ? <Loader2 size={16} className="animate-spin"/> : <Mail size={16}/>}
                    {forgotLoading ? 'Sending…' : 'Send Reset Link'}
                  </button>
                </motion.form>
              )}

              {/* Forgot sent success */}
              {forgotMode && forgotSent && (
                <motion.div
                  initial={{ opacity:0, scale:0.95 }}
                  animate={{ opacity:1, scale:1 }}
                  style={{ textAlign:'center', padding:'16px 0' }}
                >
                  <div style={{
                    width:64, height:64, borderRadius:18, margin:'0 auto 16px',
                    background:'rgba(22,163,74,0.1)', border:'1px solid rgba(22,163,74,0.25)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    boxShadow:'0 0 30px rgba(22,163,74,0.2)',
                  }}>
                    <CheckCircle2 size={30} style={{ color:'#4ade80' }} />
                  </div>
                  <div style={{ fontSize:17, fontWeight:700, color:'#fff', marginBottom:6 }}>Reset link sent!</div>
                  <div style={{ fontSize:13, color:'rgba(255,255,255,0.38)', lineHeight:1.6 }}>Check your inbox — it may take a minute.</div>
                  <button onClick={() => { setForgotMode(false); setForgotSent(false) }} style={{
                    marginTop:20, width:'100%', padding:'12px', borderRadius:12, border:'none',
                    background:'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer',
                  }}>Back to Sign In</button>
                </motion.div>
              )}

              {/* ── SIGNUP FORM ────────────────────────────────── */}
              {tab === 'signup' && !signupDone && (
                <motion.form
                  key="signup"
                  initial={{ opacity:0, x:10 }}
                  animate={{ opacity:1, x:0 }}
                  exit={{ opacity:0, x:-10 }}
                  transition={{ duration:0.2 }}
                  onSubmit={handleSignup}
                  style={{ display:'flex', flexDirection:'column', gap:14 }}
                >
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div>
                      <div style={labelStyle}>Full Name</div>
                      <input style={inputStyle('fname')} placeholder="Your name" value={fullName} onChange={e => setFullName(e.target.value)}
                        onFocus={() => setFocusedField('fname')} onBlur={() => setFocusedField(null)} />
                    </div>
                    <div>
                      <div style={labelStyle}>Username *</div>
                      <input style={inputStyle('uname')} placeholder="username" value={signupUsername} onChange={e => setSignupUsername(e.target.value)}
                        onFocus={() => setFocusedField('uname')} onBlur={() => setFocusedField(null)} required />
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Employee ID</div>
                    <input style={inputStyle('empid')} placeholder="EMP-1042 (optional)" value={employeeId} onChange={e => setEmployeeId(e.target.value)}
                      onFocus={() => setFocusedField('empid')} onBlur={() => setFocusedField(null)} />
                  </div>
                  <div>
                    <div style={labelStyle}>Email *</div>
                    <input type="email" style={inputStyle('semail')} placeholder="you@company.com" value={signupEmail} onChange={e => setSignupEmail(e.target.value)}
                      onFocus={() => setFocusedField('semail')} onBlur={() => setFocusedField(null)} required />
                  </div>
                  {[
                    { field:'spw',  show:showSignupPw,  set:setShowSignupPw,  val:password,  setVal:setPassword,  label:'Password *' },
                    { field:'scpw', show:showConfirmPw, set:setShowConfirmPw, val:confirm,   setVal:setConfirm,   label:'Confirm Password *' },
                  ].map(({ field, show, set, val, setVal, label }) => (
                    <div key={field}>
                      <div style={labelStyle}>{label}</div>
                      <div style={{ position:'relative' }}>
                        <input
                          type={show ? 'text' : 'password'}
                          style={{ ...inputStyle(field), paddingRight:42 }}
                          placeholder="••••••••" value={val} onChange={e => setVal(e.target.value)}
                          onFocus={() => setFocusedField(field)} onBlur={() => setFocusedField(null)} required
                        />
                        <button type="button" onClick={() => set(v => !v)}
                          style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', color:'rgba(255,255,255,0.3)', background:'none', border:'none', cursor:'pointer', padding:4 }}>
                          {show ? <EyeOff size={15}/> : <Eye size={15}/>}
                        </button>
                      </div>
                    </div>
                  ))}
                  <div style={{
                    padding:'10px 14px', borderRadius:10, fontSize:12,
                    color:'rgba(255,255,255,0.35)', lineHeight:1.5,
                    background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)',
                  }}>
                    New accounts require admin approval before access is granted.
                  </div>
                  <button type="submit" disabled={loading} className="tp-btn-shine" style={{
                    width:'100%', padding:'13px', borderRadius:12, border:'none',
                    background: loading ? 'rgba(22,163,74,0.3)' : 'linear-gradient(135deg, #16a34a 0%, #15803d 50%, #166534 100%)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor: loading ? 'not-allowed' : 'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    boxShadow: loading ? 'none' : '0 4px 24px rgba(22,163,74,0.35)',
                  }}>
                    {loading ? <Loader2 size={16} className="animate-spin"/> : null}
                    {loading ? 'Creating account…' : 'Create Account'}
                    {!loading && <ArrowRight size={15}/>}
                  </button>
                </motion.form>
              )}

              {/* Signup success */}
              {tab === 'signup' && signupDone && (
                <motion.div initial={{ opacity:0, scale:0.95 }} animate={{ opacity:1, scale:1 }} style={{ textAlign:'center', padding:'16px 0' }}>
                  <div style={{
                    width:64, height:64, borderRadius:18, margin:'0 auto 16px',
                    background:'rgba(234,179,8,0.08)', border:'1px solid rgba(234,179,8,0.2)',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:32,
                  }}>⏳</div>
                  <div style={{ fontSize:17, fontWeight:700, color:'#fff', marginBottom:6 }}>Account Submitted!</div>
                  <div style={{ fontSize:13, color:'rgba(255,255,255,0.38)', lineHeight:1.6 }}>
                    Pending admin approval. You'll be notified once your account is activated.
                  </div>
                  <button onClick={() => switchTab('login')} style={{
                    marginTop:20, width:'100%', padding:'12px', borderRadius:12, border:'none',
                    background:'linear-gradient(135deg, #16a34a, #15803d)',
                    color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer',
                  }}>Back to Sign In</button>
                </motion.div>
              )}
            </div>{/* end tp-card-inner */}
          </div>{/* end tyre wrapper */}

          {/* Footer */}
          <motion.p
            initial={{ opacity:0 }}
            animate={{ opacity:1 }}
            transition={{ delay:0.5 }}
            style={{ textAlign:'center', fontSize:11, color:'rgba(255,255,255,0.18)', marginTop:24, letterSpacing:'0.05em' }}
          >
            © 2026 TyrePulse · Built by Shahzeb Rahman
          </motion.p>
        </motion.div>
      </div>
    </>
  )
}
