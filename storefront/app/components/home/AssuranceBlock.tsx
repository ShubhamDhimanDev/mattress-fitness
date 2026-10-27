import {Link} from 'react-router';
import {ShieldCheckIcon, TagIcon, TruckIcon} from '~/components/ui/Icons';
import {
  HOME_ASSURANCE_ITEMS,
  publishedLinks,
  type ReassuranceItem,
} from '~/lib/navigation';

const ICONS: Record<ReassuranceItem['icon'], typeof TruckIcon> = {
  truck: TruckIcon,
  shield: ShieldCheckIcon,
  tag: TagIcon,
};

/**
 * The assurance row under the hero (CR-31): a red round icon and the item's text, up to four across. It lists only the
 * items whose content the client has supplied (REQ-CNT-001, B-15), filtered again here so an explicit list cannot put an
 * unsupplied promise on the page, and renders nothing when there are none. The region keeps its old accessible name.
 */
export function AssuranceBlock({
  items = HOME_ASSURANCE_ITEMS,
}: {
  items?: readonly ReassuranceItem[];
}) {
  const shown = publishedLinks(items);
  if (shown.length === 0) return null;

  return (
    <section
      aria-labelledby="assurance-heading"
      className="rounded-card border border-line bg-paper px-4 py-5 md:px-8 md:py-6"
    >
      <h2 id="assurance-heading" className="sr-only">
        Buy with confidence
      </h2>
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {shown.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li key={item.id}>
              <Link
                to={item.to}
                className="flex min-h-touch items-center gap-3 font-bold text-fg hover:underline"
              >
                <span
                  aria-hidden="true"
                  className="flex size-11.5 shrink-0 items-center justify-center rounded-pill bg-primary-500 text-white"
                >
                  <Icon className="size-6" />
                </span>
                {item.text}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
