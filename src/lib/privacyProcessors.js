/**
 * privacyProcessors - the ONE list of outside companies that receive data from
 * Tyre Pulse, shown on the public Privacy Policy (/privacy).
 *
 * Every entry was checked against the code on 2026-11-12. `hosts` are the
 * network addresses the code really calls; src/test/privacyProcessors.test.js
 * scans the edge functions and the web app and FAILS when the code starts
 * calling a host that no entry here lists, so the policy cannot silently fall
 * behind the product again.
 *
 * `when` values:
 *   always    - part of running the service
 *   feature   - only when the named feature is used
 *   optional  - only when the operator has switched it on / configured it
 *   not_live  - built but not in use
 *
 * LEGAL NOTE: this is a factual technical list, not legal advice. The wording
 * on the page must be reviewed by the owner or their adviser before relying on
 * it in a contract or a store listing.
 */
export const PRIVACY_PROCESSORS = Object.freeze([
  {
    id: 'supabase',
    name: 'Supabase',
    role: 'Database, sign-in, file storage and server functions (hosting)',
    when: 'always',
    data: 'Everything you and your organisation enter: account details, fleet, tyre, inspection, workshop, accident and stock records, photos and documents.',
    why: 'It is where the service runs and where your data is stored.',
    hosts: ['supabase.co'],
  },
  {
    id: 'vercel',
    name: 'Vercel',
    role: 'Web app hosting',
    when: 'always',
    data: 'The web pages are served from Vercel, so it sees your IP address and browser details when you open the app. It does not store your fleet records.',
    why: 'To deliver the web app to your browser.',
    hosts: ['vercel.app', 'vercel.com'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    role: 'AI analysis',
    when: 'feature',
    data: 'AI tyre inspection: the tyre photo you took and a fixed instruction. AI assistant: your question and the fleet figures needed to answer it. Photos can show people, number plates or surroundings if they are in the picture.',
    why: 'To describe visible tyre condition and to answer questions about your fleet.',
    hosts: ['api.anthropic.com'],
  },
  {
    id: 'google_ai',
    name: 'Google (Gemini)',
    role: 'Backup AI photo analysis',
    when: 'optional',
    data: 'The same tyre photo and fixed instruction, only when the main AI service cannot be used and a backup has been configured.',
    why: 'So a photo can still be analysed when the main AI service is unavailable.',
    hosts: ['generativelanguage.googleapis.com'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    role: 'Text search index for the knowledge base',
    when: 'feature',
    data: 'The text of knowledge documents your organisation adds (procedures, manuals, notes), and the text of a question when the assistant searches those documents. No photos.',
    why: 'To turn text into a search index so the assistant can find the right document.',
    hosts: ['api.openai.com'],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    role: 'Error and crash monitoring',
    when: 'always',
    data: 'Crash reports, error messages, a sample of performance timings, device and app version, and your user ID, role and site. On the web, a masked recording of the screen is kept when an error happens (text is hidden). No passwords.',
    why: 'To find and fix faults.',
    hosts: ['sentry.io'],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    role: 'Product usage analytics (web app only)',
    when: 'optional',
    data: 'Which pages and buttons are used, with on-screen text masked, linked to your user ID, role and site. Never your name or email. Not used in the mobile apps.',
    why: 'To see which features are used and where people get stuck.',
    hosts: ['posthog.com'],
  },
  {
    id: 'resend',
    name: 'Resend',
    role: 'Email delivery',
    when: 'feature',
    data: 'The recipient email address and the content of the email: scheduled reports, approval and workflow notices, and account recovery codes.',
    why: 'To deliver emails the service sends on your organisation\'s behalf.',
    hosts: ['api.resend.com'],
  },
  {
    id: 'push',
    name: 'Google Firebase Cloud Messaging and Expo push service',
    role: 'Push notifications to the mobile apps',
    when: 'feature',
    data: 'Your device push token and the title and text of the notification (for example "Approval required").',
    why: 'To deliver notifications to your phone.',
    hosts: ['fcm.googleapis.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'exp.host'],
  },
  {
    id: 'twilio',
    name: 'Twilio',
    role: 'WhatsApp and SMS messages',
    when: 'optional',
    data: 'Your phone number and the message text, only if your organisation has switched on WhatsApp notices or SMS account recovery.',
    why: 'To deliver a notice or a recovery code to your phone.',
    hosts: ['api.twilio.com'],
  },
  {
    id: 'open_meteo',
    name: 'Open-Meteo',
    role: 'Weather data for the heat screens',
    when: 'feature',
    data: 'The map coordinates of a city chosen from a fixed list, sent from your browser, so it also sees your IP address. Never your own location and never fleet data.',
    why: 'To show current temperature for tyre heat risk.',
    hosts: ['open-meteo.com'],
  },
  {
    id: 'google_fonts',
    name: 'Google Fonts',
    role: 'A typeface on the sign-in page',
    when: 'always',
    data: 'Your browser downloads a font from Google when the sign-in page opens, so Google sees your IP address. Nothing you type is sent.',
    why: 'Page design.',
    hosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Turnstile',
    role: 'Sign-in abuse check',
    when: 'optional',
    data: 'Browser signals and your IP address, only if the check has been switched on.',
    why: 'To stop automated sign-in attempts.',
    hosts: ['challenges.cloudflare.com'],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    role: 'Online card payment for subscriptions',
    when: 'not_live',
    data: 'Not in use today. When online payment is switched on, Stripe will receive your organisation reference, the chosen plan and price, and you will enter card details on Stripe\'s own page. Tyre Pulse never receives or stores card numbers.',
    why: 'To take subscription payments.',
    hosts: ['api.stripe.com'],
  },
])

export const PROCESSOR_WHEN_LABEL = Object.freeze({
  always: 'Always',
  feature: 'When you use the feature',
  optional: 'Only if switched on',
  not_live: 'Not in use yet',
})

/** True when `host` (for example "api.resend.com") is covered by the list. */
export function processorForHost(host) {
  const h = String(host || '').toLowerCase()
  return PRIVACY_PROCESSORS.find((p) => p.hosts.some((x) => h === x || h.endsWith(`.${x}`))) || null
}
