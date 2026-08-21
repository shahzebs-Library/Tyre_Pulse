package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.feature.analytics.model.MobileAnalytics
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import retrofit2.http.Body
import retrofit2.http.POST

@Serializable
data class AnalyticsRpcBody(
    @SerialName("p_country") val pCountry: String? = null,
    @SerialName("p_from") val pFrom: String? = null,
    @SerialName("p_to") val pTo: String? = null,
    @SerialName("p_site") val pSite: String? = null
)

interface AnalyticsApi {
    @POST("rpc/get_mobile_analytics")
    suspend fun getMobileAnalytics(@Body params: AnalyticsRpcBody): MobileAnalytics
}
