import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/search/domain/search_result.dart';

void main() {
  group('AssetSearchResult', () {
    test('title is the asset number', () {
      const AssetSearchResult result = AssetSearchResult(assetNo: 'TM514');
      expect(result.title, 'TM514');
    });

    test('subtitle joins vehicle type and site when both are present', () {
      const AssetSearchResult result = AssetSearchResult(
        assetNo: 'TM514',
        vehicleType: 'Tr-Mixer',
        site: 'NHC',
      );
      expect(result.subtitle, 'Tr-Mixer - NHC');
    });

    test(
        'subtitle drops a blank field rather than showing an empty '
        'segment', () {
      const AssetSearchResult result = AssetSearchResult(
        assetNo: 'TM514',
        vehicleType: '',
        site: 'NHC',
      );
      expect(result.subtitle, 'NHC');
    });

    test(
        'subtitle falls back to the kind label when nothing else is '
        'populated', () {
      const AssetSearchResult result = AssetSearchResult(assetNo: 'TM514');
      expect(result.subtitle, 'Asset');
    });

    test('kindLabel', () {
      const AssetSearchResult result = AssetSearchResult(assetNo: 'TM514');
      expect(result.kindLabel, 'Asset');
    });
  });

  group('TyreSearchResult', () {
    test('title is the serial number', () {
      const TyreSearchResult result = TyreSearchResult(
        serialNo: 'EP0604207',
      );
      expect(result.title, 'EP0604207');
    });

    test('subtitle joins brand, asset and position, in that order', () {
      const TyreSearchResult result = TyreSearchResult(
        serialNo: 'EP0604207',
        brand: 'Michelin',
        assetNo: 'TM514',
        position: 'LHF1',
      );
      expect(result.subtitle, 'Michelin - TM514 - LHF1');
    });

    test('subtitle falls back to the kind label with nothing else recorded',
        () {
      const TyreSearchResult result = TyreSearchResult(
        serialNo: 'EP0604207',
      );
      expect(result.subtitle, 'Tyre');
    });
  });

  group('WorkOrderSearchResult', () {
    test('title prefers the human-readable work order number', () {
      const WorkOrderSearchResult result = WorkOrderSearchResult(
        id: 'row-1',
        workOrderNo: 'WO-2026-0042',
      );
      expect(result.title, 'WO-2026-0042');
    });

    test(
        'title falls back to the server row id when no work order number '
        'was decoded', () {
      const WorkOrderSearchResult result = WorkOrderSearchResult(id: 'row-1');
      expect(result.title, 'row-1');
    });

    test('subtitle joins asset and status', () {
      const WorkOrderSearchResult result = WorkOrderSearchResult(
        id: 'row-1',
        assetNo: 'TM514',
        status: 'Open',
      );
      expect(result.subtitle, 'TM514 - Open');
    });

    test(
        'subtitle falls back to the kind label with neither field '
        'recorded', () {
      const WorkOrderSearchResult result = WorkOrderSearchResult(id: 'row-1');
      expect(result.subtitle, 'Work order');
    });
  });

  group('InspectionSearchResult', () {
    test(
        'title is the server row id - an inspection has no other '
        'reference field', () {
      const InspectionSearchResult result = InspectionSearchResult(
        id: 'insp-1',
      );
      expect(result.title, 'insp-1');
    });

    test('subtitle joins asset, site and date, in that order', () {
      const InspectionSearchResult result = InspectionSearchResult(
        id: 'insp-1',
        assetNo: 'TM514',
        site: 'NHC',
        inspectionDate: '2026-08-01',
      );
      expect(result.subtitle, 'TM514 - NHC - 2026-08-01');
    });

    test(
        'subtitle falls back to the kind label with nothing else '
        'recorded', () {
      const InspectionSearchResult result = InspectionSearchResult(
        id: 'insp-1',
      );
      expect(result.subtitle, 'Inspection');
    });
  });

  test(
      'every subtype is a SearchResultItem, so a result list can render '
      'uniformly without switching on the concrete type', () {
    const List<SearchResultItem> items = <SearchResultItem>[
      AssetSearchResult(assetNo: 'TM514'),
      TyreSearchResult(serialNo: 'EP0604207'),
      WorkOrderSearchResult(id: 'row-1'),
      InspectionSearchResult(id: 'insp-1'),
    ];
    for (final SearchResultItem item in items) {
      expect(item.title, isNotEmpty);
      expect(item.subtitle, isNotEmpty);
      expect(item.kindLabel, isNotEmpty);
    }
  });
}
