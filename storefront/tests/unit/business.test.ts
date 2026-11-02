// REQ-CNT-001: the store's address, phone and map link are well formed and the phone is a usable tel: link.
import {describe, expect, it} from 'vitest';
import {
  BUSINESS_ADDRESS,
  BUSINESS_PHONE,
  BUSINESS_POSITION,
  directionsUrl,
  mapEmbedUrl,
} from '~/lib/business';
import {normalizeUsPhone} from '~/lib/phone';

describe('the store details', () => {
  it('has a phone that the US parser accepts and that matches its tel link', () => {
    const parsed = normalizeUsPhone(BUSINESS_PHONE.display);
    expect(parsed?.display).toBe(BUSINESS_PHONE.display);
    expect(BUSINESS_PHONE.href).toBe(`tel:${parsed?.e164}`);
  });

  it('has the address the owner supplied', () => {
    expect(BUSINESS_ADDRESS.lines.join(', ')).toBe(
      '24324 Northwest Freeway, Suite 200, Cypress, TX 77429',
    );
  });

  it('builds an OpenStreetMap embed centred on the store, with a pin', () => {
    const url = new URL(mapEmbedUrl());
    expect(url.origin).toBe('https://www.openstreetmap.org');
    expect(url.pathname).toBe('/export/embed.html');
    const [west, south, east, north] = (url.searchParams.get('bbox') ?? '')
      .split(',')
      .map(Number);
    expect((west + east) / 2).toBeCloseTo(BUSINESS_POSITION.lng, 4);
    expect((south + north) / 2).toBeCloseTo(BUSINESS_POSITION.lat, 4);
    expect(url.searchParams.get('marker')).toBe('29.956102,-95.675830');
  });

  it('links directions to the store position', () => {
    const url = new URL(directionsUrl());
    expect(url.origin).toBe('https://www.google.com');
    expect(url.searchParams.get('destination')).toBe('29.956102,-95.675830');
  });
});
