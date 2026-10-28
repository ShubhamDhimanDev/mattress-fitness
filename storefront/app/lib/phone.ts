// US phone parsing for tel: links and signup validation (REQ-CNT-001). Pure helper, no framework imports.

export type UsPhone = {
  /** "+12125550100", for tel: links and structured data. */
  readonly e164: string;
  /** "(212) 555-0100", for display. */
  readonly display: string;
};

/**
 * Reads a US phone number (NANP) typed any common way: 212-555-0100,
 * (212) 555-0100, +1 212 555 0100. Returns null for anything else, including
 * extensions and letters, so nothing odd ever lands in a tel: link.
 */
export function normalizeUsPhone(raw: unknown): UsPhone | null {
  if (typeof raw !== 'string' || raw.length > 30) return null;
  if (!/^[\d\s().+-]+$/.test(raw)) return null;
  if (raw.includes('+') && !/^\s*\+1(?!\d)/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // NANP: area code and exchange cannot start with 0 or 1.
  if (/^[01]/.test(digits) || /^[01]/.test(digits.slice(3))) return null;
  return {
    e164: `+1${digits}`,
    display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
  };
}
