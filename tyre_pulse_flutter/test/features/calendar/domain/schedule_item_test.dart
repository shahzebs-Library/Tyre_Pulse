library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/calendar/domain/schedule_item.dart';

void main() {
  final DateTime now = DateTime(2026, 8, 28, 19);

  ScheduleItem item(DateTime date) => ScheduleItem(
        id: 'task-1',
        kind: ScheduleKind.task,
        title: 'Repair leak',
        date: date,
      );

  test('calendar buckets use calendar-day boundaries', () {
    expect(item(DateTime(2026, 8, 27)).bucket(now), ScheduleBucket.overdue);
    expect(item(DateTime(2026, 8, 28)).bucket(now), ScheduleBucket.today);
    expect(item(DateTime(2026, 9, 4)).bucket(now), ScheduleBucket.week);
    expect(item(DateTime(2026, 9, 5)).bucket(now), ScheduleBucket.later);
  });
}
