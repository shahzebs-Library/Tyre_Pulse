import { ALLOWED_LINK_HOSTS, BRAND } from './brand.ts'

// An email link is built from an entity TYPE and an id, never from free text a
// user or template supplied. Unknown types fall back to the home page.
const ENTITY_PATHS: Record<string, (id: string | null) => string> = {
  accident: id => (id ? `/accidents/${id}` : '/accidents'),
  work_order: id => (id ? `/work-orders?id=${id}` : '/work-orders'),
  workshop_intake: () => '/daily-ops/workshop?tab=intake&view=waiting',
  workshop_job: id => (id ? `/work-orders?id=${id}` : '/daily-ops/workshop'),
  inspection: id => (id ? `/inspections?view=${id}` : '/inspections'),
  checklist: id => (id ? `/checklists/submission/${id}` : '/checklists'),
  approval: () => '/approvals',
  action_item: () => '/action-center',
  driver_concern: () => '/driver-concerns',
  driver_workspace: () => '/driver-workspace',
  parts_request: () => '/parts-requests',
  signup: () => '/users',
  enquiry: () => '/',
  digest: () => '/',
  settings: () => '/settings?tab=email',
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export function entityPath(entityType: string | null | undefined, entityId: string | null | undefined): string {
  const build = ENTITY_PATHS[String(entityType || '').toLowerCase()]
  const id = entityId && SAFE_ID.test(String(entityId)) ? String(entityId) : null
  return build ? build(id) : '/'
}

/** Returns the absolute link if its host is allowlisted, else the site home. */
export function safeLink(url: string | null | undefined): string {
  try {
    const u = new URL(String(url || ''))
    if (u.protocol !== 'https:') return BRAND.site
    if (!ALLOWED_LINK_HOSTS.includes(u.hostname)) return BRAND.site
    return u.toString()
  } catch {
    return BRAND.site
  }
}

export function appLink(entityType: string | null | undefined, entityId: string | null | undefined, base: string = BRAND.site): string {
  return safeLink(`${safeLink(base).replace(/\/$/, '')}${entityPath(entityType, entityId)}`)
}

export function settingsLink(base: string = BRAND.site): string {
  return appLink('settings', null, base)
}
