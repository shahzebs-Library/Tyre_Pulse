# TyrePulse — Developer Handoff
**Branch:** `claude/handoff-setup-gZAHb`
**Last updated:** June 2026
**Session summary:** Waves 8-23 fully implemented and pushed

---

## Next Session — Priority Order

1. **PWA icons** — generate icon set at `/public/icons/icon-{72,96,128,144,152,192,384,512}x{size}.png` from the logo SVG
2. **Edge Functions** — create `supabase/functions/generate-embedding/index.ts` and `supabase/functions/chat-ai/index.ts`
3. **Wave 5 polish** — email generation (5D), theme gradients (5E), empty state cleanup (5F)
4. **ERP sync** — read-only ERP integration endpoints
5. **Supabase Realtime** — push notifications for new Critical risk tyres

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

Env vars needed: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`

---

## What Was Built (Waves 8-23)

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

### Enhanced Pages
| File | Enhancement | Wave |
|------|-------------|------|
| `DataCleaning.jsx` | 7 quality checks + Data Quality Score | 16 |
| `Settings.jsx` | KPI targets editor + alert thresholds | 7 |
| `KpiScorecard.jsx` | Site breakdown + YoY toggle + alerts | 7 |
| `VehicleHistory.jsx` | Forecast tab with health scores | 7 |
| `StockManagement.jsx` | Velocity + days remaining + transfer | 7 |
| `Reports.jsx` | Pagination + print + save config | 7 |

### Infrastructure
| File | Purpose |
|------|---------|
| `MIGRATIONS_V12.sql` | app_settings table |
| `MIGRATIONS_V13.sql` | pgvector + embedding tables |
| `MIGRATIONS_V14.sql` | Knowledge base seed data |
| `MIGRATIONS_V15.sql` | Enterprise schema (orgs, audit, archive) |
| `public/manifest.json` | PWA manifest |
| `public/sw.js` | Service worker (cache-first) |
| `src/components/InstallPwaPrompt.jsx` | Install to home screen banner |

---

## Architecture Notes

- **kpiEngine.js** is the single source of truth for all KPI computations
- **ragService.js** provides 5-min cached retrieval — use `getCached/setCache` in all AI agents
- **auditLogger.js** is non-throwing — safe to call anywhere
- **performanceMonitor.js** `timedQuery()` should wrap all Supabase queries in production
- All 12 new Intelligence pages follow the same pattern: Supabase load on mount → useMemo computed → Chart.js charts → Excel/PDF export

---

## Project Architecture

```
TyrePulse
├── src/
│   ├── pages/          30+ pages
│   ├── components/     Layout, ProtectedRoute, InstallPwaPrompt, …
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
│   │   └── performanceMonitor.js Query timing
│   └── contexts/       AuthContext, SettingsContext, ThemeContext
├── public/
│   ├── manifest.json   PWA manifest
│   └── sw.js           Service worker
└── MIGRATIONS_V*.sql   Database migrations
```
