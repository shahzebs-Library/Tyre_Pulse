package com.example.tyre_pulse_app.feature.report_issue.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Raise a fault from the field.
 *
 * Mirrors the Expo app's Report Issue screen, which the native app had no equivalent
 * of. One deliberate difference: the priority choices are High / Medium / Low only.
 * The Expo screen also offers "Critical", but the CHECK constraint on
 * corrective_actions.priority rejects it, so choosing it there means the issue is
 * never recorded at all.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportIssueRoute(
    assetNo: String? = null,
    site: String? = null,
    onBack: () -> Unit,
    onRaised: () -> Unit,
    viewModel: ReportIssueViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(assetNo, site) { viewModel.prefill(assetNo, site) }

    LaunchedEffect(uiState.error) {
        uiState.error?.let { snackbarHostState.showSnackbar(it) }
    }

    // Only leave the screen once the issue is genuinely recorded.
    LaunchedEffect(uiState.done) {
        if (uiState.done) {
            viewModel.consumeDone()
            onRaised()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Report an issue", fontWeight = FontWeight.Bold) },
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
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            OutlinedTextField(
                value = uiState.title,
                onValueChange = viewModel::onTitle,
                label = { Text("What is wrong?") },
                supportingText = { Text("Required") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            // FilterChip rather than SegmentedButton: the latter appears nowhere else in
            // this codebase, and an unresolved component is a build failure that only CI
            // would find. This also matches the "Due in" row below.
            Text("Priority", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ISSUE_PRIORITIES.forEach { priority ->
                    FilterChip(
                        selected = uiState.priority == priority,
                        onClick = { viewModel.onPriority(priority) },
                        label = { Text(priority) }
                    )
                }
            }

            OutlinedTextField(
                value = uiState.assetNo,
                onValueChange = viewModel::onAsset,
                label = { Text("Asset number") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = uiState.site,
                onValueChange = viewModel::onSite,
                label = { Text("Site") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = uiState.description,
                onValueChange = viewModel::onDescription,
                label = { Text("Details") },
                minLines = 4,
                modifier = Modifier.fillMaxWidth()
            )

            Text("Due in", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                listOf(1, 3, 7, 14).forEach { days ->
                    FilterChip(
                        selected = uiState.dueInDays == days,
                        onClick = { viewModel.onDueInDays(days) },
                        label = { Text(if (days == 1) "1 day" else "$days days") }
                    )
                }
                FilterChip(
                    selected = uiState.dueInDays == null,
                    onClick = { viewModel.onDueInDays(null) },
                    label = { Text("No date") }
                )
            }

            Spacer(Modifier.height(4.dp))

            Button(
                onClick = viewModel::submit,
                enabled = uiState.canSubmit,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
            ) {
                if (uiState.isSaving) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Icon(Icons.Default.Send, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Raise issue", fontWeight = FontWeight.Bold)
                }
            }

            Text(
                "Works offline. The issue is queued on this device and sent when you are back on a network.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
