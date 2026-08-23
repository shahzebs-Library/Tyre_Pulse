package com.example.tyre_pulse_app.feature.admin.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Site management.
 *
 * Sites are derived from the fleet register - see [SiteManagementViewModel] for the
 * four invented sites this replaced and for the two limits the screen states below.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SiteManagementScreen(
    viewModel: SiteManagementViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = { TopAppBar(title = { Text("Site Management", fontWeight = FontWeight.Bold) }) }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = uiState.isLoading,
            onRefresh = { viewModel.load() },
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
        ) {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(16.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                // "We could not load it" and "there are no sites" are opposite
                // statements and must never render the same way.
                uiState.error?.let { message ->
                    item {
                        AdminNotice(
                            icon = Icons.Default.ErrorOutline,
                            tone = MaterialTheme.colorScheme.error,
                            title = "Could not load sites",
                            body = message,
                        )
                    }
                }

                if (uiState.sites.isNotEmpty()) {
                    item {
                        AdminNotice(
                            icon = Icons.Default.Info,
                            tone = MaterialTheme.colorScheme.outline,
                            title = "Derived from the fleet register",
                            body = "These are the sites that assets are registered " +
                                "to, from ${uiState.assetsRead} assets. A site with " +
                                "no assets assigned to it does not appear here.",
                        )
                    }
                }

                // A short list of sites and a small fleet look identical, so a
                // bounded read has to say it was bounded.
                if (uiState.truncated) {
                    item {
                        AdminNotice(
                            icon = Icons.Default.Warning,
                            tone = MaterialTheme.colorScheme.error,
                            title = "This list may be incomplete",
                            body = "Not every asset could be read, so a site may be " +
                                "missing from the list below.",
                        )
                    }
                }

                items(uiState.sites) { site ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.LocationOn, contentDescription = null)
                            Spacer(Modifier.width(16.dp))
                            Text(
                                site.name,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                if (site.assetCount == 1) "1 asset"
                                else "${site.assetCount} assets",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.outline,
                            )
                        }
                    }
                }

                // Counted separately, never folded into a named site - that would
                // move real machines onto a site nobody assigned them to.
                if (uiState.assetsWithoutSite > 0) {
                    item {
                        AdminNotice(
                            icon = Icons.Default.Warning,
                            tone = MaterialTheme.colorScheme.outline,
                            title = "${uiState.assetsWithoutSite} assets have no site recorded",
                            body = "They are not counted against any site above.",
                        )
                    }
                }

                if (uiState.sites.isEmpty() && uiState.error == null && !uiState.isLoading) {
                    item {
                        AdminNotice(
                            icon = Icons.Default.LocationOn,
                            tone = MaterialTheme.colorScheme.outline,
                            title = "No sites recorded",
                            body = "No asset visible to your account has a site " +
                                "recorded against it.",
                        )
                    }
                }
            }
        }
    }
}
