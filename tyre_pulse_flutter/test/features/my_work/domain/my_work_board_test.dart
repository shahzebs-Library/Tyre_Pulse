import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_plan.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_board.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_item.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';

final DateTime now = DateTime(2026, 8, 28, 10, 5);

ChecklistDraftHeader draft(String key, {String? assignment}) =>
    ChecklistDraftHeader(
      draftKey: key,
      templateId: 't1',
      templateName: 'Daily check',
      templateVersion: 1,
      assetNo: 'CP-045',
      filled: 8,
      total: 18,
      updatedAt: DateTime(2026, 8, 28, 9),
      assignmentId: assignment,
    );

void main() {
  group('checklist assignments', () {
    test('date-only due: today, overdue by days, upcoming', () {
      final List<MyWorkItem> items = buildMyWork(
        now: now,
        assignments: const <ChecklistAssignmentRecord>[
          ChecklistAssignmentRecord(
            id: 'a',
            templateId: 't1',
            dueDate: '2026-08-28',
            status: 'pending',
          ),
          ChecklistAssignmentRecord(
            id: 'b',
            templateId: 't1',
            dueDate: '2026-08-25',
            status: 'pending',
          ),
          ChecklistAssignmentRecord(
            id: 'c',
            templateId: 't1',
            dueDate: '2026-09-01',
            status: 'pending',
          ),
          ChecklistAssignmentRecord(id: 'd', status: 'skipped'),
          ChecklistAssignmentRecord(
            id: 'e',
            dueDate: '2026-08-28',
            status: 'completed',
          ),
        ],
      );
      final Map<String, MyWorkItem> byId = <String, MyWorkItem>{
        for (final MyWorkItem i in items) i.id: i,
      };
      expect(byId['checklist:a']!.state, MyWorkState.dueToday);
      expect(byId['checklist:a']!.dueAt, isNull, reason: 'no invented time');
      expect(byId['checklist:b']!.state, MyWorkState.overdue);
      expect(
        (latenessOf(byId['checklist:b']!, now)! as LateByDays).days,
        3,
      );
      expect(byId['checklist:c']!.state, MyWorkState.upcoming);
      expect(byId.containsKey('checklist:d'), isFalse);
      expect(byId['checklist:e']!.state, MyWorkState.completed);
      expect(items.first.id, 'checklist:b', reason: 'worst first');
    });

    test('a draft for an open assignment is folded in, not listed twice', () {
      final List<MyWorkItem> items = buildMyWork(
        now: now,
        assignments: const <ChecklistAssignmentRecord>[
          ChecklistAssignmentRecord(
            id: 'a',
            templateId: 't1',
            dueDate: '2026-08-28',
          ),
        ],
        drafts: <ChecklistDraftHeader>[
          draft('k1', assignment: 'a'),
          draft('k2'),
        ],
      );
      expect(items, hasLength(2));
      final MyWorkItem a =
          items.firstWhere((MyWorkItem i) => i.id == 'checklist:a');
      expect(a.state, MyWorkState.inProgress);
      expect(a.draftKey, 'k1');
      expect(a.answered, 8);
      expect(a.total, 18);
      expect(items.any((MyWorkItem i) => i.id == 'draft:k2'), isTrue);
    });
  });

  test('inspection plan with a time is late by minutes, cancelled dropped', () {
    final List<MyWorkItem> items = buildMyWork(
      now: now,
      plans: <InspectionPlan>[
        InspectionPlan(
          id: 'p1',
          assetNo: 'PUMP-014',
          scheduledDate: DateTime.utc(2026, 8, 28),
          state: InspectionPlanState.due,
          inspectionTime: '09:30',
        ),
        InspectionPlan(
          id: 'p2',
          assetNo: 'PUMP-015',
          scheduledDate: DateTime.utc(2026, 8, 28),
          state: InspectionPlanState.cancelled,
        ),
      ],
    );
    expect(items, hasLength(1));
    expect(items.single.state, MyWorkState.overdue);
    expect((latenessOf(items.single, now)! as LateByMinutes).minutes, 35);
  });

  test('work orders and corrective actions map honestly', () {
    final List<MyWorkItem> items = buildMyWork(
      now: now,
      workOrders: const <WorkshopJob>[
        WorkshopJob(id: 'w1', workOrderNo: 'WO-1', status: 'In Progress'),
      ],
      correctiveActions: const <TaskItem>[
        TaskItem(id: 'c1', title: 'Fix', status: 'Closed'),
      ],
    );
    final MyWorkItem wo = items.firstWhere((MyWorkItem i) => i.id == 'wo:w1');
    expect(wo.state, MyWorkState.inProgress);
    expect(wo.title, isNull, reason: 'no title column is read');
    expect(wo.reference, 'WO-1');
    expect(
      items.firstWhere((MyWorkItem i) => i.id == 'ca:c1').state,
      MyWorkState.completed,
    );
  });

  test('itemsForDay keeps overdue work on today only', () {
    final List<MyWorkItem> items = buildMyWork(
      now: now,
      assignments: const <ChecklistAssignmentRecord>[
        ChecklistAssignmentRecord(id: 'late', dueDate: '2026-08-26'),
        ChecklistAssignmentRecord(id: 'tomorrow', dueDate: '2026-08-29'),
      ],
    );
    expect(
      itemsForDay(items, day: now, now: now).map((MyWorkItem i) => i.id),
      <String>['checklist:late'],
    );
    expect(
      itemsForDay(items, day: DateTime(2026, 8, 29), now: now)
          .map((MyWorkItem i) => i.id),
      <String>['checklist:tomorrow'],
    );
  });

  test('templateLanguages lists only languages a field carries', () {
    const ChecklistTemplate template = ChecklistTemplate(
      fields: <ChecklistField>[
        ChecklistField(
          id: 'f',
          type: 'text',
          label: 'Brakes',
          labels: <String, String>{'ar': 'الفرامل', 'ur': '  '},
        ),
      ],
    );
    expect(templateLanguages(template), <String>{'en', 'ar'});
  });

  test('search matches title, asset and site', () {
    const MyWorkItem item = MyWorkItem(
      id: 'x',
      kind: MyWorkKind.checklist,
      state: MyWorkState.upcoming,
      title: 'Daily check',
      assetNo: 'CP-045',
      site: 'Al Quoz',
    );
    expect(myWorkMatches(item, 'cp-0'), isTrue);
    expect(myWorkMatches(item, 'quoz'), isTrue);
    expect(myWorkMatches(item, 'bus'), isFalse);
  });
}
