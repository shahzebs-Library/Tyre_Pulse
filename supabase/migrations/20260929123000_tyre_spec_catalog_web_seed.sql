-- Tyre spec catalogue: source columns + seed from published product listings.
--
-- 1. tyre_spec_catalog gains source_url + source_note so every catalogue row
--    says where its figures came from.
-- 2. Seeds one PENDING row per brand + pattern + size the fleet actually runs
--    (top brand + size combinations in tyre_records, grouped by country), for
--    Company A. A manager approves each row in the app. Idempotent: an existing
--    brand + pattern + size + country row is skipped.
--
-- Only values printed on a published product listing are stored: pattern,
-- position when the listing names it, load index, speed symbol and ply rating.
-- Width, aspect ratio and rim come from the size designation itself. Max load
-- single/dual is derived from the published load index using the standard
-- ETRTO load index table and the note says so. Tread depth, overall diameter,
-- section width, inflation and weight are LEFT BLANK: the manufacturer
-- datasheets could not be opened from this environment (network policy), and
-- nothing is invented. Fill them from the datasheet before approving.

alter table public.tyre_spec_catalog add column if not exists source_url text;
alter table public.tyre_spec_catalog add column if not exists source_note text;

with seed(country, brand, pattern, size, tyre_type, li_s, li_d, speed, ply, application, url, note) as (
  values
  ('KSA','TEGRYS','TE48-S','315/80R22.5','steer',156,150,'L',null,'Steer, regional (M+S, 3PMSF)','https://www.bigtyres.co.uk/tyres/brands/tegrys/te48-s/315-80r22-5-tegrys-te48-s-tl-steer-156-150l-154-150m-3pmsf-m-s','Listing also shows alternate 154/150M.'),
  ('KSA','TEGRYS','TE48-D','315/80R22.5','drive',156,150,'L',null,'Drive, regional (M+S, 3PMSF)','https://www.bigtyres.co.uk/tyres/brands/tegrys/te48-d/315-80r22-5-tegrys-te48-d-tl-drive-156-150l-154-150m-3pmsf-m-s','Listing also shows alternate 154/150M.'),
  ('KSA','TRIANGLE','TR688','315/80R22.5','drive',157,154,'L','20PR','Drive, open shoulder','https://www.prioritytire.com/by-brand/triangle-tires/triangle-tr688/315-80r22-5-157-154l-l-20-ply-307752',null),
  ('UAE','TRIANGLE','TR688','315/80R22.5','drive',157,154,'L','20PR','Drive, open shoulder','https://www.prioritytire.com/by-brand/triangle-tires/triangle-tr688/315-80r22-5-157-154l-l-20-ply-307752',null),
  ('KSA','TRIANGLE','TR668','315/80R22.5',null,157,154,'L','20PR',null,'https://budgettrucktires.com/products/315-80r22-5-20pr-157-154l-triangle-tr668-tl','Position not stated on the listing.'),
  ('KSA','ERACLE','E.R80S','315/80R22.5',null,null,null,null,null,'On/off road','https://protiremart.com/construction-tires/tire-3753700/','Load index not printed on the listing.'),
  ('KSA','DOUBLECOIN','RR202','315/80R22.5',null,157,154,'L','20PR',null,'https://www.prioritytire.com/by-brand/double-coin-tires/rr202/315-80r22-5-157-154l-l-20-ply-70849','Position not stated on the listing.'),
  ('KSA','PIRELLI','FG:01 II','315/80R22.5',null,156,150,'K',null,'On/off road (M+S, 3PMSF)','https://www.tyreleader.ie/truck-tyres/pirelli/fg-01-ii/315-80-r22-5-156-150k-1784774','Also listed at https://shop.fastparts.is/en/product/tire-31580r22.5-pirelli-fg01-ii-156150k-40849'),
  ('Egypt','PIRELLI','FG:01 II','315/80R22.5',null,156,150,'K',null,'On/off road (M+S, 3PMSF)','https://www.tyreleader.ie/truck-tyres/pirelli/fg-01-ii/315-80-r22-5-156-150k-1784774',null),
  ('Egypt','PIRELLI','FW:01','315/80R22.5',null,156,150,'L',null,'M+S, 3PMSF','https://www.heuver.com/webshop/product/b31580225pilfw101/315-80r22-5-pirelli-fw-01-156-150l-154m-tl-m-s-3pmsf','Listing also shows alternate 154M.'),
  ('KSA','INFINITY','KTD300','315/80R22.5','drive',156,150,'L','20PR','Drive','https://www.arnoldclarkautoparts.com/products/infinity-ktd300-315-80r22-5-dr-156-150l-20p-tyre','Listing also shows alternate 154/150M.'),
  ('KSA','JINYU','JF568','315/80R22.5','steer',156,150,'L','20PR','Steer','https://bigrusstyres.co.uk/tyre/jinyu-3302002338/31580r225-jinyu-jf568-st-156150l-20pr/details','Some EU listings show 156/153L for the same pattern.'),
  ('KSA','SAILUN','SDR1','315/80R22.5',null,156,150,'L','18PR',null,'https://www.pencoedtyres.com/products/product/315-80r22-5-sailun-sdr1-156-150l-154-150m--18-pr-tl-974-2377','Position not stated on the listing.'),
  ('KSA','WESTLAKE','CR976A','315/80R22.5','other',null,null,null,'20PR','All position','https://www.sears.com/westlake-6-tires-westlake-cr976a-315-80r22.5-load-l-20-ply-all-position-commercial/p-A127752553','Load range L. Load index not printed on the listing.'),
  ('UAE','ROADX','RH621','315/80R22.5','steer',156,153,'L','20PR','All position, mainly steer','https://www.tiremart.com/roadx-rh621-315-80r22-5-156-153l-l-20-ply-as-a-s-all-season-tire/','An 18PR 156/150L variant is also listed at https://rehvid.com/truck-tires/summer-tires/31580r225-rh621-jf568-156150l-18pr-roadx'),
  ('UAE','LONGMARCH','LM519','315/80R22.5','other',null,null,null,null,'All position','https://www.halfpricetires.com/315-80-225--Longmarch-LM519-All-Position-Tire_p_766.html','Load index not printed on the listing.'),
  ('UAE','LONGMARCH','LM216','315/80R22.5',null,null,null,'L','20PR',null,'https://www.tiremart.com/longmarch-lm-216-315-80r22-5-l-20-ply-as-a-s-all-season-tire','Load range L. Load index not printed on the listing.'),
  ('KSA','TRIANGLE','TR697','385/65R22.5',null,158,null,'L','20PR',null,'https://www.tiremart.com/triangle-tr697-385-65r22-5-158l-l-20-ply/',null),
  ('KSA','TRIANGLE','TRT02','385/65R22.5','trailer',160,158,'L','20PR','Trailer','https://otrusa.com/products/385-65r22-5-20pr-160-158l-triangle-trt02-tl','Printed as 160/158L.'),
  ('KSA','ERACLE','ER70-T','385/65R22.5','trailer',160,158,'K',null,'Trailer, regional (M+S)','https://www.heuver.com/product/10003564/385-65r22-5-eracle-er-70t-160-158k-tl-m-s','Printed as 160/158K. Also listed at https://www.tiremart.com/eracle-er70-t-385-65r22-5-160k-all-weather-tire/'),
  ('KSA','DOUBLECOIN','RR905','385/65R22.5',null,null,null,null,'20PR','Mixed service wide base','https://www.tires-easy.com/385-65-22.5/double-coin-tires/rr905/tirecode/1133608258','Load range L. Load index not printed on the listing.'),
  ('KSA','PIRELLI','ST:01','385/65R22.5','trailer',160,null,'K',null,'Trailer (M+S, 3PMSF)','https://www.heuver.com/product/b38565225piks1t05/385-65r22-5-pirelli-st-01-triathlon-160k-158l-tl-m-s-3pmsf','Printed as 160K (158L). ST:01 Triathlon.'),
  ('Egypt','PIRELLI','ST:01','385/65R22.5','trailer',160,null,'K',null,'Trailer (M+S, 3PMSF)','https://www.heuver.com/product/b38565225piks1t05/385-65r22-5-pirelli-st-01-triathlon-160k-158l-tl-m-s-3pmsf','Printed as 160K (158L). ST:01 Triathlon.'),
  ('UAE','LONGMARCH','LM168','385/65R22.5',null,160,null,'K','20PR',null,'https://www.tyres-outlet.co.uk/product/longmarch/lm168/385-65-r22.5/r-314500','Also listed as 160(158) K(L) at https://www.baltyre.com/en/catalog/product/show/13169'),
  ('UAE','LONGMARCH','LM526','385/65R22.5',null,null,null,null,'20PR',null,'https://www.probec-intl.com/en/385-65r22-5-20pr-tl-lm526-longmarch-22-818','Retailers disagree on the position (steer or trailer), so it is left blank.'),
  ('UAE','FIREMAX','FM07','385/65R22.5','trailer',160,null,'L','20PR','Trailer','https://www.ship-ship.ru/product/firemax-fm07-385-65-r22-5-160l-20pr-tl-pritsepnye/',null),
  ('UAE','FIREMAX','FM06','385/65R22.5',null,160,null,'L','20PR','Steer or trailer','https://mosshina.com/catalog/shini-dlja-gruzovikov/firemax/38565r22-5-firemax-fm06-160l-20pr-tl-pricep/',null),
  ('KSA','HANKOOK','Smart Flex TH31','235/75R17.5',null,143,141,'J','18PR','Regional (3PMSF)','https://www.prioritytire.com/by-brand/hankook-tires/smart-flex-th31/235-75r17-5-143-141j-j-18-ply-25691','Load range J.'),
  ('KSA','LINGLONG','LB01N','23.5R25','off_road',185,null,'B',null,'E-3 loader/earthmover','https://otrusa.com/products/23-5r25-185b-201a2-linglong-lb01n-e-3-tl-ll','Printed as 185B/201A2 (201 is the A2 low-speed rating, not a dual load).')
),
li(idx, kg) as (values (141,2575),(143,2725),(150,3350),(153,3650),(154,3750),(156,4000),(157,4125),(158,4250),(160,4500),(185,9250)),
parsed as (
  select s.*,
    nullif(substring(s.size from '^(\d{3})/'),'')::numeric as w,
    nullif(substring(s.size from '/(\d{2})R'),'')::numeric as ar,
    nullif(substring(s.size from 'R(\d+(?:\.\d+)?)$'),'')::numeric as rim
  from seed s
)
insert into public.tyre_spec_catalog
  (organisation_id, country, brand, pattern, size, width_mm, aspect_ratio, rim_in, tyre_type,
   load_index_single, load_index_dual, speed_rating, ply_rating, tube_type, application,
   max_load_single_kg, max_load_dual_kg, approval_status, approval_note, source_url, source_note)
select '00000000-0000-0000-0000-000000000001'::uuid, p.country, p.brand, p.pattern, p.size,
  p.w, p.ar, p.rim, p.tyre_type, p.li_s, p.li_d, p.speed, p.ply, 'tubeless', p.application,
  ls.kg, ld.kg, 'pending',
  'Seeded from a published product listing. Check tread depth, diameter and inflation against the manufacturer datasheet before approving.',
  p.url,
  concat_ws(' ', p.note,
    case when p.li_s is not null then 'Max load derived from the published load index (standard ETRTO load index table).' end)
from parsed p
left join li ls on ls.idx = p.li_s
left join li ld on ld.idx = p.li_d
where not exists (
  select 1 from public.tyre_spec_catalog c
  where c.organisation_id = '00000000-0000-0000-0000-000000000001'::uuid
    and coalesce(c.country,'') = p.country
    and upper(btrim(c.brand)) = upper(p.brand)
    and upper(btrim(c.pattern)) = upper(p.pattern)
    and upper(regexp_replace(c.size,'\s','','g')) = upper(p.size)
);
