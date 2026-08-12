package com.example.tyre_pulse_app.feature.washing.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.LocalLaundryService
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.R
import com.example.tyre_pulse_app.core.designsystem.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WashingRoute(
    onBack: () -> Unit,
    viewModel: WashingViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Vehicle Washing", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            item {
                Text("Due for Wash", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                uiState.dueVehicles.forEach { asset ->
                    WashDueItem(asset, onClick = { viewModel.onAssetSelected(asset) })
                }
            }

            item {
                Text("Log New Wash", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = uiState.selectedAsset ?: "",
                    onValueChange = { viewModel.onAssetSelected(it) },
                    label = { Text("Asset Number") },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Text("Wash Type", style = MaterialTheme.typography.labelLarge)
                val types = listOf("Exterior", "Interior", "Full", "Engine")
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    types.forEach { type ->
                        val isSelected = uiState.washType == type
                        FilterChip(
                            selected = isSelected,
                            onClick = { viewModel.onWashTypeSelected(type) },
                            label = { Text(type) }
                        )
                    }
                }
            }

            item {
                Button(
                    onClick = { viewModel.submitWash() },
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                    shape = RoundedCornerShape(12.dp),
                    enabled = uiState.selectedAsset != null && !uiState.isLoading
                ) {
                    if (uiState.isLoading) CircularProgressIndicator(color = Color.Black)
                    else Text("Submit Wash Record", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun WashDueItem(asset: String, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable { onClick() },
        color = StatusOrange.copy(alpha = 0.1f),
        shape = RoundedCornerShape(12.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, StatusOrange.copy(alpha = 0.2f))
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.LocalLaundryService, contentDescription = null, tint = StatusOrange)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(asset, fontWeight = FontWeight.Bold)
                Text("Last wash: 15 days ago", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
