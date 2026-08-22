package com.example.tyre_pulse_app.feature.inventory.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StockManagementScreen(
    onScanClick: () -> Unit,
    onBackClick: () -> Unit
) {
    val offlineCacheCount = 3 // Dummy count for un-synced items
    val inventoryParts = listOf(
        "PART:hydraulic_pump_v2" to 4,
        "PART:heavy_duty_tyre_22.5" to 12,
        "PART:engine_filter_x1" to 0
    )
    
    val pullToRefreshState = rememberPullToRefreshState()
    val snackbarHostState = remember { SnackbarHostState() }

    if (pullToRefreshState.isRefreshing) {
        LaunchedEffect(true) {
            pullToRefreshState.endRefresh()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(title = { Text("Offline Inventory Edge-Sync") })
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onScanClick) {
                Icon(Icons.Default.QrCodeScanner, contentDescription = "Audit Scan")
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .nestedScroll(pullToRefreshState.nestedScrollConnection)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp).fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column {
                            Text("Offline Deductions Cached", style = MaterialTheme.typography.titleMedium)
                            Text("$offlineCacheCount items awaiting network sync")
                        }
                        Icon(Icons.Default.CloudOff, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    }
                }
    
                Text("Current Warehouse Stock", style = MaterialTheme.typography.titleLarge)
                
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(inventoryParts) { (partName, stock) ->
                        ListItem(
                            headlineContent = { Text(partName.substringAfter("PART:")) },
                            supportingContent = { Text(if (stock > 0) "In Stock" else "Out of Stock") },
                            trailingContent = { 
                                Text(
                                    text = "$stock", 
                                    style = MaterialTheme.typography.headlineSmall,
                                    color = if (stock > 0) MaterialTheme.colorScheme.primary else Color.Red
                                ) 
                            },
                            leadingContent = { Icon(Icons.Default.Build, null) }
                        )
                    }
                }
            }
            
            PullToRefreshContainer(
                state = pullToRefreshState,
                modifier = Modifier.align(Alignment.TopCenter)
            )
        }
    }
}
