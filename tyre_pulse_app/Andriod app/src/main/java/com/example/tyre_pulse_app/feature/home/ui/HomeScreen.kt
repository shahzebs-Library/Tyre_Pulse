package com.example.tyre_pulse_app.feature.home.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.R
import com.example.tyre_pulse_app.core.authentication.UserRole
import com.example.tyre_pulse_app.core.designsystem.theme.*

@Composable
fun HomeRoute(
    onInspectClick: () -> Unit,
    onAssetClick: (String) -> Unit,
    onApprovalsClick: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    HomeScreen(
        uiState = uiState,
        onInspectClick = onInspectClick,
        onAssetClick = onAssetClick,
        onApprovalsClick = onApprovalsClick
    )
}

@Composable
fun HomeScreen(
    uiState: HomeUiState,
    onInspectClick: () -> Unit,
    onAssetClick: (String) -> Unit,
    onApprovalsClick: () -> Unit
) {
    Scaffold(
        topBar = { HomeTopBar() }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            item {
                Text(
                    text = "Today, 20 May 2025",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline
                )
            }

            // Agent 03: "In Progress" Work Hub
            item {
                ActiveWorkHub(
                    activeDrafts = listOf(
                        "Inspection: Mixer 2841" to "80%",
                        "Checklist: Daily Pre-Trip" to "40%"
                    ),
                    onResume = { /* TODO: Resume Draft */ }
                )
            }

            // Role-Based Stat Section
            item {
                when (uiState.role) {
                    UserRole.TECHNICIAN, UserRole.TYREMAN -> TechnicianStats(uiState)
                    UserRole.APPROVER, UserRole.ADMIN -> AdminStats(uiState)
                    UserRole.INSURANCE_OFFICER -> InsuranceStats(uiState)
                    else -> DefaultStats(uiState)
                }
            }

            // Role-Based Main Action Section
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val titleRes = when(uiState.role) {
                        UserRole.APPROVER -> R.string.alerts
                        else -> R.string.todays_schedule
                    }
                    Text(
                        text = stringResource(titleRes),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = stringResource(R.string.view_all),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clickable { /* TODO */ }
                    )
                }
            }

            // Dynamic List based on role
            if (uiState.role == UserRole.APPROVER) {
                // TODO: Show Pending Approvals List
            } else {
                items(uiState.todaysJobs) { job ->
                    JobItem(job, onClick = { onAssetClick(job.id) })
                }
            }
            
            item { Spacer(Modifier.height(80.dp)) }
        }
    }
}

@Composable
fun ActiveWorkHub(
    activeDrafts: List<Pair<String, String>>,
    onResume: (String) -> Unit
) {
    if (activeDrafts.isEmpty()) return
    
    Column(modifier = Modifier.padding(vertical = 8.dp)) {
        Text(
            text = "In Progress",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold
        )
        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            activeDrafts.forEach { (name, progress) ->
                Card(
                    modifier = Modifier.weight(1f).clickable { onResume(name) },
                    colors = CardDefaults.cardColors(containerColor = YellowPrimary.copy(alpha = 0.1f)),
                    border = androidx.compose.foundation.BorderStroke(1.dp, YellowPrimary.copy(alpha = 0.3f))
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(name, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, maxLines = 1)
                        Spacer(Modifier.height(4.dp))
                        Text(progress, style = MaterialTheme.typography.displaySmall, color = YellowPrimary, fontSize = 20.sp)
                        Text("Completed", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
        }
    }
}
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatCard(count = "${uiState.inspectionsDue}", label = "Due Today", color = StatusRed, modifier = Modifier.weight(1f))
            StatCard(count = "${uiState.openJobs}", label = "My Jobs", color = StatusBlue, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
fun AdminStats(uiState: HomeUiState) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatCard(count = "${uiState.pendingApprovals}", label = "Pending Apps", color = StatusOrange, modifier = Modifier.weight(1f))
            StatCard(count = "${uiState.criticalTyres}", label = "Critical Tyres", color = StatusRed, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
fun InsuranceStats(uiState: HomeUiState) {
    StatCard(count = "5", label = "Pending Claims", color = StatusBlue, modifier = Modifier.fillMaxWidth())
}

@Composable
fun DefaultStats(uiState: HomeUiState) {
    TechnicianStats(uiState) // Fallback
}

// Reuse StatCard and JobItem from previous implementation...
@Composable
fun StatCard(count: String, label: String, color: Color, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.height(100.dp),
        colors = CardDefaults.cardColors(containerColor = color),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Text(text = count, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Color.White)
            Text(text = label, style = MaterialTheme.typography.labelLarge, color = Color.White.copy(alpha = 0.8f))
        }
    }
}

@Composable
fun JobItem(job: JobSummary, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.primaryContainer))
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(text = job.assetName, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
                Text(text = job.type, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
            Text(text = job.time, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
fun HomeTopBar() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(16.dp).statusBarsPadding(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(48.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant))
            Spacer(Modifier.width(12.dp))
            Column {
                Text(text = "Good morning,", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                Text(text = "John Technician", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
        }
        IconButton(onClick = { /* TODO */ }, modifier = Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) {
            Icon(Icons.Default.Notifications, contentDescription = "Notifications")
        }
    }
}
