package com.example.tyre_pulse_app.feature.tyres.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.StatusGreen
import com.example.tyre_pulse_app.core.designsystem.theme.StatusRed
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import com.example.tyre_pulse_app.core.model.TyreHistoryEvent
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect

/**
 * One tyre's recorded lifecycle.
 *
 * The four invented timeline rows this screen used to show, and why two of them
 * could never have been made real, are documented on [TyreHistoryViewModel].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TyreHistoryScreen(
    tyreId: String,
    viewModel: TyreHistoryViewModel = hiltViewModel()
) {
    val snackbarHostState = remember { SnackbarHostState() }
    var isRefreshing by remember { mutableStateOf(false) }
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(tyreId) { viewModel.load(tyreId) }

    if (isRefreshing) {
        LaunchedEffect(true) {
            viewModel.load(tyreId)
            delay(600)
            isRefreshing = false
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(title = { Text("Tyre Lifecycle History", fontWeight = FontWeight.Bold) })
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                
        
        ) {
            Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                Spacer(Modifier.height(8.dp))
                val serial = uiState.events.firstOrNull { it.tyreId.isNotBlank() }?.tyreId
                Text(
                    serial?.let { "Serial: $it" } ?: "Serial not recorded",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )

                Spacer(Modifier.height(24.dp))

                when {
                    uiState.isLoading -> HistoryLoading()
                    uiState.error != null -> HistoryError(uiState.error!!)
                    uiState.events.isEmpty() -> HistoryEmpty()
                    else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                        items(uiState.events, key = { it.id }) { event ->
                            TimelineItem(event)
                        }
                    }
                }
            }

        }
    }
}

/**
 * One recorded event.
 *
 * Every line is drawn from the row. Where the table records nothing - an asset, a
 * meter reading, a reason - the line is omitted rather than filled with a plausible
 * substitute, so a sparse entry reads as a sparse record.
 */
@Composable
fun TimelineItem(event: TyreHistoryEvent) {
    val tone = when (event.type.uppercase()) {
        "FITTED" -> StatusGreen
        "SCRAPPED" -> StatusRed
        else -> YellowPrimary
    }
    val title = when (event.type.uppercase()) {
        "FITTED" -> "Fitted"
        "REMOVED" -> "Removed"
        "SCRAPPED" -> "Scrapped"
        else -> event.type
    }
    val detail = listOfNotNull(
        event.assetNumber?.takeIf { it.isNotBlank() },
        event.position?.takeIf { it.isNotBlank() },
        event.kmReading?.let { "$it km" },
        event.reason?.takeIf { it.isNotBlank() },
    ).joinToString(" - ")

    Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(modifier = Modifier.size(12.dp).clip(CircleShape).background(tone))
            Box(modifier = Modifier.width(2.dp).weight(1f).background(Color.Gray.copy(alpha = 0.3f)))
        }
        Spacer(Modifier.width(16.dp))
        Column(modifier = Modifier.padding(bottom = 24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.width(8.dp))
                // A row can carry no date at all; saying so beats printing a guess.
                Text(
                    event.date.ifBlank { "date not recorded" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
            if (detail.isNotBlank()) {
                Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            event.notes?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}

@Composable
private fun HistoryLoading() {
    Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = YellowPrimary, strokeWidth = 3.dp)
    }
}

/** A failed read - never rendered as an empty history. */
@Composable
private fun HistoryError(message: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
            Spacer(Modifier.width(12.dp))
            Column {
                Text("Could not load this history", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onErrorContainer)
                Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
    }
}

/** Genuinely nothing recorded against this tyre. */
@Composable
private fun HistoryEmpty() {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Info, contentDescription = null, tint = MaterialTheme.colorScheme.outline)
            Spacer(Modifier.width(12.dp))
            Text(
                "No fitment or removal has been recorded for this tyre.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
