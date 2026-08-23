package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.model.Accident

/**
 * One accident case, read from the record the user tapped.
 *
 * THREE THINGS WERE REMOVED HERE, all of them reachable in the shipped app:
 *
 * 1. A fabricated details card - "Status: Under Review", "Assigned Officer: Sarah
 *    Connor", and a narrative about "Vehicle TRK-09" and a "3D telematics model".
 *    None of it came from the case being viewed; `caseId` was accepted and then
 *    never used, so every incident in the register opened the same invented story.
 *
 * 2. A "3D Model Viewer" panel captioned "Drag to rotate - Pinch to zoom" with two
 *    zoom buttons wired to empty lambdas. There is no 3D model anywhere in this
 *    system. It was commented "Mock" in the source, but nothing on screen said so.
 *
 * 3. An "Export PDF Report" button with an empty onClick. A dead control on an
 *    evidence screen is worse than an absent one: someone presses it, sees no error,
 *    and believes a report was filed.
 *
 * Every field below is rendered only when the record carries it. There is no
 * "assigned officer" column in the accident schema, so that line is gone rather than
 * back-filled from the nearest available name.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccidentCaseScreen(
    caseId: String,
    onBack: () -> Unit,
    viewModel: AccidentCaseViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(caseId) { viewModel.load(caseId) }

    val accident = uiState.accident

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                // The reference number is what an operator quotes; the row id is not.
                // Falls back to the id only when the record has no reference yet.
                title = {
                    Text(
                        accident?.accidentNumber?.takeIf { it.isNotBlank() }
                            ?.let { "Case $it" }
                            ?: "Case",
                        fontWeight = FontWeight.Bold
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            when {
                uiState.isLoading -> CircularProgressIndicator(Modifier.align(Alignment.Center))

                uiState.error != null -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        uiState.error ?: "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error
                    )
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { viewModel.load(caseId) }) { Text("Try again") }
                }

                accident != null -> CaseDetail(accident)
            }
        }
    }
}

@Composable
private fun CaseDetail(accident: Accident) {
    Column(
        modifier = Modifier.padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Incident", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Status and severity are stored as lower-case tokens; presented as
                // written rather than mapped to prettier words that could drift from
                // what the register and the web app show for the same row.
                DetailRow("Status", accident.status.name.lowercase().replaceFirstChar { it.uppercase() })
                DetailRow("Severity", accident.severity.replaceFirstChar { it.uppercase() })
                DetailRow("Asset", accident.assetNumber)
                DetailRow("Date", accident.date)
                DetailRow("Time", accident.time)
                DetailRow("Site", accident.site)
                DetailRow("Location", accident.location)
                DetailRow("Driver", accident.driverName)
                DetailRow("Reported by", accident.reporterName ?: accident.reportedBy)
                DetailRow("Police report", accident.policeReportNo)
            }
        }

        Text("What happened", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp)) {
                val description = accident.description?.takeIf { it.isNotBlank() }
                Text(
                    // No description is a gap in the report, and saying so is what
                    // prompts someone to fill it in. The screen used to print a
                    // fabricated paragraph here instead.
                    description ?: "No description was recorded for this incident.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (description != null) MaterialTheme.colorScheme.onSurface
                    else MaterialTheme.colorScheme.outline
                )
            }
        }

        val damage = accident.damageDescription?.takeIf { it.isNotBlank() }
        if (damage != null) {
            Text("Damage", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Card(modifier = Modifier.fillMaxWidth()) {
                Text(
                    damage,
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
}

/**
 * One labelled fact. Renders nothing at all when the value is absent, so the card
 * shows what IS recorded rather than a column of dashes - but a caller that needs to
 * make a gap visible (a missing description) states it in words instead.
 */
@Composable
private fun DetailRow(label: String, value: String?) {
    val clean = value?.takeIf { it.isNotBlank() } ?: return
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        Text(clean, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
    }
}
