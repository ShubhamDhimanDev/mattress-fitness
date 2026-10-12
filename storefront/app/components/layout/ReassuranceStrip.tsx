import {Link} from 'react-router';
import {ShieldCheckIcon, TagIcon, TruckIcon} from '~/components/ui/Icons';
import {REASSURANCE_ITEMS, type ReassuranceItem} from '~/lib/navigation';

const ICONS: Record<ReassuranceItem['icon'], typeof TruckIcon> = {
  truck: TruckIcon,
  shield: ShieldCheckIcon,
  tag: TagIcon,
};

type ReassuranceStripProps = {
  items?: readonly ReassuranceItem[];
};

/**
 * Three-item reassurance row under the header: compact columns on a phone, spread evenly with the icon
 * beside the text from 768 px. Each item links to its content page, which the client supplies (REQ-CNT-001).
 */
export function ReassuranceStrip({
  items = REASSURANCE_ITEMS,
}: ReassuranceStripProps) {
  return (
    <div className="border-b border-line bg-primary-50 text-primary-800">
      <ul className="mx-auto grid max-w-page grid-cols-3 px-2 md:px-6">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li key={item.id} className="flex">
              <Link
                to={item.to}
                className="flex min-h-touch w-full flex-col items-center justify-center gap-1 px-1 py-2 text-center text-xs leading-4 font-bold tracking-wide uppercase hover:underline md:flex-row md:gap-2 md:text-sm md:leading-5"
              >
                <Icon className="size-5 md:size-6" />
                <span>{item.text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
