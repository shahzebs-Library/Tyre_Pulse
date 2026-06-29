package com.tyrepulse.inspector

import android.app.Application
import com.tyrepulse.inspector.core.auth.AuthRepository
import com.tyrepulse.inspector.core.auth.SupabaseAuthApi
import com.tyrepulse.inspector.core.auth.TokenStore
import com.tyrepulse.inspector.core.network.ApiClient
import com.tyrepulse.inspector.core.network.HttpClientFactory
import io.ktor.client.HttpClient

/**
 * Lightweight manual dependency container. Kept framework-free for a robust,
 * easy-to-follow foundation; it can be replaced with Hilt/Koin later without
 * changing call sites (ViewModels read from `app.container`).
 */
class AppContainer(app: Application) {
    val httpClient: HttpClient by lazy { HttpClientFactory.create() }
    val tokenStore: TokenStore by lazy { TokenStore(app.applicationContext) }
    val authApi: SupabaseAuthApi by lazy { SupabaseAuthApi(httpClient) }
    val authRepository: AuthRepository by lazy { AuthRepository(authApi, tokenStore) }
    val apiClient: ApiClient by lazy { ApiClient(httpClient, tokenStore) }
}

class TyrePulseApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
