import { describe, expect, it } from 'vitest'
import { assertPublicEnv } from '../lib/publicEnvSecurity'

const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role }))}.signature`

describe('public environment security', () => {
  it('accepts public publishable keys and legacy anon JWTs', () => {
    expect(() => assertPublicEnv({ VITE_SUPABASE_ANON_KEY: jwt('anon') })).not.toThrow()
    expect(() => assertPublicEnv({ VITE_SUPABASE_ANON_KEY: 'sb_publishable_public' })).not.toThrow()
  })
  it.each(['service_role', 'authenticated'])('rejects encoded %s JWTs in public variables', role => {
    expect(() => assertPublicEnv({ VITE_SUPABASE_ANON_KEY: jwt(role) })).toThrow('VITE_SUPABASE_ANON_KEY')
  })
  it('rejects new secret keys under a misleading public variable name', () => {
    expect(() => assertPublicEnv({ VITE_SUPABASE_ANON_KEY: 'sb_secret_sensitive' })).toThrow()
    expect(() => assertPublicEnv({ VITE_SUPABASE_ANON_KEY: '  sb_secret_sensitive\n' })).toThrow()
  })
  it('rejects forbidden variable names without printing their values', () => {
    try {
      assertPublicEnv({ VITE_OPENAI_API_KEY: 'sensitive-value' })
      expect.unreachable()
    } catch (error) {
      expect(error.message).toContain('VITE_OPENAI_API_KEY')
      expect(error.message).not.toContain('sensitive-value')
    }
  })
  it('does not reject server-only environment variables', () => {
    expect(() => assertPublicEnv({ SUPABASE_SERVICE_ROLE_KEY: jwt('service_role') })).not.toThrow()
  })
})
