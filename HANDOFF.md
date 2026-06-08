# TyrePulse — Developer Handoff
**Branch:** `claude/handoff-setup-gZAHb`
**Last updated:** June 2026
**Session summary:** Waves 8-23 + Wave 5D/5E/5F + Edge Functions + PWA Icons + ERP Sync + Realtime Notifications fully implemented and pushed

---

## Next Session — Priority Order

1. **Work Orders page** — `/work-orders` (new operational page for workshop job tracking)
2. **Scheduled Reports** — Add to Settings: schedule weekly/monthly email reports
3. **Global Search** — Cross-page search modal (tyres, vehicles, inspections)
4. **Apply migrations V12-V15** — User must run in Supabase SQL Editor
5. **Wire EmailReportModal** into ForecastingEngine, VendorIntelligence, FleetIntelligence

---

## Migrations Pending (apply in Supabase SQL Editor in order)

| File | Purpose |
|------|---------|
| `MIGRATIONS_V12.sql` | `app_settings` table (Wave 7B thresholds) |
| `MIGRATIONS_V13.sql` | pgvector, knowledge_documents, embedding tables |
| `MIGRATIONS_V14.sql` | Seed SOP/policy knowledge documents |
| `MIGRATIONS_V15.sql` | organisations, audit_log_v2, performance indexes, archive |

---

## Supabase Edge Functions Required

| Function | Input | Purpose |
|----------|-------|---------|
| `generate-embedding` | `{ text, model }` | Proxy OpenAI text-embedding-3-small |
| `chat-ai` | `{ system, user, model }` | Proxy Claude API for 4 AI agents |
| `send-email` | `{ to, subject, body, attachmentBase64? }` | Resend API email delivery |

Env vars needed: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`

---

## What Was Built (All Sessions)

### New Pages
| Route | File | Wave |
|-------|------|------|
| `/kpi-engine` | EngineeringKpi.jsx | 8 |
| `/inspection-intelligence` | InspectionIntelligence.jsx | 9 |
| `/position-intelligence` | PositionIntelligence.jsx | 10 |
| `/root-cause` | RootCauseEngine.jsx | 11 |
| `/predictive-maintenance` | PredictiveMaintenance.jsx | 12 |
| `/vendor-intelligence` | VendorIntelligence.jsx | 13 |
| `/fleet-intelligence` | FleetIntelligence.jsx | 14 |
| `/advanced-analytics` | AdvancedAnalytics.jsx | 15 |
| `/executive-report` | ExecutiveReport.jsx | 17 |
| `/forecasting` | ForecastingEngine.jsx | 18 |
| `/continuous-improvement` | ContinuousImprovement.jsx | 19 |
| `/ai-command-center` | AiCommandCenter.jsx | 21 |
| `/erp-sync` | ErpSync.jsx | 23+ |

### New Libraries
| File | Purpose |
|------|---------|
| `src/lib/kpiEngine.js` | 18 pure KPI computation functions |
| `src/lib/ragService.js` | RAG retrieval + context assembly + cache |
| `src/lib/embeddingService.js` | Batch embedding generation |
| `src/lib/aiRouter.js` | Query classification → agent routing |
| `src/lib/agents/` | analystAgent, tyreEngineerAgent, qaDataAgent, plannerAgent |
| `src/lib/auditLogger.js` | audit_log_v2 convenience wrappers |
| `src/lib/performanceMonitor.js` | Query timing + slow query detection |
| `src/lib/emailService.js` | PDF generation + email delivery via Resend |

### New Components
| File | Purpose |
|------|---------|
| `src/components/EmptyState.jsx` | Reusable empty state with icon/action |
| `src/components/LoadingState.jsx` | Spinner with message + fullPage mode |
| `src/components/InstallPwaPrompt.jsx` | PWA install to home screen banner |
| `src/components/EmailReportModal.jsx` | Multi-recipient email modal with PDF attachment |
| `src/components/NotificationCenter.jsx` | Realtime bell icon + dropdown notifications |

### New Hooks
| File | Purpose |
|------|---------|
| `src/hooks/useRealtimeAlerts.js` | Supabase Realtime subscription for Critical tyres |

### Enhanced Pages
| File | Enhancement | Wave |
|------|-------------|------|
| `DataCleaning.jsx` | 7 quality checks + Data Quality Score | 16 |
| `Settings.jsx` | KPI targets editor + alert thresholds | 7 |
| `KpiScorecard.jsx` | Site breakdown + YoY toggle + alerts | 7 |
| `VehicleHistory.jsx` | Forecast tab with health scores | 7 |
| `StockManagement.jsx` | Velocity + days remaining + transfer | 7 |
| `Reports.jsx` | Pagination + print + save config + email | 7 + 5D |
| `ExecutiveReport.jsx` | Email button wired | 5D |
| `EngineeringKpi.jsx` | Email button wired | 5D |
| `Dashboard.jsx` | EmptyState + LoadingState components | 5F |

### Infrastructure
| File | Purpose |
|------|---------|
| `MIGRATIONS_V12.sql` | app_settings table |
| `MIGRATIONS_V13.sql` | pgvector + embedding tables |
| `MIGRATIONS_V14.sql` | Knowledge base seed data |
| `MIGRATIONS_V15.sql` | Enterprise schema (orgs, audit, archive) |
| `public/manifest.json` | PWA manifest |
| `public/sw.js` | Service worker (cache-first) |
| `public/icons/icon-{72..512}x{size}.png` | PWA icon set (8 sizes) |
| `supabase/functions/chat-ai/index.ts` | Anthropic API proxy |
| `supabase/functions/generate-embedding/index.ts` | OpenAI embeddings proxy |
| `supabase/functions/send-email/index.ts` | Resend email proxy |
| `src/index.css` | Theme depth: gradients, card shadows, dark palette |

---

## Architecture Notes

- **kpiEngine.js** is the single source of truth for all KPI computations
- **ragService.js** provides 5-min cached retrieval — use `getCached/setCache` in all AI agents
- **auditLogger.js** is non-throwing — safe to call anywhere
- **performanceMonitor.js** `timedQuery()` should wrap all Supabase queries in production
- **emailService.js** — `generateReportPdf()` returns base64, `sendReportEmail()` calls `send-email` Edge Function
- **useRealtimeAlerts.js** — subscribes to `tyre_records` + `alerts` channels, ring buffer of 50, persists to localStorage
- **NotificationCenter.jsx** — bell icon with unread count badge, framer-motion dropdown
- All 12 new Intelligence pages follow the same pattern: Supabase load on mount → useMemo computed → Chart.js charts → Excel/PDF export
- **agents/index.js** uses Anthropic SDK directly (`dangerouslyAllowBrowser: true`, `VITE_ANTHROPIC_API_KEY`)

---

## Project Architecture

```
TyrePulse
├── src/
│   ├── pages/          31+ pages
│   ├── components/     Layout, ProtectedRoute, InstallPwaPrompt, EmailReportModal, NotificationCenter, …
│   ├── hooks/          useRealtimeAlerts
│   ├── lib/
│   │   ├── kpiEngine.js          KPI computations
│   │   ├── ragService.js         RAG retrieval
│   │   ├── embeddingService.js   Embeddings
│   │   ├── aiRouter.js           Agent routing
│   │   ├── agents/               4 AI agents
│   │   ├── analyticsEngine.js    Legacy analytics
│   │   ├── auditLogger.js        Audit trail
│   │   ├── alertEngine.js        Alert detection
│   │   ├── exportUtils.js        Excel/PDF export
│   │   ├── emailService.js       Email delivery
│   │   └── performanceMonitor.js Query timing
│   └── contexts/       AuthContext, SettingsContext, ThemeContext
├── public/
│   ├── manifest.json   PWA manifest
│   ├── sw.js           Service worker
│   └── icons/          8 PWA icon sizes (72–512px)
├── supabase/
│   ├── config.toml
│   └── functions/
│       ├── chat-ai/
│       ├── generate-embedding/
│       └── send-email/
└── MIGRATIONS_V*.sql   Database migrations
```
