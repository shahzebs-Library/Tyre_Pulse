# Fleet artwork provenance and use

These files are presentation references only. They are never used as fleet
master data, and they do not imply that a vehicle is a particular make or
model. `vehicle_photo_resolver.dart` may select branded artwork only when the
real `vehicle_fleet.make` or `vehicle_fleet.model` identifies that brand.

## Existing bundled artwork

The image files in this directory pre-date this provenance note. Their original
source and redistribution licence were not recorded in the repository. Treat
them as internal Tyre Pulse product-identification assets; do not redistribute
them independently or claim OEM endorsement.

The resolver currently has positive make/model mappings for:

- `ashok_bus_fleet.jpeg` — Ashok Leyland bus records only.
- `tata_bus_fleet.jpeg` — Tata bus records only.
- `hiace_fleet.jpeg` — Toyota/Hiace records only.
- `mitsubishi_double_cab_front.jpeg` — Mitsubishi/L200 records only.
- `tata_xenon_double_cab.jpeg` — Tata/Xenon records only.
- `wheel_loader.png`, `generator_fleet.jpeg`,
  `batching_plant_fleet.jpeg`, `stationary_pump_fleet.jpeg`, and
  `towable_pump_fleet.jpeg` — SANY records only.
- `skid_loader_fleet.jpeg` — CAT/Caterpillar records only.
- `chiller_fleet.jpeg` — Snowkey records only.
- `industrial_chiller_fleet.jpeg` — LG industrial-chiller records only.

Unknown, missing, or conflicting brands intentionally use a class icon instead
of borrowing another manufacturer's picture.

## Appearance references checked on 1 September 2026

The following official OEM pages were used only to verify product identity and
body class; no file was downloaded from them because their pages do not grant a
reusable asset licence:

- Toyota UAE Hiace: https://www.toyota.ae/en/new-cars/hiace/
- Ashok Leyland UAE buses: https://www.ashokleyland.com/ae/buses
- Carrier commercial chillers: https://www.carrier.com/commercial/en/kw/products/commercial/chillers/

Freely licensed alternatives were also evaluated but not imported because they
did not match the fleet's exact model/body:

- Toyota Hiace photograph, CC BY 2.0:
  https://commons.wikimedia.org/wiki/File:Toyota_Hiace_(50548637511).jpg
- Ashok Leyland photograph, CC BY-SA 3.0:
  https://commons.wikimedia.org/wiki/File:Ashok_Leyland.jpg

When adding a new brand, record its exact source URL, author, licence, any crop
or background removal, and the make/model matcher in this file.
