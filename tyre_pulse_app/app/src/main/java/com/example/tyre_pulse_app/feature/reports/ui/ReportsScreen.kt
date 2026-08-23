package com.example.tyre_pulse_app.feature.reports.ui

import androidx.compose.foundation.background
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
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.component.*
import com.example.tyre_pulse_app.core.designsystem.theme.*
import com.example.tyre_pulse_app.feature.analytics.model.BrandSlice
import com.example.tyre_pulse_app.feature.analytics.model.MobileAnalytics
import com.example.tyre_pulse_app.feature.analytics.model.SiteSlice
import com.example.tyre_pulse_app.feature.analytics.ui.AnalyticsUiState
import com.example.tyre_pulse_app.feature.analytics.ui.AnalyticsViewModel

/**
 * Fleet analytics.
 *
 * WHAT THIS REPLACED. Every figure on this screen used to be invented in the
 * Composable itself: a cost-per-km leaderboard ("Bridgestone" 0.042, "Michelin"
 * 0.038 ...), a six month inspection bar series ("Mar" 42 ... "Aug" 73), a fleet
 * health donut fixed at 68/22/10, KPI tiles reading 247/12/3 with hand-written
 * sparklines, a two-series tyre wear trend and four named sites with wear
 * multipliers. None of it was measured. A manager comparing tyre brands here was
 * ranking manufacturers on numbers that came from nowhere.
 *
 * It now reads the `get_mobile_analytics` RPC through the existing
 * AnalyticsViewModel / AnalyticsRepository. That is deliberately the SAME reader
 * the analytics screen uses, so the two screens can never quote different numbers
 * for the same fleet.
 *
 * THREE HONESTY RULES THAT MATTER HERE:
 *
 * 1. COST PER KM IS NOT MEASURED and is no longer shown. The RPC returns recorded
 *    tyre SPEND per brand, not spend divided by distance run; there is no per-brand
 *    distance anywhere in this app. The brand card therefore reports spend and
 *    volume and says plainly that cost per km is a different, unmeasured figure.
 *    Relabelling spend as cost per km would be the original defect with new numbers.
 *
 * 2. SPEND IS NEVER SHOWN ACROSS COUNTRIES. The server returns cost only when a
 *    single country is in scope, because SAR, AED and EGP cannot be added. When the
 *    scope is wider the card ranks by tyre count and says why the money is absent.
 *
 * 3. "NOTHING RECORDED" AND "COULD NOT LOAD" RENDER DIFFERENTLY. An empty result is
 *    a fact about the fleet; a failed read is a fact about the request, and it
 *    offers a retry instead of an empty chart that reads as a clean bill of health.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsScreen(
    viewModel: AnalyticsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val selectedSite by viewModel.selectedSite.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "Analytics",
                            fontWeight = FontWeight.ExtraBold,
                            style = MaterialTheme.typography.titleLarge
                        )
                        Text(
                            "Recorded fleet data",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                        )
                    }
                }
            )
        }
    ) { padding ->
        when (val state = uiState) {
            is AnalyticsUiState.Loading -> LoadingBody(Modifier.fillMaxSize().padding(padding))

            is AnalyticsUiState.Error -> ErrorBody(
                message = state.message,
                onRetry = { viewModel.loadAnalytics() },
                modifier = Modifier.fillMaxSize().padding(padding)
            )

            is AnalyticsUiState.Success -> AnalyticsBody(
                data = state.data,
                selectedSite = selectedSite,
                onSiteSelected = { viewModel.setSiteFilter(it) },
                modifier = Modifier.fillMaxSize().padding(padding)
            )
        }
    }
}

@Composable
private fun LoadingBody(modifier: Modifier = Modifier) {
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

/**
 * A failed read must never look like an empty fleet. This names the failure and
 * offers the read again.
 */
@Composable
private fun ErrorBody(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier = modifier.padding(16.dp), contentAlignment = Alignment.Center) {
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
                    "Could not load analytics",
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
                "These figures are missing because the request failed, not because the fleet has no records.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
            )
            Spacer(Modifier.height(12.dp))
            TextButton(onClick = onRetry) { Text("Try again") }
        }
    }
}

@Composable
private fun AnalyticsBody(
    data: MobileAnalytics,
    selectedSite: String?,
    onSiteSelected: (String?) -> Unit,
    modifier: Modifier = Modifier
) {
    // The server returns money only when one country is in scope, because the
    // currencies differ and must never be summed.
    val country = data.country?.takeIf { it.isNotBlank() }

    LazyColumn(
        modifier = modifier,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Site filter. This one really re-queries the server; the old period chips
        // (7d / 30d / 90d / YTD) changed nothing on screen while implying they did.
        if (data.sites.isNotEmpty()) {
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        SiteChip(
                            label = "All sites",
                            selected = selectedSite == null,
                            onClick = { onSiteSelected(null) }
                        )
                    }
                    items(data.sites) { site ->
                        SiteChip(
                            label = site,
                            selected = site == selectedSite,
                            onClick = { onSiteSelected(site) }
                        )
                    }
                }
            }
        }

        // Recorded counts. Every one of these is returned by the RPC.
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                KpiTile(
                    value = data.inspections30d.toString(),
                    label = "Inspections (30d)",
                    color = StatusGreen,
                    icon = Icons.Default.CheckCircle,
                    modifier = Modifier.weight(1f)
                )
                KpiTile(
                    value = data.tyresCritical.toString(),
                    label = "Critical tyres",
                    color = StatusRed,
                    icon = Icons.Default.Error,
                    modifier = Modifier.weight(1f)
                )
                KpiTile(
                    value = data.openActions.toString(),
                    label = "Open actions",
                    color = StatusOrange,
                    icon = Icons.Default.Warning,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        // Tyre condition mix, from by_risk. Nothing is charted when nothing is rated:
        // a donut drawn from an empty rating set would assert a healthy fleet.
        item {
            GlassCard {
                Text(
                    "Tyre condition",
                    fontWeight = FontWeight.ExtraBold,
                    style = MaterialTheme.typography.titleMedium
                )
                Spacer(Modifier.height(12.dp))
                if (data.byRisk.isEmpty()) {
                    NotRecordedNote(
                        "No tyre has a recorded risk rating in this scope, so there is no condition mix to show."
                    )
                } else {
                    val segments = data.byRisk.map { it.risk to it.count.toFloat() }
                    val colors = data.byRisk.map { riskColor(it.risk) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TPDonutChart(
                            segments = segments,
                            colors = colors,
                            modifier = Modifier.size(110.dp)
                        )
                        Spacer(Modifier.width(20.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            data.byRisk.forEach { slice ->
                                LegendItem(
                                    riskColor(slice.risk),
                                    "${slice.risk} - ${slice.count}"
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "${data.tyresTotal} tyres tracked in this scope.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                    )
                }
            }
        }

        // Brand card. This is the block that used to rank manufacturers on an
        // invented cost per km. It now reports what is actually recorded.
        item {
            GlassCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.Leaderboard,
                        contentDescription = null,
                        tint = YellowPrimary,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Tyres by brand",
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleSmall
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "Recorded tyres and spend. This is not cost per km - distance run per brand is not measured.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
                Spacer(Modifier.height(12.dp))
                BrandRows(brands = data.byBrand, country = country)
            }
        }

        // Site card. Replaces four invented sites carrying invented wear multipliers.
        item {
            GlassCard {
                Text(
                    "Tyres by site",
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleSmall
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "Recorded tyre count per site. Wear rate per site is not measured.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
                Spacer(Modifier.height(12.dp))
                SiteRows(sites = data.bySite, country = country)
            }
        }

        // Naming what is absent is part of the report. Silently dropping the charts
        // would leave a reader assuming the app measures things it does not.
        item {
            GlassCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Not measured yet",
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleSmall
                    )
                }
                Spacer(Modifier.height(8.dp))
                listOf(
                    "Cost per km by brand - needs distance run per tyre",
                    "Tyre wear rate over time - no tread depth history is captured",
                    "Monthly inspection history - only a 30 day count is available",
                    "Wear rate by site - needs tread depth measured over distance"
                ).forEach { line ->
                    Row(
                        modifier = Modifier.padding(vertical = 3.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Text(
                            "-",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            line,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "These are listed rather than charted so no one reads an estimate as a measurement.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f)
                )
            }
        }

        data.generatedAt?.takeIf { it.isNotBlank() }?.let { at ->
            item {
                Text(
                    "Data as recorded at $at",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                )
            }
        }
    }
}

@Composable
private fun BrandRows(brands: List<BrandSlice>, country: String?) {
    if (brands.isEmpty()) {
        NotRecordedNote("No tyre in this scope carries a recorded brand.")
        return
    }

    // Rank by recorded volume, which is present on every row. Spend is present only
    // when one country is in scope.
    val ranked = brands.sortedByDescending { it.count }
    val maxCount = ranked.maxOf { it.count }.coerceAtLeast(1)
    val anyCost = ranked.any { it.cost != null }

    ranked.forEach { slice ->
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                slice.brand,
                modifier = Modifier.width(104.dp),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
                maxLines = 1
            )
            ProportionBar(
                fraction = slice.count.toFloat() / maxCount.toFloat(),
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End, modifier = Modifier.width(92.dp)) {
                Text(
                    "${slice.count}",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Bold
                )
                // A missing amount reads as a dash, never as zero: nobody recorded
                // it, which is not the same as it costing nothing.
                Text(
                    slice.cost?.let { formatAmount(it) } ?: "-",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }
        }
    }

    Spacer(Modifier.height(8.dp))
    Text(
        if (anyCost) {
            "Count of tyres, then recorded spend" + (country?.let { " in $it" } ?: "") + "."
        } else {
            "Ranked by recorded tyre count. Spend is not shown because more than one country is in scope and their currencies cannot be added."
        },
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
    )
}

@Composable
private fun SiteRows(sites: List<SiteSlice>, country: String?) {
    if (sites.isEmpty()) {
        NotRecordedNote("No tyre in this scope is attached to a recorded site.")
        return
    }

    val ranked = sites.sortedByDescending { it.count }
    val maxCount = ranked.maxOf { it.count }.coerceAtLeast(1)
    val anyCost = ranked.any { it.cost != null }

    ranked.forEach { slice ->
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                slice.site,
                modifier = Modifier.width(120.dp),
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1
            )
            ProportionBar(
                fraction = slice.count.toFloat() / maxCount.toFloat(),
                color = StatusBlue,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End, modifier = Modifier.width(92.dp)) {
                Text(
                    "${slice.count}",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    slice.cost?.let { formatAmount(it) } ?: "-",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }
        }
    }

    if (anyCost && country != null) {
        Spacer(Modifier.height(8.dp))
        Text(
            "Spend shown in $country.",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
        )
    }
}

/**
 * Proportional bar drawn directly rather than through TPBarChart. TPBarChart scales
 * each call against its OWN maximum, so one bar per row rendered every row full
 * width - the old brand and site lists all looked identical whatever their values.
 */
@Composable
private fun ProportionBar(fraction: Float, color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .height(16.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.12f))
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(fraction.coerceIn(0.03f, 1f))
                .clip(RoundedCornerShape(8.dp))
                .background(color)
        )
    }
}

@Composable
private fun NotRecordedNote(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            Icons.Default.Info,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
            modifier = Modifier.size(16.dp)
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
        )
    }
}

@Composable
private fun SiteChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = {
            Text(label, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
        },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = MaterialTheme.colorScheme.primary,
            selectedLabelColor = Color.White
        )
    )
}

@Composable
private fun KpiTile(
    value: String,
    label: String,
    color: Color,
    icon: ImageVector,
    modifier: Modifier = Modifier
) {
    GlassCard(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(36.dp).clip(CircleShape).background(color.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) { Icon(icon, null, tint = color, modifier = Modifier.size(18.dp)) }
            Spacer(Modifier.width(8.dp))
            Column {
                Text(
                    value,
                    fontWeight = FontWeight.ExtraBold,
                    style = MaterialTheme.typography.titleLarge,
                    color = color
                )
                Text(
                    label,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }
        }
    }
}

@Composable
private fun LegendItem(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(6.dp))
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.75f)
        )
    }
}

/** An unrecognised rating gets a neutral tone rather than being forced into a band. */
private fun riskColor(risk: String): Color = when (risk.trim().lowercase()) {
    "critical" -> StatusRed
    "high" -> StatusOrange
    "medium", "moderate", "warning" -> YellowVariant
    "low", "good", "ok" -> StatusGreen
    else -> StatusBlue
}

private fun formatAmount(value: Double): String = "%,.0f".format(value)
