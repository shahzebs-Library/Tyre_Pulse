package com.example.tyre_pulse_app.feature.scan.data

import android.net.Uri
import com.example.tyre_pulse_app.core.database.dao.AssetDao
import com.example.tyre_pulse_app.core.database.dao.TyreDao
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.Tyre
import com.example.tyre_pulse_app.core.network.api.AssetApi
import com.example.tyre_pulse_app.core.network.api.TyreApi
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.serialization.json.Json
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ScanResolver @Inject constructor(
    private val assetApi: AssetApi,
    private val tyreApi: TyreApi,
    private val assetDao: AssetDao,
    private val tyreDao: TyreDao,
    private val json: Json
) {
    /**
     * Extracts a code from a raw payload (supporting JSON, URLs, and plain text).
     */
    fun extractScanCode(raw: String): String {
        val s = raw.trim()
        if (s.isEmpty()) return ""

        // JSON payload
        if (s.startsWith("{") && s.endsWith("}")) {
            try {
                val jsonObject = JSONObject(s)
                val keys = listOf("asset_no", "assetNo", "asset", "fleet_number", "fleetNumber", "serial_number", "serial", "code", "id")
                for (key in keys) {
                    if (jsonObject.has(key)) {
                        val value = jsonObject.optString(key)
                        if (value.trim().isNotEmpty()) {
                            return sanitize(value)
                        }
                    }
                }
            } catch (e: Exception) {
                // fall through
            }
        }

        // URL payload
        if (s.startsWith("http://", ignoreCase = true) || s.startsWith("https://", ignoreCase = true) || s.contains("?")) {
            try {
                val uri = Uri.parse(s)
                val qp = uri.getQueryParameter("asset")
                    ?: uri.getQueryParameter("asset_no")
                    ?: uri.getQueryParameter("code")
                    ?: uri.getQueryParameter("serial")
                if (!qp.isNullOrBlank()) {
                    return sanitize(qp)
                }
                val segments = uri.pathSegments
                if (!segments.isNullOrEmpty()) {
                    val last = segments.last()
                    if (last.trim().isNotEmpty()) {
                        return sanitize(last)
                    }
                }
            } catch (e: Exception) {
                // fall through
            }
        }

        return sanitize(s)
    }

    private fun sanitize(code: String): String {
        return code.trim().replace(Regex("[(),]"), "").take(64)
    }

    /**
     * Resolves a raw scan payload by checking local database first, then falling back to remote API.
     */
    suspend fun resolveScan(raw: String, tenantId: String): ScanResolution {
        val code = extractScanCode(raw)
        if (code.isEmpty()) return ScanResolution.None

        // 1) Try Local Asset Lookup
        try {
            val localAssets = assetDao.searchAssets(tenantId, code).firstOrNull()
            if (!localAssets.isNullOrEmpty()) {
                val match = localAssets.firstOrNull {
                    it.assetNumber.equals(code, ignoreCase = true) ||
                            it.plateNumber?.equals(code, ignoreCase = true) == true
                }
                if (match != null) {
                    val asset = json.decodeFromString<Asset>(match.rawData)
                    return ScanResolution.Vehicle(code, raw, asset)
                }
            }
        } catch (e: Exception) {
            // ignore and check next
        }

        // 2) Try Remote Asset Lookup
        try {
            val remoteAssets = assetApi.getAssets(assetNumber = code)
            if (remoteAssets.isNotEmpty()) {
                return ScanResolution.Vehicle(code, raw, remoteAssets.first())
            }
        } catch (e: Exception) {
            // ignore and check next
        }

        // 3) Try Local Tyre Lookup
        try {
            val localTyres = tyreDao.searchTyres(tenantId, code).firstOrNull()
            if (!localTyres.isNullOrEmpty()) {
                val match = localTyres.firstOrNull {
                    it.serialNumber.equals(code, ignoreCase = true)
                }
                if (match != null) {
                    val tyre = json.decodeFromString<Tyre>(match.rawData)
                    return ScanResolution.TyreCode(code, raw, tyre)
                }
            }
        } catch (e: Exception) {
            // ignore and check next
        }

        // 4) Try Remote Tyre Lookup
        try {
            val remoteTyres = tyreApi.getTyres(query = code)
            if (remoteTyres.isNotEmpty()) {
                return ScanResolution.TyreCode(code, raw, remoteTyres.first())
            }
        } catch (e: Exception) {
            // ignore and check next
        }

        return ScanResolution.Unknown(code, raw)
    }
}
