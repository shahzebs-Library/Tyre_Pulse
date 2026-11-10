export type ToolRisk = 'read' | 'consequential'
export type ToolPolicy = { risk: ToolRisk; requiresApproval: boolean; sourceLabel: string }

// Deny by default: model-visible tools must also be registered here.
// Every registered tool is read-only. There is deliberately no write tool:
// the assistant recommends, a person acts through the normal screens.
export const TOOL_POLICY: Record<string, ToolPolicy> = {
  get_fleet_overview: { risk: 'read', requiresApproval: false, sourceLabel: 'Fleet KPI overview' },
  get_cost_cpk_overview: { risk: 'read', requiresApproval: false, sourceLabel: 'Expense and CPK overview' },
  get_fleet_cpk: { risk: 'read', requiresApproval: false, sourceLabel: 'Weighted fleet CPK' },
  get_brand_size_cpk: { risk: 'read', requiresApproval: false, sourceLabel: 'Brand and size lifetime CPK' },
  get_tyre_running_life: { risk: 'read', requiresApproval: false, sourceLabel: 'Tyre running and remaining life' },
  get_tyre_consumption: { risk: 'read', requiresApproval: false, sourceLabel: 'Tyre consumption' },
  get_tyre_evidence_audit: { risk: 'read', requiresApproval: false, sourceLabel: 'Tyre evidence audit (2025 onward)' },
  get_tyre_exceptions: { risk: 'read', requiresApproval: false, sourceLabel: 'Tyre data exceptions' },
  get_maintenance_snapshot: { risk: 'read', requiresApproval: false, sourceLabel: 'Maintenance snapshot' },
  get_tyre_cost_audit: { risk: 'read', requiresApproval: false, sourceLabel: 'Tyre cost audit (dry run)' },
  get_data_trust_overview: { risk: 'read', requiresApproval: false, sourceLabel: 'Data trust scores' },
  search_knowledge_base: { risk: 'read', requiresApproval: false, sourceLabel: 'Knowledge base' },
  count_records: { risk: 'read', requiresApproval: false, sourceLabel: 'Operational record count' },
  list_recent_events: { risk: 'read', requiresApproval: false, sourceLabel: 'Domain event feed' },
}

/**
 * @param allowedForRequest tools the active agents may use (server-computed);
 *   a model asking for a registered tool outside its agents is refused.
 */
export function authorizeTool(name: string, approvedToolCallIds: string[] = [], toolCallId = '', allowedForRequest: string[] | null = null) {
  const policy = TOOL_POLICY[name]
  if (!policy) return { allowed: false, reason: 'Tool is not registered in the server policy' }
  if (allowedForRequest && !allowedForRequest.includes(name)) {
    return { allowed: false, reason: 'Tool is not available to the active agents' }
  }
  // A consequential tool is never executed from the assistant loop. The ids in
  // approved_tool_call_ids come from the browser, so they cannot prove that a
  // person approved anything; a real approval must be a server-side record.
  // Kept as a hard refusal until such a record exists (no tool is consequential today).
  if (policy.risk !== 'read') {
    void approvedToolCallIds; void toolCallId
    return { allowed: false, reason: 'Human approval is required for this consequential action' }
  }
  return { allowed: true, policy }
}

export function sourceForTool(name: string, ok: boolean, sequence: number) {
  const policy = TOOL_POLICY[name]
  return { id: `source-${sequence}`, tool: name, label: policy?.sourceLabel ?? name, status: ok ? 'grounded' : 'unavailable' }
}
