package com.example.tyre_pulse_app.feature.accidents.ui

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
import com.example.tyre_pulse_app.core.model.Accident

import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.ui.input.nestedscroll.nestedScroll
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccidentsScreen(
    onNavigateBack: () -> Unit,
    onNavigateToReport: () -> Unit,
    onCaseClick: (String) -> Unit,
    viewModel: AccidentsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val pullToRefreshState = rememberPullToRefreshState()
    val scope = rememberCoroutineScope()

    // Handle Pull to refresh
    if (pullToRefreshState.isRefreshing) {
        LaunchedEffect(true) {
            viewModel.loadAccidents()
        }
    }
    
    // When state transitions from Loading to Success/Error, stop refreshing
    LaunchedEffect(uiState) {
        if (uiState !is AccidentsUiState.Loading) {
            pullToRefreshState.endRefresh()
        }
        if (uiState is AccidentsUiState.Error) {
            val msg = (uiState as AccidentsUiState.Error).message
            scope.launch {
                snackbarHostState.showSnackbar(msg)
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Accidents") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onNavigateToReport) {
                Icon(Icons.Default.Add, contentDescription = "Report Accident")
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .nestedScroll(pullToRefreshState.nestedScrollConnection)
        ) {
            when (val state = uiState) {
                is AccidentsUiState.Loading -> {
                    if (!pullToRefreshState.isRefreshing) {
                        CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                    }
                }
                is AccidentsUiState.Error -> {
                    Text(
                        text = "Failed to load data. Swipe to retry.",
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.align(Alignment.Center).padding(16.dp)
                    )
                }
                is AccidentsUiState.Success -> {
                    if (state.records.isEmpty()) {
                        Text(
                            text = "No accidents reported yet. Swipe to refresh.",
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
                                AccidentCard(record, onClick = { onCaseClick(record.id) })
                            }
                        }
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

@Composable
fun AccidentCard(accident: Accident, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "Asset: ${accident.assetNumber}", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(4.dp))
            Text(text = "Date: ${accident.date}", style = MaterialTheme.typography.bodyMedium)
            Text(text = "Type: ${accident.accidentType}", style = MaterialTheme.typography.bodyMedium)
            Text(text = "Status: ${accident.status.name}", style = MaterialTheme.typography.bodySmall)
        }
    }
}
