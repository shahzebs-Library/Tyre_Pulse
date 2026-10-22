/** Pure search + filter for the workforce assignment board. */
export const ASSIGNMENT_STATUSES = Object.freeze(['assigned','acknowledged','in_progress','blocked','submitted','verified','cancelled'])
export const ASSIGNMENT_PRIORITIES = Object.freeze(['low','normal','high','critical'])
export function filterAssignments(rows = [], { search = '', status = 'all', priority = 'all', employeeById = null } = {}) {
  const term = String(search || '').trim().toLocaleLowerCase()
  return (rows || []).filter(r => {
    if (status !== 'all' && r.status !== status) return false
    if (priority !== 'all' && r.priority !== priority) return false
    if (!term) return true
    const who = employeeById && employeeById.get ? employeeById.get(r.assigned_to) : null
    return [r.title, r.site, r.instructions, r.assigned_to, who?.full_name, who?.username, who?.employee_id]
      .some(v => String(v || '').toLocaleLowerCase().includes(term))
  })
}
