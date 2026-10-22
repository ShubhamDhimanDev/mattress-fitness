import {describe, expect, it} from 'vitest';
import {formatPageTitle} from '~/components/layout/documentTitle';

// REQ-NAV-001 / NFR-003: every page has a distinct, descriptive title ending in the site name.
describe('formatPageTitle', () => {
  const cases: Array<[string | null | undefined, string]> = [
    ['Queen mattresses', 'Queen mattresses | Mattress Fitness'],
    ['  Sale  ', 'Sale | Mattress Fitness'],
    ['Mattress Fitness', 'Mattress Fitness'],
    [undefined, 'Mattress Fitness | Mattresses, bases and bedding'],
    [null, 'Mattress Fitness | Mattresses, bases and bedding'],
    ['', 'Mattress Fitness | Mattresses, bases and bedding'],
    ['   ', 'Mattress Fitness | Mattresses, bases and bedding'],
  ];

  it.each(cases)('%j gives %s', (input, expected) => {
    expect(formatPageTitle(input)).toBe(expected);
  });
});
