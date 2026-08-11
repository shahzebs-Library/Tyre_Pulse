# Tyre Pulse Android Architecture

## Overview
The application follows a **Feature-Based Modular Architecture** (currently structured as packages within the main app module, ready for extraction).

## Layers
- **UI Layer**: Jetpack Compose using Material 3. UDF (Unidirectional Data Flow) is enforced using ViewModels and StateFlow.
- **Domain Layer**: Models representing business entities (`Tyre`, `Asset`, `Inspection`, etc.).
- **Data Layer**: 
    - **Remote**: Retrofit for API communication.
    - **Local**: Room for caching and offline drafts.
    - **Preferences**: DataStore for user settings and session tokens.

## Key Components
- **Sync Engine**: A centralized mechanism using WorkManager and a Room-based `sync_queue` to handle offline submissions.
- **Multi-Tenancy**: All data is scoped via `tenantId` and `companyId`. Workspace switching refreshes the repository context.
- **Navigation**: Navigation Compose with deep-link support and state restoration via `SavedStateHandle`.

## Security
- Tokens are stored in DataStore (migration to Android Keystore planned for production).
- Strict permission checks performed both client-side (UI visibility) and server-side (API authority).
- ProGuard rules configured to protect business logic in release builds.
