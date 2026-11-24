# 09 · Role-based access and approvals

**Legend:** green = IMPLEMENTED (live in DB and wired in code) · yellow = PARTIAL (built but unused, empty, or degrades to "not provisioned") · red = BROKEN (evidence below) · purple dashed = PROPOSED (migration file marked `STATUS: NOT APPLIED`, absent from `supabase_migrations.schema_migrations`) · dashed arrow = text join with no FK, or a proposed link. Row counts are exact `count(*)` reads on 2026-11-24.

```mermaid
flowchart TD
  USR(["Signed-in user<br/>profiles.role, country, sites"])
  subgraph RLS [Row-level security helpers]
    ORG["app_current_org"]:::green
    CTY["app_can_see_country"]:::green
    SITE["app_can_see_site"]:::green
    SUP["is_super_admin"]:::green
  end
  subgraph CAP [Capabilities]
    MP[("module_permissions 1,416")]:::green
    UAG[("user_access_grants 132")]:::green
    AUC["app_user_can(module, cap)"]:::green
    INVC["inv_can(cap) = stock module"]:::green
  end
  subgraph APR [Approval flows]
    IAR["inventory_approval_requests<br/>inv_request_approval / inv_approval_decide"]:::green
    LIM["inventory_approval_limits 0<br/>inv_approver_roles"]:::yellow
    AM["approval_matrix 0 rows<br/>resolve_approvers"]:::yellow
    AER["approval_execution_requests<br/>work + tyre execution guards"]:::yellow
    DOC["decide_inspection_approval<br/>decide_checklist_approval"]:::green
  end
  USR --> ORG
  USR --> CTY
  USR --> SITE
  USR --> AUC
  MP --> AUC
  UAG --> AUC
  AUC --> INVC
  INVC --> IAR
  LIM --> IAR
  AM -.-> AER
  USR --> DOC
  classDef green fill:#d5e8d4,stroke:#82b366,color:#000
  classDef yellow fill:#fff2cc,stroke:#d6b656,color:#000
  classDef red fill:#f8cecc,stroke:#b85450,color:#000
  classDef purple fill:#e1d5e7,stroke:#9673a6,stroke-dasharray:5 5,color:#000
  classDef gray fill:#eeeeee,stroke:#999999,color:#000
```

Editable: `diagrams/09-rbac-approvals/09-rbac-approvals.drawio`.

| Layer | Objects | Evidence |
|---|---|---|
| Tenant wall | RESTRICTIVE `*_org_isolation` policies on `organisation_id = app_current_org()` | live function `app_current_org` |
| Country / site | `app_can_see_country`, `app_can_see_site` (+ zero-arg scope readers, V396) | live |
| Platform owner | `is_super_admin()` | live |
| Module capabilities | `module_permissions` (1,416), `user_access_grants` (132) → `app_user_can(module, cap)` | client mirror `src/contexts/AuthContext.jsx`, `src/lib/permissionMatrix.js`; console `src/console/pages/access/AccessManager.jsx`; Flutter `core/permissions/access_resolver.dart` |
| Inventory gate | `inv_can(p_cap)` = `app_user_can('stock', p_cap)` (SECURITY DEFINER) used by `inv_*` RPCs | `pg_get_functiondef('inv_can')` |
| Inventory approvals | `inventory_approval_requests` (1), `inventory_approval_decisions`, `inv_request_approval`, `inv_approval_decide`, `inv_approver_roles`; `inventory_approval_limits` 0 rows | `src/components/inventory/ApprovalsPanel.jsx` |
| Generic matrix | `approval_matrix` 0 rows, `resolve_approvers` | `src/lib/api/approvalMatrix.js` — PARTIAL (no rules) |
| Execution guards | `approval_execution_requests` (0), triggers `z_approval_work_start`, `z_approval_tyre_execution` | PARTIAL |
| Document sign-off | `decide_inspection_approval`, `decide_checklist_approval` | IMPLEMENTED |
| Route guards (UI only) | `RoleRoute`, `ModuleRoute` in `src/components/ProtectedRoute.jsx` | hiding is not security; RLS is the boundary |
