import {cn} from '~/components/ui/cn';
import type {WeekRowView} from '~/lib/pages/stores-view';

type StoreHoursTableProps = {
  rows: readonly WeekRowView[];
};

/** The full week, Monday first. Today's row is marked in text as well as by weight, never by colour alone. */
export function StoreHoursTable({rows}: StoreHoursTableProps) {
  return (
    <div className="w-full max-w-md rounded-card bg-paper px-4 py-2 md:px-6">
      <table className="w-full border-collapse text-left">
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
                'border-b border-line last:border-b-0',
                row.isToday && 'font-extrabold text-primary-800',
              )}
            >
              <th scope="row" className="py-3 pr-4 font-[inherit]">
                {row.day}
                {row.isToday ? <span className="text-sm"> (today)</span> : null}
              </th>
              <td className="py-3">{row.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
