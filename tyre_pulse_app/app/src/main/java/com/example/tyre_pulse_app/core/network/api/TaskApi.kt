package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.network.dto.TaskDto
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.Query

/**
 * Tasks, served by public.corrective_actions.
 *
 * WHAT THIS REPLACED. Every endpoint here used to be invented:
 *
 *   @GET("tasks")                    - no `tasks` table exists
 *   @GET("tasks/{id}")               - PostgREST filters by ?id=eq.X, not a path
 *   @PATCH("tasks/{id}/status")      - not a PostgREST path shape at all
 *
 * and the query parameters were camelCase names (`assignedTo`, `pageSize`) sent as
 * bare values, where PostgREST wants snake_case columns carrying an OPERATOR
 * (`assigned_to=eq.Name`) plus `limit` / `offset`. Nothing here could have worked.
 *
 * See [TaskDto] for the evidence that corrective_actions is the backing table.
 */
interface TaskApi {

    /**
     * A page of tasks, newest first.
     *
     * Every parameter that filters is a PostgREST filter STRING, e.g. "eq.Open" -
     * a bare value is rejected. Passing null omits the parameter entirely, which is
     * what makes each filter optional.
     *
     * @param assignedTo filter on a person's NAME, e.g. "eq.Mr. Sarang". The column
     *        holds names, not user ids - see [TaskDto.assignedTo].
     */
    @GET("corrective_actions")
    suspend fun getTasks(
        @Query("select") select: String = TaskDto.SELECT,
        @Query("assigned_to") assignedTo: String? = null,
        @Query("status") status: String? = null,
        @Query("priority") priority: String? = null,
        @Query("site") site: String? = null,
        @Query("order") order: String = "created_at.desc.nullslast,id.desc",
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
    ): List<TaskDto>

    /**
     * One task.
     *
     * Returns a LIST because that is what PostgREST returns for a filtered table
     * read. Asking for a single object needs an `Accept: application/vnd.pgrst.object+json`
     * header, which turns "no such row" into a 406 error rather than an empty
     * result - the caller can tell the difference more cheaply here.
     *
     * @param id a PostgREST filter, e.g. "eq.9f3c...".
     */
    @GET("corrective_actions")
    suspend fun getTask(
        @Query("id") id: String,
        @Query("select") select: String = TaskDto.SELECT,
        @Query("limit") limit: Int = 1,
    ): List<TaskDto>

    /**
     * Update columns on one task.
     *
     * The body is a [JsonObject] rather than a DTO ON PURPOSE. The shared Json is
     * configured with `encodeDefaults = true` and kotlinx emits explicit nulls by
     * default, so serialising a partly-filled DTO would send `"title": null` for
     * every field the caller did not set - which does not mean "leave alone", it
     * means "erase". A JsonObject sends exactly the keys that were put in it.
     *
     * `Prefer: return=representation` makes PostgREST return the updated row, so the
     * caller renders what the database actually stored rather than what it hoped it
     * stored.
     *
     * @param id a PostgREST filter, e.g. "eq.9f3c...".
     */
    @PATCH("corrective_actions")
    suspend fun patchTask(
        @Query("id") id: String,
        @Body patch: JsonObject,
        @Query("select") select: String = TaskDto.SELECT,
        @Header("Prefer") prefer: String = "return=representation",
    ): List<TaskDto>
}
