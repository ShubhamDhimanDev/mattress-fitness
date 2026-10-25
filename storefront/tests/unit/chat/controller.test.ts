import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  createChatController,
  type ChatFailureReason,
} from '~/lib/chat/controller';
import type {ChatProvider} from '~/lib/chat/provider';

// REQ-ANL-004, NFR-011 (consent), NFR-013 (a failing provider hides chat only): the controller with a scripted provider.

type Script = {
  load?: () => Promise<void>;
  ready?: boolean;
  readyThrows?: boolean;
  open?: () => void;
  unload?: (() => void) | null;
};

function scripted(script: Script = {}) {
  const calls: string[] = [];
  const provider: ChatProvider = {
    id: 'fake',
    load: () => {
      calls.push('load');
      return script.load ? script.load() : Promise.resolve();
    },
    isReady: () => {
      if (script.readyThrows) throw new Error('isReady failed');
      return script.ready ?? true;
    },
    open: () => {
      calls.push('open');
      script.open?.();
    },
  };
  if (script.unload !== null) {
    provider.unload = () => {
      calls.push('unload');
      script.unload?.();
    };
  }
  return {provider, calls};
}

function setup(
  script: Script = {},
  create?: () => Promise<ChatProvider | null>,
) {
  const made = scripted(script);
  const failures: ChatFailureReason[] = [];
  const controller = createChatController({
    create: create ?? (() => Promise.resolve(made.provider)),
    onFailure: (reason) => failures.push(reason),
    loadTimeoutMs: 1000,
  });
  return {controller, failures, ...made};
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('REQ-ANL-004 controller: loading', () => {
  it('starts waiting and loads nothing until allowed', async () => {
    const {controller, calls} = setup();
    await settle();
    expect(controller.getState().phase).toBe('waiting');
    expect(calls).toEqual([]);
  });

  it('loads once when allowed and becomes ready', async () => {
    const {controller, calls} = setup();
    controller.setAllowed(true);
    expect(controller.getState().phase).toBe('loading');
    await settle();
    expect(controller.getState().phase).toBe('ready');
    controller.setAllowed(true);
    await settle();
    expect(calls).toEqual(['load']);
  });

  it('notifies subscribers on change only, and survives a faulty subscriber', async () => {
    const {controller} = setup();
    const listener = vi.fn();
    controller.subscribe(() => {
      throw new Error('faulty');
    });
    const unsubscribe = controller.subscribe(listener);
    controller.setAllowed(true);
    await settle();
    expect(listener).toHaveBeenCalledTimes(2); // loading, ready
    unsubscribe();
    controller.setAllowed(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('NFR-013 controller: failure isolation', () => {
  it('a rejected load hides chat, reports one fixed reason and does not throw', async () => {
    const {controller, failures} = setup({
      load: () => Promise.reject(new Error('blocked by an ad blocker')),
    });
    controller.setAllowed(true);
    await settle();
    expect(controller.getState().phase).toBe('failed');
    expect(failures).toEqual(['load_failed']);
    expect(JSON.stringify(failures)).not.toContain('ad blocker');
  });

  it('a load that never settles times out', async () => {
    const {controller, failures} = setup({load: () => new Promise(() => {})});
    controller.setAllowed(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(controller.getState().phase).toBe('loading');
    await vi.advanceTimersByTimeAsync(2);
    expect(controller.getState().phase).toBe('failed');
    expect(failures).toEqual(['load_timeout']);
  });

  it('a provider that says it is not ready after loading counts as failed', async () => {
    const {controller, failures} = setup({ready: false});
    controller.setAllowed(true);
    await settle();
    expect(failures).toEqual(['not_ready']);
  });

  it.each([
    ['no adapter exists', () => Promise.resolve(null)],
    ['the adapter cannot be built', () => Promise.reject(new Error('chunk'))],
  ])('%s: failed with create_failed', async (_name, create) => {
    const {controller, failures} = setup({}, create);
    controller.setAllowed(true);
    await settle();
    expect(controller.getState().phase).toBe('failed');
    expect(failures).toEqual(['create_failed']);
  });

  it('a throwing failure sink does not break the controller', async () => {
    const controller = createChatController({
      create: () => Promise.resolve(null),
      onFailure: () => {
        throw new Error('sink');
      },
    });
    controller.setAllowed(true);
    await settle();
    expect(controller.getState().phase).toBe('failed');
  });

  it('a passive failure is silent; one the shopper asked about is announced', async () => {
    const passive = setup({load: () => Promise.reject(new Error('x'))});
    passive.controller.setAllowed(true);
    await settle();
    expect(passive.controller.getState().notice).toBeNull();
    passive.controller.requestOpen();
    expect(passive.controller.getState()).toMatchObject({
      phase: 'failed',
      requested: true,
      notice: 'unavailable',
    });

    const asked = setup({load: () => Promise.reject(new Error('x'))});
    asked.controller.setAllowed(true);
    asked.controller.requestOpen();
    await settle();
    expect(asked.controller.getState()).toMatchObject({
      phase: 'failed',
      requested: true,
      notice: 'unavailable',
    });
  });

  it('a fresh grant after a failure tries once more; there is no retry loop on its own', async () => {
    let attempts = 0;
    const {controller, failures} = setup({
      load: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('x'))
          : Promise.resolve();
      },
    });
    controller.setAllowed(true);
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(1);
    controller.setAllowed(false);
    controller.setAllowed(true);
    await settle();
    expect(attempts).toBe(2);
    expect(controller.getState().phase).toBe('ready');
    expect(failures).toEqual(['load_failed']);
  });
});

describe('REQ-ANL-004 controller: opening', () => {
  it('opens at once when ready', async () => {
    const {controller, calls} = setup();
    controller.setAllowed(true);
    await settle();
    controller.requestOpen();
    expect(calls).toEqual(['load', 'open']);
    expect(controller.getState()).toMatchObject({
      requested: false,
      notice: null,
    });
  });

  it('open before ready is remembered, announced as starting, and honoured exactly once when ready', async () => {
    let finish: () => void = () => {};
    const {controller, calls} = setup({
      load: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    controller.setAllowed(true);
    controller.requestOpen();
    controller.requestOpen();
    await settle(); // the adapter is built and its script is loading
    expect(controller.getState()).toMatchObject({
      phase: 'loading',
      requested: true,
      notice: 'starting',
    });
    expect(calls).toEqual(['load']);
    finish();
    await settle();
    expect(calls).toEqual(['load', 'open']);
    expect(controller.getState()).toMatchObject({phase: 'ready', notice: null});
  });

  it('ignores an open request while waiting for consent', () => {
    const {controller, calls} = setup();
    controller.requestOpen();
    expect(controller.getState()).toMatchObject({
      phase: 'waiting',
      requested: false,
    });
    expect(calls).toEqual([]);
  });

  it('a throwing open is isolated: reported, announced, still ready', async () => {
    const {controller, failures} = setup({
      open: () => {
        throw new Error('widget error');
      },
    });
    controller.setAllowed(true);
    await settle();
    controller.requestOpen();
    expect(failures).toEqual(['open_threw']);
    expect(controller.getState()).toMatchObject({
      phase: 'ready',
      notice: 'open_failed',
      requested: false,
    });
  });
});

describe('NFR-011 controller: consent withdrawn', () => {
  it('unloads a ready provider and hides chat; a new grant loads it again', async () => {
    const {controller, calls} = setup();
    controller.setAllowed(true);
    await settle();
    controller.setAllowed(false);
    expect(controller.getState().phase).toBe('waiting');
    expect(calls).toEqual(['load', 'unload']);
    controller.setAllowed(true);
    await settle();
    expect(calls).toEqual(['load', 'unload', 'load']);
    expect(controller.getState().phase).toBe('ready');
  });

  it('withdrawal during the load unloads when the script arrives and never opens', async () => {
    let finish: () => void = () => {};
    const {controller, calls} = setup({
      load: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    controller.setAllowed(true);
    await settle(); // the provider exists and its load is in flight
    controller.requestOpen();
    controller.setAllowed(false);
    expect(controller.getState()).toMatchObject({
      phase: 'waiting',
      requested: false,
    });
    finish();
    await settle();
    expect(calls).toEqual(['load', 'unload', 'unload']);
    expect(calls).not.toContain('open');
    expect(controller.getState().phase).toBe('waiting');
  });

  it('a grant that returns during the load is not unloaded by the overtaken attempt', async () => {
    const finishers: Array<() => void> = [];
    const {controller, calls} = setup({
      load: () => new Promise<void>((resolve) => finishers.push(resolve)),
    });
    controller.setAllowed(true);
    await settle();
    controller.setAllowed(false);
    controller.setAllowed(true);
    finishers.forEach((finish) => finish());
    await settle();
    expect(controller.getState().phase).toBe('ready');
    // One unload, from the withdrawal itself; the overtaken load did not tear the live one down.
    expect(calls.filter((call) => call === 'unload')).toHaveLength(1);
  });

  it('a provider that cannot unload is reported, and our call-outs are hidden anyway', async () => {
    const {controller, failures} = setup({unload: null});
    controller.setAllowed(true);
    await settle();
    controller.setAllowed(false);
    expect(controller.getState().phase).toBe('waiting');
    expect(failures).toEqual(['unload_unsupported']);
  });

  it('a throwing unload is reported and does not throw', async () => {
    const {controller, failures} = setup({
      unload: () => {
        throw new Error('x');
      },
    });
    controller.setAllowed(true);
    await settle();
    expect(() => controller.setAllowed(false)).not.toThrow();
    expect(failures).toEqual(['unload_threw']);
  });

  it('stop unloads and forgets listeners', async () => {
    const {controller, calls} = setup();
    const listener = vi.fn();
    controller.setAllowed(true);
    await settle();
    controller.subscribe(listener);
    controller.stop();
    expect(calls).toEqual(['load', 'unload']);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('NFR-011 / NFR-013 controller: a script that arrives late (review M2)', () => {
  it('after a timeout, a load that eventually resolves is unloaded; a later withdrawal unloads again', async () => {
    let finish: () => void = () => {};
    const {controller, calls, failures} = setup({
      load: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    controller.setAllowed(true);
    await settle();
    await vi.advanceTimersByTimeAsync(1001);
    expect(failures).toEqual(['load_timeout']);
    expect(controller.getState().phase).toBe('failed');
    const unloadsAtTimeout = calls.filter((call) => call === 'unload').length;
    finish();
    await settle();
    expect(calls.filter((call) => call === 'unload').length).toBe(
      unloadsAtTimeout + 1,
    );
    expect(controller.getState().phase).toBe('failed');
    controller.setAllowed(false);
    expect(calls.filter((call) => call === 'unload').length).toBe(
      unloadsAtTimeout + 2,
    );
  });

  it('withdrawing after the timeout and before the script arrives still removes it when it does', async () => {
    let finish: () => void = () => {};
    const {controller, calls} = setup({
      load: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    controller.setAllowed(true);
    await settle();
    await vi.advanceTimersByTimeAsync(1001);
    controller.setAllowed(false);
    const before = calls.filter((call) => call === 'unload').length;
    finish();
    await settle();
    expect(calls.filter((call) => call === 'unload').length).toBe(before + 1);
    expect(controller.getState().phase).toBe('waiting');
  });

  it('a withdrawal always unloads once a provider exists, also from the failed state', async () => {
    const {controller, calls} = setup({
      load: () => Promise.reject(new Error('x')),
    });
    controller.setAllowed(true);
    await settle();
    const afterFailure = calls.filter((call) => call === 'unload').length;
    controller.setAllowed(false);
    expect(calls.filter((call) => call === 'unload').length).toBe(
      afterFailure + 1,
    );
  });

  it('a provider that cannot unload is reported once, not on every attempt', async () => {
    const {controller, failures} = setup({
      unload: null,
      load: () => Promise.reject(new Error('x')),
    });
    controller.setAllowed(true);
    await settle();
    controller.setAllowed(false);
    controller.setAllowed(true);
    await settle();
    controller.setAllowed(false);
    expect(
      failures.filter((reason) => reason === 'unload_unsupported'),
    ).toHaveLength(1);
  });
});

describe('REQ-ANL-004 controller: robustness (review m1, m2)', () => {
  it('overlapping starts share one adapter creation', async () => {
    let creations = 0;
    let finishCreate: () => void = () => {};
    const made = scripted();
    const controller = createChatController({
      create: () => {
        creations += 1;
        return new Promise<ChatProvider>((resolve) => {
          finishCreate = () => resolve(made.provider);
        });
      },
      onFailure: () => {},
      loadTimeoutMs: 1000,
    });
    controller.setAllowed(true);
    controller.setAllowed(false);
    controller.setAllowed(true);
    finishCreate();
    await settle();
    expect(creations).toBe(1);
    expect(controller.getState().phase).toBe('ready');
    expect(made.calls.filter((call) => call === 'load')).toHaveLength(1);
  });

  it('a creation that failed is forgotten, so a fresh grant tries again', async () => {
    let creations = 0;
    const made = scripted();
    const controller = createChatController({
      create: () => {
        creations += 1;
        return creations === 1
          ? Promise.reject(new Error('chunk'))
          : Promise.resolve(made.provider);
      },
      onFailure: () => {},
    });
    controller.setAllowed(true);
    await settle();
    expect(controller.getState().phase).toBe('failed');
    controller.setAllowed(false);
    controller.setAllowed(true);
    await settle();
    expect(creations).toBe(2);
    expect(controller.getState().phase).toBe('ready');
  });

  it('an isReady that throws counts as not ready and does not throw', async () => {
    const {controller, failures} = setup({readyThrows: true});
    controller.setAllowed(true);
    await settle();
    expect(controller.getState().phase).toBe('failed');
    expect(failures).toEqual(['not_ready']);
  });
});
