package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.StatusOrange
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import com.example.tyre_pulse_app.core.model.WorkOrder

/**
 * One job card.
 *
 * WHAT THIS REPLACED. The header was a fixed picture of a job that does not exist -
 * "JOB-2025-0056", asset "Mixer 2841", work "Inspection & Alignment", assigned to
 * "John Technician", due "20 May 2025, 11:00 AM" - rendered underneath a REAL work
 * order loaded from the database. The screen showed one job in its title bar and a
 * different, invented one in its body, and the invented one was the detailed-looking
 * half.
 *
 * The header now renders [WorkOrderDetailsViewModel]'s real row and nothing else. A
 * field the row does not carry reads "Not recorded" - never a plausible stand-in.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobDetailsRoute(
    onBack: () -> Unit,
    viewModel: WorkOrderDetailsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        uiState.workOrder?.jobNumber?.takeIf { it.isNotBlank() }
                            ?.let { "Job #$it" }
                            ?: "Job Details",
                        fontWeight = FontWeight.Bold,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    uiState.workOrder?.status?.let { status ->
                        Text(
                            text = status.name,
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
            // Driven by the loaded row only. With no row there is no job to start,
            // so no button is offered - the old default of "pending" put a live
            // action in front of the user before anything had loaded.
            val status = uiState.workOrder?.status?.name?.lowercase()
            val canStart = status == "new" || status == "assigned"
            if (canStart) {
                Surface(modifier = Modifier.fillMaxWidth(), tonalElevation = 8.dp) {
                    Button(
                        onClick = { viewModel.startJob() },
                        enabled = !uiState.isStarting,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp)
                            .navigationBarsPadding(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = YellowPrimary,
                            contentColor = Color.Black,
                        )
                    ) {
                        Text(
                            if (uiState.isStarting) "Starting..." else "Start Job",
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = uiState.isLoading,
            onRefresh = { /* Reload happens on entry; no local refresh state to fake. */ },
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp)
            ) {
                // "We could not load it" and "there is nothing" are opposite
                // statements and must never render the same way.
                uiState.error?.let { message ->
                    item {
                        JobNotice(
                            icon = Icons.Default.ErrorOutline,
                            tone = StatusOrange,
                            title = "Could not load this job",
                            body = message,
                        )
                    }
                }

                uiState.workOrder?.let { order ->
                    item { JobHeaderCard(order) }
                }

                if (uiState.workOrder == null && uiState.error == null && !uiState.isLoading) {
                    item {
                        JobNotice(
                            icon = Icons.Default.Info,
                            tone = MaterialTheme.colorScheme.outline,
                            title = "Job not found",
                            body = "No job card matching this reference is visible to your account.",
                        )
                    }
                }

                // THE TASK CHECKLIST IS GONE ON PURPOSE. It listed five invented
                // steps - "Front Axle - 2 Tyres", "Middle Axle - 4 Tyres", "Rear
                // Axle - 4 Tyres", "Spare Tyre", "Documentation" - with the first
                // three pre-ticked and a progress bar hard-set to 60%, so every job
                // in the fleet opened as three-fifths finished. The `wo_tasks` table
                // holds 0 rows and this app exposes no API over it, so there is
                // genuinely nothing to show. Do not restore a sample checklist.
                if (uiState.workOrder != null) {
                    item {
                        JobNotice(
                            icon = Icons.Default.Info,
                            tone = MaterialTheme.colorScheme.outline,
                            title = "Task breakdown is not tracked yet",
                            body = "This job has no recorded task steps, so no " +
                                "progress can be shown against it.",
                        )
                    }
                }
            }
        }
    }
}

/**
 * The real job card.
 *
 * Every value is read from the loaded [WorkOrder]. Anything the row does not carry
 * says so explicitly, because a blank field and an invented one look identical to a
 * supervisor but mean opposite things.
 */
@Composable
fun JobHeaderCard(order: WorkOrder) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                order.jobNumber.takeIf { it.isNotBlank() } ?: "Job number not recorded",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline,
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                )
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(
                        order.assetNumber.takeIf { it.isNotBlank() } ?: "Asset not recorded",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        order.reportedIssue.takeIf { it.isNotBlank() }
                            ?: "No description recorded",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
            Spacer(Modifier.height(16.dp))
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                JobField(
                    label = "Assigned To",
                    // Unassigned is a real and common state; naming a technician
                    // who was never assigned would misdirect the whole workshop.
                    value = order.assignedTechnicianName?.takeIf { it.isNotBlank() },
                )
                JobField(
                    label = "Due Date",
                    value = formatRecordedAt(order.dueAt),
                    alignEnd = true,
                )
            }
            order.siteId?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(12.dp))
                JobField(label = "Site", value = it)
            }
        }
    }
}

/** A labelled value that states its own absence rather than rendering blank. */
@Composable
private fun JobField(label: String, value: String?, alignEnd: Boolean = false) {
    Column(
        horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall)
        Text(
            value ?: "Not recorded",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (value != null) FontWeight.Bold else FontWeight.Normal,
            color = if (value != null) MaterialTheme.colorScheme.onSurface
            else MaterialTheme.colorScheme.outline,
        )
    }
}

/** A single explanatory banner: a stated fact, never a silent blank. */
@Composable
private fun JobNotice(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tone: Color,
    title: String,
    body: String,
) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            Icon(icon, contentDescription = null, tint = tone)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(title, fontWeight = FontWeight.Bold, color = tone)
                Spacer(Modifier.height(4.dp))
                Text(
                    body,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}
