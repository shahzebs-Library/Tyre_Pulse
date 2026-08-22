package com.example.tyre_pulse_app.feature.notifications.ui
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.R
import com.example.tyre_pulse_app.core.designsystem.theme.StatusOrange
import com.example.tyre_pulse_app.core.designsystem.theme.StatusRed
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import com.example.tyre_pulse_app.core.model.Notification

import androidx.compose.material3.pulltorefresh.PullToRefreshBox

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationCenterRoute(
    onNotificationClick: (Notification) -> Unit,
    viewModel: NotificationViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedFilter by remember { mutableStateOf("All") }
    
    var isRefreshing by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    if (isRefreshing) {
        LaunchedEffect(true) {
            isRefreshing = false // Implement refresh logic
        }
    }
    
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.alerts), fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = { /* TODO */ }) {
                        Icon(Icons.Default.FilterList, contentDescription = "Filter")
                    }
                }
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true },
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                
        
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                FilterTabs(
                    selected = selectedFilter,
                    onSelected = { selectedFilter = it }
                )
                
                if (uiState.isLoading && uiState.notifications.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = YellowPrimary)
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(uiState.notifications) { alert ->
                            AlertItem(
                                alert = alert,
                                onClick = { onNotificationClick(alert) }
                            )
                        }
                    }
                }
            }
            
            
        }
    }
}

@Composable
fun FilterTabs(selected: String, onSelected: (String) -> Unit) {
    val filters = listOf("All", "Critical", "Warnings", "Info")
    ScrollableTabRow(
        selectedTabIndex = filters.indexOf(selected),
        containerColor = Color.Transparent,
        divider = {},
        edgePadding = 16.dp,
        indicator = {}
    ) {
        filters.forEach { filter ->
            val isSelected = selected == filter
            Tab(
                selected = isSelected,
                onClick = { onSelected(filter) },
                modifier = Modifier
                    .padding(vertical = 8.dp, horizontal = 4.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(if (isSelected) YellowPrimary else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                text = {
                    Text(
                        text = filter,
                        color = if (isSelected) Color.Black else MaterialTheme.colorScheme.onSurface,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                    )
                }
            )
        }
    }
}

@Composable
fun AlertItem(alert: Notification, onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.Top
        ) {
            val (iconColor, bgColor) = when {
                alert.title.contains("Critical", true) || alert.message.contains("low", true) -> StatusRed to StatusRed.copy(alpha = 0.1f)
                alert.message.contains("High", true) || alert.message.contains("Overdue", true) -> StatusOrange to StatusOrange.copy(alpha = 0.1f)
                else -> Color.Gray to Color.Gray.copy(alpha = 0.1f)
            }
            
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(bgColor),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.PriorityHigh, contentDescription = null, tint = iconColor, modifier = Modifier.size(20.dp))
            }
            
            Spacer(Modifier.width(12.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = alert.title,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = alert.createdAt,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    text = alert.message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
