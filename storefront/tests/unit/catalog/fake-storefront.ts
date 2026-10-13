// A stand-in for Hydrogen's storefront client that answers from recorded responses and remembers every
// call, so the query modules can be tested without a network. The single cast below is the narrowing
// helper for this: the modules only use `query`, `CacheLong`, `CacheShort` and `CacheNone`.

import type {Storefront} from '@shopify/hydrogen';

export type RecordedCall = {
  readonly query: string;
  readonly variables: Record<string, unknown>;
  readonly cache: unknown;
};

type Responder = (call: RecordedCall) => unknown;

export function fakeStorefront(respond: Responder) {
  const calls: RecordedCall[] = [];
  const fake = {
    CacheLong: () => ({mode: 'long'}),
    CacheShort: () => ({mode: 'short'}),
    CacheNone: () => ({mode: 'none'}),
    query: async (
      query: string,
      options: {variables?: Record<string, unknown>; cache?: unknown} = {},
    ) => {
      const call = {
        query,
        variables: options.variables ?? {},
        cache: options.cache,
      };
      calls.push(call);
      return respond(call);
    },
  };
  return {calls, storefront: fake as unknown as Storefront};
}
