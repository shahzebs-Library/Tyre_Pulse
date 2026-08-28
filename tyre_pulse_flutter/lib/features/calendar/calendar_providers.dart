library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/calendar/data/calendar_repository.dart';
import 'package:tyre_pulse/features/calendar/domain/schedule_item.dart';

final Provider<CalendarRepository> calendarRepositoryProvider =
    Provider<CalendarRepository>((Ref ref) {
  return SupabaseCalendarRepository(ref.watch(supabaseClientProvider));
});

final FutureProvider<List<ScheduleItem>> calendarItemsProvider =
    FutureProvider<List<ScheduleItem>>((Ref ref) {
  return ref.watch(calendarRepositoryProvider).list(
        country: ref.watch(activeCountryProvider),
      );
});
