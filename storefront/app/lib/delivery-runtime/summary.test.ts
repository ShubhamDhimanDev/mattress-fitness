import {afterEach, describe, expect, it, vi} from 'vitest';
import {resetReportedSecrets} from '~/lib/cookie-secret';
import {readDeliverySeed} from '~/lib/delivery-runtime/response';
import {loadDeliverySummary} from '~/lib/delivery-runtime/summary';
import {saveDeliveryZipHeader} from '~/lib/delivery-runtime/zip-cookie';
import {ENV as OFFER_ENV} from '~/lib/offers-runtime/test-fixtures';

// REQ-NAV-003 / P3B-11: the root loader resolves the saved ZIP on the server, so the header's first paint is
// right and no /delivery fetch (and no "Enter delivery ZIP" -> "Delivering to" flash) is needed.

const ENV = {
  ...OFFER_ENV,
  DELIVERY_COOKIE_SECRET: 'unit-test-delivery-secret-0123456789-not-real',
};
const URL_LOCAL = 'http://localhost:3000/';

afterEach(() => {
  resetReportedSecrets();
  vi.restoreAllMocks();
});

async function requestWithZip(zip: string): Promise<Request> {
  const header = await saveDeliveryZipHeader(zip, new Request(URL_LOCAL), ENV);
  return new Request(URL_LOCAL, {
    headers: {Cookie: (header ?? '').split(';')[0] ?? ''},
  });
}

describe('loadDeliverySummary', () => {
  it('resolves an in-zone ZIP from the signed cookie', async () => {
    const summary = await loadDeliverySummary(
      await requestWithZip('60645'),
      ENV,
    );
    expect(summary.deliverySeed.error).toBeNull();
    expect(summary.deliverySeed.delivery).toMatchObject({
      status: 'in-zone',
      zip: '60645',
    });
    expect(summary.deliveryZipAvailable).toBe(true);
  });

  it('resolves an outside ZIP, and no ZIP when there is no cookie', async () => {
    const outside = await loadDeliverySummary(
      await requestWithZip('90210'),
      ENV,
    );
    expect(outside.deliverySeed.delivery).toMatchObject({
      status: 'outside-zone',
      zip: '90210',
    });
    const none = await loadDeliverySummary(new Request(URL_LOCAL), ENV);
    expect(none.deliverySeed.delivery).toEqual({status: 'no-zip'});
  });

  it('ignores a tampered cookie and says nothing about a ZIP when no zone is configured', async () => {
    const forged = new Request(URL_LOCAL, {
      headers: {Cookie: 'delivery_zip=forged.value'},
    });
    expect(
      (await loadDeliverySummary(forged, ENV)).deliverySeed.delivery,
    ).toEqual({status: 'no-zip'});
    const noZone = await loadDeliverySummary(await requestWithZip('60645'), {
      DELIVERY_COOKIE_SECRET: ENV.DELIVERY_COOKIE_SECRET,
    });
    expect(noZone.deliverySeed.delivery).toEqual({status: 'unavailable'});
  });

  it('in production without a usable secret the seed says service-unavailable and the header flag is false', async () => {
    vi.stubEnv('PROD', true);
    try {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const summary = await loadDeliverySummary(
        new Request(URL_LOCAL),
        OFFER_ENV,
      );
      expect(summary.deliverySeed).toEqual({
        delivery: {status: 'service-unavailable'},
        error: null,
      });
      expect(summary.deliveryZipAvailable).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the ZIP out of the logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await loadDeliverySummary(await requestWithZip('60645'), ENV);
    expect(JSON.stringify(log.mock.calls)).not.toContain('60645');
  });

  it('survives the trip through route data: the seed reads back as the same typed value', async () => {
    const summary = await loadDeliverySummary(
      await requestWithZip('60645'),
      ENV,
    );
    const roundTripped: unknown = JSON.parse(JSON.stringify(summary));
    expect(readDeliverySeed(roundTripped)).toEqual(summary.deliverySeed);
  });
});

describe('readDeliverySeed (route data is untrusted shape)', () => {
  it.each([
    undefined,
    null,
    'x',
    {},
    {deliverySeed: null},
    {deliverySeed: {delivery: {status: 'maybe'}}},
    {deliverySeed: {delivery: {status: 'in-zone'}}}, // no zip
    {deliverySeed: {delivery: {status: 'outside-zone', zip: 7}}},
  ])('gives no seed for %j', (value) => {
    expect(readDeliverySeed(value)).toBeNull();
  });

  it('reads back the service-unavailable status', () => {
    expect(
      readDeliverySeed({
        deliverySeed: {delivery: {status: 'service-unavailable'}},
      })?.delivery,
    ).toEqual({status: 'service-unavailable'});
  });

  it('keeps a promise only when it is text', () => {
    expect(
      readDeliverySeed({
        deliverySeed: {delivery: {status: 'in-zone', zip: '60645', promise: 3}},
      })?.delivery,
    ).toEqual({status: 'in-zone', zip: '60645', promise: null});
  });
});
