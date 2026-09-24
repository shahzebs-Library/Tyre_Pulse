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

**What it does not have is a custom domain.** `tyrepulse.app` and
`www.tyrepulse.app` are both attached to the app project (`tyrepulse.app`
308-redirects to `www`), so the branded hosts still serve the application, and
this site is only reachable on its `.vercel.app` address.
`app.tyrepulse.app`, `admin.tyrepulse.app` and `console.tyrepulse.app` do not
exist at all.

That is why `NEXT_PUBLIC_APP_URL` defaults to `https://www.tyrepulse.app` in
`lib/site.ts`: it is the host that actually serves the app, so the Login link
works. Pointing it at `app.tyrepulse.app` before that host exists puts a dead
link in the header of every page.

### The intended split

Only the domains still need moving; the project already exists.

In this order, so nothing is dark in between:

1. Add `app.tyrepulse.app` to the **app** project and wait for it to serve.
2. Set `NEXT_PUBLIC_APP_URL=https://app.tyrepulse.app` on `tyre-pulse-eezl`.
3. Move `www.tyrepulse.app` and `tyrepulse.app` from the app project to
   `tyre-pulse-eezl`.

Step 1 before step 3 matters: the app is an installed PWA whose start_url is
bound to the current host, and `next.config.ts` carries the rescue redirect that
hands those launches back to the application.

| Host | Serves | Exists |
| --- | --- | --- |
| `tyre-pulse-eezl.vercel.app` | this marketing site | yes, live now |
| `www.tyrepulse.app` | this marketing site, once moved | yes, currently the app |
| `app.tyrepulse.app` | operational product | not yet |
| `admin.tyrepulse.app` | company administration | no, and not planned as a public host |
| `console.tyrepulse.app` | platform owner console | no, and not planned as a public host |

Company administration and the owner console are reached from inside the
application, not as separate public sites. The footer states that rather than
linking to them.
