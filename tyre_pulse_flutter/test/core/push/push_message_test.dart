import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/push/push_message.dart';

void main() {
  PushMessage msg(Map<String, String> data) => PushMessage(data: data);

  group('PushMessage.destination uses the one notification mapping', () {
    test('an inspection approval push opens the approval queue', () {
      expect(
        msg(<String, String>{
          'type': 'workflow.step_advanced',
          'entity_type': 'inspection',
        }).destination,
        const InspectionApprovalsRoute(),
      );
    });

    test('an accident push with an id opens that accident', () {
      expect(
        msg(<String, String>{
          'type': 'accident.stage_changed',
          'entity_type': 'accident',
          'entity_id': 'a-1',
        }).destination,
        const AccidentDetailRoute(accidentId: AccidentId('a-1')),
      );
    });

    test('a checklist approval push opens the checklist approvals', () {
      expect(
        msg(<String, String>{'entity_type': 'checklist_submission'})
            .destination,
        const ChecklistApprovalsRoute(),
      );
    });

    test('a workshop assignment opens the workshop board', () {
      expect(
        msg(<String, String>{'type': 'workflow.assigned'}).destination,
        const WorkshopRoute(),
      );
    });

    test('an unknown push falls back to the notifications inbox', () {
      expect(
        msg(<String, String>{'type': 'something_new'}).destination,
        const NotificationsRoute(),
      );
      expect(
        msg(const <String, String>{}).destination,
        const NotificationsRoute(),
      );
    });

    test('event_type stands in for a missing type; blanks are ignored', () {
      final PushMessage m = msg(<String, String>{
        'type': '  ',
        'event_type': 'inspection_reminder',
        'entity_id': ' ',
      });
      expect(m.target.type, 'inspection_reminder');
      expect(m.target.entityId, isNull);
      expect(m.destination, const NewInspectionRoute());
    });
  });
}
