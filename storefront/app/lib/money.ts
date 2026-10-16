// Compatibility entry point. The helpers moved to `~/lib/format` (P2-08, the name the phase plan uses); about 25
// modules still import from here, so this re-exports them unchanged. New code imports from `~/lib/format`.
export {
  formatCents,
  formatMoney,
  fromCents,
  toCents,
  type MoneyV2Like,
} from '~/lib/format';
