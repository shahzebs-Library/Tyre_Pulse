/// The one canonical Riverpod handle onto the on-device Drift database.
///
/// Extracted out of `features/inspections/inspections_providers.dart`, which
/// is where this provider was first needed (Phase 5) and where it originally
/// lived as a feature-local declaration. It moved here the moment a SECOND
/// feature (checklists, Phase 6) needed the same database: two features each
/// declaring a top-level `final Provider<AppDatabase> appDatabaseProvider` in
/// their own library is an ambiguous-import compile error the instant a
/// composition file imports both unprefixed, so there must be exactly one
/// declaration and every feature that needs local persistence imports it from
/// here.
///
/// It still THROWS rather than silently constructing a second connection to
/// the on-device SQLite file, for the same reason inspections' original
/// comment gave: draft persistence is a correctness requirement (offline
/// work must not be lost to a process kill), and a feature that quietly
/// disabled it by opening its own throwaway database would be worse than one
/// that refuses to build until it is wired correctly.
///
/// A LATER integration pass overrides this at the composition root
/// (`main.dart`) with the app's one real [AppDatabase] instance, opened via
/// [openTyrePulseDatabase] - as of this file's creation `main.dart` does not
/// yet perform that override, matching every other deferred-to-integration
/// note already recorded elsewhere in this codebase (`background_sync.dart`'s
/// own wiring, `vehicle_fleet_providers.dart`'s precedent). Nothing in any
/// feature that depends on this provider is expected to work end-to-end
/// until that override lands; each feature is still correctly buildable and
/// testable today because a test overrides this provider with an in-memory
/// [AppDatabase] the same way `vehicle_fleet_providers.dart`'s own tests do.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';

/// See the library comment. Override at the composition root.
final Provider<AppDatabase> appDatabaseProvider = Provider<AppDatabase>((ref) {
  throw UnimplementedError(
    'appDatabaseProvider has no value. Override it at the composition '
    'root with the app\'s one AppDatabase instance once main.dart wires '
    'openTyrePulseDatabase() through ProviderScope.overrides.',
  );
});
