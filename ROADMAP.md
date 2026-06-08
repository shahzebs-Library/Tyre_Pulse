# TyrePulse — Complete Product Roadmap
**Readymix Concrete Company · Built by Shahzeb Rahman © 2026**
**Version 4.0 · Updated June 2026 · Governed by CLAUDE.md**

> **This roadmap is derived directly from CLAUDE.md.**
> Every section maps to a specific CLAUDE.md requirement.
> Nothing from CLAUDE.md is omitted.
> Ordered by business impact — highest value first.

---

## Status Key

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete and deployed |
| 🔄 | Partially implemented |
| ⬜ | Planned, not started |

---

## Product Health

| Metric | Status |
|--------|--------|
| Build | ✅ 0 errors |
| Auth + RBAC | ✅ RLS, role-based routes, idle timeout |
| Migrations ready | V1–V15 (V12-V15 require manual apply in Supabase) |
| Hosting | Vercel (auto-deploy on push to `main`) |
| Database | Supabase PostgreSQL + Auth + Storage + pgvector |
| Intelligence pages | ✅ 12 new pages (Waves 8-21) |
| PWA | ✅ Manifest + service worker + install prompt |
| AI System | ✅ 4-agent router + AiCommandCenter |
| RAG | ✅ pgvector schema + knowledge base + retrieval |

---

## CLAUDE.md Compliance Map

| CLAUDE.md Section | Roadmap Coverage |
|-------------------|-----------------|
| Tyre Engineering KPIs (17 KPIs) | Waves 8, 9, 13, 14 |
| Root Cause Analysis (14 causes) | Wave 11 |
| Tyre Position Intelligence | Wave 10 |
| Predictive Maintenance | Wave 12 |
| Vendor & Workshop Intelligence | Wave 13 |
| Fleet Management Intelligence | Wave 14 |
| Tyre Inspection Intelligence | Wave 9 |
| Data Quality Intelligence | Wave 16 |
| Advanced Analytics (9 types) | Wave 15 |
| Executive Reporting (7 sections) | Wave 17 |
| Forecasting (6 outputs) | Wave 18 |
| Continuous Improvement (6 areas) | Wave 19 |
| RAG & Knowledge System | Wave 20 |
| Multi-Agent AI System | Wave 21 |
| Enterprise Scale + Multi-tenant | Wave 22 |
| Mobile & Integrations | Wave 23 |

---

## Waves 1–7 — Foundation, Operations & Operational Intelligence *(Completed)*

### Wave 1 — Security, Auth & Access Control

| # | Feature | Status |
|---|---------|--------|
| 1A | Remove AI/Anthropic branding from visible UI | ✅ |
| 1B | 1-hour idle session timeout with auto sign-out | ✅ |
| 1C | Role-based page access — Admin-only routes | ✅ |
| 1D | Admin-only nav items hidden from non-Admins | ✅ |
| 1E | Forgot password flow + /reset-password page | ✅ |
| 1F | Employee ID field on signup and profile | ✅ |
| 1G | Show/hide password toggle on all password fields | ✅ |
| 1H | Pending admin approval workflow for new accounts | ✅ |
| 1I | UserManagement: Approve + multi-country assignment | ✅ |
| 1J | MIGRATIONS_V10 — employee_id, approved, country[], accidents | ✅ |

### Wave 1B — UX & Export Polish

| # | Feature | Status |
|---|---------|--------|
| P1–P15 | PDF exports, branding, nav, uploads, audit trail, fleet master | ✅ |

### Wave 2 — Upload Intelligence & Dashboard

| # | Feature | Status |
|---|---------|--------|
| 2A–2F | Multi-sheet upload, stock mapping, batch delete, dashboard charts | ✅ |

### Wave 3 — New Pages

| # | Feature | Status |
|---|---------|--------|
| 3A | Accidents / Incident Tracking | ✅ |
| 3B | Custom Reports builder | ✅ |
| 3C | Chart fullscreen modal | ✅ |

### Wave 4 — Inspections & Vehicle Diagrams

| # | Feature | Status |
|---|---------|--------|
| 4A–4E | SVG tyre diagram, inspection checklists, PDF, Tyre Man role | ✅ |

### Wave 5 — Polish & Access

| # | Feature | Status |
|---|---------|--------|
| 5A–5C | Logo, country lock, nav auto-collapse | ✅ |
| 5D | Email generation with attached reports | ⬜ |
| 5E | Theme depth — gradients, card shadows, dark palette | ⬜ |
| 5F | Empty state cleanup across all pages | ⬜ |

### Wave 6 — Operational Features

| # | Feature | Status |
|---|---------|--------|
| 6A–6E | Gate Pass, duplicate detection, serial tracker, comparison | ✅ |

### Wave 7 — Operational Intelligence *(June 2026)*

| # | Feature | Status |
|---|---------|--------|
| 7A | Settings — KPI Targets Editor (Admin/read-only, kpi_targets table) | ✅ |
| 7B | Settings — Enhanced Alert Thresholds (app_settings table, 5 fields) | ✅ |
| 7C | KPI Scorecard — Site Breakdown tab (per-site 5-KPI comparison, red/green) | ✅ |
| 7D | KPI Scorecard — Year-over-Year toggle (chart overlay + delta column) | ✅ |
| 7E | KPI Scorecard — Performance alerts banner (>20% over target) | ✅ |
| 7F | VehicleHistory — Tyre health score per position (0–100, risk + age decay) | ✅ |
| 7G | VehicleHistory — km-based replacement forecast per position | ✅ |
| 7H | VehicleHistory — Top 3 action recommendations (Urgent/Soon/Monitor) | ✅ |
| 7I | VehicleHistory — 3-month cost projection vs fleet budget | ✅ |
| 7J | StockManagement — Consumption velocity (avg/month, last 3 months) | ✅ |
| 7K | StockManagement — Days of stock remaining (colour-coded) | ✅ |
| 7L | StockManagement — Inter-site Transfer tab (dual stock_movements insert) | ✅ |
| 7M | Reports — Vehicle History grouped by asset_no with aggregates | ✅ |
| 7N | Reports — Full preview pagination (100/page, Prev/Next) | ✅ |
| 7O | Reports — Print-to-window button | ✅ |
| 7P | Reports — Save/restore config per report type (localStorage) | ✅ |

---

## Wave 8 — Engineering KPI Engine *(CLAUDE.md: Automatic Tyre KPI Analysis)*

> **CLAUDE.md requirement:** "Whenever tyre data is available automatically calculate… Do not wait for the user to request these."
> CPK engine exists in `analyticsEngine.js` but is **not surfaced in the UI**. All 17 KPIs below are required.

| # | KPI | Implementation | Status |
|---|-----|----------------|--------|
| 8A | **Cost Per Kilometer (CPK)** — fleet-wide dashboard, per asset, per brand, worst performers table | SQL: `cost_per_tyre / (km_at_removal - km_at_fitment)` — engine ready, UI needed | ⬜ |
| 8B | **Cost Per Mile** — same as CPK, converted for USD/mile display | Derived from CPK × 1.609 | ⬜ |
| 8C | **Average Tyre Life** — avg km per tyre across fleet, by brand, by position, trend over time | Aggregate query on tyre_records with km fields | ⬜ |
| 8D | **Remaining Tyre Life** — per active tyre: projected km left based on current CPK vs expected life | (expected_km - km_run) / monthly_km_rate | 🔄 Per-asset only (Wave 7G) |
| 8E | **Fleet Average Tyre Life** — single headline number + 12-month trend chart | Fleet-level aggregation | ⬜ |
| 8F | **Tyre Removal Rate** — tyres removed per 1,000 km operated, by site, trend | removal_count / total_fleet_km × 1000 | ⬜ |
| 8G | **Tyre Failure Rate** — % of removals classified as failure vs normal wear-out | filter by risk_level = High/Critical / total | ⬜ |
| 8H | **Tyre Replacement Rate** — replacements per vehicle per month, site comparison | count grouped by asset and month | ⬜ |
| 8I | **Pressure Compliance %** — % of inspections where recorded pressure is within ±10% of spec | inspections with pressure_reading vs spec | ⬜ |
| 8J | **Inspection Compliance %** — % of scheduled inspections completed on time per site/vehicle | scheduled vs completed inspections | ⬜ |
| 8K | **Retread Performance** — retread tyre CPK vs new tyre CPK, retread success/failure rate | filter category = 'Retread' records | ⬜ |
| 8L | **Scrap Rate** — % of removed tyres classified as scrap (not retreadable) | filter category = 'Scrap' or risk = Critical | ⬜ |
| 8M | **Fleet Availability Impact** — estimated % of fleet availability lost due to tyre-related downtime | downtime_hours / total_scheduled_hours × 100 | ⬜ |
| 8N | **Vehicle Downtime Impact** — days per vehicle lost to tyre changes, by site | sum of replacement events × avg downtime per event | ⬜ |
| 8O | **Cost Trend Analysis** — 13-month rolling cost trend, regression forecast, anomaly flags | Linear regression already in analyticsEngine — needs dedicated view | 🔄 KPI Scorecard (partial) |
| 8P | **Vendor Performance KPI** — CPK per brand/supplier, ranked table with trend | brand-level CPK aggregation | 🔄 BrandPerformance (partial) |
| 8Q | **Workshop Performance KPI** — turnaround time, cost per job, quality score per workshop | Requires workshop tracking fields | ⬜ |

**Required migration:** MIGRATIONS_V12 — `app_settings` table (already needed for Wave 7B)
**New page:** `/kpi-engine` — Engineering KPI Dashboard with all 17 metrics, filters, export

---

## Wave 9 — Pressure & Inspection Intelligence *(CLAUDE.md: Tyre Inspection Intelligence)*

> **CLAUDE.md requirement:** "Review inspection quality. Detect missing inspections, inconsistent inspections, false readings, duplicate entries, data quality issues, pressure reporting anomalies. Highlight risks automatically."

| # | Feature | Status |
|---|---------|--------|
| 9A | Pressure compliance % computed per vehicle, site, fleet — shown on Inspections page | ⬜ |
| 9B | Pressure anomaly detection — flag readings > 20% above/below spec (auto-highlight in inspection list) | ⬜ |
| 9C | Missing inspection detection — vehicles overdue for scheduled inspection shown in alert banner | ⬜ |
| 9D | Inconsistent inspection detection — same vehicle with radically different readings back-to-back | ⬜ |
| 9E | False reading detection — statistically impossible values (e.g. 0 PSI with no alert raised) | ⬜ |
| 9F | Duplicate inspection entry detection — same vehicle, same date, same inspector | ⬜ |
| 9G | Inspection quality score per inspector — % of inspections with all fields complete and valid | ⬜ |
| 9H | Inspection compliance % per site — scheduled vs completed, weekly and monthly view | ⬜ |
| 9I | Tread depth compliance tracking — flag when tread depth reading falls below legal/policy minimum | ⬜ |
| 9J | Inspection intelligence dashboard — combines all 9A–9I into a single view with drill-down | ⬜ |

---

## Wave 10 — Tyre Position Intelligence *(CLAUDE.md: Tyre Position Intelligence)*

> **CLAUDE.md requirement:** "Analyze tyre performance by position: Steer, Drive, Trailer, Lift axle, Tag axle. Identify fastest wearing, highest cost, failure-prone, pressure problem positions. Recommend corrective actions."

| # | Feature | Status |
|---|---------|--------|
| 10A | Position analytics page — `/position-intelligence` | ⬜ |
| 10B | CPK per position across fleet — ranked table (Steer / Drive / Trailer / Lift / Tag) | ⬜ |
| 10C | Average tyre life per position — which positions wear fastest | ⬜ |
| 10D | Failure rate per position — % of critical/high risk removals by position | ⬜ |
| 10E | Pressure problem positions — which positions have highest pressure non-compliance | ⬜ |
| 10F | Cost per position — total spend and avg cost, ranked | ⬜ |
| 10G | Position-based corrective action recommendations (auto-generated per fleet data) | ⬜ |
| 10H | Heat map: position × site matrix showing worst combinations | ⬜ |
| 10I | Rotation compliance tracker — flag vehicles not following rotation schedule | ⬜ |
| 10J | Position comparison chart — overlay all positions on CPK trend line | ⬜ |

---

## Wave 11 — Root Cause Intelligence Engine *(CLAUDE.md: Root Cause Analysis — 14 causes)*

> **CLAUDE.md requirement:** "When tyre failures occur investigate: Under inflation, Over inflation, Alignment issues, Suspension issues, Wheel balancing, Brake problems, Driver behavior, Road conditions, Load conditions, Overloading, Maintenance quality, Manufacturing defects, Rotation compliance, Operational misuse. Always attempt root cause identification."

| # | Feature | Status |
|---|---------|--------|
| 11A | Automated RCA classification engine — classifies each High/Critical record into one of 14 root causes using rule-based logic (no AI cost) | ⬜ |
| 11B | Under/over inflation detection — cross-reference pressure readings from last inspection with removal reason | ⬜ |
| 11C | Alignment issue detection — repeated same-position failures on one vehicle flagged | ⬜ |
| 11D | Driver behaviour scoring — link tyre wear pattern to driver_id, rank drivers by tyre cost impact | ⬜ |
| 11E | Overloading detection — short km life + high failure rate pattern on specific assets | ⬜ |
| 11F | Rotation compliance tracking — flag assets where position rotation schedule not followed | ⬜ |
| 11G | Manufacturing defect flagging — multiple early failures of same brand/batch | ⬜ |
| 11H | Maintenance quality detection — failures clustered within 30 days of workshop visit | ⬜ |
| 11I | RCA confidence scoring — each auto-classification gets a confidence % (0–100) | ⬜ |
| 11J | Root cause frequency dashboard — ranked chart of most common causes, cost per cause | ⬜ |
| 11K | RCA → Action link — auto-create corrective action when high-confidence root cause detected | ⬜ |
| 11L | AI fallback for RCA — when rule-based confidence < 70%, send structured context to AI for diagnosis | ⬜ |

---

## Wave 12 — Predictive Maintenance Engine *(CLAUDE.md: Predictive Maintenance Intelligence)*

> **CLAUDE.md requirement:** "Always attempt to predict: Expected removal dates, Expected replacement dates, Remaining tread life, Upcoming tyre purchases, Future budget requirements, Potential failures. Provide forecasts where possible."

| # | Feature | Status |
|---|---------|--------|
| 12A | Fleet-level replacement schedule calendar — all vehicles, all positions, colour-coded by urgency | ⬜ |
| 12B | Expected removal date per tyre — based on current wear rate and position history | 🔄 Per-asset only (Wave 7G) |
| 12C | Remaining tread life estimation — based on last recorded tread depth and wear rate | ⬜ |
| 12D | Upcoming tyre purchase calendar — 30/60/90-day procurement view for planning | ⬜ |
| 12E | Future budget requirements — 12-month rolling forecast, by site and total fleet | 🔄 3-month per-asset (Wave 7I) |
| 12F | Potential failure risk score — fleet-wide ranking of vehicles most likely to have tyre failure this month | ⬜ |
| 12G | Maintenance planning calendar — workshop scheduling, avoid multiple vehicles at once | ⬜ |
| 12H | Workshop load balancing — distribute planned replacements to avoid workshop bottlenecks | ⬜ |
| 12I | Predictive alert: "X vehicle needs replacement in Y days" — auto-generated alert card | ⬜ |
| 12J | Predictive page `/predictive` — all forecasts, calendar, risk ranking in one view | ⬜ |

---

## Wave 13 — Vendor & Workshop Intelligence *(CLAUDE.md: Vendor Performance Analysis)*

> **CLAUDE.md requirement:** "Automatically compare: Tyre brands, Suppliers, Workshops, Retread vendors. Measure: Cost effectiveness, Durability, Failure frequency, CPK performance, Reliability. Rank vendors objectively."

| # | Feature | Status |
|---|---------|--------|
| 13A | Full vendor scorecard page `/vendor-intelligence` — brands + suppliers + workshops | ⬜ |
| 13B | CPK per brand — ranked table with trend line, best and worst performer highlight | 🔄 BrandPerformance page (partial) |
| 13C | Failure frequency per brand — % of records classified as high/critical per brand | 🔄 BrandPerformance (partial) |
| 13D | Durability ranking — avg km life per brand, position-adjusted | ⬜ |
| 13E | Cost effectiveness score — composite: CPK + failure rate + avg life, ranked 1–N | ⬜ |
| 13F | Supplier entity — add `supplier_name` field to tyre_records, supplier-level aggregation | ⬜ |
| 13G | Workshop performance metrics — turnaround time, cost per job, rework rate, quality score | ⬜ |
| 13H | Retread vendor comparison — retread CPK vs new CPK, success rate per retread supplier | ⬜ |
| 13I | Scrap rate per brand — % of each brand ending as scrap vs retreaded | ⬜ |
| 13J | Vendor reliability trend — 12-month rolling score, improving/declining flag | ⬜ |
| 13K | Procurement recommendation — "Best brand for position X at site Y based on CPK history" | ⬜ |

---

## Wave 14 — Fleet Management Intelligence *(CLAUDE.md: Fleet Management Intelligence)*

> **CLAUDE.md requirement:** "Always evaluate: Fleet availability, Vehicle downtime, Maintenance efficiency, Asset utilization, Operating costs, Replacement planning, Budget impact. Connect tyre performance to business performance."

| # | Feature | Status |
|---|---------|--------|
| 14A | Fleet availability % — % of fleet with no critical tyre risk, by site, trend | ⬜ |
| 14B | Vehicle downtime tracking — tyre-related downtime days per asset, monthly | ⬜ |
| 14C | Maintenance efficiency score — planned vs reactive replacements ratio per site | ⬜ |
| 14D | Asset utilization analysis — vehicle activity vs tyre replacement frequency | ⬜ |
| 14E | Operating cost per vehicle — total tyre cost per km operated, fleet ranking | ⬜ |
| 14F | Replacement planning dashboard — scheduled vs emergency replacements, cost delta | ⬜ |
| 14G | Budget impact analysis — tyre cost as % of vehicle operating cost, by asset class | ⬜ |
| 14H | Fleet profitability score — composite operational health metric per site | ⬜ |
| 14I | Asset life extension tracking — vehicles where tyre management extended asset life | ⬜ |
| 14J | Fleet management dashboard `/fleet-intelligence` — all 14A–14I metrics in one view | ⬜ |

---

## Wave 15 — Advanced Analytics *(CLAUDE.md: Advanced Analytics — 9 types)*

> **CLAUDE.md requirement:** "Where data allows, perform: Trend analysis, Seasonal analysis, Geographic analysis, Country comparison, Branch comparison, Vehicle comparison, Driver comparison, Brand comparison, Failure pattern analysis. Provide management insights, not only raw data."

| # | Feature | Status |
|---|---------|--------|
| 15A | Seasonal analysis — monthly patterns across years (which months have highest failure rates) | ⬜ |
| 15B | Geographic analysis — map or heat map view of performance by region/site cluster | ⬜ |
| 15C | Country comparison enhanced — CPK, failure rate, pressure compliance per country side-by-side | 🔄 CountryComparison page (basic) |
| 15D | Branch comparison enhanced — all KPIs per site, ranking, best/worst, trend arrows | 🔄 SiteComparison page (basic) |
| 15E | Vehicle comparison — select 2–5 assets, compare CPK, cost, failure rate, health score | ⬜ |
| 15F | Driver comparison — link driver_id to tyre records, rank drivers by tyre cost per km | ⬜ |
| 15G | Brand comparison enhanced — CPK, durability, failure rate, scrap rate, all positions | 🔄 BrandPerformance (partial) |
| 15H | Failure pattern analysis — recurring failure sequences, time-between-failure distributions | ⬜ |
| 15I | Trend analysis enhanced — auto-detect acceleration/deceleration of any KPI trend | 🔄 KPI Scorecard regression (partial) |
| 15J | Analytics insights panel — AI-narrated summary of most significant patterns found | ⬜ |

---

## Wave 16 — Data Quality Intelligence *(CLAUDE.md: Data Quality Intelligence)*

> **CLAUDE.md requirement:** "Automatically identify: Incorrect tyre serials, Duplicate tyre numbers, Invalid pressure readings, Missing tread depth readings, Missing inspection records, Inconsistent odometer readings, Unrealistic tyre life values. Flag suspicious data."

| # | Feature | Status |
|---|---------|--------|
| 16A | Incorrect tyre serial detection — format validation, cross-reference against known patterns | ⬜ |
| 16B | Duplicate tyre number detection — same serial on multiple vehicles simultaneously | 🔄 Anomaly engine (partial) |
| 16C | Invalid pressure readings — auto-flag values outside physical range (e.g. 0, >200 PSI) | ⬜ |
| 16D | Missing tread depth detection — inspections with no tread_depth field, flagged per site | ⬜ |
| 16E | Missing inspection record detection — vehicles with no inspection in configurable period | ⬜ |
| 16F | Inconsistent odometer detection — non-sequential km readings across records | 🔄 VehicleHistory local flags (partial) |
| 16G | Unrealistic tyre life flagging — removal after < 100 km or > 200,000 km | ⬜ |
| 16H | Upload batch quality score — each upload gets a data quality % before insert | ⬜ |
| 16I | Data cleaning auto-run — apply brand alias, normalize sizes, trim whitespace on every upload | ⬜ |
| 16J | Data quality dashboard on DataCleaning page — all flags in one view with fix actions | ⬜ |

---

## Wave 17 — Executive Intelligence & Reporting *(CLAUDE.md: Executive Reporting Standards)*

> **CLAUDE.md requirement:** "When producing tyre reports include: Executive Summary, KPI Dashboard, Root Cause Analysis, Financial Impact, Risk Assessment, Recommendations, Action Plan. Reports should support management decisions, not simply display information."

| # | Feature | Status |
|---|---------|--------|
| 17A | Executive Summary report — auto-generated monthly PDF: key findings, top risks, cost headline | ⬜ |
| 17B | KPI Dashboard narrative — text summary of which KPIs passed/failed and by how much | ⬜ |
| 17C | Root Cause Analysis section — top 5 causes this month with cost attributed to each | ⬜ |
| 17D | Financial Impact section — savings identified, cost vs benchmark, overspend root cause | ⬜ |
| 17E | Risk Assessment section — operational risk rating per site (Low/Medium/High/Critical) | ⬜ |
| 17F | Recommendations section — auto-generated prioritised action list (rule-based + AI narration) | ⬜ |
| 17G | Action Plan section — assigned actions, responsible person, deadline, status tracking | ⬜ |
| 17H | One-click Monthly Executive PDF — all 7 sections in branded A4 PDF, email-ready | ⬜ |
| 17I | Management dashboard `/executive` — Director/Admin view, C-suite level summary | ⬜ |
| 17J | Scheduled report delivery — email executive PDF to configured recipients on 1st of month | ⬜ |

---

## Wave 18 — Forecasting Engine *(CLAUDE.md: Forecasting Standards)*

> **CLAUDE.md requirement:** "Use available data to estimate: Annual tyre budgets, Future tyre demand, Replacement schedules, Vendor requirements, Inventory requirements, Expected failures. Support proactive planning."

| # | Feature | Status |
|---|---------|--------|
| 18A | Annual tyre budget forecast — 12-month projection by site and fleet total | 🔄 3-month per-asset (Wave 7I) |
| 18B | Future tyre demand by site — how many tyres needed per site per month, next 6 months | ⬜ |
| 18C | Replacement schedule with procurement timeline — when to order vs when to fit | 🔄 Fleet calendar (Wave 12A) |
| 18D | Vendor/supplier requirements forecast — units required per brand/supplier, next quarter | ⬜ |
| 18E | Inventory requirements by site — reorder quantities and timing per site | 🔄 Stock velocity (Wave 7J) |
| 18F | Expected failure count forecast — statistical prediction of failures next 30/60/90 days | ⬜ |
| 18G | Budget vs forecast tracking — actual spend vs forecast, variance alerts | ⬜ |
| 18H | Forecasting page `/forecasting` — all forecasts, confidence intervals, export to Excel | ⬜ |

---

## Wave 19 — Continuous Improvement Engine *(CLAUDE.md: Continuous Improvement)*

> **CLAUDE.md requirement:** "Always identify: Cost reduction opportunities, Reliability improvements, Process improvements, Inspection improvements, Maintenance improvements, Procurement improvements. Every tyre analysis should generate actionable recommendations."

| # | Feature | Status |
|---|---------|--------|
| 19A | Cost reduction opportunity identification — auto-detect: switching brand X to Y saves Z per year | ⬜ |
| 19B | Reliability improvement tracking — month-over-month improvement in failure rate per site | ⬜ |
| 19C | Process improvement recommendations — flag sites where reactive > planned replacements | ⬜ |
| 19D | Inspection improvement suggestions — flag inspectors with lowest quality scores + coaching prompts | ⬜ |
| 19E | Maintenance improvement tracking — measure impact of corrective actions over time | ⬜ |
| 19F | Procurement optimization — identify best brand per position based on CPK, suggest switches | ⬜ |
| 19G | Workshop productivity improvement — flag workshops with high rework rate or long turnaround | ⬜ |
| 19H | Improvement scorecard — track all 19A–19G as KPIs, show trend over 6 months | ⬜ |

---

## Wave 20 — RAG & Knowledge System Infrastructure *(CLAUDE.md: RAG & Knowledge System)*

> **CLAUDE.md requirement:** "Use RAG whenever data grows beyond prompt limits. Never load full datasets into prompts. Knowledge Architecture: Operational DB + Analytics DB + Vector DB + File Storage. Retrieval Rules: Search structured → Search vector → Rank → Retrieve → Generate. Design for millions of records, hundreds of customers, long-term historical storage."

### 20A — Database Layer Completion

| # | Feature | Status |
|---|---------|--------|
| 20A-1 | MIGRATIONS_V12 — `app_settings` table (key/value, required for Wave 7B) | ⬜ |
| 20A-2 | MIGRATIONS_V13 — `ai_response_cache` table (query_hash, response, created_at, expires_at, tokens_used) | ⬜ |
| 20A-3 | MIGRATIONS_V14 — `document_chunks` table (id, source_type, source_id, content, embedding vector, metadata jsonb) | ⬜ |
| 20A-4 | MIGRATIONS_V15 — `kpi_snapshots` table (analytics DB layer: monthly KPI aggregations pre-computed) | ⬜ |
| 20A-5 | MIGRATIONS_V16 — `driver_records` table (driver_id, name, asset_no, site — links to tyre records) | ⬜ |
| 20A-6 | Enable pgvector extension in Supabase | ⬜ |
| 20A-7 | Database indexing audit — add composite indexes on (asset_no, issue_date), (site, issue_date), (country, issue_date), (risk_level, issue_date) | ⬜ |

### 20B — Vector Knowledge Base

| # | Feature | Status |
|---|---------|--------|
| 20B-1 | SOP document ingestion — upload PDF SOPs, chunk into 512-token segments, embed, store in document_chunks | ⬜ |
| 20B-2 | Maintenance manual ingestion — same pipeline as SOPs | ⬜ |
| 20B-3 | Policy document ingestion — company tyre policies, spec sheets | ⬜ |
| 20B-4 | Inspection comment embedding — nightly job embeds all inspection comments and RCA notes | ⬜ |
| 20B-5 | Maintenance history embedding — historical records chunked and indexed for retrieval | ⬜ |
| 20B-6 | PDF report storage — generated reports stored in Supabase Storage, indexed with metadata | ⬜ |
| 20B-7 | Historical knowledge base — all RCA records, corrective actions embedded and retrievable | ⬜ |

### 20C — Retrieval Service (`src/lib/ragEngine.js`)

| # | Feature | Status |
|---|---------|--------|
| 20C-1 | Structured data retrieval — query tyre_records/inspections/RCA by relevance to user query | ⬜ |
| 20C-2 | Vector similarity search — cosine similarity search on document_chunks using pgvector | ⬜ |
| 20C-3 | Relevance ranking — combine structured + vector scores, return top-K results | ⬜ |
| 20C-4 | Context assembly — build prompt context from retrieved chunks, never exceed 8K tokens | ⬜ |
| 20C-5 | Response caching — check ai_response_cache before calling AI (24h TTL) | ⬜ |
| 20C-6 | Cache invalidation — invalidate when relevant records updated | ⬜ |
| 20C-7 | Token usage tracking — log every AI call's token count to ai_response_cache | ⬜ |

### 20D — Historical Intelligence

| # | Feature | Status |
|---|---------|--------|
| 20D-1 | Full vehicle history query — any asset, any date range, even years of data, sub-second | ⬜ |
| 20D-2 | Full tyre history query — any serial, track across vehicles and sites | ⬜ |
| 20D-3 | Full inspection history query — any vehicle/site, full archive accessible | ⬜ |
| 20D-4 | Full cost history query — any period, any grouping, no timeout on large datasets | ⬜ |
| 20D-5 | Full maintenance history query — all corrective actions, RCA, workshops, chronological | ⬜ |
| 20D-6 | Data archiving strategy — records older than 3 years moved to archive partition, still queryable | ⬜ |

---

## Wave 21 — Multi-Agent AI System *(CLAUDE.md: Multi-Agent System + AI Router)*

> **CLAUDE.md requirement:** "AI Router classifies every request into: Fleet Analysis, Tyre Engineering Diagnosis, Cost Optimization, Reporting, Data Cleaning, Operational Planning, Anomaly Detection. Analyst Agent, Tyre Engineer Agent, QA Data Agent, Planner Agent. Never guess without flagging uncertainty. Always explain cause before solution. Every output must be actionable."
> **Depends on Wave 20 (RAG layer) being complete first.**

### 21A — AI Router

| # | Feature | Status |
|---|---------|--------|
| 21A-1 | Query classifier — classifies user input into 7 categories (rule-based, no AI cost) | ⬜ |
| 21A-2 | Intent extraction — extract: asset_no, site, date_range, metric from query | ⬜ |
| 21A-3 | Agent selector — route to one or more agents based on classification | ⬜ |
| 21A-4 | Confidence flagging — flag response when data is insufficient or ambiguous | ⬜ |

### 21B — Analyst Agent

| # | Feature | Status |
|---|---------|--------|
| 21B-1 | Trend analysis — retrieve relevant KPI history, compute trend, narrate finding | ⬜ |
| 21B-2 | KPI diagnosis — explain why a KPI is failing and what drove the change | ⬜ |
| 21B-3 | Cost breakdown — structured cost analysis by site/brand/asset with narrative | ⬜ |
| 21B-4 | Fleet comparison — compare two or more sites/periods with delta analysis | ⬜ |

### 21C — Tyre Engineer Agent

| # | Feature | Status |
|---|---------|--------|
| 21C-1 | Wear pattern diagnosis — identify abnormal wear from tyre records + inspection data | ⬜ |
| 21C-2 | Pressure failure analysis — diagnose under/over inflation cause and risk | ⬜ |
| 21C-3 | Alignment issue detection — pattern recognition across position + removal reason | ⬜ |
| 21C-4 | Root cause logic — structured root cause with evidence, confidence score, recommendation | ⬜ |

### 21D — QA Data Agent

| # | Feature | Status |
|---|---------|--------|
| 21D-1 | Excel/ERP data cleaning — auto-detect format, normalize, flag issues before insert | ⬜ |
| 21D-2 | Duplicate removal — smart deduplication beyond exact match (fuzzy serial matching) | ⬜ |
| 21D-3 | Format standardization — brand names, tyre sizes, dates, site names normalized | 🔄 tyreClassifier.js (partial) |
| 21D-4 | Data quality report — after each upload, show quality score and list of issues fixed | ⬜ |

### 21E — Planner Agent

| # | Feature | Status |
|---|---------|--------|
| 21E-1 | Maintenance scheduling — generate optimal replacement schedule for next 30/60/90 days | ⬜ |
| 21E-2 | Tyre forecasting — demand forecast per site, recommend stock levels | ⬜ |
| 21E-3 | Workshop load balancing — distribute work orders to avoid peak overload | ⬜ |
| 21E-4 | Procurement planning — generate purchase recommendation with quantities and timing | ⬜ |

### 21F — Infrastructure

| # | Feature | Status |
|---|---------|--------|
| 21F-1 | AI cost monitor — dashboard showing daily/monthly AI spend vs budget target | ⬜ |
| 21F-2 | Rate limiting — per-user AI call limits to prevent runaway costs | ⬜ |
| 21F-3 | Fallback strategies — all agents fall back to rule-based output when AI unavailable | ⬜ |
| 21F-4 | Agent response format enforcement — every response: Observation → Root Cause → Risk Level → Action Plan → KPI Impact | ⬜ |

---

## Wave 22 — Enterprise & Scale *(CLAUDE.md: Architecture Standards)*

> **CLAUDE.md requirement:** "Design for Multi-tenant SaaS, Enterprise scale, Millions of records. Always include Auth systems, RBAC, Audit logs, Monitoring, Backups, Analytics, Security layers. Never design only for current needs."

| # | Feature | Status |
|---|---------|--------|
| 22A | Multi-tenant architecture — tenant_id on all tables, per-tenant RLS policies, tenant settings | ⬜ |
| 22B | SSO / SAML integration — Azure AD, Google Workspace, enterprise login | ⬜ |
| 22C | API webhook system — push events to ERP on tyre change, alert, inspection | ⬜ |
| 22D | Scheduled report delivery — cron-triggered PDF emails on configurable schedule | ⬜ |
| 22E | Data retention policy enforcement — archive/delete records beyond configured threshold | ⬜ |
| 22F | White-label branding — logo, colours, report headers per tenant | ⬜ |
| 22G | Advanced RBAC — custom role builder, field-level permissions, approval workflows | ⬜ |
| 22H | Performance monitoring — query time tracking, slow query alerts, Supabase observability | ⬜ |
| 22I | Automated backup verification — weekly restore test, alert on failure | ⬜ |
| 22J | Disaster recovery plan — documented RTO/RPO, tested restore procedure | ⬜ |
| 22K | Security audit — penetration test, OWASP compliance review, RLS policy review | ⬜ |
| 22L | Offline PWA — service worker, sync queue for inspections without internet | ⬜ |

---

## Wave 23 — Mobile & Integrations

> **CLAUDE.md requirement (Tyre Pulse Specific):** "Fleet profitability, Cost control, Reliability, Compliance, Asset life extension, Predictive maintenance, Procurement optimization, Workshop productivity."

| # | Feature | Status |
|---|---------|--------|
| 23A | React Native mobile app — Tyre Man workflow, inspections, gate pass, offline capable | ⬜ |
| 23B | ERP integration — SAP/Oracle read-only fleet data sync, tyre change write-back | ⬜ |
| 23C | Tyre supplier portal — supplier submits invoices, matched against stock_movements | ⬜ |
| 23D | Workshop management module — job cards, technician assignment, labour cost tracking | ⬜ |
| 23E | Barcode / QR code scanner — scan tyre sidewall to register serial number | ⬜ |
| 23F | GPS telematics integration — auto-populate odometer from fleet GPS system | ⬜ |
| 23G | Email generation with attached reports — Wave 5D, enabled by Wave 17J | ⬜ |

---

## Migrations Roadmap

| File | Status | What it adds |
|------|--------|--------------|
| `SUPABASE_SCHEMA.sql` | ✅ Applied | Core tables, RLS scaffolding |
| `MIGRATIONS.sql` | ✅ Applied | due_date, inspections, stock_movements, audit_log, kpi_targets |
| `BACKEND_RLS.sql` | ✅ Applied | get_my_role() + role-based policies |
| `MIGRATIONS_V2–V9` | ✅ Applied | km fields, photo_data, inspections expansion, positions |
| `MIGRATIONS_V10.sql` | ✅ Applied | profiles: employee_id, approved, country[]; accidents table |
| `MIGRATIONS_V11.sql` | ✅ Applied | gate_passes table with RLS |
| `MIGRATIONS_V12.sql` | ⬜ Required now | `app_settings` table — key/value store (needed by Wave 7B) |
| `MIGRATIONS_V13.sql` | ⬜ Wave 20 | `ai_response_cache` — query_hash, response, tokens_used, expires_at |
| `MIGRATIONS_V14.sql` | ⬜ Wave 20 | `document_chunks` — id, source_type, content, embedding (vector), metadata |
| `MIGRATIONS_V15.sql` | ⬜ Wave 20 | `kpi_snapshots` — pre-computed monthly KPI aggregations |
| `MIGRATIONS_V16.sql` | ⬜ Wave 21 | `driver_records` — driver_id, name, assigned_assets, site |

---

## Architecture Reference

```
src/
├── App.jsx                      — 30+ routes, ProtectedRoute, RoleRoute
├── contexts/
│   ├── AuthContext.jsx          — Session, profile, 1-hour idle timeout
│   └── SettingsContext.jsx      — activeCountry, currency, global settings
├── components/
│   ├── Layout.jsx               — Sidebar, Cmd+K search, role-based nav
│   ├── ProtectedRoute.jsx       — Auth guard, pending approval, RoleRoute
│   ├── ChartModal.jsx           — Fullscreen chart + date filter + PNG
│   ├── VehicleTyreDiagram.jsx   — SVG diagram, risk colour coding
│   └── StatCard.jsx             — KPI cards (clickable)
└── lib/
    ├── supabase.js
    ├── tyreClassifier.js        — 13-category auto-classification
    ├── analyticsEngine.js       — Stats, regression, CPK, brand/site/KPI metrics
    ├── alertEngine.js           — Stock, budget, overdue, HIGH_CPK, VEHICLE_INACTIVE
    ├── anomalyEngine.js         — 6 anomaly patterns
    ├── aiAnalytics.js           — Smart Analytics (needs RAG refactor in Wave 20)
    ├── ragEngine.js             — [Wave 20] Retrieval layer
    └── exportUtils.js           — Excel, branded PDF, PowerPoint

Planned additions (Wave 20–21):
└── lib/
    ├── ragEngine.js             — Vector search, context assembly, cache
    ├── agentRouter.js           — Query classification + agent selection
    ├── agents/
    │   ├── analystAgent.js      — Trends, KPIs, cost breakdown
    │   ├── tyreEngineerAgent.js — Wear, pressure, alignment, RCA
    │   ├── qaDataAgent.js       — Clean, deduplicate, normalize
    │   └── plannerAgent.js      — Schedule, forecast, balance
    └── kpiEngine.js             — All 17 KPIs auto-computed on demand
```

---

## Next Session — Priority Order

1. **MIGRATIONS_V12** — `app_settings` table (blocking Wave 7B in production)
2. **Wave 8** — Engineering KPI Engine: CPK dashboard page, pressure compliance %, avg tyre life
3. **Wave 9** — Inspection intelligence: compliance %, anomaly detection
4. **Wave 10** — Position intelligence page
5. **Wave 11** — Root cause classification engine (rule-based, 14 causes)

---

*TyrePulse v4.0 · Readymix Concrete Company · Shahzeb Rahman © 2026*
*Fully governed by CLAUDE.md — every section maps to a specific instruction*
