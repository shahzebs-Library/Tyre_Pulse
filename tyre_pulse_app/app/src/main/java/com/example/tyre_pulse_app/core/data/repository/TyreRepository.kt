package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.database.dao.TyreDao
import com.example.tyre_pulse_app.core.database.model.TyreEntity
import com.example.tyre_pulse_app.core.model.RemovalReason
import com.example.tyre_pulse_app.core.model.ReplacementStatus
import com.example.tyre_pulse_app.core.model.Tyre
import com.example.tyre_pulse_app.core.model.TyreHistoryEvent
import com.example.tyre_pulse_app.core.model.TyreReplacementRequest
import com.example.tyre_pulse_app.core.network.api.TyreApi
import com.example.tyre_pulse_app.core.network.api.TyreReplacementApi
import com.example.tyre_pulse_app.core.network.dto.RemovalReasonRow
import com.example.tyre_pulse_app.core.network.dto.TyreHistoryDto
import com.example.tyre_pulse_app.core.network.dto.buildRemovalReasons
import com.example.tyre_pulse_app.core.network.dto.sortedNewestFirst
import com.example.tyre_pulse_app.core.network.dto.toHistoryEvents
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Tyres, read from public.tyre_records.
 *
 * THE LIFECYCLE LIVES IN tyre_records, NOT IN A HISTORY TABLE. This repository used
 * to call `tyre_history`, `lookup_reasons` and `replacements`. None of those tables
 * exist. [TyreHistoryDto] records which tables were measured, their live row counts,
 * and why a tyre_records ROW turns out to be one fitment episode rather than a
 * static tyre - which is what makes the set of rows sharing a serial the tyre's
 * history.
 */
@Singleton
class TyreRepository @Inject constructor(
    private val tyreApi: TyreApi,
    private val tyreReplacementApi: TyreReplacementApi,
    private val tyreDao: TyreDao,
    private val json: Json
) {
    fun searchTyres(tenantId: String, query: String): Flow<List<Tyre>> {
        return tyreDao.searchTyres(tenantId, query).map { entities ->
            entities.map { json.decodeFromString<Tyre>(it.rawData) }
        }
    }

    /**
     * Refresh the local cache from the server.
     *
     * The serial filter now carries a PostgREST OPERATOR. It previously sent the
     * bare search term (`serial_no=ABC`), which PostgREST rejects outright - the
     * refresh could never have succeeded. A blank query sends no filter at all
     * rather than matching the empty string.
     */
    suspend fun refreshTyres(tenantId: String, query: String) {
        val term = TyreHistoryDto.sanitizeSerial(query)
        val remoteTyres = tyreApi.getTyres(
            query = term.takeIf { it.isNotBlank() }?.let { "ilike.*$it*" },
        )
        val entities = remoteTyres.map { it.toEntity() }
        tyreDao.insertTyres(entities)
    }

    /**
     * One tyre, from the cache if it is there and from the server otherwise.
     *
     * The server lookup now sends `id=eq.<uuid>`; it previously sent the bare uuid,
     * which PostgREST rejects, so every cache miss failed. It also used `.first()`,
     * which throws an unhelpful NoSuchElementException on an empty list; a missing
     * row now says which id was missing.
     */
    suspend fun getTyre(id: String): Tyre {
        val local = tyreDao.getTyreById(id)
        if (local != null) {
            return json.decodeFromString<Tyre>(local.rawData)
        }
        val remote = tyreApi.getTyre(id = "eq.$id").firstOrNull()
            ?: throw NoSuchElementException("No tyre record with id $id")
        tyreDao.insertTyres(listOf(remote.toEntity()))
        return remote
    }

    /**
     * The full lifecycle of the tyre identified by a tyre_records row id.
     *
     * TWO READS, and both are needed. The caller holds a ROW id, but a tyre's
     * history is spread across every row that shares its SERIAL - 2,480 serials
     * carry more than one row, the largest 34 - so the row is resolved to its serial
     * first, then every row for that serial is fetched.
     *
     * The serial is matched across all three serial columns (`serial_no`,
     * `serial_number`, `tyre_serial`), because no single one is complete. That is
     * the same rule the Expo app applies in lookupTyreBySerial.
     *
     * A row that names NO serial cannot be grouped with anything, so it is its own
     * whole history rather than being silently merged with other serial-less rows.
     *
     * Failures PROPAGATE. An empty history and a failed read mean opposite things,
     * and the caller already surfaces the error.
     */
    suspend fun getTyreHistory(id: String): List<TyreHistoryEvent> {
        val row = tyreApi.getTyreRow(id = "eq.$id").firstOrNull()
            ?: throw NoSuchElementException("No tyre record with id $id")

        val serial = row.serialKey()?.let { TyreHistoryDto.sanitizeSerial(it) }?.takeIf { it.isNotBlank() }
            ?: return row.toHistoryEvents().sortedNewestFirst()

        return tyreApi
            .getTyreHistoryBySerial(or = TyreHistoryDto.serialOrFilter(serial))
            .flatMap { it.toHistoryEvents() }
            .sortedNewestFirst()
    }

    /**
     * The removal reasons actually recorded, most-used first.
     *
     * WHAT THIS REPLACED, AND WHY IT MATTERS. The old version called the
     * non-existent `lookup_reasons` endpoint and, on the guaranteed failure,
     * returned four INVENTED reasons - "Worn Out", "Puncture", "Sidewall Damage",
     * "Tread Separation" - as though they were the fleet's configured vocabulary.
     * They looked plausible enough that nobody would question them, and they
     * silently swallowed the error that would have revealed the broken endpoint.
     *
     * There is no reasons table, no enum and no RPC - all three checked live. The
     * honest source is the values already stored in tyre_records.removal_reason,
     * which is what this reads. See `buildRemovalReasons` for the brand
     * contamination in that column and the measured basis for excluding it.
     *
     * THE BRAND CROSS-CHECK IS BEST-EFFORT AND SAYS SO. If the brand list cannot be
     * read, the reasons are returned UNFILTERED rather than not at all: a longer
     * list that includes a few brand names is a smaller failure than an empty picker
     * on a screen a fitter is standing in front of. The reasons read itself is NOT
     * caught - if that fails the caller is told.
     */
    suspend fun getRemovalReasons(): List<RemovalReason> {
        val cells: List<RemovalReasonRow> = tyreApi.getRemovalReasonCells()
        val brands = runCatching {
            tyreApi.getTyreFilterOptions(JsonObject(mapOf("p_country" to JsonNull))).brands
        }.getOrDefault(emptyList())
        return buildRemovalReasons(cells, brands)
    }

    /**
     * Record a tyre replacement.
     *
     * THERE IS NO `replacements` TABLE. A replacement is the pair of writes that
     * ends one fitment episode and begins the next, both on tyre_records - the same
     * thing the Expo app's TYRE_CHANGE command does. See [TyreReplacementApi].
     *
     * ORDER IS LOAD-BEARING. The outgoing tyre is closed FIRST. A BEFORE trigger,
     * guard_tyre_active_fitment, raises 23505 if a row is written active at an
     * asset+position that already holds an active tyre, so fitting before removing
     * fails on the second write with the first already applied. Doing it in this
     * order means the failure mode is a removal with no fitment, which is visible
     * and repairable, rather than a rejected write nobody can explain.
     *
     * The installed tyre is OPTIONAL. A position can legitimately be emptied without
     * being refilled - the request models that as a null installedTyreId - and in
     * that case only the removal is written. Inventing a fitment to make the pair
     * symmetric would put a tyre on a wheel that has none.
     *
     * Returns the request stamped with what was actually written: the new row's id
     * where one was created, and a status of INSTALLED or READY_FOR_INSTALLATION
     * reflecting the writes that succeeded - never a status the server did not earn.
     */
    suspend fun submitReplacementRequest(request: TyreReplacementRequest): TyreReplacementRequest {
        require(request.removedTyreId.isNotBlank()) {
            "A replacement needs the tyre being removed."
        }

        val today = LocalDate.now().toString()

        // 1. Close the outgoing episode. Must complete before anything is fitted.
        val closed = tyreReplacementApi.closeFitment(
            id = "eq.${request.removedTyreId}",
            patch = JsonObject(
                buildMap<String, JsonElement> {
                    put("status", JsonPrimitive(STATUS_REMOVED))
                    put("removal_date", JsonPrimitive(today))
                    put("km_at_removal", JsonPrimitive(request.removalKm))
                    request.removalHourMeter?.let { put("hrs_at_removal", JsonPrimitive(it)) }
                    request.removalReason.takeIf { it.isNotBlank() }
                        ?.let { put("removal_reason", JsonPrimitive(it)) }
                    request.removalTreadDepth?.let { put("tread_depth", JsonPrimitive(it)) }
                    request.remarks?.takeIf { it.isNotBlank() }
                        ?.let { put("remarks", JsonPrimitive(it)) }
                }
            ),
        ).firstOrNull()
            ?: throw NoSuchElementException(
                "The tyre being removed (${request.removedTyreId}) was not updated - " +
                    "no such record, or it is not visible to this user."
            )

        // Nothing to fit: the position is being emptied, which is a real outcome.
        val installedTyreId = request.installedTyreId?.takeIf { it.isNotBlank() }
            ?: return request.copy(status = ReplacementStatus.READY_FOR_INSTALLATION)

        // 2. Open the incoming episode, carrying forward the asset and position the
        //    outgoing tyre actually occupied, as the server recorded them - the
        //    table's BEFORE triggers normalise asset number and site on the way in,
        //    so the row we just read back is more trustworthy than what we sent.
        val fitted = tyreReplacementApi.openFitment(
            row = JsonObject(
                buildMap<String, JsonElement> {
                    put("status", JsonPrimitive(STATUS_ACTIVE))
                    put("fitment_date", JsonPrimitive(today))
                    // `issue_date` is the column most of this database's reporting
                    // groups by; the Expo app writes both to the same day for the
                    // same reason.
                    put("issue_date", JsonPrimitive(today))
                    put("qty", JsonPrimitive(1))
                    closed.assetKey()?.let { put("asset_no", JsonPrimitive(it)) }
                    closed.positionKey()?.let {
                        put("position", JsonPrimitive(it))
                        put("tyre_position", JsonPrimitive(it))
                    }
                    closed.site?.let { put("site", JsonPrimitive(it)) }
                    closed.country?.let { put("country", JsonPrimitive(it)) }
                    request.installationKm?.let { put("km_at_fitment", JsonPrimitive(it)) }
                    // The serial of the tyre going on. It is written to all three
                    // serial columns because no single one is complete and every
                    // reader matches across them - writing one alone makes the new
                    // fitment invisible to the other two lookups.
                    installedSerial(installedTyreId)?.let {
                        put("serial_no", JsonPrimitive(it))
                        put("serial_number", JsonPrimitive(it))
                        put("tyre_serial", JsonPrimitive(it))
                    }
                }
            ),
        ).firstOrNull()
            ?: throw IllegalStateException(
                "The outgoing tyre was removed, but the replacement was not recorded. " +
                    "The position is now empty - fit the new tyre again to complete it."
            )

        return request.copy(
            id = fitted.id,
            status = ReplacementStatus.INSTALLED,
            installationKm = fitted.kmAtFitment?.toLong() ?: request.installationKm,
        )
    }

    /**
     * Resolve the serial of the tyre being fitted.
     *
     * The caller passes a tyre_records row id when it picked from the available
     * pool, and can pass a bare serial when it was scanned or typed. A value that
     * parses as a uuid is treated as an id and looked up; anything else is taken as
     * the serial itself.
     *
     * Returns null when the id resolves to no row, in which case the fitment is
     * written WITHOUT a serial rather than with a fabricated one - an unidentified
     * tyre on a wheel is a data gap, an invented serial is a wrong fact.
     */
    private suspend fun installedSerial(installedTyreId: String): String? {
        val looksLikeId = UUID_SHAPE.matches(installedTyreId)
        if (!looksLikeId) {
            return TyreHistoryDto.sanitizeSerial(installedTyreId).takeIf { it.isNotBlank() }
        }
        return tyreApi.getTyreRow(id = "eq.$installedTyreId")
            .firstOrNull()
            ?.serialKey()
            ?.let { TyreHistoryDto.sanitizeSerial(it) }
            ?.takeIf { it.isNotBlank() }
    }

    private fun Tyre.toEntity() = TyreEntity(
        id = id,
        serialNumber = serialNumber,
        brand = brand,
        pattern = pattern ?: "",
        size = size ?: "",
        status = status.name,
        tenantId = tenantId ?: "00000000-0000-0000-0000-000000000001",
        companyId = "",
        countryId = "",
        siteId = site,
        rawData = json.encodeToString(this)
    )

    private companion object {
        /**
         * The status vocabulary this column actually holds. Measured live on
         * 2026-08-23 across all 11,205 rows: Removed 5,748 / Active 5,258 /
         * Scrapped 199, and nothing else. Writing "REMOVED" or the enum name would
         * introduce a fourth spelling that every existing reader misses.
         */
        const val STATUS_REMOVED = "Removed"
        const val STATUS_ACTIVE = "Active"

        val UUID_SHAPE = Regex(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        )
    }
}
