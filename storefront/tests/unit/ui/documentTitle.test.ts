import {describe, expect, it} from 'vitest';
import {formatPageTitle} from '~/components/layout/documentTitle';

// REQ-NAV-001 / NFR-003: every page has a distinct, descriptive title ending in the site name.
describe('formatPageTitle', () => {
  const cases: Array<[string | null | undefined, string]> = [
    ['Queen mattresses', 'Queen mattresses | Mattress Store'],
    ['  Sale  ', 'Sale | Mattress Store'],
    ['Mattress Store', 'Mattress Store'],
    [undefined, 'Mattress Store | Mattresses, bases and bedding'],
    [null, 'Mattress Store | Mattresses, bases and bedding'],
    ['', 'Mattress Store | Mattresses, bases and bedding'],
    ['   ', 'Mattress Store | Mattresses, bases and bedding'],
  ];

  it.each(cases)('%j gives %s', (input, expected) => {
    expect(formatPageTitle(input)).toBe(expected);
  });
});
