/// The new company-assignment lane in the existing My Work screen.
/// Server-dependent status decisions are online-only and never silently queued.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';

final workforceAssignmentsRepositoryProvider =
    Provider<WorkforceAssignmentsRepository>((ref) {
  return WorkforceAssignmentsRepository(ref.watch(supabaseClientProvider));
});

final workforceAssignmentsProvider =
    FutureProvider.autoDispose<WorkforceAssignmentSnapshot>((ref) async {
  return ref.read(workforceAssignmentsRepositoryProvider).listMine();
});

class WorkforceAssignmentsPanel extends ConsumerWidget {
  const WorkforceAssignmentsPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = ref.watch(workforceAssignmentsProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Company assignments',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            snapshot.when(
              loading: () => const CircularProgressIndicator(),
              error: (error, stack) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Could not load assigned work.'),
                  TextButton(
                    onPressed: () =>
                        ref.invalidate(workforceAssignmentsProvider),
                    child: const Text('Retry'),
                  ),
                ],
              ),
              data: (snapshot) => snapshot.items.isEmpty
                  ? const Text('No company assignments recorded.')
                  : Column(
                      children: [
                        if (snapshot.offline)
                          const Padding(
                            padding: EdgeInsets.only(bottom: 8),
                            child: Text('Offline cached assignments. Status changes require a connection.'),
                          ),
                        ...snapshot.items.map((item) {
                        final next = item.nextAction;
                        return ListTile(
                          title: Text(item.title),
                          subtitle: Text(
                            '${item.site ?? 'Site unspecified'} · '
                            '${item.status} · ${item.priority}',
                          ),
                          trailing: next == null || snapshot.offline
                              ? null
                              : TextButton(
                                  onPressed: () async {
                                    try {
                                      await ref
                                          .read(workforceAssignmentsRepositoryProvider)
                                          .advance(item);
                                      ref.invalidate(
                                        workforceAssignmentsProvider,
                                      );
                                    } catch (_) {
                                      if (context.mounted) {
                                        ScaffoldMessenger.of(context).showSnackBar(
                                          const SnackBar(
                                            content: Text(
                                              'Update not confirmed. Reconnect and refresh.',
                                            ),
                                          ),
                                        );
                                      }
                                    }
                                  },
                                  child: Text(
                                    next == 'acknowledged'
                                        ? 'Acknowledge'
                                        : next == 'submitted'
                                            ? 'Submit'
                                            : 'Start',
                                  ),
                                ),
                        );
                      }),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
