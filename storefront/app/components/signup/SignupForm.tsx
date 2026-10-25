import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {Link, useFetcher} from 'react-router';
import {Button} from '~/components/ui/Button';
import {Checkbox} from '~/components/ui/Checkbox';
import {Input} from '~/components/ui/Input';
import {EMAIL_CONSENT, SMS_CONSENT} from '~/lib/signup/consent';
import {precheckSignup} from '~/lib/signup/precheck';
import {
  CONSENT_GIVEN,
  SIGNUP_FIELDS,
  SIGNUP_MESSAGES,
  type SignupFieldErrors,
  type SignupPublicConfig,
  type SignupResponse,
  type SignupSurface,
} from '~/lib/signup/shared';

export type SignupFormProps = {
  /** From the root loader; the form is not rendered at all when the signup is off. */
  readonly config: SignupPublicConfig;
  /** Where this copy sits: sent with the form and written into Klaviyo's consent source (footer or home). */
  readonly surface: SignupSurface;
};

const NO_ERRORS: SignupFieldErrors = {};

/**
 * Email signup (REQ-ANL-003, P7-02). This file is a lazy chunk (SignupSlot): no route's initial JavaScript carries it.
 *
 * - Marketing consent is an explicit, UNTICKED checkbox with the sentence beside it, never pre-checked, and independent
 *   of the analytics banner (a separate act with a separate purpose).
 * - A plain POST form to /signup: with JavaScript a fetcher sends it and the answer appears in place, without it the
 *   browser posts and /signup shows the answer. The server repeats every check.
 * - The answer is a polite live region that is always in the document, so assistive technology is already watching
 *   when text appears. Field problems are inline, tied to their field, and focus moves to the first one.
 * - Nothing the shopper typed is echoed into the page by the server; a successful send clears the form.
 */
export function SignupForm({config, surface}: SignupFormProps) {
  const headingId = useId();
  const fetcher = useFetcher<SignupResponse>();
  const formRef = useRef<HTMLFormElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);
  // When the form appeared, for the honeypot's time check. Read in the submit handler only, never during render.
  const shownAt = useRef(Date.now());
  const [clientErrors, setClientErrors] = useState<SignupFieldErrors | null>(
    null,
  );
  // Counts the browser's own refusals so the focus effect runs once per refusal, even when the same field fails twice.
  const [refusals, setRefusals] = useState(0);

  const answer = fetcher.data;
  const busy = fetcher.state !== 'idle';
  // While a resubmission is in flight the previous answer is stale: show neither its field errors nor its message (n2).
  const settled = busy ? undefined : answer;
  const errors: SignupFieldErrors =
    clientErrors ??
    (settled?.status === 'invalid' ? settled.errors : NO_ERRORS);
  const message = clientErrors
    ? SIGNUP_MESSAGES.invalid
    : (settled?.message ?? '');

  useEffect(() => {
    if (answer?.status === 'ok') formRef.current?.reset();
  }, [answer]);

  // After a refusal, by the browser or by the server, the keyboard lands on the first field that needs attention.
  useEffect(() => {
    if (refusals === 0 && answer?.status !== 'invalid') return;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  }, [refusals, answer]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Written just before the browser builds the form data. A person needs more than two seconds; a script does not.
    if (ageRef.current) {
      ageRef.current.value = String(Math.max(0, Date.now() - shownAt.current));
    }
    const found = precheckSignup(new FormData(event.currentTarget), {
      sms: config.sms,
    });
    if (Object.keys(found).length > 0) {
      event.preventDefault();
      setClientErrors(found);
      setRefusals((count) => count + 1);
      return;
    }
    setClientErrors(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 id={headingId} className="text-xl font-bold text-fg">
        Get sleep tips and offers
      </h2>
      <p className="text-base text-fg-muted">
        Join our email list for new arrivals, offers and sleep advice.
      </p>
      <fetcher.Form
        method="post"
        action="/signup"
        noValidate
        // The answer is all the page needs: no loader (root, footer links, cart) re-runs for a signup (SU-L4).
        defaultShouldRevalidate={false}
        onSubmit={onSubmit}
        ref={formRef}
        aria-labelledby={headingId}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name={SIGNUP_FIELDS.surface} value={surface} />
        <input
          type="hidden"
          name={SIGNUP_FIELDS.emailConsentVersion}
          value={EMAIL_CONSENT.version}
        />
        <input
          ref={ageRef}
          type="hidden"
          name={SIGNUP_FIELDS.formAge}
          defaultValue=""
        />
        {/* A field no person sees: a bot that fills every input fills this one, and the server drops the signup. */}
        <div aria-hidden="true" className="sr-only">
          <label>
            Leave this field empty
            <input
              type="text"
              name={SIGNUP_FIELDS.honeypot}
              tabIndex={-1}
              autoComplete="off"
              defaultValue=""
            />
          </label>
        </div>

        <Input
          name={SIGNUP_FIELDS.email}
          type="email"
          label="Email address"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          error={errors.email}
        />
        <Checkbox
          name={SIGNUP_FIELDS.emailConsent}
          value={CONSENT_GIVEN}
          required
          label={EMAIL_CONSENT.text}
          error={errors.consent}
        />
        {config.sms ? (
          <>
            <input
              type="hidden"
              name={SIGNUP_FIELDS.smsConsentVersion}
              value={SMS_CONSENT.version}
            />
            <Input
              name={SIGNUP_FIELDS.phone}
              type="tel"
              label="Mobile number (optional)"
              hint="US numbers only."
              maxLength={30}
              autoComplete="tel"
              inputMode="tel"
              error={errors.phone}
            />
            <Checkbox
              name={SIGNUP_FIELDS.smsConsent}
              value={CONSENT_GIVEN}
              label={SMS_CONSENT.text}
              error={errors.smsConsent}
            />
          </>
        ) : null}
        <p className="text-sm text-fg-muted">
          We use your details only to send these messages.
          {config.privacyHref ? (
            <>
              {' '}
              <Link
                to={config.privacyHref}
                className="inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-2"
              >
                Privacy policy
              </Link>
            </>
          ) : null}
        </p>
        <div>
          <Button
            type="submit"
            variant="pill"
            loading={busy}
            loadingLabel="Signing you up"
          >
            Sign up
          </Button>
        </div>
      </fetcher.Form>
      {/* Always in the document, empty until there is something to say, so the announcement is not missed. */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {message !== '' || errors.form ? (
          <p
            className={
              answer?.status === 'ok' && !clientErrors
                ? 'text-base font-bold text-fg'
                : 'text-base font-bold text-error-fg'
            }
          >
            {errors.form ?? message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
