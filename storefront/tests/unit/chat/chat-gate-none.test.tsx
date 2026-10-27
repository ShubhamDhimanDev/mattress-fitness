// @vitest-environment jsdom
import {act, cleanup, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {UtilityBar} from '~/components/layout/UtilityBar';

// REQ-ANL-004, bundle budget (scripts/perf): with no provider (the default) no chat chunk is requested at all: not the
// entry, not the runtime, and the browser is never asked for idle time. The chunks are mocked only to count requests.

const {entryLoaded, runtimeLoaded} = vi.hoisted(() => ({
  entryLoaded: vi.fn(),
  runtimeLoaded: vi.fn(),
}));

vi.mock('~/components/chat/ChatEntry', () => {
  entryLoaded();
  return {ChatEntry: () => null};
});
vi.mock('~/components/chat/ChatRuntime', () => {
  runtimeLoaded();
  return {ChatRuntime: () => null};
});

const idle: Array<() => void> = [];

beforeEach(() => {
  idle.length = 0;
  Reflect.set(window, 'requestIdleCallback', (callback: () => void) => {
    idle.push(callback);
    return idle.length;
  });
  Reflect.set(window, 'cancelIdleCallback', () => {});
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'requestIdleCallback');
  Reflect.deleteProperty(window, 'cancelIdleCallback');
});

describe('REQ-ANL-004 no chat provider configured', () => {
  it('requests no chunk, schedules nothing and renders no call-out', async () => {
    render(
      <MemoryRouter>
        <UtilityBar
          links={[
            {id: 'track', label: 'Track order', to: '/track-order'},
            {id: 'contact', label: 'Contact us', to: '/pages/contact'},
          ]}
        >
          <span>left</span>
        </UtilityBar>
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.dynamicImportSettled();
      idle.forEach((callback) => callback());
    });
    expect(idle).toHaveLength(0);
    expect(entryLoaded).not.toHaveBeenCalled();
    expect(runtimeLoaded).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
