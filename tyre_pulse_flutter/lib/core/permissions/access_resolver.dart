/// The one place effective module access is decided.
///
/// Spec section 9 gives a three-term formula:
///
/// ```text
/// effective access = role default + user grants - user revocations
/// ```
///
/// That formula is incomplete in three ways and wrong in one. It omits the
/// administrator break-glass, it omits a fourth input (the role-level mobile
/// matrix), and it says nothing about what happens when the permission data
/// fails to load. Artifact 04 section 1 establishes the real precedence from
/// the three existing implementations, and this file is the Flutter port of it.
///
/// ## One function, on purpose
///
/// `mobile/lib/permissions.ts` calls itself "the SINGLE source of truth" and
/// still needed `resolveGuardedAccess` bolted on beside `resolveModuleAccess`,
/// because a route guard needed different failure behaviour. Here the failure
/// mode is a FIELD on [AccessState] (`permissionsError`), so there is exactly
/// one resolver and the tab bar, the Home hub, the route guard and a repository
/// cannot disagree.
///
/// A widget must never test a role string. `if (role == admin)` belongs here
/// and nowhere else.
///
/// ## This decides screen reach, not data access
///
/// Read the library comment in `capabilities.dart` before using an allow from
/// this file as a reason to fetch anything. Module access is a `view`
/// capability, and `view` is enforced by no RLS policy in the database.
library;

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/capabilities.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

/// A per-user override row in `user_access_grants`.
enum GrantEffect {
  grant('grant'),
  revoke('revoke');

  const GrantEffect(this.wireName);

  /// `user_access_grants.effect` is `text` with a CHECK of exactly these two
  /// values (V225).
  final String wireName;
}

/// Parses one `effect` value. Returns null for anything else, so a malformed
/// row is DROPPED rather than guessed at.
GrantEffect? grantEffectFromWire(Object? raw) {
  if (raw is! String) {
    return null;
  }
  for (final GrantEffect effect in GrantEffect.values) {
    if (effect.wireName == raw) {
      return effect;
    }
  }
  return null;
}

/// Which implementation Flutter follows on the one question the three existing
/// resolvers answer differently.
///
/// **The open decision, stated rather than buried.** Artifact 04 section 1.3
/// calls this D1 and section 8.5 lists it first among the questions for the
/// product owner. Can a per-user REVOKE deny a user whose ROLE is `Admin`?
///
/// | Implementation | Answer | Source |
/// |---|---|---|
/// | Phone | YES, the revoke wins | `resolveModuleAccess`, `mobile/lib/permissions.ts` - deliberate, "user ask: admins were un-revokable" |
/// | Web | NO, the admin test is first | `resolveAccess`, `src/lib/accessResolver.js` |
/// | Server | NO, the admin test is first | `app_user_can`, `MIGRATIONS_V229_CAPABILITY_ENFORCEMENT.sql` |
///
/// The default here is [serverAppUserCan] because **the server is the real
/// boundary**. Copying the phone's ordering inherits a client-side denial the
/// server will not honour: the administrator sees no button, and the API still
/// accepts the write. A UI that refuses what the backend permits is not a
/// security control, it is a confusing one.
///
/// A super-admin is unrevokable in all three implementations, and stays so
/// here under either value.
///
/// Switch the default only when the product owner has answered D1.
enum AdminRevokePrecedence {
  /// The administrator role is checked BEFORE the per-user revoke. Matches
  /// `app_user_can` and the web resolver. Default.
  serverAppUserCan,

  /// The per-user revoke is checked BEFORE the administrator role, so a
  /// `mobile:<key>` revoke row denies an Admin. Matches the production phone
  /// app, and matches no server-side behaviour.
  mobileRevokeBeatsAdmin,
}

/// Why access was allowed or denied.
///
/// Every denial carries a sentence. `deniedIsNotASpinner` in the production
/// React Native suite exists because four admin screens rendered a spinner for
/// a refusal, and the owner reported it as "I feel is spinner but in actual no
/// access". Spec section 58 and AGENTS.md repeat the rule: loading, denied and
/// error are three different states with three different renderings, and a
/// denied screen never renders blank.
enum AccessReason {
  superAdmin(allows: true, message: 'Allowed as a super administrator.'),
  adminRole(allows: true, message: 'Allowed by the administrator role.'),
  perUserGrant(
    allows: true,
    message: 'Allowed by a permission granted to your account.',
  ),
  roleMatrixEnabled(
    allows: true,
    message: 'Allowed for your role by your administrator.',
  ),
  roleDefault(allows: true, message: 'Allowed for your role.'),
  perUserRevoke(
    allows: false,
    message: 'Your administrator has removed your access to this section.',
  ),
  roleMatrixDisabled(
    allows: false,
    message: 'Your administrator has turned this section off for your role. '
        'Contact them if you need it.',
  ),
  roleNotInDefaults(
    allows: false,
    message: 'Your role does not include this section. Contact your '
        'administrator if you need it.',
  ),
  adminOnlyModule(
    allows: false,
    message: 'This section is limited to administrators.',
  ),
  permissionDataUnavailable(
    allows: false,
    message: 'Your permissions could not be loaded, so this administration '
        'section stays closed. Try again in a moment, or sign in again.',
  ),
  unknownRole(
    allows: false,
    message: 'Your role is not recognised by this version of the app, so no '
        'sections are available. Contact your administrator.',
  ),
  noRoleAssigned(
    allows: false,
    message: 'No role has been assigned to your account yet. Contact your '
        'administrator.',
  );

  const AccessReason({required this.allows, required this.message});

  final bool allows;

  /// Safe to display. Never names a table, a column, a module key or a policy.
  final String message;
}

/// Everything the resolver needs, and nothing else.
///
/// Artifact 04 section 8.2 requires the loader to report which of its three
/// reads failed INDEPENDENTLY. A `Future.wait` with no per-member error
/// handling turns one failure into three, and `permissionsError` must stay
/// narrow or the fail-closed rule below starts firing on a healthy session.
final class AccessState {
  const AccessState({
    required this.role,
    this.isSuperAdmin = false,
    this.grants = const <ModuleKey, GrantEffect>{},
    this.roleMatrix = const <ModuleKey, bool>{},
    this.permissionsError = false,
  });

  /// Builds state from the raw shapes the two RPCs return.
  ///
  /// - `get_my_access_grants()` returns `jsonb` whose values are the STRINGS
  ///   `grant` / `revoke` (V225 aggregates `effect`, a text column).
  /// - `get_user_module_permissions()` returns `jsonb` whose values are
  ///   BOOLEANS.
  ///
  /// Both maps are shared with the web application, so only `mobile:` prefixed
  /// keys are kept and the prefix is stripped. Anything else is DROPPED:
  ///
  /// - a web-namespaced key (no `mobile:` prefix);
  /// - a key that is not a module this app version knows;
  /// - a grant value that is not exactly `grant` or `revoke`;
  /// - a matrix value that is not a boolean. It is dropped, NOT coerced - a
  ///   truthy string must never enable a module and a `0` must never deny one.
  ///
  /// A dropped entry falls through to the next term in the precedence, which is
  /// the same behaviour as the entry never having existed.
  factory AccessState.fromRaw({
    required UserRole role,
    bool? isSuperAdmin,
    Map<String, Object?>? grantsRaw,
    Map<String, Object?>? roleMatrixRaw,
    bool permissionsError = false,
  }) {
    final Map<ModuleKey, GrantEffect> grants = <ModuleKey, GrantEffect>{};
    if (grantsRaw != null) {
      for (final MapEntry<String, Object?> entry in grantsRaw.entries) {
        final ModuleKey? key = moduleKeyFromMobileGrantKey(entry.key);
        final GrantEffect? effect = grantEffectFromWire(entry.value);
        if (key != null && effect != null) {
          grants[key] = effect;
        }
      }
    }

    final Map<ModuleKey, bool> matrix = <ModuleKey, bool>{};
    if (roleMatrixRaw != null) {
      for (final MapEntry<String, Object?> entry in roleMatrixRaw.entries) {
        final ModuleKey? key = moduleKeyFromMobileGrantKey(entry.key);
        final Object? value = entry.value;
        if (key != null && value is bool) {
          matrix[key] = value;
        }
      }
    }

    return AccessState(
      role: role,
      // `profiles.is_super_admin` is boolean and NULLABLE. A null must not be
      // truthy, which is why the phone compares `=== true`.
      isSuperAdmin: isSuperAdmin == true,
      grants: Map<ModuleKey, GrantEffect>.unmodifiable(grants),
      roleMatrix: Map<ModuleKey, bool>.unmodifiable(matrix),
      permissionsError: permissionsError,
    );
  }

  /// No identity resolved yet, or the profile could not be read and there is no
  /// cache. Reaches nothing. Artifact 04 section 8.3: no identity, no
  /// decisions.
  static const AccessState signedOut = AccessState(
    role: UserRole.absent,
    permissionsError: true,
  );

  final UserRole role;

  /// `profiles.is_super_admin`. Never lockable, in every implementation.
  final bool isSuperAdmin;

  /// Per-user overrides, `mobile:` prefix already stripped.
  final Map<ModuleKey, GrantEffect> grants;

  /// Role-level overrides from `mobile:` prefixed `module_permissions` rows.
  ///
  /// An ABSENT key means "no override on mobile" and falls through to the role
  /// default. Only an explicit boolean decides. RECORDED as UNVERIFIED in
  /// artifact 04 section 9: this layer may be entirely empty in production, in
  /// which case the role default is the whole story.
  final Map<ModuleKey, bool> roleMatrix;

  /// True when the grants RPC or the matrix RPC failed and the maps above are
  /// therefore empty or stale.
  ///
  /// Ordinary modules FAIL OPEN under this flag and fall through to the role
  /// default, so a transient RPC failure never strands a field worker
  /// mid-shift. The three modules in [ModuleRegistry.sensitive] FAIL CLOSED.
  final bool permissionsError;

  AccessState copyWith({
    UserRole? role,
    bool? isSuperAdmin,
    Map<ModuleKey, GrantEffect>? grants,
    Map<ModuleKey, bool>? roleMatrix,
    bool? permissionsError,
  }) =>
      AccessState(
        role: role ?? this.role,
        isSuperAdmin: isSuperAdmin ?? this.isSuperAdmin,
        grants: grants ?? this.grants,
        roleMatrix: roleMatrix ?? this.roleMatrix,
        permissionsError: permissionsError ?? this.permissionsError,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AccessState &&
          other.role == role &&
          other.isSuperAdmin == isSuperAdmin &&
          other.permissionsError == permissionsError &&
          _mapEquals<ModuleKey, GrantEffect>(other.grants, grants) &&
          _mapEquals<ModuleKey, bool>(other.roleMatrix, roleMatrix);

  @override
  int get hashCode => Object.hash(
        role,
        isSuperAdmin,
        permissionsError,
        grants.length,
        roleMatrix.length,
      );

  @override
  String toString() => 'AccessState(role: $role, superAdmin: $isSuperAdmin, '
      'grants: ${grants.length}, matrix: ${roleMatrix.length}, '
      'permissionsError: $permissionsError)';
}

bool _mapEquals<K, V>(Map<K, V> a, Map<K, V> b) {
  if (identical(a, b)) {
    return true;
  }
  if (a.length != b.length) {
    return false;
  }
  for (final MapEntry<K, V> entry in a.entries) {
    if (!b.containsKey(entry.key) || b[entry.key] != entry.value) {
      return false;
    }
  }
  return true;
}

/// The answer, with the reason it was reached.
///
/// A refusal must be able to explain itself. Never render a denied screen as a
/// spinner, as blank, or by navigating away: the guard stays put and says so.
final class AccessDecision {
  const AccessDecision({
    required this.module,
    required this.reason,
    required this.precedence,
    required this.role,
  });

  final ModuleKey module;
  final AccessReason reason;
  final AdminRevokePrecedence precedence;

  /// The role the decision was made against. Kept so a diagnostic can report an
  /// unrecognised role's raw value without a second lookup.
  final UserRole role;

  bool get isAllowed => reason.allows;

  bool get isDenied => !reason.allows;

  /// Safe to display next to a lock icon. Always a complete sentence.
  String get userMessage => reason.message;

  /// The capability a module decision represents.
  ///
  /// Always [Capability.view], and [Capability.view] is enforced by no RLS
  /// policy - see [isAuthorisationBoundary].
  Capability get capability => Capability.view;

  /// **Always false.** A module decision governs which screens a person can
  /// reach. It is not authorisation to read a table, because `view` is a client
  /// gate that no policy checks. A repository that treats an allow here as
  /// permission to fetch has misread the boundary; a repository that treats a
  /// DENY as a reason not to call is correct, and that is the whole intended
  /// use.
  bool get isAuthorisationBoundary => capability.isServerEnforced;

  /// Unsafe to display, safe to log. Spec section 59: never put a secret here.
  ///
  /// The raw role string is included when it could not be mapped, because
  /// artifact 04 section 8.3 requires an unrecognised role to be LOGGED rather
  /// than silently coerced, and the raw value is what an administrator needs in
  /// order to fix the configuration.
  String get technical {
    final String roleText =
        role.isKnown ? role.token : 'unmapped(${role.rawValue})';
    return 'module=${module.wireKey} reason=${reason.name} '
        'precedence=${precedence.name} role=$roleText';
  }

  /// The typed error to throw or surface when something tried to proceed
  /// anyway. Null when access was allowed.
  AppError? get denialError => isAllowed
      ? null
      : AppError.authorization(message: userMessage, technical: technical);

  @override
  String toString() =>
      'AccessDecision(${isAllowed ? 'allow' : 'deny'}, $technical)';
}

/// Resolves whether [access] reaches [module], and why.
///
/// Precedence, highest first, under the default [AdminRevokePrecedence]:
///
/// ```text
/// 1. super-admin                                  -> ALLOW
/// 2. role is Admin                                -> ALLOW   (see note)
/// 3. per-user revoke                              -> DENY
/// 4. per-user grant                               -> ALLOW
/// 5. permissions unavailable AND module sensitive -> DENY
/// 6. role matrix explicit true / false            -> ALLOW / DENY
/// 7. role has no mapping                          -> DENY
/// 8. module is admin-only                         -> DENY
/// 9. role default list                            -> ALLOW / DENY
/// ```
///
/// Under [AdminRevokePrecedence.mobileRevokeBeatsAdmin], step 2 moves to sit
/// between steps 5 and 6, which is the production phone's ordering. Nothing
/// else changes.
///
/// Step 4 sits above step 5 deliberately. `resolveGuardedAccess` on the phone
/// writes it the other way round and then returns `grants[key] == 'grant'` from
/// inside the sensitive branch, which is the same outcome by a longer route: an
/// explicit grant loaded BEFORE the failure is the one signal that survives it.
///
/// Steps 7 and 8 exist so a refusal can say something true. Both would be
/// covered by step 9 returning false, but "your role is not recognised" and
/// "this section is limited to administrators" are different problems with
/// different fixes, and a person deserves to be told which one they have hit.
AccessDecision resolveModuleAccess({
  required ModuleKey module,
  required AccessState access,
  AdminRevokePrecedence precedence = AdminRevokePrecedence.serverAppUserCan,
}) {
  final UserRole role = access.role;
  final bool isAdminRole = role.isAdministrator;

  AccessDecision decide(AccessReason reason) => AccessDecision(
        module: module,
        reason: reason,
        precedence: precedence,
        role: role,
      );

  // 1. Never lockable, in every implementation.
  if (access.isSuperAdmin) {
    return decide(AccessReason.superAdmin);
  }

  // 2. The server and the web check the administrator role before any
  //    per-user override. See AdminRevokePrecedence.
  if (precedence == AdminRevokePrecedence.serverAppUserCan && isAdminRole) {
    return decide(AccessReason.adminRole);
  }

  // 3 and 4. The per-user overlay. A revoke beats a grant for the same module,
  //    which is what `app_user_can` does too: it tests the revoke first and
  //    only reaches the grant when nothing has denied.
  final GrantEffect? override = access.grants[module];
  if (override == GrantEffect.revoke) {
    return decide(AccessReason.perUserRevoke);
  }
  if (override == GrantEffect.grant) {
    return decide(AccessReason.perUserGrant);
  }

  // 5. Fail closed on administration surfaces when the permission data is
  //    untrustworthy. Everything else falls through and fails OPEN, and that
  //    asymmetry is deliberate: a transient RPC failure must never strand a
  //    field user mid-shift, and it must never hand a non-administrator a user
  //    management console either.
  if (access.permissionsError &&
      ModuleRegistry.isSensitive(module) &&
      !isAdminRole) {
    return decide(AccessReason.permissionDataUnavailable);
  }

  // 2b. The phone's position for the administrator role.
  if (isAdminRole) {
    return decide(AccessReason.adminRole);
  }

  // 6. Role-level override. Absent means "no opinion", not "no".
  final bool? matrix = access.roleMatrix[module];
  if (matrix == true) {
    return decide(AccessReason.roleMatrixEnabled);
  }
  if (matrix == false) {
    return decide(AccessReason.roleMatrixDisabled);
  }

  // 7. No mapping means no modules, and it is said out loud. It is NOT
  //    silently treated as Reporter. See roles.dart.
  if (role.isAbsent) {
    return decide(AccessReason.noRoleAssigned);
  }
  if (role.isUnknown) {
    return decide(AccessReason.unknownRole);
  }

  // 8 and 9. The role default, last.
  final ModuleDef definition = ModuleRegistry.definitionFor(module);
  if (definition.isAdminOnly) {
    return decide(AccessReason.adminOnlyModule);
  }
  if (definition.allowsByRoleDefault(role)) {
    return decide(AccessReason.roleDefault);
  }
  return decide(AccessReason.roleNotInDefaults);
}

/// Convenience for a call site that genuinely only needs the boolean.
///
/// Prefer [resolveModuleAccess] anywhere a person will see the outcome: a
/// refusal without its reason is how a denied screen ends up rendering a
/// spinner.
bool canAccessModule({
  required ModuleKey module,
  required AccessState access,
  AdminRevokePrecedence precedence = AdminRevokePrecedence.serverAppUserCan,
}) =>
    resolveModuleAccess(
      module: module,
      access: access,
      precedence: precedence,
    ).isAllowed;

/// Every module [access] reaches, in registry order.
///
/// Used to rebuild navigation after a workspace change or a realtime
/// permission update. Deriving the tab set from this rather than from a role
/// literal is what stops the tab bar and the screens drifting apart: the
/// production app had `stock` admitting inspectors in the registry while the
/// screen's own list did not, so an inspector saw the tile, tapped it, and was
/// thrown back to Home.
Set<ModuleKey> allowedModulesFor(
  AccessState access, {
  AdminRevokePrecedence precedence = AdminRevokePrecedence.serverAppUserCan,
}) {
  final Set<ModuleKey> allowed = <ModuleKey>{};
  for (final ModuleDef definition in ModuleRegistry.all) {
    final AccessDecision decision = resolveModuleAccess(
      module: definition.key,
      access: access,
      precedence: precedence,
    );
    if (decision.isAllowed) {
      allowed.add(definition.key);
    }
  }
  return allowed;
}

/// How far the server enforces [capability].
///
/// Exposed from the resolver so a call site asking "am I allowed to do this"
/// gets the enforcement answer in the same place as the access answer, and
/// cannot mistake a UI gate for an authorisation boundary. `view` answers
/// [CapabilityEnforcement.uiOnly].
CapabilityEnforcement enforcementOf(Capability capability) =>
    capability.enforcement;
