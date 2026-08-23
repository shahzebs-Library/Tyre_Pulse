package com.example.tyre_pulse_app.feature.approvals.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.authentication.UserViewModel
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.designsystem.component.TPStatusChip
import com.example.tyre_pulse_app.core.designsystem.component.TPTopBar
import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.model.ApprovalSource
import com.example.tyre_pulse_app.core.model.ApprovalStatus

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
                        onWorkspaceClick = { /* TODO: plumb to the switcher in MainActivity */ },
                        actions = {
                            IconButton(onClick = { /* TODO */ }) {
                                Icon(
                                    imageVector = Icons.Default.Logout,
                                    contentDescription = "Logout"
                                )
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
            onRefresh = viewModel::onRefresh,
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
        placeholder = { Text("Search by title, person, asset or site...") },
        leadingIcon = {
            Icon(
                Icons.Default.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
        },
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

/**
 * The category filter is the RECORD KIND, and that is a real fact about the row.
 *
 * It used to offer "Maintenance" and "Purchase" - a hard-coded taxonomy that no
 * column anywhere carries, so selecting either could only ever return nothing.
 * The chips are now derived from [ApprovalSource], which is what actually
 * distinguishes one queue entry from another.
 */
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
            label = { Text("All") },
            leadingIcon = if (selectedCategory == null) {
                {
                    Icon(
                        Icons.Default.Done,
                        contentDescription = null,
                        modifier = Modifier.size(FilterChipDefaults.IconSize)
                    )
                }
            } else null
        )
        ApprovalSource.entries.forEach { source ->
            FilterChip(
                selected = selectedCategory == source.label,
                onClick = { onCategorySelected(source.label) },
                label = { Text(source.label) },
                leadingIcon = if (selectedCategory == source.label) {
                    {
                        Icon(
                            Icons.Default.Done,
                            contentDescription = null,
                            modifier = Modifier.size(FilterChipDefaults.IconSize)
                        )
                    }
                } else null
            )
        }
    }
}

@Composable
internal fun ApprovalsScreen(
    uiState: ApprovalsUiState,
    listState: LazyListState,
    onApprovalClick: (String) -> Unit,
    onLoadMore: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier
) {
    // PULL TO REFRESH USED TO BE THEATRE: it set a local flag, waited one second
    // and cleared it, without asking the repository for anything. The spinner
    // finished and the reader believed the list was current. It now drives the
    // real reload and follows the real in-flight state.
    PullToRefreshBox(
        isRefreshing = uiState.isRefreshing,
        onRefresh = onRefresh,
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
    ) {
        when {
            uiState.isLoading && uiState.approvals.isEmpty() -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }

            // "We could not check" and "there is nothing to approve" are opposite
            // statements. This screen used to render a failed read as the empty
            // state, so a broken queue looked like a clear one.
            uiState.error != null && uiState.approvals.isEmpty() -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(32.dp)
                    ) {
                        Icon(
                            Icons.Default.ErrorOutline,
                            contentDescription = null,
                            modifier = Modifier.size(56.dp),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            "Could not load approvals",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            uiState.error,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(16.dp))
                        TextButton(onClick = onRefresh) { Text("Try again") }
                    }
                }
            }

            else -> {
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
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                contentAlignment = Alignment.Center
                            ) {
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

                    // A page that failed AFTER some rows had loaded. Without
                    // this the list would simply stop, and a partial queue would
                    // look like the whole one.
                    if (uiState.error != null && uiState.approvals.isNotEmpty()) {
                        item {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center
                            ) {
                                Icon(
                                    Icons.Default.ErrorOutline,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                    tint = MaterialTheme.colorScheme.error
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "More could not be loaded",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error
                                )
                                Spacer(Modifier.width(8.dp))
                                TextButton(onClick = onRefresh) { Text("Try again") }
                            }
                        }
                    }

                    if (uiState.approvals.isEmpty() && !uiState.isLoading) {
                        item {
                            Box(
                                Modifier.fillParentMaxSize(),
                                contentAlignment = Alignment.Center
                            ) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Icon(
                                        Icons.Default.Inbox,
                                        contentDescription = null,
                                        modifier = Modifier.size(64.dp),
                                        tint = MaterialTheme.colorScheme.outline
                                    )
                                    Spacer(Modifier.height(16.dp))
                                    Text(
                                        "Nothing is waiting for a decision",
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = MaterialTheme.colorScheme.outline
                                    )
                                }
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
                        // A blank title is a gap in the record, not a name to
                        // invent.
                        text = approval.title.ifBlank { "Untitled record" },
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
                            text = approval.requester.ifBlank { "Not recorded" },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    // Which rung is holding a checklist, when it is waiting.
                    approval.stage?.let { stage ->
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = stage,
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFFEF6C00)
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
                        // The stored value carries no time zone conversion here,
                        // so it is shown as the day it records rather than being
                        // reformatted into something that could shift.
                        text = approval.date.take(10).ifBlank { "No date" },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
                Text(
                    text = approval.category,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier
                        .background(
                            MaterialTheme.colorScheme.secondaryContainer,
                            MaterialTheme.shapes.extraSmall
                        )
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                    color = MaterialTheme.colorScheme.onSecondaryContainer
                )
            }
        }
    }
}
