package com.example.tyre_pulse_app.feature.overview.model

import com.example.tyre_pulse_app.feature.analytics.model.MobileAnalytics
import java.time.LocalDate
import java.util.Locale

/**
 * Fleet Overview - the pure shaping layer.
 *
 * WHAT THIS SCREEN IS FOR, AND WHY IT IS NOT FLEET ANALYTICS.
 *
 * Both screens read the SAME server aggregate (`get_mobile_analytics`). They are
 * kept apart because they answer different questions, and the split is deliberate:
 *
 *   Fleet Analytics  -> "what is the fleet like RIGHT NOW"  - live counts, risk
 *                       bands, inspection activity. It passes no date range.
 *   Fleet Overview   -> "what happened over a PERIOD"       - how many tyre
 *                       records, at which sites, on which brands, and what it
 *                       cost in that window.
 *
 * The period is the whole point. `get_mobile_analytics` has taken `p_from`/`p_to`
 * since it was written and nothing in this app has ever passed them, so its
 * spend, by-site and by-brand outputs were unreachable. This screen is what makes
 * them reachable. If a future change gives Analytics a date range and a spend
 * tile, these two become duplicates and one of them should go.
 *
 * NOTHING HERE PAGES `tyre_records`. The Expo screen this replaces downloaded all
 * 11,205 rows (1,000 per request) and counted them on the phone. The server does
 * the aggregation now and the device receives one row.
 */

/** ------------------------------------------------------------------------- */
/** Period                                                                     */
/** ------------------------------------------------------------------------- */

/**
 * The window the whole screen is scoped to.
 *
 * Default is [MONTHS_12], not "this month". A narrow default on an upload-driven
 * feed renders an empty screen on a quiet month and reads as lost data - that
 * mistake has already been made and reverted once in this product. Twelve rolling
 * months always has rows, and the empty state offers [ALL_TIME] in one tap if a
 * scope ever does come back with nothing.
 */
enum class OverviewPeriod(val label: String, private val days: Long?) {
    ALL_TIME("All time", null),
    DAYS_30("30 days", 30),
    DAYS_90("90 days", 90),
    MONTHS_6("6 months", 182),
    MONTHS_12("12 months", 365);

    /** Inclusive lower bound, or null for "no lower bound". */
    fun fromDate(today: LocalDate): LocalDate? = days?.let { today.minusDays(it) }

    /** Upper bound. Null for [ALL_TIME] so a future-dated row is not silently cut. */
    fun toDate(today: LocalDate): LocalDate? = if (days == null) null else today

    /** What the window covers, in words, for the caption under the title. */
    fun describe(today: LocalDate): String {
        val from = fromDate(today) ?: return "All records, no date limit"
        return "$from to ${toDate(today)}"
    }
}

/** ------------------------------------------------------------------------- */
/** Country scope and currency                                                 */
/** ------------------------------------------------------------------------- */

/**
 * Country scope - and the ONLY thing that unlocks a money figure on this screen.
 *
 * THE RULE THIS EXISTS TO ENFORCE: SAR, AED and EGP are different currencies and
 * are never added together. A blended total is not a quantity of anything, and
 * this product has had to correct that exact defect at several reader sites.
 *
 * So: with no country scoped, this screen renders NO monetary value anywhere -
 * not the headline, not a site row, not a brand row. That is a client-side
 * guarantee, deliberately independent of what the server sends, so it holds even
 * if a future server change starts returning a summed figure.
 *
 * [currency] is the code the server's own `country_currency` table holds for each
 * country. A country that is not in this list renders its amount with the country
 * NAME and no currency code, rather than borrowing a neighbour's - labelling an
 * AED figure "SAR" is worse than showing no code at all.
 */
enum class CountryScope(
    val label: String,
    val queryValue: String?,
    val currency: String?,
) {
    ALL("All countries", null, null),
    KSA("KSA", "KSA", "SAR"),
    UAE("UAE", "UAE", "AED"),
    EGYPT("Egypt", "Egypt", "EGP");

    companion object {
        /**
         * Offered as filter INPUTS, not as claims about the fleet. Row visibility
         * is bounded server-side by RLS: a user with no UAE scope who taps UAE
         * gets an honest empty result, not another country's data.
         */
        val options: List<CountryScope> = listOf(ALL, KSA, UAE, EGYPT)
    }
}

/** ------------------------------------------------------------------------- */
/** Spend                                                                      */
/** ------------------------------------------------------------------------- */

/**
 * Tyre spend for the window - or an explicit statement of why there is no number.
 *
 * Three outcomes, three different sentences. Collapsing any two of them would let
 * "we will not add currencies together" read as "this fleet spent nothing".
 */
sealed class SpendFigure {

    /** A real amount, in one country's own currency. */
    data class Amount(
        val value: Double,
        val country: String,
        val currency: String?,
    ) : SpendFigure()

    /**
     * No country is scoped, so a single total would have to blend SAR + AED + EGP.
     * Withheld on purpose. The screen says so and offers the country chips.
     */
    object AcrossCountries : SpendFigure()

    /**
     * A country IS scoped and there is still no cost. That is a gap in the tyre
     * records themselves, not a refusal by this screen - a large share of
     * `tyre_records` carries no price.
     */
    data class NotRecorded(val country: String) : SpendFigure()
}

/** ------------------------------------------------------------------------- */
/** Risk coverage                                                              */
/** ------------------------------------------------------------------------- */

/**
 * How much of the fleet carries a risk rating at all.
 *
 * MEASURED LIVE: `tyre_records.risk_level` is NULL on ALL 11,205 rows. So the
 * "high risk" figure the Expo screen showed was structurally 0 - and a 0 there
 * is a claim about the fleet ("no tyres are at risk") that nobody measured.
 *
 * This type exists so the screen can tell the two apart. [isMeasured] is false
 * when nothing carries a band, and the screen then renders the risk KPI as
 * unrecorded and names the reason. It NEVER renders 0.
 *
 * Note [unrated] absorbs any rows the breakdown did not mention at all. Counting
 * those as rated would overstate coverage, which is the direction that matters.
 */
data class RiskCoverage(
    val rated: Int,
    val unrated: Int,
    val total: Int,
    val bands: List<BreakdownRow>,
) {
    val isMeasured: Boolean get() = rated > 0

    /** Whole-percent coverage, or null when there is nothing to divide by. */
    val ratedPercent: Int? get() = if (total > 0) (rated * 100) / total else null

    /**
     * Tyres in a High or Critical band.
     *
     * NULL, NEVER ZERO, when nothing carries a band at all. That distinction is
     * the whole reason this type exists: 0 states that no tyre is at risk, which
     * is a measurement nobody took. The screen renders null as "Not recorded".
     */
    val highRisk: Int?
        get() = if (!isMeasured) null else bands
            .filter { it.label.trim().lowercase(Locale.ROOT) in HIGH_RISK_BANDS }
            .sumOf { it.count }
}

/** Bands that count as "needs attention". Matched case-insensitively. */
private val HIGH_RISK_BANDS = setOf("high", "critical", "severe", "urgent")

/** ------------------------------------------------------------------------- */
/** Breakdown rows                                                             */
/** ------------------------------------------------------------------------- */

/**
 * One bar. [cost] is null whenever a money value must not be shown - either the
 * server did not send one, or no country is scoped.
 */
data class BreakdownRow(
    val label: String,
    val count: Int,
    val cost: Double? = null,
)

/** ------------------------------------------------------------------------- */
/** The shaped snapshot the screen renders                                     */
/** ------------------------------------------------------------------------- */

/**
 * `inspections_30d` is deliberately NOT carried here. It is a fixed 30-day
 * server figure, so on a screen whose scope reads "12 months" it would be a
 * number that quietly answers a different question. It belongs to Fleet
 * Analytics, which is the current-state screen, and it is already shown there.
 */
data class OverviewSnapshot(
    val tyreRecords: Int,
    val vehicles: Int,
    val spend: SpendFigure,
    val risk: RiskCoverage,
    val topSites: List<BreakdownRow>,
    val topBrands: List<BreakdownRow>,
    val siteOptions: List<String>,
    val generatedAt: String?,
) {
    /** Loaded successfully and the scope genuinely holds nothing. */
    val isEmpty: Boolean get() = tyreRecords == 0 && vehicles == 0
}

/** Labels that mean "nobody recorded a band", in any spelling the data uses. */
private val UNRATED_LABELS = setOf(
    "", "unknown", "unrated", "not rated", "none", "null", "n/a", "na", "-",
)

private const val TOP_N = 6

/**
 * Shape one `get_mobile_analytics` row into what the screen renders.
 *
 * [country] is the scope that was REQUESTED, and it is what decides whether any
 * money is shown - see [CountryScope].
 */
fun buildOverview(analytics: MobileAnalytics, country: CountryScope): OverviewSnapshot {
    val moneyAllowed = country.queryValue != null

    var rated = 0
    var unrated = 0
    val bands = mutableListOf<BreakdownRow>()
    for (slice in analytics.byRisk) {
        val key = slice.risk.trim().lowercase(Locale.ROOT)
        if (key in UNRATED_LABELS) {
            unrated += slice.count
        } else {
            rated += slice.count
            bands += BreakdownRow(slice.risk.trim(), slice.count)
        }
    }
    // Rows the breakdown never mentioned are unaccounted for, not rated.
    val unaccounted = (analytics.tyresTotal - rated - unrated).coerceAtLeast(0)

    val spend = when {
        !moneyAllowed -> SpendFigure.AcrossCountries
        analytics.tyreSpend == null -> SpendFigure.NotRecorded(country.label)
        else -> SpendFigure.Amount(analytics.tyreSpend, country.label, country.currency)
    }

    return OverviewSnapshot(
        tyreRecords = analytics.tyresTotal,
        vehicles = analytics.vehiclesTotal,
        spend = spend,
        risk = RiskCoverage(
            rated = rated,
            unrated = unrated + unaccounted,
            total = analytics.tyresTotal,
            bands = bands.sortedByDescending { it.count },
        ),
        topSites = analytics.bySite
            .filter { it.count > 0 }
            .sortedByDescending { it.count }
            .take(TOP_N)
            .map {
                BreakdownRow(
                    label = it.site.ifBlank { "Site not recorded" },
                    count = it.count,
                    cost = if (moneyAllowed) it.cost else null,
                )
            },
        topBrands = analytics.byBrand
            .filter { it.count > 0 }
            .sortedByDescending { it.count }
            .take(TOP_N)
            .map {
                BreakdownRow(
                    label = it.brand.ifBlank { "Brand not recorded" },
                    count = it.count,
                    cost = if (moneyAllowed) it.cost else null,
                )
            },
        siteOptions = analytics.sites.filter { it.isNotBlank() },
        generatedAt = analytics.generatedAt,
    )
}

/** ------------------------------------------------------------------------- */
/** Formatting                                                                 */
/** ------------------------------------------------------------------------- */

/** 1234 -> "1.2K", 1234567 -> "1.2M". Mirrors the Expo screen's own compact(). */
fun compactNumber(value: Int): String = compactNumber(value.toDouble())

fun compactNumber(value: Double): String {
    val abs = kotlin.math.abs(value)
    return when {
        abs >= 1_000_000 -> String.format(Locale.US, "%.1fM", value / 1_000_000)
        abs >= 1_000 -> String.format(Locale.US, "%.1fK", value / 1_000)
        else -> String.format(Locale.US, "%,.0f", value)
    }
}

/**
 * A money value ALWAYS carries the country it belongs to. The currency code is
 * appended only when it is actually known - never guessed from a default.
 */
fun formatMoney(value: Double, currency: String?): String {
    val amount = String.format(Locale.US, "%,.0f", value)
    return if (currency != null) "$currency $amount" else amount
}
