// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {globalsOf, type ScriptLoader} from '~/lib/analytics/adapter';
import {createGa4Adapter} from '~/lib/analytics/ga4';
import {createMetaAdapter} from '~/lib/analytics/meta';
import {createScriptLoader} from '~/lib/analytics/script-loader';

// Code re-review M-1: a second loader or adapter on the same page ADOPTS what is there. One script element per
// address, one `js` and `config` per measurement id, one `init` per pixel id.

afterEach(() => {
  document.head.innerHTML = '';
});

const GA_SRC = 'https://www.googletagmanager.com/gtag/js?id=G-ABCD1234';
const META_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

describe('the script loader', () => {
  it('appends one element for an address, however many loaders ask', async () => {
    const one = createScriptLoader({doc: document});
    const two = createScriptLoader({doc: document});
    const first = one(GA_SRC);
    const second = two(GA_SRC);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    document.head.querySelector('script')?.dispatchEvent(new Event('load'));
    expect(await first).toEqual({status: 'loaded'});
    expect(await second).toEqual({status: 'loaded'});
  });

  it('a second request for a script that failed gets the same failure', async () => {
    const loader = createScriptLoader({doc: document});
    const first = loader(META_SRC);
    const second = loader(META_SRC);
    document.head.querySelector('script')?.dispatchEvent(new Event('error'));
    expect(await first).toEqual({status: 'failed', reason: 'error'});
    expect(await second).toEqual({status: 'failed', reason: 'error'});
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('a script already in the page that this loader did not add is not added again', async () => {
    const foreign = document.createElement('script');
    foreign.src = GA_SRC;
    document.head.appendChild(foreign);
    const result = await createScriptLoader({doc: document})(GA_SRC);
    expect(result).toEqual({status: 'loaded'});
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('still refuses another origin without adding anything', async () => {
    const result = await createScriptLoader({doc: document})(
      'https://evil.example/x.js',
    );
    expect(result).toEqual({status: 'failed', reason: 'origin-refused'});
    expect(document.head.querySelector('script')).toBeNull();
  });
});

const loaded: ScriptLoader = () => Promise.resolve({status: 'loaded'});
const entries = (target: Record<string, unknown>) =>
  (target.dataLayer as unknown[]).map((entry) =>
    Array.from(entry as ArrayLike<unknown>),
  );

describe('a second GA4 adapter on the same data layer', () => {
  it('does not run js and config again, and shares the tag', async () => {
    const target: Record<string, unknown> = {};
    const a = createGa4Adapter({
      measurementId: 'G-ABCD1234',
      globals: globalsOf(target),
      loadScript: loaded,
    });
    const b = createGa4Adapter({
      measurementId: 'G-ABCD1234',
      globals: globalsOf(target),
      loadScript: loaded,
    });
    await a.load();
    await b.load();
    const names = entries(target).map((entry) => entry[0]);
    expect(names.filter((name) => name === 'js')).toHaveLength(1);
    expect(names.filter((name) => name === 'config')).toHaveLength(1);
    b.send({name: 'search', params: {search_term: 'queen'}});
    expect(entries(target).at(-1)?.slice(0, 2)).toEqual(['event', 'search']);
  });

  it('a different measurement id is configured separately', async () => {
    const target: Record<string, unknown> = {};
    for (const id of ['G-AAAA1111', 'G-BBBB2222']) {
      await createGa4Adapter({
        measurementId: id,
        globals: globalsOf(target),
        loadScript: loaded,
      }).load();
    }
    expect(
      entries(target).filter((entry) => entry[0] === 'config'),
    ).toHaveLength(2);
  });
});

describe('a second Meta adapter on the same pixel', () => {
  it('does not initialise the pixel again', async () => {
    const target: Record<string, unknown> = {};
    const make = () =>
      createMetaAdapter({
        pixelId: '123456789012345',
        globals: globalsOf(target),
        loadScript: loaded,
      });
    await make().load();
    await make().load();
    const queue = (target.fbq as {queue: unknown[]}).queue.map((entry) =>
      Array.from(entry as ArrayLike<unknown>),
    );
    expect(queue.filter((entry) => entry[0] === 'init')).toHaveLength(1);
    expect(queue.filter((entry) => entry[0] === 'set')).toHaveLength(1);
  });
});
