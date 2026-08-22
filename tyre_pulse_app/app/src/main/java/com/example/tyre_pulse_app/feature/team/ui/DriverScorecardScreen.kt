package com.example.tyre_pulse_app.feature.team.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.designsystem.component.*
import com.example.tyre_pulse_app.core.designsystem.theme.*

data class DriverScore(
    val name: String,
    val role: String,
    val points: Int,
    val streak: Int,     // consecutive days
    val badge: String,   // emoji badge
    val inspections: Int,
    val onTimeRate: Float
)

import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriverScorecardScreen() {
    val drivers = listOf(
        DriverScore("Ahmed Al-Rashidi", "Senior Driver", 2840, 14, "🏆", 47, 98.2f),
        DriverScore("Kevin Lumumba", "Driver", 2150, 7, "🥈", 38, 94.5f),
        DriverScore("Musa Bello", "Driver", 1920, 5, "🥉", 35, 91.0f),
        DriverScore("John Tumelo", "Jr Driver", 1450, 3, "⭐", 28, 87.3f),
        DriverScore("Rashid Khalil", "Driver", 1200, 0, "📋", 21, 82.1f),
    )
    val myDriver = drivers.first()
    
    val pullToRefreshState = rememberPullToRefreshState()
    val snackbarHostState = remember { SnackbarHostState() }

    if (pullToRefreshState.isRefreshing) {
        LaunchedEffect(true) {
            pullToRefreshState.endRefresh()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Safety Scorecard", fontWeight = FontWeight.ExtraBold,
                            style = MaterialTheme.typography.titleLarge)
                        Text("Gamified driver performance ranking",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .nestedScroll(pullToRefreshState.nestedScrollConnection)
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
            // My card (hero)
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(24.dp))
                        .background(Brush.horizontalGradient(
                            listOf(Color(0xFF059669), Color(0xFF0D9488))
                        ))
                        .padding(20.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        // Avatar
                        Box(
                            modifier = Modifier.size(64.dp).clip(CircleShape)
                                .background(Color.White.copy(alpha = 0.2f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(myDriver.badge, fontSize = 28.sp)
                        }
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text(myDriver.name, fontWeight = FontWeight.ExtraBold,
                                color = Color.White, style = MaterialTheme.typography.titleMedium)
                            Text(myDriver.role, color = Color.White.copy(alpha = 0.8f),
                                style = MaterialTheme.typography.bodySmall)
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                ScorePill(" pts", Color.White)
                                ScorePill("🔥 d streak", Color(0xFFFDE047))
                                ScorePill("% on-time", Color.White)
                            }
                        }
                    }
                }
            }

            // My stats
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PulseStatTile(
                        count = "",
                        label = "Inspections",
                        statusColor = StatusGreen,
                        modifier = Modifier.weight(1f)
                    )
                    PulseStatTile(
                        count = "",
                        label = "Day Streak 🔥",
                        statusColor = YellowPrimary,
                        modifier = Modifier.weight(1f)
                    )
                    PulseStatTile(
                        count = "#1",
                        label = "Rank",
                        statusColor = StatusBlue,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Achievements
            item {
                GlassCard {
                    Text("Achievements", fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(12.dp))
                    val achievements = listOf(
                        "🏆" to "Top Inspector — 30 Days",
                        "⚡" to "Speed Pro — 0 Overdue",
                        "🔥" to "14-Day Streak",
                        "💯" to "Perfect Week",
                        "🚀" to "Early Adopter"
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        achievements.forEach { (emoji, label) ->
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Box(
                                    modifier = Modifier.size(48.dp).clip(CircleShape)
                                        .background(YellowPrimary.copy(alpha = 0.15f))
                                        .border(1.dp, YellowPrimary.copy(alpha = 0.4f), CircleShape),
                                    contentAlignment = Alignment.Center
                                ) { Text(emoji, fontSize = 22.sp) }
                                Spacer(Modifier.height(4.dp))
                                Text(label, style = MaterialTheme.typography.labelSmall,
                                    fontSize = 8.sp, maxLines = 2,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                            }
                        }
                    }
                }
            }

            // Leaderboard
            item {
                Text("Leaderboard", fontWeight = FontWeight.ExtraBold,
                    style = MaterialTheme.typography.titleMedium)
            }

            itemsIndexed(drivers) { index, driver ->
                LeaderboardRow(rank = index + 1, driver = driver)
            }
        }
        
        PullToRefreshContainer(
            state = pullToRefreshState,
            modifier = Modifier.align(Alignment.TopCenter)
        )
    }
}

@Composable
private fun LeaderboardRow(rank: Int, driver: DriverScore) {
    val rankColor = when (rank) {
        1 -> YellowPrimary
        2 -> Color(0xFFC0C0C0)
        3 -> Color(0xFFCD7F32)
        else -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
    }
    GlassCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Rank number
            Box(
                modifier = Modifier.size(36.dp).clip(CircleShape).background(rankColor.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Text("", fontWeight = FontWeight.ExtraBold, color = rankColor, fontSize = 14.sp)
            }
            Spacer(Modifier.width(12.dp))
            // Badge + name
            Text(driver.badge, fontSize = 20.sp)
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(driver.name, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                Text(" inspections · % on-time",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
            }
            // Points
            Column(horizontalAlignment = Alignment.End) {
                Text("", fontWeight = FontWeight.ExtraBold,
                    color = rankColor, style = MaterialTheme.typography.titleMedium)
                Text("pts", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
            }
        }
    }
}

@Composable
private fun ScorePill(text: String, textColor: Color) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = Color.White.copy(alpha = 0.15f)
    ) {
        Text(text, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
            color = textColor)
    }
}
