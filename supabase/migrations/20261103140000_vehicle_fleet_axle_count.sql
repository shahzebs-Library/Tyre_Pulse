-- Axle count per vehicle, so the tyre diagram draws the machine actually in
-- the yard. Concrete pumps come as 4-axle (12 tyres: 2 single steer + 2 twin
-- drive) and 5-axle (14 tyres: 3 single steer + 2 twin drive); the vehicle type
-- (PUMPS) cannot tell them apart.
--
-- Source: owner file "PUMPS AXLES.xlsx" (2026-11-03), 60 KSA pumps. The same
-- MP number in UAE/Egypt is a different machine (V376), so only KSA rows are set.
-- Null = not recorded; the diagram then uses the type's default layout.
-- Rollback: alter table public.vehicle_fleet drop column axle_count;

alter table public.vehicle_fleet
  add column if not exists axle_count smallint
  check (axle_count is null or axle_count between 1 and 10);

comment on column public.vehicle_fleet.axle_count is
  'Axles on this machine where the type alone does not say (e.g. 4- vs 5-axle concrete pumps). Drives the tyre diagram layout. Null = default for the type.';

update public.vehicle_fleet f
   set axle_count = v.axles
  from (values ('MP049',4),('MP068',4),('MP071',4),('MP072',4),('MP073',4),('MP074',4),('MP075',4),('MP076',4),('MP077',4),('MP078',4),('MP079',5),('MP080',5),('MP081',5),('MP082',5),('MP083',5),('MP084',5),('MP085',5),('MP086',5),('MP087',5),('MP088',5),('MP090',5),('MP091',5),('MP092',5),('MP093',5),('MP094',5),('MP095',5),('MP097',5),('MP098',5),('MP099',5),('MP100',5),('MP101',5),('MP102',5),('MP104',5),('MP107',5),('MP110',5),('MP111',5),('MP112',5),('MP113',5),('MP114',5),('MP115',5),('MP116',5),('MP117',5),('MP118',5),('MP119',5),('MP120',5),('MP121',5),('MP122',5),('MP123',5),('MP124',5),('MP125',5),('MP126',5),('MP127',5),('MP128',5),('MP129',5),('MP130',5),('MP131',5),('MP132',5),('MP150',5),('MP151',5),('MP152',5)) as v(asset_no, axles)
 where f.country = 'KSA'
   and upper(btrim(f.asset_no)) = v.asset_no
   and f.axle_count is distinct from v.axles;
