package com.example.tyre_pulse_app.feature.tasks.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.authentication.UserViewModel
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.designsystem.component.TPStatusChip
import com.example.tyre_pulse_app.core.designsystem.component.TPTopBar
import com.example.tyre_pulse_app.core.model.Task
import com.example.tyre_pulse_app.core.model.TaskPriority
import com.example.tyre_pulse_app.core.model.TaskStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyWorkRoute(
    onTaskClick: (String) -> Unit,
    viewModel: MyWorkViewModel = hiltViewModel(),
    userViewModel: UserViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentWorkspace by userViewModel.currentWorkspace.collectAsState()
    val listState = rememberLazyListState()

    Scaffold(
        topBar = {
            Column {
                TPTopBar(
                    title = "My Work",
                    currentWorkspace = currentWorkspace,
                    onWorkspaceClick = { /* TODO */ }
                )
                TaskStatusTabs(
                    selectedStatus = uiState.selectedStatus,
                    onStatusSelected = viewModel::onStatusSelected
                )
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (uiState.isLoading && uiState.tasks.isEmpty()) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(uiState.tasks, key = { it.id }) { task ->
                        TaskItem(task = task, onClick = { onTaskClick(task.id) })
                    }
                    if (uiState.tasks.isEmpty() && !uiState.isLoading) {
                        item {
                            Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                                Text("No tasks assigned")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun TaskStatusTabs(
    selectedStatus: TaskStatus?,
    onStatusSelected: (TaskStatus?) -> Unit
) {
    ScrollableTabRow(
        selectedTabIndex = if (selectedStatus == null) 0 else TaskStatus.entries.indexOf(selectedStatus) + 1,
        edgePadding = 16.dp,
        divider = {}
    ) {
        Tab(
            selected = selectedStatus == null,
            onClick = { onStatusSelected(null) },
            text = { Text("All") }
        )
        TaskStatus.entries.forEach { status ->
            Tab(
                selected = selectedStatus == status,
                onClick = { onStatusSelected(status) },
                text = { Text(status.name) }
            )
        }
    }
}

@Composable
private fun TaskItem(task: Task, onClick: () -> Unit) {
    TPCard(onClick = onClick) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = task.title, style = MaterialTheme.typography.titleMedium)
                    Text(text = task.type, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                }
                PriorityChip(priority = task.priority)
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Schedule, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.outline)
                Spacer(modifier = Modifier.width(4.dp))
                Text(text = "Due: ${task.dueDate ?: "No date"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
            
            if (task.description != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(text = task.description, style = MaterialTheme.typography.bodyMedium, maxLines = 2)
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            TPStatusChip(label = task.status.name, statusColor = MaterialTheme.colorScheme.secondary)
        }
    }
}

@Composable
fun PriorityChip(priority: TaskPriority) {
    val color = when (priority) {
        TaskPriority.LOW -> Color(0xFF4CAF50)
        TaskPriority.MEDIUM -> Color(0xFF2196F3)
        TaskPriority.HIGH -> Color(0xFFFF9800)
        TaskPriority.URGENT -> Color(0xFFF44336)
    }
    Surface(
        color = color.copy(alpha = 0.1f),
        shape = MaterialTheme.shapes.extraSmall,
        border = androidx.compose.foundation.BorderStroke(1.dp, color.copy(alpha = 0.5f))
    ) {
        Text(
            text = priority.name,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = color
        )
    }
}
