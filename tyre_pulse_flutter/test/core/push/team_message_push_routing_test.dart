import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/push/push_message.dart';
import 'package:tyre_pulse/app/router/routes.dart';

void main() {
  group('Message the Team FCM routes', () {
    test(
        'broadcast with exact entity ID enters notification inbox for detail handoff',
        () {
      const msg = PushMessage(messageId: 'fcm-123', data: <String, String>{
        'event_type': 'broadcast.sent',
        'entity_type': 'broadcast',
        'entity_id': '24b1ab94-bcc3-49c8-a32b-ef71cbd06312',
      });
      expect(msg.target.id, '24b1ab94-bcc3-49c8-a32b-ef71cbd06312');
      expect(msg.destination.location, const NotificationsRoute().location);
    });

    test('assigned action retains its task ID and opens inbox', () {
      const msg = PushMessage(messageId: 'fcm-456', data: <String, String>{
        'event_type': 'action.assigned',
        'entity_type': 'action_item',
        'entity_id': '44b1ab94-bcc3-49c8-a32b-ef71cbd06312',
      });
      expect(msg.target.id, '44b1ab94-bcc3-49c8-a32b-ef71cbd06312');
      expect(msg.destination.location, const NotificationsRoute().location);
    });

    test('unknown push falls back to inbox safely', () {
      const msg = PushMessage(data: <String, String>{'event_type': 'unknown'});
      expect(msg.destination.location, const NotificationsRoute().location);
    });
  });
}
