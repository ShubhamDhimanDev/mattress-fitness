import {useState, type FormEvent} from 'react';
import {useConsent} from '~/components/consent/consent-context';
import {Button} from '~/components/ui/Button';
import {Checkbox} from '~/components/ui/Checkbox';
import {Dialog} from '~/components/ui/Dialog';
import {
  configuredCategories,
  type ConsentCategory,
} from '~/lib/analytics/config';
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
export function ConsentPreferences() {
  const consent = useConsent();
  if (!consent?.store) return null;
  const {config, snapshot, store} = consent;
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
          <Checkbox
            key={category}
            label={CATEGORY_TEXT[category].label}
            hint={CATEGORY_TEXT[category].hint}
            checked={choice[category]}
            onChange={(event) =>
              setChoice((current) => ({
                ...current,
                [category]: event.target.checked,
              }))
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
