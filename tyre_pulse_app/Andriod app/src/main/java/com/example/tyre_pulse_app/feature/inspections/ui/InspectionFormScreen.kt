package com.example.tyre_pulse_app.feature.inspections.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreLayout

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InspectionFormRoute(
    onBack: () -> Unit,
    onTyreClick: (String, String) -> Unit, // assetId, tyreId
    viewModel: InspectionViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showExitConfirmation by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.isSubmitted) {
        if (uiState.isSubmitted) {
            onBack()
        }
    }

    BackHandler {
        showExitConfirmation = true
    }

    if (showExitConfirmation) {
        AlertDialog(
            onDismissRequest = { showExitConfirmation = false },
            title = { Text("Exit Inspection?") },
            text = { Text("Your progress is saved as a draft, but the inspection is not yet submitted.") },
            confirmButton = {
                TextButton(onClick = onBack) { Text("Exit") }
            },
            dismissButton = {
                TextButton(onClick = { showExitConfirmation = false }) { Text("Continue") }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Vehicle Inspection") },
                navigationIcon = {
                    IconButton(onClick = { showExitConfirmation = true }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (uiState.inspection != null) {
                        // Agent G-11: Debounced Submit to prevent duplicate records
                        IconButton(
                            onClick = { if (!uiState.isSubmitting) viewModel.submit() }, 
                            enabled = !uiState.isSubmitting
                        ) {
                            if (uiState.isSubmitting) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), color = com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary)
                            } else {
                                Icon(Icons.Default.Check, contentDescription = "Submit")
                            }
                        }
                    }
                }
            )
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (uiState.isLoading) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else if (uiState.asset != null && uiState.inspection != null) {
                InspectionFormContent(
                    asset = uiState.asset!!,
                    inspection = uiState.inspection!!,
                    onTyreClick = { tyreId -> onTyreClick(uiState.asset!!.id, tyreId) }
                )
            }
        }
    }
}

@Composable
private fun InspectionFormContent(
    asset: com.example.tyre_pulse_app.core.model.Asset,
    inspection: com.example.tyre_pulse_app.core.model.Inspection,
    onTyreClick: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        AssetSummaryHeader(asset)
        
        Text(text = "Tyre Layout", style = MaterialTheme.typography.titleMedium)
        
        VehicleTyreLayout(
            asset = asset,
            inspection = inspection,
            onTyreClick = onTyreClick
        )
        
        // General remarks
        OutlinedTextField(
            value = inspection.notes ?: "",
            onValueChange = { /* TODO */ },
            label = { Text("General Remarks") },
            modifier = Modifier.fillMaxWidth().height(120.dp)
        )
    }
}

@Composable
private fun AssetSummaryHeader(asset: com.example.tyre_pulse_app.core.model.Asset) {
    TPCard {
        Row(modifier = Modifier.padding(16.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text(text = asset.assetNumber, style = MaterialTheme.typography.titleMedium)
                Text(text = "${asset.make} ${asset.model}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
            Spacer(Modifier.weight(1f))
            Text(text = "Type: ${asset.type}", style = MaterialTheme.typography.labelSmall)
        }
    }
}
