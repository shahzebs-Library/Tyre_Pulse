package com.example.tyre_pulse_app.core.network.di

import com.example.tyre_pulse_app.core.network.AuthInterceptor
import com.example.tyre_pulse_app.core.network.api.*
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        encodeDefaults = true
    }

    @Provides
    @Singleton
    fun provideLoggingInterceptor(): HttpLoggingInterceptor =
        HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

    @Provides
    @Singleton
    fun provideOkHttpClient(
        loggingInterceptor: HttpLoggingInterceptor,
        authInterceptor: AuthInterceptor
    ): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(loggingInterceptor)
        .addInterceptor(authInterceptor)
        .build()

    @Provides
    @Singleton
    fun provideRetrofit(
        okHttpClient: OkHttpClient,
        json: Json
    ): Retrofit = Retrofit.Builder()
        .baseUrl(NetworkConfig.BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    @Provides
    @Singleton
    fun provideAuthApi(okHttpClient: OkHttpClient, json: Json): AuthApi {
        return Retrofit.Builder()
            .baseUrl(NetworkConfig.SUPABASE_URL)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(AuthApi::class.java)
    }

    @Provides
    @Singleton
    fun provideApprovalApi(retrofit: Retrofit): ApprovalApi = retrofit.create(ApprovalApi::class.java)

    @Provides
    @Singleton
    fun provideAssetApi(retrofit: Retrofit): AssetApi = retrofit.create(AssetApi::class.java)

    @Provides
    @Singleton
    fun provideInspectionApi(retrofit: Retrofit): InspectionApi = retrofit.create(InspectionApi::class.java)

    @Provides
    @Singleton
    fun provideTyreApi(retrofit: Retrofit): TyreApi = retrofit.create(TyreApi::class.java)

    @Provides
    @Singleton
    fun provideTyreReplacementApi(retrofit: Retrofit): TyreReplacementApi = retrofit.create(TyreReplacementApi::class.java)

    @Provides
    @Singleton
    fun provideTaskApi(retrofit: Retrofit): TaskApi = retrofit.create(TaskApi::class.java)

    @Provides
    @Singleton
    fun provideNotificationApi(retrofit: Retrofit): NotificationApi = retrofit.create(NotificationApi::class.java)

    @Provides
    @Singleton
    fun provideWorkshopApi(retrofit: Retrofit): WorkshopApi = retrofit.create(WorkshopApi::class.java)

    @Provides
    @Singleton
    fun provideAccidentApi(retrofit: Retrofit): AccidentApi = retrofit.create(AccidentApi::class.java)

    @Provides
    @Singleton
    fun provideStorageApi(retrofit: Retrofit): StorageApi = retrofit.create(StorageApi::class.java)

    @Provides
    @Singleton
    fun provideGenericApi(retrofit: Retrofit): GenericApi = retrofit.create(GenericApi::class.java)
}
