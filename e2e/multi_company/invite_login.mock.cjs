// Browser checks for the multi-company client (PR #546) against MOCKED Supabase
// responses. No database, no network: every call to the fake Supabase host is
// answered by page.route below.
//
// Start the app first (any free port):
//   VITE_SUPABASE_URL=http://mock-supabase.test VITE_SUPABASE_ANON_KEY=<anon-shaped JWT> \
//     npx vite --port 5287 --strictPort --host 127.0.0.1
// then:  BASE=http://127.0.0.1:5287 node e2e/multi_company/invite_login.mock.cjs [shots-dir]
const { chromium } = require('playwright')

const BASE = process.env.BASE || 'http://127.0.0.1:5287'
const SHOTS = process.argv[2] || null
const SUPA = 'http://mock-supabase.test'
const TOKEN = 'b'.repeat(64)
const OK_PREVIEW = { ok: true, organisation_name: 'Beta Haulage LLC', company_code: 'BETA', role: 'Driver', email_required: false, expires_at: '2999-01-01T00:00:00Z' }

const results = []
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? 'ok' : 'not ok'} - ${name}${cond ? '' : ` | ${detail}`}`)
}

/** Answer every call to the mock Supabase host. `rpc` maps an RPC name to a body or a function. */
async function mock(page, { rpc = {}, signup, profile } = {}) {
  const calls = []
  await page.route(`${SUPA}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    calls.push({ method: req.method(), path: url.pathname, body: req.postData() })
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/)
    if (m) {
      const h = rpc[m[1]]
      if (h === undefined) return json(404, { code: 'PGRST202', message: 'not found' })
      return json(200, typeof h === 'function' ? h(calls) : h)
    }
    if (url.pathname === '/auth/v1/signup') return json(signup?.status || 200, signup?.body || {})
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
    if (url.pathname.startsWith('/rest/v1/profiles')) return json(200, profile === undefined ? [] : profile)
    return json(200, [])
  })
  return calls
}

async function fillInvite(page) {
  await page.getByTestId('invite-form').waitFor({ timeout: 90000 })
  await page.getByLabel('Username').fill('ali.k')
  await page.getByLabel('Password', { exact: true }).fill('longenough1')
  await page.getByLabel('Confirm password').fill('longenough1')
  await page.getByRole('button', { name: 'Create my account' }).click()
}

;(async () => {
  const browser = await chromium.launch({ args: ['--no-proxy-server'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  const ctx = async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } })
    // Nothing leaves the machine: fonts, analytics, CDNs are refused.
    await c.route((url) => !url.href.startsWith(BASE) && !url.href.startsWith(SUPA), (r) => r.abort())
    return c
  }

  // 1. Login hint gated on the public config.
  for (const [mode, expectHint] of [['true', false], ['false', true], [undefined, false]]) {
    const c = await ctx(); const page = await c.newPage()
    await mock(page, { rpc: { get_public_config: mode === undefined ? {} : { single_tenant_mode: mode } } })
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.locator('input[type=password]').first().waitFor({ timeout: 90000 })
    await page.waitForTimeout(800)
    const hint = await page.locator('#login-id-hint').count()
    check(`login: company-code hint ${expectHint ? 'shown' : 'hidden'} when single_tenant_mode=${mode ?? 'missing'}`, (hint > 0) === expectHint, `hint count ${hint}`)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/login_stm_${mode ?? 'missing'}.png` })
    await c.close()
  }

  // 2. Invite: joined (session + own row in the company).
  {
    const c = await ctx(); const page = await c.newPage()
    const calls = await mock(page, {
      rpc: { get_invitation_preview: OK_PREVIEW, get_public_config: {} },
      signup: { body: { access_token: 'a.b.c', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user: { id: '11111111-1111-4111-8111-111111111111', email: 'ali.k+beta@users.tyrepulse.app' } } },
      profile: { org_id: 'bbbbbbbb-0000-4000-8000-000000000002', approved: true },
    })
    await page.goto(`${BASE}/invite/${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await fillInvite(page)
    await page.getByTestId('invite-done').waitFor({ timeout: 15000 }).catch(() => {})
    check('invite: joined -> success screen with BETA/ali.k', (await page.getByTestId('invite-done').count()) === 1 && (await page.getByText('BETA/ali.k').count()) > 0)
    const su = calls.find((x) => x.path === '/auth/v1/signup')
    const body = su ? JSON.parse(su.body) : {}
    check('invite: sign-up carries the token and code, made-up address with the code', body?.data?.invite_token === TOKEN && body?.data?.company_code === 'BETA' && body?.email === 'ali.k+beta@users.tyrepulse.app', su?.body)
    check('invite: sign-up never sends a role / org / approval of its own', !('role' in (body?.data || {})) && !('org_id' in (body?.data || {})) && !('approved' in (body?.data || {})))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/invite_joined.png` })
    await c.close()
  }

  // 3. Invite: GoTrue said yes, but the server dropped the invitation (production before TEN-9e).
  {
    const c = await ctx(); const page = await c.newPage()
    await mock(page, {
      rpc: { get_invitation_preview: OK_PREVIEW, get_public_config: {} },
      signup: { body: { access_token: 'a.b.c', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user: { id: '22222222-2222-4222-8222-222222222222' } } },
      profile: [],
    })
    await page.goto(`${BASE}/invite/${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await fillInvite(page)
    await page.getByText(/could not be applied/).waitFor({ timeout: 15000 }).catch(() => {})
    check('invite: an orphaned sign-up is reported, not called a success',
      (await page.getByText(/could not be applied/).count()) > 0 && (await page.getByTestId('invite-done').count()) === 0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/invite_not_joined.png` })
    await c.close()
  }

  // 4. Invite: refused sign-up (TEN-9e) while the link was cancelled in the meantime.
  {
    const c = await ctx(); const page = await c.newPage()
    // The link reads ok until the sign-up was sent, then cancelled.
    await mock(page, {
      rpc: { get_invitation_preview: (calls) => (calls.some((x) => x.path === '/auth/v1/signup') ? { ok: false, reason: 'revoked' } : OK_PREVIEW), get_public_config: {} },
      signup: { status: 500, body: { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' } },
    })
    await page.goto(`${BASE}/invite/${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await fillInvite(page)
    await page.getByTestId('invite-invalid').waitFor({ timeout: 15000 }).catch(() => {})
    check('invite: refused + cancelled meanwhile -> cancelled-link screen', (await page.getByTestId('invite-invalid').count()) === 1)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/invite_refused_revoked.png` })
    await c.close()
  }

  // 5. Arabic / RTL invite page renders the company and code.
  {
    const c = await ctx(); const page = await c.newPage()
    await page.addInitScript(() => { try { localStorage.setItem('tp_lang', 'ar') } catch { /* ignore */ } })
    await mock(page, { rpc: { get_invitation_preview: OK_PREVIEW, get_public_config: {} } })
    await page.goto(`${BASE}/invite/${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.getByTestId('invite-form').waitFor({ timeout: 15000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('invite: no horizontal overflow at 390px', overflow <= 0, `overflow ${overflow}px`)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/invite_form_390.png` })
    await c.close()
  }

  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`multi-company browser (mocked): ${results.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
