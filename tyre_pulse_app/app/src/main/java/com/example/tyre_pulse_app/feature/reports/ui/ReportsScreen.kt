package com.example.tyre_pulse_app.feature.reports.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsRoute(
    viewModel: ReportsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Reports & Analytics", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = { /* TODO */ }) {
                        Icon(Icons.Default.FilterList, contentDescription = "Filter")
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
                Text("01 May 2025 - 30 May 2025", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }

            item {
                KPIOverview(uiState)
            }

            item {
                TyreConditionChart(uiState)
            }
        }
    }
}

@Composable
fun KPIOverview(uiState: ReportsUiState) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
    ) {
        Row(modifier = Modifier.padding(16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            KPIItem("Total Tyres", "${uiState.totalTyres}")
            KPIItem("Inspected", "${uiState.inspected}")
            KPIItem("Replaced", "${uiState.replaced}")
            KPIItem("Puncture", "${uiState.puncture}")
            KPIItem("Cost (AED)", uiState.cost)
        }
    }
}

@Composable
fun KPIItem(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline, fontSize = 9.sp)
    }
}

@Composable
fun TyreConditionChart(uiState: ReportsUiState) {
    Column {
        Text("Tyre Condition", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        
        Row(modifier = Modifier.fillMaxWidth().height(24.dp).clip(CircleShape)) {
            uiState.tyreConditions.forEach { stat ->
                Box(
                    modifier = Modifier
                        .weight(stat.percentage.toFloat())
                        .fillMaxHeight()
                        .background(Color(stat.color))
                )
            }
        }
        
        Spacer(Modifier.height(16.dp))
        
        uiState.tyreConditions.forEach { stat ->
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(12.dp).clip(CircleShape).background(Color(stat.color)))
                Spacer(Modifier.width(8.dp))
                Text(stat.label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                Text("${stat.percentage}%", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
            }
        }
    }
}
