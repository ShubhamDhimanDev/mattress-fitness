// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  TAWK_SCRIPT_ID,
  createTawkProvider,
  tawkScriptUrl,
} from '~/lib/chat/providers/tawk';

// REQ-ANL-004, NFR-013, T-10: the tawk.to adapter adds one script from the documented address, keeps the vendor's bubble
// hidden, opens only on request, fails cleanly, and on withdrawal hides and disconnects without adding a second script.

const IDS = {propertyId: 'prop123', widgetId: 'wid456'};

type VendorMethods = {
  hideWidget: ReturnType<typeof vi.fn>;
  showWidget: ReturnType<typeof vi.fn>;
  maximize: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
};

/** Plays the vendor: adds its methods to the object we handed over and calls `onLoad`, as the real script does. */
function vendorLoads(target: object): VendorMethods & {
  onLoad: () => void;
  onChatMinimized: () => void;
} {
  const api = Reflect.get(target, 'Tawk_API') as object;
  const methods: VendorMethods = {
    hideWidget: vi.fn(),
    showWidget: vi.fn(),
    maximize: vi.fn(),
    shutdown: vi.fn(),
    start: vi.fn(),
  };
  Object.assign(api, methods);
  const callbacks = api as {onLoad: () => void; onChatMinimized: () => void};
  callbacks.onLoad();
  return {...methods, ...callbacks};
}

function setup() {
  const target: object = {};
  const provider = createTawkProvider(IDS, document, target);
  return {target, provider};
}

afterEach(() => {
  document.head.innerHTML = '';
});

describe('REQ-ANL-004 tawk.to adapter', () => {
  it('builds the documented address from the two ids', () => {
    expect(tawkScriptUrl(IDS)).toBe('https://embed.tawk.to/prop123/wid456');
  });

  it('adds one async script from that address and is not ready until the vendor reports it loaded', () => {
    const {provider} = setup();
    const loading = provider.load();
    const scripts = document.querySelectorAll(`#${TAWK_SCRIPT_ID}`);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute('src')).toBe(
      'https://embed.tawk.to/prop123/wid456',
    );
    expect(provider.isReady()).toBe(false);
    expect(provider.load()).toBe(loading);
    expect(document.querySelectorAll(`#${TAWK_SCRIPT_ID}`)).toHaveLength(1);
  });

  it('on load it hides the vendor bubble and is ready', async () => {
    const {provider, target} = setup();
    const loading = provider.load();
    const api = vendorLoads(target);
    await loading;
    expect(api.hideWidget).toHaveBeenCalledTimes(1);
    expect(provider.isReady()).toBe(true);
    await provider.load();
    expect(document.querySelectorAll(`#${TAWK_SCRIPT_ID}`)).toHaveLength(1);
  });

  it('opens by showing then maximising, and minimising hands the shopper back to our call-out', async () => {
    const {provider, target} = setup();
    const loading = provider.load();
    const api = vendorLoads(target);
    await loading;
    provider.open();
    expect(api.showWidget).toHaveBeenCalledTimes(1);
    expect(api.maximize).toHaveBeenCalledTimes(1);
    api.hideWidget.mockClear();
    api.onChatMinimized();
    expect(api.hideWidget).toHaveBeenCalledTimes(1);
  });

  it('open throws when the vendor methods are missing, so the controller can say so', () => {
    const {provider} = setup();
    expect(() => provider.open()).toThrow('tawk.to widget is not available');
  });

  it('a script that cannot be loaded rejects, leaves nothing behind and can be tried again', async () => {
    const {provider} = setup();
    const loading = provider.load();
    document.getElementById(TAWK_SCRIPT_ID)?.dispatchEvent(new Event('error'));
    await expect(loading).rejects.toThrow('failed to load');
    expect(document.getElementById(TAWK_SCRIPT_ID)).toBeNull();
    expect(provider.isReady()).toBe(false);
    void provider.load();
    expect(document.querySelectorAll(`#${TAWK_SCRIPT_ID}`)).toHaveLength(1);
  });

  it('unload hides and disconnects; a later load starts the same script again instead of adding another', async () => {
    const {provider, target} = setup();
    const loading = provider.load();
    const api = vendorLoads(target);
    await loading;
    provider.unload?.();
    expect(api.shutdown).toHaveBeenCalledTimes(1);
    expect(provider.isReady()).toBe(false);

    await provider.load();
    expect(api.start).toHaveBeenCalledWith({showWidget: false});
    expect(provider.isReady()).toBe(true);
    expect(document.querySelectorAll(`#${TAWK_SCRIPT_ID}`)).toHaveLength(1);
  });

  it('unload before the vendor loaded does nothing and does not throw', () => {
    const {provider} = setup();
    void provider.load();
    expect(() => provider.unload?.()).not.toThrow();
  });
});
