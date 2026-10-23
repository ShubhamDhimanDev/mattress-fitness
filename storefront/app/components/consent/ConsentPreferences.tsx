import {useId, useState, useSyncExternalStore, type FormEvent} from 'react';
import {Button} from '~/components/ui/Button';
import {Dialog} from '~/components/ui/Dialog';
import {
  configuredCategories,
  type ConsentCategory,
  type PublicAnalyticsConfig,
} from '~/lib/analytics/config';
import type {ConsentStore} from '~/lib/analytics/consent-store';
import type {ConsentChoice} from '~/lib/analytics/consent';

const CATEGORY_TEXT: Record<
  ConsentCategory,
  {readonly label: string; readonly hint: string}
> = {
  analytics: {
    label: 'Analytics',
    hint: 'Counts visits and shows which pages and products are used, so we can improve the site (Google Analytics).',
  },
  marketing: {
    label: 'Marketing',
    hint: 'Measures our advertising and lets us show relevant offers elsewhere (Meta).',
  },
};

/**
 * The preferences dialog, opened by the banner's "Choose" or by a "Privacy choices" link (PrivacyChoicesButton).
 * Only the categories a configured provider needs are listed. Each switch starts at the current choice, so a
 * shopper who returns to withdraw consent sees what is on. Strictly necessary storage (cart, sign-in, the
 * delivery ZIP the shopper asked us to keep) is not optional and is not listed.
 */
export function ConsentPreferences({
  config,
  store,
}: {
  config: PublicAnalyticsConfig;
  store: ConsentStore;
}) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return (
    <Dialog
      open={snapshot.preferencesOpen}
      onClose={() => store.closePreferences()}
      title="Privacy choices"
      description="Choose what we may use. You can change this at any time from the Privacy choices link in the footer."
    >
      <PreferencesForm
        categories={configuredCategories(config)}
        initial={snapshot.choice}
        onSave={(choice) => store.save(choice)}
        onRejectAll={() => store.rejectAll()}
      />
    </Dialog>
  );
}

/**
 * A labelled native checkbox in the style of `ui/Checkbox` (44 px row, recoloured native input, hint wired with
 * `aria-describedby`, the label alone naming the control). Written out here instead of imported because `ui/Checkbox` shares `ui/Field`
 * with the form inputs, and importing it from the consent chunk would turn `Field` into a shared chunk that every
 * route with an input downloads separately (bundle budget, scripts/perf).
 */
function CategorySwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex min-h-touch items-start gap-3 py-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={hintId}
        className="mt-0.5 size-6 shrink-0 cursor-pointer accent-primary-500"
      />
      <div className="flex flex-col">
        <label htmlFor={id} className="cursor-pointer text-base text-fg">
          {label}
        </label>
        <span id={hintId} className="text-sm text-fg-muted">
          {hint}
        </span>
      </div>
    </div>
  );
}

function PreferencesForm({
  categories,
  initial,
  onSave,
  onRejectAll,
}: {
  categories: readonly ConsentCategory[];
  initial: ConsentChoice;
  onSave: (choice: ConsentChoice) => void;
  onRejectAll: () => void;
}) {
  const [choice, setChoice] = useState<ConsentChoice>(initial);

  function submit(event: FormEvent) {
    event.preventDefault();
    // A category without a configured provider is never turned on.
    onSave({
      analytics: categories.includes('analytics') && choice.analytics,
      marketing: categories.includes('marketing') && choice.marketing,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {categories.map((category) => (
          <CategorySwitch
            key={category}
            label={CATEGORY_TEXT[category].label}
            hint={CATEGORY_TEXT[category].hint}
            checked={choice[category]}
            onChange={(checked) =>
              setChoice((current) => ({...current, [category]: checked}))
            }
          />
        ))}
      </div>
      <div className="flex flex-col gap-2 md:flex-row">
        <Button type="submit" variant="primary" size="sm" fullWidth>
          Save choices
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          fullWidth
          onClick={onRejectAll}
        >
          Reject all
        </Button>
      </div>
    </form>
  );
}
