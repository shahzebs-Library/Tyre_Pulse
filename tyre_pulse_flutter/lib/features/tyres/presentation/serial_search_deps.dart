/// Riverpod wiring for this feature's one concrete dependency.
///
/// Kept separate from `serial_search_controller.dart` so the dependency
/// chain stays ACYCLIC - this file depends only on the repository file and
/// on `supabaseClientProvider`, `serial_search_controller.dart` depends on
/// THIS file, and `serial_search_screen.dart` depends on the controller.
/// Mirrors `core/auth/auth_dependency_providers.dart`, which splits its
/// repository providers out from `AuthController` for the same reason.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/tyres/data/tyre_lookup_repository.dart';

/// Serial lookup and scrap/undo, backed by the one application-wide
/// Supabase client - see `supabaseClientProvider`'s own library comment for
/// why there is exactly one.
final Provider<TyreLookupRepository> tyreLookupRepositoryProvider =
    Provider<TyreLookupRepository>(
      (ref) => SupabaseTyreLookupRepository(ref.watch(supabaseClientProvider)),
    );
