import {expect, test, type Page} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {ourErrors} from './helpers/catalog';

// P6-03 / P6-11: the sleep quiz. REQ-QZ-001 (eight one-tap questions, progress, back, keyboard),
// REQ-QZ-002 (three results with reasons and size price, See all matches, Retake), REQ-QZ-005 (remembered on
// the device), REQ-QZ-007 (guidance-only note), NFR-001 (360 px), NFR-003 (axe, focus management).
// The data is the preview fixtures, so Add to cart is disabled here (the notice says why).

const FIRST_ANSWERS = [
  'On my side',
  'Soft and cushioned',
  'Yes, I run hot',
  'A partner',
  'Lower back',
  'Hybrid',
  'Queen',
  'Up to $2,500',
] as const;

/** Waits until the page has hydrated so clicks run through React Router, not a full page load. */
async function gotoReady(page: Page, url: string) {
  const response = await page.goto(url);
  await page.waitForLoadState('networkidle');
  return response;
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * An answer option inside the quiz. Scoped to the main landmark because the mega menu also has links called
 * "Queen" and the like; a chosen option also reads "Selected".
 */
function option(page: Page, label: string) {
  const escaped = label.replace(REGEX_SPECIAL, '\\$&');
  return page
    .getByRole('main')
    .getByRole('link', {name: new RegExp(`^${escaped}( Selected)?$`)});
}

const progressbar = (page: Page) =>
  page.getByRole('progressbar', {name: 'Quiz progress'});

async function answerAll(page: Page) {
  for (const label of FIRST_ANSWERS) {
    await option(page, label).click();
  }
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal overflow in px').toBeLessThanOrEqual(
    0,
  );
}

test.describe('REQ-QZ-001 intro', () => {
  test('explains the quiz, carries the guidance note, is accessible and quiet', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await gotoReady(page, '/quiz');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(
      page.getByText('Shopping guidance, not medical advice.').first(),
    ).toBeVisible();
    await expect(
      page.getByRole('link', {name: 'Start the quiz'}),
    ).toBeVisible();
    await expect(page).toHaveTitle(/Sleep quiz/);
    await expectNoSeriousA11yViolations(page);
    expect(ourErrors(errors), 'console errors').toEqual([]);
  });
});

test.describe('REQ-QZ-001 and REQ-QZ-002 full run', () => {
  test('eight one-tap questions lead to three matches, then Retake starts again', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoReady(page, '/quiz');
    await page.getByRole('link', {name: 'Start the quiz'}).click();

    // Question 1: progress bar and heading focus.
    await expect(progressbar(page)).toHaveAttribute(
      'aria-valuetext',
      'Question 1 of 8',
    );
    await expect(
      page.getByRole('heading', {name: 'How do you usually sleep?'}),
    ).toBeFocused();

    await option(page, 'On my side').click();
    await expect(progressbar(page)).toHaveAttribute(
      'aria-valuetext',
      'Question 2 of 8',
    );
    await expect(
      page.getByRole('heading', {name: 'What kind of feel do you like?'}),
    ).toBeFocused();

    for (const label of FIRST_ANSWERS.slice(1)) {
      await option(page, label).click();
    }

    // Results: exactly three, each with reasons, a size price and a disabled Add to cart (preview data).
    await expect(
      page.getByRole('heading', {name: 'Your best matches'}),
    ).toBeFocused();
    await expect(
      page.getByRole('status').filter({hasText: 'matched in Queen'}),
    ).toBeVisible();
    const cards = page.getByRole('main').getByRole('article');
    await expect(cards).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
      const card = cards.nth(i);
      await expect(card).toContainText('Why it matches:');
      await expect(card).toContainText('Queen price');
      await expect(card).toContainText(/\$[\d,]+/);
      await expect(
        card.getByRole('button', {name: 'Add to cart'}),
      ).toBeDisabled();
      await expect(card).toContainText(
        'Preview only: connect the store to enable.',
      );
    }
    await expect(
      page.getByText('Shopping guidance, not medical advice.').first(),
    ).toBeVisible();

    // See all matches opens the collection with the favoured filters.
    const seeAll = page.getByRole('link', {name: 'See all matches'});
    const href = (await seeAll.getAttribute('href')) ?? '';
    expect(href.startsWith('/collections/mattresses?')).toBe(true);
    const params = new URL(href, 'http://localhost').searchParams;
    expect(params.getAll('size')).toEqual(['queen']);
    expect(params.get('price_max')).toBe('2500');
    expect(params.getAll('mattress_type')).toEqual(['hybrid']);

    await expectNoSeriousA11yViolations(page);

    // Retake clears the answers and returns to the intro.
    await page.getByRole('link', {name: 'Retake quiz'}).click();
    await expect(
      page.getByRole('link', {name: 'Start the quiz'}),
    ).toBeVisible();
    expect(ourErrors(errors), 'console errors').toEqual([]);
  });

  test('Back returns to the previous question with the answer still chosen', async ({
    page,
  }) => {
    await gotoReady(page, '/quiz');
    await page.getByRole('link', {name: 'Start the quiz'}).click();
    await option(page, 'On my side').click();
    await page
      .getByRole('main')
      .getByRole('link', {name: 'Back', exact: true})
      .click();
    await expect(
      page.getByRole('heading', {name: 'How do you usually sleep?'}),
    ).toBeFocused();
    await expect(option(page, 'On my side')).toHaveAttribute(
      'aria-current',
      'true',
    );
    // From the first question, Back leaves for the intro.
    await page
      .getByRole('main')
      .getByRole('link', {name: 'Back', exact: true})
      .click();
    await expect(
      page.getByRole('link', {name: 'Start the quiz'}),
    ).toBeVisible();
  });

  test('a reload in the middle of the quiz keeps the place and the answers', async ({
    page,
  }) => {
    await gotoReady(page, '/quiz');
    await page.getByRole('link', {name: 'Start the quiz'}).click();
    for (const label of FIRST_ANSWERS.slice(0, 3)) {
      await option(page, label).click();
    }
    await expect(progressbar(page)).toHaveAttribute(
      'aria-valuetext',
      'Question 4 of 8',
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(progressbar(page)).toHaveAttribute(
      'aria-valuetext',
      'Question 4 of 8',
    );
    await page
      .getByRole('main')
      .getByRole('link', {name: 'Back', exact: true})
      .click();
    await expect(option(page, 'Yes, I run hot')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('a reload on the results shows the same three matches', async ({
    page,
  }) => {
    await gotoReady(page, '/quiz');
    await page.getByRole('link', {name: 'Start the quiz'}).click();
    await answerAll(page);
    const cards = page.getByRole('main').getByRole('article');
    await expect(cards).toHaveCount(3);
    const titles = await cards.getByRole('heading').allInnerTexts();
    await page.reload();
    await expect(cards).toHaveCount(3);
    expect(await cards.getByRole('heading').allInnerTexts()).toEqual(titles);
  });

  test('hostile or stale URLs fall back to the intro instead of failing', async ({
    page,
  }) => {
    for (const url of [
      '/quiz?step=99',
      '/quiz?step=results',
      '/quiz?step=%3Cscript%3E&a.feel=zzz',
      '/quiz?step=results&a.__proto__=x&a.constructor=y',
    ]) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(200);
      await expect(
        page.getByRole('link', {name: 'Start the quiz'}),
      ).toBeVisible();
    }
  });
});

test.describe('REQ-QZ-001 keyboard', () => {
  test('the whole quiz can be completed with the keyboard alone', async ({
    page,
  }) => {
    await gotoReady(page, '/quiz');
    await page.getByRole('link', {name: 'Start the quiz'}).focus();
    await page.keyboard.press('Enter');
    const main = page.getByRole('main');
    for (let question = 0; question < 8; question += 1) {
      await expect(progressbar(page)).toHaveAttribute(
        'aria-valuetext',
        `Question ${question + 1} of 8`,
      );
      // The question heading has focus; one Tab reaches the first option, which Enter chooses.
      await expect(main.getByRole('heading', {level: 2})).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(
        main.getByRole('list', {name: 'Choose one'}).getByRole('link').first(),
      ).toBeFocused();
      await page.keyboard.press('Enter');
    }
    await expect(
      page.getByRole('heading', {name: 'Your best matches'}),
    ).toBeFocused();
    await expect(main.getByRole('article')).toHaveCount(3);
  });
});

test.describe('REQ-QZ-005 remembered on the device', () => {
  test('a finished quiz is offered again, can be reopened and can be cleared', async ({
    page,
  }) => {
    await gotoReady(page, '/quiz');
    await page.getByRole('link', {name: 'Start the quiz'}).click();
    await answerAll(page);
    const cards = page.getByRole('main').getByRole('article');
    await expect(cards).toHaveCount(3);

    await gotoReady(page, '/quiz');
    const prompt = page.getByRole('region', {
      name: 'Continue where you left off',
    });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('link', {name: 'See my saved results'}).click();
    await expect(cards).toHaveCount(3);

    await gotoReady(page, '/quiz');
    await page
      .getByRole('region', {name: 'Continue where you left off'})
      .getByRole('button', {name: 'Clear saved results'})
      .click();
    await expect(
      page.getByRole('region', {name: 'Continue where you left off'}),
    ).toHaveCount(0);
    await gotoReady(page, '/quiz');
    await expect(
      page.getByRole('link', {name: 'Start the quiz'}),
    ).toBeVisible();
    await expect(
      page.getByRole('region', {name: 'Continue where you left off'}),
    ).toHaveCount(0);
  });

  test('Retake also forgets the saved results', async ({page}) => {
    await gotoReady(page, '/quiz');
    await page.getByRole('link', {name: 'Start the quiz'}).click();
    await answerAll(page);
    await page.getByRole('link', {name: 'Retake quiz'}).click();
    await gotoReady(page, '/quiz');
    await expect(
      page.getByRole('link', {name: 'Start the quiz'}),
    ).toBeVisible();
    await expect(
      page.getByRole('region', {name: 'Continue where you left off'}),
    ).toHaveCount(0);
  });
});

test.describe('NFR-001 and NFR-003 layout', () => {
  test('intro, a question and the results have no horizontal scroll at 360 px and pass axe', async ({
    page,
  }) => {
    await page.setViewportSize({width: 360, height: 740});
    await gotoReady(page, '/quiz');
    await noHorizontalScroll(page);

    await page.getByRole('link', {name: 'Start the quiz'}).click();
    await expect(progressbar(page)).toBeVisible();
    await noHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await gotoReady(
      page,
      '/quiz?step=results&a.sleep-position=side&a.feel=soft&a.size=queen',
    );
    await expect(page.getByRole('main').getByRole('article')).toHaveCount(3);
    await noHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('every answer option meets the 44 px target on a phone', async ({
    page,
  }) => {
    await page.setViewportSize({width: 360, height: 740});
    await gotoReady(page, '/quiz');
    await page.getByRole('link', {name: 'Start the quiz'}).click();
    const options = page
      .getByRole('main')
      .getByRole('list', {name: 'Choose one'})
      .getByRole('link');
    await expect(options.first()).toBeVisible();
    const heights = await options.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    );
    expect(heights.length).toBeGreaterThan(1);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
  });
});
