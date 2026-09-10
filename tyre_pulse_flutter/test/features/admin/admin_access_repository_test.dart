import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/features/admin/data/admin_access_repository.dart';

class _Source implements AdminAccessSource {
  final rows = <MobileAccessGrant>[];
  final operations = <String>[];
  bool failRemove = false;
  @override
  Future<List<MobileAccessGrant>> read(String userId) async => rows.toList();
  @override
  Future<void> set(
    String userId,
    ModuleKey module,
    MobileAccessOverride value,
  ) async {
    operations.add('set:${value.name}');
    rows.removeWhere((g) => g.module == module && g.effect == value);
    rows.add(MobileAccessGrant(value.name, module, value, null));
  }

  @override
  Future<void> remove(String id) async {
    operations.add('remove:$id');
    if (failRemove) throw StateError('Connection lost');
    rows.removeWhere((g) => g.id == id);
  }
}

void main() {
  test('switching deny to allow removes the opposing row', () async {
    final source = _Source()
      ..rows.add(
        const MobileAccessGrant(
          'old-deny',
          ModuleKey.scan,
          MobileAccessOverride.deny,
          null,
        ),
      );
    await AdminAccessRepository(source).change(
      'target',
      ModuleKey.scan,
      MobileAccessOverride.allow,
      superAdmin: true,
    );
    expect(source.operations, ['set:allow', 'remove:old-deny']);
    expect(
      effectiveMobileOverride(source.rows, ModuleKey.scan, DateTime.now()),
      MobileAccessOverride.allow,
    );
  });

  test('partial allow failure retains denial and reports failure', () async {
    final source = _Source()
      ..failRemove = true
      ..rows.add(
        const MobileAccessGrant(
          'old-deny',
          ModuleKey.scan,
          MobileAccessOverride.deny,
          null,
        ),
      );
    await expectLater(
      AdminAccessRepository(source).change(
        'target',
        ModuleKey.scan,
        MobileAccessOverride.allow,
        superAdmin: true,
      ),
      throwsStateError,
    );
    expect(
      effectiveMobileOverride(source.rows, ModuleKey.scan, DateTime.now()),
      MobileAccessOverride.deny,
    );
  });

  test('default clears both rows, removing allow before deny', () async {
    final source = _Source()
      ..rows.addAll([
        const MobileAccessGrant(
          'deny',
          ModuleKey.scan,
          MobileAccessOverride.deny,
          null,
        ),
        const MobileAccessGrant(
          'allow',
          ModuleKey.scan,
          MobileAccessOverride.allow,
          null,
        ),
      ]);
    await AdminAccessRepository(source).change(
      'target',
      ModuleKey.scan,
      MobileAccessOverride.defaultAccess,
      superAdmin: true,
    );
    expect(source.operations, ['remove:allow', 'remove:deny']);
    expect(source.rows, isEmpty);
  });

  test('expired override is not shown as effective', () {
    expect(
      effectiveMobileOverride(
        [
          MobileAccessGrant(
            'expired',
            ModuleKey.scan,
            MobileAccessOverride.deny,
            DateTime(2020),
          ),
        ],
        ModuleKey.scan,
        DateTime(2026),
      ),
      MobileAccessOverride.defaultAccess,
    );
  });

  test('non-superadmin cannot write even with a direct repository call',
      () async {
    final source = _Source();
    await expectLater(
      AdminAccessRepository(source).change(
        'target',
        ModuleKey.scan,
        MobileAccessOverride.allow,
        superAdmin: false,
      ),
      throwsA(anything),
    );
    expect(source.operations, isEmpty);
  });
}
