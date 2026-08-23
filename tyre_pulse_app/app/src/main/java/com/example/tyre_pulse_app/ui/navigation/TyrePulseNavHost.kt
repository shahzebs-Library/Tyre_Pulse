package com.example.tyre_pulse_app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.compose.runtime.LaunchedEffect
import androidx.navigation.NavType
import androidx.navigation.navArgument

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
import com.example.tyre_pulse_app.feature.tyre_replacement.navigation.tyreReplacementScreen
import com.example.tyre_pulse_app.feature.tyre_replacement.navigation.navigateToTyreReplacement
import com.example.tyre_pulse_app.feature.inspections.navigation.inspectionsScreen
import com.example.tyre_pulse_app.feature.inspections.navigation.navigateToInspectionForm
import com.example.tyre_pulse_app.feature.inspections.ui.InspectionDetailScreen
import com.example.tyre_pulse_app.feature.scan.navigation.scanScreen
import com.example.tyre_pulse_app.feature.workshop.navigation.workshopScreen
import com.example.tyre_pulse_app.feature.workshop.ui.*
import com.example.tyre_pulse_app.feature.team.ui.TeamRoute
import com.example.tyre_pulse_app.feature.admin.ui.AdminDashboardScreen
import com.example.tyre_pulse_app.feature.admin.ui.SiteManagementScreen
import com.example.tyre_pulse_app.feature.admin.ui.UserSessionScreen
import com.example.tyre_pulse_app.feature.workshop.ui.TeamLiveScreen
import com.example.tyre_pulse_app.feature.calendar.ui.MaintenanceCalendarScreen
import com.example.tyre_pulse_app.feature.checklists.ui.*
import com.example.tyre_pulse_app.feature.meters.ui.MeterLogRoute
import com.example.tyre_pulse_app.feature.accidents.navigation.accidentsGraph
import com.example.tyre_pulse_app.feature.accidents.navigation.AccidentReportDestination
import com.example.tyre_pulse_app.feature.accidents.navigation.navigateToAccidentCase
import com.example.tyre_pulse_app.feature.scanner.ui.ScannerScreen
import com.example.tyre_pulse_app.feature.odometer.ui.OdometerUpdateScreen
import com.example.tyre_pulse_app.feature.odometer.ui.OdometerViewModel
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.tyre_pulse_app.feature.rca.ui.RcaRoute
import com.example.tyre_pulse_app.feature.report_issue.ui.ReportIssueRoute
import com.example.tyre_pulse_app.feature.maintenance.ui.MaintenanceRoute
import com.example.tyre_pulse_app.feature.admin.ui.*
import com.example.tyre_pulse_app.feature.ai.ui.FleetAiChatScreen
import com.example.tyre_pulse_app.feature.ai_engineer.ui.AiCameraCaptureScreen
import com.example.tyre_pulse_app.feature.reports.navigation.reportsScreen
import com.example.tyre_pulse_app.feature.reports.ui.ReportsScreen
import com.example.tyre_pulse_app.feature.team.ui.DriverScorecardScreen
import com.example.tyre_pulse_app.feature.inventory.ui.StockRoute
import com.example.tyre_pulse_app.feature.analytics.ui.AnalyticsScreen
import com.example.tyre_pulse_app.feature.records.ui.RecordsScreen
import com.example.tyre_pulse_app.feature.profile.navigation.profileScreen
import com.example.tyre_pulse_app.feature.settings.navigation.navigateToSettings
import com.example.tyre_pulse_app.feature.settings.navigation.settingsScreen
import com.example.tyre_pulse_app.feature.diagnostics.navigation.diagnosticsScreen
import com.example.tyre_pulse_app.feature.diagnostics.navigation.navigateToDiagnostics
import com.example.tyre_pulse_app.feature.tasks.navigation.myWorkScreen
import com.example.tyre_pulse_app.feature.search.navigation.searchScreen
import com.example.tyre_pulse_app.feature.notifications.navigation.notificationsScreen
import com.example.tyre_pulse_app.feature.overview.ui.OverviewRoute
import androidx.compose.runtime.getValue
import com.example.tyre_pulse_app.core.model.Notification
@Composable
fun TyrePulseNavHost(
    navController: NavHostController,
    modifier: Modifier = Modifier,
    isAuthenticated: Boolean = false,
    onLogout: () -> Unit = {}
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

        // List only. It used to also register asset_detail_route, which this file
        // registers immediately below - the same route twice in one graph, where the
        // later one silently wins.
        assetsScreen(
            onAssetClick = { assetId -> navController.navigate("asset_detail_route/$assetId") },
            onBack = { navController.popBackStack() }
        )

        composable("asset_detail_route/{assetId}") { backStackEntry ->
            val assetId = backStackEntry.arguments?.getString("assetId") ?: ""
            AssetDetailRoute(
                assetId = assetId,
                onBack = { navController.popBackStack() },
                onInspect = { id -> navController.navigateToInspectionForm(id) },
                onUpdateOdometer = { id -> navController.navigate("odometer_route/$id") }
            )
        }

        inspectionsScreen(
            onBack = { navController.popBackStack() },
            onNavigateToScan = { navController.navigate("camera_qc_route") }
        )

        tyresScreen(
            onTyreClick = { tyreId -> navController.navigate("tyre_history/$tyreId") },
            onBack = { navController.popBackStack() },
            onReplaceTyre = { tyreId -> navController.navigateToTyreReplacement(tyreId) }
        )

        composable("tyre_history/{tyreId}") { backStackEntry ->
            val tyreId = backStackEntry.arguments?.getString("tyreId") ?: ""
            TyreHistoryScreen(tyreId = tyreId)
        }
        
        // THE REAL TYRE REPLACEMENT FLOW. Two implementations existed and the app was
        // routed to the WRONG one. The screen registered here was a stub: its removal
        // reason was the fixed string "Wear & Tear" behind onValueChange = {}, its
        // serial field was dead, "Confirm Removal" only incremented a step counter and
        // "Complete Installation" just called onBack(). A fitter completed a tyre
        // change and NOTHING was written.
        //
        // feature/tyre_replacement/ holds the working one - it loads the asset and the
        // outgoing tyre, collects reason/km/condition/replacement, and closes the
        // fitment on tyre_records through TyreRepository.submitReplacementRequest.
        // Its graph builder existed and was called from nowhere, which is why nobody
        // noticed: it is the only one of the NavGraphBuilder extensions never invoked.
        tyreReplacementScreen(onBack = { navController.popBackStack() })

        // The Orders tile opens the LIST. It used to be routed through
        // onWorkOrderClick("list") into job_details_route/list, i.e. a job detail
        // page for a job id that is the word "list".
        //
        // A second registration of this same screen under "workshop_home" carried the
        // correct wiring but was named nowhere, so it was unreachable - the working
        // copy was the dead one. Deleted; the live route is fixed instead.
        workshopScreen(
            onViewOrders = { navController.navigate("work_order_list") },
            onViewTeam = { navController.navigate("team_route") },
            onViewCalendar = { navController.navigate("calendar_route") }
        )
        
        composable("work_order_list") {
            WorkOrderListScreen(
                onOrderClick = { id -> navController.navigate("job_details_route/$id") },
                onCreateOrderClick = { navController.navigate("create_work_order") }
            )
        }

        composable("create_work_order") {
            CreateWorkOrderScreen(onBack = { navController.popBackStack() })
        }

        // THE PLACEHOLDER NAME IS LOAD-BEARING, it is not cosmetic. Compose Navigation
        // puts each path argument into the SavedStateHandle under the name written in
        // the pattern, and WorkOrderDetailsViewModel opens with
        // checkNotNull(savedStateHandle["workOrderId"]). While this route said
        // "{jobId}" the handle carried jobId and never workOrderId, so checkNotNull
        // threw IllegalStateException the moment the screen was constructed - every
        // tap on a work order in the list, a task in My Work, or a TASK notification
        // took the app down. Positional callers navigate("job_details_route/$id") are
        // unaffected by the rename; only the key the ViewModel reads changes.
        composable("job_details_route/{workOrderId}") {
            JobDetailsRoute(onBack = { navController.popBackStack() })
        }

        // The technician's own shift board: check in / check out, the jobs assigned to
        // them, and time split into productive vs blocked from tech_activity_events.
        // It was built and registered nowhere, so nobody could open it. Distinct from
        // the three tiles on workshop_route - work_order_list is every order,
        // team_route is the whole team, calendar_route is the schedule; none of them
        // answers "what am I on right now". Reached from the Profile catalog.
        composable("workshop_live_route") {
            WorkshopLiveRoute(onBack = { navController.popBackStack() })
        }
        
        // active_job_execution and digital_invoice_route are DELETED, with both
        // screens. This was the most exposed fabrication left in the app: "Active Job"
        // is a MECHANIC'S PRIMARY BOTTOM-NAV TAB (MainActivity), and it opened a fixed
        // job - "Active Job: WO-9021", "Vehicle: CAT Excavator 320", "Issue: Hydraulic
        // Leak on Boom Cylinder" - identical for every mechanic on every device. Its
        // "Parts Deducted (Auto-synced)" list was local state that synced nowhere, and
        // "Complete & Generate Invoice" produced an invoice reading "Total Cost:
        // $450.00", "Labor Hours: 3.5 hrs" and "Invoice Sent to Accounting" - none of
        // it computed, nothing sent, and denominated in dollars for a fleet that
        // reports in SAR.
        //
        // The tab now opens work_order_list, which reads the real 90,534 job cards.


        // ONE stock surface, reached by two names.
        //
        // StockManagementScreen ("Offline Inventory Edge-Sync") listed three invented
        // parts and a hard-coded "3 items awaiting network sync". It was the display
        // half of InventorySyncWorker, which POSTed those same two invented part
        // deductions to an inventory_transactions table on every run; the worker was
        // never enqueued, so it never wrote, and both are now deleted.
        //
        // StockRoute reads real stock_records. Offline work is queued through
        // SyncRepository (STOCK_ADJUST), which is this app's actual offline mechanism -
        // the deleted worker was a second, fabricated one alongside it.
        composable("stock_management_route") { StockRoute(onBack = { navController.popBackStack() }) }

        // The admin screens. All four were BUILT and none was registered, so none
        // could be opened - which is also why AdminDashboardScreen stayed a stub and
        // why the fabricated content in the others went unnoticed for so long.
        composable("admin_route") {
            AdminDashboardScreen(
                onBack = { navController.popBackStack() },
                onOpen = { route -> navController.navigate(route) }
            )
        }
        composable("admin_users_route") {
            UserSessionScreen(onBack = { navController.popBackStack() })
        }
        composable("admin_sites_route") { SiteManagementScreen() }
        composable("team_live_route") {
            TeamLiveScreen(onBack = { navController.popBackStack() })
        }

        // ai_dashboard_route and AiAnalyticsDashboard are DELETED. The screen was
        // entirely string literals presented as analysis: "The AI Engine has predicted
        // 2 assets will fail in the next 14 days", then two named machines with named
        // predicted failures and a "15% Life Remaining". No ViewModel, no data source,
        // no prediction of any kind - and it was reachable from the Profile hub. It is
        // the same defect PredictiveMaintenanceScreen was deleted for; this copy
        // survived that pass. camera_qc_route is unaffected - it is also reached from
        // the inspections screen.

        composable("camera_qc_route") {
            AiCameraCaptureScreen(
                onImageCaptured = { file -> 
                    // File is saved locally. We would upload to Supabase Storage and run Edge AI model here.
                    navController.popBackStack() 
                },
                onBack = { navController.popBackStack() }
            )
        }

        composable("team_route") { TeamRoute() }
        composable("calendar_route") { MaintenanceCalendarScreen() }

        accidentsGraph(
            onNavigateBack = { navController.popBackStack() },
            onNavigateToReport = { navController.navigate(AccidentReportDestination.route) },
            onCaseClick = { caseId -> navController.navigateToAccidentCase(caseId) }
        )

        composable("checklist_library") {
            ChecklistLibraryScreen(onStartChecklist = { id -> navController.navigate("checklist_runner/$id") })
        }

        composable("checklist_runner/{templateId}") {
            ChecklistRunnerRoute(onBack = { navController.popBackStack() })
        }

        composable("washing_route") { 
            com.example.tyre_pulse_app.feature.washing.ui.WashingScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToLogWash = { navController.navigate("log_wash") }
            ) 
        }
        
        composable("log_wash") {
            com.example.tyre_pulse_app.feature.washing.ui.LogWashScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }
        composable("meter_log_route") { MeterLogRoute(onBack = { navController.popBackStack() }) }
        // The asset is part of the ROUTE, so this screen cannot be opened without one.
        // It previously took no argument and hard-coded vehicleId = "V-1024" on submit,
        // which would have written meter readings against a vehicle that does not
        // exist. It is a drill-down from a known asset, not a standalone entry - the
        // standalone meter entry point is meter_log_route, which has its own asset field.
        composable(
            route = "odometer_route/{assetNo}",
            arguments = listOf(navArgument("assetNo") { type = NavType.StringType })
        ) { backStackEntry ->
            val assetNo = backStackEntry.arguments?.getString("assetNo").orEmpty()
            val viewModel: OdometerViewModel = hiltViewModel()
            val uiState by viewModel.uiState.collectAsStateWithLifecycle()

            // Fetch this asset's last reading so the new one can be checked against a
            // real baseline instead of an invented one.
            LaunchedEffect(assetNo) { viewModel.loadPreviousReading(assetNo) }

            OdometerUpdateScreen(
                vehicleId = assetNo,
                previousOdometer = uiState.previousOdometer,
                isSubmitting = uiState.isSubmitting,
                submitError = uiState.error,
                onBack = { navController.popBackStack() },
                onSubmit = { reading, photoBytes ->
                    viewModel.submitOdometer(
                        vehicleId = assetNo,
                        reading = reading,
                        photoBytes = photoBytes,
                        onSuccess = { navController.popBackStack() }
                    )
                }
            )
        }
        composable("scanner_route") {
            ScannerScreen(
                onBack = { navController.popBackStack() },
                onScanSuccess = { result ->
                    // Omni-Scanner Auto-Routing Logic
                    when {
                        result.startsWith("ASSET:") -> {
                            val id = result.substringAfter("ASSET:")
                            navController.navigate("asset_detail_route/$id")
                        }
                        result.startsWith("PART:") -> {
                            // A scanned part used to open the fabricated active-job
                            // screen, where it was appended to a local list captioned
                            // "Auto-synced" that synced nowhere. Stock is the honest
                            // destination: it reads real stock_records, and deducting
                            // against a job needs a job this scan does not identify.
                            navController.navigate("stock_route")
                        }
                        result.startsWith("FAULT:") -> {
                            val faultId = result.substringAfter("FAULT:")
                            // Auto-generate Work Order for this fault
                            navController.navigate("create_work_order?faultCode=$faultId")
                        }
                        result.startsWith("RFID:") -> {
                            val tyreId = result.substringAfter("RFID:")
                            navController.navigate("tyre_history/$tyreId")
                        }
                        else -> {
                            // Fallback to global search
                            navController.navigate("search_route?q=$result")
                        }
                    }
                }
            )
        }
        composable("rca_route") { RcaRoute(onBack = { navController.popBackStack() }) }

        // Report Issue - the native app had no equivalent of this Expo field module.
        // Maintenance Due - the native app had no preventive-maintenance module.
        composable("maintenance_due_route") {
            MaintenanceRoute(onBack = { navController.popBackStack() })
        }

        composable("report_issue_route") {
            ReportIssueRoute(
                onBack = { navController.popBackStack() },
                // Mirrors the Expo app: a raised issue lands in the task list.
                onRaised = { navController.navigate("my_work_route") { popUpTo("report_issue_route") { inclusive = true } } }
            )
        }
        // ONE AI surface, reached by two names.
        //
        // There were three AI implementations. PredictiveMaintenanceScreen appended the
        // user's message and never produced a reply at all - and it is what the Home
        // hub's "AI Center" tile opened, so the assistant most users reached was inert.
        // AiViewModel was a third, unreferenced, answering every question with the fixed
        // sentence "your fleet costs are projected to decrease by 5%" and the real call
        // commented out. Both are deleted.
        //
        // The route name is kept so existing links and the Profile catalog still resolve;
        // it now lands on the chat that actually calls the deployed chat-ai function.
        composable("ai_predictive_route") { FleetAiChatScreen() }
        composable("fleet_ai_chat_route") { FleetAiChatScreen() }
        composable("driver_scorecard_route") { DriverScorecardScreen() }
        reportsScreen()
        composable("reports_route_v2") { ReportsScreen() }
        composable("stock_route") { StockRoute(onBack = { navController.popBackStack() }) }
        composable("analytics_route") { AnalyticsScreen() }
        composable("records_route") { RecordsScreen() }
        composable("overview_route") { OverviewRoute(onBack = { navController.popBackStack() }) }

        myWorkScreen(onTaskClick = { taskId -> navController.navigate("job_details_route/$taskId") })
        notificationsScreen(onNotificationClick = { notification -> 
            notification.relatedEntityId?.let { id ->
                when (notification.relatedEntityType) {
                    "APPROVAL" -> navController.navigateToApprovalDetails(id)
                    "TASK" -> navController.navigate("job_details_route/$id")
                    "INSPECTION" -> navController.navigateToInspectionForm(id)
                    "ASSET" -> navController.navigate("asset_detail_route/$id")
                    else -> {}
                }
            }
        })
        searchScreen(
            onAssetClick = { id -> navController.navigate("asset_detail_route/$id") },
            onTyreClick = { id -> navController.navigate("tyre_history/$id") }
        )
        
        profileScreen(
            onLogout = onLogout,
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
                navController.navigateToTyreReplacement(id)
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
