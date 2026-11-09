import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = path => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')

describe('password recovery security contracts', () => {
  const edge = read('supabase/functions/account-recovery/index.ts')
  const migration = read('supabase/migrations/20260830134159_password_recovery_channels.sql')

  it('stores only HMAC hashes and keeps challenge rows off the Data API roles', () => {
    expect(migration).toContain('destination_hash text not null')
    expect(migration).toContain('code_hash text not null')
    expect(migration).toContain('force row level security')
    expect(migration).toContain('revoke all on table public.password_recovery_challenges from public, anon, authenticated')
    expect(migration).toContain('guard_recovery_contact_columns')
    expect(migration).toContain("request_role <> 'service_role'")
    expect(migration).not.toMatch(/\bcode\s+text\b/)
  })

  it('uses bounded expiry, attempts, requester limits and one-use consumption', () => {
    expect(edge).toContain('const CODE_TTL_MS = 10 * 60_000')
    // Request and attempt limits are enforced atomically in the database
    // (20261108143000), so racing requests cannot slip past them.
    const limits = read('supabase/migrations/20261108143000_atomic_recovery_limits.sql')
    expect(edge).toContain("admin.rpc('reserve_recovery_challenge'")
    expect(edge).toContain("admin.rpc('claim_recovery_attempt'")
    expect(limits).toContain("interval '15 minutes'")
    expect(limits).toContain('if v_count >= 5 then return false; end if;')
    expect(limits).toContain('attempts < 5')
    expect(limits).toContain('or destination_hash = v_destination')
    expect(edge).toContain(".is('consumed_at', null)")
    expect(edge).toContain("'Cache-Control', 'no-store, max-age=0'")
    expect(edge).toContain("'Referrer-Policy', 'no-referrer'")
  })

  it('does not reveal whether a public recovery destination exists', () => {
    expect(edge).toContain('Identical public response for known, unknown, unverified, locked and')
    expect(edge).toContain('user_id: eligible ? profile.id : null')
    expect(edge).toContain('return noStore(jsonResponse(req, { accepted: true, challengeId }, 202))')
  })

  it('requires verified contacts and creates a Supabase recovery link only after OTP verification', () => {
    expect(edge).toContain('Boolean(profile?.[verifiedColumn])')
    expect(edge).toContain("type: 'recovery'")
    expect(edge).toContain('actionLink: link.properties.action_link')
  })

  it('revokes all sessions after the password changes', () => {
    const reset = read('src/pages/ResetPassword.jsx')
    expect(reset).toContain("supabase.auth.signOut({ scope: 'global' })")
  })

  it('offers both enrollment channels in Settings and both recovery channels at login', () => {
    const settings = read('src/pages/Settings.jsx')
    const login = read('src/pages/Login.jsx')
    expect(settings).toContain('<RecoveryContactsCard />')
    expect(settings).toContain("channel: 'email'")
    expect(settings).toContain("channel: 'sms'")
    expect(login).toContain("['email', Mail, 'Email']")
    expect(login).toContain("['sms', Phone, 'Mobile SMS']")
  })
})
