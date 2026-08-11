package com.example.tyre_pulse_app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable

// Destinations & Core
import com.example.tyre_pulse_app.core.navigation.AuthDestination
import com.example.tyre_pulse_app.core.navigation.authScreen
import com.example.tyre_pulse_app.feature.home.navigation.HomeDestination
import com.example.tyre_pulse_app.feature.home.navigation.homeScreen
import com.example.tyre_pulse_app.feature.home.navigation.navigateToHome

// Approvals & Notifications
import com.example.tyre_pulse_app.feature.approvals.navigation.ApprovalsDestination
import com.example.tyre_pulse_app.feature.approvals.navigation.approvalsScreen
import com.example.tyre_pulse_app.feature.approvals.navigation.navigateToApprovalDetails
import com.example.tyre_pulse_app.feature.notifications.navigation.notificationsScreen

// Assets & Tyres
import com.example.tyre_pulse_app.feature.assets.navigation.AssetListDestination
import com.example.tyre_pulse_app.feature.assets.navigation.assetsScreen
import com.example.tyre_pulse_app.feature.assets.ui.AssetDetailScreen
import com.example.tyre_pulse_app.feature.tyres.navigation.tyresScreen
import com.example.tyre_pulse_app.feature.tyres.navigation.navigateToTyreDetail
import com.example.tyre_pulse_app.feature.tyres.ui.TyreHistoryScreen
import com.example.tyre_pulse_app.feature.tyres.ui.TyreReplacementScreen

// Inspections
import com.example.tyre_pulse_app.feature.inspections.navigation.inspectionsScreen
import com.example.tyre_pulse_app.feature.inspections.navigation.navigateToInspectionForm
import com.example.tyre_pulse_app.feature.inspections.navigation.navigateToTyreInspection
import com.example.tyre_pulse_app.feature.inspections.ui.InspectionDetailScreen

// Workshop & Team
import com.example.tyre_pulse_app.feature.workshop.navigation.workshopScreen
import com.example.tyre_pulse_app.feature.workshop.navigation.navigateToWorkOrderDetails
import com.example.tyre_pulse_app.feature.workshop.ui.WorkshopHomeScreen
import com.example.tyre_pulse_app.feature.workshop.ui.WorkOrderListScreen
import com.example.tyre_pulse_app.feature.workshop.ui.JobDetailsRoute
import com.example.tyre_pulse_app.feature.team.ui.TeamRoute
import com.example.tyre_pulse_app.feature.calendar.ui.MaintenanceCalendarScreen

// Checklists & Ops
import com.example.tyre_pulse_app.feature.checklists.ui.ChecklistLibraryScreen
import com.example.tyre_pulse_app.feature.checklists.ui.ChecklistRunnerRoute
import com.example.tyre_pulse_app.feature.washing.ui.WashingRoute
import com.example.tyre_pulse_app.feature.meters.ui.MeterLogRoute

// Accidents & RCA
import com.example.tyre_pulse_app.feature.accidents.navigation.accidentsScreen
import com.example.tyre_pulse_app.feature.accidents.ui.AccidentDashboardScreen
import com.example.tyre_pulse_app.feature.accidents.ui.AccidentReportRoute
import com.example.tyre_pulse_app.feature.accidents.ui.AccidentCaseScreen
import com.example.tyre_pulse_app.feature.accidents.ui.EvidenceGalleryScreen
import com.example.tyre_pulse_app.feature.rca.ui.RcaRoute

// Admin & AI
import com.example.tyre_pulse_app.feature.admin.ui.AdminDashboardScreen
import com.example.tyre_pulse_app.feature.admin.ui.SuperAdminScreen
import com.example.tyre_pulse_app.feature.admin.ui.SiteManagementScreen
import com.example.tyre_pulse_app.feature.admin.ui.UserSessionScreen
import com.example.tyre_pulse_app.feature.ai.ui.PredictiveMaintenanceScreen
import com.example.tyre_pulse_app.feature.reports.navigation.reportsScreen
import com.example.tyre_pulse_app.feature.reports.ui.ReportsRoute
import com.example.tyre_pulse_app.feature.inventory.ui.StockRoute

// Profile & Settings
import com.example.tyre_pulse_app.feature.profile.navigation.profileScreen
import com.example.tyre_pulse_app.feature.settings.navigation.navigateToSettings
import com.example.tyre_pulse_app.feature.settings.navigation.settingsScreen
import com.example.tyre_pulse_app.feature.diagnostics.navigation.diagnosticsScreen
import com.example.tyre_pulse_app.feature.diagnostics.navigation.navigateToDiagnostics
import com.example.tyre_pulse_app.feature.tasks.navigation.myWorkScreen
import com.example.tyre_pulse_app.feature.search.navigation.searchScreen

@Composable
fun TyrePulseNavHost(
    navController: NavHostController,
    modifier: Modifier = Modifier,
    isAuthenticated: Boolean = false
) {
    NavHost(
        navController = navController,
        startDestination = if (isAuthenticated) HomeDestination.route else AuthDestination.route,
        modifier = modifier
    ) {
        // 1. Auth
        authScreen(onLoginSuccess = {
            navController.navigate(HomeDestination.route) {
                popUpTo(AuthDestination.route) { inclusive = true }
            }
        })
        
        // 2. Dashboard/Home
        homeScreen(
            onInspectClick = { navController.navigate("checklist_library") },
            onAssetClick = { assetId -> navController.navigate("asset_detail/$assetId") }
        )
        
        // 3. Approvals
        approvalsScreen(
            onApprovalClick = { id -> navController.navigateToApprovalDetails(id) },
            onBack = { navController.popBackStack() }
        )

        // 4. Assets & Detail (360 Hub)
        assetsScreen(
            onAssetClick = { assetId -> navController.navigate("asset_detail/$assetId") },
            onBack = { navController.popBackStack() },
            onStartInspection = { assetId -> navController.navigateToInspectionForm(assetId) },
            onTyreClick = { tyreId -> navController.navigateToTyreDetail(tyreId) }
        )
        composable("asset_detail/{assetId}") { backStackEntry ->
            val assetId = backStackEntry.arguments?.getString("assetId") ?: ""
            AssetDetailScreen(
                assetId = assetId,
                onBack = { navController.popBackStack() },
                onInspect = { id -> navController.navigateToInspectionForm(id) }
            )
        }

        // 5. Tyres & History
        tyresScreen(
            onTyreClick = { tyreId -> navController.navigate("tyre_history/$tyreId") },
            onBack = { navController.popBackStack() },
            onReplaceTyre = { tyreId -> navController.navigate("tyre_replacement/$tyreId") }
        )
        composable("tyre_history/{tyreId}") { backStackEntry ->
            val tyreId = backStackEntry.arguments?.getString("tyreId") ?: ""
            TyreHistoryScreen(tyreId = tyreId)
        }
        composable("tyre_replacement/{tyreId}") { backStackEntry ->
            val tyreId = backStackEntry.arguments?.getString("tyreId") ?: ""
            TyreReplacementScreen(tyreId = tyreId, onBack = { navController.popBackStack() })
        }

        // 6. Inspections
        inspectionsScreen(
            onBack = { navController.popBackStack() },
            onTyreClick = { assetId, tyreId, position ->
                navController.navigateToTyreInspection(assetId, tyreId, position)
            }
        )
        composable("inspection_detail/{id}") { backStackEntry ->
            val id = backStackEntry.arguments?.getString("id") ?: ""
            InspectionDetailScreen(inspectionId = id, onBack = { navController.popBackStack() })
        }

        // 7. Workshop Ops
        composable("workshop_home") {
            WorkshopHomeScreen(
                onViewOrders = { navController.navigate("work_order_list") },
                onViewTeam = { navController.navigate("team_route") },
                onViewCalendar = { navController.navigate("calendar_route") }
            )
        }
        composable("work_order_list") {
            WorkOrderListScreen(onOrderClick = { id -> navController.navigate("job_details_route/$id") })
        }
        composable("job_details_route/{jobId}") {
            JobDetailsRoute(onBack = { navController.popBackStack() })
        }
        composable("team_route") { TeamRoute() }
        composable("calendar_route") { MaintenanceCalendarScreen() }

        // 8. Accidents & RCA
        composable("accident_dashboard") {
            AccidentDashboardScreen(
                onReportAccident = { navController.navigate("accident_report") },
                onCaseClick = { id -> navController.navigate("accident_case/$id") }
            )
        }
        composable("accident_report") {
            AccidentReportRoute(onBack = { navController.popBackStack() })
        }
        composable("accident_case/{caseId}") { backStackEntry ->
            val caseId = backStackEntry.arguments?.getString("caseId") ?: ""
            AccidentCaseScreen(caseId = caseId, onBack = { navController.popBackStack() })
        }
        composable("evidence_gallery/{caseId}") { backStackEntry ->
            val caseId = backStackEntry.arguments?.getString("caseId") ?: ""
            EvidenceGalleryScreen(caseId = caseId)
        }
        composable("rca_route") { RcaRoute(onBack = { navController.popBackStack() }) }

        // 9. Checklists & Washing
        composable("checklist_library") {
            ChecklistLibraryScreen(onStartChecklist = { id -> navController.navigate("checklist_runner/$id") })
        }
        composable("checklist_runner/{templateId}") {
            ChecklistRunnerRoute(onBack = { navController.popBackStack() })
        }
        composable("washing_route") { WashingRoute(onBack = { navController.popBackStack() }) }
        composable("meter_log_route") { MeterLogRoute(onBack = { navController.popBackStack() }) }

        // 10. Admin & AI
        composable("admin_dashboard") {
            AdminDashboardScreen() // Now linked to Site/User sessions
        }
        composable("super_admin_route") { SuperAdminScreen() }
        composable("site_management") { SiteManagementScreen() }
        composable("user_sessions") { UserSessionScreen() }
        composable("ai_predictive_route") { PredictiveMaintenanceScreen() }
        
        composable("reports_route") { ReportsRoute() }
        composable("stock_route") { StockRoute(onBack = { navController.popBackStack() }) }

        // Core Shell
        myWorkScreen(onTaskClick = { /* TODO */ })
        notificationsScreen(onNotificationClick = { /* TODO */ })
        searchScreen(
            onAssetClick = { id -> navController.navigate("asset_detail/$id") },
            onTyreClick = { id -> navController.navigate("tyre_history/$id") }
        )
        profileScreen(
            onLogout = { /* Global Logout */ },
            onNavigateToSettings = { navController.navigateToSettings() },
            onNavigateToDiagnostics = { navController.navigateToDiagnostics() }
        )
        settingsScreen(onBack = { navController.popBackStack() })
        diagnosticsScreen(onBack = { navController.popBackStack() })
    }
}
