package com.example.tyre_pulse_app.feature.team.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.component.*
import com.example.tyre_pulse_app.core.designsystem.theme.*

/**
 * Driver scorecard.
 *
 * WHAT THIS REPLACED. The screen was a gamified leaderboard built entirely from
 * five invented people - "Ahmed Al-Rashidi" 2840 pts on a 14 day streak, "Kevin
 * Lumumba", "Musa Bello", "John Tumelo", "Rashid Khalil" - each with an invented
 * points total, streak, inspection count, on-time rate and medal. Beneath them sat
 * five invented achievement badges ("Top Inspector - 30 Days", "Perfect Week").
 * Every one of those was a personnel judgement about a named human being that no
 * measurement supported. Several of the tiles were not even wired to the fake data
 * and rendered blank strings, so the hero card read " pts" and "% on-time".
 *
 * THE PREMISE HAD NO BACKING DATA AT ALL, and that is the finding. There is no
 * driver-scoring source anywhere in this app: no API carries points, streaks,
 * on-time rate, safety score or ranking, and no table records them. So there is
 * nothing to wire a leaderboard to, and inventing one is exactly the defect.
 *
 * What DOES exist is real: the people in `profiles` and their latest recorded
 * activity in `tech_activity_events`, already read honestly by TeamViewModel. This
 * screen therefore lists the real crew with what is genuinely on record and states
 * plainly that scoring and ranking are not measured. It is deliberately NOT ordered
 * - any ordering here would read as a ranking, which is the claim being withdrawn.
 *
 * TWO HONESTY RULES INHERITED FROM TeamViewModel:
 *
 * 1. A person with no recorded event reads "No activity recorded", never "Idle" and
 *    never a score of zero. Nothing recorded is not the same as nothing done.
 *
 * 2. tech_activity_events carries an own-visibility policy, so a non-elevated user
 *    sees only their OWN activity. When the activity read comes back empty the
 *    screen says so, rather than letting it read as a crew that did nothing.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriverScorecardScreen(
    viewModel: TeamViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "Driver scorecard",
                            fontWeight = FontWeight.ExtraBold,
                            style = MaterialTheme.typography.titleLarge
                        )
                        Text(
                            "Recorded activity only",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                        )
                    }
                }
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = uiState.isLoading,
            onRefresh = { viewModel.load() },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // The headline of this screen is the withdrawal of the scores. It
                // comes first so nobody reads the list below as a ranking.
                item { ScoringNotMeasuredCard() }

                uiState.error?.let { message ->
                    item {
                        // A failed read is a different statement from an empty crew,
                        // and it offers the read again.
                        GlassCard {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.Error,
                                    contentDescription = null,
                                    tint = StatusRed,
                                    modifier = Modifier.size(20.dp)
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "Could not load the team",
                                    fontWeight = FontWeight.Bold,
                                    style = MaterialTheme.typography.titleSmall
                                )
                            }
                            Spacer(Modifier.height(8.dp))
                            Text(
                                message,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "This list is empty because the request failed, not because no one is on the team.",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                            )
                            Spacer(Modifier.height(12.dp))
                            TextButton(onClick = { viewModel.load() }) { Text("Try again") }
                        }
                    }
                }

                if (uiState.error == null && uiState.members.isEmpty() && !uiState.isLoading) {
                    item {
                        GlassCard {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.Info,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "No people are visible to you",
                                    fontWeight = FontWeight.Bold,
                                    style = MaterialTheme.typography.titleSmall
                                )
                            }
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "The team read succeeded and returned nobody in your scope.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                            )
                        }
                    }
                }

                if (uiState.members.isNotEmpty()) {
                    item {
                        Column {
                            Text(
                                "People on record",
                                fontWeight = FontWeight.ExtraBold,
                                style = MaterialTheme.typography.titleMedium
                            )
                            Text(
                                "${uiState.members.size} listed. Not ranked - there is no measured score to rank on.",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                            )
                        }
                    }

                    if (uiState.noActivityVisible) {
                        item {
                            // Straight from TeamViewModel's own reasoning: an empty
                            // activity read under the own-visibility policy means we
                            // cannot see colleagues' activity, not that there was none.
                            Row(verticalAlignment = Alignment.Top) {
                                Icon(
                                    Icons.Default.Info,
                                    contentDescription = null,
                                    tint = StatusOrange,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "No activity is visible to your account. You may only be permitted to see your own, so a blank entry below does not mean that person did nothing.",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                                )
                            }
                        }
                    }

                    items(uiState.members) { member ->
                        PersonRow(member)
                    }
                }
            }
        }
    }
}

/**
 * States the withdrawal explicitly. Removing the leaderboard without saying so
 * would leave a manager assuming the app measures driver performance somewhere else.
 */
@Composable
private fun ScoringNotMeasuredCard() {
    GlassCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(StatusOrange.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Info,
                    contentDescription = null,
                    tint = StatusOrange,
                    modifier = Modifier.size(18.dp)
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(
                "Driver scoring is not measured yet",
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.titleSmall
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(
            "Nothing in the system records driver points, streaks, on-time rate or a safety ranking, so no score, medal or league position is shown.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.75f)
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Below is what is genuinely on record: the people in your scope and the last activity logged against each of them.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
        )
    }
}

@Composable
private fun PersonRow(member: TeamMemberStatus) {
    // Toned by whether anything is actually KNOWN about this person, never by a
    // score. There is no rank colour here because there is no rank.
    val tone = if (member.hasActivity) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.outline
    }

    GlassCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(tone.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Person, contentDescription = null, tint = tone)
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    member.name,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    // "No activity recorded" is not "Idle" and is not a zero score.
                    member.lastEvent
                        ?.replace("_", " ")
                        ?.replaceFirstChar { it.uppercase() }
                        ?: "No activity recorded",
                    style = MaterialTheme.typography.bodySmall,
                    color = tone
                )
                member.role?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f)
                    )
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                member.site?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        "Site",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                    )
                    Text(it, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                }
                member.lastEventAt?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it.take(10),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                    )
                }
            }
        }
    }
}
