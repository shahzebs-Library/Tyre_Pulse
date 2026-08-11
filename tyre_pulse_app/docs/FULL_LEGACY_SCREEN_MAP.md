# Full Legacy Screen Porting Map (30+ Screens)

I have performed a deep-audit of the `mobile/app/(app)` folder. I am ensuring that all **31 legacy screens** are not only ported but significantly advanced in the native Kotlin implementation.

## 🏛️ Core & Shell (5 Screens)
1.  **Home/Index** (`index.tsx`) -> `HomeScreen.kt` (Advanced Dashboard)
2.  **Overview** (`overview.tsx`) -> `HomeScreen.kt` (Stats Integration)
3.  **Notifications** (`notifications.tsx`) -> `NotificationCenterScreen.kt`
4.  **Alerts** (`alerts.tsx`) -> `NotificationCenterScreen.kt` (Integrated)
5.  **Profile** (`profile.tsx`) -> `ProfileScreen.kt`

## 🛞 Tyre & Asset Operations (7 Screens)
6.  **Vehicles/Fleet** (`vehicles.tsx`) -> `AssetListScreen.kt`
7.  **Asset Detail** (Implicit) -> `AssetDetailScreen.kt`
8.  **Serial Search** (`serial-search.tsx`) -> `TyreListScreen.kt` (Search focused)
9.  **History** (`history.tsx`) -> `TyreHistoryScreen.kt`
10. **Tyre Change** (`tyre-change.tsx`) -> `TyreReplacementScreen.kt`
11. **Tyre Inspection New** (`inspection/new.tsx`) -> `TyreInspectionScreen.kt` (Guided Flow)
12. **Tyre Inspection Detail** (`inspection/[id].tsx`) -> `InspectionDetailScreen.kt`

## 🛠️ Workshop & Maintenance (6 Screens)
13. **Workshop Home** (`workshop.tsx`) -> `WorkshopHomeScreen.kt`
14. **Work Orders List** (`work-orders.tsx`) -> `WorkOrderListScreen.kt`
15. **Work Order Detail** (`workorders/index.tsx`) -> `JobDetailsScreen.kt`
16. **Maintenance Schedule** (`maintenance.tsx`) -> `MaintenanceCalendarScreen.kt`
17. **Calendar** (`calendar.tsx`) -> `MaintenanceCalendarScreen.kt` (Integrated)
18. **Team Live** (`team.tsx`) -> `TeamScreen.kt`

## 📋 Inspections & Checklists (4 Screens)
19. **Checklist Catalog** (`checklists/index.tsx`) -> `ChecklistLibraryScreen.kt`
20. **Checklist Runner** (`checklists/[templateId].tsx`) -> `ChecklistRunnerScreen.kt`
21. **Meter Logs** (`meter-logs.tsx`) -> `MeterLogScreen.kt`
22. **Vehicle Washing** (`washing.tsx`) -> `WashingScreen.kt`

## ⚠️ Accidents & RCA (5 Screens)
23. **Accident Dashboard** (`accident/dashboard.tsx`) -> `AccidentDashboardScreen.kt`
24. **Report Accident** (`accident/report.tsx`) -> `AccidentReportScreen.kt`
25. **Accident Case Detail** (`accident/case.tsx`) -> `AccidentCaseScreen.kt`
26. **RCA Investigation** (`rca.tsx`) -> `RcaScreen.kt`
27. **Records/Evidence** (`records/index.tsx`) -> `EvidenceGalleryScreen.kt`

## 🤖 Advanced & Admin (4 Screens)
28. **AI Insights** (`ai/index.tsx`) -> `PredictiveMaintenanceScreen.kt`
29. **Admin Console** (`admin/index.tsx`) -> `AdminDashboardScreen.kt`
30. **Stock/Inventory** (`stock.tsx`) -> `StockScreen.kt`
31. **Reports/Analytics** (`reports/index.tsx`) -> `ReportsScreen.kt`

## 🚀 The Upgrade Path
I am now spawning **8 High-Capacity Agents** to ensure the specific niche details of these 31 screens (like the **Accident Step-by-Step** and **High-Density Workshop TV view**) are 100% finished.
