// @vitest-environment jsdom
import {useState} from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ProtectionPanel} from '~/components/extend/ProtectionPanel';
import {
  OFFERS_DEBOUNCE_MS,
  useProtectionOffers,
} from '~/components/extend/useProtectionOffers';
import {protectionModeFor} from '~/lib/shopify/protection-mode';
import {
  formatCoverageTerm,
  readProtectionAnswer,
} from '~/lib/offers-runtime/client';
import {
  PROTECTION_STEP,
  parsePreCheckoutStepId,
} from '~/lib/offers-runtime/view';

// REQ-ADD-003 / REQ-EXT-004 / NFR-013 / P5A-05: the product-page protection panel and the hook that asks our own route.
// The browser calls /api/extend/offers only (never Extend); an unavailable answer hides the panel.

afterEach(cleanup);

// react-router 7.17+ throws when `useRouteLoaderData` runs outside a data router; the panel only reads the root's Extend
// branding, which these tests do not need (ADR-0012).
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useRouteLoaderData: () => undefined,
}));

const VARIANT_A = 'gid://shopify/ProductVariant/11';
const VARIANT_B = 'gid://shopify/ProductVariant/12';

const plan = (planId: string, over: Record<string, unknown> = {}) => ({
  planId,
  title: `Plan ${planId}`,
  priceCents: 7999,
  termMonths: 36,
  termsUrl: 'https://extend.example/terms',
  imageUrl: null,
  recommended: false,
  ...over,
});

const answer = (variantId: string, plans: unknown[]) => ({
  status: 'ok',
  poweredBy: 'Extend',
  items: [{variantId, quantity: 1, plans}],
});

describe('readProtectionAnswer: what the page does with the route answer', () => {
  it('keeps valid plans for the asked variant and nothing else', () => {
    const read = readProtectionAnswer(
      answer(VARIANT_A, [plan('P-1'), plan('P-1'), plan('bad id!')]),
      VARIANT_A,
    );
    expect(read).toEqual({
      status: 'plans',
      plans: [
        {
          planId: 'P-1',
          title: 'Plan P-1',
          priceCents: 7999,
          termMonths: 36,
          termsUrl: 'https://extend.example/terms',
          recommended: false,
        },
      ],
    });
  });

  it.each([
    ['unavailable', {status: 'unavailable'}],
    ['invalid', {status: 'invalid'}],
    ['an answer for another variant', answer(VARIANT_B, [plan('P-1')])],
    ['no plans', answer(VARIANT_A, [])],
    ['not an object', 'oops'],
    [
      'an http terms link',
      answer(VARIANT_A, [plan('P-1', {termsUrl: 'http://x.test'})]),
    ],
    [
      'a javascript link',
      answer(VARIANT_A, [plan('P-1', {termsUrl: 'javascript:alert(1)'})]),
    ],
    ['a zero price', answer(VARIANT_A, [plan('P-1', {priceCents: 0})])],
    [
      'a fractional price',
      answer(VARIANT_A, [plan('P-1', {priceCents: 79.99})]),
    ],
  ])('hides on %s', (_name, body) => {
    expect(readProtectionAnswer(body, VARIANT_A)).toEqual({status: 'hidden'});
  });

  it('states a term only when Extend gave one', () => {
    expect(formatCoverageTerm(36)).toBe('3 years of coverage');
    expect(formatCoverageTerm(12)).toBe('1 year of coverage');
    expect(formatCoverageTerm(18)).toBe('18 months of coverage');
    expect(formatCoverageTerm(null)).toBeNull();
    expect(formatCoverageTerm(0)).toBeNull();
  });

  it('knows the protection step id and nothing invented', () => {
    expect(parsePreCheckoutStepId(PROTECTION_STEP)).toBe('protection');
    expect(parsePreCheckoutStepId('haul-away')).toBe('haul-away');
    expect(parsePreCheckoutStepId('evil')).toBeNull();
  });
});

function Harness({
  variantId,
  enabled = true,
  reserveSpace = true,
}: {
  variantId: string;
  enabled?: boolean;
  reserveSpace?: boolean;
}) {
  const offers = useProtectionOffers(variantId, enabled);
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <div>
      <ProtectionPanel
        offers={offers}
        reserveSpace={reserveSpace}
        selectedPlanId={chosen}
        onSelect={setChosen}
      />
      <p data-testid="chosen">{chosen ?? 'none'}</p>
    </div>
  );
}

function respondWith(body: unknown, status = 200) {
  return vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), {status})),
  );
}

describe('<ProtectionPanel> with the offers hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OFFERS_DEBOUNCE_MS + 10);
    });
  }

  it('asks our own route (variant id and quantity only) once, after the debounce, and shows plans with "No protection" selected', async () => {
    const fetchMock = respondWith(
      answer(VARIANT_A, [plan('P-1', {recommended: true})]),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness variantId={VARIANT_A} />);
    // Loading holds the space; nothing was asked yet.
    expect(fetchMock).not.toHaveBeenCalled();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url.startsWith('/api/extend/offers?')).toBe(true);
    const query = new URL(url, 'http://x.test').searchParams;
    expect([...query.keys()].sort()).toEqual(['quantity', 'variantId']);
    expect(query.get('variantId')).toBe(VARIANT_A);

    expect(
      screen.getByRole('group', {name: 'Accident protection'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', {name: 'No protection'})).toBeChecked();
    const link = screen.getByRole('link', {name: /Plan details and terms/});
    expect(link).toHaveAttribute('href', 'https://extend.example/terms');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Powered by Extend')).toBeInTheDocument();
    expect(screen.getByText('$79.99')).toBeInTheDocument();
    expect(screen.getByText('3 years of coverage')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', {name: /Plan P-1/}));
    expect(screen.getByTestId('chosen')).toHaveTextContent('P-1');
    fireEvent.click(screen.getByRole('radio', {name: 'No protection'}));
    expect(screen.getByTestId('chosen')).toHaveTextContent('none');
  });

  it('a quick run of size changes makes ONE request, for the last size', async () => {
    const fetchMock = respondWith(answer(VARIANT_B, [plan('P-2')]));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<Harness variantId={VARIANT_A} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OFFERS_DEBOUNCE_MS - 50);
    });
    view.rerender(<Harness variantId={VARIANT_B} />);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      encodeURIComponent(VARIANT_B),
    );
  });

  it('aborts the request in flight when the variant changes and never shows the old answer', async () => {
    const signals: AbortSignal[] = [];
    const slow = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('abort')),
        );
        // Variant A never answers in time; variant B answers at once.
        if (String(_url).includes(encodeURIComponent(VARIANT_B))) {
          resolve(
            new Response(JSON.stringify(answer(VARIANT_B, [plan('P-B')]))),
          );
        }
      });
    });
    vi.stubGlobal('fetch', slow);
    const view = render(<Harness variantId={VARIANT_A} />);
    await settle();
    expect(signals).toHaveLength(1);
    view.rerender(<Harness variantId={VARIANT_B} />);
    expect(signals[0]?.aborted).toBe(true);
    await settle();
    expect(screen.getByRole('radio', {name: /Plan P-B/})).toBeInTheDocument();
    expect(screen.queryByText(/Plan P-A/)).toBeNull();
  });

  it.each([
    ['the route says unavailable', respondWith({status: 'unavailable'})],
    ['the route fails', respondWith({}, 500)],
    [
      'the network fails',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    ],
    ['the answer has no plans', respondWith(answer(VARIANT_A, []))],
  ])('renders nothing when %s', async (_name, fetchMock) => {
    vi.stubGlobal('fetch', fetchMock);
    const {container} = render(<Harness variantId={VARIANT_A} />);
    await settle();
    expect(
      screen.queryByRole('group', {name: 'Accident protection'}),
    ).toBeNull();
    expect(container.querySelector('fieldset')).toBeNull();
  });

  it('flag off: renders nothing and makes no request at all', async () => {
    const fetchMock = respondWith(answer(VARIANT_A, [plan('P-1')]));
    vi.stubGlobal('fetch', fetchMock);
    const {container} = render(
      <Harness variantId={VARIANT_A} enabled={false} />,
    );
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('fieldset')).toBeNull();
    expect(container.querySelector('[aria-busy]')).toBeNull();
  });

  it('reserves its space while loading (no layout shift) and is announced politely when plans arrive', async () => {
    vi.stubGlobal('fetch', respondWith(answer(VARIANT_A, [plan('P-1')])));
    const {container} = render(<Harness variantId={VARIANT_A} />);
    const loading = container.querySelector('[aria-busy="true"]');
    expect(loading?.className).toContain('min-h-64');
    // The live region is mounted BEFORE it has text, which is what makes screen readers announce the change.
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    await settle();
    expect(container.querySelector('fieldset')?.className).toContain(
      'min-h-64',
    );
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent(
      '1 protection plan is available for this size.',
    );
  });

  it('a product with no reserved space shows no skeleton, and renders nothing while loading or when there is no plan', async () => {
    vi.stubGlobal('fetch', respondWith(answer(VARIANT_A, [])));
    const {container} = render(
      <Harness variantId={VARIANT_A} reserveSpace={false} />,
    );
    expect(container.querySelector('[aria-busy]')).toBeNull();
    expect(container.querySelector('[class*="min-h"]')).toBeNull();
    expect(container.querySelector('fieldset')).toBeNull();
    await settle();
    expect(container.querySelector('fieldset')).toBeNull();
    expect(container.querySelector('[class*="min-h"]')).toBeNull();
  });

  it('an eligible product keeps its reserved box when the answer is no plan, so the button does not jump (NFR-002)', async () => {
    vi.stubGlobal('fetch', respondWith(answer(VARIANT_A, [])));
    const {container} = render(<Harness variantId={VARIANT_A} reserveSpace />);
    expect(container.querySelector('[aria-busy]')?.className).toContain(
      'min-h-64',
    );
    await settle();
    expect(container.querySelector('fieldset')).toBeNull();
    expect(
      container.querySelector('[aria-hidden="true"]')?.className,
    ).toContain('min-h-64');
  });

  it('without reserved space the plans still appear, and keep no minimum height', async () => {
    vi.stubGlobal('fetch', respondWith(answer(VARIANT_A, [plan('P-1')])));
    const {container} = render(
      <Harness variantId={VARIANT_A} reserveSpace={false} />,
    );
    await settle();
    expect(container.querySelector('fieldset')).not.toBeNull();
    expect(container.querySelector('fieldset')?.className).not.toContain(
      'min-h',
    );
  });
});

describe('useProtectionOffers: what is remembered for the life of the page (REQ-ADD-003, NFR-013)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OFFERS_DEBOUNCE_MS + 10);
    });
  }

  it.each([
    [
      'a non-OK status',
      () => Promise.resolve(new Response('{}', {status: 503})),
    ],
    ['a network error', () => Promise.reject(new TypeError('offline'))],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>'))],
  ])(
    'a failed request (%s) hides the panel without a stuck skeleton and is asked again when the size comes back',
    async (_name, failing) => {
      let calls = 0;
      const fetchMock = vi.fn((url: string) => {
        calls += 1;
        return calls === 1
          ? failing()
          : Promise.resolve(
              new Response(
                JSON.stringify(
                  String(url).includes(encodeURIComponent(VARIANT_B))
                    ? answer(VARIANT_B, [plan('P-B')])
                    : answer(VARIANT_A, [plan('P-A')]),
                ),
              ),
            );
      });
      vi.stubGlobal('fetch', fetchMock);
      const view = render(<Harness variantId={VARIANT_A} />);
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Hidden now, and not "loading" forever.
      expect(view.container.querySelector('[aria-busy]')).toBeNull();
      expect(view.container.querySelector('fieldset')).toBeNull();

      view.rerender(<Harness variantId={VARIANT_B} />);
      await settle();
      expect(screen.getByRole('radio', {name: /Plan P-B/})).toBeInTheDocument();

      view.rerender(<Harness variantId={VARIANT_A} />);
      await settle();
      // Not remembered as "no plans": the failed size is asked a second time and now shows its plan.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(screen.getByRole('radio', {name: /Plan P-A/})).toBeInTheDocument();
    },
  );

  it('plans and a definitive "no plans" are remembered: switching back asks nothing', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(url).includes(encodeURIComponent(VARIANT_A))
              ? answer(VARIANT_A, [])
              : answer(VARIANT_B, [plan('P-B')]),
          ),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<Harness variantId={VARIANT_A} />);
    await settle();
    view.rerender(<Harness variantId={VARIANT_B} />);
    await settle();
    view.rerender(<Harness variantId={VARIANT_A} />);
    await settle();
    view.rerender(<Harness variantId={VARIANT_B} />);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('radio', {name: /Plan P-B/})).toBeInTheDocument();
  });
});

describe('protectionModeFor: where the panel goes before any answer (NFR-002)', () => {
  it.each([
    [{enabled: false, eligible: true}, 'off'],
    [{enabled: false, eligible: null}, 'off'],
    [{enabled: true, eligible: false}, 'off'],
    [{enabled: true, eligible: true}, 'eligible'],
    [{enabled: true, eligible: null}, 'unknown'],
  ] as const)('%j -> %s', (input, expected) => {
    expect(protectionModeFor(input)).toBe(expected);
  });
});
