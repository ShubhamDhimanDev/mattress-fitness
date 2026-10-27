import {Link} from 'react-router';
import {ProductTile} from '~/components/pages/ProductTile';
import {buttonStyles} from '~/components/ui/Button';
import {Chip} from '~/components/ui/Chip';
import {Price} from '~/components/ui/Price';
import {Rating} from '~/components/ui/Rating';
import {fromCents} from '~/lib/money';
import type {
  ComparisonCell,
  ComparisonRowKey,
  ComparisonTable,
} from '~/lib/compare';

type CompareTableProps = {
  table: ComparisonTable;
  /** Path that removes one product from the selection (a link, so it works without JavaScript). */
  removeHref: (handle: string) => string;
  onRemove: (handle: string) => void;
};

/**
 * The side-by-side table (REQ-CMP-001). The product names are column headers and the row labels are row
 * headers, so a screen reader reads "Comfort level, Larkmoor Cedar: Medium". On a phone the table scrolls
 * sideways inside its own focusable, labelled region while the first column stays fixed, so the page itself
 * never scrolls sideways.
 */
export function CompareTable({table, removeHref, onRemove}: CompareTableProps) {
  const captionId = 'compare-table-caption';
  return (
    <div
      role="region"
      aria-labelledby={captionId}
      // "relative" makes this the containing block of the screen-reader-only text inside the cells; otherwise
      // that absolutely positioned text sits outside the scroll area and widens the whole page.
      // Focusable so a keyboard user can scroll the region with the arrow keys (WCAG 2.1.1).
      // scroll-pl is the sticky first column (w-28, md:w-40) plus a little room for the focus ring, so the browser
      // scrolls a focused Remove or product link clear of the column (WCAG 2.4.11, A11Y-001).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region
      tabIndex={0}
      className="relative max-w-full scroll-pl-30 overflow-x-auto rounded-card border border-line bg-surface md:scroll-pl-42"
    >
      <table className="w-max min-w-full border-collapse text-left">
        <caption id={captionId} className="sr-only">
          Comparison of {table.columns.length}{' '}
          {table.columns.length === 1 ? 'product' : 'products'}. Scroll sideways
          to see every product.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 w-28 min-w-28 border-r border-b border-line bg-paper p-3 text-sm md:w-40 md:min-w-40"
            >
              <span className="sr-only">Feature</span>
            </th>
            {table.columns.map((column) => (
              <th
                key={column.handle}
                scope="col"
                className="w-56 min-w-56 border-b border-line bg-paper p-3 align-top"
              >
                <div className="flex flex-col gap-2">
                  <ProductTile image={column.image} />
                  <span className="text-caption font-bold tracking-wide text-fg-muted uppercase">
                    {column.brand}
                  </span>
                  <Link
                    to={`/products/${encodeURIComponent(column.handle)}`}
                    className="inline-flex min-h-touch w-fit items-center text-lg font-extrabold underline-offset-2 hover:underline"
                  >
                    {column.title}
                  </Link>
                  <Link
                    to={removeHref(column.handle)}
                    replace
                    preventScrollReset
                    onClick={() => onRemove(column.handle)}
                    aria-label={`Remove ${column.title} from comparison`}
                    className={buttonStyles({variant: 'secondary', size: 'sm'})}
                  >
                    Remove
                  </Link>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key} className="border-b border-line last:border-b-0">
              <th
                scope="row"
                className="sticky left-0 z-10 w-28 min-w-28 border-r border-line bg-paper p-3 text-sm font-bold md:w-40 md:min-w-40"
              >
                {row.label}
              </th>
              {row.cells.map((cell, position) => (
                <td
                  key={table.columns[position]?.handle ?? position}
                  className="p-3 align-top text-base"
                >
                  <CellValue cell={cell} rowKey={row.key} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Feel, type and benefits are short attribute words, so they read as chips; the text stays the cell's content.
const CHIP_ROWS: ReadonlySet<ComparisonRowKey> = new Set<ComparisonRowKey>([
  'comfort',
  'type',
]);

function CellValue({
  cell,
  rowKey,
}: {
  cell: ComparisonCell;
  rowKey: ComparisonRowKey;
}) {
  switch (cell.kind) {
    case 'text':
      return CHIP_ROWS.has(rowKey) ? (
        <Chip>{cell.text}</Chip>
      ) : (
        <span>{cell.text}</span>
      );
    case 'list':
      return rowKey === 'benefits' ? (
        <ul className="flex flex-wrap gap-1.5">
          {cell.items.map((item) => (
            <li key={item}>
              <Chip>{item}</Chip>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="list-disc pl-5">
          {cell.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case 'rating':
      return <Rating value={cell.average} count={cell.count} />;
    case 'price':
      return (
        <Price
          price={{amount: fromCents(cell.cents), currencyCode: 'USD'}}
          compareAt={
            cell.compareAtCents === null
              ? null
              : {
                  amount: fromCents(cell.compareAtCents),
                  currencyCode: 'USD',
                }
          }
          prefix={cell.from ? 'From' : undefined}
          compact
          size="sm"
        />
      );
    case 'unavailable':
    case 'missing':
      return <span className="text-fg-muted">{cell.text}</span>;
    default: {
      const unreachable: never = cell;
      return unreachable;
    }
  }
}
