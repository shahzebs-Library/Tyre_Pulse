import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/capabilities.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

const UserRole adminRole = UserRole.known(RoleId.admin);
const UserRole managerRole = UserRole.known(RoleId.manager);
const UserRole directorRole = UserRole.known(RoleId.director);
const UserRole reporterRole = UserRole.known(RoleId.reporter);
const UserRole unknownRole = UserRole.unknown('Tire Planning Engineer');

AccessState state({
  UserRole role = managerRole,
  bool isSuperAdmin = false,
  Map<ModuleKey, GrantEffect> grants = const <ModuleKey, GrantEffect>{},
  Map<ModuleKey, bool> matrix = const <ModuleKey, bool>{},
  bool permissionsError = false,
}) => AccessState(
  role: role,
  isSuperAdmin: isSuperAdmin,
  grants: grants,
  roleMatrix: matrix,
  permissionsError: permissionsError,
);

AccessDecision decide(
  ModuleKey module,
  AccessState access, [
  AdminRevokePrecedence precedence = AdminRevokePrecedence.serverAppUserCan,
]) =>
    resolveModuleAccess(module: module, access: access, precedence: precedence);

void main() {
  // `serial` admits manager, director, reporter and nine others by default.
  // `inspect` admits manager, director, inspector and tyre_man only.
  // `approvals` is SENSITIVE and admits director but not manager.
  // `records` is admin-only.

  group('precedence under the server ordering (the default)', () {
    test('a super-admin is never lockable, even by a revoke', () {
      final AccessDecision result = decide(
        ModuleKey.serial,
        state(
          role: reporterRole,
          isSuperAdmin: true,
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.serial: GrantEffect.revoke,
          },
        ),
      );
      expect(result.isAllowed, isTrue);
      expect(result.reason, AccessReason.superAdmin);
    });

    test('the admin ROLE beats a per-user revoke - this is divergence D1', () {
      // The server (`app_user_can`) and the web resolver both test the admin
      // role before any per-user override, so a `mobile:` revoke row on an
      // administrator is inert on the backend. Following the phone here would
      // hide a button the API still accepts a write from.
      final AccessDecision result = decide(
        ModuleKey.records,
        state(
          role: adminRole,
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.records: GrantEffect.revoke,
          },
        ),
      );
      expect(result.isAllowed, isTrue);
      expect(result.reason, AccessReason.adminRole);
    });

    test('a revoke denies everybody who is not an admin or a super-admin', () {
      final AccessDecision result = decide(
        ModuleKey.serial,
        state(
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.serial: GrantEffect.revoke,
          },
        ),
      );
      expect(result.isDenied, isTrue);
      expect(result.reason, AccessReason.perUserRevoke);
    });

    test('a revoke on a module the role already has still denies', () {
      // A manager reaches `serial` by role default, so this proves the revoke
      // outranks the default rather than merely agreeing with it. Note the
      // grant map holds ONE effect per module: where the database carries both
      // a grant and a revoke row, `get_my_access_grants` has already collapsed
      // them in favour of the revoke before the client sees it.
      final AccessState access = state(
        grants: const <ModuleKey, GrantEffect>{
          ModuleKey.serial: GrantEffect.revoke,
        },
      );
      expect(
        decide(ModuleKey.serial, state()).reason,
        AccessReason.roleDefault,
      );
      expect(
        decide(ModuleKey.serial, access).reason,
        AccessReason.perUserRevoke,
      );
    });

    test('a grant opens an admin-only module to one named person', () {
      final AccessDecision result = decide(
        ModuleKey.analytics,
        state(
          role: reporterRole,
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.analytics: GrantEffect.grant,
          },
        ),
      );
      expect(result.isAllowed, isTrue);
      expect(result.reason, AccessReason.perUserGrant);
    });

    test('an explicit matrix true allows, an explicit false denies', () {
      expect(
        decide(
          ModuleKey.inspect,
          state(
            role: reporterRole,
            matrix: const <ModuleKey, bool>{ModuleKey.inspect: true},
          ),
        ).reason,
        AccessReason.roleMatrixEnabled,
      );
      expect(
        decide(
          ModuleKey.serial,
          state(matrix: const <ModuleKey, bool>{ModuleKey.serial: false}),
        ).reason,
        AccessReason.roleMatrixDisabled,
      );
    });

    test('an ABSENT matrix key falls through to the role default', () {
      // Absent means "no override on mobile", not "no".
      expect(
        decide(ModuleKey.serial, state()).reason,
        AccessReason.roleDefault,
      );
    });

    test('a role not on the list is denied, and the reason says which', () {
      final AccessDecision result = decide(
        ModuleKey.inspect,
        state(role: reporterRole),
      );
      expect(result.isDenied, isTrue);
      expect(result.reason, AccessReason.roleNotInDefaults);
    });

    test('an admin-only module reports that, not a generic refusal', () {
      final AccessDecision result = decide(ModuleKey.records, state());
      expect(result.isDenied, isTrue);
      expect(result.reason, AccessReason.adminOnlyModule);
    });
  });

  group('precedence under the phone ordering', () {
    const AdminRevokePrecedence phone =
        AdminRevokePrecedence.mobileRevokeBeatsAdmin;

    test('a revoke denies an admin', () {
      final AccessDecision result = decide(
        ModuleKey.records,
        state(
          role: adminRole,
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.records: GrantEffect.revoke,
          },
        ),
        phone,
      );
      expect(result.isDenied, isTrue);
      expect(result.reason, AccessReason.perUserRevoke);
    });

    test('a super-admin is still unrevokable', () {
      final AccessDecision result = decide(
        ModuleKey.records,
        state(
          role: adminRole,
          isSuperAdmin: true,
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.records: GrantEffect.revoke,
          },
        ),
        phone,
      );
      expect(result.isAllowed, isTrue);
      expect(result.reason, AccessReason.superAdmin);
    });

    test('an admin with no revoke still reaches everything', () {
      for (final ModuleKey key in ModuleKey.values) {
        expect(
          decide(key, state(role: adminRole), phone).isAllowed,
          isTrue,
          reason: 'admin denied ${key.wireKey}',
        );
      }
    });

    test('the two orderings differ ONLY on a revoked admin', () {
      // Sweep every module with a revoke in place, for each role, and assert
      // that the two precedences agree except where the role is admin.
      for (final ModuleKey key in ModuleKey.values) {
        for (final RoleId id in RoleId.values) {
          final AccessState access = state(
            role: UserRole.known(id),
            grants: <ModuleKey, GrantEffect>{key: GrantEffect.revoke},
          );
          final bool server = decide(key, access).isAllowed;
          final bool mobile = decide(key, access, phone).isAllowed;
          if (id == RoleId.admin) {
            expect(server, isTrue);
            expect(mobile, isFalse);
          } else {
            expect(
              server,
              mobile,
              reason:
                  'unexpected divergence for ${id.token} on '
                  '${key.wireKey}',
            );
          }
        }
      }
    });
  });

  group('permission data unavailable', () {
    test('the three administration modules fail CLOSED', () {
      for (final ModuleKey key in ModuleRegistry.sensitive) {
        final AccessDecision result = decide(
          key,
          // A director IS on the approvals default list, so this proves the
          // fail-closed branch outranks the role default rather than merely
          // agreeing with it.
          state(role: directorRole, permissionsError: true),
        );
        expect(result.isDenied, isTrue, reason: '${key.wireKey} failed open');
        expect(result.reason, AccessReason.permissionDataUnavailable);
      }
    });

    test('an ordinary module fails OPEN and keeps the field user working', () {
      final AccessDecision result = decide(
        ModuleKey.serial,
        state(permissionsError: true),
      );
      expect(result.isAllowed, isTrue);
      expect(result.reason, AccessReason.roleDefault);
    });

    test('an explicit grant loaded before the failure still passes', () {
      final AccessDecision result = decide(
        ModuleKey.approvals,
        state(
          role: reporterRole,
          permissionsError: true,
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.approvals: GrantEffect.grant,
          },
        ),
      );
      expect(result.isAllowed, isTrue);
      expect(result.reason, AccessReason.perUserGrant);
    });

    test('the hard admin role still passes', () {
      final AccessDecision result = decide(
        ModuleKey.users,
        state(role: adminRole, permissionsError: true),
      );
      expect(result.isAllowed, isTrue);
      expect(result.reason, AccessReason.adminRole);
    });

    test('a stale role matrix cannot open a sensitive module', () {
      // The matrix is one of the two maps that failed to load, so an entry in
      // it is untrustworthy by definition.
      final AccessDecision result = decide(
        ModuleKey.admin,
        state(
          role: managerRole,
          permissionsError: true,
          matrix: const <ModuleKey, bool>{ModuleKey.admin: true},
        ),
      );
      expect(result.isDenied, isTrue);
      expect(result.reason, AccessReason.permissionDataUnavailable);
    });

    test('a revoke still denies a sensitive module under failure', () {
      final AccessDecision result = decide(
        ModuleKey.approvals,
        state(
          role: directorRole,
          permissionsError: true,
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.approvals: GrantEffect.revoke,
          },
        ),
      );
      expect(result.reason, AccessReason.perUserRevoke);
    });
  });

  group('an unknown role reaches nothing, and says so', () {
    test('every module is denied with the unknownRole reason', () {
      for (final ModuleKey key in ModuleKey.values) {
        final AccessDecision result = decide(key, state(role: unknownRole));
        expect(result.isDenied, isTrue, reason: '${key.wireKey} was allowed');
        expect(result.reason, AccessReason.unknownRole);
      }
    });

    test('an unknown role is NOT quietly given a reporter list', () {
      // A reporter reaches `serial` by default. If the unknown role were
      // coerced, this would pass - which is exactly the defect.
      expect(
        decide(ModuleKey.serial, state(role: reporterRole)).isAllowed,
        isTrue,
      );
      expect(
        decide(ModuleKey.serial, state(role: unknownRole)).isAllowed,
        isFalse,
      );
    });

    test('an absent role reports that it is absent, not unrecognised', () {
      final AccessDecision result = decide(
        ModuleKey.serial,
        state(role: UserRole.absent),
      );
      expect(result.reason, AccessReason.noRoleAssigned);
    });

    test('a super-admin with an unmapped role string still gets in', () {
      // The flag is a column, not a role name. Denying here would lock the
      // platform owner out over a configuration typo.
      final AccessDecision result = decide(
        ModuleKey.admin,
        state(role: unknownRole, isSuperAdmin: true),
      );
      expect(result.isAllowed, isTrue);
    });

    test('an explicit grant still works for an unmapped role', () {
      final AccessDecision result = decide(
        ModuleKey.meter,
        state(
          role: unknownRole,
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.meter: GrantEffect.grant,
          },
        ),
      );
      expect(result.isAllowed, isTrue);
      expect(result.reason, AccessReason.perUserGrant);
    });
  });

  group('a refusal explains itself', () {
    test('every denial carries a sentence and a typed error', () {
      final List<AccessState> scenarios = <AccessState>[
        state(role: reporterRole),
        state(role: unknownRole),
        state(role: UserRole.absent),
        state(permissionsError: true),
        state(
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.serial: GrantEffect.revoke,
          },
        ),
        state(matrix: const <ModuleKey, bool>{ModuleKey.serial: false}),
      ];

      for (final AccessState access in scenarios) {
        for (final ModuleKey key in ModuleKey.values) {
          final AccessDecision result = decide(key, access);
          if (result.isAllowed) {
            expect(result.denialError, isNull);
            continue;
          }
          expect(result.userMessage, isNotEmpty);
          expect(result.userMessage.trim(), result.userMessage);
          final AppError? error = result.denialError;
          expect(error, isNotNull);
          expect(error!.kind, AppErrorKind.authorization);
          expect(error.message, result.userMessage);
          expect(error.isRetryable, isFalse);
        }
      }
    });

    test('a user message never leaks a module key or a table name', () {
      for (final AccessReason reason in AccessReason.values) {
        expect(reason.message, isNotEmpty);
        expect(reason.message.contains('module_permissions'), isFalse);
        expect(reason.message.contains('user_access_grants'), isFalse);
        expect(
          reason.message.contains('_'),
          isFalse,
          reason: '${reason.name} looks like it contains an identifier',
        );
      }
    });

    test('the technical detail names the mechanism, for telemetry only', () {
      final AccessDecision result = decide(
        ModuleKey.records,
        state(role: unknownRole),
      );
      expect(result.technical, contains('module=records'));
      expect(result.technical, contains('reason=unknownRole'));
      expect(result.technical, contains('Tire Planning Engineer'));
    });
  });

  group('module access is not authorisation to fetch', () {
    test('a decision is a view decision, and view is UI-only', () {
      final AccessDecision result = decide(ModuleKey.serial, state());
      expect(result.capability, Capability.view);
      expect(result.capability.enforcement, CapabilityEnforcement.uiOnly);
      expect(result.isAuthorisationBoundary, isFalse);
    });

    test('an ALLOWED decision is still not an authorisation boundary', () {
      // The dangerous reading is "the module is on, therefore the fetch is
      // authorised". No RLS policy gates on the view capability, so an allow
      // here says nothing about what the server will return.
      final AccessDecision result = decide(
        ModuleKey.records,
        state(role: adminRole),
      );
      expect(result.isAllowed, isTrue);
      expect(result.isAuthorisationBoundary, isFalse);
    });

    test('enforcementOf exposes the answer from the resolver', () {
      expect(enforcementOf(Capability.view), CapabilityEnforcement.uiOnly);
      expect(
        enforcementOf(Capability.create),
        CapabilityEnforcement.serverAdditiveOnly,
      );
    });
  });

  group('allowedModulesFor', () {
    test('an admin reaches all 31 modules', () {
      expect(allowedModulesFor(state(role: adminRole)), hasLength(31));
    });

    test('a reporter reaches the six the registry gives them', () {
      expect(allowedModulesFor(state(role: reporterRole)), <ModuleKey>{
        ModuleKey.serial,
        ModuleKey.meter,
        ModuleKey.reportIssue,
        ModuleKey.repairRequest,
        ModuleKey.vehicles,
        ModuleKey.calendar,
      });
    });

    test('a tyre data collector reaches serial and approvals only', () {
      // RECORDED: nine people hold this role, the largest non-Tyre-Man
      // population on the system, and it is a SIGNING role that cannot open a
      // checklist or run an inspection by default. Artifact 04 section 3.3
      // lists this as an open product question, not a bug to fix here.
      expect(
        allowedModulesFor(
          state(role: UserRole.known(RoleId.tyreDataCollector)),
        ),
        <ModuleKey>{ModuleKey.serial, ModuleKey.approvals},
      );
    });

    test('an unknown role reaches nothing', () {
      expect(allowedModulesFor(state(role: unknownRole)), isEmpty);
    });

    test('the signed-out state reaches nothing', () {
      expect(allowedModulesFor(AccessState.signedOut), isEmpty);
    });
  });

  group('AccessState.fromRaw drops what it cannot trust', () {
    test('keeps mobile-prefixed keys and strips the prefix', () {
      final AccessState access = AccessState.fromRaw(
        role: managerRole,
        grantsRaw: const <String, Object?>{
          'mobile:analytics': 'grant',
          'mobile:serial': 'revoke',
        },
        roleMatrixRaw: const <String, Object?>{'mobile:inspect': false},
      );
      expect(access.grants[ModuleKey.analytics], GrantEffect.grant);
      expect(access.grants[ModuleKey.serial], GrantEffect.revoke);
      expect(access.roleMatrix[ModuleKey.inspect], isFalse);
    });

    test('drops web-namespaced keys', () {
      final AccessState access = AccessState.fromRaw(
        role: managerRole,
        grantsRaw: const <String, Object?>{
          'analytics': 'grant',
          'tyre_records': 'grant',
        },
      );
      expect(access.grants, isEmpty);
    });

    test('drops a key this app version does not know', () {
      final AccessState access = AccessState.fromRaw(
        role: managerRole,
        grantsRaw: const <String, Object?>{'mobile:inspections': 'revoke'},
      );
      expect(access.grants, isEmpty);
    });

    test('a grant value must be exactly grant or revoke', () {
      final AccessState access = AccessState.fromRaw(
        role: managerRole,
        grantsRaw: const <String, Object?>{
          'mobile:serial': 'GRANT',
          'mobile:meter': true,
          'mobile:scan': 1,
          'mobile:alerts': null,
        },
      );
      expect(access.grants, isEmpty);
    });

    test('a non-boolean matrix value is DROPPED, never coerced', () {
      final AccessState access = AccessState.fromRaw(
        role: managerRole,
        roleMatrixRaw: const <String, Object?>{
          'mobile:serial': 'true',
          'mobile:meter': 1,
          'mobile:scan': 0,
          'mobile:alerts': null,
        },
      );
      expect(access.roleMatrix, isEmpty);
      // A dropped entry must behave exactly like an absent one.
      expect(
        resolveModuleAccess(module: ModuleKey.serial, access: access).reason,
        AccessReason.roleDefault,
      );
    });

    test('a null is_super_admin is not truthy', () {
      expect(
        AccessState.fromRaw(role: managerRole, isSuperAdmin: null).isSuperAdmin,
        isFalse,
      );
      expect(
        AccessState.fromRaw(role: managerRole, isSuperAdmin: true).isSuperAdmin,
        isTrue,
      );
    });

    test('null maps yield empty maps, not a crash', () {
      final AccessState access = AccessState.fromRaw(role: managerRole);
      expect(access.grants, isEmpty);
      expect(access.roleMatrix, isEmpty);
      expect(access.permissionsError, isFalse);
    });
  });

  group('invariants across every module and both orderings', () {
    test('a super-admin is always allowed', () {
      for (final AdminRevokePrecedence precedence
          in AdminRevokePrecedence.values) {
        for (final ModuleKey key in ModuleKey.values) {
          expect(
            decide(
              key,
              state(role: unknownRole, isSuperAdmin: true),
              precedence,
            ).isAllowed,
            isTrue,
          );
        }
      }
    });

    test('a decision is never both allowed and denied', () {
      for (final AdminRevokePrecedence precedence
          in AdminRevokePrecedence.values) {
        for (final ModuleKey key in ModuleKey.values) {
          for (final RoleId id in RoleId.values) {
            final AccessDecision result = decide(
              key,
              state(role: UserRole.known(id)),
              precedence,
            );
            expect(result.isAllowed, isNot(result.isDenied));
            expect(result.reason.allows, result.isAllowed);
            expect(result.module, key);
            expect(result.precedence, precedence);
          }
        }
      }
    });
  });
}
