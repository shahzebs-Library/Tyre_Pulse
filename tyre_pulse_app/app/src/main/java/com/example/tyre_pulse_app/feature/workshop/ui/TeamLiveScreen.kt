package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
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
import com.example.tyre_pulse_app.core.designsystem.theme.OLED_Black
import com.example.tyre_pulse_app.core.designsystem.theme.OLED_Card
import com.example.tyre_pulse_app.core.designsystem.theme.StatusGreen
import com.example.tyre_pulse_app.core.designsystem.theme.StatusOrange
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

/**
 * Team Productivity Live.
 *
 * Every row here comes from `profiles` and `tech_activity_events`. Nothing on this
 * screen is composed locally - see [TeamLiveViewModel] for what the hard-coded
 * version used to assert and why each rule below exists.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamLiveScreen(
    onBack: () -> Unit = {},
    viewModel: TeamLiveViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Team Productivity Live",
                        fontWeight = FontWeight.ExtraBold,
                        color = YellowPrimary,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = OLED_Black),
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = uiState.isLoading,
            onRefresh = { viewModel.load() },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(OLED_Black),
        ) {
            Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
                Spacer(Modifier.height(16.dp))

                // Role chips are derived from the roles the loaded people actually
                // hold. A fixed Technicians / Managers / Drivers tab strip promised
                // three populations whether or not anybody held those roles.
                if (uiState.roles.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilterChip(
                            selected = uiState.selectedRole == null,
                            onClick = { viewModel.selectRole(null) },
                            label = { Text("All (${uiState.members.size})") },
                        )
                        uiState.roles.forEach { role ->
                            val count = uiState.members.count { it.role == role }
                            FilterChip(
                                selected = uiState.selectedRole == role,
                                onClick = { viewModel.selectRole(role) },
                                label = { Text("$role ($count)") },
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                }

                // "We could not load it" and "there is nobody" are opposite
                // statements and must never render the same way.
                uiState.error?.let { message ->
                    TeamLiveNotice(
                        icon = Icons.Default.ErrorOutline,
                        tone = StatusOrange,
                        title = "Could not load the team",
                        body = message,
                    )
                    Spacer(Modifier.height(16.dp))
                }

                // tech_activity_events is scoped to the caller unless they are
                // elevated, so an all-quiet board usually means limited visibility,
                // not a workshop standing still. Say which.
                if (uiState.noActivityVisible) {
                    TeamLiveNotice(
                        icon = Icons.Default.Info,
                        tone = YellowPrimary,
                        title = "You can only see your own activity",
                        body = "Activity records are restricted to your own account " +
                            "unless you have elevated access, so colleagues show no " +
                            "recorded activity here. It does not mean they are idle.",
                    )
                    Spacer(Modifier.height(16.dp))
                }

                when {
                    uiState.isLoading && uiState.members.isEmpty() -> {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = YellowPrimary)
                        }
                    }

                    uiState.members.isEmpty() && uiState.error == null -> {
                        TeamLiveNotice(
                            icon = Icons.Default.Group,
                            tone = Color.White.copy(alpha = 0.6f),
                            title = "No team members visible",
                            body = "No people are visible to your account.",
                        )
                    }

                    else -> {
                        LazyVerticalGrid(
                            columns = GridCells.Fixed(2),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            items(uiState.visibleMembers) { member ->
                                TechnicianStatusCard(member)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * One person, showing only what was actually recorded about them.
 *
 * The dot is toned by whether anything is KNOWN, not by an invented status: green
 * where an event exists, muted where none does.
 */
@Composable
fun TechnicianStatusCard(member: TeamLiveMember) {
    val tone = if (member.hasActivity) StatusGreen else Color.White.copy(alpha = 0.35f)
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = OLED_Card),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(tone),
                )
                Spacer(Modifier.width(8.dp))
                Text(member.name, fontWeight = FontWeight.Bold)
            }

            member.role?.let {
                Spacer(Modifier.height(4.dp))
                Text(
                    it,
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.5f),
                )
            }

            Spacer(Modifier.height(12.dp))

            // "No activity recorded" is not "Idle". The first says we do not know;
            // the second asserts the person is doing nothing.
            Text(
                formatEventType(member.lastEvent) ?: "No activity recorded",
                style = MaterialTheme.typography.bodySmall,
                color = if (member.hasActivity) Color.White.copy(alpha = 0.8f)
                else Color.White.copy(alpha = 0.5f),
            )

            // Shown only when the event itself named an asset. No asset is left
            // blank rather than filled with a plausible vehicle.
            member.lastEventAsset?.let {
                Spacer(Modifier.height(2.dp))
                Text(
                    it,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = YellowPrimary,
                )
            }

            formatRecordedAt(member.lastEventAt)?.let {
                Spacer(Modifier.height(6.dp))
                Text(
                    "Recorded $it",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.45f),
                )
            }

            member.site?.let {
                Spacer(Modifier.height(6.dp))
                Text(
                    it,
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.5f),
                )
            }
        }
    }
}

/** A single explanatory banner: a stated fact, never a silent blank. */
@Composable
private fun TeamLiveNotice(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tone: Color,
    title: String,
    body: String,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = OLED_Card),
        shape = RoundedCornerShape(16.dp),
    ) {
        Row(modifier = Modifier.padding(16.dp)) {
            Icon(icon, contentDescription = null, tint = tone)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(title, fontWeight = FontWeight.Bold, color = tone)
                Spacer(Modifier.height(4.dp))
                Text(
                    body,
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.7f),
                )
            }
        }
    }
}
