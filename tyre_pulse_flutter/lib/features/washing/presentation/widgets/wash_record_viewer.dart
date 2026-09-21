import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/domain/wash_details.dart';

class WashRecordViewer extends ConsumerWidget {
  const WashRecordViewer({required this.wash, super.key});
  final WashRecord wash;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    Widget detail(String title, String? value) => ListTile(
          dense: true,
          title: Text(title),
          subtitle:
              Text(value?.isNotEmpty == true ? value! : l.washNotRecorded),
        );
    return Scaffold(
      appBar: AppBar(title: Text('${l.washViewRecord} · ${wash.assetNo}')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          detail(
            l.washEnteredByLabel,
            wash.entryName ?? wash.entryUsername ?? wash.createdBy,
          ),
          detail(l.washReceivedAt, wash.createdAt),
          detail(l.washTypeLabel, wash.washType),
          detail(l.washStatusLabel, wash.status),
          detail(l.washSiteLabel, wash.site),
          detail(l.washOperatorLabel, wash.washedBy),
          Text(
            l.washChemicalUseLabel,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if (detailItems(wash.washDetails, 'chemicals').isEmpty)
            Text(
              wash.washDetails?['chemical_status'] == 'none'
                  ? l.washNoChemical
                  : l.washNotRecorded,
            ),
          for (final c in detailItems(wash.washDetails, 'chemicals'))
            detail(
              c['name'] as String? ?? '',
              ['manufacturer', 'quantity', 'unit', 'dilution', 'sds_url']
                  .map((k) => c[k] as String? ?? '')
                  .where((s) => s.isNotEmpty)
                  .join(' · '),
            ),
          const SizedBox(height: 16),
          Text(
            l.washChecklistTitle,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if (detailItems(wash.washDetails, 'checklist').isEmpty)
            Text(l.washNotRecorded),
          for (final c in detailItems(wash.washDetails, 'checklist'))
            detail(
              washCheckLabel(l, c['label'] as String? ?? ''),
              [
                washResultLabels(l)[c['result']] ?? l.washNotChecked,
                c['note'] as String? ?? '',
              ].where((s) => s.isNotEmpty).join(' · '),
            ),
          if (wash.notes != null) detail(l.washNotesLabel, wash.notes),
          const SizedBox(height: 16),
          Text(
            l.washPhotosLabel,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          for (final photo in wash.photos ?? <String>[])
            ref.watch(privateStorageImageUrlProvider(photo)).when(
                  data: (url) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Image.network(
                      url,
                      fit: BoxFit.contain,
                      errorBuilder: (_, error, stack) =>
                          Text(l.washRecentLoadErrorMessage),
                    ),
                  ),
                  error: (error, stack) => Text(l.washRecentLoadErrorMessage),
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                ),
        ],
      ),
    );
  }
}
