package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.database.dao.SyncDao
import com.example.tyre_pulse_app.core.database.model.SyncOperationEntity
import com.example.tyre_pulse_app.core.network.api.GenericApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * One queued write command: which table it lands in, which payload keys survive,
 * and whether it inserts or patches.
 *
 * WHY THESE THREE FACTS LIVE IN ONE PLACE. They used to be three separate `when`
 * blocks - `getTableName`, `isUpdateOperation` and `sanitizePayloadFields` - and
 * they had drifted apart in both directions. `CHECKLIST_SUBMISSION` and
 * `REPORT_ACCIDENT` had a table but no allow-list, so whatever a caller sent went
 * straight to the wire (the exact defect that broke odometer logging with a
 * `photo_url` key). The three PATCH commands had an allow-list of nothing AND no
 * table. A command that is missing from this map is now missing from all three
 * answers at once, which is the only way they can be kept honest.
 */
private data class SyncCommand(
    val table: String,
    /** Only these keys reach the wire. Every one is a real column of [table]. */
    val fields: List<String>,
    /** true = PATCH an existing row, false = INSERT a new one. */
    val update: Boolean = false,
    /** Column used to locate the row for an update. Excluded from the SET body. */
    val matchField: String = "id",
)

/**
 * The ONLY place a table name may appear in the offline queue.
 *
 * Column names come from the DTOs under core/network, which were checked against
 * the live schema, and from the shipped Expo queue (mobile/lib/recordQueue.ts),
 * whose lists carry their own provenance notes. Nothing here is inferred from a
 * command name - guessing a table from a command name is what produced every bug
 * this map replaces.
 */
private val COMMANDS: Map<String, SyncCommand> = mapOf(
    "TYRE_CHANGE" to SyncCommand(
        table = "tyre_records",
        fields = listOf(
            "asset_no", "serial_no", "serial_number", "tyre_serial", "brand", "size",
            "site", "country", "cost_per_tyre", "qty", "position", "tyre_position",
            "km_at_fitment", "km_at_removal", "hrs_at_fitment", "hrs_at_removal",
            "tread_depth", "removal_reason", "removal_date", "fitment_date", "issue_date",
            "status", "risk_level", "category", "photos",
        ),
    ),
    "WORK_ORDER" to SyncCommand(
        table = "work_orders",
        fields = listOf(
            "work_order_no", "asset_no", "tyre_serial", "status", "priority",
            "work_type", "description", "technician_name", "site", "country",
            "opened_at", "labour_cost", "parts_cost", "total_cost", "notes", "created_by",
        ),
    ),
    "RCA" to SyncCommand(
        table = "rca_records",
        fields = listOf(
            "asset_no", "tyre_serial", "brand", "site", "region",
            "failure_date", "km_at_failure", "root_cause", "contributing_factors",
            "photos", "corrective_action_id", "created_by", "country",
        ),
    ),
    "REPORT_ISSUE" to SyncCommand(
        table = "corrective_actions",
        fields = listOf(
            "title", "priority", "site", "region", "description", "assigned_to",
            "status", "root_cause", "asset_no", "tyre_serial", "created_by",
            "country", "due_date", "photos",
        ),
    ),
    // Had a table and no allow-list, so an unlisted key would have gone to the
    // wire. `signatures` and `notes` are real columns since V212 that the Expo
    // queue had to be taught explicitly for the same reason.
    "CHECKLIST_SUBMISSION" to SyncCommand(
        table = "checklist_submissions",
        fields = listOf(
            "id", "template_id", "template_name", "template_version", "country", "site",
            "asset_no", "title", "status", "answers", "photos", "signature_data",
            "printed_name", "score_pct", "score_passed", "approval_status",
            "signatures", "notes",
        ),
    ),
    // Real columns of the two meter tables. `created_by` and `signature` are on
    // both and are listed even though no writer sends them yet: a field that is
    // absent from this list is DROPPED without an error, so the list has to be
    // ahead of the writers rather than behind them.
    "ODOMETER_LOG" to SyncCommand(
        table = "odometer_logs",
        fields = listOf(
            "asset_no", "odometer_km", "reading_date", "source", "site", "country",
            "notes", "photos", "created_by", "signature", "client_uuid",
        ),
    ),
    "ENGINE_HOURS_LOG" to SyncCommand(
        table = "engine_hours_logs",
        fields = listOf(
            "asset_no", "engine_hours", "reading_date", "source", "site", "country",
            "notes", "photos", "created_by", "signature", "client_uuid",
        ),
    ),
    // Had a table and no allow-list. The columns match core/model/Accident.kt,
    // which is what the online path already reads and writes.
    "REPORT_ACCIDENT" to SyncCommand(
        table = "accidents",
        fields = listOf(
            "site", "asset_no", "vehicle_id", "reported_by", "reporter_name",
            "incident_date", "incident_time", "location", "accident_type", "severity",
            "description", "injuries", "injury_count", "third_party_involved",
            "police_report_no", "damage_description", "estimated_damage_cost",
            "photos", "notes", "status", "country", "driver_name",
            "plate_number", "vehicle_type", "current_status", "damage_condition",
            "fault_status", "gcc_liability_ratio", "najm_status", "najm_fault",
            "taqdeer_status", "taqdeer_no", "liable_party", "payer", "responsible_party",
            "insurer", "policy_no", "insurance_claim_no", "claim_status",
            "claim_amount", "claim_approved_amount", "deductible", "recovered_amount",
            "recovery_status", "recovery_source", "recovery_date", "recovery_reference",
            "amount_transfer", "repair_type", "workshop_name", "workshop_location",
            "repair_cost", "expected_release_date", "release_date", "client_uuid",
        ),
    ),
    // THIS LIST WAS WRONG IN A WAY THAT WOULD HAVE LOST THE WHOLE RECORD. It read
    // `asset_no, driver_name, date, status, site`. There is no `driver_name` column
    // on wash_records (the person is `washed_by`) and no `date` column (the day is
    // `wash_date`, and it is the one field a wash record cannot do without). A
    // queued wash would have arrived with no date, no wash type and no photos.
    // Columns below are the union of core/model/WashRecord.kt - what the online
    // path already posts - and the Expo queue's list.
    "WASH_RECORD" to SyncCommand(
        table = "wash_records",
        fields = listOf(
            "asset_no", "vehicle_type", "site", "area", "country", "created_by",
            "washed_by", "wash_date", "wash_time", "wash_type", "bay", "water_liters",
            "cost", "duration_min", "odometer_km", "status", "notes", "photos",
            "client_uuid",
        ),
    ),
    // Real columns of public.tech_activity_events, per core/network/dto/WorkshopEventDto.
    // The previous list named `technician_name` and `timestamp`, neither of which is
    // a column here (they are `user_id` and `at`).
    //
    // `at` IS allowed even though the Expo queue leaves it to the server default.
    // A queued event is recorded at 09:00 and may not sync until 17:00, and the
    // workshop module segments productive against blocked time from these
    // timestamps - stamping the sync time would silently invent eight hours of
    // work. A writer that has the real moment should send it.
    "WORKSHOP_EVENT" to SyncCommand(
        table = "tech_activity_events",
        fields = listOf(
            "user_id", "job_id", "task_id", "asset_no", "event_type", "reason_code",
            "note", "device", "gps_lat", "gps_lng", "site", "country",
            "foreman_confirmed", "confirmed_by", "at", "client_uuid",
        ),
    ),
    // The three PATCH commands. They were recognised as updates but had no table
    // and no allow-list, so they fell through to a lowercase fallback and aimed at
    // "stock_adjust", "work_order_status" and "corrective_action_status" - none of
    // which are tables. Nothing enqueues them yet; they are mapped so that whoever
    // wires an offline status change finds working plumbing rather than a silent
    // failure on sync.
    "STOCK_ADJUST" to SyncCommand(
        table = "stock_records",
        update = true,
        fields = listOf("id", "stock_qty", "stock_status", "updated_by", "updated_at"),
    ),
    "WORK_ORDER_STATUS" to SyncCommand(
        table = "work_orders",
        update = true,
        fields = listOf("id", "status", "started_at", "completed_at"),
    ),
    "CORRECTIVE_ACTION_STATUS" to SyncCommand(
        table = "corrective_actions",
        update = true,
        fields = listOf("id", "status", "closed_at"),
    ),
    // DELIBERATELY ABSENT - CHECKLIST_APPROVAL. The Expo queue patches
    // checklist_submissions directly. This app does not, and must not: an approval
    // here goes through `decide_checklist_approval` / `decide_inspection_approval`
    // (see ApprovalRepository.decide), and those RPCs are where the approver check,
    // the already-decided guard, the checklist rung ladder and the refusal to store
    // an unsigned sign-off actually live - and they derive the approver from the
    // session rather than trusting a client-supplied `approved_by`. A queued blind
    // PATCH would bypass every one of those, and would replay a stale decision over
    // a record somebody else had already decided. Approvals stay online-only: a
    // refusal the approver can read beats a sign-off nobody checked.
    //
    // DELIBERATELY ABSENT - CHECKLIST_ASSIGNMENT_STATUS. There is no
    // `checklist_assignments` table in this backend and no assignment feature in
    // this app; nothing would enqueue it. Adding it would be a command aimed at a
    // table that does not exist, which is the defect this whole map exists to stop.
)

/**
 * The typed offline command queue.
 *
 * A field record is enqueued locally, then drained to PostgREST when there is a
 * connection. The governing rule throughout: a technician who is told their work
 * was saved must not lose it, and a write that cannot land must fail where someone
 * can see it - at submission, not hours later in a background worker.
 */
@Singleton
class SyncRepository @Inject constructor(
    private val syncDao: SyncDao,
    private val genericApi: GenericApi,
    /**
     * Public because [enqueueCommand] is inline+reified and a public inline
     * function may not touch a private member. (`@PublishedApi internal` is the
     * usual idiom; this is a plain public property instead because there is no
     * compiler available here to confirm that annotation's applicability to a
     * constructor property, and the two behave identically.)
     */
    val json: Json,
) {
    /** Only one drain at a time - see [processPendingOperations]. */
    private val drainMutex = Mutex()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    /**
     * Queue one write command.
     *
     * REIFIED ON PURPOSE, AND THIS WAS A TOTAL FAILURE BEFORE. The old signature
     * was `fun <T> enqueueCommand(type: String, payload: T)` with a body of
     * `json.encodeToString(payload as Any)`. `T` was not reified and the cast
     * upcast to `Any`, so kotlinx resolved `serializer<Any>()` - for which there is
     * no builtin, compiled or contextual serializer in the injected `Json` (see
     * NetworkModule: no `serializersModule` is configured). It threw
     * SerializationException at runtime for EVERY non-String payload, the catch
     * turned that into `Result.failure`, and so not one typed record could be
     * queued by any screen. Reifying `T` resolves the serializer at the call site,
     * which is how every other repository in this app already encodes.
     *
     * @return failure when the payload cannot be serialised, when the command is
     *         not one this app can write, or when nothing in the payload matches a
     *         real column. Callers MUST surface a failure rather than navigate away
     *         - the whole point of the queue is that the technician can walk off.
     */
    suspend inline fun <reified T> enqueueCommand(
        type: String,
        payload: T,
        tenantId: String = DEFAULT_TENANT_ID,
        companyId: String = "",
        countryId: String = "",
        siteId: String? = null,
        userId: String = "",
    ): Result<Boolean> {
        val encoded = try {
            // A String payload is already JSON and is passed through untouched.
            if (payload is String) payload else json.encodeToString(payload)
        } catch (e: Exception) {
            return Result.failure(e)
        }
        return enqueueSerialized(type, encoded, tenantId, companyId, countryId, siteId, userId)
    }

    /**
     * Queue a command whose payload is already JSON text.
     *
     * REFUSES rather than queues when the command has no mapping or the payload
     * carries nothing the table can store. Queueing either would produce a row
     * that can never drain, or - worse - an insert of `{}`, which lands as a blank
     * record that reads like real work. Refusing here reports the problem while
     * the person who typed it is still on the screen.
     */
    suspend fun enqueueSerialized(
        type: String,
        jsonPayload: String,
        tenantId: String = DEFAULT_TENANT_ID,
        companyId: String = "",
        countryId: String = "",
        siteId: String? = null,
        userId: String = "",
    ): Result<Boolean> {
        val normalisedType = type.uppercase()
        val command = COMMANDS[normalisedType]
            ?: return Result.failure(
                IllegalArgumentException(
                    "'$type' is not a write this app can queue. Add it to COMMANDS in " +
                        "SyncRepository before enqueuing it."
                )
            )

        return try {
            val sanitized = sanitize(command, jsonPayload)

            if (sanitized.length() == 0) {
                return Result.failure(
                    IllegalArgumentException(
                        "Nothing in this $normalisedType payload is a column of " +
                            "${command.table}, so there is nothing to save."
                    )
                )
            }
            if (command.update && sanitized.optString(command.matchField).isBlank()) {
                return Result.failure(
                    IllegalArgumentException(
                        "A $normalisedType needs '${command.matchField}' to say which " +
                            "${command.table} row it changes."
                    )
                )
            }

            syncDao.enqueue(
                SyncOperationEntity(
                    id = UUID.randomUUID().toString(),
                    operationType = normalisedType,
                    payload = sanitized.toString(),
                    tenantId = tenantId,
                    companyId = companyId,
                    countryId = countryId,
                    siteId = siteId,
                    userId = userId,
                    createdAt = System.currentTimeMillis(),
                    attemptCount = 0,
                    status = STATUS_QUEUED,
                    lastError = null,
                )
            )
            Result.success(true)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Drain everything that is due.
     *
     * SERIALISED BY A MUTEX. Two overlapping drains would each read the same
     * queued rows and post them twice. Today only the periodic worker calls this,
     * but a pull-to-refresh calling it as well is the obvious next change and it
     * must not be able to double-write.
     *
     * The reclaim on the first line is the fix for a whole class of lost work: an
     * item is flipped to SYNCING for the duration of its request, and if the
     * process is killed mid-request - doze, a crash, the user swiping the app away -
     * it stayed SYNCING for ever. It was then invisible to the QUEUED-only drain
     * AND to the pending count, so the record silently ceased to exist as far as
     * the app was concerned. Because the mutex guarantees no other drain is
     * running in this process, anything still SYNCING when a pass STARTS is a
     * leftover from a dead pass, so it is safe to hand back to the queue.
     */
    suspend fun processPendingOperations() {
        drainMutex.withLock {
            syncDao.reclaimStuckSyncing()
            for (op in syncDao.getQueuedOnce()) {
                drainOne(op)
            }
        }
    }

    /**
     * Hand every permanently-failed item back to the queue, attempts reset.
     *
     * Exists so a stuck record has a way out that is not "reinstall the app". An
     * operator action, never automatic: an item reaches FAILED only after the
     * retry budget is spent or the server refused it outright, and retrying that
     * on a timer would just hammer.
     */
    suspend fun retryFailed(): Int = syncDao.requeueFailed()

    /** Everything not yet accepted by the server: queued, in flight or failed. */
    fun getPendingCount(): Flow<Int> = syncDao.getUnsyncedCount()

    private suspend fun drainOne(op: SyncOperationEntity) {
        val command = COMMANDS[op.operationType.uppercase()]
        if (command == null) {
            // Only reachable for a row queued by an older build, since
            // enqueueSerialized now refuses an unmapped command. Retrying cannot
            // help it, so it is parked for a human rather than looped for ever.
            failPermanently(op, "'${op.operationType}' is not a write this app can send.")
            return
        }

        // An empty stored payload would INSERT a blank row that reads as real work.
        // Unreachable from this build - enqueueSerialized refuses one - but a row
        // left by an older build whose allow-list matched none of its payload keys
        // would look exactly like this, and must be parked, not posted.
        if (op.payload.isBlank() || op.payload.trim() == "{}") {
            failPermanently(op, "This ${op.operationType} carries no data to save.")
            return
        }

        syncDao.updateOperation(op.copy(status = STATUS_SYNCING))

        try {
            val response = if (command.update) {
                val body = JSONObject(op.payload)
                val matchValue = body.optString(command.matchField).trim()
                if (matchValue.isEmpty()) {
                    // Deliberately NOT falling back to an insert. The old code did,
                    // and an update with no id would have created a brand new
                    // half-populated work order or task instead of changing one -
                    // an invented record, which is worse than a refusal.
                    failPermanently(
                        op,
                        "This ${op.operationType} does not say which row it changes."
                    )
                    return
                }
                // The match column is the WHERE clause, so it is excluded from the
                // SET body: a PATCH must never rewrite the key it matched on.
                body.remove(command.matchField)
                genericApi.update(
                    command.table,
                    mapOf(command.matchField to "eq.$matchValue"),
                    body.toString().toRequestBody(jsonMediaType),
                )
            } else {
                genericApi.insert(command.table, op.payload.toRequestBody(jsonMediaType))
            }

            if (response.isSuccessful) {
                syncDao.deleteOperation(op)
                return
            }

            // Read ONCE - an okhttp body can only be consumed a single time. The
            // server's own sentence is kept verbatim: PostgREST says which column
            // it did not recognise, and that is the only part worth reading.
            val errorBody = response.errorBody()?.string().orEmpty()
            val message = if (errorBody.isNotBlank()) errorBody else "HTTP ${response.code()}"

            if (isAlreadyWritten(errorBody)) {
                // The row is already there under this record's own idempotency
                // key, so a previous attempt DID land and only its response was
                // lost. That is a success, not a failure.
                syncDao.deleteOperation(op)
                return
            }

            if (isPermanent(response.code())) {
                failPermanently(op, message)
            } else {
                scheduleRetry(op, message)
            }
        } catch (e: Exception) {
            // No response at all: no signal, DNS, a dropped socket. Exactly what an
            // offline queue exists for, so it retries.
            scheduleRetry(op, e.message ?: "Unknown local error")
        }
    }

    /**
     * Retry until the budget is spent, then park it.
     *
     * ATTEMPTCOUNT IS NOW READ, NOT JUST WRITTEN. It was incremented on every
     * failure and consulted nowhere, and the drain only ever selected QUEUED rows -
     * so an item that failed once became FAILED and was never looked at again. One
     * lost signal permanently stranded a record on the device, which is the single
     * worst thing this queue can do. Staying QUEUED between attempts is what makes
     * a transient failure heal itself; the cap is what stops a genuinely bad
     * payload retrying for ever.
     *
     * The interval between attempts is the drain cadence - the periodic worker's
     * 15 minutes - rather than a stored per-item backoff, because storing one
     * would need a new column on sync_queue, and this database is built with
     * `fallbackToDestructiveMigration()`: a schema bump would DELETE every queued
     * record. See the note in DatabaseModule.
     */
    private suspend fun scheduleRetry(op: SyncOperationEntity, error: String) {
        val attempts = op.attemptCount + 1
        syncDao.updateOperation(
            op.copy(
                status = if (attempts >= MAX_ATTEMPTS) STATUS_FAILED else STATUS_QUEUED,
                attemptCount = attempts,
                lastError = error,
            )
        )
    }

    private suspend fun failPermanently(op: SyncOperationEntity, error: String) {
        syncDao.updateOperation(
            op.copy(
                status = STATUS_FAILED,
                attemptCount = op.attemptCount + 1,
                lastError = error,
            )
        )
    }

    /**
     * Is this refusal worth retrying?
     *
     * A malformed payload or a missing table will read the same on the hundredth
     * attempt as the first, so burning the retry budget on it only delays the
     * moment somebody notices. 401/403 ARE retried: the token can be refreshed and
     * an account can be approved, so an auth refusal genuinely can resolve itself.
     */
    private fun isPermanent(code: Int): Boolean = when (code) {
        401, 403 -> false
        408, 429 -> false
        in 400..499 -> true
        else -> false
    }

    /**
     * True when the server refused this insert because the row is ALREADY there
     * under this record's own idempotency key.
     *
     * Narrow on purpose. A unique violation on any other constraint - a duplicate
     * work_order_no, say - is a real refusal, and reporting it as written would be
     * exactly the silent-success failure this queue must never produce. So the
     * conflict has to name `client_uuid` before it counts as already-written.
     */
    private fun isAlreadyWritten(errorBody: String): Boolean {
        if (errorBody.isBlank()) return false
        return runCatching {
            val error = JSONObject(errorBody)
            if (error.optString("code") != PG_UNIQUE_VIOLATION) return@runCatching false
            val where = error.optString("details") + " " + error.optString("message")
            where.contains(IDEMPOTENCY_KEY)
        }.getOrDefault(false)
    }

    /**
     * Copy across only the keys that are real columns of the target table.
     *
     * EXPLICIT NULLS ARE DROPPED ON INSERT, KEPT ON UPDATE, and the difference
     * matters. The injected Json runs with `encodeDefaults = true` and default
     * `explicitNulls`, so every unset nullable field of a payload is serialised as
     * `"site": null` rather than omitted - and an explicit null SUPPRESSES that
     * column's DEFAULT on insert. On a PATCH the opposite is true: a null is the
     * only way to clear a column, so it has to survive.
     */
    private fun sanitize(command: SyncCommand, rawJson: String): JSONObject {
        val original = JSONObject(rawJson)
        val out = JSONObject()
        for (key in command.fields) {
            if (!original.has(key)) continue
            if (!command.update && original.isNull(key)) continue
            out.put(key, original.get(key))
        }
        return out
    }

    companion object {
        const val DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"

        const val STATUS_QUEUED = "QUEUED"
        const val STATUS_SYNCING = "SYNCING"
        const val STATUS_FAILED = "FAILED"

        /** Mirrors the Expo queue's MAX_RETRIES. */
        const val MAX_ATTEMPTS = 8

        /** Postgres unique_violation, as PostgREST reports it in the error body. */
        private const val PG_UNIQUE_VIOLATION = "23505"

        /** The column a writer sets to make a replayed insert harmless. */
        private const val IDEMPOTENCY_KEY = "client_uuid"
    }
}
