package com.example.tyre_pulse_app.feature.meters.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeterLogRoute(
    onBack: () -> Unit,
    viewModel: MeterLogViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = androidx.compose.runtime.remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Meter Logs", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            Text("Update Odometer & Engine Hours", style = MaterialTheme.typography.titleMedium)

            // The screen had NO asset field at all: assetNo defaulted to "" and nothing
            // could set it, so every reading was filed against no machine. The asset is
            // confirmed against the fleet register before anything can be saved -
            // a reading against an unknown asset number is unattributable.
            OutlinedTextField(
                value = uiState.assetNo,
                onValueChange = viewModel::onAssetChanged,
                label = { Text("Asset number") },
                singleLine = true,
                isError = uiState.lookupError != null,
                supportingText = {
                    when {
                        uiState.lookupError != null -> Text(uiState.lookupError!!)
                        uiState.assetResolved -> Text(
                            uiState.assetSite?.let { "Found - $it" } ?: "Found"
                        )
                        else -> Text("Enter the asset number, then Find")
                    }
                },
                trailingIcon = {
                    TextButton(
                        onClick = { viewModel.lookupAsset() },
                        enabled = uiState.assetNo.isNotBlank() && !uiState.isLookingUp
                    ) { Text(if (uiState.isLookingUp) "..." else "Find") }
                },
                modifier = Modifier.fillMaxWidth()
            )

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Speed, contentDescription = null, tint = StatusBlue)
                        Spacer(Modifier.width(8.dp))
                        // Was "Current Odometer: 125420 KM" - a hard-coded number shown
                        // for every asset, which the new reading was then validated
                        // against. Null means no reading is on record, which is a fact,
                        // not a zero.
                        Text(
                            uiState.previousKm?.let { "Last odometer: $it km" }
                                ?: "No odometer reading on record",
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(
                        value = uiState.newKm,
                        onValueChange = viewModel::onKmChanged,
                        label = { Text("New Odometer Reading") },
                        isError = uiState.kmError != null,
                        // A backwards reading WARNS, it does not block: a meter can be
                        // replaced or roll over, and refusing would leave the reading
                        // uncaptured entirely.
                        supportingText = (uiState.kmError ?: uiState.kmWarning)?.let { { Text(it) } },
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
                    )
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Timer, contentDescription = null, tint = StatusOrange)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            uiState.previousHours?.let { "Last hour meter: $it hrs" }
                                ?: "No hour reading on record",
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(
                        value = uiState.newHours,
                        onValueChange = viewModel::onHoursChanged,
                        label = { Text("New Hour Reading") },
                        isError = uiState.hoursError != null,
                        supportingText = (uiState.hoursError ?: uiState.hoursWarning)?.let { { Text(it) } },
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
                    )
                }
            }

            Button(
                onClick = { viewModel.submit(onSuccess = onBack) },
                modifier = Modifier.fillMaxWidth().height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                shape = RoundedCornerShape(12.dp),
                enabled = uiState.canSubmit
            ) {
                Text(if (uiState.isSubmitting) "Saving..." else "Update Readings", fontWeight = FontWeight.Bold)
            }

            // submit() used to call onSuccess() unconditionally, so a failed enqueue
            // still reported a saved reading and the screen closed.
            uiState.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
