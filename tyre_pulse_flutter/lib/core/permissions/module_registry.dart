/// The module registry: the single source of module identity.
///
/// Ported from `MODULES` in `mobile/lib/permissions.ts` and pinned by
/// `docs/flutter-migration/04-role-permission-matrix.md` section 3. Thirty-one
/// modules, five groups, and a default role list per module.
///
/// Three properties of the original are deliberately preserved:
///
/// 1. **The wire key is the match target.** A per-user grant is stored as
///    `mobile:<wireKey>` in `user_access_grants`, and a role override as
///    `mobile:<wireKey>` in `module_permissions`. The web mirror
///    (`src/lib/mobileModules.js`) exists only because the web catalogue uses a
///    DIFFERENT key space - it says `tyre_records` where the phone says
///    `records`. A stale `mobile:inspections` row proved the cost of getting
///    this wrong: the phone's key is `inspect`, so the deny landed nowhere.
///    [ModuleKey.wireKey] is therefore the enum's own `name`, and the enum
///    value names are chosen to match the TypeScript strings exactly.
///
/// 2. **Admin-only is stated, not implied.** The TypeScript registry writes
///    `roles: []` for eleven modules and relies on a reader knowing that
///    `moduleAllowedByRole` admits `admin` before it looks at the list. An
///    empty list reads as an oversight. Here those modules are built with
///    [ModuleDef.adminOnly], which cannot carry a role list at all, so the two
///    facts can never disagree.
///
/// 3. **Bulk-listing modules keep no role default.** The registry's own rule,
///    kept verbatim: do not give a bulk-listing or reporting module a role
///    default. Mobile Analytics paged through every `tyre_record` - 7,498 rows
///    and climbing - which is an out-of-memory crash on a cheap handset. If a
///    field role genuinely needs one, add a server-side aggregate so the phone
///    fetches one row instead of a table, or grant it to that one person.
///
/// Artifact 04 section 3.4 warns that a Dart registry plus the JS mirror plus
/// the TS registry is three hand-maintained copies. The drift guard for this
/// one is `test/core/permissions/module_registry_drift_test.dart`, which parses
/// `mobile/lib/permissions.ts` as text, exactly as `src/test/mobileModules.test.js`
/// does. Do not add a fourth copy.
library;

import 'package:tyre_pulse/core/permissions/roles.dart';

/// Every gated destination in the application.
///
/// The enum value name IS the wire key. `ModuleKey.tyreChange.name` is
/// `'tyreChange'`, which is what the server stores behind the `mobile:` prefix.
/// Renaming a value here silently breaks every stored grant for that module, so
/// the drift guard compares these names against the TypeScript registry.
enum ModuleKey {
  // Field
  inspect,
  scan,
  serial,
  tyreChange,
  checklists,
  meter,
  washing,
  reportIssue,
  repairRequest,
  // Fleet
  records,
  vehicles,
  history,
  alerts,
  calendar,
  // Maintenance
  accidents,
  reportAccident,
  workorders,
  rca,
  tasks,
  stock,
  pm,
  workshop,
  // Management
  overview,
  reports,
  analytics,
  stockManage,
  ai,
  team,
  // Admin
  approvals,
  admin,
  users;

  /// The string the server stores, without the `mobile:` prefix.
  String get wireKey => name;
}

/// Prefix that namespaces a MOBILE permission row from a web one.
///
/// `user_access_grants.module_key` and `module_permissions.module_key` are
/// shared with the web application, so mobile rows carry this prefix and web
/// rows do not. Revoking a module on mobile therefore never touches web access.
///
/// Note what this prefix does NOT reach: `app_user_can`, the server capability
/// function, matches BARE WEB keys (`tyre_records`, `fleet_master`). A mobile
/// grant written as `mobile:records` has no effect on any RLS policy. See
/// [ModuleGroup] documentation and artifact 04 section 4.2.
const String mobileGrantPrefix = 'mobile:';

/// Builds the stored key for a module, e.g. `mobile:records`.
String mobileGrantKeyFor(ModuleKey key) => '$mobileGrantPrefix${key.wireKey}';

/// Parses a stored key back to a [ModuleKey], stripping the `mobile:` prefix.
///
/// Returns null for a web-namespaced key, an unknown module, or anything
/// malformed. A key that cannot be resolved is DROPPED, never guessed: a
/// mistyped row must not silently enable or deny a neighbouring module.
ModuleKey? moduleKeyFromMobileGrantKey(String rawKey) {
  if (!rawKey.startsWith(mobileGrantPrefix)) {
    return null;
  }
  return moduleKeyFromWireKey(rawKey.substring(mobileGrantPrefix.length));
}

/// Parses a bare wire key (no prefix) to a [ModuleKey], or null if unknown.
ModuleKey? moduleKeyFromWireKey(String wireKey) {
  for (final ModuleKey key in ModuleKey.values) {
    if (key.wireKey == wireKey) {
      return key;
    }
  }
  return null;
}

/// Grouping used by the access editor and the Home hub.
enum ModuleGroup {
  field('Field'),
  fleet('Fleet'),
  maintenance('Maintenance'),
  management('Management'),
  admin('Admin');

  const ModuleGroup(this.registryName);

  /// The exact string the TypeScript registry uses, so the drift guard can
  /// compare group assignment as well as role sets.
  final String registryName;
}

/// One module: its identity, where it appears, and who reaches it by default.
///
/// [defaultRoles] is the ROLE DEFAULT only. It is the LAST term the resolver
/// consults; a per-user grant, a per-user revoke, the role matrix and the admin
/// break-glass all outrank it. Never read this list as "who can use the
/// module".
final class ModuleDef {
  /// A module with a role default.
  ///
  /// [defaultRoles] must not be empty. An empty list here would read as
  /// `roles: []` in the TypeScript registry, which means admin-only - and that
  /// meaning belongs in [ModuleDef.adminOnly] where it is stated out loud.
  /// `module_registry_test.dart` pins that no module built this way is empty.
  const ModuleDef.forRoles({
    required this.key,
    required this.defaultLabel,
    required this.group,
    required this.defaultRoles,
  }) : isAdminOnly = false;

  /// A module reachable only by an administrator, a super-admin, or one named
  /// person holding an explicit per-user grant.
  ///
  /// This is the honest spelling of the TypeScript registry's `roles: []`. It
  /// carries no role list at all, so nobody can later "fix" an apparently empty
  /// list by adding a role to it without deciding, deliberately, that this
  /// module is no longer administrative.
  const ModuleDef.adminOnly({
    required this.key,
    required this.defaultLabel,
    required this.group,
  }) : isAdminOnly = true,
       defaultRoles = const <RoleId>{};

  final ModuleKey key;

  /// The English label carried by the TypeScript registry. It exists so the
  /// drift guard can compare labels, and as a last resort when a translation is
  /// missing. Screens render [labelKey] through the localisation layer; they do
  /// not render this string. Spec section 51.
  final String defaultLabel;

  final ModuleGroup group;

  /// Roles that reach this module with no grant and no role-matrix row.
  /// Always empty for an admin-only module.
  final Set<RoleId> defaultRoles;

  /// True when this module has no role default at all: administrators,
  /// super-admins, and anyone holding an explicit per-user grant.
  final bool isAdminOnly;

  /// The localisation key for this module's label.
  String get labelKey => 'modules.${key.wireKey}.label';

  /// The key as stored on the server, with the `mobile:` prefix.
  String get grantKey => mobileGrantKeyFor(key);

  /// Whether [role] reaches this module by ROLE DEFAULT alone.
  ///
  /// This deliberately does NOT admit an administrator. The admin break-glass
  /// belongs to the resolver, at a stated position in the precedence, so that
  /// switching that position (see `AdminRevokePrecedence`) changes behaviour in
  /// exactly one place. The TypeScript `moduleAllowedByRole` folds the admin
  /// test in here, which is why the phone and the server disagree about whether
  /// a revoke can deny an admin and neither file says so.
  bool allowsByRoleDefault(UserRole role) {
    final RoleId? id = role.id;
    if (id == null) {
      return false;
    }
    return defaultRoles.contains(id);
  }
}

/// The registry itself.
abstract final class ModuleRegistry {
  /// Every module, in the order the TypeScript registry declares them.
  static const List<ModuleDef> all = <ModuleDef>[
    // --- Field -------------------------------------------------------------
    ModuleDef.forRoles(
      key: ModuleKey.inspect,
      defaultLabel: 'New Inspection',
      group: ModuleGroup.field,
      defaultRoles: <RoleId>{
        RoleId.manager,
        RoleId.director,
        RoleId.inspector,
        RoleId.tyreMan,
      },
    ),
    ModuleDef.forRoles(
      key: ModuleKey.scan,
      defaultLabel: 'Scan',
      group: ModuleGroup.field,
      defaultRoles: <RoleId>{
        RoleId.manager,
        RoleId.director,
        RoleId.inspector,
        RoleId.tyreMan,
        RoleId.mechanic,
        RoleId.electrician,
      },
    ),
    ModuleDef.forRoles(
      key: ModuleKey.serial,
      defaultLabel: 'Serial Search',
      group: ModuleGroup.field,
      defaultRoles: <RoleId>{
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
    ),
    ModuleDef.forRoles(
      key: ModuleKey.tyreChange,
      defaultLabel: 'Tyre Change',
      group: ModuleGroup.field,
      defaultRoles: <RoleId>{RoleId.manager, RoleId.director, RoleId.inspector},
    ),
    ModuleDef.forRoles(
      key: ModuleKey.checklists,
      defaultLabel: 'Checklists',
      group: ModuleGroup.field,
      defaultRoles: <RoleId>{
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
    ),
    ModuleDef.forRoles(
      key: ModuleKey.meter,
      defaultLabel: 'Meter Log',
      group: ModuleGroup.field,
      defaultRoles: <RoleId>{
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
    ),
    ModuleDef.forRoles(
      key: ModuleKey.washing,
      defaultLabel: 'Vehicle Washing',
      group: ModuleGroup.field,
      defaultRoles: <RoleId>{
        RoleId.manager,
        RoleId.director,
        RoleId.inspector,
        RoleId.driver,
        RoleId.tyreMan,
      },
    ),
    ModuleDef.forRoles(
      key: ModuleKey.reportIssue,
      defaultLabel: 'Report Issue',
      group: ModuleGroup.field,
      defaultRoles: <RoleId>{
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
    ),
    ModuleDef.forRoles(
      key: ModuleKey.repairRequest,
      defaultLabel: 'Repair Request',
      group: ModuleGroup.field,
      defaultRoles: <RoleId>{
        RoleId.manager,
        RoleId.director,
        RoleId.inspector,
        RoleId.tyreMan,
        RoleId.reporter,
        RoleId.driver,
        RoleId.mechanic,
        RoleId.electrician,
      },
    ),
    // --- Fleet -------------------------------------------------------------
    // Tyre Records is a bulk listing. See the rule at the top of this file.
    ModuleDef.adminOnly(
      key: ModuleKey.records,
      defaultLabel: 'Tyre Records',
      group: ModuleGroup.fleet,
    ),
    // Vehicles is open to field staff by owner instruction (2026-08-06). It is
    // safe to open because it reads a BOUNDED, country-scoped, lean-column page
    // - it was never the unbounded table scan that crashed low-end devices.
    ModuleDef.forRoles(
      key: ModuleKey.vehicles,
      defaultLabel: 'Vehicles',
      group: ModuleGroup.fleet,
      defaultRoles: <RoleId>{
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
    ),
    ModuleDef.adminOnly(
      key: ModuleKey.history,
      defaultLabel: 'History',
      group: ModuleGroup.fleet,
    ),
    ModuleDef.forRoles(
      key: ModuleKey.alerts,
      defaultLabel: 'Alerts',
      group: ModuleGroup.fleet,
      defaultRoles: <RoleId>{RoleId.manager, RoleId.director, RoleId.inspector},
    ),
    ModuleDef.forRoles(
      key: ModuleKey.calendar,
      defaultLabel: 'Calendar',
      group: ModuleGroup.fleet,
      defaultRoles: <RoleId>{
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
    ),
    // --- Maintenance -------------------------------------------------------
    ModuleDef.forRoles(
      key: ModuleKey.accidents,
      defaultLabel: 'Accidents',
      group: ModuleGroup.maintenance,
      defaultRoles: <RoleId>{RoleId.manager, RoleId.director, RoleId.inspector},
    ),
    ModuleDef.forRoles(
      key: ModuleKey.reportAccident,
      defaultLabel: 'File Accident',
      group: ModuleGroup.maintenance,
      defaultRoles: <RoleId>{RoleId.manager, RoleId.director, RoleId.inspector},
    ),
    ModuleDef.adminOnly(
      key: ModuleKey.workorders,
      defaultLabel: 'Work Orders',
      group: ModuleGroup.maintenance,
    ),
    ModuleDef.forRoles(
      key: ModuleKey.rca,
      defaultLabel: 'Root Cause',
      group: ModuleGroup.maintenance,
      defaultRoles: <RoleId>{RoleId.manager, RoleId.director, RoleId.inspector},
    ),
    ModuleDef.forRoles(
      key: ModuleKey.tasks,
      defaultLabel: 'Tasks',
      group: ModuleGroup.maintenance,
      defaultRoles: <RoleId>{RoleId.manager, RoleId.director, RoleId.inspector},
    ),
    ModuleDef.forRoles(
      key: ModuleKey.stock,
      defaultLabel: 'Stock Count',
      group: ModuleGroup.maintenance,
      defaultRoles: <RoleId>{RoleId.manager, RoleId.inspector},
    ),
    ModuleDef.forRoles(
      key: ModuleKey.pm,
      defaultLabel: 'Maintenance Due',
      group: ModuleGroup.maintenance,
      defaultRoles: <RoleId>{RoleId.manager, RoleId.director},
    ),
    ModuleDef.forRoles(
      key: ModuleKey.workshop,
      defaultLabel: 'My Jobs',
      group: ModuleGroup.maintenance,
      defaultRoles: <RoleId>{
        RoleId.manager,
        RoleId.director,
        RoleId.inspector,
        RoleId.tyreMan,
        RoleId.mechanic,
        RoleId.electrician,
      },
    ),
    // --- Management --------------------------------------------------------
    // Every module in this group is a bulk listing or a report.
    ModuleDef.adminOnly(
      key: ModuleKey.overview,
      defaultLabel: 'Overview',
      group: ModuleGroup.management,
    ),
    ModuleDef.adminOnly(
      key: ModuleKey.reports,
      defaultLabel: 'Reports',
      group: ModuleGroup.management,
    ),
    ModuleDef.adminOnly(
      key: ModuleKey.analytics,
      defaultLabel: 'Analytics',
      group: ModuleGroup.management,
    ),
    ModuleDef.adminOnly(
      key: ModuleKey.stockManage,
      defaultLabel: 'Stock Management',
      group: ModuleGroup.management,
    ),
    ModuleDef.adminOnly(
      key: ModuleKey.ai,
      defaultLabel: 'Fleet AI',
      group: ModuleGroup.management,
    ),
    ModuleDef.adminOnly(
      key: ModuleKey.team,
      defaultLabel: 'Team',
      group: ModuleGroup.management,
    ),
    // --- Admin -------------------------------------------------------------
    // Approvals gates three queues (inspection, checklist, admin), so its role
    // list is the UNION of who the server will let act. Each screen and each
    // RPC still enforces its own rung: `decide_inspection_approval` admits a
    // different set from `checklist_is_supervisor`. Director is here for the
    // checklist FINAL rung only - exactly one person holds an area-manager
    // role, and a queue nobody else can clear jams the moment they take leave.
    ModuleDef.forRoles(
      key: ModuleKey.approvals,
      defaultLabel: 'Approvals',
      group: ModuleGroup.admin,
      defaultRoles: <RoleId>{
        RoleId.director,
        RoleId.maintenanceSupervisor,
        RoleId.workshopSupervisor,
        RoleId.pmvManager,
        RoleId.workshopAreaManager,
        RoleId.workshopMaintenanceAreaManager,
        RoleId.tyreDataCollector,
      },
    ),
    ModuleDef.adminOnly(
      key: ModuleKey.admin,
      defaultLabel: 'Admin Console',
      group: ModuleGroup.admin,
    ),
    ModuleDef.adminOnly(
      key: ModuleKey.users,
      defaultLabel: 'User Management',
      group: ModuleGroup.admin,
    ),
  ];

  /// Administration surfaces that fail CLOSED when permission data is
  /// unreliable.
  ///
  /// Everything else fails OPEN, and that asymmetry is deliberate: a transient
  /// permission-RPC failure must never strand a field user mid-shift, but it
  /// must never hand a non-administrator a user management console either.
  static const Set<ModuleKey> sensitive = <ModuleKey>{
    ModuleKey.admin,
    ModuleKey.users,
    ModuleKey.approvals,
  };

  static final Map<ModuleKey, ModuleDef> _byKey = <ModuleKey, ModuleDef>{
    for (final ModuleDef def in all) def.key: def,
  };

  /// The definition for [key].
  ///
  /// Throws [StateError] when a [ModuleKey] has no definition. That is a
  /// programming error, not a runtime condition: in the TypeScript app the
  /// equivalent gap left `MODULE_BY_KEY[key]` undefined and denied the whole
  /// fleet at runtime while compiling cleanly. Failing loudly is the point.
  static ModuleDef definitionFor(ModuleKey key) {
    final ModuleDef? def = _byKey[key];
    if (def == null) {
      throw StateError(
        'No ModuleDef for ModuleKey.${key.name}. Every enum value must have a '
        'row in ModuleRegistry.all.',
      );
    }
    return def;
  }

  /// Whether [key] must fail closed when permission data cannot be trusted.
  static bool isSensitive(ModuleKey key) => sensitive.contains(key);

  /// Modules in [group], in registry order.
  static List<ModuleDef> inGroup(ModuleGroup group) =>
      all.where((ModuleDef def) => def.group == group).toList(growable: false);
}
