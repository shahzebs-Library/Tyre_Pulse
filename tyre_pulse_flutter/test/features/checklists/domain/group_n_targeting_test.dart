/// Parity group N - targeting. Cases N1-N8.
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10
/// group N, mirroring `mobile/__tests__/checklistTargeting.test.ts`'s
/// `describe('checklist role targeting', ...)` block (lines 31-92) - the
/// icon-resolution half of that file is a separate, presentation-layer
/// concern and is out of scope here, exactly as `checklist_marks.dart`'s
/// own library comment already establishes for icon tokens generally.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_targeting.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';

void main() {
  test('N1: NULL assignee_roles reaches everyone', () {
    // The exact live templates measured pre-V591, all with assignee_roles
    // NULL - if this ever fails, the back-compat promise V591 made has
    // been broken.
    final List<ChecklistTemplate> live = <ChecklistTemplate>[
      const ChecklistTemplate(name: 'a'),
      const ChecklistTemplate(name: 'Fleet Transit Mixer Checklist'),
      const ChecklistTemplate(name: 'Maint'),
      const ChecklistTemplate(name: 'PMD'),
      const ChecklistTemplate(name: 'Predictive Maintenance Checklist'),
      const ChecklistTemplate(name: 'Workshop Daily TM Inspection Checklist'),
    ];
    for (final String role in <String>[
      'tyre_man',
      'driver',
      'mechanic',
      'inspector',
      'reporter',
    ]) {
      expect(filterTemplatesForRole(live, role), hasLength(6));
      expect(templateTargetsEveryone(live.first), isTrue);
    }
  });

  test('N2: an empty array ALSO reaches everyone', () {
    const ChecklistTemplate t = ChecklistTemplate(assigneeRoles: <String>[]);
    expect(templateTargetsEveryone(t), isTrue);
    expect(templateAllowsRole(t, 'mechanic'), isTrue);
    expect(templateAllowsRole(t, null), isTrue);
  });

  test('N3: Title Case DB role matches lowercase app role', () {
    expect(normaliseRoleKey('Tyre Man'), 'tyre_man');
    expect(
      templateAllowsRole(
        const ChecklistTemplate(assigneeRoles: <String>['Tyre Man']),
        'tyre_man',
      ),
      isTrue,
    );
    expect(
      templateAllowsRole(
        const ChecklistTemplate(assigneeRoles: <String>['Maintenance Supervisor']),
        'maintenance_supervisor',
      ),
      isTrue,
    );
  });

  test('N4: the trades get their sheet, the driver gets theirs', () {
    const ChecklistTemplate workshop = ChecklistTemplate(
      name: 'Workshop daily',
      assigneeRoles: <String>['Mechanic', 'Electrician'],
    );
    const ChecklistTemplate driver = ChecklistTemplate(
      name: 'Pre-trip check',
      assigneeRoles: <String>['Driver'],
    );
    const ChecklistTemplate shared = ChecklistTemplate(name: 'Site safety');
    final List<ChecklistTemplate> all = <ChecklistTemplate>[workshop, driver, shared];

    expect(
      filterTemplatesForRole(all, 'mechanic').map((ChecklistTemplate t) => t.name),
      <String>['Workshop daily', 'Site safety'],
    );
    expect(
      filterTemplatesForRole(all, 'driver').map((ChecklistTemplate t) => t.name),
      <String>['Pre-trip check', 'Site safety'],
    );
    expect(templateAllowsRole(workshop, 'driver'), isFalse);
  });

  test('N5: oversight sees everything, a mechanic does not', () {
    const ChecklistTemplate t = ChecklistTemplate(assigneeRoles: <String>['Electrician']);
    expect(isOversightRole('manager'), isTrue);
    expect(templateAllowsRole(t, 'manager'), isTrue);
    expect(templateAllowsRole(t, 'director'), isTrue);
    expect(templateAllowsRole(t, 'mechanic'), isFalse);
    expect(templateAllowsRole(t, 'anything', isSuperAdmin: true), isTrue);
  });

  test('N6: a loading profile does NOT unlock a targeted sheet', () {
    expect(
      templateAllowsRole(
        const ChecklistTemplate(assigneeRoles: <String>['Mechanic']),
        null,
      ),
      isFalse,
    );
    expect(
      templateAllowsRole(
        const ChecklistTemplate(assigneeRoles: <String>['Mechanic']),
        '',
      ),
      isFalse,
    );
    // ...but an untargeted one still shows, so the list is never blank
    // while the profile is in flight.
    expect(templateAllowsRole(const ChecklistTemplate(), null), isTrue);
  });

  test('N7: a null assignment role stays open to all', () {
    final List<ChecklistAssignment> rows = <ChecklistAssignment>[
      const ChecklistAssignment(assigneeRole: 'Mechanic'),
      const ChecklistAssignment(assigneeRole: 'Driver'),
      const ChecklistAssignment(),
    ];
    expect(
      filterAssignmentsForRole(rows, 'mechanic'),
      <ChecklistAssignment>[rows[0], rows[2]],
    );
    expect(assignmentAllowsRole(rows[2], 'reporter'), isTrue);
    expect(assignmentAllowsRole(rows[1], 'mechanic'), isFalse);
  });

  test('N8: roleTargetLabel is null for an untargeted sheet', () {
    expect(roleTargetLabel(const ChecklistTemplate()), isNull);
    expect(
      roleTargetLabel(
        const ChecklistTemplate(assigneeRoles: <String>['Mechanic', 'Electrician']),
      ),
      'Mechanic, Electrician',
    );
  });
}
