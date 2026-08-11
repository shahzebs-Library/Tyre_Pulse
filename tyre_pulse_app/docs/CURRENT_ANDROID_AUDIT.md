# Current Android Audit - Tyre Pulse

**Date**: 2025-05-14
**Audit Status**: Initial Review

## Overall Architecture
- **Architecture**: Modern Android using Kotlin, Jetpack Compose, Hilt, Room, Retrofit, and Coroutines/Flow. Follows a feature-based modular-ready structure.
- **Dependency Injection**: Hilt is correctly set up.
- **Network Layer**: Retrofit with a global interceptor for Supabase Auth.
- **Database**: Room used for assets and some caching.
- **State Management**: ViewModels with `StateFlow` and `SavedStateHandle` for state restoration.

## Feature Status Audit

| Feature | Implementation State | Technical Findings | Priority/Severity |
| :--- | :--- | :--- | :--- |
| **Navigation Shell** | PARTIAL | Bottom bar "Home" points to Approvals. Start destination is Assets. | HIGH |
| **Authentication** | WORKING | Supabase Auth integrated. Token management secure. | LOW |
| **Home Screen** | MISSING | There is no dedicated Home screen; it currently just shows Approvals. | HIGH |
| **Approvals** | BROKEN (MOCK) | UI is polished but uses internal mock data. No `ApprovalApi` exists. | CRITICAL |
| **Asset Search** | WORKING | Connected to real `vehicle_fleet` endpoint. Search and filtering work. | MEDIUM |
| **Asset Details** | WORKING | Connected to real data. Displays fitted tyres. | MEDIUM |
| **Inspection** | PARTIAL | UI flow works, but tyre layout is primitive (hardcoded specs) compared to legacy app. | HIGH |
| **Tyres** | WORKING | Connected to real `tyre_master` endpoint. | MEDIUM |
| **Tyre Replacement** | WORKING | Two-step flow implemented. Connected to `TyreReplacementApi`. | MEDIUM |
| **My Work / Tasks** | WORKING | Connected to `TaskApi`. | MEDIUM |
| **Workshop** | WORKING | Connected to `WorkshopApi`. | MEDIUM |
| **Accidents** | WORKING | Connected to `AccidentApi`. | MEDIUM |
| **Reports** | PLACEHOLDER | Very basic KPI cards with likely hardcoded data. | MEDIUM |
| **Notifications** | WORKING | Connected to `NotificationApi`. | MEDIUM |

## Critical Findings

1.  **Mock Data in Approvals**: Despite being a priority, Approvals is completely disconnected from the backend.
2.  **Mislabeled Navigation**: The bottom navigation labels do not match the destination behavior (Home -> Approvals).
3.  **Primitive Tyre Layout**: The "Protected" Inspection workflow uses a very limited tyre layout engine compared to the legacy `mobile` app which handles dynamic positions and complex axle configurations.
4.  **Inconsistent "Home" Experience**: Users are dropped into Asset List or Approvals instead of a proper Dashboard/Home.

## Recommendations

1.  **Establish Navigation Foundation**: Correct the bottom bar, create a real Home screen, and ensure back-stack behavior is logical.
2.  **Connect Approvals to Backend**: Implement `ApprovalApi` using Supabase RPCs or REST endpoints (matching legacy logic).
3.  **Port Tyre Layout Engine**: Implement a Kotlin version of the `buildTyreDiagramLayout` logic from `mobile/lib/tyreLayout.ts`.
4.  **Refine Design System**: Ensure consistency across all screens using the established TP components.
