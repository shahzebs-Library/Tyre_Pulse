# Mobile Migration Map - Legacy to Native

This document maps features from the legacy `mobile` (Expo) application to the new `tyre_pulse_app` (Kotlin/Compose).

## Feature Comparison

| Feature | Legacy Mobile (`mobile/`) | New Kotlin (`tyre_pulse_app/`) | Decision |
| :--- | :--- | :--- | :--- |
| **Auth Flow** | `hooks/useSupabaseAuth.ts` | `core/authentication` | **Ported**. Native implementation is solid. |
| **Home/Dashboard** | `app/(app)/index.tsx` | N/A | **Redesign**. Create a new native Home screen. |
| **Approvals** | `app/(app)/approvals.tsx` | `feature/approvals` | **Backend Integration Required**. Port logic from legacy. |
| **Asset Search** | `app/(app)/assets/index.tsx` | `feature/assets` | **Redesign UI**. Improve native filtering. |
| **Tyre Diagram** | `components/VehicleTyreDiagram.tsx` | `feature/inspections/component/VehicleTyreLayout.kt` | **Rewrite Natively**. Port the logic from `lib/tyreLayout.ts`. |
| **Inspection Form**| `app/(app)/inspection/new.tsx` | `feature/inspections` | **Redesign UI**. Use native photo handling and guided flow. |
| **Tyre History** | `app/(app)/tyre/[id].tsx` | `feature/tyres` | **Preserve Behavior**. Port timeline view. |
| **Workshop** | `app/(app)/workshop.tsx` | `feature/workshop` | **Redesign UI**. Optimize for technician workflow. |
| **Accidents** | `app/(app)/accidents.tsx` | `feature/accidents` | **Port**. Ensure all fields match legacy validation. |

## Technical Mapping

### Tyre Position Mapping
- **Legacy Source**: `mobile/lib/tyreLayout.ts`
- **Native Implementation Target**: `core/designsystem/component/VehicleTyreLayout.kt` (move from inspections to designsystem for reuse).
- **Goal**: Implement `parsePosition` and `buildTyreDiagramLayout` logic in Kotlin to support all 100+ possible tyre positions and axle configurations.

### API Integration
- **Legacy Strategy**: Direct Supabase client.
- **Native Strategy**: Retrofit + Supabase REST / RPC.
- **Action**: Map all `mobile/lib/api/` calls to Retrofit interfaces in `core/network/api/`.

### SVG/Vehicle Layouts
- **Legacy**: Inline SVGs in `VehicleTyreDiagram.tsx`.
- **Native**: Use Compose `Canvas` or `Image` (SVG) with absolute positioning calculated by the ported layout engine.
- **Decision**: Redesign tyre nodes as native Compose components for better touch targets and states.

### Photos & Uploads
- **Legacy**: `hooks/usePhotoUpload.ts`.
- **Native**: `core/work/UploadWorker` (WorkManager) for reliable background uploads with retries.
- **Priority**: High. Field workers often have poor connectivity.
