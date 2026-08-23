package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.network.dto.TyreHistoryDto
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * Tyre replacement, expressed against public.tyre_records.
 *
 * WHAT THIS REPLACED. All three endpoints here were invented:
 *
 *   @GET("replacements/reasons")   - no such table, and not a PostgREST path shape
 *   @POST("replacements")          - no `replacements` table exists
 *   @GET("replacements/{id}")      - PostgREST filters by ?id=eq.X, not a path
 *
 * THERE IS NO REPLACEMENT TABLE, and there does not need to be one. A replacement
 * is not a record in its own right in this system - it is the pair of writes that
 * ends one fitment episode and begins the next, both on tyre_records. That is
 * exactly what the shipped Expo app does: mobile/lib/recordQueue.ts maps its
 * TYRE_CHANGE command to an INSERT into `tyre_records` carrying asset_no, position,
 * serial, brand, size, km_at_fitment, fitment_date, removal_reason and the rest.
 * Per AGENTS.md that implementation outranks the current native code.
 *
 * ORDER IS NOT OPTIONAL - CLOSE BEFORE FITTING. A BEFORE trigger,
 * `guard_tyre_active_fitment`, raises SQLSTATE 23505 ("Position %s on asset %s
 * already has an active tyre. Remove or move it first.") when a row is written
 * active at an asset+position that already has an active tyre. So [closeFitment]
 * MUST complete before [openFitment] is called, or the whole replacement fails on
 * the second call with the first already applied. The repository enforces the
 * sequence; this comment is here so nobody reorders it.
 *
 * Removal reasons are NOT here. They come from TyreApi, which reads the values
 * actually recorded - see the note on `buildRemovalReasons`.
 */
interface TyreReplacementApi {

    /**
     * End the outgoing tyre's fitment episode.
     *
     * The body is a [JsonObject] rather than a DTO ON PURPOSE. The shared Json is
     * configured with `encodeDefaults = true` and kotlinx emits explicit nulls by
     * default, so serialising a partly-filled DTO would send `"brand": null` for
     * every field the caller did not set - which does not mean "leave alone", it
     * means "erase". A JsonObject sends exactly the keys that were put in it.
     *
     * @param id a PostgREST filter, e.g. "eq.9f3c...".
     */
    @PATCH("tyre_records")
    suspend fun closeFitment(
        @Query("id") id: String,
        @Body patch: JsonObject,
        @Query("select") select: String = TyreHistoryDto.SELECT,
        @Header("Prefer") prefer: String = "return=representation",
    ): List<TyreHistoryDto>

    /**
     * Begin the incoming tyre's fitment episode.
     *
     * `Prefer: return=representation` makes PostgREST return the created row, so the
     * caller reports what the database actually stored - including the columns its
     * triggers normalise on the way in (asset number, site, brand and removal reason
     * are all rewritten to canonical form by BEFORE triggers on this table).
     *
     * MUST be called only after [closeFitment] has succeeded for the position being
     * refilled - see the interface note on guard_tyre_active_fitment.
     */
    @POST("tyre_records")
    suspend fun openFitment(
        @Body row: JsonObject,
        @Query("select") select: String = TyreHistoryDto.SELECT,
        @Header("Prefer") prefer: String = "return=representation",
    ): List<TyreHistoryDto>

    /**
     * Read back one fitment episode.
     *
     * @param id a PostgREST filter, e.g. "eq.9f3c...".
     */
    @GET("tyre_records")
    suspend fun getFitment(
        @Query("id") id: String,
        @Query("select") select: String = TyreHistoryDto.SELECT,
        @Query("limit") limit: Int = 1,
    ): List<TyreHistoryDto>
}
