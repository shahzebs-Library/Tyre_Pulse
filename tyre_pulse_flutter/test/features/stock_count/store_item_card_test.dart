import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/stock_count/domain/store_item_card.dart';

void main() {
  test('a bin parses quantity, reserved, code and available', () {
    final StoreItemBin b = StoreItemBin.fromJson(const <String, Object?>{
      'id': 's1',
      'site': 'DEMO YARD',
      'stock_qty': 10,
      'qty_reserved': '3',
      'condition': 'new',
      'location': <String, Object?>{'code': 'A-01', 'name': 'Rack A'},
    });
    expect(b.stockId, 's1');
    expect(b.quantity, 10);
    expect(b.reserved, 3);
    expect(b.available, 7);
    expect(b.locationCode, 'A-01');
  });

  test('totals add up every bin and available never goes below zero', () {
    const StoreItemCard card = StoreItemCard(
      stockId: 's1',
      name: 'Valve',
      bins: <StoreItemBin>[
        StoreItemBin(stockId: 'a', quantity: 5, reserved: 8),
        StoreItemBin(stockId: 'b', quantity: 4, reserved: 1),
      ],
    );
    expect(card.totalQuantity, 9);
    expect(card.totalReserved, 9);
    expect(card.totalAvailable, 3);
    expect(card.linked, isFalse);
  });

  test('brand prefers the catalogue, then the linked part number, then ERP',
      () {
    const StorePartNumber p = StorePartNumber(
      id: 'v1',
      status: 'active',
      brand: 'Bosch',
    );
    expect(
      const StoreItemCard(
        stockId: 's',
        name: 'n',
        bins: <StoreItemBin>[],
        itemBrand: 'ERP',
        catalogue: StoreCatalogueEntry(
          id: 'c',
          description: 'd',
          status: 'active',
          brand: 'Cat',
        ),
      ).brand,
      'Cat',
    );
    expect(
      const StoreItemCard(
        stockId: 's',
        name: 'n',
        bins: <StoreItemBin>[],
        itemBrand: 'ERP',
        linkedVariantId: 'v1',
        partNumbers: <StorePartNumber>[p],
      ).brand,
      'Bosch',
    );
    expect(
      const StoreItemCard(
        stockId: 's',
        name: 'n',
        bins: <StoreItemBin>[],
        itemBrand: 'ERP',
      ).brand,
      'ERP',
    );
  });

  test('part numbers and references parse their approval state', () {
    final StorePartNumber p = StorePartNumber.fromJson(const <String, Object?>{
      'id': 'v1',
      'brand': 'Bosch',
      'part_number': '0 986',
      'status': 'proposed',
    });
    expect(p.verified, isFalse);
    expect(p.classification, 'unknown');
    final StoreItemReference r =
        StoreItemReference.fromJson(const <String, Object?>{
      'alias_type': 'barcode',
      'value': '6291',
      'verified': true,
      'ref_status': 'historical',
    });
    expect(r.verified, isTrue);
    expect(r.historical, isTrue);
  });

  test('the ERP barcode is listed once, before the others', () {
    const StoreItemCard card = StoreItemCard(
      stockId: 's',
      name: 'n',
      bins: <StoreItemBin>[],
      itemBarcode: '111',
      references: <StoreItemReference>[
        StoreItemReference(type: 'barcode', value: '111'),
        StoreItemReference(type: 'barcode', value: '222'),
        StoreItemReference(type: 'oem', value: 'X-1'),
      ],
    );
    expect(
      card.barcodes.map((StoreItemReference r) => r.value),
      <String>['111', '222'],
    );
    expect(card.otherNumbers.single.value, 'X-1');
  });

  test('a pending correction reads its new value', () {
    final StorePendingChange c =
        StorePendingChange.fromJson(const <String, Object?>{
      'topic': 'brand',
      'new_value': <String, Object?>{'brand': 'Mann'},
    });
    expect(c.topic, 'brand');
    expect(c.newValue, 'Mann');
  });

  test('brands merge case-insensitively, keep the first spelling, sort', () {
    expect(
      mergeBrands(<List<String?>>[
        <String?>['Bosch', null, ' '],
        <String?>['bosch', 'Mann', 'ACDelco'],
      ]),
      <String>['ACDelco', 'Bosch', 'Mann'],
    );
    expect(filterBrands(<String>['Bosch', 'Mann'], 'os'), <String>['Bosch']);
    expect(filterBrands(<String>['Bosch'], ''), <String>['Bosch']);
  });

  test('photo paths stay under the company folder', () {
    expect(
      storeItemPhotoPath('org-1', 'p1'),
      'physical_inventory/org-1/material/p1.jpg',
    );
    expect(
      storeItemPhotoRef('physical_inventory/org-1/material/p1.jpg'),
      'tp-storage://tyre-photos/physical_inventory/org-1/material/p1.jpg',
    );
  });
}
