package com.example.tyre_pulse_app.feature.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.theme.StatusBlue
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaintenanceCalendarScreen() {
    val pullToRefreshState = rememberPullToRefreshState()
    val snackbarHostState = remember { SnackbarHostState() }

    if (pullToRefreshState.isRefreshing) {
        LaunchedEffect(true) {
            pullToRefreshState.endRefresh()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = { TopAppBar(title = { Text("Calendar", fontWeight = FontWeight.Bold) }) }
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
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp)
            ) {
                Text("Maintenance Schedule", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(16.dp))
                
                // Horizontal Date Picker Simulation
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    listOf("20", "21", "22", "23", "24").forEach { day ->
                        val isSelected = day == "20"
                        Box(
                            modifier = Modifier
                                .size(50.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (isSelected) YellowPrimary else MaterialTheme.colorScheme.surfaceVariant),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(day, fontWeight = FontWeight.Bold, color = if (isSelected) Color.Black else MaterialTheme.colorScheme.onSurface)
                                Text("May", style = MaterialTheme.typography.labelSmall, color = if (isSelected) Color.Black else MaterialTheme.colorScheme.outline)
                            }
                        }
                    }
                }
                
                Spacer(Modifier.height(24.dp))
                
                Text("Scheduled Events", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.outline)
                Spacer(Modifier.height(12.dp))
                
                repeat(2) {
                    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(modifier = Modifier.width(4.dp).height(40.dp).background(StatusBlue))
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text("Mixer 2841 - 100k Service", fontWeight = FontWeight.Bold)
                                Text("09:00 AM • Bay 02", style = MaterialTheme.typography.bodySmall)
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
