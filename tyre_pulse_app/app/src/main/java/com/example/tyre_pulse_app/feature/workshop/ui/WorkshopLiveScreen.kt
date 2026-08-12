package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.*
import com.example.tyre_pulse_app.core.model.WorkOrder

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkshopLiveRoute(
    onBack: () -> Unit,
    viewModel: WorkshopLiveViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Workshop Live", fontWeight = FontWeight.ExtraBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Check-In Banner
            CheckInBanner(
                isCheckedIn = uiState.isCheckedIn,
                onToggle = { 
                    viewModel.recordEvent(if (uiState.isCheckedIn) "check_out" else "check_in") 
                }
            )

            // Productivity Rollup
            ProductivityCard(uiState.productivity)

            // My Jobs List
            Text("MY OPEN JOBS", style = MaterialTheme.typography.labelSmall, color = YellowPrimary, fontWeight = FontWeight.Bold)
            
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(uiState.jobs) { job ->
                    JobInteractionCard(
                        job = job,
                        isSelected = uiState.selectedJobId == job.id,
                        onClick = { viewModel.selectJob(job.id) },
                        onAction = { type -> viewModel.recordEvent(type, job.id) }
                    )
                }
            }
        }
    }
}

@Composable
fun CheckInBanner(isCheckedIn: Boolean, onToggle: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = if (isCheckedIn) StatusGreen.copy(alpha = 0.1f) else MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(12.dp).clip(CircleShape).background(if (isCheckedIn) StatusGreen else Color.Gray))
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(if (isCheckedIn) "On Duty" else "Off Duty", fontWeight = FontWeight.Bold)
                Text("Site A - Workshop", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
            Button(onClick = onToggle, colors = ButtonDefaults.buttonColors(containerColor = if (isCheckedIn) Color.Gray else YellowPrimary)) {
                Text(if (isCheckedIn) "Check Out" else "Check In", color = Color.Black)
            }
        }
    }
}

@Composable
fun ProductivityCard(prod: Productivity) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = OLED_Card)
    ) {
        Row(modifier = Modifier.padding(16.dp), horizontalArrangement = Arrangement.SpaceAround) {
            ProdItem("${prod.productiveMin}m", "Productive", StatusGreen)
            ProdItem("${prod.blockedMin}m", "Blocked", StatusOrange)
            ProdItem("${prod.jobsCompleted}", "Completed", YellowPrimary)
        }
    }
}

@Composable
fun ProdItem(value: String, label: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, color = color)
        Text(label, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f))
    }
}

@Composable
fun JobInteractionCard(job: WorkOrder, isSelected: Boolean, onClick: () -> Unit, onAction: (String) -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable { onClick() },
        border = if (isSelected) androidx.compose.foundation.BorderStroke(2.dp, YellowPrimary) else null,
        colors = CardDefaults.cardColors(containerColor = if (isSelected) OLED_Card else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.LocalShipping, contentDescription = null, tint = YellowPrimary)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(job.assetNumber, fontWeight = FontWeight.Bold)
                    Text("WO ${job.jobNumber}", style = MaterialTheme.typography.bodySmall)
                }
                Icon(if (isSelected) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown, contentDescription = null)
            }

            if (isSelected) {
                Spacer(Modifier.height(16.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActionButton("START", Icons.Default.PlayArrow, StatusGreen, Modifier.weight(1f)) { onAction("start_job") }
                    ActionButton("PAUSE", Icons.Default.Pause, StatusOrange, Modifier.weight(1f)) { onAction("pause_job") }
                    ActionButton("DONE", Icons.Default.DoneAll, StatusBlue, Modifier.weight(1f)) { onAction("complete_task") }
                }
            }
        }
    }
}

@Composable
fun ActionButton(label: String, icon: ImageVector, color: Color, modifier: Modifier, onClick: () -> Unit) {
    Surface(
        modifier = modifier.height(64.dp).clickable { onClick() },
        color = color.copy(alpha = 0.1f),
        shape = RoundedCornerShape(12.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, color.copy(alpha = 0.4f))
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(20.dp))
            Text(label, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.ExtraBold, color = color)
        }
    }
}
