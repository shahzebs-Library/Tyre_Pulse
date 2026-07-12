/**
 * Help Center knowledge base — curated FAQ content for Tyre Pulse, grouped by
 * topic. Pure data + a small search helper so the page (and tests) can filter
 * without duplicating logic. Keep answers concise and action-oriented.
 */

export const FAQ_CATEGORIES = [
  'Getting Started', 'Checklists', 'Inspections', 'Accidents',
  'Analytics & KPIs', 'Data & Imports', 'Roles & Access', 'Account',
]

export const FAQS = [
  {
    id: 'gs-what-is',
    category: 'Getting Started',
    q: 'What is Tyre Pulse?',
    a: 'Tyre Pulse is a fleet tyre-intelligence platform. It turns tyre, vehicle, inspection and workshop data into operational KPIs (CPK, tyre life, failure rate, pressure compliance), root-cause analysis, predictive maintenance and executive reporting.',
    keywords: ['overview', 'about', 'platform', 'intro'],
  },
  {
    id: 'gs-navigation',
    category: 'Getting Started',
    q: 'How do I find a feature quickly?',
    a: 'Use the global search in the top bar, or the left sidebar which groups modules by area (Operations, Tyre Performance, Workshop, Stock, Safety, Reports). Your role controls which items appear.',
    keywords: ['search', 'sidebar', 'menu', 'navigate'],
  },
  {
    id: 'cl-build',
    category: 'Checklists',
    q: 'How do I build a custom checklist?',
    a: 'Open Checklists → New Template (or Checklist Builder). Add fields from the library (text, number, select, boolean, rating, photo, signature, and live reference fields for Asset/Site/User). Set required flags, per-field photos, scoring weights and conditional visibility, then Publish.',
    keywords: ['template', 'builder', 'create', 'custom', 'fields'],
  },
  {
    id: 'cl-interval',
    category: 'Checklists',
    q: 'Why do only some checklist items appear when I fill one in?',
    a: 'Predictive-maintenance checklists use conditional visibility. Items are shown based on the Inspection interval you pick (Monthly, Quarterly, Annual, …) and, where applicable, the Vehicle type. Choose the interval/vehicle at the top and only the checks due for it appear — this keeps the form and the PDF report focused on what applies.',
    keywords: ['interval', 'monthly', 'annual', 'conditional', 'hidden', 'vehicle type', 'filter'],
  },
  {
    id: 'cl-photos',
    category: 'Checklists',
    q: 'Can I attach photos and a signature to a checklist?',
    a: 'Yes. Enable "Allow photo" on any item to capture an image against it. If the template requires a signature, the inspector signs before submitting. Photos and the signature are embedded in the exported PDF report.',
    keywords: ['photo', 'image', 'signature', 'sign', 'attachment'],
  },
  {
    id: 'cl-pdf',
    category: 'Checklists',
    q: 'How do I download a checklist as a PDF?',
    a: 'Open the submission from Checklists → Submissions and click Download PDF. The report carries your company logo, a timestamp, the answered items grouped by section, attached photos and the signature. Only items that applied (for the chosen interval/vehicle) are listed.',
    keywords: ['pdf', 'export', 'download', 'report', 'print'],
  },
  {
    id: 'cl-approval',
    category: 'Checklists',
    q: 'Who approves a submitted checklist?',
    a: 'If the template requires approval, submissions route through the approval chain — typically Inspector → Manager. Approvers see pending items under Approvals and can approve, return or reject with comments.',
    keywords: ['approval', 'approve', 'manager', 'review', 'sign-off'],
  },
  {
    id: 'in-record',
    category: 'Inspections',
    q: 'How do I record a tyre inspection?',
    a: 'Go to Inspections → New. Select the vehicle and tyre position, enter tread depth and pressure, note any defects and attach photos. Saved inspections feed pressure-compliance and wear analytics automatically.',
    keywords: ['inspection', 'tread', 'pressure', 'record', 'new'],
  },
  {
    id: 'ac-report',
    category: 'Accidents',
    q: 'How do I log and manage an accident case?',
    a: 'Open Accidents → New Case. Capture the vehicle, site, date, description, cost and insurer details, and attach photos. Open a case to see a full detail page with editable fields, a site dropdown, cost tracker and a Download Case PDF action.',
    keywords: ['accident', 'case', 'insurance', 'claim', 'incident'],
  },
  {
    id: 'an-cpk',
    category: 'Analytics & KPIs',
    q: 'What is CPK and where do I see it?',
    a: 'CPK (Cost Per Kilometre) = tyre cost ÷ distance run. It is the core tyre-economics KPI. See it on the Analytics, KPI Center and Fleet Analytics pages, broken down by brand, site, vehicle and position.',
    keywords: ['cpk', 'cost per km', 'kpi', 'economics', 'metric'],
  },
  {
    id: 'an-predict',
    category: 'Analytics & KPIs',
    q: 'Can Tyre Pulse predict tyre replacement and budgets?',
    a: 'Yes. Predictive Maintenance and the Forecasting Engine estimate remaining tread life, expected removal/replacement dates and future tyre budgets from your historical wear and cost data.',
    keywords: ['predict', 'forecast', 'budget', 'replacement', 'maintenance'],
  },
  {
    id: 'da-import',
    category: 'Data & Imports',
    q: 'How do I import data from Excel or my ERP?',
    a: 'Use Data Intake Center / Upload Data for spreadsheets — columns are auto-mapped and validated before commit. For live systems, ERP Sync connects a read-only feed. Large files are chunked and de-duplicated automatically.',
    keywords: ['import', 'excel', 'upload', 'erp', 'csv', 'data'],
  },
  {
    id: 'da-quality',
    category: 'Data & Imports',
    q: 'How does Tyre Pulse handle bad or duplicate data?',
    a: 'Data Cleaning flags duplicate serials, invalid pressures, missing tread readings, inconsistent odometers and unrealistic tyre-life values so you can correct them before they distort analytics.',
    keywords: ['duplicate', 'clean', 'quality', 'validation', 'errors'],
  },
  {
    id: 'ro-roles',
    category: 'Roles & Access',
    q: 'Why can’t I see a menu item another user sees?',
    a: 'The sidebar and pages are role-based. Admins see everything; other roles (Manager, Director, Inspector, Tyre Man, Store Keeper, Fleet Supervisor, Maintenance Supervisor, …) see only what their role permits. Ask an Admin to adjust your role or permissions.',
    keywords: ['role', 'permission', 'access', 'hidden', 'rbac', 'menu'],
  },
  {
    id: 'ro-checklist-only',
    category: 'Roles & Access',
    q: 'What is the Maintenance Supervisor (checklist-only) role?',
    a: 'It is a restricted role that can use ONLY the checklists area — build, schedule, fill and review checklists — plus Help and their profile. Everything else is hidden and redirected. Assign it under User Management.',
    keywords: ['maintenance supervisor', 'checklist only', 'restricted', 'role'],
  },
  {
    id: 'ac-password',
    category: 'Account',
    q: 'How do I change my password or language?',
    a: 'Open Settings → Account to change your password, and Settings → Preferences for language and theme. If you are locked out, an Admin can reset access from Security Center / User Management.',
    keywords: ['password', 'language', 'theme', 'account', 'reset', 'profile'],
  },
  {
    id: 'ac-support',
    category: 'Account',
    q: 'How do I report a problem or request a feature?',
    a: 'Use the Report an issue tab on this Help page. Describe the problem, pick a category and severity, and submit — your administrator receives the ticket and can respond. You can track status under My tickets.',
    keywords: ['support', 'help', 'issue', 'bug', 'ticket', 'contact', 'feature request'],
  },
]

/** Case-insensitive search across question, answer, category and keywords. */
export function searchFaqs(query, faqs = FAQS) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return faqs
  const terms = q.split(/\s+/).filter(Boolean)
  return faqs.filter((f) => {
    const hay = `${f.q} ${f.a} ${f.category} ${(f.keywords || []).join(' ')}`.toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}

/** Group an FAQ list by category, preserving FAQ_CATEGORIES order. */
export function groupFaqsByCategory(faqs = FAQS) {
  const map = new Map()
  for (const f of faqs) {
    if (!map.has(f.category)) map.set(f.category, [])
    map.get(f.category).push(f)
  }
  const ordered = []
  for (const cat of FAQ_CATEGORIES) {
    if (map.has(cat)) { ordered.push([cat, map.get(cat)]); map.delete(cat) }
  }
  for (const [cat, list] of map) ordered.push([cat, list]) // any uncategorised extras
  return ordered
}
