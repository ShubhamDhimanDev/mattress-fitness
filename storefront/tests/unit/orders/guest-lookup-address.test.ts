import {describe, expect, it} from 'vitest';
import {
  TRUSTABLE_ADDRESS_HEADERS,
  addressKey,
  resolveClientAddress,
} from '~/lib/orders/guest-lookup-address';

// REQ-ACC-003 / T-09 / T-13 (security review M-1, L-5): the caller's address comes only from the one header the
// deployment names; there is no default header. Addresses are in documentation ranges (198.51.100.0/24,
// 203.0.113.0/24, 2001:db8::/32).

const headers = (entries: Record<string, string>) => new Headers(entries);
const UNKNOWN = {address: 'unknown', source: 'none'} as const;

describe('only the configured header is read (M-1)', () => {
  it('reads the named header and nothing else', () => {
    expect(
      resolveClientAddress(
        headers({
          'x-real-ip': '198.51.100.7',
          'cf-connecting-ip': '203.0.113.5',
        }),
        'x-real-ip',
      ),
    ).toEqual({address: '198.51.100.7', source: 'header'});
    expect(
      resolveClientAddress(
        headers({
          'x-real-ip': '198.51.100.7',
          'cf-connecting-ip': '203.0.113.5',
        }),
        ' CF-Connecting-IP ',
      ),
    ).toEqual({address: '203.0.113.5', source: 'header'});
  });

  it.each([...TRUSTABLE_ADDRESS_HEADERS])(
    'accepts %s when it is the configured name',
    (name) => {
      expect(
        resolveClientAddress(headers({[name]: '198.51.100.7'}), name),
      ).toEqual({address: '198.51.100.7', source: 'header'});
    },
  );

  it('allows exactly the five documented names', () => {
    expect([...TRUSTABLE_ADDRESS_HEADERS].sort()).toEqual([
      'cf-connecting-ip',
      'oxygen-buyer-ip',
      'true-client-ip',
      'x-forwarded-for',
      'x-real-ip',
    ]);
  });

  it('has NO default: nothing configured means the shared bucket, even when oxygen-buyer-ip is sent', () => {
    const spoof = headers({
      'oxygen-buyer-ip': '198.51.100.8',
      'cf-connecting-ip': '198.51.100.9',
      'true-client-ip': '198.51.100.10',
      'x-real-ip': '198.51.100.11',
      'x-forwarded-for': '198.51.100.12',
    });
    expect(resolveClientAddress(spoof, null)).toEqual(UNKNOWN);
    expect(resolveClientAddress(spoof, '')).toEqual(UNKNOWN);
    expect(resolveClientAddress(spoof, '   ')).toEqual(UNKNOWN);
  });

  it('ignores a spoofed oxygen-buyer-ip and cf-connecting-ip when another header is configured', () => {
    const request = headers({
      'x-real-ip': '198.51.100.20',
      'oxygen-buyer-ip': '203.0.113.99',
      'cf-connecting-ip': '203.0.113.98',
      'true-client-ip': '203.0.113.97',
    });
    expect(resolveClientAddress(request, 'x-real-ip').address).toBe(
      '198.51.100.20',
    );
  });

  it('does not fall back to another header when the configured one is absent', () => {
    expect(
      resolveClientAddress(
        headers({'oxygen-buyer-ip': '203.0.113.99'}),
        'x-real-ip',
      ),
    ).toEqual(UNKNOWN);
  });

  it.each([['forwarded'], ['x-client-ip'], ['host'], ['cookie'], ['unknown']])(
    'refuses %s as a configured name (not on the list) and reads nothing',
    (name) => {
      expect(
        resolveClientAddress(
          headers({
            forwarded: 'for=203.0.113.1',
            'x-client-ip': '203.0.113.2',
            'oxygen-buyer-ip': '203.0.113.3',
          }),
          name,
        ),
      ).toEqual(UNKNOWN);
    },
  );
});

describe('x-forwarded-for takes the last entry', () => {
  it('uses the entry the nearest proxy appended', () => {
    expect(
      resolveClientAddress(
        headers({'x-forwarded-for': '6.6.6.6, 198.51.100.9'}),
        'x-forwarded-for',
      ),
    ).toEqual({address: '198.51.100.9', source: 'header'});
    expect(
      resolveClientAddress(
        headers({'x-forwarded-for': '198.51.100.9'}),
        'x-forwarded-for',
      ),
    ).toEqual({address: '198.51.100.9', source: 'header'});
  });

  it('refuses a joined value on every other header', () => {
    expect(
      resolveClientAddress(
        headers({'x-real-ip': '6.6.6.6, 198.51.100.9'}),
        'x-real-ip',
      ),
    ).toEqual(UNKNOWN);
  });
});

describe('malformed values give the shared bucket', () => {
  it.each([
    [''],
    ['not an address'],
    ['198.51.100.9; DROP'],
    ['a'.repeat(100)],
    ['fe80::1%eth0'],
    ['198.51.100.256'],
    ['198.51.100'],
    ['198.51.100.9.9'],
    ['1:2:3:4:5:6:7'],
    ['1:2:3:4:5:6:7:8:9'],
    ['1::2::3'],
    [':::'],
    [':1:2:3:4:5:6:7'],
    ['1.2.3.4::'],
    ['[2001:db8::1]'],
    ['2001:db8::g'],
    ['2001:db8::12345'],
  ])('treats %j as unknown', (value) => {
    expect(
      resolveClientAddress(headers({'x-real-ip': value}), 'x-real-ip'),
    ).toEqual(UNKNOWN);
  });
});

describe('address keys (L-5)', () => {
  it.each([
    ['198.51.100.7', '198.51.100.7'],
    [' 198.51.100.7 ', '198.51.100.7'],
    ['010.001.000.007', '10.1.0.7'],
    ['::ffff:198.51.100.7', '198.51.100.7'],
    ['::FFFF:C633:6407', '198.51.100.7'],
    ['0:0:0:0:0:ffff:198.51.100.7', '198.51.100.7'],
  ])('%s -> %s', (raw, expected) => {
    expect(addressKey(raw)).toBe(expected);
  });

  it('reduces IPv6 to its /64, whatever the spelling', () => {
    const expected = 'v6:2001:db8:0:1::/64';
    for (const raw of [
      '2001:db8:0:1::1',
      '2001:DB8:0:1:ffff:ffff:ffff:ffff',
      '2001:0db8:0000:0001:0000:0000:0000:0002',
      '2001:db8:0:1:abcd::',
    ]) {
      expect(addressKey(raw), raw).toBe(expected);
    }
  });

  it('keeps different /64 prefixes apart', () => {
    expect(addressKey('2001:db8:0:1::1')).not.toBe(
      addressKey('2001:db8:0:2::1'),
    );
    expect(addressKey('2001:db8:1::1')).not.toBe(addressKey('2001:db8:2::1'));
  });

  it('rotating the low 64 bits does not change the key (200 variants)', () => {
    const keys = new Set<string | null>();
    for (let i = 0; i < 200; i += 1) {
      keys.add(addressKey(`2001:db8:5:6:${i.toString(16)}:${i * 7}::${i + 1}`));
    }
    expect(keys.size).toBe(1);
  });

  it('handles the unspecified and loopback addresses', () => {
    expect(addressKey('::')).toBe('v6:0:0:0:0::/64');
    expect(addressKey('::1')).toBe('v6:0:0:0:0::/64');
  });

  it('an IPv4-mapped address and the plain IPv4 address share a key', () => {
    expect(addressKey('::ffff:203.0.113.4')).toBe(addressKey('203.0.113.4'));
  });
});
