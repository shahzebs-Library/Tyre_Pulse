package com.example.tyre_pulse_app.feature.maintenance.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Build
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.network.dto.PM_OUTCOMES

/**
 * Maintenance Due.
 *
 * Recording a service goes through the record_pm_service RPC, which writes the
 * service record and advances the programme's next due date in one transaction. The
 * new due date shown afterwards is the server's, never one calculated here.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaintenanceRoute(
    onBack: () -> Unit,
    viewModel: MaintenanceViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var recording by remember { mutableStateOf<PmPlan?>(null) }

    LaunchedEffect(uiState.error, uiState.savedMessage) {
        (uiState.error ?: uiState.savedMessage)?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.consumeMessage()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Maintenance due", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {

            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // These counts are only meaningful after a clean read. On a failed read
                // they would otherwise both show 0, which reads as "nothing is due".
                DueTile("Overdue", if (uiState.loadedCleanly) uiState.overdue.toString() else "-", Modifier.weight(1f))
                DueTile("Due soon", if (uiState.loadedCleanly) uiState.dueSoon.toString() else "-", Modifier.weight(1f))
                DueTile("Active", if (uiState.loadedCleanly) uiState.plans.size.toString() else "-", Modifier.weight(1f))
            }

            when {
                uiState.isLoading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }

                uiState.error != null -> EmptyMessage(
                    title = "Could not load maintenance",
                    body = uiState.error ?: "",
                    actionLabel = "Try again",
                    onAction = { viewModel.load() }
                )

                uiState.plans.isEmpty() -> EmptyMessage(
                    title = "Nothing scheduled",
                    // Says what it means: this is a real empty result, not a failure.
                    body = "No active maintenance programmes were found for your scope.",
                    actionLabel = "Refresh",
                    onAction = { viewModel.load() }
                )

                else -> LazyColumn(
                    contentPadding = PaddingValues(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(uiState.plans, key = { it.id }) { plan ->
                        PlanCard(plan) { recording = plan }
                    }
                }
            }
        }
    }

    recording?.let { plan ->
        RecordServiceSheet(
            plan = plan,
            isSaving = uiState.isSaving,
            onDismiss = { recording = null },
            onSubmit = { meter, by, workshop, parts, labour, findings, outcome ->
                viewModel.recordService(plan, meter, by, workshop, parts, labour, findings, outcome)
                recording = null
            }
        )
    }
}

@Composable
private fun DueTile(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun PlanCard(plan: PmPlan, onRecord: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(plan.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                DueChip(plan)
            }
            plan.assetNo?.let { Text("Asset $it", style = MaterialTheme.typography.bodySmall) }
            plan.site?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }

            Text(
                // A programme with no due date says so; it does not render as a date or
                // as "0 days".
                plan.nextDue?.let { "Next due $it" } ?: "No due date set",
                style = MaterialTheme.typography.bodySmall
            )
            plan.nextDueMeter?.let { meter ->
                val unit = if (plan.meterSource == "engine_hours") "hours" else "km"
                Text("Or at ${meter.toLong()} $unit", style = MaterialTheme.typography.bodySmall)
            }

            Button(onClick = onRecord, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
                Icon(Icons.Default.Build, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Record service")
            }
        }
    }
}

@Composable
private fun DueChip(plan: PmPlan) {
    val (label, colour) = when (plan.band) {
        DueBand.OVERDUE -> "Overdue" to MaterialTheme.colorScheme.error
        DueBand.DUE_SOON -> "Due soon" to MaterialTheme.colorScheme.tertiary
        DueBand.OK -> "Scheduled" to MaterialTheme.colorScheme.primary
        DueBand.NO_DATE -> "No date" to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(color = colour.copy(alpha = 0.12f), shape = MaterialTheme.shapes.small) {
        Text(
            label,
            color = colour,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
        )
    }
}

@Composable
private fun EmptyMessage(title: String, body: String, actionLabel: String, onAction: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(16.dp))
        OutlinedButton(onClick = onAction) { Text(actionLabel) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RecordServiceSheet(
    plan: PmPlan,
    isSaving: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (Double?, String?, String?, Double?, Double?, String?, String) -> Unit,
) {
    var meter by remember { mutableStateOf("") }
    var performedBy by remember { mutableStateOf("") }
    var workshop by remember { mutableStateOf("") }
    var partsCost by remember { mutableStateOf("") }
    var labourCost by remember { mutableStateOf("") }
    var findings by remember { mutableStateOf("") }
    var outcome by remember { mutableStateOf(PM_OUTCOMES.first()) }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = 20.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(plan.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

            OutlinedTextField(meter, { meter = it }, label = { Text("Meter reading") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(performedBy, { performedBy = it }, label = { Text("Performed by") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(workshop, { workshop = it }, label = { Text("Workshop") }, singleLine = true, modifier = Modifier.fillMaxWidth())

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(partsCost, { partsCost = it }, label = { Text("Parts cost") }, singleLine = true, modifier = Modifier.weight(1f))
                OutlinedTextField(labourCost, { labourCost = it }, label = { Text("Labour cost") }, singleLine = true, modifier = Modifier.weight(1f))
            }

            OutlinedTextField(findings, { findings = it }, label = { Text("Findings") }, minLines = 3, modifier = Modifier.fillMaxWidth())

            Text("Outcome", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PM_OUTCOMES.forEach { option ->
                    FilterChip(
                        selected = outcome == option,
                        onClick = { outcome = option },
                        label = { Text(option.replaceFirstChar { c -> c.uppercase() }) }
                    )
                }
            }

            Button(
                onClick = {
                    // A blank cost is NOT zero - it means nothing was entered, and the
                    // RPC accepts null for exactly that.
                    onSubmit(
                        meter.toDoubleOrNull(), performedBy, workshop,
                        partsCost.toDoubleOrNull(), labourCost.toDoubleOrNull(),
                        findings, outcome
                    )
                },
                enabled = !isSaving,
                modifier = Modifier.fillMaxWidth().height(52.dp)
            ) {
                Text(if (isSaving) "Saving..." else "Record service", fontWeight = FontWeight.Bold)
            }
        }
    }
}
