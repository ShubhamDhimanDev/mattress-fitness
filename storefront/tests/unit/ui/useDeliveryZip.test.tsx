// @vitest-environment jsdom
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {createRoutesStub} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {useDeliveryZip} from '~/components/delivery/useDeliveryZip';
import type {DeliveryResponse} from '~/lib/delivery-runtime/response';

afterEach(cleanup);

// REQ-NAV-003 / P3B-11: the root loader's answer seeds every ZIP surface, so the first render is right and
// /delivery is fetched only when no seed exists.

function Probe() {
  const {response} = useDeliveryZip();
  const delivery = response?.delivery;
  return (
    <p>
      {delivery === undefined
        ? 'loading'
        : 'zip' in delivery
          ? `Delivering to ${delivery.zip}`
          : delivery.status}
    </p>
  );
}

const SEEDED: DeliveryResponse = {
  delivery: {status: 'in-zone', zip: '60645', promise: null},
  error: null,
};

function stub(options: {rootData: unknown; fetched: () => void}) {
  return createRoutesStub([
    {
      id: 'root',
      path: '/',
      loader: () => options.rootData,
      Component: Probe,
    },
    {
      path: '/delivery',
      loader: () => {
        options.fetched();
        return SEEDED;
      },
    },
  ]);
}

describe('useDeliveryZip seeding', () => {
  it('renders the root loader answer at once and never asks /delivery', async () => {
    const fetched = vi.fn();
    const Stub = stub({rootData: {deliverySeed: SEEDED}, fetched});
    render(<Stub initialEntries={['/']} />);
    expect(await screen.findByText('Delivering to 60645')).toBeInTheDocument();
    // Give an effect-driven request every chance to happen before asserting that none did.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetched).not.toHaveBeenCalled();
  });

  it('asks /delivery once when the root data carries no seed', async () => {
    const fetched = vi.fn();
    const Stub = stub({rootData: {}, fetched});
    render(<Stub initialEntries={['/']} />);
    expect(await screen.findByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Delivering to 60645')).toBeInTheDocument();
  });
});
