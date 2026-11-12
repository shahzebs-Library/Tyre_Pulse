# Tyre Pulse Marketing Website

A standalone, SEO-focused Next.js marketing site for Tyre Pulse.

## Start locally

```bash
npm install
npm run dev
```

## Production

```bash
npm run build
npm run start
```

## Environment

Copy `.env.example` to `.env.local` and configure the public app URL and contact email provider.

Contact delivery uses Resend. Configure server-only `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, and `CONTACT_FROM_EMAIL` with a sender on your verified Resend domain. Missing configuration returns HTTP 503; the form confirms receipt only after the provider accepts the email. Do not prefix these secrets with `NEXT_PUBLIC_`. Run `npm test` for mocked delivery checks; these tests send no email.

## Deployment structure

### What is true today

This site **is deployed and public**, at
**https://tyre-pulse-eezl.vercel.app**. It is built by the Vercel project
`tyre-pulse-eezl` (framework: Next.js), which tracks `main` and deploys to
production on every push.

There are two Vercel projects against this one repository, and it matters which
is which:

| Vercel project | Builds | Framework |
| --- | --- | --- |
| `tyre-pulse` | the operational app, from the repository root | Vite |
| `tyre-pulse-eezl` | this site, from `marketing/` | Next.js |

`scripts/vercel-ignore-build.mjs` belongs to the **app** project and excludes
`marketing`, so a marketing-only push no longer starts a pointless Vite build.
The marketing project is unaffected by that script and still builds normally.

### Hosts

The operational app is served at `app.tyrepulse.app`, the production domain of
the app project. `NEXT_PUBLIC_APP_URL` defaults to that host in `lib/site.ts`,
which is the one place it is written: the Log in link, the customer login link,
the legal pages (`/privacy`, `/terms`, `/data-deletion`), the structured data,
`llms.txt` and the `/console` redirect all read `APP_URL` from there.

`NEXT_PUBLIC_SITE_URL` defaults to `https://www.tyrepulse.app` and drives
canonical URLs, hreflang, the sitemap and the JSON-LD graph. Confirm on
`tyre-pulse-eezl` that `www.tyrepulse.app` is attached to this project (or set
the variable to the host that really serves this site) before relying on the
canonical URLs.

`next.config.ts` still carries the PWA rescue redirect: a request that arrives
with `?source=pwa` is handed to `APP_URL`, so a phone whose installed app was
bound to the old host launches into the application and not into this site.

| Host | Serves |
| --- | --- |
| `www.tyrepulse.app` | this marketing site (canonical origin) |
| `app.tyrepulse.app` | the operational product |

Company administration and the owner console are reached from inside the
application, not as separate public sites. The footer states that rather than
linking to them.
