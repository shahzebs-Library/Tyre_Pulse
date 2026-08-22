package com.example.tyre_pulse_app.feature.approvals.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.model.ApprovalStatus
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.designsystem.component.TPStatusChip

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalDetailsRoute(
    onBack: () -> Unit,
    viewModel: ApprovalDetailsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val approval: Approval? = uiState.approval
    val snackbarHostState = androidx.compose.runtime.remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Request Details", style = MaterialTheme.typography.titleLarge) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                )
            )
        },
        bottomBar = {
            if (approval != null) {
                Surface(shadowElevation = 8.dp) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surface)
                            .padding(16.dp)
                            .navigationBarsPadding(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        OutlinedButton(
                            onClick = { viewModel.updateStatus(ApprovalStatus.REJECTED, onBack) },
                            modifier = Modifier.weight(1f).height(48.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.error)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Reject")
                        }
                        Button(
                            onClick = { viewModel.updateStatus(ApprovalStatus.APPROVED, onBack) },
                            modifier = Modifier.weight(1f).height(48.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
                        ) {
                            Icon(Icons.Default.Check, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Approve")
                        }
                    }
                }
            }
        }
    ) { padding ->
        if (approval != null) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.2f))
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                HeaderSection(approval)
                InfoSection(approval)
                DescriptionSection(approval)
                TimelineSection()
            }
        } else {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
    }
}

@Composable
fun HeaderSection(approval: Approval) {
    TPCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = approval.requester.take(1),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
                Spacer(Modifier.width(16.dp))
                Column {
                    Text(text = approval.requester, style = MaterialTheme.typography.titleMedium)
                    Text(text = "Requested on ${approval.date}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                }
                Spacer(Modifier.weight(1f))
                val (color, label) = when (approval.status) {
                    ApprovalStatus.PENDING -> Color(0xFFEF6C00) to "PENDING"
                    ApprovalStatus.APPROVED -> Color(0xFF2E7D32) to "APPROVED"
                    ApprovalStatus.REJECTED -> MaterialTheme.colorScheme.error to "REJECTED"
                }
                TPStatusChip(label = label, statusColor = color)
            }
            Spacer(Modifier.height(16.dp))
            Text(text = approval.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun InfoSection(approval: Approval) {
    TPCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "Information", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(12.dp))
            InfoRow(icon = Icons.Default.Category, label = "Category", value = approval.category)
            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
            InfoRow(icon = Icons.Default.Fingerprint, label = "Request ID", value = "#${approval.id}")
            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
            InfoRow(icon = Icons.Default.PriorityHigh, label = "Priority", value = "Medium")
        }
    }
}

@Composable
fun InfoRow(icon: ImageVector, label: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.outline)
        Spacer(Modifier.width(12.dp))
        Text(text = label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.weight(1f))
        Text(text = value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun DescriptionSection(approval: Approval) {
    TPCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "Description", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            Text(text = approval.description, style = MaterialTheme.typography.bodyMedium, lineHeight = 20.sp)
        }
    }
}

@Composable
fun TimelineSection() {
    TPCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "History", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(12.dp))
            TimelineItem("Request Created", "10:30 AM", isLast = false)
            TimelineItem("Maintenance Review", "11:15 AM", isLast = true)
        }
    }
}

@Composable
fun TimelineItem(title: String, time: String, isLast: Boolean) {
    Row {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(12.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
            if (!isLast) {
                Box(Modifier.width(2.dp).height(24.dp).background(MaterialTheme.colorScheme.outlineVariant))
            }
        }
        Spacer(Modifier.width(12.dp))
        Column {
            Text(text = title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text(text = time, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            if (!isLast) Spacer(Modifier.height(16.dp))
        }
    }
}
