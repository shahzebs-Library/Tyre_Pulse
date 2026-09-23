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

- `www.tyrepulse.app` → this marketing site
- `app.tyrepulse.app` → operational product
- `admin.tyrepulse.app` → company administration
- `console.tyrepulse.app` → private platform owner console
