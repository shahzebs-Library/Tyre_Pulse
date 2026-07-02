# TyrePulse Project - Missing Features & Gap Analysis

**Last Updated:** 2026-07-02  
**Status:** 10 Open PRs | Phase 1 Security Hardening in Progress  
**Repository:** shahzebs-Library/Tyre_Pulse (4.5 MB, 28 days old)

---

## 📊 Executive Summary

TyrePulse is a **fleet tyre management SaaS** with:
- ✅ **Web app** (React + Vite) — 83% complete, production-ready
- ✅ **Mobile app** (Expo/TypeScript) — feature-complete, shipped
- ✅ **Export capabilities** (PDF, Excel, PowerPoint) — ✅ NEW docs added
- ⚠️ **Go backend** (in-progress migration) — Phase 1 foundation
- ⚠️ **Android native app** (Kotlin/Compose) — foundation in PR #15
- ⚠️ **Security hardening** — 6 active PRs, Phase 1 in progress

**10 open PRs represent coordinated security & architecture work** — not scattered bugs.

---

## 🚨 Critical Gaps & Missing Features

### 1. **SECURITY HARDENING (Phase 1) — 6 PRs**

| Phase | PR # | Status | What's Missing | Impact |
|-------|------|--------|-----------------|--------|
| 0 | #17 | 📋 Docs | Audit docs baseline (RESOLVED) | Framework set |
| 1a | #18 | 🔧 Code | PWA cache hardening, logout clear, secret guard | **Medium** — data lingering in browser cache |
| 1b | #19 | 🔧 Code | Org-scope foundation (`organisation_id` on 23 tables) | **Critical** — no org isolation yet |
| 1c | #20 | 🔧 Code | Enforce RLS org isolation + isolation tests | **Critical** — cross-org access risk |
| 1d | #21 | 🔧 Code | `src/lib/api/` service layer (assets, tyres modules) | **High** — 276 web, 86 mobile inline Supabase calls |
| 1e | #22 | 🔧 Code | File metadata + private storage (S7, access control) | **High** — no per-file authority record |

**Dependency chain:** #19 → #20 → #21 → #22 → #23 → #24

### 2. **DATA IMPORT & STAGING (Phase 2) — 3 PRs**

| PR # | Status | What's Missing | Impact |
|------|--------|-----------------|--------|
| #23 | 📋 DB | Multi-country intake staging schema (10 tables, RLS) | **High** — controlled import pipeline |
| #24 | 📋 DB | Server-side commit RPCs (transactional, idempotent) | **High** — safe live writes |
| (next) | 🎯 Code | Parse/map/validate engine + Data Intake UI | **Medium** — bulk import workflow |

### 3. **GO BACKEND MIGRATION (Phase 2–6) — 2 PRs**

| PR # | Status | What's Missing | Impact |
|------|--------|-----------------|--------|
| #16 | 🔧 Code | Assets read endpoints + backend CI | **Medium** — parallel migration start |
| #15 | 🔧 Code | Native Android app (Kotlin/Compose) | **Low** — forward-looking, Expo is production |

---

## 🔴 Currently Missing (By Category)

### **Authentication & Authorization**

| Feature | Status | Details |
|---------|--------|---------|
| **Multi-org isolation** | ❌ MISSING | Orgs table exists but unused; RLS not org-scoped; cross-org reads possible |
| **Service layer** | ❌ MISSING | 276 web + 86 mobile inline Supabase calls; no abstraction for scoping/errors |
| **Secret management** | ⚠️ PARTIAL | Anon key in `mobile/app.json` (should be EAS Secrets); secret-startup guard missing |
| **Auth error messages** | ✅ DONE | Generic errors (no user enumeration) |
| **Idle timeout** | ✅ DONE | Implemented |

### **Data Security & Privacy**

| Feature | Status | Details |
|---------|--------|---------|
| **Organisation RLS** | ❌ MISSING | No RESTRICTIVE policies enforcing org isolation on 23 tables |
| **File authority** | ❌ MISSING | `file_metadata` table missing; no per-file owner/entity tracking |
| **Private file serving** | ✅ DONE | Signed URLs for accident photos + inspections |
| **PWA cache hardening** | ❌ MISSING | Caches authenticated `/rest/`, `/auth/`, `/storage/` (logout doesn't clear) |
| **Logout cache clear** | ❌ MISSING | Session cache, React Query, SW runtime caches persist across account switches |

### **Data Import & Staging**

| Feature | Status | Details |
|---------|--------|---------|
| **Staging tables** | ❌ MISSING | `import_batches`, `import_rows`, `import_row_issues` tables missing |
| **Mapping profiles** | ❌ MISSING | No schema mapping (field rename, type coerce, custom transforms) |
| **Validation engine** | ❌ MISSING | No per-row validation rules + error collection |
| **Commit RPCs** | ❌ MISSING | No server-side transactional batch inserts (org-scoped, idempotent) |
| **Audit trail** | ❌ MISSING | `import_audit_events` table missing |
| **Reversal** | ❌ MISSING | No rollback of failed batches |

### **Reporting & Exports**

| Feature | Status | Details |
|---------|--------|---------|
| **PDF export** | ✅ DONE | Multi-page, risk-level styling, inspection diagrams |
| **Excel export** | ✅ DONE | Multi-sheet, auto-summaries, smart column detection |
| **PowerPoint export** | ✅ DONE | 8-slide deck, charts, KPI tiles |
| **Scheduled exports** | ⚠️ PARTIAL | Settings UI exists; no backend scheduler/email sender |
| **Export documentation** | ✅ DONE | EXPORT_GUIDE.md + QUICK_REFERENCE.md |

### **Backend & API**

| Feature | Status | Details |
|---------|--------|---------|
| **Go API** | ⚠️ IN PROGRESS | Assets read endpoints live; write endpoints + other modules in Phase 2–6 |
| **GraphQL** | ❌ MISSING | Supabase GraphQL (if auto-generated) lacks org scoping |
| **Edge Functions** | ✅ DONE | AI validation, AI cost tracking, usage logs |
| **Backend CI** | ✅ PARTIAL | `backend-ci.yml` added in PR #16 |

### **Mobile Apps**

| Feature | Status | Details |
|---------|--------|---------|
| **Expo app** | ✅ DONE | Production-ready, feature-complete |
| **Android native** | ⚠️ FOUNDATION | Kotlin/Compose foundation in PR #15; targets new Go API |
| **iOS native** | ❌ MISSING | Not planned yet (keep Expo for now) |
| **Offline sync** | ✅ DONE | Record queue + background sync |

### **Infrastructure & DevOps**

| Feature | Status | Details |
|---------|--------|---------|
| **Web CI/CD** | ✅ DONE | GitHub Actions → Vercel |
| **Mobile CI/CD** | ✅ DONE | EAS Build + automatic releases |
| **Backend CI** | ⚠️ NEW | `backend-ci.yml` added; needs SDK sandbox fix |
| **Database backups** | ✅ DONE | Supabase auto-backups |
| **Secrets management** | ⚠️ PARTIAL | Web OK; mobile needs EAS Secrets; anon key exposed |

### **Data Model & Schema**

| Feature | Status | Details |
|---------|--------|---------|
| **Organisation scope** | ❌ MISSING | Columns added (V42) but RLS not enforced (V43 in PR #20) |
| **Canonical assets** | ⚠️ PARTIAL | `vehicle_fleet` exists; migration plan in docs, not implemented |
| **Stock ledger** | ⚠️ PARTIAL | `stock_movements` exists; tyre-change RPC not implemented |
| **Structured inspections** | ⚠️ PARTIAL | JSONB snapshot exists; structured schema in roadmap |
| **Audit tables** | ⚠️ PARTIAL | `import_audit_events` missing |

---

## 📋 Detailed Gap Analysis by Module

### **Module 1: Fleet Management**

```
Status: 90% Complete
├─ Vehicle master (vehicle_fleet)          ✅ Live
├─ Fleet analytics dashboard               ✅ Live
├─ Fuel efficiency analysis                ✅ Live
├─ Multi-org scoping                       ❌ Missing (PR #19, #20)
└─ Backend API migration                   ⚠️ In progress (PR #16)
```

**What's missing:**
- PR #19 adds `organisation_id` column (backend-compatible)
- PR #20 enforces RLS isolation
- PR #21 adds `/api/v1/assets` endpoint + service layer

### **Module 2: Tyre Records & Inspections**

```
Status: 85% Complete
├─ Tyre record entry                       ✅ Live
├─ Inspection workflow                     ✅ Live
├─ Inspection PDFs (with diagrams)         ✅ Live
├─ Service layer (tyres)                   ⚠️ In progress (PR #21)
├─ Multi-org scoping                       ❌ Missing (PR #19, #20)
└─ Structured inspection schema            🎯 Roadmap
```

**What's missing:**
- PR #21 adds `src/lib/api/tyres.js` service module
- Structured inspection fields (alongside JSONB snapshot)

### **Module 3: Data Import & Staging**

```
Status: 0% Complete (ALL Missing)
├─ Batch upload UI                         ❌ Missing
├─ Staging tables                          ❌ Missing (PR #23)
├─ Mapping profiles                        ❌ Missing (PR #23)
├─ Validation engine                       ❌ Missing (PR #23)
├─ Commit RPCs                             ❌ Missing (PR #24)
├─ Audit trail                             ❌ Missing (PR #23)
└─ Reversal / reconciliation               ❌ Missing (follow-up)
```

**Status:** Specs complete (8 audit docs in Phase 0); DB foundation in PRs #23–#24; UI in next slice.

### **Module 4: Reports & Exports**

```
Status: 100% Complete ✅
├─ PDF export                              ✅ Live
├─ Excel export                            ✅ Live
├─ PowerPoint export                       ✅ Live
├─ Custom report builder                   ✅ Live
├─ Scheduled email delivery                ⚠️ UI only (no backend)
├─ Export documentation                    ✅ NEW (EXPORT_GUIDE.md)
└─ Quick reference                         ✅ NEW (EXPORT_QUICK_REFERENCE.md)
```

**What's missing:** Background job scheduler for email delivery (post-PR #24).

### **Module 5: Security & Access Control**

```
Status: 40% Complete
├─ Authentication (Supabase)               ✅ Live
├─ Login security                          ✅ Live (generic errors, idle timeout)
├─ PWA cache hardening                     ❌ Missing (PR #18)
├─ Logout cache clear                      ❌ Missing (PR #18)
├─ Multi-org RLS                           ❌ Missing (PR #19, #20)
├─ File authority                          ❌ Missing (PR #22)
├─ Service layer (scoping)                 ❌ Missing (PR #21)
└─ Secret management                       ⚠️ Partial (anon key exposed)
```

**Action items:** PRs #18–#22 sequential (gated by test suite + build).

### **Module 6: Mobile Apps**

```
Status: 90% Complete (Expo) + Foundation (Android)
├─ Expo app (production)                   ✅ Live
├─ Offline sync                            ✅ Live
├─ Record queue                            ✅ Live
├─ Android native (foundation)             ⚠️ PR #15 (not shipped)
└─ iOS native                              ❌ Not planned
```

**What's missing:** Android needs to remain in parallel; keep Expo as production until Go API is stable.

### **Module 7: Backend & API**

```
Status: 5% Complete
├─ Go foundation                           ✅ PR #16 (assets read)
├─ Auth/identity                           ✅ PR #16
├─ Assets endpoints                        ✅ PR #16
├─ Tyres endpoints                         🎯 Phase 2
├─ Stock endpoints                         🎯 Phase 2
├─ Inspections endpoints                   🎯 Phase 3
├─ Write endpoints + mutations             🎯 Phase 3–4
└─ Offline sync contract                   🎯 Phase 4
```

**Status:** Read-only assets endpoint live; write operations + cutover phase in next 4 phases.

---

## 🎯 Priority Fix Roadmap (What to Do First)

### **This Week (Blocking)**
1. **Merge PR #19** — add `organisation_id` columns (backward-compatible)
2. **Merge PR #20** — enforce RLS org isolation (test suite validates)
3. **Merge PR #18** — PWA cache hardening + logout clear

**Why:** These unblock Phase 1 exit criteria; they're zero-risk (additive + RLS only).

### **Next Week**
4. **Merge PR #21** — `src/lib/api/` service layer (first 2 modules: assets, tyres)
5. **Merge PR #22** — file metadata + private file access control
6. **Start UI for PR #23** — data import staging (DB schema already queued)

### **Phase 2 (After Phase 1)**
7. **Merge PR #23** — multi-country staging tables + mapping profiles
8. **Merge PR #24** — commit RPCs (transactional, idempotent)
9. **Wire data intake UI** — parse/map/validate engine + upload flow

### **Phase 2–6 (Backend Cutover)**
10. **Roll out `/api/v1/{tyres,stock,inspections,workorders}` endpoints** (one module per PR)
11. **Migrate mobile + web to service layer** (gradual, module-by-module)
12. **Parallel Android app** (once Go API is stable; keep Expo in production)

---

## ❓ Not Missing (Already Done)

✅ **Export formats** — PDF, Excel, PowerPoint fully implemented + documented  
✅ **Inspection workflows** — tyre diagrams, pressure, tread, risk scoring  
✅ **Fleet analytics** — cost analysis, brand performance, fuel efficiency  
✅ **Offline sync** — record queue + background sync + conflict resolution  
✅ **Signed URLs** — private accident photos + inspection uploads  
✅ **AI validation** — structured tyre data extraction from photos  
✅ **Idle timeout** — automatic session lock after 15 min inactivity  
✅ **Generic auth errors** — no user enumeration  
✅ **Database schema** — 46 tables, denormalized for analytics  
✅ **RLS foundation** — role-based access control (role/active/creator)  
✅ **Test suite** — 369 tests (Jest + React Testing Library)  

---

## 📊 Gap Summary Table

| Area | Coverage | Priority | Effort | Status |
|------|----------|----------|--------|--------|
| **Security (Org/RLS)** | 40% | 🔴 Critical | 6 PRs | In progress |
| **Service layer** | 0% | 🔴 High | 2–3 PRs | Queued (PR #21) |
| **Data import** | 0% | 🟠 High | 3–4 PRs | DB design done (PR #23–#24) |
| **File authority** | 0% | 🟠 High | 1 PR | Queued (PR #22) |
| **Backend API** | 5% | 🟠 Medium | 6–8 PRs | Started (PR #16) |
| **Reports/Exports** | 100% | 🟢 Done | — | ✅ Shipped |
| **Mobile (Expo)** | 100% | 🟢 Done | — | ✅ Shipped |
| **Infrastructure** | 90% | 🟢 Green | — | Mostly done |

---

## 🚀 How to Unblock

### **Quick Wins (This Week)**
```bash
# Review & merge security PRs in order
git checkout main
git merge --squash origin/pr/18   # PWA cache + logout clear
git merge --squash origin/pr/19   # Org-scope foundation
git merge --squash origin/pr/20   # RLS org isolation

# Run test suite to confirm
npm run test:run                  # 369/369 must pass
npx vite build                    # must succeed
```

### **Next Week**
```bash
# Add service layer (zero breaking changes)
git merge --squash origin/pr/21   # src/lib/api/{assets,tyres}
npm run test:run                  # 378/378 (369 + 9 new)

# Add file authority
git merge --squash origin/pr/22   # file_metadata table + RLS
```

### **Parallel: Data Import Schema**
```bash
# Database design is complete; ready to merge
git merge --squash origin/pr/23   # staging tables + mapping profiles
git merge --squash origin/pr/24   # commit RPCs (server-side safe writes)
# Then wire the UI (separate PR)
```

---

## 📚 Documentation Status

| Document | Location | Status | Value |
|----------|----------|--------|-------|
| **Export Guide** | `docs/EXPORT_GUIDE.md` | ✅ NEW | 33K chars, 250+ examples |
| **Export Quick Ref** | `docs/EXPORT_QUICK_REFERENCE.md` | ✅ NEW | 8K chars, one-page cheat sheet |
| **Audit (Phase 0)** | `docs/CURRENT_SYSTEM_AUDIT.md` | ✅ In PR #17 | 78 pages, inventory |
| **Security plan** | `docs/SECURITY_HARDENING_PLAN.md` | ✅ In PR #17 | 10 confirmed issues + roadmap |
| **Org-scope guide** | `docs/ORG_SCOPE_FOUNDATION.md` | 📋 TODO | Explain V42 + V43 |
| **Import center** | `docs/IMPORT_CENTER_DATA_MODEL.md` | 📋 TODO | Staging + commit model |
| **Backend migration** | `docs/GO_BACKEND_MIGRATION_PLAN.md` | 📋 In PR #17 | Phases 1–6 |

---

## 🎓 What You Should Know

1. **The 10 open PRs are coordinated** — not chaos. They follow a security hardening → service layer → import → backend migration sequence.

2. **Export functionality is complete** — all 3 formats (PDF, Excel, PowerPoint) are production-ready with extensive documentation.

3. **Critical security gaps are being fixed** — org isolation, RLS enforcement, file authority, cache hardening. All gated by the test suite.

4. **Data import is designed but not coded** — DB schema is ready (PRs #23–#24); UI comes after.

5. **Backend migration is strategic, not urgent** — Expo app is production. Go API is being built in parallel for future flexibility.

6. **Mobile scoping in service layer is a must** — 86 direct Supabase calls in mobile code need to be centralized (PR #21 addresses web first).

---

## 💡 Recommendations

### **Short Term (Next 2 weeks)**
- [ ] Merge security PRs #18–#20 (zero-risk, unblock Phase 1)
- [ ] QA test org isolation + RLS policies in staging
- [ ] Review `EXPORT_GUIDE.md` + `EXPORT_QUICK_REFERENCE.md` for accuracy

### **Medium Term (Next month)**
- [ ] Merge #21 (service layer) + start page migrations
- [ ] Merge #22 (file authority)
- [ ] Merge #23–#24 (import schema) + wire UI
- [ ] Backend cutover Phase 2 (tyres, stock read endpoints)

### **Long Term (Next quarter)**
- [ ] Complete backend write endpoints
- [ ] Full mobile migration to Go API
- [ ] Parallel Android app testing (if needed)
- [ ] Data import UI launch

---

**Document Version:** 1.0  
**Last Audit:** 2026-07-02  
**Next Review:** After Phase 1 completion (1–2 weeks)
