package com.example.tyre_pulse_app.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

/**
 * A row of public.pm_programs as PostgREST returns it.
 *
 * Column names read from the live schema, not guessed. Every field is nullable
 * because the table constrains almost none of them.
 */
@Serializable
data class PmProgramDto(
    val id: String? = null,
    val name: String? = null,
    @SerialName("asset_no") val assetNo: String? = null,
    @SerialName("asset_category") val assetCategory: String? = null,
    val site: String? = null,
    val status: String? = null,
    @SerialName("interval_type") val intervalType: String? = null,
    @SerialName("interval_value") val intervalValue: Int? = null,
    @SerialName("meter_source") val meterSource: String? = null,
    @SerialName("meter_interval") val meterInterval: Double? = null,
    @SerialName("next_due") val nextDue: String? = null,
    @SerialName("next_due_meter") val nextDueMeter: Double? = null,
    val priority: String? = null,
    @SerialName("estimated_cost") val estimatedCost: Double? = null,
) {
    companion object {
        /**
         * PostgREST returns only the columns asked for, so this list and the fields
         * above are a PAIR - a field with no column here silently arrives null.
         */
        const val SELECT = "id,name,asset_no,asset_category,site,status,interval_type," +
            "interval_value,meter_source,meter_interval,next_due,next_due_meter," +
            "priority,estimated_cost"
    }
}

/**
 * Arguments for the record_pm_service RPC.
 *
 * Names are the RPC's real parameter names, verified against pg_proc:
 * (p_program_id uuid, p_service_date date, p_meter_reading numeric, p_performed_by text,
 *  p_workshop text, p_site text, p_tasks_done jsonb, p_parts_used jsonb,
 *  p_parts_cost numeric, p_labour_cost numeric, p_findings text, p_outcome text,
 *  p_work_order_no text, p_notes text)
 *
 * A misspelled parameter is not a compile error - PostgREST simply reports that no
 * matching function was found, at runtime.
 */
@Serializable
data class RecordServiceRequest(
    @SerialName("p_program_id") val programId: String,
    @SerialName("p_service_date") val serviceDate: String,
    @SerialName("p_meter_reading") val meterReading: Double? = null,
    @SerialName("p_performed_by") val performedBy: String? = null,
    @SerialName("p_workshop") val workshop: String? = null,
    @SerialName("p_site") val site: String? = null,
    @SerialName("p_tasks_done") val tasksDone: JsonElement = JsonArray(emptyList()),
    @SerialName("p_parts_used") val partsUsed: JsonElement = JsonArray(emptyList()),
    @SerialName("p_parts_cost") val partsCost: Double? = null,
    @SerialName("p_labour_cost") val labourCost: Double? = null,
    @SerialName("p_findings") val findings: String? = null,
    @SerialName("p_outcome") val outcome: String = "completed",
    @SerialName("p_work_order_no") val workOrderNo: String? = null,
    @SerialName("p_notes") val notes: String? = null,
)

/** The outcomes the Expo app offers, so both apps record the same vocabulary. */
val PM_OUTCOMES = listOf("completed", "partial", "deferred", "failed")

/**
 * Whole days until a programme is due; negative means overdue, null means it carries
 * no due date. Matches the Expo app's rule exactly so the two do not disagree about
 * what is late.
 */
const val PM_DUE_SOON_DAYS = 14
