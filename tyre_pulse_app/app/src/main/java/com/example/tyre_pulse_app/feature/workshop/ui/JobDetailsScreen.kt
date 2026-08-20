package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.R
import com.example.tyre_pulse_app.core.designsystem.theme.StatusGreen
import com.example.tyre_pulse_app.core.designsystem.theme.StatusOrange
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobDetailsRoute(
    onBack: () -> Unit,
    viewModel: WorkOrderDetailsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(uiState.workOrder?.let { "Job #${it.workOrderNo}" } ?: "Job Details", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    uiState.workOrder?.status?.let { status ->
                        Text(
                            text = status,
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier
                                .padding(end = 16.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(StatusOrange.copy(alpha = 0.2f))
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            color = StatusOrange
                        )
                    }
                }
            )
        },
        bottomBar = {
            val status = uiState.workOrder?.status?.name?.lowercase() ?: "pending"
            val showButton = status == "pending" || status == "assigned" || status == "in_progress" || status == "started" || status == "new"
            if (showButton) {
                Surface(modifier = Modifier.fillMaxWidth(), tonalElevation = 8.dp) {
                    Button(
                        onClick = {
                            if (status == "pending" || status == "assigned") {
                                viewModel.startJob()
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp)
                            .navigationBarsPadding(),
                        colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black)
                    ) {
                        Text(if (status == "pending" || status == "assigned") "Start Job" else "Complete Job", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            item {
                JobHeaderCard()
            }
            
            item {
                Text("Tasks (3/5)", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { 0.6f },
                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(CircleShape),
                    color = StatusGreen,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant
                )
            }

            items(listOf(
                "Front Axle - 2 Tyres" to true,
                "Middle Axle - 4 Tyres" to true,
                "Rear Axle - 4 Tyres" to false,
                "Spare Tyre" to false,
                "Documentation" to false
            )) { (task, isDone) ->
                TaskRow(task, isDone)
            }
        }
    }
}

@Composable
fun JobHeaderCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("JOB-2025-0056", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant))
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Mixer 2841", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text("Inspection & Alignment", style = MaterialTheme.typography.bodySmall)
                }
            }
            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text("Assigned To", style = MaterialTheme.typography.labelSmall)
                    Text("John Technician", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("Due Date", style = MaterialTheme.typography.labelSmall)
                    Text("20 May 2025, 11:00 AM", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun TaskRow(name: String, isDone: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = if (isDone) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked,
            contentDescription = null,
            tint = if (isDone) StatusGreen else MaterialTheme.colorScheme.outline
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = name,
            style = MaterialTheme.typography.bodyLarge,
            color = if (isDone) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline
        )
    }
}
