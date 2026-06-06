# TyrePulse — Feature Roadmap & Progress

## How to Read This File
- ✅ Done and deployed to feature branch
- 🔄 In progress
- ⬜ Planned, not started yet

---

## Wave 1 — Security, Auth & Access Control

| # | Feature | Status |
|---|---------|--------|
| 1A | Remove AI/Anthropic branding from visible UI | ✅ |
| 1B | 1-hour idle session timeout | ✅ |
| 1C | Role-based page access (Admin-only routes) | ✅ |
| 1D | Admin-only nav items hidden from non-Admins | ✅ |
| 1E | Forgot password flow + reset page | ✅ |
| 1F | Employee ID field in signup | ✅ |
| 1G | Show/hide password toggle on all password fields | ✅ |
| 1H | Pending admin approval workflow | ✅ |
| 1I | UserManagement: Approve button + multi-country assignment | ✅ |
| 1J | MIGRATIONS_V10 (employee_id, approved, country[], upload_batch_id, accidents table) | ✅ |

---

## Wave 1 — UX & Export Polish (completed earlier)

| # | Feature | Status |
|---|---------|--------|
| P1 | PDF export: green header, auto-fit columns, risk colour cells | ✅ |
| P2 | Remove em-dashes from all UI text and exports | ✅ |
| P3 | Rename AI Analytics → Smart Analytics in UI and nav | ✅ |
| P4 | Dashboard: clickable KPI cards linking to relevant pages | ✅ |
| P5 | Dashboard: Quick Actions row (Anomaly Scan, Alerts, Upload, Inspections) | ✅ |
| P6 | Anomaly page: search-first drill-down by asset number | ✅ |
| P7 | Upload page: type selector (Tyre / Fleet / Auto-detect) | ✅ |
| P8 | Inspections: Site Observations tab with photo upload | ✅ |
| P9 | Inspections: Training tab (Safety Training, Training Session types) | ✅ |
| P10 | Inspections: Raise Corrective Action from completed observations | ✅ |
| P11 | Corrective Actions and RCA Records: photo attachments | ✅ |
| P12 | Vehicle History: richer inspection history display | ✅ |
| P13 | Data Cleaning: search, pagination, undo last clean, remarks preview | ✅ |
| P14 | Fleet Master: bulk vehicle upload | ✅ |
| P15 | Audit Trail page with upload history and activity log | ✅ |

---

## Wave 2 — Upload Intelligence & Dashboard Depth

| # | Feature | Status |
|---|---------|--------|
| 2A | Multi-sheet Excel upload with sheet picker (select/skip sheets) | ✅ |
| 2B | Stock upload mapping (4th upload type, maps to stock_records) | ✅ |
| 2C | Upload batch delete — Admin can remove all records from a batch | ✅ |
| 2D | Dashboard date shortcuts (Today / This Week / This Month / This Year / Custom) | ✅ |
| 2E | Dashboard period breakdown toggle (Daily / Weekly / Monthly / Yearly) | ✅ |
| 2F | Tyre forecast card on Dashboard (rolling 3-month projection) | ✅ |

---

## Wave 3 — New Pages

| # | Feature | Status |
|---|---------|--------|
| 3A | Accidents / Incident Tracking page with dashboard | ✅ |
| 3B | Custom Reports page (report builder with filters + Excel/PDF output) | ✅ |
| 3C | Chart enlargement modal (fullscreen any chart with date filter) | ✅ |

---

## Wave 4 — Inspections & Vehicle Diagrams

| # | Feature | Status |
|---|---------|--------|
| 4A | Vehicle tyre position SVG diagram in Vehicle History | ✅ |
| 4B | Vehicle type icons (🛻 Pickup, 🚛 Tri-mixer, 🏗️ Pump, 🚚 Canter, 🚜 Loader) | ✅ |
| 4C | Daily inspection checklist — mobile-optimised with tyre pressure fields | ✅ |
| 4D | Inspection PDF with pressure readings and condition colours | ✅ |
| 4E | Tyre Inspector role (inspections page only, all other nav hidden) | ✅ |

---

## Wave 5 — Polish & Access

| # | Feature | Status |
|---|---------|--------|
| 5A | App logo SVG (tyre/wheel icon, used in sidebar and login header) | ✅ |
| 5B | Country-based access lock (non-Admin locked to assigned country) | ✅ |
| 5C | Navigation auto-collapse during active upload | ✅ |
| 5D | Email generation with attached reports | ⬜ |
| 5E | Theme improvements: depth, gradients, card shadows | ⬜ |
| 5F | Empty space cleanup across all pages | ⬜ |

---

## Wave 6 — New Features

| # | Feature | Status |
|---|---------|--------|
| 6A | Gate Pass system — daily inspection clearance, issue/deny, policy PDF | ✅ |
| 6B | Smart cross-user duplicate detection on upload (exact dups, serial conflicts, re-upload warning) | ✅ |
| 6C | Serial number lifecycle tracker page | ✅ |
| 6D | Month/year comparison analytics (Period A vs B, bar chart, summary table) | ✅ |
| 6E | MIGRATIONS_V11 (gate_passes table) | ✅ |

---

## AI Intelligence Roadmap (Phase 2)

| # | Feature | Approach | AI Cost | Status |
|---|---------|----------|---------|--------|
| AI-1 | Data cleaning auto-run on upload (brand/size/vehicle normalization) | Rule-based | None | ⬜ |
| AI-2 | Advanced Excel: merged cells, hidden cols, multi-currency dates | Rule-based | None | ⬜ |
| AI-3 | Manager Decision Support Center (top cost vehicles, CPK, recommendations) | SQL templates | None | ⬜ |
| AI-4 | RCA Hybrid Engine (rules first, AI fallback below 70% confidence) | Hybrid | Low | ⬜ |
| AI-5 | Tyre Life Prediction (rolling average projection, replacement forecast) | SQL + stats | None | ⬜ |
| AI-6 | Enhanced Fraud Detection (serial conflicts, workshop abuse, mileage manipulation) | Rule-based | None | ⬜ |
| AI-7 | AI Fleet Assistant — context-limited queries + 24h result caching | AI on-demand | Low | ⬜ |
| AI-8 | OCR tyre image upload (extract brand, size, DOT, serial from photo) | AI vision | Medium | ⬜ |
| AI-9 | Cost control: token usage monitor + cache table + $20/month target | Infrastructure | None | ⬜ |

---

## Migrations Reference

| File | Status | Description |
|------|--------|-------------|
| MIGRATIONS_V1 to V5 | ✅ Applied | Base schema, fleet, stock, inspections, alerts |
| MIGRATIONS_V6_AUDIT.sql | ✅ Applied | audit_log table |
| MIGRATIONS_V7.sql | ✅ Applied | tyre_records.position field |
| MIGRATIONS_V8.sql | ✅ Applied | Inspections: photos, attendees, severity, linked_action_id |
| MIGRATIONS_V9.sql | ✅ Applied | corrective_actions and rca_records photo_data |
| MIGRATIONS_V10.sql | ⬜ Run in Supabase | profiles: employee_id, approved, country[]; tyre_records: upload_batch_id; accidents table |
| MIGRATIONS_V11.sql | ⬜ Run in Supabase | gate_passes table with RLS |
