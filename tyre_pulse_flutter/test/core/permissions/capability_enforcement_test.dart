import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/capabilities.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

/// Pins the honesty rule.
///
/// `src/lib/permissionMatrix.js` declares `view` as `enforced: true`. Grepping
/// every `MIGRATIONS_V*.sql` in this repository returns zero RLS policies that
/// gate on `app_user_can(key, 'view')` - every capability call inside a policy
/// uses create, edit or delete. So the declared flag is wrong, and a Flutter
/// engineer who believes it will treat a module gate as a data boundary.
///
/// If someone later flips `view` to server-enforced here, this test fails and
/// forces them to name the migration that made it true.
void main() {
  group('view is a screen gate, not a data boundary', () {
    test('view is UI-only', () {
      expect(Capability.view.enforcement, CapabilityEnforcement.uiOnly);
      expect(Capability.view.isServerEnforced, isFalse);
      expect(enforcementOf(Capability.view).isServerEnforced, isFalse);
    });

    test(
      'a module decision is a view decision and says it is not a boundary',
      () {
        for (final ModuleKey key in ModuleKey.values) {
          final AccessDecision decision = resolveModuleAccess(
            module: key,
            access: const AccessState(role: UserRole.known(RoleId.admin)),
          );
          expect(decision.capability, Capability.view);
          expect(
            decision.isAuthorisationBoundary,
            isFalse,
            reason: 'an allow on ${key.wireKey} must never be read as '
                'authorisation to fetch the underlying table',
          );
        }
      },
    );

    test('export is enforced nowhere either', () {
      expect(Capability.export.enforcement, CapabilityEnforcement.uiOnly);
      expect(Capability.export.isServerEnforced, isFalse);
    });
  });

  group('the capabilities the server does check', () {
    test('create, edit and delete are additive only', () {
      for (final Capability capability in <Capability>[
        Capability.create,
        Capability.edit,
        Capability.delete,
      ]) {
        expect(
          capability.enforcement,
          CapabilityEnforcement.serverAdditiveOnly,
          reason: '${capability.wireName} changed enforcement',
        );
        expect(capability.isServerEnforced, isTrue);
      }
    });

    test('additive means a revoke of an inherent capability is decoration', () {
      // V238's own header: these policies "can only ADD access to
      // granted/admin users; existing writers are unaffected". Removing a
      // capability a role already holds would need a RESTRICTIVE policy, and
      // none exists.
      expect(
        Capability.edit.enforcement,
        isNot(CapabilityEnforcement.serverNegativeOnly),
      );
      expect(Capability.edit.serverNote, contains('PERMISSIVE'));
    });

    test('approve is enforced only as a refusal', () {
      expect(
        Capability.approve.enforcement,
        CapabilityEnforcement.serverNegativeOnly,
      );
      expect(Capability.approve.isServerEnforced, isTrue);
    });
  });

  group('wire values', () {
    test('every capability has a distinct lowercase wire name', () {
      final Set<String> names = <String>{};
      for (final Capability capability in Capability.values) {
        expect(capability.wireName, capability.wireName.toLowerCase());
        expect(names.add(capability.wireName), isTrue);
        expect(capability.serverNote, isNotEmpty);
      }
      expect(Capability.values, hasLength(6));
    });

    test('parses the six values', () {
      for (final Capability capability in Capability.values) {
        expect(capabilityFromWire(capability.wireName), capability);
        expect(
          capabilityFromWire(capability.wireName.toUpperCase()),
          capability,
        );
      }
    });

    test('an unknown capability is null, NOT a default of view', () {
      // The column defaults to view in the database. Reinterpreting an
      // unreadable row as the most common case is how a stray value silently
      // becomes a permission.
      expect(capabilityFromWire('publish'), isNull);
      expect(capabilityFromWire(''), isNull);
      expect(capabilityFromWire(null), isNull);
    });
  });

  test('the mobile grant namespace is recorded as invisible to the server', () {
    // A mobile grant is written as `mobile:records`. `app_user_can` matches
    // bare web keys such as `tyre_records`, so the two never meet.
    expect(serverCapabilityKeyspaceNote, contains('app_user_can'));
    expect(mobileGrantKeyFor(ModuleKey.records), 'mobile:records');
  });
}
