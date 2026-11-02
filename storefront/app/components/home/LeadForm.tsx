import {useState, type FormEvent} from 'react';
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

const HEADING_ID = 'lead-heading';

const EMPTY: Record<LeadFormField, string> = {
  budget: '',
  visitWindow: '',
  name: '',
  phone: '',
  zip: '',
};

/**
 * "Plan your visit" on the home page (CR-33). A valid submit fires the lead event to whichever pixels the shopper
 * allowed, with no parameters, and nothing else: the answers are not stored or sent anywhere (owner decision
 * 2026-11-02), so the confirmation promises nothing about a follow-up.
 */
export function LeadForm() {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<LeadFormErrors>({});
  const [done, setDone] = useState(false);

  function set(field: LeadFormField) {
    return (event: {currentTarget: {value: string}}) => {
      setValues((current) => ({...current, [field]: event.currentTarget.value}));
    };
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateLeadForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    track({name: 'generate_lead', params: {}});
    setValues(EMPTY);
    setDone(true);
  }

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="grid gap-8 rounded-hero bg-surface-muted px-4 py-11 md:px-12 md:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start lg:gap-12"
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
      {done ? (
        <p role="status" className="text-lead font-bold">
          Thank you. Your request has been noted.
        </p>
      ) : (
        <form
          onSubmit={onSubmit}
          noValidate
          className="grid gap-4 sm:grid-cols-2"
        >
          <Select
            label="What's your budget for a new mattress?"
            options={BUDGET_OPTIONS}
            placeholder="Choose a budget"
            required
            value={values.budget}
            onChange={set('budget')}
            error={errors.budget}
            className="sm:col-span-2"
          />
          <Select
            label="When can you visit our store?"
            options={VISIT_WINDOW_OPTIONS}
            placeholder="Choose a time"
            required
            value={values.visitWindow}
            onChange={set('visitWindow')}
            error={errors.visitWindow}
            className="sm:col-span-2"
          />
          <Input
            label="Name"
            autoComplete="name"
            required
            value={values.name}
            onChange={set('name')}
            error={errors.name}
            className="sm:col-span-2"
          />
          <Input
            label="Phone number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={values.phone}
            onChange={set('phone')}
            error={errors.phone}
          />
          <Input
            label="ZIP code"
            inputMode="numeric"
            autoComplete="postal-code"
            required
            value={values.zip}
            onChange={set('zip')}
            error={errors.zip}
          />
          <Button type="submit" size="lg" className="sm:col-span-2">
            Request a visit
          </Button>
        </form>
      )}
    </section>
  );
}
