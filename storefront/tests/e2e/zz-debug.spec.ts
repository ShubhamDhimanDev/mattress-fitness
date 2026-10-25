import {AxeBuilder} from '@axe-core/playwright';
import {test} from '@playwright/test';
import {clientNavigate, markWindow} from './helpers/analytics';

const SHOTS =
  'C:/Users/hp/AppData/Local/Temp/claude/c--zzz-shubham-MattressFitness/8de96906-2e7d-475d-ad96-8a728ce94eb7/scratchpad';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

type Shift = {
  t: number;
  v: number;
  input: boolean;
  nodes: string[];
};

for (const [w, h] of [
  [360, 800],
  [412, 915],
  [1280, 800],
] as const) {
  test(`cls ${w}`, async ({page}, info) => {
    test.skip(info.project.name !== 'desktop-chromium');
    await page.setViewportSize({width: w, height: h});
    await page.addInitScript(() => {
      const shifts: unknown[] = [];
      Reflect.set(window, '__shifts', shifts);
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const entry = e as unknown as {
            value: number;
            hadRecentInput: boolean;
            startTime: number;
            sources?: Array<{
              node?: Element;
              previousRect: DOMRect;
              currentRect: DOMRect;
            }>;
          };
          shifts.push({
            t: Math.round(entry.startTime),
            v: entry.value,
            input: entry.hadRecentInput,
            nodes: (entry.sources ?? []).map(
              (s) =>
                `${s.node?.nodeName} ${Math.round(s.previousRect.x)},${Math.round(s.previousRect.y)},${Math.round(s.previousRect.width)}x${Math.round(s.previousRect.height)} -> ${Math.round(s.currentRect.x)},${Math.round(s.currentRect.y)},${Math.round(s.currentRect.width)}x${Math.round(s.currentRect.height)}`,
            ),
          });
        }
      }).observe({type: 'layout-shift', buffered: true});
      const iv = setInterval(() => {
        const b = [...document.querySelectorAll('button')].find((x) =>
          x.textContent?.includes('Chat with us'),
        );
        if (b) {
          Reflect.set(window, '__calloutAt', Math.round(performance.now()));
          clearInterval(iv);
        }
      }, 20);
    });
    await page.goto('/');
    await page.waitForTimeout(7000);
    const out = await page.evaluate(() => ({
      shifts: Reflect.get(window, '__shifts') as Shift[],
      calloutAt: Reflect.get(window, '__calloutAt') as number | undefined,
    }));
    const total = out.shifts
      .filter((s) => !s.input)
      .reduce((a, s) => a + s.v, 0);
    console.log(
      `CLS@${w} calloutInDomAt=${out.calloutAt} total=${total.toFixed(4)} entries=${JSON.stringify(out.shifts)}`,
    );
    await page.screenshot({path: `${SHOTS}/cls-${w}.png`});
  });
}

test('phone drawer open and focus', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-chromium');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', {name: 'Menu'}).click();
  const callout = page
    .getByRole('navigation', {name: 'Help and contact'})
    .getByRole('button', {name: 'Chat with us'});
  await callout.waitFor();
  console.log('viewport', JSON.stringify(page.viewportSize()));
  await page.screenshot({path: `${SHOTS}/phone-menu.png`});
  await callout.click();
  await page.getByRole('dialog', {name: 'Test chat'}).waitFor();
  const state = await page.evaluate(() => ({
    active: document.activeElement?.textContent,
    activeTag: document.activeElement?.tagName,
    inert: document.querySelectorAll('[inert]').length,
    dialogs: [...document.querySelectorAll('[role=dialog]')].map(
      (d) => d.id || d.getAttribute('aria-label'),
    ),
  }));
  console.log('PHONE OPEN', JSON.stringify(state));
  await page.screenshot({path: `${SHOTS}/phone-widget-open.png`});
});

test('phone starting status + failure notice', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-chromium');
  await page.addInitScript(() =>
    Reflect.set(window, '__CHAT_FAKE__', {failLoad: true, loadDelayMs: 8000}),
  );
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', {name: 'Menu'}).click();
  await page
    .getByRole('navigation', {name: 'Help and contact'})
    .getByRole('button', {name: 'Chat with us'})
    .click();
  await page
    .getByRole('status')
    .filter({hasText: 'Starting chat.'})
    .waitFor({state: 'attached'});
  console.log(
    'STATUS',
    JSON.stringify(
      await page.evaluate(() =>
        [...document.querySelectorAll('[role=status]')].map((s) => ({
          text: s.textContent,
          parent: s.parentElement?.tagName,
          inHeader: !!s.closest('header'),
          inDialog: !!s.closest('[role=dialog]'),
        })),
      ),
    ),
  );
  await page.screenshot({path: `${SHOTS}/phone-starting.png`});
  await page
    .getByText('Chat is unavailable right now.')
    .first()
    .waitFor({timeout: 15000});
  console.log(
    'NOTICE',
    JSON.stringify(
      await page.evaluate(() => ({
        active:
          document.activeElement?.tagName +
          ':' +
          (document.activeElement?.getAttribute('tabindex') ?? ''),
        contactLinks: [...document.querySelectorAll('a')].filter((a) =>
          /Contact us instead/.test(a.textContent ?? ''),
        ).length,
        dismiss: [...document.querySelectorAll('button')].filter(
          (b) => b.textContent === 'Dismiss',
        ).length,
        callouts: [...document.querySelectorAll('button')].filter((b) =>
          /Chat with us/.test(b.textContent ?? ''),
        ).length,
      })),
    ),
  );
  await page.screenshot({path: `${SHOTS}/phone-notice.png`});
  const r = await new AxeBuilder({page}).withTags(TAGS).analyze();
  console.log(
    'AXE notice open',
    JSON.stringify(r.violations.map((v) => `${v.impact}:${v.id}:${v.nodes.length}`)),
  );
  await page.getByRole('button', {name: 'Dismiss'}).click();
  console.log(
    'AFTER DISMISS dismiss-buttons',
    await page.getByRole('button', {name: 'Dismiss'}).count(),
    'active',
    await page.evaluate(() => document.activeElement?.tagName),
  );
  const res = await page.request.get('/pages/contact');
  console.log('GET /pages/contact', res.status());
});

test('desktop header + route error swap', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop-chromium');
  await page.setViewportSize({width: 1280, height: 800});
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const callout = page
    .getByRole('banner')
    .getByRole('button', {name: 'Chat with us'});
  await callout.waitFor();
  await page.screenshot({
    path: `${SHOTS}/desktop-header.png`,
    clip: {x: 0, y: 0, width: 1280, height: 260},
  });
  await page.locator('#fake-chat-panel').waitFor({state: 'attached'});
  await markWindow(page);
  await page.evaluate(() => {
    Reflect.set(window, '__panel', document.querySelector('#fake-chat-panel'));
  });
  const reqs: string[] = [];
  page.on('request', (r) => {
    if (/chat/i.test(r.url())) reqs.push(r.url());
  });
  const probe = () =>
    page.evaluate(() => ({
      sameDoc: Reflect.get(window, '__e2eSamePage') === true,
      samePanel:
        Reflect.get(window, '__panel') ===
          document.querySelector('#fake-chat-panel') &&
        document.querySelector('#fake-chat-panel')?.isConnected === true,
      h1: document.querySelector('h1')?.textContent,
      callouts: [...document.querySelectorAll('button')].filter((b) =>
        /Chat with us/.test(b.textContent ?? ''),
      ).length,
    }));
  for (const missing of ['/products/qa-no-such-product', '/qa-no-such-page']) {
    await clientNavigate(page, missing);
    await page.getByRole('heading', {level: 1}).waitFor();
    await page.waitForTimeout(1500);
    console.log('SWAP', missing, JSON.stringify(await probe()), 'chatRequests', reqs.length);
  }
  await clientNavigate(page, '/');
  await page.waitForTimeout(1500);
  console.log('BACK HOME', JSON.stringify(await probe()), 'chatRequests', reqs.length);
});
