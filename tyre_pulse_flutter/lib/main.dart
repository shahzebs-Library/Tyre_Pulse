import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/config/app_config.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/app_router.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/auth/auth_providers.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_bootstrap.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_slot_store_impl.dart';
import 'package:tyre_pulse/core/storage/staged_secure_store.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/sync/background_sync.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_providers.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_service.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/approvals/'
    'checklist_approvals_screen_registrations.dart';
import 'package:tyre_pulse/features/approvals/'
    'inspection_approvals_screen_registrations.dart';
import 'package:tyre_pulse/features/assets/assets_screen_registrations.dart';
import 'package:tyre_pulse/features/checklists/'
    'checklists_screen_registrations.dart';
import 'package:tyre_pulse/features/home/home_screen_registrations.dart';
import 'package:tyre_pulse/features/inspections/'
    'inspections_screen_registrations.dart';
import 'package:tyre_pulse/features/meter_logs/'
    'meter_logs_screen_registrations.dart';
import 'package:tyre_pulse/features/records/records_screen_registrations.dart';
import 'package:tyre_pulse/features/scanning/'
    'scanning_screen_registrations.dart';
import 'package:tyre_pulse/features/tyres/tyres_screen_registrations.dart';
import 'package:tyre_pulse/features/washing/washing_screen_registrations.dart';
import 'package:tyre_pulse/features/work_orders/'
    'work_orders_screen_registrations.dart';

/// A placeholder for this build's version until a real one is wired in.
///
/// `currentAppVersionProvider`'s own doc comment says this must be overridden
/// "with this build's real version string (e.g. from `package_info_plus`,
/// once added)". Nobody has made that call yet - spec section 64 forbids
/// adding a package "to shorten five lines", and reading the version at
/// runtime without one needs either that package or a build script that keeps
/// a `--dart-define` in step with `pubspec.yaml` by hand. Neither exists yet,
/// so this is a `--dart-define=APP_VERSION=...` compile-time constant,
/// matching exactly how `AppConfig` already reads `APP_ENV` and `SENTRY_DSN`.
///
/// The default, when nobody passes one, is deliberately absurdly HIGH, not
/// low or zero. `app_version.dart`'s gate fails open on an unreadable or
/// unconfigured MINIMUM, but nothing in that file protects against a bad
/// CURRENT version - and `system_config.mobile_min_version` is a real,
/// already-configured key the live React Native app is gated on today. A
/// plausible-looking placeholder like `0.0.0` would compare as older than
/// whatever minimum is already set for that other app and could lock every
/// device that ever reaches the shell out of a build that was never actually
/// below anything. `999.0.0` can never lose that comparison, so an
/// unconfigured build fails open exactly the way a missing minimum does.
const String _fallbackAppVersion =
    String.fromEnvironment('APP_VERSION', defaultValue: '999.0.0');

/// The application-lifetime watcher that asks for an immediate sync pass the
/// moment connectivity returns. Held here, not disposed: it lives exactly as
/// long as the process does, the same as [registerBackgroundSync]'s
/// registration.
final ConnectivitySyncTrigger _connectivitySyncTrigger =
    ConnectivitySyncTrigger();

/// Application entry point.
///
/// Configuration is resolved BEFORE any client is constructed. If it is
/// missing, the app renders a screen that says so. It does not throw, and it
/// does not render nothing: the web application shipped a build with the
/// Supabase environment absent and showed a silent white page, because the
/// client threw at module load before an error boundary existed. That is a
/// recorded incident in this project, and this is the mobile app's answer to
/// it.
///
/// # Bootstrap order, and why it is fixed
///
/// `supabase_bootstrap.dart`'s own library comment prescribes this exactly:
/// "The composition root wires this before `runApp`." `supabaseClientProvider`
/// throws until it has, on purpose - a repository reading it too early is a
/// real ordering bug, and hiding that behind a lazy default would only move
/// the failure somewhere harder to diagnose. So `initializeSupabase` is
/// AWAITED here, before [runApp], even though `auth_controller.dart` flags a
/// real, unresolved risk in doing so: if `Supabase.initialize` itself ever
/// blocks on an unbounded Keystore read, this await would stall before any
/// widget - including the boot screen's own timeout - exists to recover from
/// it. `AuthController` was deliberately built to tolerate the session
/// already being resolved by the time it first reads it, which is what this
/// ordering produces; if a real device ever shows a startup stall here rather
/// than the boot screen, this comment is the first place to revisit.
///
/// [TelemetryService.initialize] is awaited first so a crash during
/// [initializeSupabase] itself is still reportable, and so `FlutterError
/// .onError` / `PlatformDispatcher.instance.onError` are wired as early as
/// this file can manage.
///
/// One [SecureKeyValueStore] instance is built once and reused for both
/// [initializeSupabase]'s `localStorage` and the [secureStoreProvider]
/// override, so the session Supabase persists through and the store every
/// other provider reads are never two different instances of the same file.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final configResult = AppConfig.resolve();
  if (configResult is! AppConfigValid) {
    runApp(
      ProviderScope(
        child: ConfigurationProblemApp(problems: configResult.problems),
      ),
    );
    return;
  }
  final config = configResult.config;

  final SecureKeyValueStore secureStore = StagedSecureStore(
    slots: FlutterSecureSlotStore(),
  );

  final telemetry = TelemetryService();
  await telemetry.initialize(config: config, appVersion: _fallbackAppVersion);
  FlutterError.onError = telemetry.reportFlutterError;
  PlatformDispatcher.instance.onError = telemetry.reportPlatformDispatcherError;

  await initializeSupabase(config: config, localStorage: secureStore);

  await registerBackgroundSync();
  _connectivitySyncTrigger.start();

  runApp(
    ProviderScope(
      overrides: [
        ...authLayerOverrides,
        secureStoreProvider.overrideWithValue(secureStore),
        telemetryReporterProvider.overrideWithValue(telemetry),
        currentAppVersionProvider.overrideWithValue(_fallbackAppVersion),
        // `accessStateProvider`'s own doc says it "must be overridden at the
        // composition root, once the repository that loads them exists" - it
        // already does, as `AuthController` (`auth_controller.dart:403`)
        // builds a real `AccessState` from the signed-in profile and hands it
        // to `workspaceControllerProvider.notifier.adopt(...)`, which is what
        // `workspaceContextProvider` reads. So this is not a stand-in
        // repository, it is deriving from state Phase 2 already produces.
        // `AccessState.signedOut` is the fallback for before sign-in resolves
        // and after sign-out (`workspaceContextProvider` is null in both
        // cases) - the same "reaches nothing" default every screen already
        // renders correctly for a genuinely unauthenticated session.
        accessStateProvider.overrideWith(
          (Ref ref) =>
              ref.watch(workspaceContextProvider)?.effectivePermissions ??
              AccessState.signedOut,
        ),
        // `appDatabaseProvider`'s own library comment prescribes exactly
        // this: the app's ONE real [AppDatabase], opened via
        // [openTyrePulseDatabase] and overridden here at the composition
        // root, never constructed a second time by any feature. Every
        // feature that reads it (inspections' drafts/photo queue,
        // checklists' drafts/history, and both approval flows' offline
        // decision queues) was buildable and independently testable before
        // this override existed - each test substitutes its own in-memory
        // [AppDatabase] - but none of them was reachable end-to-end on a
        // real device until this line landed.
        appDatabaseProvider.overrideWithValue(
          AppDatabase(openTyrePulseDatabase()),
        ),
        // The four Phase 3 features each expose their own screens as a
        // `Map<String, TpScreenBuilder>` and stop there, by design -
        // `screen_registry.dart`'s own comment: importing every feature from
        // the router would invert the dependency this architecture is built
        // on. This is the one place that import is allowed to happen.
        //
        // Phase 5 (inspections) and Phase 6 (checklists, plus both approval
        // flows) each built and independently verified their own screens and
        // their own registration map the same way, but - like
        // `appDatabaseProvider` above - were left unwired here pending this
        // later integration pass; every route id in
        // `checklistApprovalsScreenRegistrations`,
        // `inspectionApprovalsScreenRegistrations`,
        // `checklistsScreenRegistrations` and `inspectionsScreenRegistrations`
        // rendered [TpScreenNotAvailable] until this call joined them.
        //
        // Phase 7 (meter logs and vehicle washing) is wired in the SAME
        // integration pass it was built in, unlike the phases above - see
        // `meterLogsScreenRegistrations` and `washingScreenRegistrations`'s
        // own library comments: both route ids, path templates and shell
        // branches already existed (branch indices 4 and 5 in
        // `shell_tabs.dart`) before this feature's screens were written.
        //
        // Phase 8a (Work Orders) adds two more, in the SAME integration
        // pass, for two different reasons:
        //
        // - `workOrdersScreenRegistrations` registers
        //   [TpRouteId.workOrders] and [TpRouteId.workOrderDetail] - both
        //   already fully wired in `routes.dart`/`app_router.dart`/
        //   `route_access.dart` before this feature's screens were
        //   written, exactly like the Phase 7 pair above.
        // - `homeScreenRegistrations` registers [TpRouteId.home] itself,
        //   which had NO screen at all before this phase (see
        //   `features/home/presentation/home_screen.dart`'s own library
        //   comment for the full reasoning) - without this entry Work
        //   Orders would be reachable only by a cold deep link straight to
        //   `/work-orders`, never from anywhere inside the app, which is
        //   the exact reachability defect this phase's brief named as the
        //   bug the reference app itself already has.
        screenRegistryProvider.overrideWithValue(
          TpScreenRegistry.empty
              .withAll(assetsScreenRegistrations)
              .withAll(tyresScreenRegistrations)
              .withAll(recordsScreenRegistrations)
              .withAll(scanningScreenRegistrations)
              .withAll(inspectionsScreenRegistrations)
              .withAll(checklistsScreenRegistrations)
              .withAll(inspectionApprovalsScreenRegistrations)
              .withAll(checklistApprovalsScreenRegistrations)
              .withAll(meterLogsScreenRegistrations)
              .withAll(washingScreenRegistrations)
              .withAll(homeScreenRegistrations)
              .withAll(workOrdersScreenRegistrations),
        ),
      ],
      child: const TyrePulseApp(),
    ),
  );
}

/// The application shell.
///
/// Everything a screen sees - routing, theme, language and text direction -
/// is installed here and nowhere else. A feature that needs a different theme
/// or a different locale changes the providers this widget watches; it does not
/// wrap itself in a second `MaterialApp`.
class TyrePulseApp extends ConsumerWidget {
  const TyrePulseApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GoRouter router = ref.watch(routerProvider);
    final ThemeMode themeMode = ref.watch(themeModeProvider);

    // Null means follow the device. Flutter then runs
    // `localeResolutionCallback`, so an unsupported device language lands on
    // English rather than on whichever locale happens to be listed first.
    final Locale? locale = ref.watch(localeProvider);

    return MaterialApp.router(
      // Localised so the task switcher shows the app's name in the user's
      // language. A hard-coded title is the one string spec section 51 is
      // easiest to forget.
      onGenerateTitle: (BuildContext context) =>
          AppLocalizations.of(context).appTitle,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: TpTheme.light,
      darkTheme: TpTheme.dark,
      // Light unless the user chose otherwise. Spec section 53: this
      // application is used outdoors and dark is not readable there.
      themeMode: themeMode,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      localeResolutionCallback: (
        Locale? deviceLocale,
        Iterable<Locale> supported,
      ) =>
          TpLocalizations.resolve(deviceLocale, supported),
    );
  }
}

/// Shown when the build was compiled without usable configuration.
///
/// This is a real state with a real explanation, not a spinner. Spec section
/// 58 lists the states that must be distinguishable; "not configured" is one
/// of them. The reader of this screen usually cannot fix it themselves, so it
/// says whose problem it is.
///
/// DELIBERATELY NOT LOCALISED AND DELIBERATELY NOT USING THE DESIGN SYSTEM.
/// This screen renders when configuration is absent, which is upstream of
/// everything - including the localisation delegates and any provider a themed
/// widget might read. It has to be able to render with nothing else working.
class ConfigurationProblemApp extends StatelessWidget {
  const ConfigurationProblemApp({required this.problems, super.key});

  final List<String> problems;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Tyre Pulse',
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text(
                  'This app is not set up correctly',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 12),
                const Text(
                  'This is a problem with how the app was built, not with your '
                  'account or your connection. Sending this screen to your '
                  'administrator is the fastest way to get it fixed.',
                ),
                const SizedBox(height: 20),
                for (final problem in problems)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('- '),
                        Expanded(child: Text(problem)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
