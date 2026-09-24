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

This marketing site **is not deployed**. There is no Vercel project for it. The
only Tyre Pulse domains that resolve are `tyrepulse.app` and
`www.tyrepulse.app`, and both are attached to the Vercel project that serves the
**operational app** (`tyrepulse.app` 308-redirects to `www`). `app.tyrepulse.app`,
`admin.tyrepulse.app` and `console.tyrepulse.app` do not exist.

That is why `NEXT_PUBLIC_APP_URL` defaults to `https://www.tyrepulse.app` in
`lib/site.ts`: it is the host that actually serves the app, so the Login link
works. Pointing it at `app.tyrepulse.app` before that host exists puts a dead
link in the header of every page.

### The intended split

To deploy, create a **new** Vercel project from this repository with
**Root Directory = `marketing`** (Next.js is detected automatically). Do not add
it to the existing `tyre-pulse` project, which builds the Vite app from the
repository root.

Then, in this order, so nothing is dark in between:

1. Add `app.tyrepulse.app` to the **app** project and wait for it to serve.
2. Set `NEXT_PUBLIC_APP_URL=https://app.tyrepulse.app` on the marketing project.
3. Move `www.tyrepulse.app` and `tyrepulse.app` from the app project to this one.

| Host | Serves | Exists |
| --- | --- | --- |
| `www.tyrepulse.app` | this marketing site | yes, currently the app |
| `app.tyrepulse.app` | operational product | not yet |
| `admin.tyrepulse.app` | company administration | no, and not planned as a public host |
| `console.tyrepulse.app` | platform owner console | no, and not planned as a public host |

Company administration and the owner console are reached from inside the
application, not as separate public sites. The footer states that rather than
linking to them.
