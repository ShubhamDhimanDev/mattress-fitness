import {Checkbox} from '~/components/ui/Checkbox';
import {Button} from '~/components/ui/Button';
import {COMPARE_MAX_PRODUCTS} from '~/lib/compare';
import type {PickerItem} from '~/lib/pages/compare-view';

type ComparePickerProps = {
  items: readonly PickerItem[];
  selectedCount: number;
  /** Hidden once JavaScript is running: each change then applies at once. */
  showSubmit: boolean;
  onToggle: (handle: string, checked: boolean) => void;
};

/**
 * Choose up to four products. A plain GET form, so it works without JavaScript (the checked handles become
 * `?handles=`); with JavaScript each checkbox applies immediately and a refused add is announced.
 */
export function ComparePicker({
  items,
  selectedCount,
  showSubmit,
  onToggle,
}: ComparePickerProps) {
  return (
    <form method="get" action="/compare" className="flex flex-col gap-4">
      <fieldset className="min-w-0">
        <legend className="type-display text-2xl">
          Choose products to compare
        </legend>
        <p className="mt-1 text-sm text-fg-muted" aria-live="polite">
          {selectedCount} of {COMPARE_MAX_PRODUCTS} selected.
        </p>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <li key={item.handle}>
              <Checkbox
                variant="card"
                name="handles"
                value={item.handle}
                checked={item.checked}
                onChange={(event) =>
                  onToggle(item.handle, event.currentTarget.checked)
                }
                label={
                  <span>
                    <span className="font-extrabold">{item.title}</span>
                    <span className="block text-sm text-fg-muted">
                      {item.brand}
                    </span>
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      </fieldset>
      {showSubmit ? <Button type="submit">Update comparison</Button> : null}
    </form>
  );
}
