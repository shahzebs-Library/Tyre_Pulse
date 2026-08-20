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
    onNavigateToModule: (String) -> Unit
) {
    val modules = listOf(
        AppModule("Fleet Hub", Icons.Default.DirectionsCar, "asset_list_route", "Manage Vehicles & Fleet"),
        AppModule("Workshop", Icons.Default.Build, "workshop_route", "Jobs & Team Calendar"),
        AppModule("AI Chat", Icons.Default.SmartToy, "fleet_ai_chat_route", "Ask Your Fleet AI"),
        AppModule("Analytics", Icons.Default.BarChart, "reports_route", "Charts, Costs & Trends"),
        AppModule("Scoreboard", Icons.Default.EmojiEvents, "driver_scorecard_route", "Driver Safety Rankings"),
        AppModule("AI Predict", Icons.Default.AutoGraph, "ai_predictive_route", "Tyre Life Predictions"),
        AppModule("Inventory", Icons.Default.Inventory, "stock_route", "Spare Parts & Stock"),
        AppModule("Accidents", Icons.Default.ReportProblem, "accident_dashboard", "RCA & Evidence Hub"),
        AppModule("Inspections", Icons.Default.Assignment, "checklist_library", "Dynamic Checklists"),
        AppModule("Cleaning", Icons.Default.LocalLaundryService, "washing_route", "Washing & Meter Logs")
    )


    Scaffold(
        containerColor = OLED_Black
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize().padding(horizontal = 24.dp)) {
            // Enterprise Header
            Spacer(Modifier.height(32.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(64.dp).clip(CircleShape).background(YellowPrimary), contentAlignment = Alignment.Center) {
                    Text("JT", fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, color = Color.Black)
                }
                Spacer(Modifier.width(20.dp))
                Column {
                    Text("John Technician", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                    Surface(color = StatusGreen.copy(alpha = 0.1f), shape = RoundedCornerShape(4.dp)) {
                        Text("Active • Site A", color = StatusGreen, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
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
