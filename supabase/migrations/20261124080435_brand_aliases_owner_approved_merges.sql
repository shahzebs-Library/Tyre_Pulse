-- Owner-approved brand spelling merges (2026-11-24, "approve brand merge to production").
-- STATUS: APPLIED LIVE 2026-11-24 (ledger 20261124080435). Verified: brand_aliases 38 -> 60 rows, 22 new.
-- Aliases only: no stored brand text is rewritten; the alias tells matching which spellings mean one brand.
-- Not merged on purpose: REGFULDA (maybe Fulda, owner to check); serial numbers / numbers / test values typed
-- into brand fields are left for clean-up during audits.
-- Undo: delete from public.brand_aliases where alias in ('eraxle','tegrys','trgrys','tegrey','tegry','regrys',
--   'tringle','traingle','west lake','west lack','ling long','blackhawk','black hawk','bridge stone','perilli',
--   'perrly','rockbuster','rock buster','diamondback','diamond back','kunlun','kun lun');
insert into public.brand_aliases (alias, canonical) values
 ('eraxle','Eracle'),
 ('tegrys','Tegrys'),('trgrys','Tegrys'),('tegrey','Tegrys'),('tegry','Tegrys'),('regrys','Tegrys'),
 ('tringle','Triangle'),('traingle','Triangle'),
 ('west lake','Westlake'),('west lack','Westlake'),
 ('ling long','Linglong'),
 ('blackhawk','Blackhawk'),('black hawk','Blackhawk'),
 ('bridge stone','Bridgestone'),
 ('perilli','Pirelli'),('perrly','Pirelli'),
 ('rockbuster','Rock Buster'),('rock buster','Rock Buster'),
 ('diamondback','Diamondback'),('diamond back','Diamondback'),
 ('kunlun','Kunlun'),('kun lun','Kunlun')
on conflict (alias) do nothing;
