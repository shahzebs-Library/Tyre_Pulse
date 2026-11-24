# 05 · Tyre lifecycle

**Legend:** green = IMPLEMENTED (live in DB and wired in code) · yellow = PARTIAL (built but unused, empty, or degrades to "not provisioned") · red = BROKEN (evidence below) · purple dashed = PROPOSED (migration file marked `STATUS: NOT APPLIED`, absent from `supabase_migrations.schema_migrations`) · dashed arrow = text join with no FK, or a proposed link. Row counts are exact `count(*)` reads on 2026-11-24.

```mermaid
flowchart LR
  IN["ERP monthly tyre file<br/>stg_monthly_tyres"]:::green
  INSP["inspections 2,870<br/>Flutter inspection wizard"]:::green
  TR[("tyre_records 11,274<br/>fitment + removal rows")]:::green
  TSE["tyre_service_events 0<br/>rotation / repair"]:::yellow
  SCR["tyre_status_marks 954<br/>scrap_tyre_by_serial"]:::green
  TI[("tyre_items 8,641<br/>inv_tyre_item_sync")]:::green
  TSH["tyre_store_holdings 4<br/>inv_tyre_store_holding"]:::yellow
  CON["tyre_custody_conflicts<br/>inv_tyre_conflict_decide"]:::green
  PRICE["cost_per_tyre backfill<br/>tyre_price_backfill"]:::green
  CPK["get_tyre_running_life<br/>get_fleet_cpk"]:::green
  IN --> TR
  INSP -.->|"tyre_conditions, flags"| TR
  TR --> TSE
  TR --> SCR
  TR -->|"serial sync"| TI
  TI --> TSH
  TI --> CON
  PRICE --> TR
  TR --> CPK
  classDef green fill:#d5e8d4,stroke:#82b366,color:#000
  classDef yellow fill:#fff2cc,stroke:#d6b656,color:#000
  classDef red fill:#f8cecc,stroke:#b85450,color:#000
  classDef purple fill:#e1d5e7,stroke:#9673a6,stroke-dasharray:5 5,color:#000
  classDef gray fill:#eeeeee,stroke:#999999,color:#000
```

Editable: `diagrams/05-tyre-lifecycle/05-tyre-lifecycle.drawio`.

| Stage | Tables / functions | Rows | Status |
|---|---|---:|---|
| Load | `stg_monthly_tyres` → `tyre_records` (staging trigger pipe) | — | IMPLEMENTED |
| Record | `tyre_records` with triggers `trg_guard_tyre_active_fitment`, `trg_zz_normalize_brand`, `trg_apply_tyre_learned_facts`, `trg_zz_one_price_per_tyre`, `trg_ev_tyre_installed`, `z_approval_tyre_execution` | 11,274 | IMPLEMENTED |
| Inspect | `inspections` (2,870) flags via `src/lib/inspectionTyreFlags.js`; joined to tyres by asset + position text, no FK | 2,870 | IMPLEMENTED |
| Service events | `tyre_service_events` | 0 | PARTIAL |
| Scrap | `tyre_status_marks`, `scrap_tyre_by_serial`, `trg_zz_inv_tyre_scrap_flag` | 954 | IMPLEMENTED |
| Warehouse item | `tyre_items` (`tyre_items_item_id_fkey` → material_master, `..._location_id_fkey`), `tyre_item_events`, `inv_tyre_item_sync` | 8,641 | IMPLEMENTED |
| Store holding | `tyre_store_holdings`, `inv_tyre_store_holding` | 4 | PARTIAL |
| Custody conflict | `tyre_custody_conflicts`, `inv_tyre_conflict_investigate/propose/decide/close` | — | IMPLEMENTED |
| Price / CPK | `tyre_price_backfill`, `get_tyre_running_life`, `get_fleet_cpk` | — | IMPLEMENTED |

`tyre_records` has no FK to `vehicle_fleet` or `work_orders`: `asset_no` and `job_card` are text joins.
