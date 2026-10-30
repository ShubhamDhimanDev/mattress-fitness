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
 * Trust strip under the main menu (CR-31): an outline icon beside each short promise in bold capitals, spread across
 * the page and stacked on a phone. The promises are statements, not links: the pages behind them are the client's to
 * write, and a link to a page that does not exist would 404. Items held back with `awaitingContent` never show
 * (REQ-CNT-001, B-15), and the strip disappears when none is left.
 */
export function ReassuranceStrip({
  items = REASSURANCE_ITEMS,
}: ReassuranceStripProps) {
  // Filtered again here so an explicit list cannot put an unsupplied promise on the page.
  const shown = publishedLinks(items);
  if (shown.length === 0) return null;

  return (
    <div className="border-b border-line bg-surface text-fg">
      <ul className="mx-auto flex max-w-page flex-col items-start gap-1 px-4 py-2 md:flex-row md:items-center md:justify-between md:gap-6 md:px-10 md:py-3">
        {shown.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li
              key={item.id}
              className="flex min-h-touch items-center gap-3 text-sm font-extrabold tracking-tight uppercase md:text-base"
            >
              <Icon className="size-8 text-primary-500" strokeWidth={1.5} />
              <span>{item.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
