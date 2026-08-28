library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/tasks/data/tasks_repository.dart';

final Provider<TasksRepository> tasksRepositoryProvider =
    Provider<TasksRepository>(
  (ref) => SupabaseTasksRepository(ref.watch(supabaseClientProvider)),
);
