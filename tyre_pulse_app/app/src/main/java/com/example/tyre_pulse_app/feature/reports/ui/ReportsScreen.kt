package com.example.tyre_pulse_app.feature.reports.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.designsystem.component.*
import com.example.tyre_pulse_app.core.designsystem.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsScreen() {
    var selectedPeriod by remember { mutableStateOf("30d") }
    val periods = listOf("7d", "30d", "90d", "YTD")
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Analytics", fontWeight = FontWeight.ExtraBold,
                            style = MaterialTheme.typography.titleLarge)
                        Text("Fleet Intelligence Dashboard",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                    }
                },
                actions = {
                    IconButton(onClick = {}) {
                        Icon(Icons.Default.Download, contentDescription = "Export")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Period selector
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(periods) { period ->
                        val selected = period == selectedPeriod
                        FilterChip(
                            selected = selected,
                            onClick = { selectedPeriod = period },
                            label = { Text(period, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = MaterialTheme.colorScheme.primary,
                                selectedLabelColor = Color.White
                            )
                        )
                    }
                }
            }

            // KPI row
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    KpiTile("247", "Inspections", StatusGreen, Icons.Default.CheckCircle, Modifier.weight(1f),
                        sparkData = listOf(18f, 22f, 19f, 27f, 24f, 31f, 28f))
                    KpiTile("12", "Tyres Due", StatusOrange, Icons.Default.Warning, Modifier.weight(1f),
                        sparkData = listOf(5f, 7f, 9f, 8f, 12f, 11f, 12f))
                    KpiTile("3", "Critical", StatusRed, Icons.Default.Error, Modifier.weight(1f),
                        sparkData = listOf(1f, 2f, 1f, 3f, 2f, 4f, 3f))
                }
            }

            // Fleet health donut
            item {
                GlassCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TPDonutChart(
                            segments = listOf("Good" to 68f, "Warning" to 22f, "Critical" to 10f),
                            colors = listOf(StatusGreen, StatusOrange, StatusRed),
                            modifier = Modifier.size(110.dp)
                        )
                        Spacer(Modifier.width(20.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Fleet Health", fontWeight = FontWeight.ExtraBold,
                                style = MaterialTheme.typography.titleMedium)
                            LegendItem(StatusGreen, "Good — 68%")
                            LegendItem(StatusOrange, "Warning — 22%")
                            LegendItem(StatusRed, "Critical — 10%")
                        }
                    }
                }
            }

            // Tyre wear trend
            item {
                GlassCard {
                    Text("Tyre Wear Rate Trend", fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(8.dp))
                    Text("mm per 10,000 km", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                    Spacer(Modifier.height(12.dp))
                    TPLineChart(
                        series = listOf(
                            "Steer Axle" to listOf(0.8f, 0.85f, 0.9f, 0.82f, 0.95f, 0.88f, 0.92f),
                            "Drive Axle" to listOf(1.1f, 1.15f, 1.08f, 1.2f, 1.18f, 1.25f, 1.22f)
                        ),
                        modifier = Modifier.fillMaxWidth().height(160.dp)
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        LegendItem(Color(0xFF10B981), "Steer Axle")
                        LegendItem(Color(0xFF38BDF8), "Drive Axle")
                    }
                }
            }

            // Cost-per-KM leaderboard
            item {
                GlassCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Leaderboard, contentDescription = null,
                            tint = YellowPrimary, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Cost-per-KM by Tyre Brand", fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleSmall)
                    }
                    Spacer(Modifier.height(16.dp))

                    val brands = listOf(
                        "Bridgestone" to 0.042f,
                        "Michelin" to 0.038f,
                        "Goodyear" to 0.051f,
                        "Continental" to 0.044f,
                        "Hankook" to 0.056f
                    ).sortedBy { it.second }

                    brands.forEach { (brand, cost) ->
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(brand, modifier = Modifier.width(110.dp),
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Medium)
                            TPBarChart(
                                bars = listOf(brand to cost),
                                barColor = when {
                                    cost < 0.040f -> StatusGreen
                                    cost < 0.050f -> StatusOrange
                                    else -> StatusRed
                                },
                                modifier = Modifier.weight(1f).height(18.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("AED %.3f".format(cost),
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Bold,
                                color = when {
                                    cost < 0.040f -> StatusGreen
                                    cost < 0.050f -> StatusOrange
                                    else -> StatusRed
                                })
                        }
                    }
                }
            }

            // Monthly inspection bar chart
            item {
                GlassCard {
                    Text("Monthly Inspection Volume", fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(12.dp))
                    val months = listOf("Mar" to 42f, "Apr" to 55f, "May" to 48f,
                        "Jun" to 61f, "Jul" to 58f, "Aug" to 73f)
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        months.forEach { (month, count) ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(month, modifier = Modifier.width(36.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
                                TPBarChart(
                                    bars = listOf(month to count),
                                    barColor = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.weight(1f).height(22.dp)
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(count.toInt().toString(),
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.width(28.dp))
                            }
                        }
                    }
                }
            }

            // Site comparison
            item {
                GlassCard {
                    Text("Wear Rate by Site", fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(4.dp))
                    Text("Higher wear = faster tyre life consumption",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                    Spacer(Modifier.height(12.dp))
                    val sites = listOf(
                        "Al Ain Construction" to 1.35f,
                        "Dubai Highway" to 0.72f,
                        "Abu Dhabi Port" to 0.98f,
                        "Sharjah Industrial" to 1.18f
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        sites.sortedByDescending { it.second }.forEach { (site, wear) ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(site, modifier = Modifier.width(140.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    maxLines = 1)
                                TPBarChart(
                                    bars = listOf(site to wear),
                                    barColor = when {
                                        wear > 1.2f -> StatusRed
                                        wear > 0.9f -> StatusOrange
                                        else -> StatusGreen
                                    },
                                    modifier = Modifier.weight(1f).height(20.dp)
                                )
                                Spacer(Modifier.width(8.dp))
                                Text("x",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.width(36.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun KpiTile(
    value: String,
    label: String,
    color: Color,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    sparkData: List<Float> = emptyList()
) {
    GlassCard(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(36.dp).clip(CircleShape).background(color.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) { Icon(icon, null, tint = color, modifier = Modifier.size(18.dp)) }
            Spacer(Modifier.width(8.dp))
            Column {
                Text(value, fontWeight = FontWeight.ExtraBold,
                    style = MaterialTheme.typography.titleLarge, color = color)
                Text(label, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
            }
        }
        if (sparkData.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            SparklineChart(sparkData, color, Modifier.fillMaxWidth().height(28.dp))
        }
    }
}

@Composable
private fun LegendItem(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.75f))
    }
}
