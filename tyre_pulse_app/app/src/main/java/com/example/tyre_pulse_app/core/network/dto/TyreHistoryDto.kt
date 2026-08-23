package com.example.tyre_pulse_app.core.network.dto

import com.example.tyre_pulse_app.core.model.RemovalReason
import com.example.tyre_pulse_app.core.model.TyreHistoryEvent
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * One FITMENT EPISODE of a tyre, read from public.tyre_records.
 *
 * WHY THIS TABLE AND NOT A HISTORY TABLE. `TyreApi` used to declare
 * `@GET("tyre_history")`, with the source itself admitting "Verify table name from
 * schema". There is no tyre_history table. The obvious-looking alternatives were
 * measured rather than guessed at (live, 2026-08-23):
 *
 *   tyre_records          11,205 rows   <- the one that holds the lifecycle
 *   tyre_status_marks        201 rows   (scrap marks only, keyed by serial)
 *   tyre_service_events        0 rows
 *   tyre_rotations             0 rows
 *   tyre_disposals             0 rows
 *   tyre_changes          11,205 rows   but it is a VIEW over tyre_records
 *
 * A tyre_records row is not a static "tyre" - it is one episode of a tyre being
 * fitted to an asset at a position and later removed. It carries both ends:
 * fitment_date + km_at_fitment, then removal_date + km_at_removal + total_km +
 * removal_reason. So the HISTORY of a tyre is its set of rows, ordered by date.
 *
 * That the rows really do group this way was verified, not assumed: 2,480 serials
 * carry more than one row (the largest carries 34), and reading one such group
 * shows exactly the expected chain - fitted to PL080/LHF1 in Nov 2025 at 146,571 km,
 * removed Jul 2026 at 255,501 km, then refitted at 255,501 km, then moved to PL078.
 * This is the same fact the web reconciliation records as normal tyre movement
 * ("a serial on multiple assets over time = the tyre MOVED").
 *
 * Every field is nullable. Of the business columns only organisation_id is NOT NULL,
 * and brand is genuinely absent on 360 of 11,205 rows.
 */
@Serializable
data class TyreHistoryDto(
    val id: String? = null,
    // The serial lives across three imported columns and no single one is complete;
    // mobile/lib/tyreLookup.ts matches all three for the same reason.
    @SerialName("serial_no") val serialNo: String? = null,
    @SerialName("serial_number") val serialNumber: String? = null,
    @SerialName("tyre_serial") val tyreSerial: String? = null,
    @SerialName("asset_no") val assetNo: String? = null,
    @SerialName("asset_number") val assetNumber: String? = null,
    val position: String? = null,
    @SerialName("tyre_position") val tyrePosition: String? = null,
    val brand: String? = null,
    val size: String? = null,
    val site: String? = null,
    val country: String? = null,
    val status: String? = null,
    @SerialName("fitment_date") val fitmentDate: String? = null,
    @SerialName("issue_date") val issueDate: String? = null,
    @SerialName("removal_date") val removalDate: String? = null,
    @SerialName("km_at_fitment") val kmAtFitment: Double? = null,
    @SerialName("km_at_removal") val kmAtRemoval: Double? = null,
    @SerialName("total_km") val totalKm: Double? = null,
    @SerialName("tread_depth") val treadDepth: Double? = null,
    @SerialName("removal_reason") val removalReason: String? = null,
    @SerialName("reason_for_removal") val reasonForRemoval: String? = null,
    @SerialName("driver_name") val driverName: String? = null,
    @SerialName("job_card") val jobCard: String? = null,
    val remarks: String? = null,
    val findings: String? = null,
    @SerialName("organisation_id") val organisationId: String? = null,
) {
    /**
     * The serial this episode belongs to, taken from whichever column carries it.
     *
     * Returns null when the row names no serial at all, in which case the row is
     * its own whole history - it cannot be grouped with anything.
     */
    fun serialKey(): String? =
        listOf(serialNo, serialNumber, tyreSerial)
            .firstOrNull { !it.isNullOrBlank() }
            ?.trim()

    fun assetKey(): String? =
        listOf(assetNo, assetNumber).firstOrNull { !it.isNullOrBlank() }?.trim()

    fun positionKey(): String? =
        listOf(position, tyrePosition).firstOrNull { !it.isNullOrBlank() }?.trim()

    /** The reason recorded for the removal, from whichever column carries it. */
    fun removalReasonText(): String? =
        listOf(removalReason, reasonForRemoval).firstOrNull { !it.isNullOrBlank() }?.trim()

    companion object {
        /**
         * PostgREST returns only the columns asked for, so this list and the fields
         * above are a PAIR - a field with no column here silently arrives null.
         *
         * Column names verified against information_schema on 2026-08-23.
         */
        const val SELECT = "id,serial_no,serial_number,tyre_serial,asset_no,asset_number," +
            "position,tyre_position,brand,size,site,country,status,fitment_date,issue_date," +
            "removal_date,km_at_fitment,km_at_removal,total_km,tread_depth,removal_reason," +
            "reason_for_removal,driver_name,job_card,remarks,findings,organisation_id"

        /** Only the reason column, for building the reason suggestion list. */
        const val SELECT_REASON_ONLY = "removal_reason"

        /**
         * Match a serial across all three serial columns.
         *
         * Emitted as PostgREST's `or=(...)` group. Mirrors the Expo app's
         * lookupTyreBySerial, which matches the same three columns.
         */
        fun serialOrFilter(serial: String): String =
            "(serial_no.eq.$serial,serial_number.eq.$serial,tyre_serial.eq.$serial)"

        /**
         * Strip the characters that would break out of a PostgREST `or=(...)` group.
         *
         * Byte-mirrors mobile/lib/tyreLookup.ts sanitizeSerial, which exists because
         * commas and parentheses terminate the filter group and turn a lookup into a
         * syntax error. Serials in this database are not always clean - some rows
         * carry a tyre SIZE such as "205/85 R 16" in the serial column - so this
         * runs on every value, not only on user input.
         */
        fun sanitizeSerial(raw: String): String =
            raw.trim().replace(Regex("[(),]"), "").take(64)
    }
}

/**
 * Turn one fitment episode into the events a timeline shows.
 *
 * A row yields a FITTED event when it records a fitment, and a REMOVED (or
 * SCRAPPED) event when it records an end. A still-fitted tyre yields one event, not
 * a fabricated second one.
 *
 * The event id is derived from the row id plus the event kind because a row
 * produces up to two events and a list key has to be unique. Nothing is invented:
 * where a date or a meter reading is absent it stays absent.
 */
fun TyreHistoryDto.toHistoryEvents(): List<TyreHistoryEvent> {
    val rowId = id.orEmpty()
    val serial = serialKey().orEmpty()
    val asset = assetKey()
    val pos = positionKey()
    val events = mutableListOf<TyreHistoryEvent>()

    val fittedOn = listOf(fitmentDate, issueDate).firstOrNull { !it.isNullOrBlank() }
    if (fittedOn != null) {
        events += TyreHistoryEvent(
            id = "$rowId:fitted",
            tyreId = serial,
            type = "FITTED",
            date = fittedOn,
            assetNumber = asset,
            position = pos,
            kmReading = kmAtFitment?.toLong(),
            // The table records no actor for a fitment. Left null rather than
            // defaulting to "System", which would assert that an automated process
            // did it.
            userName = null,
            reason = null,
            notes = listOfNotNull(
                brand?.takeIf { it.isNotBlank() },
                size?.takeIf { it.isNotBlank() },
                jobCard?.takeIf { it.isNotBlank() }?.let { "Job card $it" },
            ).joinToString(" - ").ifBlank { null },
        )
    }

    val isScrapped = status?.trim()?.equals("Scrapped", ignoreCase = true) == true
    val endedOn = removalDate
    if (endedOn != null || isScrapped) {
        events += TyreHistoryEvent(
            id = "$rowId:removed",
            tyreId = serial,
            type = if (isScrapped) "SCRAPPED" else "REMOVED",
            // A scrapped row can carry no removal date. Rather than invent one, the
            // event falls back to the date the episode is known to have started,
            // and only to the empty string if the row carries no date at all.
            date = endedOn ?: fittedOn ?: "",
            assetNumber = asset,
            position = pos,
            kmReading = kmAtRemoval?.toLong(),
            userName = driverName?.takeIf { it.isNotBlank() },
            reason = removalReasonText(),
            notes = listOfNotNull(
                totalKm?.let { "Ran ${it.toLong()} km" },
                findings?.takeIf { it.isNotBlank() },
                remarks?.takeIf { it.isNotBlank() },
            ).joinToString(" - ").ifBlank { null },
        )
    }

    return events
}

/**
 * Order a tyre's events newest first.
 *
 * Sorting is on the ISO date string, which is safe because every date column here
 * is a Postgres `date` and PostgREST renders it as YYYY-MM-DD - lexical order and
 * chronological order agree. Rows with no date sort last rather than being dropped.
 */
fun List<TyreHistoryEvent>.sortedNewestFirst(): List<TyreHistoryEvent> =
    sortedWith(compareByDescending<TyreHistoryEvent> { it.date.isNotBlank() }.thenByDescending { it.date })

/**
 * The response of the get_tyre_filter_options RPC.
 *
 * PLACEMENT NOTE: this is a tyre FILTER shape, not a history shape, and it belongs
 * in its own file. It is here because the change that introduced it was scoped to a
 * fixed file list that allowed exactly two new DTO files. Move it when that
 * constraint lifts; nothing depends on its location.
 */
@Serializable
data class TyreFilterOptionsDto(
    val sites: List<String> = emptyList(),
    val brands: List<String> = emptyList(),
)

/** One `removal_reason` cell, for building the reason suggestion list. */
@Serializable
data class RemovalReasonRow(
    @SerialName("removal_reason") val removalReason: String? = null,
)

/**
 * Build the removal-reason list from the reasons ACTUALLY recorded.
 *
 * THERE IS NO REMOVAL-REASON TABLE, and this was checked properly before writing a
 * line of it. `TyreApi` used to call `@GET("lookup_reasons")`, which 404s. Live,
 * on 2026-08-23: no `lookup_reasons` or any other lookup table exists; the public
 * schema contains ZERO enum types; and no RPC returns reasons - the one that looks
 * like it might, get_tyre_filter_options, returns sites and brands only. The web
 * hard-codes a filter list of its own, and the Expo app's tyre-change screen takes
 * the reason as FREE TEXT with no picker at all.
 *
 * So the only real source is the distinct values already stored in
 * tyre_records.removal_reason, which is what this builds. It is a suggestion list
 * over real data, not a controlled vocabulary, and the caller must still allow free
 * text - anything else would invent a constraint the database does not have.
 *
 * THE BRAND CONTAMINATION IS REAL AND IS EXCLUDED ON EVIDENCE. A known open data
 * defect puts tyre BRAND names in this column: ROADX appears 693 times, which makes
 * it the third most common "reason a tyre was removed" in the whole fleet, ahead of
 * BLAST/BURST. Nine values are brands (ROADX, FIREMAX, LONGMARCH, ROCK HOLDER,
 * VGLORY, RADIAL, TRIANGLE, BLACKHAWK, ALLROUND) totalling 871 of ~3,679 recorded
 * reasons - 24%.
 *
 * The discriminator is measured, not a hand-written blocklist that would rot:
 * membership of the table's own brand catalogue flags 9 of 9 contaminants and 0 of
 * the 17 genuine reasons. Note that the catalogue must come from the WHOLE table -
 * restricting it to the brands seen on removed rows catches only 5 of 9, missing
 * FIREMAX, ROCK HOLDER, VGLORY and ALLROUND. That is why the caller reads the brand
 * list from get_tyre_filter_options rather than from the rows it already has.
 *
 * NOT excluded, deliberately: import artifacts such as
 * "TWO CURRENT TYRES - MANUAL REVIEW" (460 rows) and
 * "REMOVED (FITMENT PREDATES EXPORT)" (5). They read oddly but they are genuinely
 * what the column says, and suppressing them would mean a second, unmeasured
 * judgement list. They sort by frequency like everything else and nobody has to
 * pick them.
 *
 * @param rows every non-blank removal_reason cell read back.
 * @param brands the brand catalogue, used only to exclude. An EMPTY list means the
 *        brand read failed or returned nothing; in that case nothing is excluded,
 *        so a failed cross-check degrades to a longer list rather than to an empty
 *        one.
 */
fun buildRemovalReasons(
    rows: List<RemovalReasonRow>,
    brands: List<String>,
): List<RemovalReason> {
    val brandSet = brands.mapNotNull { it.trim().uppercase().ifBlank { null } }.toSet()

    val frequency = LinkedHashMap<String, Int>()
    val display = HashMap<String, String>()
    for (row in rows) {
        val raw = row.removalReason?.trim().orEmpty()
        if (raw.isEmpty()) continue
        val key = raw.uppercase()
        if (key in brandSet) continue
        frequency[key] = (frequency[key] ?: 0) + 1
        display.putIfAbsent(key, raw)
    }

    return frequency.entries
        // Most-used first, so the reasons a fitter actually records are at the top.
        // Ties break alphabetically so the order is stable between loads rather
        // than following whatever order the rows happened to arrive in.
        .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        .map { (key, _) ->
            RemovalReason(
                // The canonical upper-case form is the id: the column is free text
                // and the same reason arrives in mixed case, so keying on the raw
                // string would offer the same reason twice.
                id = key,
                name = display[key] ?: key,
                // The database enforces no such rule on any reason, so claiming one
                // would be inventing a constraint.
                requiresDescription = false,
            )
        }
}
