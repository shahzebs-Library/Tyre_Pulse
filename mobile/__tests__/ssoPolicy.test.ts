import { checkSsoPasswordLogin, interpretSsoCheck } from '../lib/ssoPolicy'

describe('interpretSsoCheck', () => {
  it('refuses only on an explicit allowed:false', () => {
    const r = interpretSsoCheck({ data: { allowed: false, reason: 'sso_required' }, error: null })
    expect(r).toEqual({ allowed: false, reason: 'sso_required', failedOpen: false })
  })
  it('allows when the server says allowed', () => {
    expect(interpretSsoCheck({ data: { allowed: true }, error: null }).allowed).toBe(true)
  })
  it('fails open on an RPC error, empty or malformed payload', () => {
    expect(interpretSsoCheck({ data: null, error: { code: '42883' } })).toMatchObject({ allowed: true, failedOpen: true })
    expect(interpretSsoCheck({ data: null, error: null })).toMatchObject({ allowed: true, failedOpen: true })
    expect(interpretSsoCheck({ data: 'nope', error: null })).toMatchObject({ allowed: true, failedOpen: true })
    expect(interpretSsoCheck(undefined)).toMatchObject({ allowed: true, failedOpen: true })
  })
})

describe('checkSsoPasswordLogin', () => {
  it('fails open when the rpc throws', async () => {
    const r = await checkSsoPasswordLogin(() => Promise.reject(new Error('network')))
    expect(r).toEqual({ allowed: true, reason: null, failedOpen: true })
  })
  it('passes the server decision through', async () => {
    const r = await checkSsoPasswordLogin(async () => ({ data: { allowed: false, reason: 'sso_required' }, error: null }))
    expect(r.allowed).toBe(false)
  })
})
