// Hosted-staging CAPTCHA test matrix: direct calls to Supabase Auth (GoTrue), the way a
// script would attack it. HOSTED STAGING ONLY - refuses the production project.
//
// Uses Cloudflare Turnstile's documented TEST secret keys, switched through the Supabase
// Management API between phases, plus the documented dummy token:
//   1x0000000000000000000000000000000AA  always passes
//   2x0000000000000000000000000000000AA  always fails
//   3x0000000000000000000000000000000AA  answers "token already spent" (replay)
//   dummy token accepted by test secrets: XXXX.DUMMY.TOKEN.XXXX
//
// Env (all required):
//   STAGING_URL            https://<staging-ref>.supabase.co
//   STAGING_ANON_KEY       the staging project's publishable/anon key
//   STAGING_REF            the staging project ref
//   SUPABASE_ACCESS_TOKEN  a personal access token able to PATCH that project's auth config
//   TEST_EMAIL, TEST_PASSWORD  a confirmed staging test account
// Run:  node scripts/auth-staging/captcha_matrix.mjs
// At the end CAPTCHA is switched OFF again on the staging project.

const PROD_REF = 'jhssdmeruxtrlqnwfksc'
const env = (k) => { const v = process.env[k]; if (!v) { console.error(`missing ${k}`); process.exit(2) } return v }
const URL_ = env('STAGING_URL').replace(/\/$/, ''), ANON = env('STAGING_ANON_KEY'), REF = env('STAGING_REF')
const PAT = env('SUPABASE_ACCESS_TOKEN'), EMAIL = env('TEST_EMAIL'), PW = env('TEST_PASSWORD')
if (REF === PROD_REF || URL_.includes(PROD_REF)) { console.error('Refusing: this is the production project'); process.exit(1) }

const DUMMY = 'XXXX.DUMMY.TOKEN.XXXX'
const SECRET = { pass: '1x0000000000000000000000000000000AA', fail: '2x0000000000000000000000000000000AA', spent: '3x0000000000000000000000000000000AA' }
const results = []
const check = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'ok' : 'not ok'} - ${name}${cond ? '' : ` | ${detail}`}`) }

async function setCaptcha(enabled, secret) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${PAT}`, 'content-type': 'application/json' },
    body: JSON.stringify(enabled
      ? { security_captcha_enabled: true, security_captcha_provider: 'turnstile', security_captcha_secret: secret }
      : { security_captcha_enabled: false }),
  })
  if (!r.ok) throw new Error(`config/auth PATCH ${r.status}: ${await r.text()}`)
  await new Promise((res) => setTimeout(res, 15000)) // let Auth pick up the new config
}
async function gotrue(path, body, token) {
  const r = await fetch(`${URL_}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, ...(token ? { gotrue_meta_security: { captcha_token: token } } : {}) }),
  })
  const text = await r.text()
  return { status: r.status, body: (() => { try { return JSON.parse(text) } catch { return text } })() }
}
const isCaptcha = (r) => r.status >= 400 && /captcha/i.test(JSON.stringify(r.body))
const signIn = (token, pw = PW) => gotrue('token?grant_type=password', { email: EMAIL, password: pw }, token)

try {
  console.log('## CAPTCHA off (baseline)')
  await setCaptcha(false)
  let r = await signIn()
  check('baseline: password sign-in without a token works', r.status === 200, JSON.stringify(r).slice(0, 300))
  const refresh = r.body?.refresh_token

  console.log('## CAPTCHA on, test secret that always passes')
  await setCaptcha(true, SECRET.pass)
  r = await signIn()
  check('direct API, NO token -> refused (captcha)', isCaptcha(r), JSON.stringify(r).slice(0, 300))
  r = await signIn(DUMMY)
  check('direct API, valid token -> signs in', r.status === 200, JSON.stringify(r).slice(0, 300))
  r = await signIn(DUMMY, 'definitely-wrong-password')
  check('valid token + wrong password -> invalid credentials (not captcha)', r.status === 400 && !isCaptcha(r), JSON.stringify(r).slice(0, 300))
  r = await gotrue('signup', { email: `captcha.probe.${Date.now()}@example.invalid`, password: 'Probe-pass-123!' })
  check('sign-up without token -> refused', isCaptcha(r), JSON.stringify(r).slice(0, 300))
  r = await gotrue('recover', { email: EMAIL })
  check('password reset email without token -> refused', isCaptcha(r), JSON.stringify(r).slice(0, 300))
  r = await gotrue('recover', { email: EMAIL }, DUMMY)
  check('password reset email with token -> accepted', r.status === 200, JSON.stringify(r).slice(0, 300))
  r = await gotrue('otp', { email: EMAIL, create_user: false })
  check('OTP / magic link request without token -> refused', isCaptcha(r), JSON.stringify(r).slice(0, 300))
  if (refresh) {
    r = await gotrue('token?grant_type=refresh_token', { refresh_token: refresh })
    check('token refresh needs no CAPTCHA (signed-in users stay signed in)', r.status === 200, JSON.stringify(r).slice(0, 300))
  }

  console.log('## CAPTCHA on, test secret that always fails (invalid token)')
  await setCaptcha(true, SECRET.fail)
  r = await signIn(DUMMY)
  check('invalid token -> refused', isCaptcha(r), JSON.stringify(r).slice(0, 300))

  console.log('## CAPTCHA on, test secret that reports a spent token (replay)')
  await setCaptcha(true, SECRET.spent)
  r = await signIn(DUMMY)
  check('reused token -> refused', isCaptcha(r), JSON.stringify(r).slice(0, 300))
} finally {
  try { await setCaptcha(false); console.log('## CAPTCHA switched off again on staging') } catch (e) { console.error('COULD NOT SWITCH CAPTCHA OFF:', e.message) }
}
const failed = results.filter((x) => !x).length
console.log(`hosted staging CAPTCHA matrix: ${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
