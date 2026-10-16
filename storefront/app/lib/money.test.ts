import {describe, expect, it} from 'vitest';
import * as format from '~/lib/format';
import * as money from '~/lib/money';

// The behaviour is tested in format.test.ts; this only proves the compatibility entry point still exposes the
// same functions to the modules that import `~/lib/money`.
describe('~/lib/money (re-export of ~/lib/format)', () => {
  it('exposes the same helpers', () => {
    expect(money.toCents).toBe(format.toCents);
    expect(money.fromCents).toBe(format.fromCents);
    expect(money.formatCents).toBe(format.formatCents);
    expect(money.formatMoney).toBe(format.formatMoney);
  });
});
