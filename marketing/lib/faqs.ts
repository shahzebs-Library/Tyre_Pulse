/**
 * The frequently asked questions shown on the site, in one place.
 *
 * Each page renders its own list from here AND emits the matching FAQPage
 * JSON-LD from the same list (app/schema.tsx faqSchema), so the structured data
 * can never drift from what a visitor actually reads. Google's rule is that
 * FAQ markup may only describe questions visible on that page, so each list is
 * emitted only by the page that shows it.
 */
export type Faq = readonly [question: string, answer: string];

/** Home page: "What fleet teams ask before a demo." */
export const HOME_FAQ: ReadonlyArray<Faq> = [
  ["Our sites have weak signal.", "Inspections, photos, meter readings and signatures save on the phone and sync when the connection returns."],
  ["Our data is in the ERP and in Excel.", "Job cards, expenses, tyre records and asset lists import from the files you already export, with duplicates checked before they land."],
  ["We run more than one country.", "Each country and site sees only its own records, in its own currency, enforced in the database. Arabic and English are both supported."],
];

/** Pricing page: "Questions before a quote." */
export const PRICING_FAQ: ReadonlyArray<Faq> = [
  ["Why is there no published price?", "Fleets differ by machine count, sites, countries and integrations. A quote on your numbers is cheaper than a list price padded to cover everyone."],
  ["Can we start small?", "Yes. Start with one site or one module, such as tyres or inspections, and add the rest when it earns its place."],
  ["What do you need from us to quote?", "Fleet size, number of users, the countries you run in and the systems you want connected. A short message is enough."],
];

/** Security page: "What security teams ask." */
export const SECURITY_FAQ: ReadonlyArray<Faq> = [
  ["Who can see our data?", "Only users in your organisation, and only for the countries and sites they are assigned. The database enforces it on every query."],
  ["Can a site user see another country?", "No. Country and site scope are applied in the database, so a direct request returns nothing outside the user's scope."],
  ["Do you support MFA and single sign-on?", "Multi-factor sign-in is available for administrators. Single sign-on is set up on request, once your identity provider is connected."],
];

/**
 * The FAQ hub (/faq) shows every list above plus the groups below. Each answer
 * describes what the product does today; anything set up per customer says so.
 */
export const FAQ_GROUPS: ReadonlyArray<{ id: string; title: string; items: ReadonlyArray<Faq> }> = [
  { id: "getting-started", title: "Getting started", items: [
    ["How is Tyre Pulse deployed?", "It is a hosted web application with an Android app for field teams. There is nothing to install on your own servers. Your company gets its own workspace, and your users sign in to it."],
    ["How long does onboarding take?", "It depends on how clean your asset list is. We load your asset list and a sample of job cards and tyre records first, check them with you, then switch on one site or one module at a time."],
    ...HOME_FAQ,
  ] },
  { id: "users-roles", title: "Users and roles", items: [
    ["Which roles are built in?", "Drivers, technicians, tyre fitters, storekeepers, supervisors, HSE and insurance staff, and fleet managers each open the app to their own queue. Custom roles can be configured for your company."],
    ["Can we limit a user to one site or one country?", "Yes. Each user is assigned countries and sites, and the database returns only records inside that scope."],
    ["Does it work in Arabic?", "Yes. The web application and the field app run in English and Arabic, with right to left layout for Arabic."],
  ] },
  { id: "tyre-data", title: "Tyre data and import", items: [
    ["Can we import our existing tyre records?", "Yes. Serials, fitment dates, positions and kilometres import from an Excel or ERP export. Rows are checked for duplicates before they land."],
    ["Do we need RFID tags or TPMS sensors?", "No. Every tyre is tracked by serial number and wheel position. Live TPMS pressure can be received through your telematics connection, and RFID reads are optional."],
    ["How is cost per kilometre calculated?", "Tyre cost divided by the kilometres the tyre ran between fitment and removal. Plant that works by the hour uses cost per engine hour instead."],
  ] },
  { id: "inspections", title: "Inspections", items: [
    ["Can inspections be done without signal?", "Yes. Checklists, photos, readings and signatures are saved on the phone and sync when the connection returns."],
    ["Can we build our own checklists?", "Yes. Checklists are configured per asset type, and a failed item can raise a corrective action or a work order."],
    ["Does the app analyse tyre photos?", "AI-assisted photo analysis flags possible tyre defects from inspection photos for your team to check. It supports the inspector and does not replace the inspection."],
  ] },
  { id: "reporting", title: "Reporting", items: [
    ["Which report formats are supported?", "Registers export to Excel and PDF. Management reports can also be produced as PowerPoint."],
    ["Can reports be sent automatically?", "Yes. Reports can be scheduled by email, daily, weekly or monthly, to the recipients you choose."],
    ["Can we show a dashboard on a workshop screen?", "Yes. A shareable board link opens a read-only dashboard for a TV or a manager, with an optional password and expiry date."],
  ] },
  { id: "security", title: "Security and data", items: [
    ...SECURITY_FAQ,
    ["How do we get our data deleted?", "A user can request account deletion from inside the app, or use the data deletion page linked in the footer of this site. Our team handles each request by email."],
  ] },
  { id: "pricing", title: "Pricing", items: PRICING_FAQ },
];
