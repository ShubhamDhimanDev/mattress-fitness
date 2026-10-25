// View models for the store locator pages (REQ-LOC-001). Pure: they take the
// Store, the clock and return strings and links, so the components only render.

import {
  addressLines,
  googleMapsDirectionsUrl,
  normalizeUsPhone,
} from '~/lib/stores/directions';
import {myStoreKey} from '~/lib/pages/my-store';
import {storePath} from '~/lib/stores/grouping';
import {
  formatWeeklyHours,
  isValidTimeZone,
  openStatus,
  summarizeWeeklyHours,
  todaysHours,
  type WeekRow,
} from '~/lib/stores/hours';
import type {DayIndex, Store} from '~/lib/stores/types';

export type StoreStatusView = {
  readonly kind: 'open' | 'closed' | 'unknown';
  /** For example "Open now, closes 9:00 PM". */
  readonly text: string;
};

function statusText(
  store: Pick<Store, 'hours'>,
  nowMs: number,
  timeZone: string,
): StoreStatusView {
  const status = openStatus(store, nowMs, timeZone);
  switch (status.status) {
    case 'open':
      return {kind: 'open', text: `Open now, closes ${status.closesAt}`};
    case 'closed':
      return {
        kind: 'closed',
        text: status.next
          ? `Closed, opens ${status.next.dayLabel} at ${status.next.opensAt}`
          : 'Closed',
      };
    case 'unknown':
      return {kind: 'unknown', text: 'Hours not available'};
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export type StoreCardView = {
  readonly name: string;
  readonly path: string;
  readonly addressLines: readonly string[];
  readonly phone: {readonly display: string; readonly href: string} | null;
  readonly directionsUrl: string;
  readonly status: StoreStatusView;
  /** For example "Monday: 10:00 AM – 9:00 PM", or "Hours not available". */
  readonly todayText: string;
  readonly pickupEnabled: boolean;
};

/**
 * Everything a store card shows. "Today" is the day in the store's own time
 * zone; without a valid zone the hours are not guessed (status unknown).
 */
export function storeCardView(store: Store, nowMs: number): StoreCardView {
  const zone =
    store.timeZone !== null && isValidTimeZone(store.timeZone)
      ? store.timeZone
      : null;
  const today = zone ? todaysHours(store, nowMs, zone) : null;
  const phone = normalizeUsPhone(store.phone);
  return {
    name: store.name,
    path: storePath(store),
    addressLines: addressLines(store),
    phone: phone ? {display: phone.display, href: `tel:${phone.e164}`} : null,
    directionsUrl: googleMapsDirectionsUrl(store),
    status: zone
      ? statusText(store, nowMs, zone)
      : {
          kind: 'unknown',
          // Hours without a time zone are listed, never judged: "open now" needs the store's own clock (P3B-16).
          text: store.hours ? 'Opening hours' : 'Hours not available',
        },
    todayText:
      today === null || today.status === 'unknown'
        ? store.hours
          ? summarizeWeeklyHours(store.hours)
          : 'Hours not available'
        : today.status === 'closed_today'
          ? `${today.day}: Closed`
          : `${today.day}: ${today.text}`,
    pickupEnabled: store.pickupEnabled,
  };
}

export type WeekRowView = WeekRow & {readonly isToday: boolean};

/** The weekly table, with today's row flagged; null when the store has no hours. */
export function weeklyHoursView(
  store: Store,
  nowMs: number,
): readonly WeekRowView[] | null {
  if (!store.hours) return null;
  const zone =
    store.timeZone !== null && isValidTimeZone(store.timeZone)
      ? store.timeZone
      : null;
  const today: DayIndex | null = zone
    ? (() => {
        const hours = todaysHours(store, nowMs, zone);
        return hours.status === 'unknown' ? null : hours.dayIndex;
      })()
    : null;
  return formatWeeklyHours(store.hours).map((row) => ({
    ...row,
    isToday: row.dayIndex === today,
  }));
}

/** "1 store" or "3 stores". */
export function storeCountText(count: number): string {
  return `${count} ${count === 1 ? 'store' : 'stores'}`;
}

export type StoreEntry = {
  readonly view: StoreCardView;
  /** The store key the my-store form posts. */
  readonly storeKey: string;
  readonly isMine: boolean;
};

/** A store card plus what the my-store form needs; `myStoreId` is the validated cookie selection or null. */
export function storeEntry(
  store: Store,
  nowMs: number,
  myStoreId: string | null,
): StoreEntry {
  return {
    view: storeCardView(store, nowMs),
    storeKey: myStoreKey(store),
    isMine: myStoreId !== null && store.id === myStoreId,
  };
}
