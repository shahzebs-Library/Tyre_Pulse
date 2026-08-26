import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

/// The drift guard.
///
/// A Dart registry plus the JS mirror (`src/lib/mobileModules.js`) plus the TS
/// registry (`mobile/lib/permissions.ts`) is three hand-maintained copies of
/// the same table, and artifact 04 section 3.4 says plainly: either generate
/// the Dart registry from one source, or port the text-parsing drift guard.
/// This is the port of `src/test/mobileModules.test.js`.
///
/// It reads the TypeScript as TEXT and parses the `M(...)` calls, exactly as
/// the JavaScript guard does, and for the same reason: a guard that IMPORTED
/// the registry would compare a value to itself. Two properties keep the
/// original honest and both are kept here:
///
/// 1. It asserts the parse found at least 25 modules, so a change to the
///    `M(...)` shape cannot make every later assertion pass vacuously.
/// 2. Because it parses text, the `approvals` entry must list its roles
///    LITERALLY. A spread would read as the characters `...SUPERVISOR_ROLES`
///    and the guard would compare a role name that does not exist. That is why
///    `SUPERVISOR_ROLES` is exported from the TypeScript and referenced only by
///    tests, and why the Dart registry lists those five roles literally too.
///
/// If the reference tree is not present, this test FAILS rather than skips. A
/// guard that quietly disappears is worse than no guard: the drift it exists to
/// catch would land unnoticed.
void main() {
  group('the Dart registry matches mobile/lib/permissions.ts', () {
    late final Map<String, _ParsedModule> parsed;

    setUpAll(() {
      final File source = _locateMobileRegistry();
      parsed = _parseModules(source.readAsStringSync());
    });

    test('the parse found the whole registry, not a fragment', () {
      // The vacuous-pass guard. Below 25 the M(...) shape has changed and
      // every comparison after this point would be comparing nothing.
      expect(
        parsed.length,
        greaterThanOrEqualTo(25),
        reason: 'only ${parsed.length} M(...) entries parsed. The registry '
            'shape in mobile/lib/permissions.ts has changed and this guard '
            'must be updated before it can be trusted again.',
      );
      expect(parsed.length, ModuleRegistry.all.length);
    });

    test('the same set of module keys, exactly', () {
      final Set<String> dartKeys =
          ModuleRegistry.all.map((ModuleDef d) => d.key.wireKey).toSet();
      final Set<String> tsKeys = parsed.keys.toSet();

      expect(
        dartKeys.difference(tsKeys),
        isEmpty,
        reason: 'these keys exist in Dart and not on the phone',
      );
      expect(
        tsKeys.difference(dartKeys),
        isEmpty,
        reason: 'these keys exist on the phone and not in Dart',
      );
    });

    test('the same role default for every module', () {
      for (final ModuleDef def in ModuleRegistry.all) {
        final _ParsedModule? source = parsed[def.key.wireKey];
        expect(source, isNotNull, reason: '${def.key.wireKey} is not in the TS');

        final Set<String> dartRoles =
            def.defaultRoles.map((RoleId r) => r.token).toSet();
        expect(
          dartRoles,
          source!.roles,
          reason: 'role default drift on ${def.key.wireKey}: Dart has '
              '$dartRoles, the phone has ${source.roles}',
        );
      }
    });

    test('an empty TS role list means the Dart module is marked admin-only',
        () {
      for (final ModuleDef def in ModuleRegistry.all) {
        final _ParsedModule source = parsed[def.key.wireKey]!;
        expect(
          def.isAdminOnly,
          source.roles.isEmpty,
          reason: '${def.key.wireKey}: roles: [] on the phone must be '
              'ModuleDef.adminOnly in Dart, and nothing else may be',
        );
      }
    });

    test('the same group and label for every module', () {
      for (final ModuleDef def in ModuleRegistry.all) {
        final _ParsedModule source = parsed[def.key.wireKey]!;
        expect(def.group.registryName, source.group,
            reason: 'group drift on ${def.key.wireKey}');
        expect(def.defaultLabel, source.label,
            reason: 'label drift on ${def.key.wireKey}');
      }
    });

    test('every role named by the phone is a role this app models', () {
      // A token on the phone with no RoleId here would be silently unmatched,
      // and the module would deny a real person.
      final Set<String> known =
          RoleId.values.map((RoleId r) => r.token).toSet();
      for (final _ParsedModule module in parsed.values) {
        for (final String role in module.roles) {
          expect(
            known,
            contains(role),
            reason: '${module.key} lists "$role", which is not in RoleId',
          );
        }
      }
    });
  });
}

class _ParsedModule {
  const _ParsedModule({
    required this.key,
    required this.label,
    required this.group,
    required this.roles,
  });

  final String key;
  final String label;
  final String group;
  final Set<String> roles;
}

/// `M('key', 'Label', 'icon', 'Group', ['role', ...])`.
///
/// Anchored to the start of a line so the arrow function that DEFINES `M`
/// cannot match, and dot-all so an entry split across lines still parses.
final RegExp _moduleCall = RegExp(
  r"^\s*M\(\s*'([A-Za-z]+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,"
  r"\s*'([^']*)'\s*,\s*\[([^\]]*)\]\s*\)",
  multiLine: true,
  dotAll: true,
);

final RegExp _quotedRole = RegExp(r"'([a-z_]+)'");

Map<String, _ParsedModule> _parseModules(String source) {
  final Map<String, _ParsedModule> out = <String, _ParsedModule>{};
  for (final RegExpMatch match in _moduleCall.allMatches(source)) {
    final String key = match.group(1)!;
    final Set<String> roles = _quotedRole
        .allMatches(match.group(5)!)
        .map((RegExpMatch m) => m.group(1)!)
        .toSet();
    out[key] = _ParsedModule(
      key: key,
      label: match.group(2)!,
      group: match.group(4)!,
      roles: roles,
    );
  }
  return out;
}

/// Walks up from the working directory looking for the reference tree.
///
/// `flutter test` runs with the package root as the working directory, so the
/// phone source is normally one level up. The walk covers a repository-root
/// working directory too.
File _locateMobileRegistry() {
  Directory dir = Directory.current;
  for (int i = 0; i < 6; i++) {
    final File candidate = File(
      '${dir.path}${Platform.pathSeparator}mobile'
      '${Platform.pathSeparator}lib'
      '${Platform.pathSeparator}permissions.ts',
    );
    if (candidate.existsSync()) {
      return candidate;
    }
    final Directory parent = dir.parent;
    if (parent.path == dir.path) {
      break;
    }
    dir = parent;
  }

  fail(
    'Could not find mobile/lib/permissions.ts by walking up from '
    '${Directory.current.path}. This guard compares the Dart module registry '
    'against the production phone registry and cannot run without it. If this '
    'package is being tested in isolation, the guard has to move to a '
    'repository-level CI step rather than be deleted.',
  );
}
