import type {FormEvent} from 'react';
import {useNavigate} from 'react-router';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {CheckIcon, SearchIcon} from '~/components/ui/Icons';
import {Select} from '~/components/ui/Select';
import {Tabs} from '~/components/ui/Tabs';
import {SLEEP_QUIZ_LINK} from '~/lib/navigation';
import {
  finderHref,
  type FinderField,
  type HomeFinderData,
} from '~/lib/shopify/home-finder';

type HomeFinderProps = {finder: HomeFinderData};

/**
 * A choice drawn as a chip but built on a native radio, so it works in a plain GET form: the radio is hidden from the
 * eye, not from the keyboard or a screen reader, and the chip carries the focus ring, the red fill and a check icon
 * when chosen (colour is never the only cue).
 */
function ChoiceChip({
  name,
  value,
  label,
}: {
  name: string;
  value: string;
  label: string;
}) {
  return (
    <div className="group relative">
      <label className="flex min-h-12 cursor-pointer items-center justify-center gap-1 rounded-choice border-2 border-line-strong bg-surface px-2 text-center text-sm font-bold text-fg motion-safe:transition-colors group-has-[:checked]:border-primary-700 group-has-[:checked]:bg-primary-500 group-has-[:checked]:text-white group-has-[:focus-visible]:outline-3 group-has-[:focus-visible]:outline-offset-2 group-has-[:focus-visible]:outline-focus hover:border-ink-600">
        <input
          type="radio"
          name={name}
          value={value}
          className="peer sr-only"
        />
        <CheckIcon className="hidden size-4 peer-checked:block" />
        {label}
      </label>
    </div>
  );
}

function ChipGroup({
  legend,
  field,
  columns,
}: {
  legend: string;
  field: FinderField;
  columns: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-bold text-fg">{legend}</legend>
      <div className={`mt-2 grid gap-2 ${columns}`}>
        {field.options.map((option) => (
          <ChoiceChip
            key={option.value}
            name={field.name}
            value={option.value}
            label={option.label}
          />
        ))}
      </div>
    </fieldset>
  );
}

function SelectFor({
  field,
  label,
  placeholder,
}: {
  field: FinderField;
  label: string;
  placeholder: string;
}) {
  return (
    <Select
      name={field.name}
      label={label}
      placeholder={placeholder}
      options={field.options.map((option) => ({
        value: option.value,
        label: option.label,
      }))}
    />
  );
}

/**
 * The hero's finder card (CR-31): "Shop by size", "Shop by feel" and "Sleep quiz". Each search tab is a GET form to the
 * collection page, so with no JavaScript the first tab still works and the browser builds the URL. With JavaScript the
 * submit goes through `finderHref`, which keeps only the codec's own parameter names and non-empty values ("any feel"
 * leaves nothing in the address). All values come from the filter codec (home-finder.ts); nothing is typed free-form.
 */
export function HomeFinder({finder}: HomeFinderProps) {
  const navigate = useNavigate();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entries = [...new FormData(event.currentTarget)].flatMap(
      ([name, value]) =>
        typeof value === 'string' ? [[name, value] as const] : [],
    );
    void navigate(finderHref(finder, entries));
  }

  const submit = (
    <Button
      type="submit"
      size="lg"
      fullWidth
      leadingIcon={<SearchIcon className="size-5" />}
    >
      Show mattresses
    </Button>
  );

  const tabs = [
    {
      id: 'size',
      label: 'Shop by size',
      content: (
        <form
          method="get"
          action={finder.action}
          onSubmit={onSubmit}
          aria-label="Find mattresses by size"
          className="flex flex-col gap-4"
        >
          <ChipGroup
            legend="Choose a size"
            field={finder.size}
            columns="grid-cols-3 md:grid-cols-6"
          />
          {finder.comfort || finder.brand ? (
            <div className="grid gap-3 md:grid-cols-2">
              {finder.comfort ? (
                <SelectFor
                  field={finder.comfort}
                  label="Feel"
                  placeholder="Any feel"
                />
              ) : null}
              {finder.brand ? (
                <SelectFor
                  field={finder.brand}
                  label="Brand"
                  placeholder="Any brand"
                />
              ) : null}
            </div>
          ) : null}
          {submit}
        </form>
      ),
    },
    ...(finder.comfort
      ? [
          {
            id: 'feel',
            label: 'Shop by feel',
            content: (
              <form
                method="get"
                action={finder.action}
                onSubmit={onSubmit}
                aria-label="Find mattresses by feel"
                className="flex flex-col gap-4"
              >
                <ChipGroup
                  legend="Choose a feel"
                  field={finder.comfort}
                  columns="grid-cols-2 md:grid-cols-3"
                />
                {finder.brand ? (
                  <SelectFor
                    field={finder.brand}
                    label="Brand"
                    placeholder="Any brand"
                  />
                ) : null}
                {submit}
              </form>
            ),
          },
        ]
      : []),
    {
      id: 'quiz',
      label: 'Sleep quiz',
      content: (
        <Button to={SLEEP_QUIZ_LINK.to} size="lg" fullWidth>
          Take the sleep quiz
        </Button>
      ),
    },
  ];

  return (
    <Card variant="raised" className="w-full">
      <Tabs tabs={tabs} label="Find a mattress" />
    </Card>
  );
}
