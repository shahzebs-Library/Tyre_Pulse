import { FAQS } from './help/faqs'

const TOPIC_PATHS = {
  Checklists: ['/checklists', '/my-checklists'], Inspections: ['/inspections'], Accidents: ['/accidents'],
  'Analytics & KPIs': ['/analytics', '/cpk-intelligence', '/predictive-maintenance'],
  'Data & Imports': ['/upload', '/erp-sync', '/data-cleaning'],
  'Tyres & Workshop': ['/tyres', '/serial-tracker', '/work-orders'],
}
const ARTICLE_PATHS = { 'an-predict': ['/predictive-maintenance'], 'da-import': ['/upload', '/erp-sync'], 'da-quality': ['/data-cleaning'] }
export const HELP_GUIDES = [
  { id: 'inspections', paths: ['/inspections', '/checklists', '/my-checklists'], title: 'inspections', category: 'Inspections|Checklists' },
  { id: 'tyres', paths: ['/tyres', '/serial-tracker'], title: 'tyres', category: 'Tyre Management' },
  { id: 'workshop', paths: ['/work-orders'], title: 'workshop', category: 'Workshop' },
  { id: 'account', paths: [], title: 'account', category: 'Account' },
]
const EXTRA_FAQS = [
  { id: 'ty-history', category: 'Tyre Management', q: 'How do I find a tyre and its recorded history?', a: 'Open Tyre Records and search for its serial number. Serial Tracker shows recorded fitments, movements and current location when you have access to that module.', keywords: ['tyre', 'serial', 'history'], paths: ['/tyres', '/serial-tracker'] },
  { id: 'wo-progress', category: 'Workshop', q: 'How do I follow workshop work?', a: 'Open Work Orders to review the jobs available to you. Open a job to see its recorded status, labour, parts and repair updates. Available actions depend on your permissions.', keywords: ['workshop', 'job', 'work order'], paths: ['/work-orders'] },
  { id: 'in-sync', category: 'Inspections', q: 'What should I do if an inspection will not sync?', a: 'Check your connection and the pending or failed sync indicator. Retry when online. Keep unsent records on the device. If the problem continues, use Report a problem and describe the affected inspection.', keywords: ['offline', 'sync', 'pending'], paths: ['/inspections'] },
]
export function scopedHelp(paths = []) {
  const allowed = new Set(paths)
  const canSee = choices => !choices?.length || choices.some(path => allowed.has(path))
  return [...FAQS, ...EXTRA_FAQS].filter(faq => canSee(faq.paths || ARTICLE_PATHS[faq.id] || TOPIC_PATHS[faq.category]))
}
export function availableHelpGuides(paths = []) {
  const allowed = new Set(paths)
  return HELP_GUIDES.filter(guide => !guide.paths.length || guide.paths.some(path => allowed.has(path)))
}
export function recentHelpRequests(tickets = [], problems = []) {
  return [
    ...tickets.map(row => ({ id: `ticket:${row.id}`, source: 'ticket', title: row.subject, status: row.status, updated: row.updated_at || row.created_at })),
    ...problems.map(row => ({ id: `problem:${row.id}`, source: 'problem', title: row.description, status: row.status, updated: row.updated_at || row.created_at })),
  ].sort((a, b) => (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0)).slice(0, 3)
}
