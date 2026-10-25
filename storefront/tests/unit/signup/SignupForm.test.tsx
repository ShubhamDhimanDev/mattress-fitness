// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {RouterProvider, createMemoryRouter, data} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {HomeSections} from '~/components/home/HomeSections';
import {SiteFooter} from '~/components/layout/SiteFooter';
import {SignupForm} from '~/components/signup/SignupForm';
import {EMAIL_CONSENT, SMS_CONSENT} from '~/lib/signup/consent';
import {
  SIGNUP_FIELDS,
  SIGNUP_FIELD_ERRORS,
  SIGNUP_MESSAGES,
  type SignupPublicConfig,
  type SignupResponse,
} from '~/lib/signup/shared';
import type {HomeData} from '~/lib/shopify/home-data';

// REQ-ANL-003 / NFR-001 / NFR-003 / NFR-011 / NFR-013: the signup form in jsdom, inside a data router whose /signup
// action is a stand-in for the server (the real one is covered by tests/unit/signup/handler.test.ts and
// tests/unit/routes/signup-route.test.ts). Not seen in a browser: no layout, focus ring or axe result is claimed.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
});

const EMAIL_ONLY: SignupPublicConfig = {
  sms: false,
  privacyHref: '/policies/privacy-policy',
};
const WITH_SMS: SignupPublicConfig = {sms: true, privacyHref: null};

type Posted = Record<string, string>;

function renderForm(
  options: {
    config?: SignupPublicConfig;
    respond?: (posted: Posted) => SignupResponse;
    status?: number;
    surface?: 'footer' | 'home';
    /** Holds the answer to the nth post (1-based) until the promise it returns settles. */
    hold?: (post: number) => Promise<void> | undefined;
  } = {},
) {
  const posts: Posted[] = [];
  const loads: number[] = [];
  const router = createMemoryRouter(
    [
      {
        path: '/',
        loader: () => {
          loads.push(1);
          return null;
        },
        element: (
          <SignupForm
            config={options.config ?? EMAIL_ONLY}
            surface={options.surface ?? 'footer'}
          />
        ),
      },
      {
        path: '/signup',
        action: async ({request}) => {
          const form = await request.formData();
          const posted: Posted = {};
          for (const [name, value] of form.entries()) {
            if (typeof value === 'string') posted[name] = value;
          }
          posts.push(posted);
          await options.hold?.(posts.length);
          return data(
            options.respond?.(posted) ?? {
              status: 'ok',
              message: SIGNUP_MESSAGES.ok,
            },
            {status: options.status ?? 200},
          );
        },
      },
    ],
    {initialEntries: ['/']},
  );
  render(<RouterProvider router={router} />);
  return {posts, router, loads};
}

const emailBox = () => screen.getByRole('textbox', {name: /Email address/});
const consentBox = () =>
  screen.getByRole('checkbox', {name: EMAIL_CONSENT.text});
const submit = () => screen.getByRole('button', {name: 'Sign up'});

function fillValid() {
  fireEvent.change(emailBox(), {target: {value: 'shopper@example.com'}});
  fireEvent.click(consentBox());
}

describe('the signup form: structure and consent (REQ-ANL-003, NFR-011)', () => {
  it('is a labelled form with a labelled email field, an UNTICKED consent box with the exact sentence, and a submit button', async () => {
    renderForm();
    const form = await screen.findByRole('form', {
      name: 'Get sleep tips and offers',
    });
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/signup');
    expect(form).toHaveAttribute('novalidate');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Get sleep tips and offers',
      }),
    ).toBeInTheDocument();

    expect(emailBox()).toHaveAttribute('type', 'email');
    expect(emailBox()).toHaveAttribute('autocomplete', 'email');
    expect(emailBox()).toHaveAttribute('maxlength', '254');
    expect(emailBox()).toBeRequired();
    expect(emailBox()).toHaveValue('');

    // Never pre-checked: consent is an act.
    expect(consentBox()).not.toBeChecked();
    expect(consentBox()).toHaveAttribute('name', SIGNUP_FIELDS.emailConsent);
    expect(consentBox()).toHaveAttribute('value', 'yes');
    expect(screen.getByText(EMAIL_CONSENT.text)).toBeInTheDocument();
    expect(submit()).toHaveAttribute('type', 'submit');
  });

  it('sends the surface, the wording version and an empty honeypot, and the honeypot is hidden from people and assistive technology', async () => {
    renderForm({surface: 'home'});
    const form = await screen.findByRole('form');
    const field = (name: string) =>
      form.querySelector<HTMLInputElement>(`[name="${name}"]`);
    expect(field(SIGNUP_FIELDS.surface)).toHaveValue('home');
    expect(field(SIGNUP_FIELDS.emailConsentVersion)).toHaveValue(
      EMAIL_CONSENT.version,
    );
    const trap = field(SIGNUP_FIELDS.honeypot);
    expect(trap).toHaveValue('');
    expect(trap).toHaveAttribute('tabindex', '-1');
    expect(trap).toHaveAttribute('autocomplete', 'off');
    expect(trap?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap?.closest('.sr-only')).not.toBeNull();
    // It is not offered as a control.
    expect(
      screen.queryByRole('textbox', {name: /Leave this field empty/}),
    ).toBeNull();
  });

  it('offers no text-message field when SMS is off', async () => {
    renderForm();
    await screen.findByRole('form');
    expect(screen.queryByLabelText(/Mobile number/)).toBeNull();
    expect(screen.queryByText(/PLACEHOLDER/)).toBeNull();
    expect(
      document.querySelector(`[name="${SIGNUP_FIELDS.smsConsentVersion}"]`),
    ).toBeNull();
  });

  it('links to the privacy policy when that page exists, and shows no link when it does not', async () => {
    renderForm();
    expect(
      await screen.findByRole('link', {name: 'Privacy policy'}),
    ).toHaveAttribute('href', '/policies/privacy-policy');
    cleanup();
    renderForm({config: WITH_SMS});
    await screen.findByRole('form');
    expect(screen.queryByRole('link', {name: 'Privacy policy'})).toBeNull();
  });

  it('uses the 44 px touch size for the field, the consent row and the button', async () => {
    renderForm();
    await screen.findByRole('form');
    expect(emailBox()).toHaveClass('min-h-touch');
    expect(consentBox().closest('label')).toHaveClass('min-h-touch');
    expect(submit()).toHaveClass('min-h-12');
    expect(screen.getByRole('link', {name: 'Privacy policy'})).toHaveClass(
      'min-h-touch',
    );
  });

  it('has an always-present polite live region, empty until there is something to say', async () => {
    renderForm();
    await screen.findByRole('form');
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
  });

  it('does not re-run the page loaders after a signup: the answer is all the page needs (SU-L4)', async () => {
    const {posts, loads} = renderForm();
    await screen.findByRole('form');
    await waitFor(() => expect(loads).toHaveLength(1));
    fillValid();
    fireEvent.click(submit());
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(await screen.findByText(SIGNUP_MESSAGES.ok)).toBeInTheDocument();
    expect(loads).toHaveLength(1);
  });
});

describe('the optional text-message fields (T-16, Q-015)', () => {
  it('shows a labelled number field and a separate UNTICKED SMS consent with the PLACEHOLDER wording', async () => {
    renderForm({config: WITH_SMS});
    await screen.findByRole('form');
    const phone = screen.getByLabelText(/Mobile number/);
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('autocomplete', 'tel');
    const sms = screen.getByRole('checkbox', {name: SMS_CONSENT.text});
    expect(sms).not.toBeChecked();
    expect(sms).not.toBe(consentBox());
    expect(screen.getByText(/PLACEHOLDER/)).toBeInTheDocument();
    expect(
      document.querySelector(`[name="${SIGNUP_FIELDS.smsConsentVersion}"]`),
    ).toHaveValue(SMS_CONSENT.version);
  });

  it('refuses a number without its consent before sending anything', async () => {
    const {posts} = renderForm({config: WITH_SMS});
    await screen.findByRole('form');
    fillValid();
    fireEvent.change(screen.getByLabelText(/Mobile number/), {
      target: {value: '212-555-0100'},
    });
    fireEvent.click(submit());
    expect(
      await screen.findByText(SIGNUP_FIELD_ERRORS.smsConsent),
    ).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('posts the number and both consents when the shopper ticks both', async () => {
    const {posts} = renderForm({config: WITH_SMS});
    await screen.findByRole('form');
    fillValid();
    fireEvent.change(screen.getByLabelText(/Mobile number/), {
      target: {value: '212-555-0100'},
    });
    fireEvent.click(screen.getByRole('checkbox', {name: SMS_CONSENT.text}));
    fireEvent.click(submit());
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      [SIGNUP_FIELDS.phone]: '212-555-0100',
      [SIGNUP_FIELDS.smsConsent]: 'yes',
      [SIGNUP_FIELDS.smsConsentVersion]: SMS_CONSENT.version,
      [SIGNUP_FIELDS.emailConsent]: 'yes',
    });
  });
});

describe('submitting (REQ-ANL-003)', () => {
  it('refuses an empty form inline, ties each message to its field, moves focus to the first problem and sends nothing', async () => {
    const {posts} = renderForm();
    await screen.findByRole('form');
    fireEvent.click(submit());

    expect(
      await screen.findByText(SIGNUP_FIELD_ERRORS.email),
    ).toBeInTheDocument();
    expect(screen.getByText(SIGNUP_FIELD_ERRORS.consent)).toBeInTheDocument();
    expect(emailBox()).toHaveAttribute('aria-invalid', 'true');
    expect(emailBox()).toHaveAccessibleDescription(SIGNUP_FIELD_ERRORS.email);
    expect(consentBox()).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(emailBox()).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent(
      SIGNUP_MESSAGES.invalid,
    );
    expect(posts).toHaveLength(0);
  });

  it('with only the box unticked, the problem is the box and focus goes to it', async () => {
    const {posts} = renderForm();
    await screen.findByRole('form');
    fireEvent.change(emailBox(), {target: {value: 'shopper@example.com'}});
    fireEvent.click(submit());
    expect(
      await screen.findByText(SIGNUP_FIELD_ERRORS.consent),
    ).toBeInTheDocument();
    expect(screen.queryByText(SIGNUP_FIELD_ERRORS.email)).toBeNull();
    await waitFor(() => expect(consentBox()).toHaveFocus());
    expect(posts).toHaveLength(0);
  });

  it('posts the fields once, announces the generic thank-you politely, and clears the form', async () => {
    const {posts} = renderForm({surface: 'footer'});
    await screen.findByRole('form');
    fillValid();
    fireEvent.click(submit());

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      [SIGNUP_FIELDS.email]: 'shopper@example.com',
      [SIGNUP_FIELDS.emailConsent]: 'yes',
      [SIGNUP_FIELDS.emailConsentVersion]: EMAIL_CONSENT.version,
      [SIGNUP_FIELDS.surface]: 'footer',
      [SIGNUP_FIELDS.honeypot]: '',
    });
    expect(posts[0]).not.toHaveProperty(SIGNUP_FIELDS.phone);
    // The browser's own reading of how long the form was open, for the server's honeypot check (review m4).
    expect(posts[0]?.[SIGNUP_FIELDS.formAge]).toMatch(/^\d{1,9}$/);
    expect(await screen.findByText(SIGNUP_MESSAGES.ok)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(SIGNUP_MESSAGES.ok);
    await waitFor(() => expect(emailBox()).toHaveValue(''));
    expect(consentBox()).not.toBeChecked();
    // The address the shopper typed is not echoed back into the page.
    expect(document.body.textContent).not.toContain('shopper@example.com');
  });

  it("shows the server's field problems inline and keeps what was typed", async () => {
    renderForm({
      respond: () => ({
        status: 'invalid',
        message: SIGNUP_MESSAGES.invalid,
        errors: {email: SIGNUP_FIELD_ERRORS.email},
      }),
      status: 422,
    });
    await screen.findByRole('form');
    fillValid();
    fireEvent.click(submit());
    expect(
      await screen.findByText(SIGNUP_FIELD_ERRORS.email),
    ).toBeInTheDocument();
    expect(emailBox()).toHaveValue('shopper@example.com');
    expect(emailBox()).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(emailBox()).toHaveFocus());
  });

  it('shows a friendly retry message when signup is unavailable, and the form stays usable', async () => {
    const {posts} = renderForm({
      respond: () => ({
        status: 'unavailable',
        message: SIGNUP_MESSAGES.unavailable,
      }),
      status: 503,
    });
    await screen.findByRole('form');
    fillValid();
    fireEvent.click(submit());
    expect(
      await screen.findByText(SIGNUP_MESSAGES.unavailable),
    ).toBeInTheDocument();
    // Nothing is cleared and the shopper can try again.
    expect(emailBox()).toHaveValue('shopper@example.com');
    expect(consentBox()).toBeChecked();
    expect(submit()).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(submit());
    await waitFor(() => expect(posts).toHaveLength(2));
  });

  it('says to wait when rate limited', async () => {
    renderForm({
      respond: () => ({
        status: 'rate_limited',
        message: SIGNUP_MESSAGES.rateLimited,
      }),
      status: 429,
    });
    await screen.findByRole('form');
    fillValid();
    fireEvent.click(submit());
    expect(
      await screen.findByText(SIGNUP_MESSAGES.rateLimited),
    ).toBeInTheDocument();
  });

  it('shows a form-level problem (an out-of-date form) in the live region', async () => {
    renderForm({
      respond: () => ({
        status: 'invalid',
        message: SIGNUP_MESSAGES.invalid,
        errors: {form: SIGNUP_FIELD_ERRORS.stale},
      }),
      status: 422,
    });
    await screen.findByRole('form');
    fillValid();
    fireEvent.click(submit());
    expect(
      await screen.findByText(SIGNUP_FIELD_ERRORS.stale),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      SIGNUP_FIELD_ERRORS.stale,
    );
  });
});

describe('mounting: nothing when off, a lazy form when on (NFR-002, NFR-013)', () => {
  const NO_HOME_FIELDS: Omit<HomeData, 'sections'> = {
    featured: null,
    sizeTiles: [],
    brandTiles: [],
    collectionTiles: [],
    sectionsSource: 'admin',
  };
  const SIGNUP_SECTIONS: HomeData['sections'] = [
    {kind: 'signup', id: 'home-section-0'},
  ];

  function inRouter(element: React.ReactNode) {
    const router = createMemoryRouter([{path: '/', element}], {
      initialEntries: ['/'],
    });
    render(<RouterProvider router={router} />);
  }

  it('the footer renders no signup (and so requests no signup code) without a configuration', async () => {
    inRouter(<SiteFooter signup={null} />);
    await screen.findByRole('contentinfo');
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByText('Get sleep tips and offers')).toBeNull();
    // The default, when the prop is not passed at all, is the same.
    cleanup();
    inRouter(<SiteFooter />);
    await screen.findByRole('contentinfo');
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('the footer renders the form, lazily, when configured', async () => {
    inRouter(<SiteFooter signup={EMAIL_ONLY} />);
    const form = await screen.findByRole('form', {
      name: 'Get sleep tips and offers',
    });
    expect(screen.getByRole('contentinfo')).toContainElement(form);
    expect(
      form.querySelector<HTMLInputElement>(`[name="${SIGNUP_FIELDS.surface}"]`),
    ).toHaveValue('footer');
  });

  it('the home page shows the signup block only when configured', async () => {
    inRouter(
      <HomeSections
        home={{...NO_HOME_FIELDS, sections: SIGNUP_SECTIONS}}
        signup={null}
      />,
    );
    await screen.findByRole('heading', {level: 1});
    expect(screen.queryByRole('form')).toBeNull();
    cleanup();
    inRouter(
      <HomeSections
        home={{...NO_HOME_FIELDS, sections: SIGNUP_SECTIONS}}
        signup={EMAIL_ONLY}
      />,
    );
    const form = await screen.findByRole('form', {
      name: 'Get sleep tips and offers',
    });
    expect(
      form.querySelector<HTMLInputElement>(`[name="${SIGNUP_FIELDS.surface}"]`),
    ).toHaveValue('home');
  });

  it('a home page with no signup block in admin shows no form even when configured', async () => {
    inRouter(
      <HomeSections
        home={{...NO_HOME_FIELDS, sections: []}}
        signup={EMAIL_ONLY}
      />,
    );
    await screen.findByRole('heading', {level: 1});
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('two copies on one page (home block and footer) have distinct ids', async () => {
    inRouter(
      <>
        <HomeSections
          home={{...NO_HOME_FIELDS, sections: SIGNUP_SECTIONS}}
          signup={EMAIL_ONLY}
        />
        <SiteFooter signup={EMAIL_ONLY} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByRole('form')).toHaveLength(2));
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a form chunk that cannot be downloaded hides the form and nothing else', async () => {
    vi.resetModules();
    vi.doMock('~/components/signup/SignupForm', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const {SiteFooter: FreshFooter} =
      await import('~/components/layout/SiteFooter');
    inRouter(<FreshFooter signup={EMAIL_ONLY} />);
    const footer = await screen.findByRole('contentinfo');
    // Suspense settles on the empty component (the placeholder is gone); there is no error screen and no form.
    await waitFor(() =>
      expect(footer.querySelector('[aria-hidden="true"].h-72')).toBeNull(),
    );
    expect(screen.queryByRole('form')).toBeNull();
    expect(
      screen.getByRole('navigation', {name: 'Footer'}),
    ).toBeInTheDocument();
    vi.doUnmock('~/components/signup/SignupForm');
  });

  it('the page shell names the form only through a dynamic import: no static import, no shared slot module (bundle budget, scripts/perf, review m7)', () => {
    const read = (path: string) =>
      readFileSync(resolve(process.cwd(), path), 'utf8');
    for (const shell of [
      'app/components/layout/SiteFooter.tsx',
      'app/components/home/HomeSections.tsx',
    ]) {
      const source = read(shell);
      expect(source).toContain("import('~/components/signup/SignupForm')");
      // Every static mention of the form module is a type-only import (erased at build).
      const statics = source
        .split('\n')
        .filter(
          (line) =>
            line.startsWith('import ') && line.includes('components/signup/'),
        );
      expect(statics.every((line) => line.startsWith('import type'))).toBe(
        true,
      );
      expect(source).not.toContain('SignupSlot');
      // Server-only signup code (the key, the handler) never reaches a component.
      for (const serverOnly of [
        'config',
        'handler',
        'klaviyo-client',
        'limiter',
        'request',
      ]) {
        expect(source).not.toContain(`lib/signup/${serverOnly}'`);
      }
    }
    // The root's layout wrapper passes a plain prop and imports nothing from the signup folders at run time.
    const layout = read('app/components/layout/PageLayout.tsx');
    expect(layout).not.toContain('components/signup');
    const runtimeSignupImports = layout
      .split('\n')
      .filter(
        (line) =>
          line.startsWith('import ') &&
          !line.startsWith('import type') &&
          line.includes('lib/signup'),
      );
    expect(runtimeSignupImports).toEqual([]);
  });

  it('no component imports server-only signup code', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'app/components/signup/SignupForm.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(
      /lib\/signup\/(config|handler|klaviyo-client|limiter|request)'/,
    );
    expect(source).not.toMatch(/process\.env|KLAVIYO_/);
  });
});
