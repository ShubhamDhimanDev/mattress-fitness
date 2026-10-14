import {describe, expect, it} from 'vitest';
import {
  DELIVERY_ZIP_COOKIE,
  clearDeliveryZipHeader,
  readDeliveryZip,
  saveDeliveryZipHeader,
} from '~/lib/delivery-runtime/zip-cookie';

// P3B-11, REQ-NAV-003: a signed, HttpOnly cookie; a value we did not write is never believed.

const SECRET = 'unit-test-delivery-secret-0123456789-not-real';
const ENV = {DELIVERY_COOKIE_SECRET: SECRET};
const OTHER_ENV = {
  DELIVERY_COOKIE_SECRET: 'a-different-delivery-secret-0123456789-xx',
};
const URL_HTTPS = 'https://shop.example/products/x';
const URL_LOCAL = 'http://localhost:3000/products/x';

/** The `name=value` pair of a Set-Cookie header, as a browser would send it back. */
function cookiePair(setCookie: string): string {
  const pair = setCookie.split(';')[0];
  return pair ?? '';
}

function requestWith(cookie: string | null, url = URL_HTTPS): Request {
  return new Request(url, {headers: cookie ? {Cookie: cookie} : {}});
}

describe('delivery ZIP cookie', () => {
  it('round-trips a ZIP through a signed cookie', async () => {
    const header = await saveDeliveryZipHeader('60645', requestWith(null), ENV);
    expect(header).not.toBeNull();
    const read = await readDeliveryZip(
      requestWith(cookiePair(header ?? '')),
      ENV,
    );
    expect(read).toBe('60645');
  });

  it('is HttpOnly, SameSite=Lax, Secure on https, with a lifetime, and names no ZIP in clear text', async () => {
    const header =
      (await saveDeliveryZipHeader('60645', requestWith(null), ENV)) ?? '';
    expect(header).toContain(`${DELIVERY_ZIP_COOKIE}=`);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/Max-Age=\d+/i);
    expect(header).toMatch(/Path=\//i);
  });

  it('omits Secure only for localhost so the dev server can set it', async () => {
    const header =
      (await saveDeliveryZipHeader(
        '60645',
        requestWith(null, URL_LOCAL),
        ENV,
      )) ?? '';
    expect(header).not.toMatch(/Secure/i);
    expect(header).toMatch(/HttpOnly/i);
  });

  it('reduces ZIP+4 to 5 digits when saving, and refuses to sign anything that is not a ZIP', async () => {
    const plus4 =
      (await saveDeliveryZipHeader('60645-1234', requestWith(null), ENV)) ?? '';
    expect(await readDeliveryZip(requestWith(cookiePair(plus4)), ENV)).toBe(
      '60645',
    );
    for (const bad of ['', 'abcde', '6064', '<script>', '60645; Path=/']) {
      expect(
        await saveDeliveryZipHeader(bad, requestWith(null), ENV),
      ).toBeNull();
    }
  });

  it('rejects a cookie signed with another secret, an unsigned value and a tampered value', async () => {
    const foreign =
      (await saveDeliveryZipHeader('60645', requestWith(null), OTHER_ENV)) ??
      '';
    expect(
      await readDeliveryZip(requestWith(cookiePair(foreign)), ENV),
    ).toBeNull();
    expect(
      await readDeliveryZip(requestWith(`${DELIVERY_ZIP_COOKIE}=60645`), ENV),
    ).toBeNull();
    const own =
      (await saveDeliveryZipHeader('60645', requestWith(null), ENV)) ?? '';
    const tampered = cookiePair(own).replace(/.$/, (c) =>
      c === 'A' ? 'B' : 'A',
    );
    expect(await readDeliveryZip(requestWith(tampered), ENV)).toBeNull();
  });

  it('is absent, not an error, when there is no cookie or garbage', async () => {
    expect(await readDeliveryZip(requestWith(null), ENV)).toBeNull();
    expect(
      await readDeliveryZip(
        requestWith(`${DELIVERY_ZIP_COOKIE}=%E0%A4%A; other=1`),
        ENV,
      ),
    ).toBeNull();
  });

  it('reads and writes nothing without a secret (fails closed)', async () => {
    expect(
      await saveDeliveryZipHeader('60645', requestWith(null), {}),
    ).toBeNull();
    expect(await clearDeliveryZipHeader(requestWith(null), {})).toBeNull();
    const header =
      (await saveDeliveryZipHeader('60645', requestWith(null), ENV)) ?? '';
    expect(
      await readDeliveryZip(requestWith(cookiePair(header)), {}),
    ).toBeNull();
    expect(
      await readDeliveryZip(requestWith(cookiePair(header)), {
        DELIVERY_COOKIE_SECRET: '',
      }),
    ).toBeNull();
  });

  it('refuses a secret shorter than 32 characters for reading and writing (E-L1)', async () => {
    const weak = {DELIVERY_COOKIE_SECRET: 'x'.repeat(31)};
    expect(
      await saveDeliveryZipHeader('60645', requestWith(null), weak),
    ).toBeNull();
    expect(await clearDeliveryZipHeader(requestWith(null), weak)).toBeNull();
    const header =
      (await saveDeliveryZipHeader('60645', requestWith(null), ENV)) ?? '';
    expect(
      await readDeliveryZip(requestWith(cookiePair(header)), weak),
    ).toBeNull();
    // Exactly 32 is enough.
    const edge = {DELIVERY_COOKIE_SECRET: 'x'.repeat(32)};
    expect(
      await saveDeliveryZipHeader('60645', requestWith(null), edge),
    ).not.toBeNull();
  });

  it('never uses the session secret: a cookie signed with it is not believed, and it does not sign', async () => {
    const sessionOnly = {SESSION_SECRET: SECRET};
    expect(
      await saveDeliveryZipHeader('60645', requestWith(null), sessionOnly),
    ).toBeNull();
    // Same key material under the right name signs fine, but an unprefixed (other purpose) payload is not a ZIP.
    const {createCookie} = await import('react-router');
    const other = createCookie(DELIVERY_ZIP_COOKIE, {secrets: [SECRET]});
    const bare = (await other.serialize('60645')).split(';')[0] ?? '';
    expect(await readDeliveryZip(requestWith(bare), ENV)).toBeNull();
    const otherPurpose =
      (await other.serialize('session:60645')).split(';')[0] ?? '';
    expect(await readDeliveryZip(requestWith(otherPurpose), ENV)).toBeNull();
  });

  it('clears by expiring the cookie', async () => {
    const header = (await clearDeliveryZipHeader(requestWith(null), ENV)) ?? '';
    expect(header).toContain(`${DELIVERY_ZIP_COOKIE}=`);
    expect(header).toMatch(/Max-Age=0/i);
    expect(header).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });
});
