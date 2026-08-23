import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

import java.util.Properties
import java.io.FileInputStream

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
}

val localProperties = Properties()
val localPropertiesFile = rootProject.file("local.properties")
if (localPropertiesFile.exists()) {
    localProperties.load(FileInputStream(localPropertiesFile))
}
/**
 * THE PUBLISHABLE KEY, AND WHY IT IS ALLOWED TO BE HERE.
 *
 * This is the Supabase *publishable* key. It is not a secret: it ships inside every
 * APK and inside the deployed web bundle already, and the real boundary is row-level
 * security. It is the last resort only - local.properties wins, then the environment.
 *
 * WHAT WENT WRONG WITHOUT IT. `local.properties` is untracked and CI never wrote one,
 * so `getProperty(..., "MISSING_KEY_PROD")` fell through to that literal and the
 * release APK shipped with `apikey: MISSING_KEY_PROD` on every request. Supabase
 * answered 401 to everything, including login. The build reported SUCCESS and
 * published to Play an app that could not sign anyone in - the exact "silent failure
 * that looks like success" this project keeps having to dig out.
 */
val publishableAnonKey = "sb_publishable_UDEH7EeHA9S5-NNu4T-9Ug_R60IinrW"

/** local.properties -> environment -> publishable default. First non-blank wins. */
fun resolveAnonKey(name: String): String =
    localProperties.getProperty(name)?.takeIf { it.isNotBlank() }
        ?: System.getenv(name)?.takeIf { it.isNotBlank() }
        ?: publishableAnonKey

// Both flavours currently point at the SAME Supabase project (see BASE_URL below), so
// they resolve to the same default. If a separate dev project is ever created, put its
// key in local.properties as SUPABASE_ANON_KEY_DEV rather than changing this default.
val supabaseAnonKeyDev = resolveAnonKey("SUPABASE_ANON_KEY_DEV")
val supabaseAnonKeyProd = resolveAnonKey("SUPABASE_ANON_KEY_PROD")

android {
    namespace = "com.example.tyre_pulse_app"
    compileSdk = 36

    defaultConfig {
        // NOTE: Production app is com.shahzebrahman.tyrepulseinspector (Expo/React Native).
        // This native Kotlin app uses a DIFFERENT ID so both can coexist on the same device.
        applicationId = "com.shahzebrahman.tyrepulse.native"
        minSdk = 26
        targetSdk = 36
        versionCode = 233
        versionName = "2.2.5"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }


    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    flavorDimensions += "environment"
    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            buildConfigField("String", "BASE_URL", "\"https://jhssdmeruxtrlqnwfksc.supabase.co/rest/v1/\"")
            buildConfigField("String", "SUPABASE_URL", "\"https://jhssdmeruxtrlqnwfksc.supabase.co/\"")
            buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKeyDev\"")
        }
        create("prod") {
            dimension = "environment"
            buildConfigField("String", "BASE_URL", "\"https://jhssdmeruxtrlqnwfksc.supabase.co/rest/v1/\"")
            buildConfigField("String", "SUPABASE_URL", "\"https://jhssdmeruxtrlqnwfksc.supabase.co/\"")
            buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKeyProd\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    tasks.withType<KotlinCompile>().configureEach {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

}

/**
 * A release must not be able to ship an unusable key.
 *
 * The previous default was the literal "MISSING_KEY_PROD", which is a perfectly valid
 * String, so the build succeeded and produced an APK that got 401 on every request
 * including login. Nothing failed; it just did not work. This makes that outcome a
 * BUILD failure instead of a field one.
 *
 * Checked on the release bundle/assemble tasks only - a developer without
 * local.properties can still build and run a debug variant.
 *
 * The value is captured in a local val rather than read from the project inside
 * doFirst, so the configuration cache stays valid.
 */
val prodKeyForCheck = supabaseAnonKeyProd
tasks.matching { it.name.startsWith("bundleProd") || it.name.startsWith("assembleProd") }
    .configureEach {
        doFirst {
            val looksReal = prodKeyForCheck.startsWith("sb_publishable_") ||
                prodKeyForCheck.startsWith("eyJ")
            if (!looksReal) {
                throw GradleException(
                    "SUPABASE_ANON_KEY_PROD is not a usable key (got \"$prodKeyForCheck\").\n" +
                        "Every request would return 401, including login, and the build would " +
                        "still have succeeded.\n" +
                        "Set it in tyre_pulse_app/local.properties or as the " +
                        "SUPABASE_ANON_KEY_PROD environment variable."
                )
            }
        }
    }

// Top level on purpose: `ksp` is a PROJECT extension. Nested inside `android {}`
// it only resolved by outer-scope lookup, which is luck rather than intent.
ksp {
    arg("ksp.incremental", "false")
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.security.crypto)
    
    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.hilt.work)
    ksp(libs.hilt.common.compiler)

    // Room
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    implementation(libs.room.paging)
    ksp(libs.room.compiler)

    // Retrofit
    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)

    // Navigation
    implementation(libs.navigation.compose)

    // DataStore
    implementation(libs.datastore.preferences)

    // WorkManager
    implementation(libs.work.runtime.ktx)

    // Serialization
    implementation(libs.kotlinx.serialization.json)

    // Enterprise Utilities
    implementation(libs.paging.runtime)
    implementation(libs.paging.compose)
    implementation(libs.coil.compose)
    implementation(libs.sqlcipher.android)
    implementation(libs.androidx.biometric)

    // CameraX & ML Kit
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.play.services.mlkit.barcode.scanning)
    implementation("com.google.android.gms:play-services-mlkit-text-recognition:19.0.0")
    implementation("com.google.guava:guava:31.1-android")
    implementation("com.google.android.gms:play-services-location:21.0.1")

    // Vico Charts
    implementation(libs.vico.compose)
    implementation(libs.vico.compose.m3)
    implementation(libs.vico.core)


    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.mockk)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
