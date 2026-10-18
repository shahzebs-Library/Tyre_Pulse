/** Presentation-only filtering/grouping. Never infer record identity from copy or asset number. */
export function filterInboxNotifications(notifications, filter = 'inbox', query = '') {
  const search = query.trim().toLocaleLowerCase()
  return notifications.filter(n => {
    if (filter === 'approvals' && n.type !== 'approval') return false
    if (filter === 'critical' && n.severity !== 'Critical') return false
    if (filter === 'read' && !n.read) return false
    return !search || [n.title, n.message, n.assetNo, n.entityType]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(search))
  })
}

export function groupInboxUpdates(notifications) {
  const groups = new Map()
  const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 }
  const timestamp = n => new Date(n.timestamp).getTime() || 0
  const sorted = [...notifications].sort((a, b) => timestamp(b) - timestamp(a))
  for (const n of sorted) {
    // Same vehicle does not mean same inspection. Without a real entity ID,
    // keep each notification separate; no title/message heuristics.
    const key = n.entityType && n.entityId && n.type
      ? JSON.stringify(['record', n.type, n.entityType, n.entityId])
      : JSON.stringify(['notification', n.id])
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { ...n, id: key, items: [n] })
    } else if (!group.items.some(item => item.id === n.id)) {
      group.items.push(n)
      group.read = group.read && n.read
      if ((rank[n.severity] ?? 3) < (rank[group.severity] ?? 3)) group.severity = n.severity
    }
  }
  return [...groups.values()]
}
