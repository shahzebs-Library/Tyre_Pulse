package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Accident
import kotlinx.serialization.json.JsonObject
import retrofit2.http.*

/**
 * Accidents, against PostgREST.
 *
 * The Retrofit base URL already ends in `/rest/v1/`, so paths are bare table names
 * and filters are query parameters. `accidents/{id}` and `accidents/{id}/claims`
 * were path segments - PostgREST filters by `?id=eq.X` and has no nested resource
 * routes, so both 404'd.
 *
 * FILTER CONVENTION. A PostgREST filter value carries its own operator, so callers
 * pass `"eq.<value>"`. Passing a bare value silently matches nothing.
 *
 * WRITES RETURN AN ARRAY. `Prefer: return=representation` makes PostgREST echo the
 * affected rows, and it echoes them as a list even for a single row - which is why
 * the write methods return `List<Accident>` rather than `Accident`.
 */
interface AccidentApi {

    /**
     * @param status a PostgREST filter over the LOWERCASE stored vocabulary, e.g.
     *        "eq.repair_in_progress". The column is CHECK-constrained to
     *        reported / under_review / repair_in_progress / awaiting_parts /
     *        awaiting_approval / insurance_claim / released / closed.
     * @param assetNo a PostgREST filter, e.g. "eq.TM514".
     */
    @GET("accidents")
    suspend fun getAccidents(
        @Query("select") select: String = ALL_COLUMNS,
        @Query("status") status: String? = null,
        @Query("asset_no") assetNo: String? = null,
        @Query("order") order: String = "incident_date.desc.nullslast,created_at.desc",
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
    ): List<Accident>

    /**
     * One accident by primary key.
     *
     * Returns a list because PostgREST answers a filtered read with an array even
     * for a unique key. An empty array is a real answer - the row is absent, or RLS
     * hides it - and the caller must distinguish that from a blank record.
     *
     * @param id a PostgREST filter, e.g. "eq.<uuid>".
     */
    @GET("accidents")
    suspend fun getAccidentRow(
        @Query("id") id: String,
        @Query("select") select: String = ALL_COLUMNS,
        @Query("limit") limit: Int = 1,
    ): List<Accident>

    /**
     * File a new accident.
     *
     * The body is a [JsonObject], not the [Accident] model, because the shared Json
     * emits explicit nulls: serialising the model directly sends
     * `"created_at": null`, and that column is NOT NULL with a default - an explicit
     * null does not fall back to the default, it violates the constraint. The
     * repository strips nulls before calling this, so omitted columns take their
     * database defaults.
     */
    @POST("accidents")
    suspend fun reportAccident(
        @Body accident: JsonObject,
        @Query("select") select: String = ALL_COLUMNS,
        @Header("Prefer") prefer: String = "return=representation",
    ): List<Accident>

    /**
     * Update columns on one accident.
     *
     * This is also how a claim is recorded - see AccidentRepository.fileClaim. The
     * body carries only the keys being written, so untouched columns are left
     * alone rather than nulled.
     *
     * @param id a PostgREST filter, e.g. "eq.<uuid>".
     */
    @PATCH("accidents")
    suspend fun patchAccident(
        @Query("id") id: String,
        @Body patch: JsonObject,
        @Query("select") select: String = ALL_COLUMNS,
        @Header("Prefer") prefer: String = "return=representation",
    ): List<Accident>

    companion object {
        /**
         * `accidents` carries ~120 columns and the domain model maps about half of
         * them by @SerialName. Naming them individually would mean a second list to
         * keep in step with the model, and a column dropped from it arrives as a
         * silent null; `*` cannot drift.
         */
        const val ALL_COLUMNS = "*"
    }
}
