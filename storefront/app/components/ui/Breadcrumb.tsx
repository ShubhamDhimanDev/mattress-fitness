import {Link} from 'react-router';
import {ChevronRightIcon} from '~/components/ui/Icons';
import {cn} from '~/components/ui/cn';

export type BreadcrumbItem = {label: string; to?: string};

type BreadcrumbProps = {
  /** From the home page down to the current page. The last item is the current page and is not a link. */
  items: readonly BreadcrumbItem[];
  className?: string;
};

export function Breadcrumb({items, className}: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
        {items.map((item, position) => {
          const current = position === items.length - 1;
          return (
            <li key={item.to ?? item.label} className="flex items-center gap-1">
              {item.to && !current ? (
                <Link
                  to={item.to}
                  className="inline-flex min-h-touch items-center text-primary-700 underline underline-offset-2 hover:text-primary-800"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-touch items-center',
                    current && 'font-bold text-fg',
                  )}
                >
                  {item.label}
                </span>
              )}
              {current ? null : <ChevronRightIcon className="size-4" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
