package com.example.tyre_pulse_app.feature.approvals.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.authentication.UserViewModel
import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.model.ApprovalStatus
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.designsystem.component.TPStatusChip
import com.example.tyre_pulse_app.core.designsystem.component.TPTopBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
@Composable
fun ApprovalsRoute(
    onApprovalClick: (String) -> Unit,
    viewModel: ApprovalsViewModel = hiltViewModel(),
    userViewModel: UserViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentWorkspace by userViewModel.currentWorkspace.collectAsState()
    val listState = rememberLazyListState()
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            Surface(shadowElevation = 4.dp) {
                Column(modifier = Modifier.background(MaterialTheme.colorScheme.surface)) {
                    TPTopBar(
                        title = "Approvals",
                        currentWorkspace = currentWorkspace,
                        onWorkspaceClick = { /* TODO */ },
                        actions = {
                            IconButton(onClick = { /* TODO */ }) {
                                Icon(imageVector = Icons.Default.Logout, contentDescription = "Logout")
                            }
                        }
                    )
                    ApprovalTabs(
                        selectedStatus = uiState.selectedStatus,
                        onStatusSelected = viewModel::onStatusSelected
                    )
                    SearchBar(
                        query = uiState.searchQuery,
                        onQueryChanged = viewModel::onSearchQueryChanged
                    )
                    FilterSection(
                        selectedCategory = uiState.selectedCategory,
                        onCategorySelected = viewModel::onCategorySelected
                    )
                }
            }
        }
    ) { padding ->
        ApprovalsScreen(
            uiState = uiState,
            listState = listState,
            onApprovalClick = onApprovalClick,
            onLoadMore = viewModel::loadNextPage,
            modifier = Modifier.padding(padding)
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalTabs(
    selectedStatus: ApprovalStatus,
    onStatusSelected: (ApprovalStatus) -> Unit
) {
    SecondaryTabRow(
        selectedTabIndex = selectedStatus.ordinal,
        containerColor = Color.Transparent,
        divider = {}
    ) {
        ApprovalStatus.entries.forEach { status ->
            Tab(
                selected = selectedStatus == status,
                onClick = { onStatusSelected(status) },
                text = {
                    Text(
                        text = status.name,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (selectedStatus == status) FontWeight.Bold else FontWeight.Normal
                    )
                }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchBar(
    query: String,
    onQueryChanged: (String) -> Unit
) {
    TextField(
        value = query,
        onValueChange = onQueryChanged,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        placeholder = { Text("Search by title or requester...") },
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
        shape = MaterialTheme.shapes.medium,
        singleLine = true,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
        )
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FilterSection(
    selectedCategory: String?,
    onCategorySelected: (String?) -> Unit
) {
    FlowRow(
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        FilterChip(
            selected = selectedCategory == null,
            onClick = { onCategorySelected(null) },
            label = { Text("All Categories") },
            leadingIcon = if (selectedCategory == null) {
                { Icon(Icons.Default.Done, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize)) }
            } else null
        )
        listOf("Maintenance", "Purchase").forEach { category ->
            FilterChip(
                selected = selectedCategory == category,
                onClick = { onCategorySelected(category) },
                label = { Text(category) },
                leadingIcon = if (selectedCategory == category) {
                    { Icon(Icons.Default.Done, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize)) }
                } else null
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ApprovalsScreen(
    uiState: ApprovalsUiState,
    listState: LazyListState,
    onApprovalClick: (String) -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier
) {
    var isRefreshing by remember { mutableStateOf(false) }
    
    if (isRefreshing) {
        LaunchedEffect(true) {
            delay(1000)
            isRefreshing = false
        }
    }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = { isRefreshing = true },
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
    ) {
        if (uiState.isLoading && uiState.approvals.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(uiState.approvals, key = { it.id }) { approval ->
                    ApprovalItem(
                        approval = approval,
                        onClick = { onApprovalClick(approval.id) }
                    )
                }
                
                if (uiState.isLoading) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(modifier = Modifier.size(32.dp))
                        }
                    }
                } else if (!uiState.isEndReached && uiState.approvals.isNotEmpty()) {
                    item {
                        LaunchedEffect(Unit) {
                            onLoadMore()
                        }
                    }
                }
                
                if (uiState.approvals.isEmpty() && !uiState.isLoading) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Default.Inbox, contentDescription = null, modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.outline)
                                Spacer(Modifier.height(16.dp))
                                Text("No approvals found", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.outline)
                            }
                        }
                    }
                }
            }
        }
        
    }
}

@Composable
private fun ApprovalItem(
    approval: Approval,
    onClick: () -> Unit
) {
    TPCard(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = approval.title,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(24.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primaryContainer),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = approval.requester.take(1),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = approval.requester,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                val (color, label) = when (approval.status) {
                    ApprovalStatus.PENDING -> Color(0xFFEF6C00) to "PENDING"
                    ApprovalStatus.APPROVED -> Color(0xFF2E7D32) to "APPROVED"
                    ApprovalStatus.REJECTED -> MaterialTheme.colorScheme.error to "REJECTED"
                }
                TPStatusChip(label = label, statusColor = color)
            }
            
            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
            Spacer(Modifier.height(12.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.CalendarToday,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.outline
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        text = approval.date,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
                Text(
                    text = approval.category,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier
                        .background(MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.shapes.extraSmall)
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                    color = MaterialTheme.colorScheme.onSecondaryContainer
                )
            }
        }
    }
}
