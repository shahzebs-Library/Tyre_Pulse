library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/notifications/data/app_notification_dto.dart';

void main() {
  test('decodes the verified notifications columns without inventing values',
      () {
    final AppNotificationDto dto = AppNotificationDto.fromRow(
      <String, dynamic>{
        'id': 'notification-1',
        'user_id': 'user-1',
        'type': 'closure_request',
        'title': 'Accident closure requested',
        'body': 'Asset PMV-21 requires review.',
        'entity_type': 'accident',
        'entity_id': 'accident-8',
        'read': true,
        'created_at': '2026-08-28T08:30:00Z',
      },
    );

    final row = dto.toDomain();
    expect(row.id, 'notification-1');
    expect(row.userId, 'user-1');
    expect(row.isRead, isTrue);
    expect(row.entityType, 'accident');
    expect(row.entityId, 'accident-8');
    expect(row.createdAt, DateTime.utc(2026, 8, 28, 8, 30));
  });

  test('nullable text and invalid timestamps degrade honestly', () {
    final row = AppNotificationDto.fromRow(<String, dynamic>{
      'id': 'n-2',
      'user_id': 'u-2',
      'title': '  ',
      'read': null,
      'created_at': 'not-a-date',
    }).toDomain();

    expect(row.title, isNull);
    expect(row.isRead, isFalse);
    expect(row.createdAt.millisecondsSinceEpoch, 0);
  });
}
