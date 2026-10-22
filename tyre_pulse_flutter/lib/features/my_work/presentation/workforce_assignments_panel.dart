/// Company assignments in the existing My Work screen.
///
/// Changes are sent online; failed writes never pretend to be queued.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';

final workforceAssignmentsProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final client = ref.read(supabaseClientProvider);
  final id = client.auth.currentUser?.id;
  if (id == null) throw StateError('Not signed in');
  final rows = await client
      .from('workforce_assignments')
      .select('id,title,instructions,site,status,priority,due_at')
      .eq('assigned_to', id)
      .order('created_at', ascending: false)
      .limit(100);
  return List<Map<String, dynamic>>.from(rows);
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
              data: (items) => items.isEmpty
                  ? const Text('No company assignments recorded.')
                  : Column(
                      children: items.map((item) {
                        final status =
                            item['status']?.toString() ?? 'assigned';
                        final next = switch (status) {
                          'assigned' => 'acknowledged',
                          'acknowledged' => 'in_progress',
                          'in_progress' => 'submitted',
                          'blocked' => 'in_progress',
                          _ => null,
                        };
                        return ListTile(
                          title: Text(
                            item['title']?.toString() ??
                                'Untitled assignment',
                          ),
                          subtitle: Text(
                            "${item['site'] ?? 'Site unspecified'} · $status · ${item['priority'] ?? 'normal'}",
                          ),
                          trailing: next == null
                              ? null
                              : TextButton(
                                  onPressed: () async {
                                    try {
                                      await ref
                                          .read(supabaseClientProvider)
                                          .from('workforce_assignments')
                                          .update({'status': next}).eq(
                                        'id',
                                        item['id'],
                                      );
                                      ref.invalidate(
                                        workforceAssignmentsProvider,
                                      );
                                    } catch (_) {
                                      if (context.mounted) {
                                        ScaffoldMessenger.of(
                                          context,
                                        ).showSnackBar(
                                          const SnackBar(
                                            content: Text(
                                              'Update was not sent. Reconnect and retry.',
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
                      }).toList(),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
