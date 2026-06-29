package com.tyrepulse.inspector.core.network

import com.tyrepulse.inspector.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logging
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/** Builds the shared Ktor client. JSON is lenient on unknown fields so the
 *  app tolerates additive API changes without breaking. */
object HttpClientFactory {

    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        isLenient = true
    }

    fun create(): HttpClient = HttpClient(OkHttp) {
        expectSuccess = false // we inspect status codes ourselves
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 15_000
            socketTimeoutMillis = 30_000
        }
        if (BuildConfig.DEBUG) {
            install(Logging) { level = LogLevel.INFO }
        }
    }
}
