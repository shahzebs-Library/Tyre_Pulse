# Approved mock-to-Flutter screen map

Visual sources:

- `C:\Users\Tyre_Engineer\Downloads\Tyre Pulse Fleet Management App Mockups.png`
- `C:\Users\Tyre_Engineer\Downloads\Tyre Pulse Fleet Management UI Mockups.png`

The light PMV collage is the primary layout/density reference. The dark
collage supplies the richer tyre inspection, action and summary states that
are not repeated in the light collage. Real application data, permissions and
workflow constraints remain authoritative; mock records are not shipped.

| Mock screen | Live Flutter surface | State |
|---|---|---|
| Light 1 - Home Dashboard | `HomeScreen` / `HomeRoute` | Registered; visual match in progress |
| Light 2 - Asset Overview | `VehicleDetailScreen` from Vehicles | Registered; visual match in progress |
| Light 3 - Inspection tyre map | `NewInspectionScreen` tyre step | Registered; visual match in progress |
| Light 4 - Inspection detail entry | tyre-position editor sheet | Registered; visual match in progress |
| Light 5 - Approvals List | `InspectionApprovalsQueueScreen` | Registered; visual match in progress |
| Light 6 - Approval Detail | `InspectionApprovalReviewScreen` | Registered; visual match in progress |
| Light 7 - My Work | `TasksScreen` / `TasksRoute` | Registered; mock-aligned real corrective-action board |
| Light 8 - Work Order Detail | `WorkOrderDetailScreen` | Registered; visual match pending |
| Light 9 - Tyre Replacement wizard | `TyreReplacementScreen` | Registered; visual match in progress |
| Light 10 - Replace position select | replacement diagram step | Registered; visual match in progress |
| Light 11 - Accident Case Overview | accident detail/progress surface | Registered; visual match in progress |
| Light 12 - Accident Case Detail | `AccidentCaseScreen` | Registered; visual match in progress |
| Dark 1 - Dashboard / Home | `HomeScreen` dark theme | Registered; theme match in progress |
| Dark 2 - Assets List | `VehiclesListScreen` dark theme | Registered; visual match in progress |
| Dark 3 - Vehicle / tyre layout | vehicle/inspection tyre diagram | Registered; visual match in progress |
| Dark 4 - Tyre pressure | tyre-position editor/detail | Registered; visual match in progress |
| Dark 5 - Tread & condition | tyre-position editor/detail | Registered; visual match in progress |
| Dark 6 - Damage / photos | tyre-position editor/detail | Registered; visual match in progress |
| Dark 7 - Action taken | `TyreTakeActionScreen` | Registered; visual match in progress |
| Dark 8 - Summary & submit | inspection review step | Registered; visual match in progress |
| Dark 9 - Job / work order | `WorkOrderDetailScreen` | Registered; visual match pending |
| Dark 10 - Alerts | `AlertsScreen` / `AlertsRoute` | Registered; mock-aligned real tyre-risk feed |

Protected router and shell source files are not changed. Both former gaps now
register through feature-owned `*_screen_registrations.dart` maps at the
existing composition point.
