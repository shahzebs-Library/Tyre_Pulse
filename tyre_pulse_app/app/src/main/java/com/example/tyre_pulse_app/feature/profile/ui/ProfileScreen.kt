package com.example.tyre_pulse_app.feature.profile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.designsystem.theme.*

data class AppModule(
    val title: String,
    val icon: ImageVector,
    val route: String,
    val description: String
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileRoute(
    onLogout: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToDiagnostics: () -> Unit,
    onNavigateToModule: (String) -> Unit,
    viewModel: ProfileViewModel = hiltViewModel()
) {
    // The signed-in account. Null means not loaded, and the header renders that as an
    // unknown profile rather than inventing a name - it used to read "John Technician"
    // with the initials "JT" for every user on every device.
    val user by viewModel.user.collectAsState()

    val modules = listOf(
        AppModule("Fleet Hub", Icons.Default.DirectionsCar, "asset_list_route", "Manage Vehicles & Fleet"),
        AppModule("Workshop", Icons.Default.Build, "workshop_route", "Jobs & Team Calendar"),
        AppModule("AI Assistant", Icons.Default.SmartToy, "fleet_ai_chat_route", "Ask Your Fleet AI"),
        AppModule("Analytics", Icons.Default.BarChart, "reports_route", "Charts, Costs & Trends"),
        AppModule("Scoreboard", Icons.Default.EmojiEvents, "driver_scorecard_route", "Driver Safety Rankings"),
        AppModule("Inventory", Icons.Default.Inventory, "stock_route", "Spare Parts & Stock"),
        AppModule("Accidents", Icons.Default.ReportProblem, "accident_list_route", "RCA & Evidence Hub"),
        AppModule("Inspections", Icons.Default.Assignment, "checklist_library", "Dynamic Checklists"),
        AppModule("Cleaning", Icons.Default.LocalLaundryService, "washing_route", "Washing & Meter Logs"),
        // These seven screens were built and registered in the NavHost, but nothing
        // anywhere named their route - so no user could reach any of them. A screen
        // that cannot be opened is not a feature, and it never gets exercised, which
        // is how the odometer screen kept a fabricated vehicle id for so long.
        // Icons deliberately chosen from the set already in use elsewhere in this app.
        // material-icons-extended carries thousands, but an icon name that does not
        // resolve is a build failure discovered only in CI - and CI is the only
        // compiler available here.
        AppModule("Tyre Records", Icons.Default.List, "records_route", "Every Tyre On Record"),
        AppModule("Meter Log", Icons.Default.Speed, "meter_log_route", "Record Odometer & Hours"),
        AppModule("Root Cause", Icons.Default.ErrorOutline, "rca_route", "Investigate A Failure"),
        AppModule("Stock Control", Icons.Default.Category, "stock_management_route", "Issue & Count Parts"),
        AppModule("Reports", Icons.Default.Assignment, "reports_route_v2", "Generate & Export"),
        AppModule("Fleet Analytics", Icons.Default.AutoGraph, "analytics_route", "Cost & Usage Trends"),
        AppModule("Report Issue", Icons.Default.Warning, "report_issue_route", "Raise A Fault"),
        AppModule("Maintenance Due", Icons.Default.Build, "maintenance_due_route", "Preventive Schedule"),
        // Two more that were built and reachable from nowhere. Workshop Live is the
        // technician's own shift board - check in/out, their assigned jobs, and time
        // split productive vs blocked - which none of the three tiles on the workshop
        // hub covers.
        AppModule("Workshop Live", Icons.Default.Timer, "workshop_live_route", "My Shift, Jobs & Time"),
        AppModule("Fleet Overview", Icons.Default.BarChart, "overview_route", "Fleet KPI Summary")
    ) + adminEntries(user?.role)



    val snackbarHostState = androidx.compose.runtime.remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = OLED_Black
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize().padding(horizontal = 24.dp)) {
            // Enterprise Header
            Spacer(Modifier.height(32.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(64.dp).clip(CircleShape).background(YellowPrimary), contentAlignment = Alignment.Center) {
                    // No initials to derive means no initials shown - never invented ones.
                    Text(initialsOf(user?.name) ?: "-", fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, color = Color.Black)
                }
                Spacer(Modifier.width(20.dp))
                Column {
                    Text(
                        user?.name?.takeIf { it.isNotBlank() } ?: "Not signed in",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.ExtraBold
                    )
                    Surface(color = StatusGreen.copy(alpha = 0.1f), shape = RoundedCornerShape(4.dp)) {
                        // The role the account actually carries. The old badge read
                        // "Active - Site A" for everyone, naming a site nobody was assigned.
                        Text(
                            user?.role?.takeIf { it.isNotBlank() } ?: "Role not set",
                            color = StatusGreen,
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                        )
                    }
                }
            }

            Spacer(Modifier.height(40.dp))
            Text("ENTERPRISE MODULES", style = MaterialTheme.typography.labelMedium, color = YellowPrimary, letterSpacing = 2.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(24.dp))

            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.weight(1f)
            ) {
                items(modules) { module ->
                    ModuleLauncherCard(module) { onNavigateToModule(module.route) }
                }
            }

            // Quick Actions
            Column(modifier = Modifier.padding(vertical = 24.dp)) {
                ActionItem("System Diagnostics", Icons.Default.Memory, onNavigateToDiagnostics)
                ActionItem("App Settings", Icons.Default.Settings, onNavigateToSettings)
                ActionItem("Logout", Icons.AutoMirrored.Filled.Logout, onLogout, color = StatusRed)
            }
        }
    }
}

@Composable
fun ModuleLauncherCard(module: AppModule, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().height(140.dp).clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = OLED_Card),
        shape = RoundedCornerShape(24.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.05f))
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Box(modifier = Modifier.size(40.dp).background(Color.White.copy(alpha = 0.05f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(module.icon, contentDescription = null, tint = YellowPrimary, modifier = Modifier.size(20.dp))
            }
            Column {
                Text(module.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(module.description, style = MaterialTheme.typography.bodySmall, color = TextSecondary, maxLines = 1)
            }
        }
    }
}

@Composable
fun ActionItem(title: String, icon: ImageVector, onClick: () -> Unit, color: Color = TextPrimary) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, tint = color.copy(alpha = 0.6f), modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Text(title, style = MaterialTheme.typography.bodyLarge, color = color, fontWeight = FontWeight.Medium)
    }
}

/**
 * The admin hub entry, shown only to an account whose recorded role is an admin one.
 *
 * THIS IS A UI GATE, NOT A SECURITY BOUNDARY, and it must not be mistaken for one.
 * What an account can actually read is enforced by row-level security in the
 * database; hiding this card stops a technician stumbling into a screen that would
 * show them nothing, it does not protect the data. Anyone who reaches the route
 * another way still sees exactly what their account is permitted to see.
 *
 * Matched case-insensitively on the role text because profiles.role is free-form
 * Title Case ("Admin", "Manager") rather than an enum.
 */
private fun adminEntries(role: String?): List<AppModule> {
    val normalised = role?.trim()?.lowercase().orEmpty()
    val isAdmin = normalised == "admin" || normalised.contains("admin")
    if (!isAdmin) return emptyList()
    return listOf(
        AppModule("Admin", Icons.Default.Settings, "admin_route", "People, Sites & Activity")
    )
}
