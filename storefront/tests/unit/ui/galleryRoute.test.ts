import {afterEach, describe, expect, it, vi} from 'vitest';
import {loader} from '~/routes/_dev.components';

afterEach(() => {
  vi.unstubAllEnvs();
});

// P2-06: the component gallery must not exist in production (it is a development aid with sample data).
describe('component gallery route', () => {
  it('serves in development', () => {
    vi.stubEnv('PROD', false);
    expect(loader()).toBeNull();
  });

  it('answers 404 when the build is a production build', () => {
    vi.stubEnv('PROD', true);
    let thrown: unknown;
    try {
      loader();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown instanceof Response && thrown.status).toBe(404);
  });
});
