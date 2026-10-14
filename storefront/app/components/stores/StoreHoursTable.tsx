import {cn} from '~/components/ui/cn';
import type {WeekRowView} from '~/lib/pages/stores-view';

type StoreHoursTableProps = {
  rows: readonly WeekRowView[];
};

/** The full week, Monday first. Today's row is marked in text as well as by weight, never by colour alone. */
export function StoreHoursTable({rows}: StoreHoursTableProps) {
  return (
    <table className="w-full max-w-md border-collapse text-left">
      <caption className="sr-only">Opening hours for the week</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Day</th>
          <th scope="col">Hours</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.dayIndex}
            className={cn(
              'border-b border-line',
              row.isToday && 'bg-primary-50 font-bold',
            )}
          >
            <th scope="row" className="py-2 pr-4 font-[inherit]">
              {row.day}
              {row.isToday ? <span className="text-sm"> (today)</span> : null}
            </th>
            <td className="py-2">{row.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
