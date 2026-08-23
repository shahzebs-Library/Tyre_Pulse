package com.example.tyre_pulse_app.feature.approvals.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.designsystem.component.TPStatusChip
import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.model.ApprovalSource
import com.example.tyre_pulse_app.core.model.ApprovalStatus

/**
 * One record awaiting sign-off, and the decision on it.
 *
 * WHAT WAS REMOVED FROM THIS SCREEN, and why it mattered:
 *
 *  - A "Priority: Medium" row, hard-coded. NEITHER backing table has a priority
 *    column. It read as a fact about the request and was pure invention.
 *  - A "History" timeline reading "Request Created 10:30 AM" / "Maintenance
 *    Review 11:15 AM", hard-coded on every record. It presented an audit trail
 *    that did not exist. The real trail lives in `inspection_audit_log`, which
 *    this screen does not read - so it now shows nothing rather than a fiction.
 *
 * What is shown instead is what the row actually carries: asset, site, and -
 * for a checklist - which rung of the sign-off ladder is holding it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalDetailsRoute(
    onBack: () -> Unit,
    viewModel: ApprovalDetailsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val approval: Approval? = uiState.approval
    val snackbarHostState = remember { SnackbarHostState() }

    // A refused decision is reported where the reader is looking, and the record
    // stays on screen so they can see what they were deciding.
    LaunchedEffect(uiState.decisionError) {
        uiState.decisionError?.let { message ->
            snackbarHostState.showSnackbar(message)
            viewModel.dismissDecisionError()
        }
    }

    val isPending = approval?.status == ApprovalStatus.PENDING

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
            // Only a record that is still waiting can be decided. Offering the
            // buttons on a decided record invites a refusal the reader cannot act
            // on.
            if (approval != null && isPending) {
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
                            onClick = { viewModel.decide(approved = false, onComplete = onBack) },
                            enabled = !uiState.isDeciding,
                            modifier = Modifier
                                .weight(1f)
                                .height(48.dp),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = MaterialTheme.colorScheme.error
                            ),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.error)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Reject")
                        }
                        Button(
                            onClick = { viewModel.decide(approved = true, onComplete = onBack) },
                            enabled = viewModel.canApprove(uiState),
                            modifier = Modifier
                                .weight(1f)
                                .height(48.dp),
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
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.2f))
        ) {
            when {
                uiState.isLoading && approval == null -> {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }

                // "We could not look" and "there is nothing" are opposite
                // statements and must never render the same.
                uiState.error != null -> {
                    MessageState(
                        icon = Icons.Default.ErrorOutline,
                        title = "Could not load this request",
                        detail = uiState.error,
                        onRetry = viewModel::loadApproval,
                    )
                }

                approval == null -> {
                    MessageState(
                        icon = Icons.Default.HourglassEmpty,
                        title = "This request is no longer there",
                        detail = "It may have been decided or removed since the list was drawn.",
                        onRetry = viewModel::loadApproval,
                    )
                }

                else -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        HeaderSection(approval)
                        InfoSection(approval)
                        if (approval.description.isNotBlank()) {
                            DescriptionSection(approval)
                        }
                        if (isPending) {
                            DecisionSection(
                                approval = approval,
                                note = uiState.note,
                                onNoteChange = viewModel::onNoteChange,
                                onSignatureChange = viewModel::onSignatureChange,
                                signed = uiState.signature != null,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageState(
    icon: ImageVector,
    title: String,
    detail: String?,
    onRetry: () -> Unit,
) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp),
        ) {
            Icon(
                icon,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.outline,
            )
            Spacer(Modifier.height(12.dp))
            Text(title, style = MaterialTheme.typography.titleMedium)
            if (!detail.isNullOrBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    detail,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(16.dp))
            TextButton(onClick = onRetry) { Text("Try again") }
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
                        // A record may name nobody. An initial derived from an
                        // empty name would be a blank circle either way, so this
                        // does not invent a letter.
                        text = approval.requester.take(1),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
                Spacer(Modifier.width(16.dp))
                Column {
                    Text(
                        text = approval.requester.ifBlank { "Not recorded" },
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = approval.date.ifBlank { "No date recorded" },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
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
            Text(
                text = approval.title.ifBlank { "Untitled record" },
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            // WHICH RUNG is holding a checklist. "Pending" alone told the reader
            // nothing about who they are waiting on.
            approval.stage?.let { stage ->
                Spacer(Modifier.height(6.dp))
                Text(
                    text = stage,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFFEF6C00),
                )
            }
        }
    }
}

@Composable
fun InfoSection(approval: Approval) {
    TPCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Information",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(Modifier.height(12.dp))
            InfoRow(icon = Icons.Default.Category, label = "Record", value = approval.category)
            // Only what the row carries. A null renders as a dash, never as a
            // plausible default - see the removed "Priority: Medium".
            HorizontalDivider(
                modifier = Modifier.padding(vertical = 8.dp),
                color = MaterialTheme.colorScheme.outlineVariant
            )
            InfoRow(
                icon = Icons.Default.DirectionsCar,
                label = "Asset",
                value = approval.assetNo ?: "-"
            )
            HorizontalDivider(
                modifier = Modifier.padding(vertical = 8.dp),
                color = MaterialTheme.colorScheme.outlineVariant
            )
            InfoRow(icon = Icons.Default.Place, label = "Site", value = approval.site ?: "-")
        }
    }
}

@Composable
fun InfoRow(icon: ImageVector, label: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.outline
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.weight(1f))
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
fun DescriptionSection(approval: Approval) {
    TPCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Recorded notes",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = approval.description,
                style = MaterialTheme.typography.bodyMedium,
                lineHeight = 20.sp
            )
        }
    }
}

/**
 * The approver's own input: a reason and a signature.
 *
 * The signature is REQUIRED to approve a checklist - the RPC refuses without one.
 * Asking here turns that refusal into a disabled button with a stated reason.
 */
@Composable
private fun DecisionSection(
    approval: Approval,
    note: String,
    onNoteChange: (String) -> Unit,
    onSignatureChange: (String?) -> Unit,
    signed: Boolean,
) {
    TPCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Your decision",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = note,
                onValueChange = onNoteChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Reason or note (optional)") },
                supportingText = {
                    Text("Sent back with the record so the field knows what to fix.")
                },
                minLines = 2,
            )
            Spacer(Modifier.height(16.dp))
            ApprovalSignaturePad(onSignatureChange = onSignatureChange)
            if (approval.source == ApprovalSource.CHECKLIST && !signed) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Sign above to enable Approve. A checklist cannot be " +
                        "signed off without a signature.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
