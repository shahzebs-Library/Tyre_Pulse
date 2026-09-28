/** One definition of the site's page map, read by the header, footer and sitemap. */
export const PLATFORM_PAGES = [
  { href: "/platform", label: "Platform overview", text: "Every module in one connected system" },
  { href: "/platform/fleet-assets", label: "Fleet and assets", text: "Asset records, meters, lifecycle" },
  { href: "/platform/maintenance", label: "Maintenance and workshop", text: "Work orders, technicians, parts" },
  { href: "/platform/inspections", label: "Inspections and safety", text: "Checklists, defects, sign-off" },
  { href: "/platform/inventory", label: "Inventory and reporting", text: "Stores, purchasing, costs" },
] as const;

export const SOLUTION_PAGES = [
  { href: "/industries", label: "Industries", text: "Construction, ready-mix, transport, rental" },
  { href: "/pricing", label: "Pricing", text: "Plans by fleet size and modules" },
] as const;

export const RESOURCE_PAGES = [
  { href: "/security", label: "Security", text: "Tenant isolation, roles, audit" },
  { href: "/contact", label: "Contact", text: "Book a demo or talk to sales" },
] as const;
