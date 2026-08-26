import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';

void main() {
  group('coverage', () {
    test('every CommandType has a spec whose own type matches its map key', () {
      for (final CommandType type in CommandType.values) {
        expect(
          CommandRegistry.specs.containsKey(type),
          isTrue,
          reason: '$type has no registered CommandSpec',
        );
        expect(CommandRegistry.specFor(type).type, type);
      }
    });

    test('there are exactly 14 commands - 16 minus the two excluded', () {
      expect(CommandType.values, hasLength(14));
    });

    test('CHECKLIST_APPROVAL and REPAIR_REQUEST cannot be expressed', () {
      // There is no CommandType value for either, so this is really a
      // compile-time guarantee (CommandRegistry.specFor takes a CommandType,
      // not a String, and neither wire name below has a corresponding enum
      // value to construct). This test asserts the same fact at runtime, so
      // a future edit that widens the enum trips an assertion here too.
      final Set<String> wireNames =
          CommandType.values.map((CommandType t) => t.wireName).toSet();
      expect(wireNames.contains('CHECKLIST_APPROVAL'), isFalse);
      expect(wireNames.contains('REPAIR_REQUEST'), isFalse);
    });
  });

  group('wire names', () {
    test('match the RN CommandType string literal exactly', () {
      const Map<CommandType, String> expected = <CommandType, String>{
        CommandType.tyreChange: 'TYRE_CHANGE',
        CommandType.workOrder: 'WORK_ORDER',
        CommandType.rca: 'RCA',
        CommandType.reportIssue: 'REPORT_ISSUE',
        CommandType.stockAdjust: 'STOCK_ADJUST',
        CommandType.workOrderStatus: 'WORK_ORDER_STATUS',
        CommandType.correctiveActionStatus: 'CORRECTIVE_ACTION_STATUS',
        CommandType.checklistSubmission: 'CHECKLIST_SUBMISSION',
        CommandType.checklistAssignmentStatus: 'CHECKLIST_ASSIGNMENT_STATUS',
        CommandType.odometerLog: 'ODOMETER_LOG',
        CommandType.engineHoursLog: 'ENGINE_HOURS_LOG',
        CommandType.reportAccident: 'REPORT_ACCIDENT',
        CommandType.washRecord: 'WASH_RECORD',
        CommandType.workshopEvent: 'WORKSHOP_EVENT',
      };

      expect(expected, hasLength(CommandType.values.length));
      for (final MapEntry<CommandType, String> entry in expected.entries) {
        expect(entry.key.wireName, entry.value);
      }
    });
  });

  group('tables', () {
    test('every spec targets a table from the verified registry', () {
      for (final CommandSpec spec in CommandRegistry.specs.values) {
        expect(
          SupabaseTables.all.contains(spec.table),
          isTrue,
          reason: '${spec.type} targets "${spec.table}", which is not a '
              'verified table',
        );
      }
    });

    test('matches the RN table for each command', () {
      const Map<CommandType, String> expected = <CommandType, String>{
        CommandType.tyreChange: SupabaseTables.tyreRecords,
        CommandType.workOrder: SupabaseTables.workOrders,
        CommandType.rca: SupabaseTables.rcaRecords,
        CommandType.reportIssue: SupabaseTables.correctiveActions,
        CommandType.stockAdjust: SupabaseTables.stockRecords,
        CommandType.workOrderStatus: SupabaseTables.workOrders,
        CommandType.correctiveActionStatus: SupabaseTables.correctiveActions,
        CommandType.checklistSubmission: SupabaseTables.checklistSubmissions,
        CommandType.checklistAssignmentStatus:
            SupabaseTables.checklistAssignments,
        CommandType.odometerLog: SupabaseTables.odometerLogs,
        CommandType.engineHoursLog: SupabaseTables.engineHoursLogs,
        CommandType.reportAccident: SupabaseTables.accidents,
        CommandType.washRecord: SupabaseTables.washRecords,
        CommandType.workshopEvent: SupabaseTables.techActivityEvents,
      };

      for (final MapEntry<CommandType, String> entry in expected.entries) {
        expect(CommandRegistry.specFor(entry.key).table, entry.value);
      }
    });
  });

  group('update commands', () {
    const Set<CommandType> updateTypes = <CommandType>{
      CommandType.stockAdjust,
      CommandType.workOrderStatus,
      CommandType.correctiveActionStatus,
      CommandType.checklistAssignmentStatus,
    };

    test('are exactly these four, matched on "id"', () {
      for (final CommandType type in updateTypes) {
        final CommandSpec spec = CommandRegistry.specFor(type);
        expect(spec.operation, CommandOperation.update, reason: '$type');
        expect(spec.matchColumn, 'id', reason: '$type');
        expect(
          spec.fieldAllowList.contains('id'),
          isTrue,
          reason: '$type must allow-list its own match column',
        );
      }
    });

    test('every other command is an insert with no match column', () {
      for (final CommandType type in CommandType.values) {
        if (updateTypes.contains(type)) {
          continue;
        }
        final CommandSpec spec = CommandRegistry.specFor(type);
        expect(spec.operation, CommandOperation.insert, reason: '$type');
        expect(spec.matchColumn, isNull, reason: '$type');
      }
    });

    test('carry the expected prior status, except STOCK_ADJUST', () {
      const Set<CommandType> statusMatched = <CommandType>{
        CommandType.workOrderStatus,
        CommandType.correctiveActionStatus,
        CommandType.checklistAssignmentStatus,
      };

      for (final CommandType type in updateTypes) {
        final CommandSpec spec = CommandRegistry.specFor(type);
        expect(
          spec.requiresOptimisticStatusMatch,
          statusMatched.contains(type),
          reason: '$type: absolute-value STOCK_ADJUST is the one exception',
        );
      }
    });

    test('STOCK_ADJUST fields are exactly the RN allow-list', () {
      const Set<String> expected = <String>{
        'id',
        'stock_qty',
        'stock_status',
        'updated_by',
        'updated_at',
      };
      expect(
        CommandRegistry.specFor(CommandType.stockAdjust).fieldAllowList,
        expected,
      );
    });

    test('WORK_ORDER_STATUS fields are exactly the RN allow-list', () {
      expect(
        CommandRegistry.specFor(CommandType.workOrderStatus).fieldAllowList,
        <String>{'id', 'status', 'started_at', 'completed_at'},
      );
    });

    test('CORRECTIVE_ACTION_STATUS fields are exactly the RN allow-list', () {
      expect(
        CommandRegistry.specFor(CommandType.correctiveActionStatus)
            .fieldAllowList,
        <String>{'id', 'status', 'closed_at'},
      );
    });

    test(
      'CHECKLIST_ASSIGNMENT_STATUS fields are exactly the RN allow-list',
      () {
        expect(
          CommandRegistry.specFor(CommandType.checklistAssignmentStatus)
              .fieldAllowList,
          <String>{'id', 'status', 'submission_id', 'completed_at'},
        );
      },
    );
  });

  group('requiresMediaReady', () {
    test('is true only for TYRE_CHANGE and CHECKLIST_SUBMISSION', () {
      const Set<CommandType> expected = <CommandType>{
        CommandType.tyreChange,
        CommandType.checklistSubmission,
      };

      for (final CommandType type in CommandType.values) {
        expect(
          CommandRegistry.specFor(type).requiresMediaReady,
          expected.contains(type),
          reason: '$type',
        );
      }
    });
  });

  group('field allow-lists', () {
    test(
      'CHECKLIST_SUBMISSION keeps the V212 signatures and notes columns',
      () {
        final Set<String> fields = CommandRegistry.specFor(
          CommandType.checklistSubmission,
        ).fieldAllowList;
        expect(fields.contains('signatures'), isTrue);
        expect(fields.contains('notes'), isTrue);
        expect(fields.contains('approval_status'), isTrue);
      },
    );

    // Artifact 06 section 2 describes TYRE_CHANGE as carrying "widest
    // allow-list" among the commands, but the live `recordQueue.ts` shows
    // REPORT_ACCIDENT (54 fields, the field-parity capture added to mirror
    // the web incident form) is considerably wider than TYRE_CHANGE
    // (25 fields). This test pins the measured counts rather than the
    // artifact's prose claim - see the final report for this finding.
    test('TYRE_CHANGE has 25 allow-listed fields', () {
      expect(
        CommandRegistry.specFor(CommandType.tyreChange).fieldAllowList.length,
        25,
      );
    });

    test('REPORT_ACCIDENT is actually the widest allow-list, at 54 fields', () {
      final int widest = CommandRegistry.specs.values
          .map((CommandSpec s) => s.fieldAllowList.length)
          .reduce((int a, int b) => a > b ? a : b);
      expect(
        CommandRegistry.specFor(CommandType.reportAccident)
            .fieldAllowList
            .length,
        widest,
      );
      expect(widest, 54);
    });

    test('no allow-list is empty', () {
      for (final CommandSpec spec in CommandRegistry.specs.values) {
        expect(spec.fieldAllowList, isNotEmpty, reason: '${spec.type}');
      }
    });
  });
}
