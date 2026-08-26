/// Dependency wiring for the global search feature, mirroring the
/// acyclic file layout `features/tyres/presentation/serial_search_deps.dart`
/// already establishes: repository file -> this deps file ->
/// controller file -> screen file, each layer importing only the one
/// below it.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/database/dao/cache_dao.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/search/data/global_search_repository.dart';
import 'package:tyre_pulse/features/tyres/presentation/serial_search_deps.dart';

/// The offline cache accessor.
///
/// No `cacheDaoProvider` exists anywhere else in this codebase yet - this
/// feature is the first one that needs `CacheDao` from OUTSIDE the module
/// that already constructs it inline, so this is a genuinely new provider,
/// not a duplicate of one that was simply missed.
final Provider<CacheDao> cacheDaoProvider = Provider<CacheDao>(
  (ref) => CacheDao(ref.watch(appDatabaseProvider)),
);

/// The composed repository this feature's controller depends on.
///
/// Reuses [tyreLookupRepositoryProvider] (from the tyres feature) and
/// [inspectionRemoteRepositoryProvider] (from the inspections feature)
/// verbatim rather than constructing new instances of either - the same
/// SINGLE tyre-lookup and inspection-remote objects every other consumer
/// of those providers already shares.
final Provider<GlobalSearchRepository> globalSearchRepositoryProvider =
    Provider<GlobalSearchRepository>(
  (ref) => SupabaseGlobalSearchRepository(
    client: ref.watch(supabaseClientProvider),
    cacheDao: ref.watch(cacheDaoProvider),
    tyreLookupRepository: ref.watch(tyreLookupRepositoryProvider),
    inspectionRemoteRepository: ref.watch(inspectionRemoteRepositoryProvider),
  ),
);
