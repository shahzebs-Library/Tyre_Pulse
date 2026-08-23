package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Tyre
import com.example.tyre_pulse_app.core.network.dto.RemovalReasonRow
import com.example.tyre_pulse_app.core.network.dto.TyreFilterOptionsDto
import com.example.tyre_pulse_app.core.network.dto.TyreHistoryDto
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface TyreApi {

    /**
     * The tyre register.
     *
     * NOTE FOR WHOEVER OWNS THE TYRE LIST / DETAIL SCREENS. Both this and [getTyre]
     * are left as they were, and both have a defect that is NOT fixed here because
     * fixing it properly means changing the [Tyre] domain model, which belongs to
     * those screens:
     *
     *  1. Deserialising straight into [Tyre] cannot survive the live data. `brand`
     *     is declared non-null with no default and is genuinely NULL on 360 of
     *     11,205 rows (3.2%, measured 2026-08-23), so a page containing one of them
     *     throws. `coerceInputValues` does not help - it only rescues properties
     *     that HAVE a default. The fix is a nullable DTO plus a mapper, exactly as
     *     [TyreHistoryDto] does for the same table.
     *  2. The filter parameters take a bare value, but PostgREST needs an operator
     *     (`serial_no=eq.X`, not `serial_no=X`). The repository now supplies the
     *     operator at the call site, so the query is at least valid.
     */
    @GET("tyre_records")
    suspend fun getTyres(
        @Query("serial_no") query: String? = null,
        @Query("status") status: String? = null,
        @Query("brand") brand: String? = null,
        @Query("site") site: String? = null,
        @Query("select") select: String = "*"
    ): List<Tyre>

    /** One tyre. `id` is a PostgREST filter, e.g. "eq.9f3c...". See [getTyres]. */
    @GET("tyre_records")
    suspend fun getTyre(
        @Query("id") id: String,
        @Query("select") select: String = "*"
    ): List<Tyre>

    /**
     * Every fitment episode of one tyre, read from public.tyre_records.
     *
     * REPLACES `@GET("tyre_history")`, whose own source comment said "Verify table
     * name from schema". There is no tyre_history table - see [TyreHistoryDto] for
     * which tables were checked, their live row counts, and why the lifecycle turns
     * out to live in tyre_records itself.
     *
     * Reads into a nullable DTO rather than the domain model, so a row with no
     * brand or no removal date is data rather than a crash.
     *
     * @param or a PostgREST `or=(...)` group matching the serial across all three
     *        serial columns - build it with [TyreHistoryDto.serialOrFilter].
     */
    @GET("tyre_records")
    suspend fun getTyreHistoryBySerial(
        @Query("or") or: String,
        @Query("select") select: String = TyreHistoryDto.SELECT,
        @Query("order") order: String = "fitment_date.desc.nullslast,issue_date.desc.nullslast,id.desc",
        @Query("limit") limit: Int = 100,
    ): List<TyreHistoryDto>

    /**
     * One tyre_records row by primary key, as a nullable DTO.
     *
     * This exists so the history and replacement flows can resolve a row id to its
     * serial WITHOUT going through [getTyre], which deserialises into the
     * crash-prone [Tyre] model described above.
     *
     * @param id a PostgREST filter, e.g. "eq.9f3c...".
     */
    @GET("tyre_records")
    suspend fun getTyreRow(
        @Query("id") id: String,
        @Query("select") select: String = TyreHistoryDto.SELECT,
        @Query("limit") limit: Int = 1,
    ): List<TyreHistoryDto>

    /**
     * Every removal reason recorded, one row per cell.
     *
     * REPLACES `@GET("lookup_reasons")`, which 404s. There is no lookup table, no
     * enum and no RPC for removal reasons - all three were checked live, and the
     * full reasoning plus the brand-contamination problem is documented on
     * [com.example.tyre_pulse_app.core.network.dto.buildRemovalReasons].
     *
     * PostgREST has no DISTINCT for a table read, so this returns the raw cells and
     * the distinct-and-rank happens in [buildRemovalReasons]. The read is narrow -
     * one text column, filtered to non-null - so it is a few thousand short strings,
     * not a table scan pulled onto the device.
     */
    @GET("tyre_records")
    suspend fun getRemovalReasonCells(
        @Query("select") select: String = TyreHistoryDto.SELECT_REASON_ONLY,
        @Query("removal_reason") notNull: String = "not.is.null",
        @Query("limit") limit: Int = 5000,
    ): List<RemovalReasonRow>

    /**
     * Distinct sites and brands for the tyre register.
     *
     * This is an RPC, not a table write: `POST /rest/v1/rpc/get_tyre_filter_options`.
     * Verified against pg_proc - `get_tyre_filter_options(p_country text DEFAULT NULL)`,
     * SECURITY INVOKER, EXECUTE granted to `authenticated` and refused to `anon`.
     * It is the same function the web uses for these two lists.
     *
     * Used here for the BRAND list only, which is what lets the removal-reason
     * suggestions exclude the brand names that have leaked into that column.
     */
    @POST("rpc/get_tyre_filter_options")
    suspend fun getTyreFilterOptions(@Body args: JsonObject): TyreFilterOptionsDto
}
