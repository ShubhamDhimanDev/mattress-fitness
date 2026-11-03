import {useEffect, useRef, useState, type FormEvent} from 'react';
import {useFetcher} from 'react-router';
import {Button} from '~/components/ui/Button';
import {Input} from '~/components/ui/Input';
import {Select} from '~/components/ui/Select';
import {track} from '~/lib/analytics';
import {
  BUDGET_OPTIONS,
  VISIT_WINDOW_OPTIONS,
  validateLeadForm,
  type LeadFormErrors,
  type LeadFormField,
} from '~/lib/leads/lead-form';
import {
  VISIT_HONEYPOT_FIELD,
  type VisitRequestResponse,
} from '~/lib/leads/visit-request';

const HEADING_ID = 'lead-heading';

const NO_ERRORS: LeadFormErrors = {};

function readValues(form: HTMLFormElement): Record<LeadFormField, string> {
  const data = new FormData(form);
  const get = (name: string): string => {
    const value = data.get(name);
    return typeof value === 'string' ? value : '';
  };
  return {
    budget: get('budget'),
    visitWindow: get('visitWindow'),
    name: get('name'),
    phone: get('phone'),
    zip: get('zip'),
  };
}

/**
 * "Plan your visit" on the home page (CR-33, DEC-145). The browser checks the answers first; a valid form posts to
 * /visit-request, which emails the store team over SMTP. The lead event
 * (no parameters) fires only after the server confirms the email was sent. Without JavaScript the form posts there directly.
 */
export function LeadForm() {
  const fetcher = useFetcher<VisitRequestResponse>();
  const [clientErrors, setClientErrors] = useState<LeadFormErrors | null>(null);
  const tracked = useRef<VisitRequestResponse | null>(null);

  const busy = fetcher.state !== 'idle';
  // While a resubmission is in flight the previous answer is stale.
  const answer = busy ? undefined : fetcher.data;
  const serverErrors = answer?.status === 'invalid' ? answer.errors : NO_ERRORS;
  const errors = clientErrors ?? serverErrors;

  useEffect(() => {
    if (answer?.status === 'ok' && tracked.current !== answer) {
      tracked.current = answer;
      track({name: 'generate_lead', params: {}});
    }
  }, [answer]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const result = validateLeadForm(readValues(event.currentTarget));
    if (!result.ok) {
      event.preventDefault();
      setClientErrors(result.errors);
      return;
    }
    setClientErrors(null);
  }

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="flex flex-col gap-8 rounded-hero bg-surface-muted px-4 py-11 md:px-10 md:py-14"
    >
      <div className="flex flex-col gap-3">
        <h2
          id={HEADING_ID}
          className="type-display text-3xl text-balance md:text-heading"
        >
          Plan your <span className="type-mark">visit.</span>
        </h2>
        <p className="text-lead text-fg-muted">
          Tell us your budget and when you can come in, and we will have the
          right beds ready to try.
        </p>
      </div>
      {answer?.status === 'ok' ? (
        <p role="status" className="text-lead font-bold">
          {answer.message}
        </p>
      ) : (
        <fetcher.Form
          method="post"
          action="/visit-request"
          onSubmit={onSubmit}
          noValidate
          // The answer is all the page needs: no loader re-runs for a visit request.
          defaultShouldRevalidate={false}
          className="grid gap-4 sm:grid-cols-2"
        >
          {/* A field no person sees: a bot that fills every input fills this one, and the server drops the request. */}
          <div aria-hidden="true" className="sr-only">
            <label>
              Leave this field empty
              <input
                type="text"
                name={VISIT_HONEYPOT_FIELD}
                tabIndex={-1}
                autoComplete="off"
                defaultValue=""
              />
            </label>
          </div>
          <Select
            name="budget"
            label="What's your budget for a new mattress?"
            options={BUDGET_OPTIONS}
            placeholder="Choose a budget"
            required
            defaultValue=""
            error={errors.budget}
            className="sm:col-span-2"
          />
          <Select
            name="visitWindow"
            label="When can you visit our store?"
            options={VISIT_WINDOW_OPTIONS}
            placeholder="Choose a time"
            required
            defaultValue=""
            error={errors.visitWindow}
            className="sm:col-span-2"
          />
          <Input
            name="name"
            label="Name"
            autoComplete="name"
            maxLength={80}
            required
            error={errors.name}
            className="sm:col-span-2"
          />
          <Input
            name="phone"
            label="Phone number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={25}
            required
            error={errors.phone}
          />
          <Input
            name="zip"
            label="ZIP code"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            required
            error={errors.zip}
          />
          {answer &&
          (answer.status === 'unavailable' ||
            answer.status === 'rate_limited') ? (
            <p
              role="alert"
              className="text-sm font-bold text-error-fg sm:col-span-2"
            >
              {answer.message}
            </p>
          ) : null}
          <p className="text-caption text-fg-muted sm:col-span-2">
            We use these details only to arrange your visit. This is not a
            sign-up for marketing messages.
          </p>
          <Button
            type="submit"
            size="lg"
            loading={busy}
            loadingLabel="Sending your request"
            className="sm:col-span-2"
          >
            Request a visit
          </Button>
        </fetcher.Form>
      )}
    </section>
  );
}
