const TERMINAL_WORK_ORDER_STATUSES = new Set([
  'closed',
  'complete',
  'completed',
  'cancelled',
  'canceled',
  'resolved',
  'rejected',
  'void',
])

export function normaliseWorkOrderStatus(status) {
  return String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function isTerminalWorkOrderStatus(status) {
  return TERMINAL_WORK_ORDER_STATUSES.has(normaliseWorkOrderStatus(status))
}

export function isOverdueWorkOrder(workOrder, selectedDate) {
  if (!workOrder?.scheduled_date || !selectedDate) return false
  if (isTerminalWorkOrderStatus(workOrder.status)) return false
  return String(workOrder.scheduled_date).slice(0, 10) < selectedDate
}
