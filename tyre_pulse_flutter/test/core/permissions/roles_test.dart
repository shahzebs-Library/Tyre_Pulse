import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

void main() {
  group('the two vocabularies', () {
    test('every role round trips from its Title Case database name', () {
      for (final RoleId id in RoleId.values) {
        final UserRole role = UserRole.fromDatabase(id.databaseName);
        expect(role.id, id, reason: '${id.databaseName} did not map');
        expect(role.isKnown, isTrue);
        expect(role.rawValue, id.databaseName);
      }
    });

    test('every role round trips from its lowercase token', () {
      for (final RoleId id in RoleId.values) {
        expect(UserRole.fromDatabase(id.token).id, id);
      }
    });

    test('tokens and database names are unique', () {
      final Set<String> tokens = <String>{};
      final Set<String> names = <String>{};
      for (final RoleId id in RoleId.values) {
        expect(tokens.add(id.token), isTrue, reason: 'duplicate ${id.token}');
        expect(names.add(id.databaseName), isTrue);
      }
      expect(RoleId.values, hasLength(15));
    });

    test('normalisation matches the phone: trim, lowercase, collapse spaces',
        () {
      expect(normaliseRoleToken('  Tyre Man  '), 'tyre_man');
      expect(normaliseRoleToken('TYRE   MAN'), 'tyre_man');
      expect(normaliseRoleToken('tyre_man'), 'tyre_man');
      expect(normaliseRoleToken('PMV Manager'), 'pmv_manager');
      expect(
        normaliseRoleToken('Workshop Maintenance Area Manager'),
        'workshop_maintenance_area_manager',
      );
    });

    test('a padded or oddly cased value still resolves', () {
      expect(UserRole.fromDatabase('  tyre   MAN ').id, RoleId.tyreMan);
      expect(UserRole.fromDatabase('Tyre Data Collector').id,
          RoleId.tyreDataCollector);
    });
  });

  group('an unknown role is never silently a Reporter', () {
    test('an unrecognised name stays unknown and keeps its raw value', () {
      final UserRole role = UserRole.fromDatabase('Chief Tyre Whisperer');

      expect(role.isUnknown, isTrue);
      expect(role.id, isNull);
      // The whole point. The server rewrites an unlisted role to Reporter and
      // the phone coerces an unlisted token to reporter, both silently.
      expect(role.id, isNot(RoleId.reporter));
      expect(role.rawValue, 'Chief Tyre Whisperer');
      expect(role.displayName, 'Chief Tyre Whisperer');
      expect(role.token, isEmpty,
          reason: 'an unknown role has no token; inventing one is the '
              'coercion this model exists to prevent');
    });

    test('every catalogued but unmapped database role is flagged as such', () {
      for (final String name in knownUnmappedDatabaseRoles) {
        final UserRole role = UserRole.fromDatabase(name);
        expect(role.isUnknown, isTrue, reason: '$name unexpectedly mapped');
        expect(role.id, isNot(RoleId.reporter));
        expect(
          role.isRecognisedButUnmapped,
          isTrue,
          reason: '$name should be reported as a configuration gap, not as '
              'corrupt data',
        );
      }
    });

    test('a value nobody has ever seen is NOT reported as a known gap', () {
      final UserRole role = UserRole.fromDatabase('qwertyuiop');
      expect(role.isUnknown, isTrue);
      expect(role.isRecognisedButUnmapped, isFalse);
    });

    test('Tyre Data Collector is mapped - it was the original casualty', () {
      // "Tyre Data Collector ended up with a reporter's permissions on the
      // phone while the server correctly saw tyre_data_collector."
      final UserRole role = UserRole.fromDatabase('Tyre Data Collector');
      expect(role.isKnown, isTrue);
      expect(role.id, RoleId.tyreDataCollector);
    });

    test('the five supervisory roles are all mapped', () {
      expect(supervisorRoles, hasLength(5));
      for (final RoleId id in supervisorRoles) {
        expect(UserRole.fromDatabase(id.databaseName).id, id);
        expect(UserRole.known(id).isSupervisory, isTrue);
      }
    });
  });

  group('an absent role is not an unknown role and not a Reporter', () {
    test('null, empty and whitespace all yield absent', () {
      for (final String? raw in <String?>[null, '', '   ']) {
        final UserRole role = UserRole.fromDatabase(raw);
        expect(role.isAbsent, isTrue, reason: 'raw was <$raw>');
        expect(role.isUnknown, isTrue);
        expect(role.id, isNull);
        expect(role.id, isNot(RoleId.reporter));
      }
    });

    test('absent reports a stated placeholder, never a blank', () {
      expect(UserRole.absent.displayName, isNotEmpty);
      expect(UserRole.absent.isAbsent, isTrue);
      expect(UserRole.absent.isRecognisedButUnmapped, isFalse);
    });

    test('an unknown role with a raw value is not absent', () {
      expect(UserRole.fromDatabase('Store Keeper').isAbsent, isFalse);
    });
  });

  group('administrator test', () {
    test('only the admin role is an administrator', () {
      for (final RoleId id in RoleId.values) {
        expect(
          UserRole.known(id).isAdministrator,
          id == RoleId.admin,
          reason: '${id.token} answered the wrong way',
        );
      }
    });

    test('a Manager and a Director are not administrators', () {
      // They are elevated in other senses. They are not admin, and
      // decide_inspection_approval does not admit either of them.
      expect(UserRole.fromDatabase('Manager').isAdministrator, isFalse);
      expect(UserRole.fromDatabase('Director').isAdministrator, isFalse);
      expect(UserRole.fromDatabase('Admin').isAdministrator, isTrue);
    });

    test('an unknown role is never an administrator', () {
      expect(UserRole.fromDatabase('Integration Admin').isAdministrator,
          isFalse);
      expect(UserRole.absent.isAdministrator, isFalse);
    });
  });

  group('value semantics', () {
    test('two roles built the same way are equal', () {
      expect(
        UserRole.fromDatabase('Manager'),
        UserRole.fromDatabase('Manager'),
      );
      expect(
        UserRole.fromDatabase('Manager').hashCode,
        UserRole.fromDatabase('Manager').hashCode,
      );
    });

    test('the same role from different spellings keeps its raw value', () {
      // Equal RoleId, different raw text, so NOT equal as values. That is
      // deliberate: the raw text is evidence about the database.
      final UserRole titleCase = UserRole.fromDatabase('Tyre Man');
      final UserRole token = UserRole.fromDatabase('tyre_man');
      expect(titleCase.id, token.id);
      expect(titleCase, isNot(token));
    });

    test('built-in and custom roles are marked', () {
      expect(RoleId.admin.isBuiltIn, isTrue);
      expect(RoleId.driver.isBuiltIn, isTrue);
      expect(RoleId.mechanic.isBuiltIn, isFalse);
      expect(RoleId.tyreDataCollector.isBuiltIn, isFalse);
    });
  });
}
