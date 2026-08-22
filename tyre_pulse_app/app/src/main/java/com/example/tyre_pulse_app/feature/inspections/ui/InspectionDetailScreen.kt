package com.example.tyre_pulse_app.feature.inspections.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import com.example.tyre_pulse_app.core.designsystem.component.StatusChip
import com.example.tyre_pulse_app.core.designsystem.component.VehicleDiagram3D
import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.ui.input.nestedscroll.nestedScroll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InspectionDetailScreen(
    assetId: String, 
    onBack: () -> Unit,
    onTyreClick: (String) -> Unit,
    viewModel: InspectionViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    val snackbarHostState = remember { SnackbarHostState() }
    val pullToRefreshState = rememberPullToRefreshState()
    
    if (pullToRefreshState.isRefreshing) {
        LaunchedEffect(true) {
            delay(1000)
            pullToRefreshState.endRefresh()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(uiState.asset?.let { "Inspect ${it.assetNumber}" } ?: "Inspect Asset", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .nestedScroll(pullToRefreshState.nestedScrollConnection)
        ) {
            if (uiState.isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else if (uiState.error != null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(text = uiState.error ?: "Failed to load asset details", color = MaterialTheme.colorScheme.error)
            }
        } else {
            val asset = uiState.asset
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                item {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = "Tap a tyre on the 3D model or select from the list to record readings.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                if (asset != null) {
                    item {
                        VehicleDiagram3D(
                            vehicleType = asset.type ?: "Truck",
                            fittedTyres = asset.tyres,
                            onTyreClick = onTyreClick,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(320.dp)
                        )
                    }

                    item {
                        Text(
                            text = "Fitted Tyres (${asset.tyres.size})",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    items(asset.tyres) { tyre ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onTyreClick(tyre.id) },
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
                            )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(
                                        text = "Position ${tyre.position}",
                                        style = MaterialTheme.typography.bodyLarge,
                                        fontWeight = FontWeight.Bold
                                    )
                                    Spacer(Modifier.height(2.dp))
                                    Text(
                                        text = "Serial: ${tyre.serialNumber} • Brand: ${tyre.brand}",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                val condColor = when (tyre.condition?.lowercase()) {
                                    "good" -> Color(0xFF10B981)
                                    "warning", "worn" -> Color(0xFFF59E0B)
                                    "critical", "danger" -> Color(0xFFEF4444)
                                    else -> Color(0xFF94A3B8)
                                }
                                StatusChip(
                                    text = tyre.condition ?: "Good",
                                    statusColor = condColor
                                )
                            }
                        }
                    }
                }
                item {
                    Spacer(Modifier.height(16.dp))
                }
            }
            PullToRefreshContainer(
                state = pullToRefreshState,
                modifier = Modifier.align(Alignment.TopCenter)
            )
        }
    }
}
