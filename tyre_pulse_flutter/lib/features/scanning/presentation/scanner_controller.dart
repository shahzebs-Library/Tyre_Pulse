/// The scanning screen's state, and the controller that drives it.
///
/// A thin Riverpod adapter over [resolveScanLookup] - see that function's
/// own doc comment for the resolution rule itself. This file owns only the
/// ASYNC LIFECYCLE (idle -> resolving -> resolved) and where a repository
/// comes from; it contains no lookup logic of its own, so the files under
/// `domain/` stay testable without a [Notifier] or any widget binding at
/// all.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_lookup.dart';

/// Where a signed-in build gets its [ScanLookupSource].
///
/// Typed as the INTERFACE, not [ScanLookupRepository], exactly so a test can
/// override this provider with a hand-written fake and exercise
/// [ScannerController] with no [SupabaseClient] - real or mocked -
/// anywhere in the picture. Mirrors how `workspaceDependenciesProvider` and
/// `authRepositoryProvider` are declared against their own interfaces
/// elsewhere in this project.
final Provider<ScanLookupSource> scanLookupRepositoryProvider =
    Provider<ScanLookupSource>(
  (ref) => ScanLookupRepository(ref.watch(supabaseClientProvider)),
);

/// Where the scanning screen is in its own lifecycle.
sealed class ScannerState {
  const ScannerState();
}

/// Nothing submitted yet.
///
/// The manual-entry surface is always ready in this state; whether a
/// camera preview is ALSO offered is a separate fact this feature keeps in
/// `camera_access.dart`, not carried here - the two states must be able to
/// vary independently, since a build gains camera scanning without this
/// controller changing at all.
final class ScannerIdle extends ScannerState {
  const ScannerIdle();
}

/// A code is in flight.
///
/// The only state in this feature that may show a spinner - see
/// `TpLoadingState`'s own doc comment for why that is a rule, not a
/// preference - and it belongs here because this is work that genuinely
/// ends by itself.
final class ScannerResolving extends ScannerState {
  const ScannerResolving({required this.rawInput});

  final String rawInput;
}

/// [resolveScanLookup] has answered.
///
/// [result] carries which of its four shapes - see `scan_lookup.dart` - the
/// screen renders: a matched asset, a matched tyre, a clean miss, or a
/// failure with its own [AppError] to show and retry.
final class ScannerResolved extends ScannerState {
  const ScannerResolved({required this.result});

  final ScanLookupResult result;
}

/// Drives one scan or manual-entry submission through to a result.
///
/// Deliberately ONE entry point, [submit]. A scanned payload and a typed
/// code both resolve through the exact same call, because a scanner screen
/// with two paths to "resolve this code" is precisely how those two paths
/// quietly drift apart - the class of bug `mobile/lib/scanRouter.ts`, the
/// file this feature was ported from, exists to prevent by being the one
/// place resolution happens at all.
final class ScannerController extends Notifier<ScannerState> {
  late final ScanLookupSource _source;

  @override
  ScannerState build() {
    // `ref.read`, not `ref.watch`: the source is fixed for this controller's
    // lifetime, and reading rather than watching is what keeps this method
    // running exactly once - the same reasoning `AuthController.build()`
    // documents for its own fixed dependencies.
    _source = ref.read(scanLookupRepositoryProvider);
    return const ScannerIdle();
  }

  /// Resolves [raw] - a manually typed code, a pasted code, or (once a
  /// camera package exists) a scanned payload - through the shared chain.
  ///
  /// Never throws: [resolveScanLookup] already turns every failure into a
  /// [ScanLookupFailed] value carried inside [ScannerResolved], so there is
  /// nothing here for a caller to catch.
  Future<void> submit(String raw) async {
    state = ScannerResolving(rawInput: raw);
    final ScanLookupResult result = await resolveScanLookup(raw, _source);
    state = ScannerResolved(result: result);
  }

  /// Returns to [ScannerIdle] - "look up another code" after a result is
  /// shown.
  void reset() {
    state = const ScannerIdle();
  }
}

final NotifierProvider<ScannerController, ScannerState>
    scannerControllerProvider =
    NotifierProvider<ScannerController, ScannerState>(ScannerController.new);
