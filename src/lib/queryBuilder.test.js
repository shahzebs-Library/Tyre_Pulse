import { describe, it, expect } from 'vitest';
import {
  QUERY_OPERATORS,
  operatorLabel,
  normalizeFilter,
  describeFilter,
  isValidOperator,
  coerceValue,
} from './queryBuilder.js';

describe('QUERY_OPERATORS', () => {
  it('exposes the exact supported operator set in order', () => {
    expect(QUERY_OPERATORS.map((o) => o.key)).toEqual([
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'ilike',
    ]);
    expect(QUERY_OPERATORS.find((o) => o.key === 'ilike').label).toBe('contains');
  });
});

describe('isValidOperator', () => {
  it('accepts supported keys', () => {
    expect(isValidOperator('eq')).toBe(true);
    expect(isValidOperator('ilike')).toBe(true);
    expect(isValidOperator('gte')).toBe(true);
  });

  it('rejects unknown or non-string keys', () => {
    expect(isValidOperator('like')).toBe(false);
    expect(isValidOperator('')).toBe(false);
    expect(isValidOperator(null)).toBe(false);
    expect(isValidOperator(undefined)).toBe(false);
    expect(isValidOperator(5)).toBe(false);
  });
});

describe('operatorLabel', () => {
  it('returns the friendly label for a known op', () => {
    expect(operatorLabel('eq')).toBe('equals');
    expect(operatorLabel('neq')).toBe('not equal');
    expect(operatorLabel('gte')).toBe('at least');
    expect(operatorLabel('lte')).toBe('at most');
    expect(operatorLabel('ilike')).toBe('contains');
  });

  it('falls back to the raw op when unknown', () => {
    expect(operatorLabel('weird')).toBe('weird');
  });

  it('never throws on bad input', () => {
    expect(operatorLabel(null)).toBe('');
    expect(operatorLabel(undefined)).toBe('');
    expect(operatorLabel(123)).toBe('');
  });
});

describe('normalizeFilter', () => {
  it('returns a cleaned filter for valid input, trimming strings', () => {
    expect(
      normalizeFilter({ table: '  tyre_records ', column: ' site ', op: 'ilike', value: ' NHC ' })
    ).toEqual({ table: 'tyre_records', column: 'site', op: 'ilike', value: 'NHC' });
  });

  it('coerces numeric and boolean values to strings', () => {
    expect(normalizeFilter({ table: 't', column: 'km', op: 'gte', value: 100000 })).toEqual({
      table: 't',
      column: 'km',
      op: 'gte',
      value: '100000',
    });
    expect(normalizeFilter({ table: 't', column: 'active', op: 'eq', value: true })).toEqual({
      table: 't',
      column: 'active',
      op: 'eq',
      value: 'true',
    });
  });

  it('returns null for invalid operators', () => {
    expect(normalizeFilter({ table: 't', column: 'c', op: 'like', value: 'x' })).toBeNull();
    expect(normalizeFilter({ table: 't', column: 'c', op: '', value: 'x' })).toBeNull();
  });

  it('returns null when table or column is missing or blank', () => {
    expect(normalizeFilter({ table: '', column: 'c', op: 'eq', value: 'x' })).toBeNull();
    expect(normalizeFilter({ table: '   ', column: 'c', op: 'eq', value: 'x' })).toBeNull();
    expect(normalizeFilter({ table: 't', column: '', op: 'eq', value: 'x' })).toBeNull();
    expect(normalizeFilter({ table: 't', op: 'eq', value: 'x' })).toBeNull();
  });

  it('allows an empty value only for ilike', () => {
    expect(normalizeFilter({ table: 't', column: 'c', op: 'ilike', value: '' })).toEqual({
      table: 't',
      column: 'c',
      op: 'ilike',
      value: '',
    });
    expect(normalizeFilter({ table: 't', column: 'c', op: 'eq', value: '' })).toBeNull();
    expect(normalizeFilter({ table: 't', column: 'c', op: 'gt', value: '   ' })).toBeNull();
  });

  it('returns null for non-object input without throwing', () => {
    expect(normalizeFilter(null)).toBeNull();
    expect(normalizeFilter(undefined)).toBeNull();
    expect(normalizeFilter('nope')).toBeNull();
    expect(normalizeFilter(42)).toBeNull();
  });
});

describe('describeFilter', () => {
  it('describes a valid filter in plain English', () => {
    expect(describeFilter({ table: 't', column: 'site', op: 'ilike', value: 'NHC' })).toBe(
      'site contains NHC'
    );
    expect(describeFilter({ table: 't', column: 'km', op: 'gte', value: 100000 })).toBe(
      'km at least 100000'
    );
  });

  it('uses a friendly column label when provided (array form)', () => {
    expect(
      describeFilter(
        { table: 't', column: 'site', op: 'eq', value: 'NHC' },
        { columns: [{ key: 'site', label: 'Site' }] }
      )
    ).toBe('Site equals NHC');
  });

  it('uses a friendly column label when provided (map form)', () => {
    expect(
      describeFilter(
        { table: 't', column: 'site', op: 'eq', value: 'NHC' },
        { columns: { site: 'Site' } }
      )
    ).toBe('Site equals NHC');
  });

  it('returns a friendly message when there is no valid filter', () => {
    expect(describeFilter(null)).toBe('Showing all rows');
    expect(describeFilter({ table: 't', column: 'c', op: 'eq', value: '' })).toBe(
      'Showing all rows'
    );
    expect(describeFilter(undefined, {})).toBe('Showing all rows');
  });

  it('describes an empty ilike as any value without throwing', () => {
    expect(describeFilter({ table: 't', column: 'note', op: 'ilike', value: '' })).toBe(
      'note contains (any)'
    );
  });
});

describe('coerceValue', () => {
  it('keeps numbers numeric-looking', () => {
    expect(coerceValue(42)).toBe('42');
    expect(coerceValue(0)).toBe('0');
    expect(coerceValue(3.5)).toBe('3.5');
    expect(coerceValue('100', 'number')).toBe('100');
    expect(coerceValue(NaN)).toBe('');
    expect(coerceValue(Infinity)).toBe('');
  });

  it('renders booleans as true/false', () => {
    expect(coerceValue(true)).toBe('true');
    expect(coerceValue(false)).toBe('false');
    expect(coerceValue('yes', 'boolean')).toBe('true');
    expect(coerceValue('0', 'boolean')).toBe('false');
  });

  it('trims and stringifies text', () => {
    expect(coerceValue('  hello ')).toBe('hello');
    expect(coerceValue('NHC', 'text')).toBe('NHC');
  });

  it('collapses null and undefined to an empty string', () => {
    expect(coerceValue(null)).toBe('');
    expect(coerceValue(undefined)).toBe('');
  });
});
