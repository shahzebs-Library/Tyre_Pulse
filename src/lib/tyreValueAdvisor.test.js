import { describe, it, expect } from 'vitest';
import {
  LIFECYCLE_DEFAULTS,
  optionEconomics,
  rankOptions,
  recommend,
} from './tyreValueAdvisor.js';

const DASH_RX = /[‒–—―→←↔‘’“”·]/;

function scanStrings(obj, hit) {
  if (obj == null) return;
  if (typeof obj === 'string') { if (DASH_RX.test(obj)) hit.push(obj); return; }
  if (Array.isArray(obj)) { obj.forEach((v) => scanStrings(v, hit)); return; }
  if (typeof obj === 'object') { Object.values(obj).forEach((v) => scanStrings(v, hit)); }
}

describe('LIFECYCLE_DEFAULTS', () => {
  it('exposes target km and retread yield', () => {
    expect(LIFECYCLE_DEFAULTS.targetKm).toBe(150000);
    expect(LIFECYCLE_DEFAULTS.retreadYield).toBe(0.9);
  });
});

describe('optionEconomics', () => {
  it('lifecycle CPK is lower than new CPK when retreadable with retreads', () => {
    const e = optionEconomics({
      brand: 'Michelin', unit_price: 2000, expected_life_km: 100000,
      retreadable: true, retread_count: 2, retread_cost_pct: 0.4,
    });
    expect(e.newCpk).toBeGreaterThan(0);
    expect(e.lifecycleCpk).toBeGreaterThan(0);
    expect(e.lifecycleCpk).toBeLessThan(e.newCpk);
    // lifecycleKm = 100000 * (1 + 2*0.9) = 280000
    expect(e.lifecycleKm).toBe(280000);
    expect(e.retreads).toBe(2);
    expect(e.valid).toBe(true);
  });

  it('casing_value reduces lifecycle cost', () => {
    const base = { brand: 'X', unit_price: 1000, expected_life_km: 100000, retreadable: false };
    const withCasing = optionEconomics({ ...base, casing_value: 150 });
    const noCasing = optionEconomics(base);
    expect(withCasing.lifecycleCost).toBe(850);
    expect(noCasing.lifecycleCost).toBe(1000);
    expect(withCasing.lifecycleCpk).toBeLessThan(noCasing.lifecycleCpk);
  });

  it('floors lifecycle cost at zero and guards divide-by-zero', () => {
    const e = optionEconomics({ unit_price: 100, expected_life_km: 0, casing_value: 999 });
    expect(e.valid).toBe(false);
    expect(e.newCpk).toBeNull();
    expect(e.lifecycleCost).toBe(0);
  });

  it('computes warranty cover percent', () => {
    const e = optionEconomics({ unit_price: 1000, expected_life_km: 100000, warranty_km: 50000 });
    expect(e.warrantyCoverPct).toBe(50);
  });

  it('realizedByBrand grounding sets high confidence and negative variance when quote beats history', () => {
    const e = optionEconomics(
      { brand: 'Double Coin', unit_price: 1000, expected_life_km: 100000 }, // newCpk = 0.01
      { realizedByBrand: { 'double coin': { avgCpk: 0.02, avgLifeKm: 90000, count: 5 } } }
    );
    expect(e.confidence).toBe('high');
    expect(e.realizedCount).toBe(5);
    expect(e.variancePct).toBeLessThan(0); // quote cheaper than realized
  });

  it('sets moderate confidence when realized count is low, guidance when absent', () => {
    const mod = optionEconomics(
      { brand: 'BrandA', unit_price: 1000, expected_life_km: 100000 },
      { realizedByBrand: { branda: { avgCpk: 0.008, avgLifeKm: 95000, count: 1 } } }
    );
    expect(mod.confidence).toBe('moderate');
    expect(mod.variancePct).toBeGreaterThan(0); // quote pricier per km than history
    const guid = optionEconomics({ brand: 'BrandB', unit_price: 1000, expected_life_km: 100000 });
    expect(guid.confidence).toBe('guidance');
    expect(guid.realizedCpk).toBeNull();
  });
});

describe('rankOptions', () => {
  const options = [
    // Cheap short-life: low sticker but poor CPK and fails life gate.
    { id: 'cheap', brand: 'Budget', unit_price: 700, expected_life_km: 40000, retreadable: false },
    // Pricier long-life low-CPK winner.
    { id: 'value', brand: 'Premium', unit_price: 2000, expected_life_km: 160000, retreadable: true, retread_count: 1, warranty_km: 80000 },
    // Mid competitive.
    { id: 'mid', brand: 'Mid', unit_price: 1500, expected_life_km: 120000, retreadable: false, warranty_km: 40000 },
  ];

  it('does not crown a cheap short-life option as best value', () => {
    const { best } = rankOptions(options);
    expect(best).toBeTruthy();
    expect(best.id).not.toBe('cheap');
    expect(best.id).toBe('value');
    expect(best.bestValue).toBe(true);
  });

  it('marks budget and premium by sticker price', () => {
    const { ranked } = rankOptions(options);
    const budget = ranked.find((e) => e.budget);
    const premium = ranked.find((e) => e.premium);
    expect(budget.id).toBe('cheap');
    expect(premium.id).toBe('value');
  });

  it('bestDeal picks the cheapest competitive option', () => {
    const deals = [
      { id: 'a', brand: 'A', unit_price: 2000, expected_life_km: 160000, retreadable: true, retread_count: 1, warranty_km: 60000 },
      { id: 'b', brand: 'B', unit_price: 1900, expected_life_km: 155000, retreadable: true, retread_count: 1, warranty_km: 60000 },
    ];
    const { ranked } = rankOptions(deals);
    const deal = ranked.find((e) => e.bestDeal);
    expect(deal).toBeTruthy();
    expect(deal.id).toBe('b'); // cheaper sticker, still competitive on CPK
  });

  it('returns invalid options appended after valid ones', () => {
    const withInvalid = [...options, { id: 'bad', brand: 'Z', unit_price: 0, expected_life_km: 0 }];
    const { ranked, count } = rankOptions(withInvalid);
    expect(count).toBe(3);
    expect(ranked[ranked.length - 1].id).toBe('bad');
  });

  it('defaults currency to SAR and picks first supplied currency', () => {
    expect(rankOptions(options).currency).toBe('SAR');
    const usd = rankOptions([{ ...options[1], currency: 'USD' }, options[2]]);
    expect(usd.currency).toBe('USD');
  });
});

describe('recommend', () => {
  const options = [
    { id: 'cheap', brand: 'Budget', size: '11R22.5', unit_price: 700, expected_life_km: 40000, retreadable: false },
    { id: 'value', brand: 'Double Coin', size: 'REM-8', unit_price: 2000, expected_life_km: 160000, retreadable: true, retread_count: 2, warranty_km: 80000, casing_value: 200 },
    { id: 'mid', brand: 'Mid', size: 'G2', unit_price: 1500, expected_life_km: 120000, retreadable: false, warranty_km: 40000 },
  ];

  it('returns hasEnoughData false for fewer than two valid options', () => {
    const r = recommend([{ id: 'only', brand: 'Solo', unit_price: 1000, expected_life_km: 100000 }]);
    expect(r.hasEnoughData).toBe(false);
    expect(r.pick).toBeNull();
    expect(r.headline).toMatch(/at least two/i);
    expect(Array.isArray(r.rationale)).toBe(true);
  });

  it('picks the lowest lifecycle CPK option with a real headline and rationale', () => {
    const r = recommend(options, {
      realizedByBrand: { 'double coin': { avgCpk: 0.02, avgLifeKm: 150000, count: 6 } },
    });
    expect(r.hasEnoughData).toBe(true);
    expect(r.pick.id).toBe('value');
    expect(r.headline).toContain('Double Coin');
    expect(r.headline).toContain('SAR/km');
    expect(r.rationale.length).toBeGreaterThanOrEqual(4);
    expect(r.rationale.length).toBeLessThanOrEqual(7);
    expect(r.savingsVsPremiumPct).toBeGreaterThan(0);
    expect(r.pick.confidence).toBe('high');
  });

  it('explicitly calls out a cheaper sticker that loses on CPK', () => {
    const r = recommend(options);
    const joined = r.rationale.join(' ');
    expect(joined.toLowerCase()).toContain('cheaper');
    expect(joined.toLowerCase()).toMatch(/per km|false economy/);
  });

  it('produces no em dashes, arrows, or curly quotes anywhere in the output', () => {
    const r = recommend(options, {
      realizedByBrand: { 'double coin': { avgCpk: 0.02, avgLifeKm: 150000, count: 6 } },
    });
    const hits = [];
    scanStrings(r, hits);
    expect(hits).toEqual([]);
  });

  it('empty output for no options is honest', () => {
    const r = recommend([]);
    expect(r.hasEnoughData).toBe(false);
    const hits = [];
    scanStrings(r, hits);
    expect(hits).toEqual([]);
  });
});
