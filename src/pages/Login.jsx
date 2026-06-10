import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, EyeOff, ArrowRight, Mail, AlertCircle, CheckCircle2,
  Loader2, AtSign, Hash, Zap, Sun, Moon,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/cn'

/* ─── Keyframes ─────────────────────────────────────────────────────────────── */
const STYLES = `
@keyframes tyre-roll {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes tyre-glow-pulse {
  0%,100% { filter: drop-shadow(0 0 18px rgba(22,163,74,0.55)) drop-shadow(0 0 40px rgba(22,163,74,0.2)); }
  50%      { filter: drop-shadow(0 0 30px rgba(22,163,74,0.85)) drop-shadow(0 0 70px rgba(22,163,74,0.35)); }
}
@keyframes tyre-float {
  0%,100% { transform: translateY(0px); }
  50%      { transform: translateY(-10px); }
}
@keyframes tp-scan {
  0%   { transform: translateY(-100%); opacity: 0; }
  10%  { opacity: 0.5; }
  90%  { opacity: 0.5; }
  100% { transform: translateY(100vh); opacity: 0; }
}
@keyframes tp-particle {
  0%   { transform: translateY(0) scale(1); opacity: 0.8; }
  100% { transform: translateY(-140px) scale(0); opacity: 0; }
}
@keyframes tp-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.tp-btn-shine { position:relative; overflow:hidden; }
.tp-btn-shine::after {
  content:''; position:absolute; top:0; left:-100%; width:60%; height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,0.18),transparent);
  animation:tp-shimmer 2.5s ease-in-out infinite; pointer-events:none;
}
`

const ID_MODES = [
  { value:'email',    label:'Email',       icon:Mail,   placeholder:'you@example.com', type:'email' },
  { value:'username', label:'Username',    icon:AtSign, placeholder:'your_username',   type:'text'  },
  { value:'empid',   label:'Employee ID',  icon:Hash,   placeholder:'EMP-1042',        type:'text'  },
]

/* ─── Realistic Truck Tyre SVG ──────────────────────────────────────────────── */
function TruckTyre({ size = 320, isDark = true }) {
  const cx   = size / 2
  const OR   = size / 2 - 4        // outer rubber edge
  const SW   = OR * 0.13           // sidewall width
  const IR   = OR - SW             // inner rubber / rim outer
  const RR   = IR * 0.68           // rim outer visible
  const WR   = IR * 0.52           // rim well
  const HR   = IR * 0.15           // hub radius
  const LUGS = 10                  // lug nuts

  // Tread: 3 rows of blocks
  const TREAD_ROWS = [
    { r1: OR,       r2: OR - SW*0.35, blocks: 24, even: true  }, // outer row
    { r1: OR-SW*0.4, r2: OR - SW*0.75, blocks: 20, even: false }, // middle row
    { r1: OR-SW*0.8, r2: IR + 2,      blocks: 24, even: true  }, // inner row
  ]

  function rad(deg) { return deg * Math.PI / 180 }

  function arcPath(r1, r2, aStart, aEnd) {
    const x1 = cx + r1 * Math.cos(rad(aStart)), y1 = cx + r1 * Math.sin(rad(aStart))
    const x2 = cx + r1 * Math.cos(rad(aEnd)),   y2 = cx + r1 * Math.sin(rad(aEnd))
    const x3 = cx + r2 * Math.cos(rad(aEnd)),   y3 = cx + r2 * Math.sin(rad(aEnd))
    const x4 = cx + r2 * Math.cos(rad(aStart)), y4 = cx + r2 * Math.sin(rad(aStart))
    const laf = (aEnd - aStart) > 180 ? 1 : 0
    return `M${x1},${y1} A${r1},${r1} 0 ${laf},1 ${x2},${y2} L${x3},${y3} A${r2},${r2} 0 ${laf},0 ${x4},${y4} Z`
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ display:'block', animation:'tyre-float 4s ease-in-out infinite' }}>
      <defs>
        {/* Outer rubber */}
        <radialGradient id="trub" cx="38%" cy="28%" r="65%">
          <stop offset="0%"   stopColor="#353535"/>
          <stop offset="40%"  stopColor="#1a1a1a"/>
          <stop offset="80%"  stopColor="#0d0d0d"/>
          <stop offset="100%" stopColor="#060606"/>
        </radialGradient>
        {/* Rim face */}
        <radialGradient id="trim" cx="40%" cy="32%" r="62%">
          <stop offset="0%"   stopColor={isDark ? '#5ef08a' : '#22c55e'} stopOpacity="0.95"/>
          <stop offset="30%"  stopColor={isDark ? '#16a34a' : '#15803d'}/>
          <stop offset="65%"  stopColor={isDark ? '#0c5c2c' : '#14532d'}/>
          <stop offset="100%" stopColor={isDark ? '#052514' : '#062d18'}/>
        </radialGradient>
        {/* Rim well (deep part) */}
        <radialGradient id="twell" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#0a1a0f"/>
          <stop offset="100%" stopColor="#020805"/>
        </radialGradient>
        {/* Hub */}
        <radialGradient id="thub" cx="35%" cy="30%" r="65%">
          <stop offset="0%"   stopColor={isDark ? '#a7f3c4' : '#bbf7d0'}/>
          <stop offset="40%"  stopColor={isDark ? '#4ade80' : '#22c55e'}/>
          <stop offset="100%" stopColor={isDark ? '#166534' : '#15803d'}/>
        </radialGradient>
        {/* Sidewall sheen */}
        <radialGradient id="tsheen" cx="28%" cy="22%" r="55%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.10)"/>
          <stop offset="60%"  stopColor="rgba(255,255,255,0.02)"/>
          <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
        </radialGradient>
        {/* Spoke shine */}
        <linearGradient id="tspoke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.3)"/>
          <stop offset="50%"  stopColor={isDark ? 'rgba(74,222,128,0.9)' : 'rgba(22,163,74,0.9)'}/>
          <stop offset="100%" stopColor="rgba(0,0,0,0.2)"/>
        </linearGradient>
        {/* Outer glow filter */}
        <filter id="tglow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* ── Spinning group ── */}
      <g style={{ animation:'tyre-roll 6s linear infinite', transformOrigin:`${cx}px ${cx}px` }}>

        {/* Base rubber circle */}
        <circle cx={cx} cy={cx} r={OR} fill="url(#trub)"/>

        {/* Tread blocks - 3 rows */}
        {TREAD_ROWS.map((row, ri) =>
          Array.from({ length: row.blocks }).map((_, i) => {
            const gapDeg = 1.8
            const blockDeg = (360 / row.blocks) - gapDeg
            const startDeg = i * (360 / row.blocks) + (row.even ? 0 : 360 / row.blocks / 2)
            const endDeg   = startDeg + blockDeg
            const isHigh = (i + ri) % 3 !== 0
            return (
              <path
                key={`${ri}-${i}`}
                d={arcPath(row.r1 - 0.5, row.r2 + 0.5, startDeg, endDeg)}
                fill={isHigh ? 'rgba(90,90,90,0.85)' : 'rgba(30,30,30,0.9)'}
                stroke="rgba(0,0,0,0.6)"
                strokeWidth="0.6"
              />
            )
          })
        )}

        {/* Tread grooves (lateral cuts across all rows) */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * 360
          const r = rad(a)
          return (
            <line
              key={`groove-${i}`}
              x1={cx + (IR + 2) * Math.cos(r)}
              y1={cx + (IR + 2) * Math.sin(r)}
              x2={cx + (OR - 1) * Math.cos(r)}
              y2={cx + (OR - 1) * Math.sin(r)}
              stroke="rgba(0,0,0,0.9)"
              strokeWidth="2.5"
            />
          )
        })}

        {/* Sidewall sheen */}
        <circle cx={cx} cy={cx} r={OR} fill="url(#tsheen)"/>

        {/* Sidewall ridge rings */}
        {[IR + SW*0.2, IR + SW*0.1].map((r, i) => (
          <circle key={i} cx={cx} cy={cx} r={r}
            fill="none"
            stroke={i === 0 ? 'rgba(80,80,80,0.6)' : 'rgba(50,50,50,0.4)'}
            strokeWidth={i === 0 ? 2 : 1}
          />
        ))}

        {/* Bead / inner rubber edge */}
        <circle cx={cx} cy={cx} r={IR + 1.5} fill="none" stroke="rgba(0,0,0,0.9)" strokeWidth="4"/>

        {/* ── RIM ── */}
        {/* Rim outer face */}
        <circle cx={cx} cy={cx} r={IR} fill="url(#trim)"/>

        {/* Rim barrel / depth shadow */}
        <circle cx={cx} cy={cx} r={IR} fill="none" stroke="rgba(0,0,0,0.7)" strokeWidth="6"/>

        {/* 5 wide spokes */}
        {Array.from({ length: 5 }).map((_, i) => {
          const angle  = (i / 5) * 360
          const angle2 = angle + 36
          const r1 = rad(angle - 14), r2 = rad(angle + 14)
          const rMid = rad(angle)
          const spokeOR = RR * 0.97
          const spokeIR = HR * 1.3
          // Fan-shaped spoke
          const pts = [
            `${cx + spokeIR * 1.8 * Math.cos(r1)},${cx + spokeIR * 1.8 * Math.sin(r1)}`,
            `${cx + spokeOR * Math.cos(r1 - 0.05)},${cx + spokeOR * Math.sin(r1 - 0.05)}`,
            `${cx + spokeOR * Math.cos(r2 + 0.05)},${cx + spokeOR * Math.sin(r2 + 0.05)}`,
            `${cx + spokeIR * 1.8 * Math.cos(r2)},${cx + spokeIR * 1.8 * Math.sin(r2)}`,
          ].join(' ')
          return (
            <g key={i}>
              <polygon points={pts} fill="url(#tspoke)" stroke="rgba(0,0,0,0.5)" strokeWidth="0.8"/>
              {/* Spoke highlight stripe */}
              <line
                x1={cx + HR * 1.6 * Math.cos(rMid)} y1={cx + HR * 1.6 * Math.sin(rMid)}
                x2={cx + spokeOR * 0.9 * Math.cos(rMid)} y2={cx + spokeOR * 0.9 * Math.sin(rMid)}
                stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round"
              />
              {/* Brake vent holes between spokes */}
              {[-1, 0, 1].map((offset, j) => {
                const holeAngle = rad(angle + 36 * 0.5 + offset * 9)
                const holeR = WR * 0.78
                return <circle key={j}
                  cx={cx + holeR * Math.cos(holeAngle)} cy={cx + holeR * Math.sin(holeAngle)}
                  r={WR * 0.055}
                  fill="rgba(2,10,5,0.95)" stroke="rgba(74,222,128,0.15)" strokeWidth="0.5"
                />
              })}
            </g>
          )
        })}

        {/* Rim inner ring (well) */}
        <circle cx={cx} cy={cx} r={WR} fill="url(#twell)" stroke="rgba(22,163,74,0.2)" strokeWidth="1.5"/>

        {/* Lug nuts ring */}
        {Array.from({ length: LUGS }).map((_, i) => {
          const a = rad((i / LUGS) * 360)
          const lr = HR * 2.5
          return (
            <g key={i}>
              <circle
                cx={cx + lr * Math.cos(a)} cy={cx + lr * Math.sin(a)}
                r={HR * 0.38}
                fill="rgba(15,30,18,0.95)" stroke="rgba(74,222,128,0.5)" strokeWidth="1"
              />
              {/* Nut face highlight */}
              <circle
                cx={cx + lr * Math.cos(a) - HR*0.1} cy={cx + lr * Math.sin(a) - HR*0.1}
                r={HR * 0.12}
                fill="rgba(255,255,255,0.2)"
              />
            </g>
          )
        })}

        {/* Hub cap outer ring */}
        <circle cx={cx} cy={cx} r={HR * 1.45} fill="rgba(4,18,9,0.98)" stroke="rgba(74,222,128,0.55)" strokeWidth="2"/>
        {/* Hub cap face */}
        <circle cx={cx} cy={cx} r={HR * 1.2} fill="url(#thub)"/>
        {/* Hub centre dot */}
        <circle cx={cx} cy={cx} r={HR * 0.45} fill="rgba(2,10,5,0.92)" stroke="rgba(74,222,128,0.3)" strokeWidth="0.8"/>
        {/* Hub specular */}
        <circle cx={cx - HR*0.28} cy={cx - HR*0.28} r={HR * 0.2} fill="rgba(255,255,255,0.28)"/>
      </g>

      {/* Static outer glow ring (not spinning) */}
      <circle cx={cx} cy={cx} r={OR + 2} fill="none"
        stroke="rgba(22,163,74,0.25)" strokeWidth="4"
        style={{ animation:'tyre-glow-pulse 3s ease-in-out infinite' }}
      />
    </svg>
  )
}

/* ─── Rising particles ──────────────────────────────────────────────────────── */
function Particles() {
  const pts = Array.from({ length: 20 }, (_, i) => ({
    left: `${4 + (i * 4.8) % 92}%`,
    bottom: `${(i * 7) % 25}%`,
    delay: `${(i * 0.35) % 5}s`,
    dur:   `${3 + (i % 4)}s`,
    size:  i % 3 === 0 ? 4 : i % 3 === 1 ? 2.5 : 3,
  }))
  return (
    <div style={{ position:'fixed', inset:0, pointerEvents:'none', overflow:'hidden' }}>
      {pts.map((p, i) => (
        <div key={i} style={{
          position:'absolute', left:p.left, bottom:p.bottom,
          width:p.size, height:p.size, borderRadius:'50%',
          background:`rgba(${i%2===0?'74,222,128':'22,163,74'},0.7)`,
          animation:`tp-particle ${p.dur} ease-out infinite`,
          animationDelay: p.delay,
        }}/>
      ))}
    </div>
  )
}

/* ─── Main Login Page ───────────────────────────────────────────────────────── */
export default function Login() {
  const { signIn }           = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate             = useNavigate()

  const [tab, setTab]                       = useState('login')
  const [idMode, setIdMode]                 = useState('email')
  const [identifier, setIdentifier]         = useState('')
  const [password, setPassword]             = useState('')
  const [confirm, setConfirm]               = useState('')
  const [fullName, setFullName]             = useState('')
  const [signupUsername, setSignupUsername] = useState('')
  const [employeeId, setEmployeeId]         = useState('')
  const [signupEmail, setSignupEmail]       = useState('')
  const [error, setError]                   = useState('')
  const [loading, setLoading]               = useState(false)
  const [signupDone, setSignupDone]         = useState(false)
  const [showLoginPw, setShowLoginPw]       = useState(false)
  const [showSignupPw, setShowSignupPw]     = useState(false)
  const [showConfirmPw, setShowConfirmPw]   = useState(false)
  const [forgotMode, setForgotMode]         = useState(false)
  const [forgotEmail, setForgotEmail]       = useState('')
  const [forgotSent, setForgotSent]         = useState(false)
  const [forgotLoading, setForgotLoading]   = useState(false)
  const [focused, setFocused]               = useState(null)

  const sessionExpired = localStorage.getItem('tp_session_expired') === '1'
  useEffect(() => { if (sessionExpired) localStorage.removeItem('tp_session_expired') }, [])

  const currentMode = ID_MODES.find(m => m.value === idMode)

  // Theme-aware colours
  const bg        = isDark ? '#020704'               : '#f0f5f1'
  const cardBg    = isDark ? 'rgba(4,12,7,0.93)'     : 'rgba(255,255,255,0.95)'
  const cardBdr   = isDark ? 'rgba(22,163,74,0.22)'  : 'rgba(22,163,74,0.25)'
  const cardShadow= isDark
    ? '0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(74,222,128,0.06), 0 0 60px rgba(22,163,74,0.08)'
    : '0 24px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(22,163,74,0.12), 0 0 30px rgba(22,163,74,0.06)'
  const textPrimary   = isDark ? '#ffffff'         : '#0f172a'
  const textMuted     = isDark ? 'rgba(255,255,255,0.38)' : '#64748b'
  const textDim       = isDark ? 'rgba(255,255,255,0.22)' : '#94a3b8'
  const brandGreen    = isDark ? '#4ade80'         : '#16a34a'
  const brandGreenDim = isDark ? 'rgba(74,222,128,0.65)' : 'rgba(22,163,74,0.65)'
  const inputBg       = isDark ? 'rgba(3,12,6,0.7)' : 'rgba(240,250,244,0.8)'
  const inputBdr      = (f) => f === focused
    ? isDark ? 'rgba(22,163,74,0.7)' : 'rgba(22,163,74,0.7)'
    : isDark ? 'rgba(255,255,255,0.07)' : 'rgba(22,163,74,0.18)'
  const inputShadow = (f) => f === focused
    ? isDark ? '0 0 0 3px rgba(22,163,74,0.12),0 0 20px rgba(22,163,74,0.08)' : '0 0 0 3px rgba(22,163,74,0.12)'
    : 'none'
  const tabActiveBdr  = isDark ? 'rgba(22,163,74,0.9)' : '#16a34a'
  const tabActiveText = brandGreen
  const tabInactiveText = textMuted
  const pillBg    = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(22,163,74,0.05)'
  const pillBdr   = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(22,163,74,0.12)'
  const gridColor = isDark ? 'rgba(22,163,74,0.04)'   : 'rgba(22,163,74,0.07)'

  const labelSt = {
    display:'block', fontSize:11, fontWeight:600, letterSpacing:'0.07em',
    textTransform:'uppercase', marginBottom:6, color: textMuted,
  }
  const inputSt = (f) => ({
    width:'100%', padding:'10px 14px',
    background: inputBg,
    border: `1px solid ${inputBdr(f)}`,
    borderRadius:10, color: textPrimary, fontSize:14,
    transition:'border-color 0.2s,box-shadow 0.2s', outline:'none',
    boxShadow: inputShadow(f),
  })

  async function handleLogin(e) {
    e.preventDefault(); setError(''); setLoading(true)
    const err = await signIn(identifier, password)
    if (err) { setError(err.message); setLoading(false) } else navigate('/')
  }

  async function handleSignup(e) {
    e.preventDefault(); setError('')
    if (password !== confirm)   { setError('Passwords do not match'); return }
    if (password.length < 6)    { setError('Min 6 characters'); return }
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
        console.warn('Profile warn:', pErr.message)
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

  const btnStyle = (disabled) => ({
    width:'100%', padding:'13px', borderRadius:12, border:'none',
    background: disabled
      ? (isDark ? 'rgba(22,163,74,0.25)' : 'rgba(22,163,74,0.3)')
      : 'linear-gradient(135deg, #16a34a 0%, #15803d 50%, #166534 100%)',
    color:'#fff', fontSize:14, fontWeight:700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
    boxShadow: disabled ? 'none' : '0 4px 24px rgba(22,163,74,0.35),0 0 0 1px rgba(74,222,128,0.12)',
    transition:'all 0.2s',
  })

  return (
    <>
      <style>{STYLES}</style>

      <div style={{ minHeight:'100vh', background: bg, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'24px 16px', position:'relative', overflow:'hidden', transition:'background 0.3s' }}>

        {/* Grid overlay */}
        <div style={{ position:'fixed', inset:0, pointerEvents:'none',
          backgroundImage:`linear-gradient(${gridColor} 1px,transparent 1px),linear-gradient(90deg,${gridColor} 1px,transparent 1px)`,
          backgroundSize:'40px 40px',
        }}/>

        {/* Ambient blobs */}
        <div style={{ position:'fixed', inset:0, pointerEvents:'none' }}>
          <div style={{ position:'absolute', top:'5%', left:'0%', width:550, height:550,
            background:'radial-gradient(circle,rgba(22,163,74,0.15) 0%,transparent 65%)',
            borderRadius:'50%', filter:'blur(80px)', animation:'tyre-float 9s ease-in-out infinite' }}/>
          <div style={{ position:'absolute', bottom:'5%', right:'2%', width:450, height:450,
            background:'radial-gradient(circle,rgba(22,163,74,0.10) 0%,transparent 65%)',
            borderRadius:'50%', filter:'blur(70px)', animation:'tyre-float 11s ease-in-out infinite 2s' }}/>
          {/* Scan line */}
          <div style={{ position:'absolute', left:0, right:0, height:2,
            background:'linear-gradient(90deg,transparent,rgba(22,163,74,0.4),transparent)',
            animation:'tp-scan 8s ease-in-out infinite 1s' }}/>
        </div>

        <Particles />

        {/* Theme toggle */}
        <motion.button
          initial={{ opacity:0, scale:0.7 }}
          animate={{ opacity:1, scale:1 }}
          transition={{ delay:0.5 }}
          onClick={toggleTheme}
          title={isDark ? 'Light mode' : 'Dark mode'}
          style={{
            position:'fixed', top:18, right:18, zIndex:200,
            width:44, height:44, borderRadius:12,
            background: isDark ? 'rgba(22,163,74,0.12)' : 'rgba(22,163,74,0.12)',
            border:`1px solid ${isDark ? 'rgba(22,163,74,0.3)' : 'rgba(22,163,74,0.35)'}`,
            color: brandGreen,
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', backdropFilter:'blur(12px)',
            boxShadow:'0 4px 20px rgba(0,0,0,0.3)',
            transition:'all 0.25s',
          }}
          whileHover={{ scale:1.12, rotate:15 }}
          whileTap={{ scale:0.92 }}
        >
          <AnimatePresence mode="wait">
            <motion.div key={isDark?'moon':'sun'}
              initial={{ rotate:-90,opacity:0,scale:0.5 }}
              animate={{ rotate:0,opacity:1,scale:1 }}
              exit={{ rotate:90,opacity:0,scale:0.5 }}
              transition={{ duration:0.2 }}
            >
              {isDark ? <Moon size={18}/> : <Sun size={18}/>}
            </motion.div>
          </AnimatePresence>
        </motion.button>

        {/* ── Hero: single large truck tyre ── */}
        <motion.div
          initial={{ opacity:0, scale:0.7, y:20 }}
          animate={{ opacity:1, scale:1, y:0 }}
          transition={{ duration:0.7, ease:[0.175,0.885,0.32,1.275] }}
          style={{ marginBottom:20, position:'relative', animation:'tyre-glow-pulse 3s ease-in-out infinite' }}
        >
          <TruckTyre size={260} isDark={isDark}/>
        </motion.div>

        {/* Brand name */}
        <motion.div
          initial={{ opacity:0, y:10 }}
          animate={{ opacity:1, y:0 }}
          transition={{ delay:0.2, duration:0.4 }}
          style={{ textAlign:'center', marginBottom:28 }}
        >
          <h1 style={{ fontSize:34, fontWeight:900, color: textPrimary, letterSpacing:'-0.04em', margin:0, lineHeight:1 }}>
            Tyre<span style={{ color: brandGreen }}>Pulse</span>
          </h1>
          <p style={{ fontSize:12, color: textMuted, marginTop:6, letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:500 }}>
            Fleet Intelligence Platform
          </p>
          <div style={{ width:50, height:2, margin:'10px auto 0', background:`linear-gradient(90deg,transparent,${brandGreen},transparent)`, borderRadius:999 }}/>
        </motion.div>

        {/* Session expired */}
        <AnimatePresence>
          {sessionExpired && (
            <motion.div initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0}}
              style={{ width:'100%', maxWidth:420, display:'flex', alignItems:'center', gap:8,
                padding:'10px 14px', borderRadius:12, marginBottom:12, fontSize:13,
                color:'#fcd34d', background:'rgba(234,179,8,0.08)', border:'1px solid rgba(234,179,8,0.2)' }}>
              <AlertCircle size={14} style={{ flexShrink:0 }}/>
              Session expired after 30 minutes of inactivity.
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Login Card ── */}
        <motion.div
          initial={{ opacity:0, y:20, scale:0.97 }}
          animate={{ opacity:1, y:0, scale:1 }}
          transition={{ delay:0.15, duration:0.5, ease:[0.22,1,0.36,1] }}
          style={{ width:'100%', maxWidth:420, borderRadius:20, overflow:'hidden',
            background: cardBg, border:`1px solid ${cardBdr}`, boxShadow: cardShadow,
            backdropFilter:'blur(24px)', position:'relative', transition:'background 0.3s,border-color 0.3s' }}
        >
          {/* Top green line */}
          <div style={{ position:'absolute', top:0, left:'8%', right:'8%', height:1.5,
            background:`linear-gradient(90deg,transparent,${brandGreen},transparent)`, opacity:0.7 }}/>

          <div style={{ padding:'26px 26px' }}>
            {/* Tabs */}
            {!forgotMode && (
              <div style={{ display:'flex', marginBottom:22, borderBottom:`1px solid ${isDark?'rgba(255,255,255,0.06)':'rgba(22,163,74,0.12)'}` }}>
                {[['login','Sign In'],['signup','Create Account']].map(([val,label])=>(
                  <button key={val} onClick={()=>switchTab(val)} style={{
                    flex:1, padding:'10px 0', fontSize:13, fontWeight:600,
                    border:'none', borderBottom:`2px solid ${tab===val?tabActiveBdr:'transparent'}`,
                    marginBottom:-1, background:'transparent', cursor:'pointer', transition:'all 0.2s',
                    color: tab===val ? tabActiveText : tabInactiveText,
                    textShadow: tab===val && isDark ? '0 0 16px rgba(74,222,128,0.5)' : 'none',
                  }}>{label}</button>
                ))}
              </div>
            )}

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto',marginBottom:16}} exit={{opacity:0,height:0}}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderRadius:10,
                    fontSize:13, color:'#fca5a5', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)' }}>
                  <AlertCircle size={14} style={{flexShrink:0}}/>{error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── SIGN IN ── */}
            {tab==='login' && !forgotMode && (
              <motion.form key="login" initial={{opacity:0,x:10}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-10}}
                transition={{duration:0.2}} onSubmit={handleLogin} style={{display:'flex',flexDirection:'column',gap:16}}>

                {/* ID mode pills */}
                <div>
                  <div style={labelSt}>Sign in with</div>
                  <div style={{ display:'flex', gap:5, padding:4, background: pillBg, border:`1px solid ${pillBdr}`, borderRadius:12 }}>
                    {ID_MODES.map(({value,label,icon:Icon})=>(
                      <button key={value} type="button" onClick={()=>switchIdMode(value)} style={{
                        flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                        padding:'7px 0', borderRadius:8, fontSize:12, fontWeight:600, border:'none',
                        background: idMode===value
                          ? (isDark?'rgba(22,163,74,0.18)':'rgba(22,163,74,0.12)')
                          : 'transparent',
                        color: idMode===value ? brandGreen : textMuted,
                        cursor:'pointer', transition:'all 0.2s',
                        boxShadow: idMode===value ? `0 0 10px rgba(22,163,74,0.12)` : 'none',
                        textShadow: idMode===value&&isDark ? '0 0 10px rgba(74,222,128,0.4)' : 'none',
                        outline: idMode===value ? `1px solid rgba(22,163,74,0.25)` : 'none',
                      }}>
                        <Icon size={12}/>{label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Identifier */}
                <AnimatePresence mode="wait">
                  <motion.div key={idMode} initial={{opacity:0,x:8}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-8}} transition={{duration:0.15}}>
                    <div style={labelSt}>{currentMode.label}</div>
                    <div style={{position:'relative'}}>
                      <div style={{ position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',
                        color:focused==='id'?brandGreen:'rgba(255,255,255,0.25)', transition:'color 0.2s', pointerEvents:'none' }}>
                        <currentMode.icon size={15}/>
                      </div>
                      <input type={currentMode.type} style={{...inputSt('id'),paddingLeft:38}}
                        placeholder={currentMode.placeholder} value={identifier}
                        onChange={e=>setIdentifier(e.target.value)}
                        onFocus={()=>setFocused('id')} onBlur={()=>setFocused(null)}
                        required autoFocus/>
                    </div>
                  </motion.div>
                </AnimatePresence>

                {/* Password */}
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                    <span style={labelSt}>Password</span>
                    <button type="button" onClick={()=>{setForgotMode(true);setForgotEmail(idMode==='email'?identifier:'');setError('')}}
                      style={{fontSize:11,color:brandGreenDim,background:'none',border:'none',cursor:'pointer',padding:0}}>
                      Forgot password?
                    </button>
                  </div>
                  <div style={{position:'relative'}}>
                    <input type={showLoginPw?'text':'password'} style={{...inputSt('pw'),paddingRight:42}}
                      placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)}
                      onFocus={()=>setFocused('pw')} onBlur={()=>setFocused(null)} required/>
                    <button type="button" onClick={()=>setShowLoginPw(v=>!v)}
                      style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',
                        color:isDark?'rgba(255,255,255,0.3)':'rgba(0,0,0,0.3)',background:'none',border:'none',cursor:'pointer',padding:4}}>
                      {showLoginPw?<EyeOff size={15}/>:<Eye size={15}/>}
                    </button>
                  </div>
                </div>

                <button type="submit" disabled={loading} className="tp-btn-shine" style={btnStyle(loading)}
                  onMouseEnter={e=>{if(!loading){e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 8px 32px rgba(22,163,74,0.5)'}}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';if(!loading)e.currentTarget.style.boxShadow='0 4px 24px rgba(22,163,74,0.35)'}}>
                  {loading?<Loader2 size={16} className="animate-spin"/>:<Zap size={16}/>}
                  {loading?'Signing in…':'Sign In'}
                  {!loading&&<ArrowRight size={15}/>}
                </button>
              </motion.form>
            )}

            {/* ── FORGOT PASSWORD ── */}
            {forgotMode && !forgotSent && (
              <motion.form key="forgot" initial={{opacity:0,x:10}} animate={{opacity:1,x:0}} transition={{duration:0.2}}
                onSubmit={handleForgot} style={{display:'flex',flexDirection:'column',gap:16}}>
                <div>
                  <button type="button" onClick={()=>{setForgotMode(false);setError('')}}
                    style={{fontSize:12,color:brandGreenDim,background:'none',border:'none',cursor:'pointer',padding:0,marginBottom:10}}>
                    ← Back to sign in
                  </button>
                  <div style={{fontSize:18,fontWeight:700,color:textPrimary,marginBottom:4}}>Reset Password</div>
                  <div style={{fontSize:13,color:textMuted}}>We'll send a reset link to your email.</div>
                </div>
                <div>
                  <div style={labelSt}>Email address</div>
                  <input type="email" style={inputSt('forgot')} placeholder="you@example.com"
                    value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)}
                    onFocus={()=>setFocused('forgot')} onBlur={()=>setFocused(null)} required autoFocus/>
                </div>
                <button type="submit" disabled={forgotLoading} className="tp-btn-shine" style={btnStyle(forgotLoading)}>
                  {forgotLoading?<Loader2 size={16} className="animate-spin"/>:<Mail size={16}/>}
                  {forgotLoading?'Sending…':'Send Reset Link'}
                </button>
              </motion.form>
            )}

            {forgotMode && forgotSent && (
              <motion.div initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}} style={{textAlign:'center',padding:'16px 0'}}>
                <div style={{width:64,height:64,borderRadius:18,margin:'0 auto 16px',
                  background:'rgba(22,163,74,0.1)',border:'1px solid rgba(22,163,74,0.25)',
                  display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 0 30px rgba(22,163,74,0.2)'}}>
                  <CheckCircle2 size={30} style={{color:brandGreen}}/>
                </div>
                <div style={{fontSize:17,fontWeight:700,color:textPrimary,marginBottom:6}}>Reset link sent!</div>
                <div style={{fontSize:13,color:textMuted,lineHeight:1.6}}>Check your inbox.</div>
                <button onClick={()=>{setForgotMode(false);setForgotSent(false)}} style={{...btnStyle(false),marginTop:20}}>Back to Sign In</button>
              </motion.div>
            )}

            {/* ── CREATE ACCOUNT ── */}
            {tab==='signup' && !signupDone && (
              <motion.form key="signup" initial={{opacity:0,x:10}} animate={{opacity:1,x:0}} transition={{duration:0.2}}
                onSubmit={handleSignup} style={{display:'flex',flexDirection:'column',gap:13}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  {[
                    {f:'fname',label:'Full Name',placeholder:'Your name',val:fullName,set:setFullName,req:false},
                    {f:'uname',label:'Username *',placeholder:'username',val:signupUsername,set:setSignupUsername,req:true},
                  ].map(({f,label,placeholder,val,set,req})=>(
                    <div key={f}>
                      <div style={labelSt}>{label}</div>
                      <input style={inputSt(f)} placeholder={placeholder} value={val}
                        onChange={e=>set(e.target.value)} onFocus={()=>setFocused(f)} onBlur={()=>setFocused(null)} required={req}/>
                    </div>
                  ))}
                </div>
                {[
                  {f:'empid',label:'Employee ID',placeholder:'EMP-1042 (optional)',val:employeeId,set:setEmployeeId,type:'text',req:false},
                  {f:'semail',label:'Email *',placeholder:'you@company.com',val:signupEmail,set:setSignupEmail,type:'email',req:true},
                ].map(({f,label,placeholder,val,set,type,req})=>(
                  <div key={f}>
                    <div style={labelSt}>{label}</div>
                    <input type={type||'text'} style={inputSt(f)} placeholder={placeholder} value={val}
                      onChange={e=>set(e.target.value)} onFocus={()=>setFocused(f)} onBlur={()=>setFocused(null)} required={req}/>
                  </div>
                ))}
                {[
                  {f:'spw',label:'Password *',show:showSignupPw,setShow:setShowSignupPw,val:password,set:setPassword},
                  {f:'scpw',label:'Confirm Password *',show:showConfirmPw,setShow:setShowConfirmPw,val:confirm,set:setConfirm},
                ].map(({f,label,show,setShow,val,set})=>(
                  <div key={f}>
                    <div style={labelSt}>{label}</div>
                    <div style={{position:'relative'}}>
                      <input type={show?'text':'password'} style={{...inputSt(f),paddingRight:42}}
                        placeholder="••••••••" value={val} onChange={e=>set(e.target.value)}
                        onFocus={()=>setFocused(f)} onBlur={()=>setFocused(null)} required/>
                      <button type="button" onClick={()=>setShow(v=>!v)}
                        style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',
                          color:isDark?'rgba(255,255,255,0.3)':'rgba(0,0,0,0.3)',background:'none',border:'none',cursor:'pointer',padding:4}}>
                        {show?<EyeOff size={15}/>:<Eye size={15}/>}
                      </button>
                    </div>
                  </div>
                ))}
                <div style={{padding:'9px 12px',borderRadius:9,fontSize:12,color:textMuted,lineHeight:1.5,
                  background:isDark?'rgba(255,255,255,0.02)':'rgba(22,163,74,0.04)',
                  border:`1px solid ${isDark?'rgba(255,255,255,0.05)':'rgba(22,163,74,0.1)'}`}}>
                  New accounts require admin approval before access is granted.
                </div>
                <button type="submit" disabled={loading} className="tp-btn-shine" style={btnStyle(loading)}>
                  {loading?<Loader2 size={16} className="animate-spin"/>:null}
                  {loading?'Creating account…':'Create Account'}
                  {!loading&&<ArrowRight size={15}/>}
                </button>
              </motion.form>
            )}

            {tab==='signup' && signupDone && (
              <motion.div initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}} style={{textAlign:'center',padding:'16px 0'}}>
                <div style={{fontSize:40,marginBottom:12}}>⏳</div>
                <div style={{fontSize:17,fontWeight:700,color:textPrimary,marginBottom:6}}>Account Submitted!</div>
                <div style={{fontSize:13,color:textMuted,lineHeight:1.6}}>Pending admin approval. You'll be notified once activated.</div>
                <button onClick={()=>switchTab('login')} style={{...btnStyle(false),marginTop:20}}>Back to Sign In</button>
              </motion.div>
            )}
          </div>
        </motion.div>

        <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.6}}
          style={{textAlign:'center',fontSize:11,color:textDim,marginTop:20,letterSpacing:'0.05em'}}>
          © 2026 TyrePulse · Built by Shahzeb Rahman
        </motion.p>
      </div>
    </>
  )
}
