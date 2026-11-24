# 06 · Analytics and reporting data flows

**Legend:** green = IMPLEMENTED (live in DB and wired in code) · yellow = PARTIAL (built but unused, empty, or degrades to "not provisioned") · red = BROKEN (evidence below) · purple dashed = PROPOSED (migration file marked `STATUS: NOT APPLIED`, absent from `supabase_migrations.schema_migrations`) · dashed arrow = text join with no FK, or a proposed link. Row counts are exact `count(*)` reads on 2026-11-24.

```mermaid
flowchart TD
  subgraph SRC [Source tables]
    PC[("parts_consumption")]:::green
    TR[("tyre_records")]:::green
    WO[("work_orders")]:::green
    PL[("production_logs 212,567")]:::green
    LED[("stock_movements")]:::green
  end
  subgraph RPC [Server aggregates]
    CPM["get_cost_per_m3"]:::green
    CPK["get_fleet_cpk"]:::green
    PES["get_parts_expense_snapshot"]:::green
    MSN["get_maintenance_snapshot"]:::green
    SNAP["get_report_snapshot<br/>anon share token"]:::green
    VAL["inv_valuation_summary"]:::green
  end
  subgraph UI [Surfaces]
    CS["costSummary.js loadCostSplit"]:::green
    PAGES["CostPerM3, CpkIntelligence,<br/>ExpenseReport, BoardOverview"]:::green
    SHARE["ReportShare.jsx /report/:token"]:::green
    EMAIL["send-scheduled-reports<br/>edge fn"]:::green
  end
  PC --> CPM
  PL --> CPM
  TR --> CPK
  PC --> PES
  WO --> MSN
  PC --> SNAP
  LED --> VAL
  PES --> CS
  CS --> PAGES
  CPM --> PAGES
  CPK --> PAGES
  SNAP --> SHARE
  WO --> EMAIL
  classDef green fill:#d5e8d4,stroke:#82b366,color:#000
  classDef yellow fill:#fff2cc,stroke:#d6b656,color:#000
  classDef red fill:#f8cecc,stroke:#b85450,color:#000
  classDef purple fill:#e1d5e7,stroke:#9673a6,stroke-dasharray:5 5,color:#000
  classDef gray fill:#eeeeee,stroke:#999999,color:#000
```

Editable: `diagrams/06-analytics-reporting/06-analytics-reporting.drawio`.

| Flow | Code | Status |
|---|---|---|
| Expense split tyre / spare / oil | `get_parts_expense_snapshot` → `src/lib/api/costSummary.js` `loadCostSplit` → Dashboard, Analytics, BoardOverview, CostCenter | IMPLEMENTED |
| Cost per m3 | `get_cost_per_m3` over `parts_consumption` + `production_logs` (212,567) → `src/pages/CostPerM3.jsx` | IMPLEMENTED |
| CPK | `get_fleet_cpk` over `tyre_records` → `src/pages/CpkIntelligence.jsx` | IMPLEMENTED |
| Maintenance snapshot | `get_maintenance_snapshot` over `work_orders` | IMPLEMENTED |
| Inventory valuation | `inv_valuation_summary` over the ledger → `ValuationPanels.jsx` | IMPLEMENTED |
| Public / TV boards | `get_report_snapshot` (anon, token) → `src/pages/ReportShare.jsx` | IMPLEMENTED |
| Scheduled email | `report_schedules` → pg_cron → `supabase/functions/send-scheduled-reports` | IMPLEMENTED |
