package com.example.tyre_pulse_app.feature.analytics.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel

import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.ui.input.nestedscroll.nestedScroll

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalyticsScreen(
    viewModel: AnalyticsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    
    val pullToRefreshState = rememberPullToRefreshState()
    val snackbarHostState = remember { SnackbarHostState() }

    if (pullToRefreshState.isRefreshing) {
        LaunchedEffect(true) {
            viewModel.loadData() // Assume loadData exists
            pullToRefreshState.endRefresh()
        }
    }
    
    // Show error in snackbar if applicable
    if (uiState is AnalyticsUiState.Error) {
        val errorMessage = (uiState as AnalyticsUiState.Error).message
        LaunchedEffect(errorMessage) {
            snackbarHostState.showSnackbar(errorMessage)
        }
    }
    
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Fleet Analytics", fontWeight = FontWeight.Bold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .nestedScroll(pullToRefreshState.nestedScrollConnection)
        ) {
            when (val state = uiState) {
                is AnalyticsUiState.Loading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                is AnalyticsUiState.Error -> {
                    // Fallback visual error if desired, or just an empty list since snackbar handles it.
                    Text("Error: ${state.message}", color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.Center))
                }
                is AnalyticsUiState.Success -> {
                    val data = state.data
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        item {
                            Text("Overview", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                KpiCard(
                                    modifier = Modifier.weight(1f),
                                    title = "Total Tyres",
                                    value = data.tyresTotal.toString(),
                                    gradient = Brush.linearGradient(listOf(Color(0xFF3b82f6), Color(0xFF1d4ed8)))
                                )
                                KpiCard(
                                    modifier = Modifier.weight(1f),
                                    title = "Vehicles",
                                    value = data.vehiclesTotal.toString(),
                                    gradient = Brush.linearGradient(listOf(Color(0xFF8b5cf6), Color(0xFF6d28d9)))
                                )
                            }
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                KpiCard(
                                    modifier = Modifier.weight(1f),
                                    title = "Critical",
                                    value = data.tyresCritical.toString(),
                                    gradient = Brush.linearGradient(listOf(Color(0xFFef4444), Color(0xFFb91c1c)))
                                )
                                KpiCard(
                                    modifier = Modifier.weight(1f),
                                    title = "Inspections (30d)",
                                    value = data.inspections30d.toString(),
                                    gradient = Brush.linearGradient(listOf(Color(0xFF10b981), Color(0xFF047857)))
                                )
                            }
                        }
                        
                        item {
                            Spacer(Modifier.height(8.dp))
                            Text("Risk Breakdown", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        }
                        
                        items(data.byRisk) { riskSlice ->
                            val color = when (riskSlice.risk.lowercase()) {
                                "good" -> Color(0xFF22c55e)
                                "warning" -> Color(0xFFf59e0b)
                                "critical" -> Color(0xFFef4444)
                                else -> Color.Gray
                            }
                            val pct = if (data.tyresTotal > 0) riskSlice.count.toFloat() / data.tyresTotal else 0f
                            
                            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(riskSlice.risk, fontWeight = FontWeight.Medium)
                                    Text("${riskSlice.count} (${(pct * 100).toInt()}%)", fontWeight = FontWeight.Bold)
                                }
                                Spacer(Modifier.height(4.dp))
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(12.dp)
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(Color(0xFFe2e8f0))
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth(fraction = pct.coerceIn(0f, 1f))
                                            .height(12.dp)
                                            .background(color)
                                    )
                                }
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
fun KpiCard(
    modifier: Modifier = Modifier,
    title: String,
    value: String,
    gradient: Brush
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
    ) {
        Box(modifier = Modifier.background(gradient).padding(20.dp).fillMaxWidth()) {
            Column {
                Text(title, color = Color.White.copy(alpha = 0.8f), fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(8.dp))
                Text(value, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}
