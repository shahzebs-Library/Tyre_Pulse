package com.example.tyre_pulse_app.feature.inspections.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreLayout

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InspectionFormScreen(
    assetId: String,
    onBack: () -> Unit,
    onTyreClick: (String) -> Unit,
    viewModel: InspectionViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedPosition by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Vehicle Inspection", fontWeight = FontWeight.ExtraBold) },
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
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
        ) {
            // Asset Info Header
            Card(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("ASSET #$assetId", style = MaterialTheme.typography.labelSmall, color = YellowPrimary, fontWeight = FontWeight.Bold)
                    Text("Inspection in progress", style = MaterialTheme.typography.bodyMedium)
                }
            }

            // High-Fidelity Interactive Map (Mirroring Expo)
            uiState.asset?.let { asset ->
                VehicleTyreLayout(
                    asset = asset,
                    inspection = uiState.inspection,
                    selectedPosition = selectedPosition,
                    onTyreClick = { pos ->
                        selectedPosition = pos
                        onTyreClick(pos)
                    },
                    modifier = Modifier.weight(1f)
                )
            } ?: Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }

            // Control Bar
            Surface(tonalElevation = 8.dp, modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = { viewModel.submit() },
                    modifier = Modifier.fillMaxWidth().padding(20.dp).height(56.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                    shape = RoundedCornerShape(12.dp),
                    enabled = !uiState.isSubmitting
                ) {
                    Text("FINISH INSPECTION", fontWeight = FontWeight.ExtraBold)
                }
            }
        }
    }
}
