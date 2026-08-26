/// Riverpod wiring for the tyre records register.
///
/// The one provider a test needs to override to replace the real Supabase
/// repository with a fake: `tyreRecordsRepositoryProvider.overrideWithValue
/// (FakeTyreRecordsRepository(...))`. Unlike `accessStateProvider` or
/// `workspaceDependenciesProvider` (`core/permissions/permission_providers
/// .dart`, `core/workspace/workspace_providers.dart`), this does not throw
/// until overridden: [SupabaseTyreRecordsRepository] needs nothing beyond
/// the application's single [SupabaseClient], which is itself always
/// constructible once `initializeSupabase` has run - there is no
/// runtime-loaded state (a signed-in profile, a resolved access state) this
/// provider has to wait for.
///
/// `tyreRecordsListControllerProvider` is declared alongside
/// [TyreRecordsListController] itself in
/// `presentation/controllers/tyre_records_list_controller.dart`, matching
/// how `workspaceControllerProvider` sits beside `WorkspaceController` in
/// `core/workspace/workspace_providers.dart` rather than in a separate file.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/records/data/tyre_records_repository.dart';

final Provider<TyreRecordsRepository> tyreRecordsRepositoryProvider =
    Provider<TyreRecordsRepository>(
  (ref) => SupabaseTyreRecordsRepository(ref.watch(supabaseClientProvider)),
);
