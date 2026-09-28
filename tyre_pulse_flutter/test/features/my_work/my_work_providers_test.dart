import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_plan_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_plan.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/my_work_providers.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/tasks/data/tasks_repository.dart';
import 'package:tyre_pulse/features/tasks/tasks_providers.dart';

import 'my_work_test_support.dart';

class _FakeTasksRepository implements TasksRepository {
  _FakeTasksRepository(this.rows);

  final List<TaskItem> rows;
  final List<String> assignees = <String>[];
  final List<String?> countries = <String?>[];
  int recentCalls = 0;

  @override
  Future<List<TaskItem>> listRecent({String? country, int limit = 200}) async {
    recentCalls++;
    return rows;
  }

  @override
  Future<List<TaskItem>> listAssignedTo({
    required String assignee,
    String? country,
    int limit = kTasksAssignedPage,
  }) async {
    assignees.add(assignee);
    countries.add(country);
    return tasksAssignedTo(rows, assignee).take(limit).toList();
  }
}

class _FakePlanRepository implements InspectionPlanRepository {
  _FakePlanRepository(this.page);

  final InspectionPlanPage page;

  @override
  Future<InspectionPlanPage> myPlans({
    required String assignedTo,
    String? country,
    int daysBack = kPlanDaysBack,
    int daysAhead = kPlanDaysAhead,
    DateTime? now,
  }) async =>
      page;
}

WorkspaceContext _workspace({String? fullName = 'Field Operator'}) =>
    WorkspaceContext(
      userId: 'user-1',
      role: const UserRole.known(RoleId.admin),
      effectivePermissions: myWorkAdminAccess,
      countryScope: CountryScope.none,
      siteScope: SiteScope.none,
      activeCountry: 'UAE',
      fullName: fullName,
    );

void main() {
  group('myWorkGatewayProvider', () {
    late _FakeTasksRepository tasks;
    late InspectionPlanPage planPage;

    ProviderContainer container({String? fullName = 'Field Operator'}) {
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          accessStateProvider.overrideWithValue(
            const AccessState(role: UserRole.known(RoleId.admin)),
          ),
          workspaceContextProvider
              .overrideWithValue(_workspace(fullName: fullName)),
          tasksRepositoryProvider.overrideWithValue(tasks),
          inspectionPlanRepositoryProvider
              .overrideWithValue(_FakePlanRepository(planPage)),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    setUp(() {
      tasks = _FakeTasksRepository(const <TaskItem>[
        TaskItem(id: 'a', title: 'Mine', assignedTo: 'Field Operator'),
        TaskItem(id: 'b', title: 'Colleague', assignedTo: 'Eng Vinay'),
      ]);
      planPage = const InspectionPlanPage.empty();
    });

    test('reads corrective actions assigned to the signed-in name only',
        () async {
      final MyWorkGateway gateway = container().read(myWorkGatewayProvider);
      final MyWorkPage<TaskItem> page = await gateway.correctiveActions!();

      expect(tasks.assignees, <String>['Field Operator']);
      expect(tasks.countries, <String?>['UAE']);
      expect(tasks.recentCalls, 0, reason: 'the unscoped read is not used');
      expect(page.items.map((TaskItem t) => t.id), <String>['a']);
      expect(page.truncated, isFalse);
    });

    test('a full corrective page is flagged as truncated', () async {
      tasks = _FakeTasksRepository(<TaskItem>[
        for (int i = 0; i < kTasksAssignedPage; i++)
          TaskItem(id: 't$i', title: 'Task $i', assignedTo: 'Field Operator'),
      ]);
      final MyWorkPage<TaskItem> page =
          await container().read(myWorkGatewayProvider).correctiveActions!();
      expect(page.truncated, isTrue);
    });

    test('a profile with no name does not read corrective actions', () {
      final MyWorkGateway gateway =
          container(fullName: null).read(myWorkGatewayProvider);
      expect(gateway.correctiveActions, isNull);
      expect(tasks.assignees, isEmpty);
    });

    test('keeps the plan RPC row-ceiling signal', () async {
      planPage = InspectionPlanPage(
        plans: <InspectionPlan>[
          InspectionPlan(
            id: 'p1',
            assetNo: 'PUMP-014',
            scheduledDate: DateTime.utc(2026, 8, 28),
            state: InspectionPlanState.due,
          ),
        ],
        truncated: true,
      );
      final MyWorkPage<InspectionPlan> page =
          await container().read(myWorkGatewayProvider).inspectionPlans!();
      expect(page.items, hasLength(1));
      expect(page.truncated, isTrue);
    });
  });
}
