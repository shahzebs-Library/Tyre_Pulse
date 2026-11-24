# 08 · Flutter mobile and offline synchronisation

**Legend:** green = IMPLEMENTED (live in DB and wired in code) · yellow = PARTIAL (built but unused, empty, or degrades to "not provisioned") · red = BROKEN (evidence below) · purple dashed = PROPOSED (migration file marked `STATUS: NOT APPLIED`, absent from `supabase_migrations.schema_migrations`) · dashed arrow = text join with no FK, or a proposed link. Row counts are exact `count(*)` reads on 2026-11-24. Here yellow means *fixed on this branch but not merged*.

```mermaid
flowchart TD
  subgraph DEV [On the phone, Drift SQLite]
    UI["Feature screens<br/>inspections, checklists, meter_logs"]:::green
    DRAFT[("InspectionDrafts, ChecklistDrafts<br/>draft_tables.dart")]:::green
    Q[("PendingCommands, PendingMediaUploads<br/>queue_tables.dart")]:::green
    FAIL[("SyncFailures")]:::green
  end
  subgraph RUN [Sync runtime]
    BG["background_sync.dart<br/>Workmanager + connectivity_plus"]:::green
    ENG["SyncEngine, command_registry.dart"]:::green
    PUSH["SupabaseCommandPusher<br/>insert / update by id"]:::green
    INVP["InventoryCountCommandPusher<br/>inv_count_submit"]:::green
  end
  subgraph STK [Stock screens]
    PIO["physical_capture_outbox.dart<br/>inv_pi_capture"]:::green
    SCM["main: Add stock<br/>stock_records insert"]:::red
    SCB["branch 89cf96c3: recordNew<br/>proposed_new capture"]:::yellow
  end
  DB[("Supabase Postgres")]:::green
  UI --> DRAFT
  UI --> Q
  BG --> ENG
  ENG --> Q
  ENG --> FAIL
  ENG --> PUSH
  ENG --> INVP
  PUSH -.->|PostgREST| DB
  INVP -.->|RPC| DB
  PIO -.->|RPC| DB
  SCB --> PIO
  SCM -.->|"refused 42501"| DB
  classDef green fill:#d5e8d4,stroke:#82b366,color:#000
  classDef yellow fill:#fff2cc,stroke:#d6b656,color:#000
  classDef red fill:#f8cecc,stroke:#b85450,color:#000
  classDef purple fill:#e1d5e7,stroke:#9673a6,stroke-dasharray:5 5,color:#000
  classDef gray fill:#eeeeee,stroke:#999999,color:#000
```

Editable: `diagrams/08-flutter-offline-sync/08-flutter-offline-sync.drawio`.

| Piece | File | Status |
|---|---|---|
| Local store | `core/database/tables/queue_tables.dart` (`PendingCommands`, `PendingMediaUploads`, `SyncFailures`), `draft_tables.dart` | IMPLEMENTED |
| Command allow-lists | `core/sync/command_registry.dart` (`CommandType`: tyreChange, workOrder, rca, reportIssue, stockAdjust, ...) | IMPLEMENTED |
| Engine | `core/sync/sync_engine.dart` (sync lock via `QueueDao.acquireSyncLock`) | IMPLEMENTED |
| Background | `core/sync/background_sync.dart` (Workmanager periodic + connectivity_plus trigger) | IMPLEMENTED |
| Generic pusher | `core/sync/supabase_command_pusher.dart` (insert / update by id) | IMPLEMENTED |
| Count pusher | `core/sync/inventory_count_command_pusher.dart` → `inv_count_submit` | IMPLEMENTED |
| Physical capture | `features/inventory/data/physical_capture_outbox.dart` → `inv_pi_capture`, `inv_pi_photo_attach` | IMPLEMENTED |
| Stock count "Add stock" | **origin/main**: `stock_count_repository.dart` `create()` inserts `stock_records` with `stock_qty` > 0 (line ~210) and then inserts `stock_movements` directly | **BROKEN** — `inv_balance_guard` raises 42501 on any non-zero insert |
| Stock count "Add stock" | **this branch, commit `89cf96c3`** (not on any remote): `create()` removed; `StockCountRecorder.recordNew` records a `proposed_new` capture via `inv_pi_capture` | PARTIAL (fix not merged, no build) |
| +/- adjust | `post_stock_movement` RPC, online only | IMPLEMENTED |
