// SERVER ONLY. Provider id to adapter (P3B-12). The development-only fake is behind `import.meta.env.DEV`, a build-time
// constant, so a production build contains neither the adapter nor a request for it; `parseReviewsConfig` also refuses
// `fake` outside development, which is the second lock.

import type {ReviewsConfig} from '~/lib/reviews/config';
import type {ReviewsProvider} from '~/lib/reviews/provider';
import {
  createJudgeMeProvider,
  type JudgeMeFetch,
} from '~/lib/reviews/providers/judgeme';

export async function createReviewsProvider(
  config: ReviewsConfig,
  deps: {
    readonly fetch: JudgeMeFetch;
    readonly log: (
      event: string,
      fields: Record<string, string | number>,
    ) => void;
  },
): Promise<ReviewsProvider | null> {
  if (config.provider === 'judgeme') {
    return createJudgeMeProvider({
      token: config.token,
      shopDomain: config.shopDomain,
      fetch: deps.fetch,
      log: deps.log,
    });
  }
  if (import.meta.env.DEV) {
    const module = await import('~/lib/reviews/providers/fake');
    return module.createFakeProvider();
  }
  return null;
}
