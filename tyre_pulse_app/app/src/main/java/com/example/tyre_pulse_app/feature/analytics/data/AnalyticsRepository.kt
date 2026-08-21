package com.example.tyre_pulse_app.feature.analytics.data

import com.example.tyre_pulse_app.core.network.api.AnalyticsApi
import com.example.tyre_pulse_app.core.network.api.AnalyticsRpcBody
import com.example.tyre_pulse_app.feature.analytics.model.MobileAnalytics
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

@Singleton
class AnalyticsRepository @Inject constructor(
    private val analyticsApi: AnalyticsApi
) {
    fun getMobileAnalytics(
        country: String? = null,
        from: String? = null,
        to: String? = null,
        site: String? = null
    ): Flow<MobileAnalytics> = flow {
        val result = analyticsApi.getMobileAnalytics(
            AnalyticsRpcBody(
                pCountry = country,
                pFrom = from,
                pTo = to,
                pSite = site
            )
        )
        emit(result)
    }
}
