package com.example.tyre_pulse_app.core.network

/**
 * PostgREST requires every column filter value to carry an operator prefix
 * (e.g. `status=eq.Active`, `asset_no=ilike.*TM1*`) - a bare value with no
 * operator (`status=Active`) is rejected with a 400 "failed to parse filter"
 * error. Every *Api call site must build its query values through here so a
 * filter is never sent unprefixed.
 */
object Pg {
    /** Exact match. Null/blank input stays null so an unset filter is omitted. */
    fun eq(value: String?): String? = value?.takeIf { it.isNotBlank() }?.let { "eq.$it" }

    /** Case-insensitive substring match, for free-text search fields. */
    fun ilike(value: String?): String? = value?.takeIf { it.isNotBlank() }?.let { "ilike.*$it*" }

    /** In-list match, e.g. status.in.(Open,In Progress). */
    fun inList(values: Collection<String>?): String? =
        values?.takeIf { it.isNotEmpty() }?.joinToString(",", prefix = "in.(", postfix = ")")

    /** Greater-than-or-equal, for date/number range filters. */
    fun gte(value: String?): String? = value?.takeIf { it.isNotBlank() }?.let { "gte.$it" }

    /** Less-than-or-equal, for date/number range filters. */
    fun lte(value: String?): String? = value?.takeIf { it.isNotBlank() }?.let { "lte.$it" }
}
