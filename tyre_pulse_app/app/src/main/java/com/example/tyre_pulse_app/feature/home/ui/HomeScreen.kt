package com.example.tyre_pulse_app.feature.home.ui
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items


import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.R
import com.example.tyre_pulse_app.core.authentication.UserRole
import com.example.tyre_pulse_app.core.designsystem.theme.*

import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import kotlinx.coroutines.launch
import java.time.LocalTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeRoute(
    onNavigateToModule: (String) -> Unit,
    onAssetClick: (String) -> Unit,
    onNavigateToScan: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    
    // Setup for Pull-To-Refresh
    var isRefreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    if (isRefreshing) {
        LaunchedEffect(true) {
            viewModel.loadDashboardData()
        }
    }
    
    // Simulate loading finished
    LaunchedEffect(uiState) {
        // Ideally uiState should have Loading/Success states, assuming it updates values for now
        isRefreshing = false
    }

    HomeScreen(
        uiState = uiState,
        isRefreshing = isRefreshing,
        onRefresh = { isRefreshing = true },
        snackbarHostState = snackbarHostState,
        onNavigateToModule = onNavigateToModule,
        onAssetClick = onAssetClick,
        onScanClick = onNavigateToScan
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    uiState: HomeUiState,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    snackbarHostState: SnackbarHostState,
    onNavigateToModule: (String) -> Unit,
    onAssetClick: (String) -> Unit,
    onScanClick: () -> Unit
) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            HighFidelityTopBar(
                userName = uiState.userName,
                onScanClick = onScanClick,
                onNotificationsClick = { onNavigateToModule("notifications_route") }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = onRefresh,
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                
        
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp)
            ) {
            // Live KPI Hub
            item {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    StatCard(
                        count = kpiText(uiState.inspectionsInProgress),
                        label = "IN PROGRESS",
                        color = StatusRed,
                        modifier = Modifier.weight(1f)
                    )
                    StatCard(
                        count = kpiText(uiState.openJobs),
                        label = "ACTIVE JOBS",
                        color = StatusBlue,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Expo-Mirrored Module Grid
            item {
                Text(
                    text = "OPERATIONS HUB",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.5.sp
                )
                Spacer(Modifier.height(16.dp))
                val modules = listOf(
                    HomeModule("Fleet", Icons.Default.DirectionsCar, "asset_list_route"),
                    HomeModule("Workshop", Icons.Default.Build, "workshop_route"),
                    HomeModule("AI Center", Icons.Default.AutoGraph, "ai_predictive_route"),
                    HomeModule("Checklists", Icons.Default.Assignment, "checklist_library"),
                    HomeModule("Accidents", Icons.Default.Warning, "accident_list_route"),
                    HomeModule("Washing", Icons.Default.LocalCarWash, "washing_route")
                )
                
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    modules.chunked(3).forEach { rowModules ->
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            rowModules.forEach { module ->
                                ModuleLauncherItem(module, modifier = Modifier.weight(1f)) {
                                    onNavigateToModule(module.route)
                                }
                            }
                            // Fill remaining space if the last row has fewer than 3 items
                            repeat(3 - rowModules.size) {
                                Spacer(modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
            }

            // Real-Time Schedule (Mirroring vehicles.tsx depth)
            item {
                SectionHeader(
                    title = "TODAY'S SCHEDULE",
                    onViewAll = { onNavigateToModule("work_order_list") }
                )
                Spacer(Modifier.height(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    // An empty schedule used to render as bare whitespace under the
                    // heading, which reads as a screen that failed to draw. The two
                    // cases are separated on purpose: nothing assigned is a fact about
                    // the day, a failed read is a fact about the app, and a user acts
                    // very differently on each.
                    when {
                        uiState.todaysJobs.isNotEmpty() -> uiState.todaysJobs.forEach { job ->
                            JobActionCard(job, onClick = { onAssetClick(job.id) })
                        }

                        uiState.isLoading -> Text(
                            "Loading today's jobs...",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline
                        )

                        uiState.partial || uiState.error != null -> Text(
                            "Today's jobs could not be loaded. Pull down to try again.",
                            style = MaterialTheme.typography.bodySmall,
                            color = StatusRed
                        )

                        else -> Text(
                            "No open jobs assigned.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline
                        )
                    }
                }
            }
            
            item { Spacer(Modifier.height(32.dp)) }
            }
            
            
        }
    }
}

data class HomeModule(val title: String, val icon: ImageVector, val route: String)

@Composable
fun ModuleLauncherItem(module: HomeModule, modifier: Modifier, onClick: () -> Unit) {
    Card(
        modifier = modifier.height(90.dp).clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(module.icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
            Spacer(Modifier.height(8.dp))
            Text(module.title, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun StatCard(count: String, label: String, color: Color, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.height(110.dp),
        colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.1f)),
        shape = RoundedCornerShape(24.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, color.copy(alpha = 0.2f))
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Text(text = count, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.ExtraBold, color = color)
            Text(text = label, style = MaterialTheme.typography.labelSmall, color = color.copy(alpha = 0.8f), fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun JobActionCard(job: JobSummary, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable { onClick() },
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(44.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.LocalShipping, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(job.assetName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(job.type, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(job.time, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                Text("DUE", style = MaterialTheme.typography.labelSmall, color = StatusRed, fontWeight = FontWeight.ExtraBold)
            }
        }
    }
}

@Composable
fun HighFidelityTopBar(
    userName: String?,
    onScanClick: () -> Unit,
    onNotificationsClick: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 24.dp).statusBarsPadding(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column {
            // Two fixed strings used to live here: the greeting "Good morning," shown
            // at every hour of the day, and the name "John Technician" shown to every
            // user on every device. The name now comes from the signed-in profile, and
            // when it has not loaded the greeting simply stands alone - an anonymous
            // greeting is honest, an invented name is not.
            Text(
                greetingForHour(remember { LocalTime.now().hour }) + if (userName != null) "," else "",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline
            )
            if (userName != null) {
                Text(userName, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onScanClick, modifier = Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) {
                Icon(Icons.Default.QrCodeScanner, contentDescription = "Scan QR")
            }
            Spacer(Modifier.width(8.dp))
            // The bell was a dead control - onClick did nothing. Home already receives a
            // navigation callback, and the notifications screen is a registered route.
            IconButton(onClick = onNotificationsClick, modifier = Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) {
                Icon(Icons.Default.Notifications, contentDescription = "Notifications")
            }
        }
    }
}

@Composable
fun SectionHeader(title: String, onViewAll: (() -> Unit)? = null) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        // "VIEW ALL" used to be `Modifier.clickable { }` - an empty lambda. It looked
        // like a control and did nothing when tapped, which reads to a user as the app
        // being broken. It now renders ONLY when a caller supplies a destination.
        if (onViewAll != null) {
            Text(
                "VIEW ALL",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.clickable { onViewAll() }
            )
        }
    }
}

/**
 * Render a KPI that was never measured as a dash, not as a number.
 *
 * These counts are nullable because a failed read and a real zero mean opposite
 * things. String-interpolating a null would print the word "null" on the dashboard;
 * printing 0 would be worse still, because it reads as a fact.
 */
private fun kpiText(value: Int?): String = value?.toString() ?: "-"

/**
 * Time-appropriate greeting. The header previously said "Good morning" at every hour
 * of the day, including to a night-shift crew at 2am - a small thing, but it is the
 * first line of the app and it was reliably wrong for a third of the fleet.
 *
 * Boundaries are local-clock hours: morning to 12, afternoon to 17, evening after.
 */
internal fun greetingForHour(hour: Int): String = when (hour) {
    in 0..11 -> "Good morning"
    in 12..16 -> "Good afternoon"
    else -> "Good evening"
}
