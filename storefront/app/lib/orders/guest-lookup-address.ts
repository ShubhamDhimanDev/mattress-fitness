// SERVER ONLY. Reads the caller's address for the guest-lookup counters (REQ-ACC-003, T-09, T-13, security review
// M-1 and L-5).
//
// Trust model. A request header carries the address only if the deployment's OWN proxy sets it and strips any copy
// the client sent. This module cannot know that, so the deployment says which header to read, in
// TRUSTED_CLIENT_IP_HEADER, and nothing else is ever read. There is NO default: unset or unrecognised means every
// caller shares one "unknown" bucket, which is stricter, never looser. In particular `oxygen-buyer-ip` is trusted
// only when the deployment names it (on Oxygen, once Q-003 confirms Oxygen overwrites an inbound copy); behind
// nginx on a VPS, name `x-real-ip` and have nginx overwrite it (and blank the other names).
//
// Key shape. IPv4 as written ("203.0.113.9"); IPv6 reduced to its /64 prefix ("v6:2001:db8:0:1::/64"), because one
// home connection owns a whole /64 and rotating the low bits would otherwise dodge the per-address counters; an
// IPv4-mapped IPv6 address ("::ffff:203.0.113.9") is the IPv4 address.

export const UNKNOWN_ADDRESS = 'unknown';

/** The only names TRUSTED_CLIENT_IP_HEADER may take, lower case. */
export const TRUSTABLE_ADDRESS_HEADERS: ReadonlySet<string> = new Set([
  'oxygen-buyer-ip',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'x-forwarded-for',
]);

export type ClientAddress = {
  readonly address: string;
  /** `header` when a trusted header gave a usable address; `none` when the shared bucket applies. */
  readonly source: 'header' | 'none';
};

const NO_ADDRESS: ClientAddress = {address: UNKNOWN_ADDRESS, source: 'none'};

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

/** Eight 16-bit groups of an IPv6 address, or null when it is not valid. No zone ids, no brackets. */
function parseIpv6(value: string): number[] | null {
  if (!/^[0-9a-f:.]{2,45}$/.test(value) || value.includes(':::')) return null;
  const doubleColon = value.indexOf('::');
  if (doubleColon !== value.lastIndexOf('::')) return null;

  // A dotted IPv4 tail ("::ffff:1.2.3.4") is only valid as the last piece of the whole address.
  const toGroups = (text: string, allowIpv4Tail: boolean): number[] | null => {
    if (text === '') return [];
    const groups: number[] = [];
    const pieces = text.split(':');
    for (const [index, piece] of pieces.entries()) {
      if (piece.includes('.')) {
        if (!allowIpv4Tail || index !== pieces.length - 1) return null;
        const octets = parseIpv4(piece);
        if (octets === null) return null;
        groups.push(
          (octets[0] ?? 0) * 256 + (octets[1] ?? 0),
          (octets[2] ?? 0) * 256 + (octets[3] ?? 0),
        );
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        groups.push(Number.parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return groups;
  };

  if (doubleColon === -1) {
    const groups = toGroups(value, true);
    return groups !== null && groups.length === 8 ? groups : null;
  }
  const head = toGroups(value.slice(0, doubleColon), false);
  const tail = toGroups(value.slice(doubleColon + 2), true);
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  // "::" must stand for at least one group.
  return missing >= 1
    ? [...head, ...new Array<number>(missing).fill(0), ...tail]
    : null;
}

/**
 * The counter key for an address as a proxy wrote it, or null when it is not a valid IPv4 or IPv6 address.
 * Case and zero padding do not matter ("2001:DB8::1" and "2001:db8:0:0:0:0:0:1" are one key).
 */
export function addressKey(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const v4 = parseIpv4(value);
  if (v4 !== null) return v4.join('.');
  const groups = parseIpv6(value);
  if (groups === null) return null;
  const mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mapped) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return `v6:${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

/**
 * The caller's address from the ONE header the deployment trusts. `x-forwarded-for` takes the LAST entry, the one
 * the nearest proxy appended; every other header must hold exactly one address (a joined "a, b" is refused).
 */
export function resolveClientAddress(
  headers: {get(name: string): string | null},
  configuredHeader: string | null,
): ClientAddress {
  const wanted = configuredHeader?.trim().toLowerCase() ?? '';
  if (!TRUSTABLE_ADDRESS_HEADERS.has(wanted)) return NO_ADDRESS;
  const raw = headers.get(wanted);
  if (raw === null) return NO_ADDRESS;
  const candidate =
    wanted === 'x-forwarded-for' ? (raw.split(',').pop() ?? '') : raw;
  const key = addressKey(candidate);
  return key === null ? NO_ADDRESS : {address: key, source: 'header'};
}
