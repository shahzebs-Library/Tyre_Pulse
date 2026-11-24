# 01 · System context and containers (C4 levels 1 and 2)

Analysed: worktree `claude/wms-wp0-register` (tip `89cf96c3`) and the live database `jhssdmeruxtrlqnwfksc`, 2026-11-24.

**Legend:** green = IMPLEMENTED (live in DB and wired in code) · yellow = PARTIAL (built but unused, empty, or degrades to "not provisioned") · red = BROKEN (evidence below) · purple dashed = PROPOSED (migration file marked `STATUS: NOT APPLIED`, absent from `supabase_migrations.schema_migrations`) · dashed arrow = text join with no FK, or a proposed link. Row counts are exact `count(*)` reads on 2026-11-24.

## Level 1 — System context

```mermaid
C4Context
  title System context for Tyre Pulse
  Person(office, "Office, workshop and store users", "Managers, planners, store keepers, approvers")
  Person(field, "Field staff", "Tyre men, inspectors, drivers, mechanics")
  Person(admin, "Platform super admin", "Owns the console")
  System(tp, "Tyre Pulse", "Fleet, tyre, workshop, warehouse and cost intelligence")
  System_Ext(erp, "ERP exports", "Ramco grid / job card / tyre / asset files")
  System_Ext(mail, "Resend", "Transactional and scheduled report email")
  System_Ext(push, "Expo push / Firebase FCM", "Mobile notifications")
  System_Ext(ai, "Anthropic API", "chat-ai, ai-tyre-inspection")
  System_Ext(pay, "Stripe", "billing-checkout, billing-webhook")
  System_Ext(sentry, "Sentry", "Crash and error monitoring")
  Rel(office, tp, "Manages fleet, stock and approvals in", "HTTPS browser")
  Rel(field, tp, "Captures inspections, counts and meter logs with", "Flutter app")
  Rel(admin, tp, "Configures tenants, access and data in", "HTTPS /console")
  Rel(erp, tp, "Is loaded into staging tables of", "CSV / XLSX import")
  Rel(tp, mail, "Sends report and alert email via", "HTTPS API")
  Rel(tp, push, "Sends push notifications via", "HTTPS API")
  Rel(tp, ai, "Asks for grounded answers and tyre photo verdicts from", "HTTPS API")
  Rel(tp, pay, "Creates checkout sessions and receives webhooks from", "HTTPS")
  Rel(tp, sentry, "Reports errors to", "HTTPS")
```

## Level 2 — Containers

```mermaid
C4Container
  title Container diagram for Tyre Pulse
  Person(office, "Office / workshop / store users")
  Person(field, "Field staff")
  System_Boundary(tp, "Tyre Pulse") {
    Container(web, "Web app", "React 19, Vite, src/App.jsx", "All modules; services in src/lib/api/*.js (399 files)")
    Container(console, "Super-admin console", "React, src/console/", "Tenants, access control, data operations")
    Container(flutter, "Flutter app", "Dart, tyre_pulse_flutter/lib", "Field capture with Drift offline queue")
    Container(expo, "Expo app (retired)", "React Native, mobile/", "Store builds retired; OTA hotfix path only")
    Container(mkt, "Marketing site", "Next.js, marketing/", "Public website, contact form")
    Container(edge, "Edge functions", "Deno, supabase/functions/*", "19 functions: send-email, send-scheduled-reports, chat-ai, workflow-notify, public-api, ...")
    ContainerDb(db, "Postgres", "Supabase Postgres + RLS", "Business tables, inv_* ledger RPCs, triggers, pg_cron")
    ContainerDb(store, "Storage", "Supabase Storage", "Photos, PDFs, exports")
  }
  System_Ext(erp, "ERP exports")
  System_Ext(ext, "Resend, Expo/FCM, Anthropic, Stripe, Sentry")
  Rel(office, web, "Uses", "HTTPS")
  Rel(field, flutter, "Uses", "Android / iOS")
  Rel(web, db, "Reads tables and calls RPCs on", "PostgREST, JSON/HTTPS")
  Rel(console, db, "Calls super-admin RPCs on", "PostgREST, JSON/HTTPS")
  Rel(flutter, db, "Pushes queued commands and RPCs to", "PostgREST, JSON/HTTPS")
  Rel(web, store, "Uploads photos and PDFs to", "HTTPS")
  Rel(web, edge, "Invokes", "supabase.functions.invoke")
  Rel(edge, db, "Reads and writes with the service role", "PostgREST")
  Rel(edge, ext, "Sends mail, push, AI and billing calls to", "HTTPS")
  Rel(erp, db, "Is loaded through stg_* triggers into", "CSV import")
  Rel(mkt, web, "Links its Login button to", "HTTPS")
```

## Same view as an editable draw.io diagram

Source: `diagrams/01-system-container/01-system-container.mmd` → `.drawio`.

```mermaid
flowchart TD
  U([Office / workshop / store users])
  F([Field staff on phones])
  subgraph TP [Tyre Pulse system]
    WEB["Web app<br/>src/App.jsx React+Vite"]:::green
    CON["Super-admin console<br/>src/console/"]:::green
    FLT["Flutter app<br/>tyre_pulse_flutter/lib"]:::green
    EXPO["Expo app mobile/<br/>retired, OTA only"]:::gray
    MKT["Marketing site<br/>marketing/ Next 16"]:::green
    EDGE["Edge functions<br/>supabase/functions/*"]:::green
    DB[("Postgres + RLS + RPCs<br/>project jhssdmeruxtrlqnwfksc")]:::green
    STO[("Supabase Storage<br/>photos, PDFs")]:::green
    PY["services/analytics<br/>Python, CI only"]:::yellow
  end
  ERP["ERP exports<br/>Ramco / CSV staging"]
  EXT["Resend, Expo/FCM push,<br/>Anthropic, Stripe, Sentry"]
  U --> WEB
  U --> CON
  F --> FLT
  WEB -.->|"PostgREST + RPC, HTTPS"| DB
  CON -.->|"super-admin RPCs"| DB
  FLT -.->|"PostgREST + RPC, offline queue"| DB
  WEB -.->|uploads| STO
  FLT -.->|"photo uploads"| STO
  WEB -.->|"functions.invoke"| EDGE
  EDGE -.->|"service role"| DB
  EDGE -.->|"email, push, AI, billing"| EXT
  ERP -.->|"stg_* triggers, Data Intake"| DB
  MKT -.->|"Login link"| WEB
  classDef green fill:#d5e8d4,stroke:#82b366,color:#000
  classDef yellow fill:#fff2cc,stroke:#d6b656,color:#000
  classDef red fill:#f8cecc,stroke:#b85450,color:#000
  classDef purple fill:#e1d5e7,stroke:#9673a6,stroke-dasharray:5 5,color:#000
  classDef gray fill:#eeeeee,stroke:#999999,color:#000
```

## Elements

| Name | Type | Technology | Status | Evidence |
|---|---|---|---|---|
| Web app | Container | React + Vite | IMPLEMENTED | `src/App.jsx` routes, `src/lib/api/_client.js` |
| Console | Container | React | IMPLEMENTED | `src/console/` |
| Flutter app | Container | Flutter + Drift | IMPLEMENTED | `tyre_pulse_flutter/lib/core/sync/sync_engine.dart` |
| Expo app | Container | React Native | RETIRED | PROJECT_MEMORY: store builds retired, OTA hotfix only |
| Marketing | Container | Next.js | IMPLEMENTED | `marketing/` (separate Vercel project) |
| Edge functions | Container | Deno | IMPLEMENTED | `supabase/functions/` (19 dirs) |
| services/analytics | Library | Python | PARTIAL | Run by CI only; not called by the app |
| Postgres | Database | Supabase | IMPLEMENTED | 30 migrations applied since 2026-11-20; 7 newer files NOT APPLIED |

## Assumptions
- External systems are listed from `supabase/functions/*` and PROJECT_MEMORY; their live configuration (keys set or not) was not read.
