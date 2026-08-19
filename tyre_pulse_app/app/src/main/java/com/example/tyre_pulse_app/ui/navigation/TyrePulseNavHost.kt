package com.example.tyre_pulse_app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable

// Core
import com.example.tyre_pulse_app.core.navigation.AuthDestination
import com.example.tyre_pulse_app.core.navigation.authScreen
import com.example.tyre_pulse_app.feature.home.navigation.HomeDestination
import com.example.tyre_pulse_app.feature.home.navigation.homeScreen

// Features
import com.example.tyre_pulse_app.feature.approvals.navigation.ApprovalsDestination
import com.example.tyre_pulse_app.feature.approvals.navigation.approvalsScreen
import com.example.tyre_pulse_app.feature.approvals.navigation.navigateToApprovalDetails
import com.example.tyre_pulse_app.feature.assets.navigation.AssetListDestination
import com.example.tyre_pulse_app.feature.assets.navigation.assetsScreen
import com.example.tyre_pulse_app.feature.assets.ui.AssetDetailRoute
import com.example.tyre_pulse_app.feature.tyres.navigation.tyresScreen
import com.example.tyre_pulse_app.feature.tyres.ui.TyreHistoryScreen
import com.example.tyre_pulse_app.feature.tyres.ui.TyreReplacementScreen
import com.example.tyre_pulse_app.feature.inspections.navigation.inspectionsScreen
import com.example.tyre_pulse_app.feature.inspections.navigation.navigateToInspectionForm
import com.example.tyre_pulse_app.feature.inspections.navigation.navigateToTyreInspection
import com.example.tyre_pulse_app.feature.inspections.ui.InspectionDetailScreen
import com.example.tyre_pulse_app.feature.scan.navigation.scanScreen
import com.example.tyre_pulse_app.feature.workshop.navigation.workshopScreen
import com.example.tyre_pulse_app.feature.workshop.ui.*
import com.example.tyre_pulse_app.feature.team.ui.TeamRoute
import com.example.tyre_pulse_app.feature.calendar.ui.MaintenanceCalendarScreen
import com.example.tyre_pulse_app.feature.checklists.ui.*
import com.example.tyre_pulse_app.feature.washing.ui.WashingRoute
import com.example.tyre_pulse_app.feature.meters.ui.MeterLogRoute
import com.example.tyre_pulse_app.feature.accidents.ui.*
import com.example.tyre_pulse_app.feature.rca.ui.RcaRoute
import com.example.tyre_pulse_app.feature.admin.ui.*
import com.example.tyre_pulse_app.feature.ai.ui.PredictiveMaintenanceScreen
import com.example.tyre_pulse_app.feature.reports.navigation.reportsScreen
import com.example.tyre_pulse_app.feature.reports.ui.ReportsRoute
import com.example.tyre_pulse_app.feature.inventory.ui.StockRoute
import com.example.tyre_pulse_app.feature.profile.navigation.profileScreen
import com.example.tyre_pulse_app.feature.settings.navigation.navigateToSettings
import com.example.tyre_pulse_app.feature.settings.navigation.settingsScreen
import com.example.tyre_pulse_app.feature.diagnostics.navigation.diagnosticsScreen
import com.example.tyre_pulse_app.feature.diagnostics.navigation.navigateToDiagnostics
import com.example.tyre_pulse_app.feature.tasks.navigation.myWorkScreen
import com.example.tyre_pulse_app.feature.search.navigation.searchScreen
import com.example.tyre_pulse_app.feature.notifications.navigation.notificationsScreen

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
        authScreen(onLoginSuccess = {
            navController.navigate(HomeDestination.route) {
                popUpTo(AuthDestination.route) { inclusive = true }
            }
        })
        
        homeScreen(
            onNavigateToModule = { route -> navController.navigate(route) },
            onAssetClick = { assetId -> navController.navigate("asset_detail_route/$assetId") },
            onNavigateToScan = { navController.navigate("scan_route") }
        )
        
        approvalsScreen(
            onApprovalClick = { id -> navController.navigateToApprovalDetails(id) },
            onBack = { navController.popBackStack() }
        )

        assetsScreen(
            onAssetClick = { assetId -> navController.navigate("asset_detail_route/$assetId") },
            onBack = { navController.popBackStack() },
            onStartInspection = { assetId -> navController.navigateToInspectionForm(assetId) },
            onTyreClick = { tyreId -> navController.navigate("tyre_history/$tyreId") }
        )

        composable("asset_detail_route/{assetId}") { backStackEntry ->
            val assetId = backStackEntry.arguments?.getString("assetId") ?: ""
            AssetDetailRoute(
                assetId = assetId,
                onBack = { navController.popBackStack() },
                onInspect = { id -> navController.navigateToInspectionForm(id) }
            )
        }

        inspectionsScreen(
            onBack = { navController.popBackStack() },
            onTyreClick = { assetId, tyreId ->
                navController.navigateToTyreInspection(assetId, tyreId)
            }
        )

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

        workshopScreen(
            onWorkOrderClick = { id -> navController.navigate("job_details_route/$id") },
            onViewTeam = { navController.navigate("team_route") },
            onViewCalendar = { navController.navigate("calendar_route") },
            onBack = { navController.popBackStack() }
        )

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

        composable("checklist_library") {
            ChecklistLibraryScreen(onStartChecklist = { id -> navController.navigate("checklist_runner/$id") })
        }

        composable("checklist_runner/{templateId}") {
            ChecklistRunnerRoute(onBack = { navController.popBackStack() })
        }

        composable("washing_route") { WashingRoute(onBack = { navController.popBackStack() }) }
        composable("meter_log_route") { MeterLogRoute(onBack = { navController.popBackStack() }) }
        composable("rca_route") { RcaRoute(onBack = { navController.popBackStack() }) }
        composable("ai_predictive_route") { PredictiveMaintenanceScreen() }
        reportsScreen()
        composable("reports_route") { ReportsRoute() }
        composable("stock_route") { StockRoute(onBack = { navController.popBackStack() }) }

        myWorkScreen(onTaskClick = { /* TODO */ })
        notificationsScreen(onNotificationClick = { /* TODO */ })
        searchScreen(
            onAssetClick = { id -> navController.navigate("asset_detail_route/$id") },
            onTyreClick = { id -> navController.navigate("tyre_history/$id") }
        )
        
        profileScreen(
            onLogout = { /* TODO */ },
            onNavigateToSettings = { navController.navigateToSettings() },
            onNavigateToDiagnostics = { navController.navigateToDiagnostics() },
            onNavigateToModule = { route -> navController.navigate(route) }
        )
        settingsScreen(onBack = { navController.popBackStack() })
        diagnosticsScreen(onBack = { navController.popBackStack() })

        scanScreen(
            onBack = { navController.popBackStack() },
            onNavigateToInspection = { assetId, tyreSerial ->
                navController.navigateToInspectionForm(assetId)
            },
            onNavigateToTyreChange = { id, position ->
                navController.navigate("tyre_replacement/$id")
            },
            onNavigateToAssetDetail = { assetId ->
                navController.navigate("asset_detail_route/$assetId")
            },
            onNavigateToTyreHistory = { tyreId ->
                navController.navigate("tyre_history/$tyreId")
            },
            onNavigateToSearch = { query ->
                navController.navigate("search_route?q=$query")
            }
        )
    }
}
