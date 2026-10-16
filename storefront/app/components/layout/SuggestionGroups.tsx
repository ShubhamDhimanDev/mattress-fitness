import {Image} from '@shopify/hydrogen';
import {Link} from 'react-router';
import {
  optionDomId,
  type SuggestionGroup,
  type SuggestionOption,
} from '~/components/layout/searchCombobox';
import {Price} from '~/components/ui/Price';

const OPTION_CLASSES =
  'flex min-h-touch items-center gap-3 rounded-choice p-1 text-base text-fg hover:bg-surface-muted aria-selected:bg-surface-muted aria-selected:outline-2 aria-selected:outline-offset-[-2px] aria-selected:outline-primary-700';

export type SuggestionGroupsProps = {
  groups: readonly SuggestionGroup[];
  activeIndex: number;
  /** Prefix of the option and group DOM ids; the combobox points `aria-activedescendant` at them. */
  optionPrefix: string;
  onChoose: (option: SuggestionOption) => void;
};

/**
 * The options of the header search listbox (REQ-SRCH-001). Its own module so that the product image, the price
 * and the option markup are downloaded when the shopper first focuses the search field, not with every page
 * (P7-06). The combobox logic, state and ARIA attributes stay in `HeaderSearch`.
 */
export function SuggestionGroups({
  groups,
  activeIndex,
  optionPrefix,
  onChoose,
}: SuggestionGroupsProps) {
  return (
    <>
      {groups.map((group) => {
        const headingId = `${optionPrefix}-group-${group.id}`;
        return (
          <div
            key={group.id}
            role="group"
            aria-labelledby={group.heading ? headingId : undefined}
            aria-label={group.heading ? undefined : 'More results'}
          >
            {group.heading ? (
              <p
                id={headingId}
                className="mb-1 text-xs font-bold tracking-wide text-fg-muted uppercase"
              >
                {group.heading}
              </p>
            ) : null}
            {group.options.map((option) => (
              <Option
                key={option.index}
                option={option}
                id={optionDomId(optionPrefix, option.index)}
                selected={option.index === activeIndex}
                onChoose={() => onChoose(option)}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

function Option({
  option,
  id,
  selected,
  onChoose,
}: {
  option: SuggestionOption;
  id: string;
  selected: boolean;
  onChoose: () => void;
}) {
  const isAll = option.kind === 'all';
  return (
    // The option is the link itself, so a click, a tap and a middle-click all behave like any link.
    <Link
      id={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      to={option.href}
      onClick={onChoose}
      className={
        isAll ? `${OPTION_CLASSES} font-bold text-primary-700` : OPTION_CLASSES
      }
    >
      {option.image ? (
        <Image
          alt=""
          src={option.image.url}
          width={50}
          height={50}
          className="size-12 shrink-0 rounded-choice object-cover"
        />
      ) : null}
      <span className="min-w-0">
        <span
          className={
            option.kind === 'product'
              ? 'block truncate font-bold'
              : 'block truncate'
          }
        >
          {option.label}
        </span>
        {option.price ? (
          <Price price={option.price} size="sm" className="text-fg-muted" />
        ) : null}
      </span>
    </Link>
  );
}
