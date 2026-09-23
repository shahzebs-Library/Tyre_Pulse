export function isGovernedApproval(instance) {
  return instance?.governed === true || instance?.approval_matrix === true || instance?.context?.approval_matrix === true
    || !!instance?.approval_policy_id
}

/** A policy instance and its source document represent one pending approval. */
export function mergePendingApprovals(workflows = [], documents = []) {
  const byDocument = new Map(documents.map(row => [`${row.source}:${row.id}`, row]))
  const governedKeys = new Set()
  const rows = workflows.map(instance => {
    if (!isGovernedApproval(instance) || !['inspection', 'checklist'].includes(instance.entity_type)) {
      return { ...instance, source: 'workflow' }
    }
    const key = `${instance.entity_type}:${instance.entity_id}`
    governedKeys.add(key)
    const document = byDocument.get(key)
    return {
      ...(document || {
        id: instance.entity_id, source: instance.entity_type,
        title: instance.entity_label || instance.definition_name,
        subtitle: instance.current_step_name || '', country: instance.country, site: instance.site,
        created_at: instance.started_at, raw: { approval_status: instance.status },
      }),
      governed: true, workflowId: instance.id,
      routingStatus: instance.routing_status, currentStageName: instance.current_step_name,
    }
  })
  return [...rows, ...documents.filter(row => !governedKeys.has(`${row.source}:${row.id}`))]
}
