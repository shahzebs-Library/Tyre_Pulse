import { describe, expect, it } from 'vitest'
import { authorizeTool, sourceForTool, TOOL_POLICY } from '../../supabase/functions/ai-orchestrator/policy.ts'

describe('AI orchestrator tool policy', () => {
  it('registers the current tool catalog as read-only', () => {
    expect(Object.keys(TOOL_POLICY)).toEqual(expect.arrayContaining([
      'get_exec_digest', 'search_knowledge_base', 'count_records', 'list_recent_events',
    ]))
    expect(Object.values(TOOL_POLICY).every(policy => policy.risk === 'read')).toBe(true)
  })

  it('denies unregistered model-requested tools', () => {
    expect(authorizeTool('delete_vehicle', [], 'call-1')).toEqual({
      allowed: false,
      reason: 'Tool is not registered in the server policy',
    })
  })

  it('allows registered read tools and emits stable provenance metadata', () => {
    expect(authorizeTool('count_records').allowed).toBe(true)
    expect(sourceForTool('count_records', true, 2)).toEqual({
      id: 'source-2', tool: 'count_records', label: 'Operational record count', status: 'grounded',
    })
  })
})
