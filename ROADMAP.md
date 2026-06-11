# TyrePulse — Complete Product Roadmap
**Readymix Concrete Company · Built by Shahzeb Rahman © 2026**
**Version 6.1 · Updated June 2026 · Governed by CLAUDE.md**

---

## Status Key

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete and deployed |
| 🔄 | In progress |
| ⬜ | Planned |

---

## Product Health

| Metric | Status |
|--------|--------|
| Web build | ✅ Builds clean · 369/369 tests passing |
| Web pages | ✅ 73 pages registered and routed |
| Web auth + RBAC | ✅ Role-based routes, 30-min timeout, admin approval |
| Web hosting | ✅ Vercel (auto-deploy on push to `main`) |
| Web data integrity | ✅ Checklist TDZ crash fixed; `vehicles`/`tyre_changes` views + `alerts` table + perf indexes added |
| Database | ✅ Supabase PostgreSQL + Auth + Storage + pgvector |
| Mobile app | ✅ React Native (Expo SDK 53) — 6 screens (incl. scanner), offline-first |
| Mobile inspection flow | ✅ Aligned to live schema; inspector RLS insert enabled |
| Mobile i18n | ✅ English + Arabic (RTL) + Urdu (RTL) — full parity |
| Mobile EAS build | ✅ Green — auto-builds on push to `main` |
| Mobile Play Store | ⬜ Pending store listing + signing |

---

## Waves 1–20 — Web Platform *(Complete)*

### Wave 1 — Security, Auth & Access Control ✅
- 30-minute idle session timeout, touch events tracked
- Login via Email, Username, or Employee ID
- Role-based access: Intelligence (Admin), Analytics (Admin+Manager+Director)
- Admin-only approval gate for new signups
- Multi-country assignment in UserManagement

### Waves 2–6 — Upload, Dashboard, Inspections, Gate Pass, Comparison ✅
All features complete. See PHASE2_CHECKLIST.md.

### Wave 7 — Operational Intelligence ✅
KPI targets, VehicleHistory forecasting, StockManagement velocity, Reports.

### Wave 8 — Engineering KPI Engine ✅
CPK, tyre life, failure rate, pressure compliance, retread performance, vendor KPI — all 11 KPIs with PDF/Excel export.

### Wave 9 — Pressure & Inspection Intelligence ✅
Pressure compliance, anomaly detection, inspector quality score, compliance dashboard.

### Wave 10 — Tyre Position Intelligence ✅
CPK per position, failure rates, heat map, rotation compliance tracker.

### Wave 11 — Root Cause Intelligence Engine ✅
14 root causes, automated classification, AI fallback, corrective action linking.

### Wave 12 — Predictive Maintenance Engine ✅
Replacement schedules, tread life estimation, 30/60/90-day purchase calendar, workshop load balancing.

### Wave 13 — Vendor & Workshop Intelligence ✅
Vendor scorecard, CPK ranking, retread ROI calculator, workshop metrics.

### Wave 14 — Fleet Management Intelligence ✅
Fleet availability, downtime tracking, live fleet status, health board.

### Wave 15 — Advanced Analytics ✅
Seasonal analysis, country/branch/vehicle/driver comparison, AI-narrated summaries.

### Wave 16 — Data Quality Intelligence ✅
Duplicate detection, invalid readings, missing inspections, data quality score.

### Wave 17 — Executive Intelligence & Reporting ✅
One-click monthly executive PDF, KPI narrative, root cause section, financial impact.

### Wave 18 — Forecasting Engine ✅
Annual budget forecast, 30/60/90-day demand, stock replenishment matrix.

### Wave 19 — Continuous Improvement Engine ✅
Cost reduction identification, reliability tracking, procurement optimization.

### Wave 20 — Daily Operations & Checklist ✅
| Feature | Status |
|---------|--------|
| Daily Ops dashboard | ✅ |
| Inspection checklist — bilingual EN/AR | ✅ |
| Auto-title, site/asset dropdowns, inspector auto-fill | ✅ |
| Vehicle diagram — SVG, case-insensitive, correct positions | ✅ |
| `tyre_conditions` JSONB + `vehicle_type` saved | ✅ |
| PDF export — captures actual SVG diagram | ✅ |

---

## Wave 21 — RAG & Knowledge System 🔄

| Component | Status |
|-----------|--------|
| pgvector extension | ✅ |
| `knowledge_documents` table | ✅ |
| `ai_response_cache` table | ✅ |
| `ragService.js` — retrieval + 5-min cache | ✅ |
| `embeddingService.js` — batch embedding | ✅ |
| Edge Function: `generate-embedding` | ✅ |
| Document ingestion pipeline (SOPs, manuals) | ⬜ |
| Nightly inspection comment embedding job | ⬜ |
| Historical data archiving strategy | ⬜ |

---

## Wave 22 — Multi-Agent AI System 🔄

| Component | Status |
|-----------|--------|
| `aiRouter.js` — query classification | ✅ |
| Analyst, TyreEngineer, QAData, Planner agents | ✅ |
| AI Command Center UI | ✅ |
| AI cost monitor dashboard | ⬜ |
| Per-user rate limiting | ⬜ |
| Response format enforcement | 🔄 |

---

## Wave 23 — Enterprise & Scale 🔄

| Feature | Status |
|---------|--------|
| ERP Sync UI | ✅ |
| Audit trail | ✅ |
| Multi-country architecture (KSA/UAE/Egypt) | ✅ |
| RBAC — 6 roles, tiered | ✅ |
| API webhook for ERP write-back | ⬜ |
| Scheduled report delivery (cron email) | ⬜ |
| Multi-tenant architecture (tenant_id) | ⬜ |
| SSO / SAML integration | ⬜ |

---

## Wave 24 — Mobile Inspector App 🔄

### Architecture Decision
**React Native + Expo SDK 54** — chosen over Capacitor/Flutter/Native Kotlin.

Reasons:
- Shared TypeScript codebase with web (types, business logic)
- Expo managed workflow = no Xcode/Android Studio required
- EAS Build = cloud APK/AAB without local toolchain
- Expo modules are New Architecture ready
- Full access to camera, secure storage, file system, network APIs

### Current Build Stack
| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React Native | 0.79.2 |
| Expo SDK | Managed Workflow | 54.0.0 |
| Router | expo-router | 5.0.0 |
| Auth storage | expo-secure-store | 14.0.1 |
| Offline queue | AsyncStorage | 2.1.2 |
| Network | expo-network | 7.1.5 |
| Camera | expo-camera + expo-image-picker | 16.x |
| i18n | Custom LanguageContext | — |
| Build | EAS Build (cloud) | CLI 20.1.0 |
| CI/CD | GitHub Actions | ubuntu-latest |

### Screens Delivered

| Screen | Status | Description |
|--------|--------|-------------|
| Login | ✅ | Supabase auth + EN/AR/UR language selector |
| Home | ✅ | Greeting, pending sync count, quick-start inspection |
| New Inspection | ✅ | Multi-step: vehicle details → tyre position cards |
| History | ✅ | All inspections, sync status badges |
| Profile | ✅ | User info, language toggle, offline queue, sign out |

### i18n

| Language | Script | Direction | Status |
|----------|--------|-----------|--------|
| English | Latin | LTR | ✅ |
| Arabic (MSA) | Arabic | RTL | ✅ |
| Urdu | Nastaliq | RTL | ✅ |

- Language selector on Login screen (before auth) + Profile screen (after auth)
- App restarts on language switch to apply RTL layout via `I18nManager.forceRTL()`
- Persisted in AsyncStorage (`tp_language`)

### Offline Architecture

```
Inspection created on device
  └─ offlineQueue.addToQueue(payload)
       └─ AsyncStorage key: tp_inspection_queue_v1
       └─ sync_status: 'pending'

SyncBanner.addNetworkStateListener fires on reconnect
  └─ syncQueue() → POST to Supabase inspections
       └─ success → sync_status: 'synced'
       └─ fail   → sync_status: 'failed', retry_count++
  └─ retryFailed() → re-queues failed items
```

### Build Fixes Applied

| Commit | Fix |
|--------|-----|
| `4e92755` | Add `expo-build-properties` to package.json |
| `6b79a34` | Kotlin 2.0.21 (RN 0.79.2 requirement) |
| `4ddcf1a` | TypeScript fix, expo-updates local install |
| `1f3a46e` | Replace netinfo with expo-network; add SDK 35 build config |
| `ea24776` | Disable New Architecture (`newArchEnabled: false`); pin NDK 27.1.12297006 |

### Wave 24 — Remaining Features

| Feature | Priority | Status |
|---------|----------|--------|
| Working EAS APK build | P0 | 🔄 |
| Photo upload to Supabase Storage | P0 | ⬜ |
| Test APK on Samsung M10 | P0 | ⬜ |
| Play Store submission | P1 | ⬜ |
| Barcode/QR scanner for tyre serial | P1 | ⬜ |
| Push notifications (inspection reminders) | P1 | ⬜ |
| GPS location tagging on inspections | P2 | ⬜ |
| Driver mobile app (separate role/flow) | P2 | ⬜ |
| Workshop mobile app | P3 | ⬜ |
| OTA updates via expo-updates | P2 | ⬜ |

---

## Wave 25 — AI Mobile Features ⬜

| Feature | Status |
|---------|--------|
| AI tyre wear analysis from photo | ⬜ |
| OCR reading of tyre serial numbers | ⬜ |
| Voice inspection input | ⬜ |
| Predictive maintenance alerts (push) | ⬜ |
| On-device anomaly detection | ⬜ |

---

## Wave 26 — Enterprise Mobile ⬜

| Feature | Status |
|---------|--------|
| Multi-tenant mobile (company switch) | ⬜ |
| Fleet manager mobile dashboard | ⬜ |
| MDM / Enterprise app distribution | ⬜ |
| iOS app (EAS build iOS profile) | ⬜ |
| Real-time fleet tracking (GPS + live map) | ⬜ |

---

## Migrations — Current State

Run `MIGRATIONS_SAFE.sql` first (idempotent), then:

```sql
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS tyre_conditions jsonb;
CREATE INDEX IF NOT EXISTS idx_inspections_tyre_conditions ON inspections USING gin(tyre_conditions);
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS vehicle_type text;
CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_type ON inspections (vehicle_type);

CREATE OR REPLACE FUNCTION get_user_email_by_id(user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = user_id;
  RETURN v_email;
END;
$$;
GRANT EXECUTE ON FUNCTION get_user_email_by_id(uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS profiles_employee_id_idx ON profiles (employee_id);
CREATE INDEX IF NOT EXISTS profiles_username_idx ON profiles (username);

-- Mobile RLS
CREATE POLICY IF NOT EXISTS "Inspector can insert own inspections"
ON inspections FOR INSERT TO authenticated
WITH CHECK (inspector_id = auth.uid());
```

---

## Supabase Edge Functions

| Function | Status | Purpose |
|----------|--------|---------|
| `chat-ai` | ✅ | Anthropic API proxy |
| `generate-embedding` | ✅ | OpenAI embeddings proxy |
| `send-email` | ✅ | Resend API email delivery |

Env vars: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`

---

## Immediate Priorities

### P0 — This Sprint
1. Confirm EAS build `ea24776` passes (New Architecture disabled + NDK pinned)
2. Download APK from expo.dev, install on Samsung M10
3. Verify login → inspection → sync flow end-to-end
4. Fix any runtime bugs found on device

### P1 — Next Sprint
5. Photo upload to Supabase Storage
6. Barcode scanner for tyre serial input
7. Play Store account setup + signing keys
8. RAG document ingestion pipeline (web)

### P2 — Following Sprint
9. Push notifications
10. GPS tagging on inspections
11. AI cost monitor (web)
12. Scheduled email reports (web)

---

*TyrePulse v6.1 · Readymix Concrete Company · Shahzeb Rahman © 2026*
*Fully governed by CLAUDE.md*
