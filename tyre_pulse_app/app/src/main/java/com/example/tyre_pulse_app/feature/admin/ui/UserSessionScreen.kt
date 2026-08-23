package com.example.tyre_pulse_app.feature.admin.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * User sessions (admin).
 *
 * The roster is real; live session state is not available to this app and the screen
 * says so rather than colouring everyone Active. See [UserSessionViewModel] for what
 * the hard-coded version asserted and why the Kick button is gone.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserSessionScreen(
    onBack: () -> Unit = {},
    viewModel: UserSessionViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Users", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        PullToRefreshBox(
            isRefreshing = uiState.isLoading,
            onRefresh = { viewModel.load() },
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(16.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                // "We could not load it" and "there is nobody" are opposite
                // statements and must never render the same way.
                uiState.error?.let { message ->
                    item {
                        AdminNotice(
                            icon = Icons.Default.ErrorOutline,
                            tone = MaterialTheme.colorScheme.error,
                            title = "Could not load users",
                            body = message,
                        )
                    }
                }

                if (uiState.users.isNotEmpty()) {
                    item {
                        AdminNotice(
                            icon = Icons.Default.Info,
                            tone = MaterialTheme.colorScheme.outline,
                            title = "Sign-in state is not tracked",
                            body = "This app cannot see who is currently signed in, " +
                                "so no one is shown as active or offline. Ending a " +
                                "session is not available from here either.",
                        )
                    }
                }

                items(uiState.users) { user ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Person, contentDescription = null)
                            Spacer(Modifier.width(16.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(user.name, fontWeight = FontWeight.Bold)
                                Text(
                                    // Role is a recorded fact; session state is not,
                                    // so the second line carries the role instead of
                                    // an invented Active / Offline.
                                    user.role ?: "Role not recorded",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.outline,
                                )
                            }
                            user.site?.let {
                                Text(
                                    it,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.outline,
                                )
                            }
                        }
                    }
                }

                if (uiState.users.isEmpty() && uiState.error == null && !uiState.isLoading) {
                    item {
                        AdminNotice(
                            icon = Icons.Default.Person,
                            tone = MaterialTheme.colorScheme.outline,
                            title = "No users visible",
                            body = "No user accounts are visible to your account.",
                        )
                    }
                }
            }
        }
    }
}

/** A single explanatory banner: a stated fact, never a silent blank. */
@Composable
internal fun AdminNotice(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tone: Color,
    title: String,
    body: String,
) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            Icon(icon, contentDescription = null, tint = tone)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(title, fontWeight = FontWeight.Bold, color = tone)
                Spacer(Modifier.height(4.dp))
                Text(
                    body,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}
