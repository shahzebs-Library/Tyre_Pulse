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
  ["Do you support MFA and single sign-on?", "Administrators sign in with a second factor, and single sign-on can be required per company once your identity provider is connected."],
];
