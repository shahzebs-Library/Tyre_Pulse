package com.example.tyre_pulse_app.feature.washing.ui
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.model.WashRecord

import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WashingScreen(
    onNavigateBack: () -> Unit,
    onNavigateToLogWash: () -> Unit,
    viewModel: WashingViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var isRefreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // Handle Pull to refresh
    if (isRefreshing) {
        LaunchedEffect(true) {
            viewModel.loadWashes()
        }
    }
    
    // When state transitions from Loading to Success/Error, stop refreshing
    LaunchedEffect(uiState) {
        if (uiState !is WashingUiState.Loading) {
            isRefreshing = false
        }
        if (uiState is WashingUiState.Error) {
            val msg = (uiState as WashingUiState.Error).message
            scope.launch {
                snackbarHostState.showSnackbar(msg)
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Vehicle Washing") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onNavigateToLogWash) {
                Icon(Icons.Default.Add, contentDescription = "Log Wash")
            }
        }
    ) { paddingValues ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true },
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                
        
        ) {
            when (val state = uiState) {
                is WashingUiState.Loading -> {
                    if (!isRefreshing) {
                        CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                    }
                }
                is WashingUiState.Error -> {
                    // Show a localized error text if we have NO data to show, otherwise snackbar handles it.
                    Text(
                        text = "Failed to load data. Swipe to retry.",
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.align(Alignment.Center).padding(16.dp)
                    )
                }
                is WashingUiState.Success -> {
                    if (state.records.isEmpty()) {
                        Text(
                            text = "No washes logged yet. Swipe to refresh.",
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.align(Alignment.Center)
                        )
                    } else {
                        LazyColumn(
                            contentPadding = PaddingValues(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxSize()
                        ) {
                            items(state.records) { record ->
                                WashRecordCard(record)
                            }
                        }
                    }
                }
            }
            
            
        }
    }
}

@Composable
fun WashRecordCard(record: WashRecord) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "Asset: ${record.assetNumber}", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(4.dp))
            Text(text = "Date: ${record.washDate}", style = MaterialTheme.typography.bodyMedium)
            Text(text = "Type: ${record.washType}", style = MaterialTheme.typography.bodyMedium)
            Text(text = "Status: ${record.status}", style = MaterialTheme.typography.bodySmall)
        }
    }
}
