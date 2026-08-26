/// The role vocabulary, and the translation between the two spellings of it.
///
/// `profiles.role` is plain `text` holding **Title Case** names ("Tyre Man").
/// The phone works in lowercase underscore **tokens** ("tyre_man"). Two
/// vocabularies, one column.
///
/// ## The defect this file exists to stop
///
/// Both machines silently downgrade an unrecognised role, to the same value:
///
/// - **Server.** `normalize_profiles_role()` (V282, made SECURITY DEFINER by
///   V285) accepts a name only if it is a built-in or a row in `custom_roles`.
///   Anything else is rewritten to `'Reporter'` and the UPDATE still reports
///   success. V282's own header records the symptom: "I add new roles, assign
///   to them, it's still same".
/// - **Client.** `normaliseRole()` in `mobile/lib/types.ts` returns
///   `'reporter'` for any unlisted token, and says so in a comment: that is how
///   "Tyre Data Collector" ended up with a reporter's permissions on the phone
///   while the server correctly saw `tyre_data_collector`.
///
/// A silent downgrade is worse than a refusal, because it produces a working
/// app that shows the wrong person the wrong buttons and never says why. So
/// this port makes the unknown case a first-class, VISIBLE value:
/// [UserRole.unknown] carries the raw string it could not map, and
/// [UserRole.isUnknown] is true. An unknown role reaches NO module by role
/// default; the resolver denies it with the reason `unknownRole`, which renders
/// as a sentence naming the problem. It is never coerced to `reporter`.
///
/// Artifact 04 section 8.3 states the rule as: "Role string not in the registry
/// -> treat as no modules, and LOG IT. Do NOT silently coerce to reporter."
///
/// ## Adding a role
///
/// Three things must all be true (V592 records what happens when they are not -
/// "three roles the web offers could never be saved"):
///
/// 1. a row in `public.custom_roles`, with `organisation_id` set EXPLICITLY -
///    its default is `app_current_org()`, which is NULL outside a user session,
///    and a null-org row is invisible;
/// 2. the token added to [RoleId] here;
/// 3. the role listed on every module it needs in the module registry. Adding a
///    role WITHOUT step 3 makes it deny-by-default on every module, which is a
///    removal of access, not an addition. `mobile/lib/permissions.ts` states
///    this explicitly: adding a role to the union "would have TAKEN AWAY access
///    two real people are using today".
library;

/// The fifteen roles this application recognises.
///
/// Ported from the `UserRole` union and the `normaliseRole` allowlist in
/// `mobile/lib/types.ts`, cross-checked against the built-in allowlist inside
/// `normalize_profiles_role()` (V282/V285) as tabulated in artifact 04
/// section 2.2.
enum RoleId {
  admin(token: 'admin', databaseName: 'Admin', isBuiltIn: true),
  manager(token: 'manager', databaseName: 'Manager', isBuiltIn: true),
  director(token: 'director', databaseName: 'Director', isBuiltIn: true),
  inspector(token: 'inspector', databaseName: 'Inspector', isBuiltIn: true),
  tyreMan(token: 'tyre_man', databaseName: 'Tyre Man', isBuiltIn: true),
  reporter(token: 'reporter', databaseName: 'Reporter', isBuiltIn: true),
  driver(token: 'driver', databaseName: 'Driver', isBuiltIn: true),

  // Custom roles. Each is a real `custom_roles` row held by real people.
  // Seeded by V591 (mechanic, electrician), V592 (maintenance supervisor) and
  // V599 (workshop supervisor). The seed migration for the remaining four was
  // not found in this repo - artifact 04 section 2.2 marks that, and section 9
  // lists the live `custom_roles` roster as still needing a database check.
  mechanic(token: 'mechanic', databaseName: 'Mechanic', isBuiltIn: false),
  electrician(
    token: 'electrician',
    databaseName: 'Electrician',
    isBuiltIn: false,
  ),
  maintenanceSupervisor(
    token: 'maintenance_supervisor',
    databaseName: 'Maintenance Supervisor',
    isBuiltIn: false,
  ),
  workshopSupervisor(
    token: 'workshop_supervisor',
    databaseName: 'Workshop Supervisor',
    isBuiltIn: false,
  ),
  tyreDataCollector(
    token: 'tyre_data_collector',
    databaseName: 'Tyre Data Collector',
    isBuiltIn: false,
  ),
  pmvManager(
    token: 'pmv_manager',
    databaseName: 'PMV Manager',
    isBuiltIn: false,
  ),
  workshopAreaManager(
    token: 'workshop_area_manager',
    databaseName: 'Workshop Area Manager',
    isBuiltIn: false,
  ),
  workshopMaintenanceAreaManager(
    token: 'workshop_maintenance_area_manager',
    databaseName: 'Workshop Maintenance Area Manager',
    isBuiltIn: false,
  );

  const RoleId({
    required this.token,
    required this.databaseName,
    required this.isBuiltIn,
  });

  /// The lowercase underscore token the phone works in.
  final String token;

  /// The Title Case value stored in `profiles.role`.
  final String databaseName;

  /// True for a role in the built-in allowlist inside
  /// `normalize_profiles_role()`; false for one that needs a `custom_roles`
  /// row before it can be assigned at all.
  final bool isBuiltIn;
}

/// The supervisory and approver roles, named once so module lists cannot drift
/// apart and so it is obvious who these are: the people who sign work off.
///
/// Mirrors `SUPERVISOR_ROLES` in `mobile/lib/permissions.ts`. In that file the
/// constant is exported but referenced only by tests, because the drift guard
/// parses the registry as TEXT and a spread would read as the characters
/// `...SUPERVISOR_ROLES` rather than as role names. The same caution applies
/// here: the module registry lists these roles LITERALLY.
const Set<RoleId> supervisorRoles = <RoleId>{
  RoleId.maintenanceSupervisor,
  RoleId.workshopSupervisor,
  RoleId.pmvManager,
  RoleId.workshopAreaManager,
  RoleId.workshopMaintenanceAreaManager,
};

/// Role names that exist in the database and have NO token on the phone.
///
/// These are not typos. Seven are catalogued in artifact 04 section 2.2 as
/// assignable-but-unmapped, and `Tire Planning Engineer` is RECORDED as
/// actually held by a person in the live `profiles` table. Every one of them
/// resolves to [UserRole.unknown] here, which is the honest answer: the app
/// has no permission model for them.
///
/// The list exists so a diagnostic can tell "a role we know the database can
/// hold, that this app version has no mapping for" apart from "a value nobody
/// has ever seen". The first is a configuration gap somebody can close; the
/// second is corrupt data. Both deny; only one is worth paging an
/// administrator about.
const List<String> knownUnmappedDatabaseRoles = <String>[
  // Built-in names with no mobile token.
  'Integration Admin',
  'Data Engineer',
  'Automation',
  // Custom roles seeded by V592 and named in V282 with no mobile token.
  'Data Monitor Officer',
  'Store Keeper',
  'Fleet Supervisor',
  'Insurance Officer',
  // RECORDED live 2026-08-18: a real assigned role that appears in no module
  // list and in no allowlist, so that person is currently a reporter on the
  // phone. Artifact 04 section 2.2.
  'Tire Planning Engineer',
];

/// Normalises a role string from either vocabulary to a token.
///
/// Byte-for-byte the same transformation as `normaliseRole` in
/// `mobile/lib/types.ts`: trim, lowercase, then collapse each run of
/// whitespace to a single underscore. Only the FALLBACK differs, and that is
/// the whole point of this file - see [UserRole.fromDatabase].
String normaliseRoleToken(String raw) =>
    raw.trim().toLowerCase().replaceAll(RegExp(r'\s+'), '_');

/// Resolves a token or a Title Case database name to a [RoleId], or null when
/// the application does not recognise it.
RoleId? roleIdFromRaw(String? raw) {
  if (raw == null) {
    return null;
  }
  final String token = normaliseRoleToken(raw);
  if (token.isEmpty) {
    return null;
  }
  for (final RoleId id in RoleId.values) {
    if (id.token == token) {
      return id;
    }
  }
  return null;
}

/// A role as this application holds it: either a recognised [RoleId], or an
/// explicit unknown carrying the raw string that could not be mapped.
///
/// Never construct a fallback role. There is no "default role". A user whose
/// role cannot be mapped has no role, and every screen that asks is told so.
final class UserRole {
  /// A recognised role.
  ///
  /// [rawValue] keeps whatever the database actually stored, so telemetry can
  /// report that a profile said `tyre man` where the catalogue says
  /// `Tyre Man`. It is optional because a caller constructing a role in code
  /// has no raw string to preserve.
  const UserRole.known(RoleId this.id, {this.rawValue = ''});

  /// A role string this application version does not recognise.
  ///
  /// The raw value is retained deliberately. It is the only evidence of what
  /// the database actually holds, and it is what an administrator needs in
  /// order to fix the configuration.
  const UserRole.unknown(this.rawValue) : id = null;

  /// Reads `profiles.role`.
  ///
  /// A null, empty or whitespace-only value yields [UserRole.absent]: a profile
  /// with no role recorded. That is NOT the same as an unrecognised role, and
  /// neither is the same as `Reporter`.
  factory UserRole.fromDatabase(String? raw) {
    final String trimmed = (raw ?? '').trim();
    if (trimmed.isEmpty) {
      return absent;
    }
    final RoleId? resolved = roleIdFromRaw(trimmed);
    if (resolved == null) {
      return UserRole.unknown(trimmed);
    }
    return UserRole.known(resolved, rawValue: trimmed);
  }

  /// No role recorded on the profile at all.
  static const UserRole absent = UserRole.unknown('');

  /// The recognised role, or null when this is an unknown or absent role.
  final RoleId? id;

  /// What the database held. Empty for [absent], and empty for a role built in
  /// code without a raw string.
  final String rawValue;

  bool get isKnown => id != null;

  bool get isUnknown => id == null;

  /// True when the profile carried no role at all, as opposed to carrying one
  /// this version cannot map.
  bool get isAbsent => id == null && rawValue.isEmpty;

  /// True when this is a role the database is known to hold and the app has no
  /// mapping for. See [knownUnmappedDatabaseRoles].
  bool get isRecognisedButUnmapped {
    if (isKnown || rawValue.isEmpty) {
      return false;
    }
    final String token = normaliseRoleToken(rawValue);
    return knownUnmappedDatabaseRoles
        .any((String name) => normaliseRoleToken(name) == token);
  }

  /// The hard `admin` role. This is the ONLY place the string is tested.
  ///
  /// Note this is not "elevated". A Manager and a Director are not
  /// administrators here, and `decide_inspection_approval` does not admit
  /// either of them.
  bool get isAdministrator => id == RoleId.admin;

  bool get isSupervisory => id != null && supervisorRoles.contains(id);

  /// The token, for logs and for building a server filter. Empty when unknown -
  /// an unknown role has no token, and inventing one would be the coercion this
  /// file exists to prevent.
  String get token => id?.token ?? '';

  /// Safe to show a person: the catalogue name for a known role, the raw stored
  /// value for an unknown one, and a stated placeholder when there is nothing.
  String get displayName {
    if (id != null) {
      return id!.databaseName;
    }
    return rawValue.isEmpty ? 'No role assigned' : rawValue;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is UserRole && other.id == id && other.rawValue == rawValue;

  @override
  int get hashCode => Object.hash(id, rawValue);

  @override
  String toString() => isKnown
      ? 'UserRole(${id!.token})'
      : 'UserRole(unknown: "$rawValue")';
}
