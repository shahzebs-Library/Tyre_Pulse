# Connecting your ERP to TyrePulse

TyrePulse can pull master + transaction data from your ERP on a schedule and
feed it through the **same controlled pipeline** as manual uploads (stage →
validate → approve → commit). This keeps ERP data trustworthy and country-scoped.

## What you configure (in-app)
**ERP Sync** page → **ERP connection** card (admin only):
- **ERP system** — SAP, Oracle, Odoo, Dynamics, Sage, or Custom REST
- **API base URL** — must be `https://` (secure endpoints only)
- **Authentication** — API key header / bearer / basic / OAuth2
- **Entities to sync** — Tyre records, Vehicles, Stock, Work orders, Suppliers
- **Frequency** — manual / hourly / daily / weekly
- **Enable scheduled sync** toggle

This config is stored in `app_settings.erp_connection` (non-secret) and is
org-scoped + RLS-protected.

## Where the API key goes (secure)
The API key/token is **never stored in the database or sent to the browser**.
It is set once as a server secret:

```bash
supabase secrets set ERP_API_KEY=your-key-here
# (or ERP_CLIENT_ID / ERP_CLIENT_SECRET for OAuth2)
```

## How the sync runs (server side)
1. A scheduled Edge Function (`erp-sync`) reads the config + the `ERP_API_KEY`
   secret.
2. It calls your ERP's API for each selected entity, page by page.
3. Each row is **staged** into the Data Intake Center (never written directly to
   live tables), mapped via a saved mapping profile, validated (types, dupes,
   currency), and only **committed after approval** — exactly like a manual import.
4. `erp_connection` records `last_sync_at` / `status` / `last_error`.

## Per-ERP notes
- **SAP S/4HANA** — OData v4 services; API key or OAuth2.
- **Oracle Fusion** — REST v11.13; basic or OAuth2.
- **Odoo** — JSON-RPC / REST; API key.
- **Dynamics 365** — OData v4; OAuth2 (Azure AD app registration).
- **Custom REST / file feed** — any `https` JSON endpoint, or a scheduled CSV drop.

## To wire a specific ERP
Tell us which ERP + auth style and share the endpoint docs; we implement the
`erp-sync` Edge Function's adapter for that system and map its fields to the
TyrePulse columns once. After that, syncs are automatic on your chosen schedule.
