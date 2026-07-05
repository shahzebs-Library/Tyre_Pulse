# TyrePulse Inspector — Native Android (Kotlin)

A native Android field-inspector app built with **Kotlin + Jetpack Compose**,
targeting the new **TyrePulse Go API** (`/api/v1`). This is the **foundation**:
authentication, the API client, navigation, and the first backend-served screen
are in place; inspection capture and offline sync land as those backend modules
are cut over (see `docs/GO_BACKEND_MIGRATION_PLAN.md` and
`docs/ADR/0004-offline-mobile-sync.md`).

> **Relationship to the Expo app:** the existing `mobile/` Expo app remains the
> shipping client. This native app is built in parallel per the owner's request.
> Note `Roadmap_latest.Md` recommends keeping Expo until the Go API + sync
> contract are stable — treat this as a forward-looking foundation.

## Stack
- Kotlin 2.0 · Jetpack Compose (Material 3) · Navigation-Compose
- Ktor client (OkHttp) + kotlinx.serialization — talks to the Go API
- Coroutines/Flow · ViewModel (MVVM) · DataStore (session tokens)
- Lightweight manual DI (`AppContainer`) — swappable for Hilt/Koin later
- Gradle (Kotlin DSL) + version catalog · min SDK 24 · target/compile SDK 35

## Architecture
```
app/src/main/java/com/tyrepulse/inspector/
  TyrePulseApp.kt        Application + AppContainer (manual DI)
  MainActivity.kt        Compose host
  core/config            AppConfig (BuildConfig-fed; no hard-coded secrets)
  core/network           Ktor client, {data,error,meta} envelope, ApiClient, ApiException
  core/auth              Supabase password sign-in, TokenStore (DataStore), AuthRepository
  feature/login          LoginViewModel + LoginScreen
  feature/home           HomeViewModel + HomeScreen  → GET /api/v1/me
  navigation             AppNavGraph (session-aware start destination)
  ui/theme               Compose theme (brand greens)
```

### Auth (Phase A)
Sign-in calls **Supabase Auth** (`/auth/v1/token`) to obtain a JWT, persisted in
DataStore. Authenticated calls go to the **Go API** with `Authorization: Bearer
<jwt>`; the API verifies the token and returns the authoritative profile. As
identity moves fully behind the API, only `core/auth` changes — callers depend
on `AuthRepository`.

## Configure
```bash
cp local.properties.example local.properties
# set tyrepulse.supabaseUrl, tyrepulse.supabaseAnonKey, tyrepulse.apiBaseUrl
```
- `tyrepulse.apiBaseUrl` — the Go API (run `backend/` via `make run` /
  `make docker-up`). From the emulator use `http://10.0.2.2:8080`.
- The anon key is RLS-protected but is config, not a committed constant.

## Build & run
> Requires the **Android SDK** (Android Studio installs it). This repo ships the
> Gradle wrapper but not the SDK.

```bash
# Android Studio: open the android/ folder and Run.
# CLI:
./gradlew :app:assembleDebug      # build the debug APK
./gradlew test                    # JVM unit tests (envelope decoding)
./gradlew installDebug            # install on a connected device/emulator
```

## Status / next
- ✅ Login (Supabase) → session persisted → Home served by `GET /api/v1/me`
- ✅ Envelope/error model mirroring the API; unit tests for decoding
- ⏳ Inspections list + capture (CreateInspection command, ADR 0004)
- ⏳ Offline command queue (SQLite) + idempotent sync
- ⏳ Camera capture + signed-URL uploads (ADR 0003)
- ⏳ DI → Hilt, EncryptedSharedPreferences for tokens, CI build
