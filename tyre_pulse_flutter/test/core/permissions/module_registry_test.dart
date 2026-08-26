import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

/// The expected role default for every module, transcribed from artifact 04
/// section 3, which was itself read out of `MODULES` in
/// `mobile/lib/permissions.ts`.
///
/// This is the in-Dart pin. `module_registry_drift_test.dart` is the other
/// half: it parses the TypeScript source directly, so the two files must agree
/// with each other AND with the phone. Do not "fix" a failure here by editing
/// this table until the drift test agrees with the change.
const Map<ModuleKey, Set<RoleId>> expectedDefaults = <ModuleKey, Set<RoleId>>{
  ModuleKey.inspect: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
    RoleId.tyreMan,
  },
  ModuleKey.scan: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
    RoleId.tyreMan,
    RoleId.mechanic,
    RoleId.electrician,
  },
  ModuleKey.serial: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
    RoleId.tyreMan,
    RoleId.tyreDataCollector,
    RoleId.reporter,
    RoleId.driver,
    RoleId.mechanic,
    RoleId.electrician,
    RoleId.maintenanceSupervisor,
    RoleId.workshopSupervisor,
    RoleId.pmvManager,
    RoleId.workshopAreaManager,
    RoleId.workshopMaintenanceAreaManager,
  },
  ModuleKey.tyreChange: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
  },
  ModuleKey.checklists: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
    RoleId.tyreMan,
    RoleId.mechanic,
    RoleId.electrician,
    RoleId.driver,
    RoleId.maintenanceSupervisor,
    RoleId.workshopSupervisor,
    RoleId.pmvManager,
    RoleId.workshopAreaManager,
    RoleId.workshopMaintenanceAreaManager,
  },
  ModuleKey.meter: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
    RoleId.tyreMan,
    RoleId.reporter,
    RoleId.driver,
    RoleId.mechanic,
    RoleId.electrician,
    RoleId.maintenanceSupervisor,
    RoleId.workshopSupervisor,
    RoleId.pmvManager,
    RoleId.workshopAreaManager,
    RoleId.workshopMaintenanceAreaManager,
  },
  ModuleKey.washing: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
    RoleId.driver,
    RoleId.tyreMan,
  },
  ModuleKey.reportIssue: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.reporter,
    RoleId.driver,
    RoleId.mechanic,
    RoleId.electrician,
    RoleId.maintenanceSupervisor,
    RoleId.workshopSupervisor,
    RoleId.pmvManager,
    RoleId.workshopAreaManager,
    RoleId.workshopMaintenanceAreaManager,
  },
  ModuleKey.repairRequest: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
    RoleId.tyreMan,
    RoleId.reporter,
    RoleId.driver,
    RoleId.mechanic,
    RoleId.electrician,
  },
  ModuleKey.records: <RoleId>{},
  ModuleKey.vehicles: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
    RoleId.tyreMan,
    RoleId.reporter,
    RoleId.driver,
    RoleId.mechanic,
    RoleId.electrician,
    RoleId.maintenanceSupervisor,
    RoleId.workshopSupervisor,
    RoleId.pmvManager,
    RoleId.workshopAreaManager,
    RoleId.workshopMaintenanceAreaManager,
  },
  ModuleKey.history: <RoleId>{},
  ModuleKey.alerts: <RoleId>{RoleId.manager, RoleId.director, RoleId.inspector},
  ModuleKey.calendar: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.tyreMan,
    RoleId.reporter,
    RoleId.maintenanceSupervisor,
    RoleId.workshopSupervisor,
    RoleId.pmvManager,
    RoleId.workshopAreaManager,
    RoleId.workshopMaintenanceAreaManager,
  },
  ModuleKey.accidents: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
  },
  ModuleKey.reportAccident: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
  },
  ModuleKey.workorders: <RoleId>{},
  ModuleKey.rca: <RoleId>{RoleId.manager, RoleId.director, RoleId.inspector},
  ModuleKey.tasks: <RoleId>{RoleId.manager, RoleId.director, RoleId.inspector},
  ModuleKey.stock: <RoleId>{RoleId.manager, RoleId.inspector},
  ModuleKey.pm: <RoleId>{RoleId.manager, RoleId.director},
  ModuleKey.workshop: <RoleId>{
    RoleId.manager,
    RoleId.director,
    RoleId.inspector,
    RoleId.tyreMan,
    RoleId.mechanic,
    RoleId.electrician,
  },
  ModuleKey.overview: <RoleId>{},
  ModuleKey.reports: <RoleId>{},
  ModuleKey.analytics: <RoleId>{},
  ModuleKey.stockManage: <RoleId>{},
  ModuleKey.ai: <RoleId>{},
  ModuleKey.team: <RoleId>{},
  ModuleKey.approvals: <RoleId>{
    RoleId.director,
    RoleId.maintenanceSupervisor,
    RoleId.workshopSupervisor,
    RoleId.pmvManager,
    RoleId.workshopAreaManager,
    RoleId.workshopMaintenanceAreaManager,
    RoleId.tyreDataCollector,
  },
  ModuleKey.admin: <RoleId>{},
  ModuleKey.users: <RoleId>{},
};

/// The eleven modules the TypeScript registry writes as `roles: []`.
/// Artifact 04 section 3.1 lists them.
const Set<ModuleKey> expectedAdminOnly = <ModuleKey>{
  ModuleKey.records,
  ModuleKey.history,
  ModuleKey.workorders,
  ModuleKey.overview,
  ModuleKey.reports,
  ModuleKey.analytics,
  ModuleKey.stockManage,
  ModuleKey.ai,
  ModuleKey.team,
  ModuleKey.admin,
  ModuleKey.users,
};

void main() {
  group('registry shape', () {
    test('carries exactly 31 modules, one per ModuleKey', () {
      expect(ModuleRegistry.all, hasLength(31));
      expect(ModuleKey.values, hasLength(31));

      final Set<ModuleKey> defined = ModuleRegistry.all
          .map((ModuleDef d) => d.key)
          .toSet();
      expect(
        defined,
        hasLength(ModuleRegistry.all.length),
        reason: 'a module key is defined twice',
      );
      expect(defined, containsAll(ModuleKey.values));
    });

    test('every ModuleKey resolves to a definition', () {
      for (final ModuleKey key in ModuleKey.values) {
        expect(
          () => ModuleRegistry.definitionFor(key),
          returnsNormally,
          reason:
              'ModuleKey.${key.name} has no ModuleDef. In the TypeScript '
              'app the same gap left MODULE_BY_KEY[key] undefined and denied '
              'the whole fleet at runtime while compiling cleanly.',
        );
      }
    });

    test('the wire key is the enum name, and is unique', () {
      final Set<String> wireKeys = <String>{};
      for (final ModuleKey key in ModuleKey.values) {
        expect(key.wireKey, key.name);
        expect(
          wireKeys.add(key.wireKey),
          isTrue,
          reason: 'duplicate wire key ${key.wireKey}',
        );
      }
    });

    test('every group has at least one module and the counts are stable', () {
      expect(ModuleRegistry.inGroup(ModuleGroup.field), hasLength(9));
      expect(ModuleRegistry.inGroup(ModuleGroup.fleet), hasLength(5));
      expect(ModuleRegistry.inGroup(ModuleGroup.maintenance), hasLength(8));
      expect(ModuleRegistry.inGroup(ModuleGroup.management), hasLength(6));
      expect(ModuleRegistry.inGroup(ModuleGroup.admin), hasLength(3));
    });
  });

  group('role defaults', () {
    test('match the phone registry module for module', () {
      for (final ModuleDef def in ModuleRegistry.all) {
        expect(
          def.defaultRoles,
          expectedDefaults[def.key],
          reason: 'role default drift on ${def.key.wireKey}',
        );
      }
    });

    test('admin is never listed as a default role', () {
      // The TypeScript registry omits admin everywhere because
      // `moduleAllowedByRole` admits it unconditionally. Listing it here would
      // put the break-glass in two places, and the resolver is the one place
      // it belongs.
      for (final ModuleDef def in ModuleRegistry.all) {
        expect(
          def.defaultRoles.contains(RoleId.admin),
          isFalse,
          reason: '${def.key.wireKey} lists admin explicitly',
        );
      }
    });
  });

  group('admin-only is stated, not implied', () {
    test('exactly the eleven bulk-listing and administration modules', () {
      final Set<ModuleKey> adminOnly = ModuleRegistry.all
          .where((ModuleDef d) => d.isAdminOnly)
          .map((ModuleDef d) => d.key)
          .toSet();
      expect(adminOnly, expectedAdminOnly);
    });

    test('an admin-only module carries no role list at all', () {
      for (final ModuleDef def in ModuleRegistry.all) {
        if (def.isAdminOnly) {
          expect(def.defaultRoles, isEmpty);
        }
      }
    });

    test('a module with a role default is never empty', () {
      // An empty list on a non-admin-only module would read as an oversight,
      // which is exactly the ambiguity `roles: []` created in the TypeScript
      // registry.
      for (final ModuleDef def in ModuleRegistry.all) {
        if (!def.isAdminOnly) {
          expect(
            def.defaultRoles,
            isNotEmpty,
            reason: '${def.key.wireKey} has neither roles nor adminOnly',
          );
        }
      }
    });

    test('no role reaches an admin-only module by role default', () {
      for (final ModuleKey key in expectedAdminOnly) {
        final ModuleDef def = ModuleRegistry.definitionFor(key);
        for (final RoleId role in RoleId.values) {
          expect(
            def.allowsByRoleDefault(UserRole.known(role)),
            isFalse,
            reason: '${role.token} reaches ${key.wireKey} by role default',
          );
        }
      }
    });
  });

  group('sensitive modules', () {
    test('are exactly admin, users and approvals', () {
      expect(ModuleRegistry.sensitive, <ModuleKey>{
        ModuleKey.admin,
        ModuleKey.users,
        ModuleKey.approvals,
      });
    });

    test('isSensitive agrees with the set', () {
      for (final ModuleKey key in ModuleKey.values) {
        expect(
          ModuleRegistry.isSensitive(key),
          ModuleRegistry.sensitive.contains(key),
        );
      }
    });
  });

  group('grant key namespace', () {
    test('round trips through the mobile prefix', () {
      for (final ModuleKey key in ModuleKey.values) {
        final String stored = mobileGrantKeyFor(key);
        expect(stored, 'mobile:${key.wireKey}');
        expect(moduleKeyFromMobileGrantKey(stored), key);
      }
    });

    test('a bare web key is not a mobile key', () {
      // The web Access Manager used to write `mobile:<webKey>`, which the phone
      // never reads. A stale `mobile:inspections` row proved it: the phone's
      // key is `inspect`.
      expect(moduleKeyFromMobileGrantKey('records'), isNull);
      expect(moduleKeyFromMobileGrantKey('tyre_records'), isNull);
      expect(moduleKeyFromMobileGrantKey('mobile:tyre_records'), isNull);
      expect(moduleKeyFromMobileGrantKey('mobile:inspections'), isNull);
    });

    test('an unknown module key is dropped, never guessed', () {
      expect(moduleKeyFromMobileGrantKey('mobile:'), isNull);
      expect(moduleKeyFromMobileGrantKey('mobile:nonsense'), isNull);
      expect(moduleKeyFromWireKey('nonsense'), isNull);
    });

    test('the definition exposes the same stored key', () {
      final ModuleDef def = ModuleRegistry.definitionFor(ModuleKey.approvals);
      expect(def.grantKey, 'mobile:approvals');
      expect(def.labelKey, 'modules.approvals.label');
      expect(def.defaultLabel, 'Approvals');
    });
  });
}
