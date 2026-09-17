/// In-memory stand-ins for the mock M4/M5 workspace tests: a fake
/// [AccidentCaseRows] table store that can pretend a table or column is not
/// provisioned, plus the provider scope both widget tests pump inside.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_rows.dart';
import 'package:tyre_pulse/features/accidents/data/accident_sla_repository.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';

/// A test fixture currency. The app never defaults one; the workspace
/// context is where production gets it from the server.
const String testCurrency = 'AED';

const WorkspaceContext testWorkspace = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  activeCountry: 'UAE',
  currency: testCurrency,
  fullName: 'Signed-in assessor',
);

class FakeAccidentCaseRows implements AccidentCaseRows {
  FakeAccidentCaseRows({
    this.missingTables = const <String>{},
    this.missingColumns = const <String>{},
  });

  final Set<String> missingTables;
  final Set<String> missingColumns;
  final Map<String, List<Map<String, dynamic>>> tables =
      <String, List<Map<String, dynamic>>>{};
  final List<String> uploads = <String>[];
  int _ids = 0;

  List<Map<String, dynamic>> table(String name) =>
      tables.putIfAbsent(name, () => <Map<String, dynamic>>[]);

  void seed(String name, Map<String, dynamic> row) {
    table(name).add(<String, dynamic>{'id': 'seed-${++_ids}', ...row});
  }

  void _checkColumns(Map<String, Object?> row) {
    for (final String key in row.keys) {
      if (missingColumns.contains(key)) {
        throw PostgrestException(
          message: "Could not find the '$key' column",
          code: 'PGRST204',
        );
      }
    }
  }

  @override
  Future<List<Map<String, dynamic>>> select(
    String name,
    Map<String, Object> eq, {
    String orderBy = 'created_at',
    bool ascending = false,
    int limit = 200,
  }) async {
    if (missingTables.contains(name)) {
      throw PostgrestException(
        message: 'relation "public.$name" does not exist',
        code: '42P01',
      );
    }
    return table(name)
        .where(
          (Map<String, dynamic> row) => eq.entries.every(
            (MapEntry<String, Object> e) => row[e.key] == e.value,
          ),
        )
        .toList()
        .reversed
        .take(limit)
        .toList(growable: false);
  }

  @override
  Future<Map<String, dynamic>> insert(
    String name,
    Map<String, Object?> row,
  ) async {
    if (missingTables.contains(name)) {
      throw PostgrestException(
        message: 'relation "public.$name" does not exist',
        code: '42P01',
      );
    }
    _checkColumns(row);
    final Map<String, dynamic> stored = <String, dynamic>{
      'id': 'row-${++_ids}',
      ...row,
    };
    table(name).add(stored);
    return stored;
  }

  @override
  Future<Map<String, dynamic>> update(
    String name,
    String id,
    Map<String, Object?> patch,
  ) async {
    _checkColumns(patch);
    final Map<String, dynamic> row = table(name)
        .firstWhere((Map<String, dynamic> r) => r['id'] == id);
    row.addAll(patch);
    return row;
  }

  @override
  Future<String> uploadEvidence({
    required String localPath,
    required String fileName,
  }) async {
    uploads.add(fileName);
    return 'tp-storage://accident-photos/accidents/user-1/$fileName';
  }

  @override
  String? currentUserId() => 'user-1';
}

Future<void> pumpAccidentWorkspace(
  WidgetTester tester,
  Widget child, {
  required List<Override> overrides,
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        workspaceContextProvider.overrideWithValue(testWorkspace),
        accidentSlaLoadProvider.overrideWith(
          (Ref ref, String id) async =>
              const AccidentSlaLoad(provisioned: true),
        ),
        vehicleDetailProvider.overrideWith(
          (Ref ref, String assetNo) async => const VehicleDetailNotFound(),
        ),
        ...overrides,
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Scrolls [finder] into view inside the test's SingleChildScrollView.
Future<void> reveal(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
}
