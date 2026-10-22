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
 * Reassurance row under the header: compact columns on a phone, spread evenly with the icon beside the text
 * from 768 px. It shows only the items whose content the client has supplied (REQ-CNT-001, B-15), so it holds
 * one to three items and disappears when there are none.
 */
export function ReassuranceStrip({
  items = REASSURANCE_ITEMS,
}: ReassuranceStripProps) {
  // Filtered again here so an explicit list cannot put an unsupplied promise on the page.
  const shown = publishedLinks(items);
  if (shown.length === 0) return null;

  return (
    <div className="border-b border-line bg-surface text-fg">
      <ul className="mx-auto flex max-w-page px-2 md:px-6">
        {shown.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li key={item.id} className="flex flex-1">
              <Link
                to={item.to}
                className="flex min-h-touch w-full flex-col items-center justify-center gap-1 px-1 py-2 text-center type-display text-xs hover:underline md:flex-row md:gap-2 md:text-sm"
              >
                <Icon className="size-6 text-primary-500" />
                <span>{item.text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
