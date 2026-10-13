import {describe, expect, it} from 'vitest';
import {
  MY_STORE_COOKIE,
  clearMyStoreCookie,
  myStoreKey,
  parseMyStoreForm,
  readCookie,
  readMyStore,
  resolveMyStore,
  setMyStoreCookie,
} from '~/lib/pages/my-store';
import {
  storeCardView,
  storeCountText,
  weeklyHoursView,
} from '~/lib/pages/stores-view';
import {FIXTURE_STORES} from '~/lib/stores/fixtures';
import {buildStoreIndex, findStore} from '~/lib/stores/grouping';
import type {Store} from '~/lib/stores/types';

// REQ-LOC-001 (card content, hours in the store time zone), REQ-LOC-003 (my store cookie).

const index = buildStoreIndex(FIXTURE_STORES);
function store(slug: string): Store {
  const found = FIXTURE_STORES.find((s) => s.slug === slug);
  if (!found) throw new Error(`no fixture ${slug}`);
  return found;
}
const buffalo = store('buffalo-gallery');
const portland = store('portland-pearl');

// Wednesday 2026-10-14 11:00 in New York (15:00 UTC); Sunday 2026-10-18 11:00 New York.
const WEDNESDAY_MORNING = Date.UTC(2026, 9, 14, 15, 0);
const WEDNESDAY_NIGHT = Date.UTC(2026, 9, 15, 3, 0); // 23:00 in New York
const SUNDAY_MORNING = Date.UTC(2026, 9, 18, 15, 0);

describe('REQ-LOC-001 store card view', () => {
  it('shows open now with the closing time, in the store time zone', () => {
    const card = storeCardView(buffalo, WEDNESDAY_MORNING);
    expect(card.status).toEqual({
      kind: 'open',
      text: 'Open now, closes 9:00 PM',
    });
    expect(card.todayText).toBe('Wednesday: 10:00 AM – 9:00 PM');
    expect(card.phone).toEqual({
      display: '(716) 555-0101',
      href: 'tel:+17165550101',
    });
    expect(card.addressLines).toEqual([
      '100 Example Street',
      'Buffalo, NY 14201',
    ]);
    expect(card.directionsUrl).toContain('https://www.google.com/maps/dir/');
    expect(card.path).toBe('/stores/new-york/buffalo/buffalo-gallery');
  });

  it('uses the store zone, not the viewer zone: the same instant is closed late at night', () => {
    expect(storeCardView(buffalo, WEDNESDAY_NIGHT).status).toEqual({
      kind: 'closed',
      text: 'Closed, opens tomorrow at 10:00 AM',
    });
  });

  it('closed all day on Sunday', () => {
    const card = storeCardView(buffalo, SUNDAY_MORNING);
    expect(card.todayText).toBe('Sunday: Closed');
    expect(card.status.kind).toBe('closed');
  });

  it('a sparse store has no phone and no guessed hours', () => {
    const card = storeCardView(portland, WEDNESDAY_MORNING);
    expect(card.phone).toBeNull();
    expect(card.status).toEqual({kind: 'unknown', text: 'Hours not available'});
    expect(card.todayText).toBe('Hours not available');
    expect(weeklyHoursView(portland, WEDNESDAY_MORNING)).toBeNull();
  });

  it('a store without a time zone does not guess open or closed', () => {
    const noZone: Store = {...buffalo, timeZone: null};
    expect(storeCardView(noZone, WEDNESDAY_MORNING).status.kind).toBe(
      'unknown',
    );
  });

  it('weekly hours list seven days, Monday first, with today flagged', () => {
    const rows = weeklyHoursView(buffalo, WEDNESDAY_MORNING);
    expect(rows?.map((r) => r.day)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(rows?.filter((r) => r.isToday).map((r) => r.day)).toEqual([
      'Wednesday',
    ]);
  });

  it('pluralises store counts', () => {
    expect(storeCountText(1)).toBe('1 store');
    expect(storeCountText(2)).toBe('2 stores');
  });
});

describe('REQ-LOC-003 my store cookie', () => {
  const key = myStoreKey(buffalo);

  it('key is the three slugs and resolves back to the store', () => {
    expect(key).toBe('new-york.buffalo.buffalo-gallery');
    expect(resolveMyStore(index, key)?.id).toBe(buffalo.id);
  });

  it('reads the cookie out of a header with other cookies', () => {
    const header = `a=1; ${MY_STORE_COOKIE}=${encodeURIComponent(key)}; b=2`;
    expect(readCookie(header, MY_STORE_COOKIE)).toBe(key);
    expect(readMyStore(index, header)?.id).toBe(buffalo.id);
    expect(readMyStore(index, null)).toBeNull();
  });

  it.each([
    ['unknown store', 'new-york.buffalo.nope'],
    ['unknown state', 'atlantis.buffalo.buffalo-gallery'],
    ['two parts', 'new-york.buffalo'],
    ['four parts', 'new-york.buffalo.buffalo-gallery.x'],
    ['traversal', '../../etc.passwd.x'],
    ['script', '<script>.x.y'],
    ['empty', ''],
    ['huge', 'a.'.repeat(500)],
  ])('a tampered cookie (%s) selects nothing', (_name, value) => {
    expect(resolveMyStore(index, value)).toBeNull();
    expect(
      readMyStore(index, `${MY_STORE_COOKIE}=${encodeURIComponent(value)}`),
    ).toBeNull();
  });

  it('malformed percent-encoding does not throw', () => {
    expect(readMyStore(index, `${MY_STORE_COOKIE}=%E0%A4%A`)).toBeNull();
  });

  it('sets a first-party, SameSite=Lax, HttpOnly cookie; Secure only on https', () => {
    const https = setMyStoreCookie(buffalo, {secure: true});
    expect(https).toContain(
      `${MY_STORE_COOKIE}=new-york.buffalo.buffalo-gallery`,
    );
    expect(https).toContain('SameSite=Lax');
    expect(https).toContain('HttpOnly');
    expect(https).toContain('Path=/');
    expect(https).toContain('Secure');
    expect(setMyStoreCookie(buffalo, {secure: false})).not.toContain('Secure');
    expect(https).not.toMatch(/Domain=/i);
  });

  it('clearing expires the cookie', () => {
    expect(clearMyStoreCookie({secure: true})).toContain('Max-Age=0');
  });

  it('the form accepts a known store and rejects tampered values', () => {
    const form = (entries: Record<string, string>) => {
      const data = new FormData();
      for (const [k, v] of Object.entries(entries)) data.set(k, v);
      return data;
    };
    expect(
      parseMyStoreForm(index, form({intent: 'set', store: key})),
    ).toMatchObject({type: 'set'});
    expect(
      parseMyStoreForm(index, form({intent: 'set', store: 'x.y.z'})),
    ).toEqual({type: 'invalid'});
    expect(parseMyStoreForm(index, form({intent: 'set'}))).toEqual({
      type: 'invalid',
    });
    expect(
      parseMyStoreForm(index, form({intent: 'bogus', store: key})),
    ).toEqual({
      type: 'invalid',
    });
    expect(
      parseMyStoreForm(index, form({intent: 'clear', store: 'x.y.z'})),
    ).toEqual({type: 'clear', returnTo: null});
    expect(
      parseMyStoreForm(index, form({intent: 'clear', store: key})),
    ).toMatchObject({type: 'clear', returnTo: {id: buffalo.id}});
  });

  it('every fixture store key resolves through findStore', () => {
    for (const s of index.states.flatMap((st) =>
      st.cities.flatMap((c) => c.stores),
    )) {
      expect(resolveMyStore(index, myStoreKey(s))?.id).toBe(s.id);
      expect(
        findStore(
          index,
          myStoreKey(s).split('.')[0],
          myStoreKey(s).split('.')[1],
          s.slug,
        ),
      ).not.toBeNull();
    }
  });
});
