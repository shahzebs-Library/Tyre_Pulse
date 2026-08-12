package com.example.tyre_pulse_app.feature.tyre_replacement.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.model.RemovalReason
import com.example.tyre_pulse_app.core.model.Tyre

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TyreReplacementRoute(
    onBack: () -> Unit,
    viewModel: TyreReplacementViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(uiState.isSubmitted) {
        if (uiState.isSubmitted) {
            onBack()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Tyre Replacement - Step ${uiState.currentStep}/2") },
                navigationIcon = {
                    IconButton(onClick = { if (uiState.currentStep > 1) viewModel.prevStep() else onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        bottomBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .navigationBarsPadding(),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                if (uiState.currentStep == 1) {
                    Button(
                        onClick = viewModel::nextStep,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = uiState.selectedReason != null && !uiState.isLoading
                    ) {
                        Text("Next: Select New Tyre")
                    }
                } else {
                    Button(
                        onClick = viewModel::submit,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = uiState.selectedNewTyre != null && !uiState.isSubmitting
                    ) {
                        if (uiState.isSubmitting) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), color = Color.White)
                        } else {
                            Text("Submit Replacement")
                        }
                    }
                }
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (uiState.isLoading) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else {
                when (uiState.currentStep) {
                    1 -> RemovalStep(uiState, viewModel)
                    2 -> InstallationStep(uiState, viewModel)
                }
            }
        }
    }
}

@Composable
private fun RemovalStep(state: TyreReplacementUiState, viewModel: TyreReplacementViewModel) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp)
    ) {
        state.removedTyre?.let { tyre ->
            TPCard {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(text = "Currently Fitted", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(8.dp))
                    Text(text = tyre.serialNumber, style = MaterialTheme.typography.titleMedium)
                    Text(text = "${tyre.brand} • ${tyre.size}", style = MaterialTheme.typography.bodySmall)
                    Text(text = "Position: ${tyre.position ?: "N/A"}", style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        Text(text = "Removal Information", style = MaterialTheme.typography.titleMedium)
        
        OutlinedTextField(
            value = state.removalKm,
            onValueChange = viewModel::onKmChanged,
            label = { Text("Removal KM") },
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
        )

        Text(text = "Reason for Removal", style = MaterialTheme.typography.labelLarge)
        state.removalReasons.forEach { reason ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                RadioButton(
                    selected = state.selectedReason?.id == reason.id,
                    onClick = { viewModel.onReasonSelected(reason) }
                )
                Text(text = reason.name, modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}

@Composable
private fun InstallationStep(state: TyreReplacementUiState, viewModel: TyreReplacementViewModel) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp)
    ) {
        Text(text = "Select Replacement Tyre", style = MaterialTheme.typography.titleMedium)
        
        if (state.availableTyres.isEmpty()) {
            Text(text = "No compatible tyres available in stock.", color = MaterialTheme.colorScheme.error)
        } else {
            state.availableTyres.forEach { tyre ->
                TPCard(
                    onClick = { viewModel.onNewTyreSelected(tyre) },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = state.selectedNewTyre?.id == tyre.id,
                            onClick = { viewModel.onNewTyreSelected(tyre) }
                        )
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text(text = tyre.serialNumber, style = MaterialTheme.typography.titleSmall)
                            Text(text = "${tyre.brand} • ${tyre.pattern}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}
