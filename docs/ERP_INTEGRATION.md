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

## Runtime status

The vendor-neutral reliability contract is implemented in
`MIGRATIONS_V610_ERP_SYNC_RELIABILITY.sql` and `src/lib/erpReliability.js`, but
V610 must be reviewed/applied and the vendor adapter must be implemented before
scheduled sync can be enabled. The product must continue to show **Not
configured** until both have happened. Saving a URL is not a connectivity test.

## How a provisioned sync runs (server side)
1. A scheduled server worker reads the due connection and resolves only the
   named server secret (`credential_ref`). It must never return that value.
2. It calls your ERP's API for each selected entity, page by page.
3. Each row is **staged** into the Data Intake Center (never written directly to
   live tables), mapped via a saved mapping profile, validated (types, dupes,
   currency), and only **committed after approval** — exactly like a manual import.
4. `erp_sync_runs` and `erp_sync_items` record source/staged/rejected/duplicate
   counts. Deterministic source keys make retries idempotent.
5. Transient failures use bounded exponential backoff (maximum five attempts);
   authentication, mapping and validation failures fail immediately. Exhausted
   work is preserved in `erp_sync_dead_letters` for an authorised replay.
6. Freshness, ownership and reconciliation status come from persisted run
   evidence, never from UI assumptions.

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

## Vendor-dependent production gate

These items cannot be safely invented and remain required for each connection:

- vendor/product and API version, tenant/company identifier and vendor docs;
- approved HTTPS hosts and redirect hosts (DNS/IP checks must also reject
  private, loopback, link-local and cloud-metadata destinations at request time);
- OAuth scopes or API-key header convention, secret rotation owner and expiry;
- entity endpoints, pagination/cursor rules, rate limits and incremental-watermark rules;
- stable source record ID/version fields and delete/tombstone semantics;
- field mapping, currency/timezone/unit rules and authoritative-system ownership;
- expected source totals/tolerances and the human approval/reconciliation owner;
- cron frequency, maintenance window, freshness SLO and alert recipients;
- sandbox connectivity test followed by a read-only dry run and signed approval.

Do not enable a connection until V610 is applied, the adapter passes contract
tests, a dry run reconciles, alerts are configured, and rollback/replay has been
exercised. No live external writes are part of the connector contract.
