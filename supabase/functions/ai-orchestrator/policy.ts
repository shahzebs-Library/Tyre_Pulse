export type ToolRisk = 'read' | 'consequential'
export type ToolPolicy = { risk: ToolRisk; requiresApproval: boolean; sourceLabel: string }

// Deny by default: model-visible tools must also be registered here.
export const TOOL_POLICY: Record<string, ToolPolicy> = {
  get_exec_digest: { risk: 'read', requiresApproval: false, sourceLabel: 'Executive KPI digest' },
  search_knowledge_base: { risk: 'read', requiresApproval: false, sourceLabel: 'Knowledge base' },
  count_records: { risk: 'read', requiresApproval: false, sourceLabel: 'Operational record count' },
  list_recent_events: { risk: 'read', requiresApproval: false, sourceLabel: 'Domain event feed' },
}

export function authorizeTool(name: string, approvedToolCallIds: string[] = [], toolCallId = '') {
  const policy = TOOL_POLICY[name]
  if (!policy) return { allowed: false, reason: 'Tool is not registered in the server policy' }
  if (policy.risk === 'consequential' && (!policy.requiresApproval || !approvedToolCallIds.includes(toolCallId))) {
    return { allowed: false, reason: 'Human approval is required for this consequential action' }
  }
  return { allowed: true, policy }
}

export function sourceForTool(name: string, ok: boolean, sequence: number) {
  const policy = TOOL_POLICY[name]
  return { id: `source-${sequence}`, tool: name, label: policy?.sourceLabel ?? name, status: ok ? 'grounded' : 'unavailable' }
}
