import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

/// Module Control: the web console's Live / Maintenance / Off switch per
/// module (`public.modules.status`) must reach the phone, and must fail OPEN.
const UserRole _admin = UserRole.known(RoleId.admin);
const UserRole _manager = UserRole.known(RoleId.manager);

AccessState _state({
  UserRole role = _manager,
  bool isSuperAdmin = false,
  Map<String, Object?>? grantsRaw = const <String, Object?>{},
  Map<String, Object?>? statusRaw,
}) =>
    AccessState.fromRaw(
      role: role,
      isSuperAdmin: isSuperAdmin,
      grantsRaw: grantsRaw,
      roleMatrixRaw: const <String, Object?>{},
      moduleStatusRaw: statusRaw,
    );

AccessDecision _decide(ModuleKey module, AccessState access) =>
    resolveModuleAccess(module: module, access: access);

void main() {
  group('mapping the web status rows to phone modules', () {
    test('disabled and maintenance take a module out of service', () {
      expect(
        switchedOffModulesFromRaw(const <String, Object?>{
          'pm_programs': 'disabled',
          'repair_requests': 'maintenance',
          'accidents': 'live',
          'stock': 'beta',
        }),
        <ModuleKey>{ModuleKey.pm, ModuleKey.repairRequest},
      );
    });

    test('a null, empty, unknown or malformed answer switches nothing off', () {
      expect(switchedOffModulesFromRaw(null), isEmpty);
      expect(switchedOffModulesFromRaw(const <String, Object?>{}), isEmpty);
      expect(
        switchedOffModulesFromRaw(const <String, Object?>{
          // A status this app version does not know: fail open.
          'accidents': 'archived',
          // Not a string: dropped, never coerced.
          'stock': false,
          'alerts': null,
          // A web module with no phone twin.
          'gps_tracking': 'disabled',
          // A phone key is not a web Module Control id.
          'pm': 'disabled',
        }),
        isEmpty,
      );
    });

    test('status text is matched without regard to case or padding', () {
      expect(
        switchedOffModulesFromRaw(const <String, Object?>{
          'pm_programs': ' Disabled ',
        }),
        <ModuleKey>{ModuleKey.pm},
      );
    });

    test('every status key targets a real module, once', () {
      expect(
        webModuleStatusKeys.values.toSet().length,
        webModuleStatusKeys.length,
        reason: 'two web modules must not switch the same phone module',
      );
      for (final MapEntry<String, ModuleKey> alias
          in webModuleKeyAliases.entries) {
        if (alias.key.contains(':')) {
          // A composite key is not a Module Control row.
          expect(webModuleStatusKeys.containsKey(alias.key), isFalse);
        }
      }
    });
  });

  group('the resolver', () {
    const Map<String, Object?> pmOff = <String, Object?>{
      'pm_programs': 'disabled',
    };

    test('a module that is live is decided exactly as before', () {
      final AccessState access = _state(statusRaw: pmOff);
      expect(access.switchedOff, <ModuleKey>{ModuleKey.pm});
      // `serial` is not switched off, so the role default still decides.
      expect(
        _decide(ModuleKey.serial, access).reason,
        AccessReason.roleDefault,
      );
    });

    test('a switched-off module is denied with its own reason', () {
      final AccessDecision decision =
          _decide(ModuleKey.pm, _state(statusRaw: pmOff));
      expect(decision.isAllowed, isFalse);
      expect(decision.reason, AccessReason.moduleSwitchedOff);
      expect(decision.userMessage, isNotEmpty);
    });

    test('Off outranks a per-user grant, as it does on the web', () {
      final AccessDecision decision = _decide(
        ModuleKey.pm,
        _state(
          grantsRaw: const <String, Object?>{'mobile:pm': 'grant'},
          statusRaw: pmOff,
        ),
      );
      expect(decision.reason, AccessReason.moduleSwitchedOff);
    });

    test('an administrator and a super-admin still reach it', () {
      expect(
        _decide(ModuleKey.pm, _state(role: _admin, statusRaw: pmOff)).isAllowed,
        isTrue,
      );
      expect(
        _decide(ModuleKey.pm, _state(isSuperAdmin: true, statusRaw: pmOff))
            .isAllowed,
        isTrue,
      );
      // Under the phone's alternative precedence too.
      expect(
        resolveModuleAccess(
          module: ModuleKey.pm,
          access: _state(role: _admin, statusRaw: pmOff),
          precedence: AdminRevokePrecedence.mobileRevokeBeatsAdmin,
        ).isAllowed,
        isTrue,
      );
    });

    test('a failed status read fails OPEN', () {
      final AccessState access = _state();
      expect(access.switchedOff, isEmpty);
      expect(_decide(ModuleKey.pm, access).isAllowed, isTrue);
    });

    test('the switched-off set takes part in equality', () {
      expect(_state(statusRaw: pmOff) == _state(), isFalse);
      expect(_state(statusRaw: pmOff) == _state(statusRaw: pmOff), isTrue);
    });

    test('the allowed-module set drops a switched-off module', () {
      expect(allowedModulesFor(_state()), contains(ModuleKey.pm));
      expect(
        allowedModulesFor(_state(statusRaw: pmOff)),
        isNot(contains(ModuleKey.pm)),
      );
    });
  });
}
