import {Link} from 'react-router';
import {ShieldCheckIcon, TagIcon, TruckIcon} from '~/components/ui/Icons';
import {
  REASSURANCE_ITEMS,
  publishedLinks,
  type ReassuranceItem,
} from '~/lib/navigation';

const ICONS: Record<ReassuranceItem['icon'], typeof TruckIcon> = {
  truck: TruckIcon,
  shield: ShieldCheckIcon,
  tag: TagIcon,
};

type ReassuranceStripProps = {
  items?: readonly ReassuranceItem[];
};

/**
 * Trust strip under the header (CR-31): a paper band with a red round icon beside each short promise, as many columns
 * as fit. It shows only the items whose content the client has supplied (REQ-CNT-001, B-15), so it holds none to
 * three items today and disappears when there are none.
 */
export function ReassuranceStrip({
  items = REASSURANCE_ITEMS,
}: ReassuranceStripProps) {
  // Filtered again here so an explicit list cannot put an unsupplied promise on the page.
  const shown = publishedLinks(items);
  if (shown.length === 0) return null;

  return (
    <div className="border-b border-line bg-paper text-fg">
      <ul className="mx-auto grid max-w-page grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 px-4 py-3 md:px-10">
        {shown.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li key={item.id}>
              <Link
                to={item.to}
                className="flex min-h-touch items-center gap-3 py-1 text-sm font-bold hover:underline md:text-base"
              >
                <span className="inline-flex size-11.5 shrink-0 items-center justify-center rounded-pill bg-primary-500 text-white">
                  <Icon className="size-5.5" />
                </span>
                <span>{item.text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
