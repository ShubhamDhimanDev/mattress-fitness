// Opening hours (REQ-LOC-001): parsing what the client types in admin, deciding
// whether a store is open now in its own time zone, and formatting hours.
//
// The clock and the time zone are always passed in. Time zone maths uses the
// standard Intl API, which Oxygen workers and Node both provide. Overnight
// hours (6 PM to 2 AM) belong to the day they start on.

import {cleanText} from '~/lib/catalog/text';
import type {
  DayHours,
  DayIndex,
  Store,
  TimeInterval,
  WeeklyHours,
} from '~/lib/stores/types';

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const DAY_INDEXES: readonly DayIndex[] = [0, 1, 2, 3, 4, 5, 6];
/** Monday first, the usual way a store page lists its week. */
export const DISPLAY_ORDER: readonly DayIndex[] = [1, 2, 3, 4, 5, 6, 0];

const MINUTES_PER_DAY = 1440;
/** An overnight interval longer than this is far more likely an AM/PM typo than real. */
const MAX_OVERNIGHT_MINUTES = 16 * 60;
const MAX_INTERVALS_PER_DAY = 3;
const MAX_INPUT_LENGTH = 4000;
const MAX_ENTRIES = 50;

const EN_DASH = '–';

export type HoursParseResult = {
  /** Null when nothing usable was given. */
  readonly hours: WeeklyHours | null;
  /** Problems to log; contain no personal data. */
  readonly warnings: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Short, cleaned excerpt of untrusted text for a warning. */
function shown(text: string): string {
  return cleanText(text).replace(/[<>]/g, '').slice(0, 30);
}

function toDayIndex(value: number): DayIndex | null {
  return DAY_INDEXES.find((index) => index === value) ?? null;
}

// --- Formatting ---

export function formatMinutes(totalMinutes: number): string {
  const minutes =
    ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;
  const hours24 = Math.floor(minutes / 60);
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes % 60).padStart(2, '0')} ${suffix}`;
}

export function formatInterval(interval: TimeInterval): string {
  if (interval.openMinutes === 0 && interval.closeMinutes === MINUTES_PER_DAY) {
    return 'Open 24 hours';
  }
  return `${formatMinutes(interval.openMinutes)} ${EN_DASH} ${formatMinutes(interval.closeMinutes)}`;
}

export function formatDayHours(day: DayHours): string {
  return day.length === 0 ? 'Closed' : day.map(formatInterval).join(', ');
}

export type WeekRow = {
  readonly dayIndex: DayIndex;
  readonly day: string;
  readonly text: string;
  readonly closed: boolean;
};

/** Seven display rows, Monday first, for the store page. */
export function formatWeeklyHours(hours: WeeklyHours): readonly WeekRow[] {
  return DISPLAY_ORDER.map((dayIndex) => {
    const day = hours[dayIndex];
    return {
      dayIndex,
      day: DAY_NAMES[dayIndex],
      text: formatDayHours(day),
      closed: day.length === 0,
    };
  });
}

// --- Parsing ---

const DAY_ALIASES = new Map<string, DayIndex>([
  ['sun', 0],
  ['sunday', 0],
  ['mon', 1],
  ['monday', 1],
  ['tue', 2],
  ['tues', 2],
  ['tuesday', 2],
  ['wed', 3],
  ['weds', 3],
  ['wednesday', 3],
  ['thu', 4],
  ['thur', 4],
  ['thurs', 4],
  ['thursday', 4],
  ['fri', 5],
  ['friday', 5],
  ['sat', 6],
  ['saturday', 6],
]);

function rangeOfDays(from: DayIndex, to: DayIndex): DayIndex[] {
  const days: DayIndex[] = [];
  for (let step = 0; step < 7; step += 1) {
    const day = toDayIndex((from + step) % 7);
    if (day === null) break;
    days.push(day);
    if (day === to) break;
  }
  return days;
}

/** "Mon-Fri", "Sat, Sun", "Fri-Mon", "weekdays", "daily"; null when unreadable. */
export function parseDaySelector(text: string): DayIndex[] | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[‒-―−]/g, '-')
    .replace(/\b(?:through|thru|to)\b/g, '-')
    .replace(/&|\band\b/g, ',')
    .replace(/[.:]/g, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return null;
  if (/^(?:daily|every ?day|7 days(?: a week)?)$/.test(cleaned))
    return [...DAY_INDEXES];
  if (cleaned === 'weekdays') return [1, 2, 3, 4, 5];
  if (cleaned === 'weekends') return [0, 6];

  const days = new Set<DayIndex>();
  for (const part of cleaned.split(/\s*,\s*|\s+/)) {
    if (part === '') continue;
    const [fromText, toText, extra] = part.split('-');
    const from = DAY_ALIASES.get(fromText ?? '');
    if (from === undefined || extra !== undefined) return null;
    if (toText === undefined) {
      days.add(from);
      continue;
    }
    const to = DAY_ALIASES.get(toText);
    if (to === undefined) return null;
    for (const day of rangeOfDays(from, to)) days.add(day);
  }
  return days.size > 0 ? [...days].sort((a, b) => a - b) : null;
}

function parseClock(text: string): number | null {
  const value = text.trim().toLowerCase().replace(/\./g, '');
  if (value === 'noon') return 720;
  if (value === 'midnight') return 0;
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)$/.exec(value);
  if (twelve) {
    const hour = Number(twelve[1]);
    const minute = Number(twelve[2] ?? '0');
    if (hour < 1 || hour > 12 || minute > 59) return null;
    const pm = twelve[3]?.startsWith('p') ?? false;
    return (hour % 12) * 60 + minute + (pm ? 720 : 0);
  }
  // 24-hour times must carry minutes: a bare "9" or "10-6" is ambiguous.
  const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (twentyFour) {
    const hour = Number(twentyFour[1]);
    const minute = Number(twentyFour[2]);
    if (minute > 59) return null;
    if (hour === 24) return minute === 0 ? MINUTES_PER_DAY : null;
    return hour <= 23 ? hour * 60 + minute : null;
  }
  return null;
}

type IntervalResult =
  | {readonly ok: true; readonly interval: TimeInterval}
  | {readonly ok: false; readonly problem: string};

function makeInterval(openText: string, closeText: string): IntervalResult {
  const open = parseClock(openText);
  const close = parseClock(closeText);
  if (open === null || close === null) {
    return {
      ok: false,
      problem: `"${shown(openText)} to ${shown(closeText)}" is not a readable time range (write 9:00 AM - 5:00 PM or 09:00-17:00)`,
    };
  }
  if (open >= MINUTES_PER_DAY)
    return {ok: false, problem: 'An opening time cannot be 24:00.'};
  if (close === open) {
    return {ok: false, problem: 'Opening and closing times are the same.'};
  }
  if (close > open)
    return {ok: true, interval: {openMinutes: open, closeMinutes: close}};
  const overnightClose = close + MINUTES_PER_DAY;
  if (overnightClose - open > MAX_OVERNIGHT_MINUTES) {
    return {
      ok: false,
      problem: `Closing at ${formatMinutes(close)} after opening at ${formatMinutes(open)} would be over 16 hours; check AM and PM.`,
    };
  }
  return {
    ok: true,
    interval: {openMinutes: open, closeMinutes: overnightClose},
  };
}

const ALL_DAY = /^(?:open\s+)?(?:24\s*(?:h|hr|hrs|hours?)|24\/7|all day)$/;
const CLOSED = /^(?:closed(?:\s+all\s+day)?|not open|none)$/;

/** "Closed", "Open 24 hours" or one or more ranges such as "9am-5pm, 7pm-9pm". */
function parseHoursSpec(
  text: string,
  problems: string[],
): readonly TimeInterval[] | null {
  const spec = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (CLOSED.test(spec)) return [];
  if (ALL_DAY.test(spec))
    return [{openMinutes: 0, closeMinutes: MINUTES_PER_DAY}];
  const intervals: TimeInterval[] = [];
  for (const range of spec.split(/\s*(?:,|&|\band\b)\s*/)) {
    const ends = range.split(/\s*(?:[-‒-―−]|\bto\b)\s*/);
    const [openText, closeText] = ends;
    if (
      ends.length !== 2 ||
      openText === undefined ||
      closeText === undefined
    ) {
      problems.push(`"${shown(range)}" is not a readable time range.`);
      return null;
    }
    const result = makeInterval(openText, closeText);
    if (!result.ok) {
      problems.push(result.problem);
      return null;
    }
    intervals.push(result.interval);
  }
  return intervals;
}

/** Sorts, drops overlaps and caps the count for one day. */
function tidyDay(
  intervals: readonly TimeInterval[],
  problems: string[],
): DayHours {
  const sorted = [...intervals].sort((a, b) => a.openMinutes - b.openMinutes);
  const kept: TimeInterval[] = [];
  for (const interval of sorted) {
    const previous = kept[kept.length - 1];
    if (previous && interval.openMinutes < previous.closeMinutes) {
      problems.push('Two opening times overlap; the later one was ignored.');
      continue;
    }
    if (kept.length >= MAX_INTERVALS_PER_DAY) {
      problems.push(
        `Only ${MAX_INTERVALS_PER_DAY} opening times per day are used.`,
      );
      break;
    }
    kept.push(interval);
  }
  return kept;
}

type Assignment = {
  readonly days: readonly DayIndex[];
  readonly intervals: readonly TimeInterval[];
};

/** "Mon-Fri 9am-5pm", "Sun: Closed": days first, then the hours. */
function parseTextLine(line: string, problems: string[]): Assignment | null {
  const split =
    /(?:\d|\bclosed\b|\bopen\b|\bnot open\b|\bnoon\b|\bmidnight\b)/i.exec(line);
  if (!split) {
    problems.push(`"${shown(line)}" has no hours.`);
    return null;
  }
  const dayPart = line.slice(0, split.index).replace(/[\s:,-]+$/, '');
  const hoursPart = line.slice(split.index).replace(/^[\s:,-]+/, '');
  const days = parseDaySelector(dayPart);
  if (!days) {
    problems.push(`"${shown(dayPart)}" is not a readable day or day range.`);
    return null;
  }
  const intervals = parseHoursSpec(hoursPart, problems);
  return intervals ? {days, intervals} : null;
}

function selectorFrom(value: unknown): DayIndex[] | null {
  if (typeof value === 'string') return parseDaySelector(value);
  if (Array.isArray(value)) {
    const days = new Set<DayIndex>();
    for (const item of value) {
      const part = typeof item === 'string' ? parseDaySelector(item) : null;
      if (!part) return null;
      for (const day of part) days.add(day);
    }
    return days.size > 0 ? [...days] : null;
  }
  return null;
}

function firstDefined(
  record: Record<string, unknown>,
  names: readonly string[],
): unknown {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** The hours half of an entry: a string, a list of strings or ranges, or {open, close}. */
function intervalsFromValue(
  value: unknown,
  problems: string[],
): readonly TimeInterval[] | null {
  if (value === null || value === false) return [];
  if (typeof value === 'string') return parseHoursSpec(value, problems);
  if (Array.isArray(value)) {
    const all: TimeInterval[] = [];
    for (const item of value) {
      const part = intervalsFromValue(item, problems);
      if (!part) return null;
      all.push(...part);
    }
    return all;
  }
  if (!isRecord(value)) {
    problems.push('Hours must be text or a list of opening and closing times.');
    return null;
  }
  if (firstDefined(value, ['closed']) === true) return [];
  const hoursText = firstDefined(value, ['hours']);
  if (typeof hoursText === 'string') return parseHoursSpec(hoursText, problems);
  const open = firstDefined(value, ['open', 'opens', 'from', 'start']);
  const close = firstDefined(value, ['close', 'closes', 'to', 'end', 'until']);
  if (typeof open !== 'string' || typeof close !== 'string') {
    problems.push('An opening time needs both an open and a close time.');
    return null;
  }
  const result = makeInterval(open, close);
  if (!result.ok) {
    problems.push(result.problem);
    return null;
  }
  return [result.interval];
}

function assignmentsFromRecord(
  record: Record<string, unknown>,
  problems: string[],
): Assignment[] {
  const out: Assignment[] = [];
  for (const [key, value] of Object.entries(record).slice(0, MAX_ENTRIES)) {
    const days = parseDaySelector(key);
    if (!days) {
      problems.push(`"${shown(key)}" is not a readable day or day range.`);
      continue;
    }
    const intervals = intervalsFromValue(value, problems);
    if (intervals) out.push({days, intervals});
  }
  return out;
}

function assignmentsFromList(
  list: readonly unknown[],
  problems: string[],
): Assignment[] {
  const out: Assignment[] = [];
  for (const item of list.slice(0, MAX_ENTRIES)) {
    if (typeof item === 'string') {
      const assignment = parseTextLine(item, problems);
      if (assignment) out.push(assignment);
      continue;
    }
    if (!isRecord(item)) {
      problems.push('An hours entry must be text or an object.');
      continue;
    }
    const days = selectorFrom(firstDefined(item, ['day', 'days', 'weekday']));
    if (!days) {
      problems.push('An hours entry has no readable day.');
      continue;
    }
    const intervals = intervalsFromValue(item, problems);
    if (intervals) out.push({days, intervals});
  }
  return out;
}

function toWeekly(days: readonly DayHours[]): WeeklyHours {
  const [a, b, c, d, e, f, g] = days;
  return [a ?? [], b ?? [], c ?? [], d ?? [], e ?? [], f ?? [], g ?? []];
}

function assignmentsFromRaw(raw: unknown, problems: string[]): Assignment[] {
  let value = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.length > MAX_INPUT_LENGTH) {
      problems.push('The hours text is too long.');
      return [];
    }
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        value = JSON.parse(text);
      } catch {
        problems.push('The hours look like JSON but could not be read.');
        return [];
      }
    } else {
      // One line per day group; semicolons and pipes also separate entries.
      const lines = text
        .split(/[\n\r;|]+/)
        .map((line) => line.trim())
        .filter((line) => line !== '');
      return assignmentsFromList(lines, problems);
    }
  }
  if (Array.isArray(value)) return assignmentsFromList(value, problems);
  if (isRecord(value)) {
    const nested = value.hours;
    return assignmentsFromRecord(isRecord(nested) ? nested : value, problems);
  }
  problems.push('The hours must be text, a list or an object.');
  return [];
}

/**
 * Reads weekly hours as the client types them in admin. Accepted forms:
 *   text:   "Mon-Fri 10:00 AM - 9:00 PM; Sat 10am-6pm; Sun Closed"
 *   object: {"Mon-Fri": "10:00-21:00", "Sat": "10am-6pm", "Sun": "closed"}
 *   list:   [{"day": "Mon", "open": "10:00", "close": "21:00"}, ...]
 * Days that are not mentioned count as closed. Never throws; problems come back
 * as warnings and an unreadable entry is skipped.
 */
export function parseWeeklyHours(raw: unknown): HoursParseResult {
  if (raw === null || raw === undefined || raw === '')
    return {hours: null, warnings: []};
  const warnings: string[] = [];
  try {
    const assignments = assignmentsFromRaw(raw, warnings);
    if (assignments.length === 0) {
      warnings.push('No readable opening hours were found.');
      return {hours: null, warnings};
    }
    const week: (readonly TimeInterval[] | null)[] = [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    for (const assignment of assignments) {
      for (const day of assignment.days) {
        if (week[day] !== null) {
          warnings.push(
            `${DAY_NAMES[day]} is given more than once; the later entry is used.`,
          );
        }
        week[day] = assignment.intervals;
      }
    }
    const missing = DAY_INDEXES.filter((day) => week[day] === null).map(
      (day) => DAY_NAMES[day],
    );
    if (missing.length > 0)
      warnings.push(
        `No hours given for ${missing.join(', ')}; shown as closed.`,
      );
    return {
      hours: toWeekly(week.map((day) => tidyDay(day ?? [], warnings))),
      warnings,
    };
  } catch {
    return {
      hours: null,
      warnings: [...warnings, 'The hours could not be read.'],
    };
  }
}

// --- Time zones and "open now" ---

const TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const formatters = new Map<string, Intl.DateTimeFormat>();
const MAX_CACHED_FORMATTERS = 50;

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  if (timeZone.length > 64 || !TIME_ZONE_PATTERN.test(timeZone)) return null;
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  try {
    // h23 avoids the "24:00" some engines print at midnight with hour12: false.
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    if (formatters.size < MAX_CACHED_FORMATTERS)
      formatters.set(timeZone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  return formatterFor(timeZone) !== null;
}

const WEEKDAY_SHORT = new Map<string, DayIndex>([
  ['Sun', 0],
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
  ['Sat', 6],
]);

type LocalTime = {readonly dayIndex: DayIndex; readonly minutes: number};

function localTime(now: Date | number, timeZone: string): LocalTime | null {
  const formatter = formatterFor(timeZone);
  const nowMs = typeof now === 'number' ? now : now.getTime();
  if (!formatter || !Number.isFinite(nowMs)) return null;
  try {
    const parts = formatter.formatToParts(new Date(nowMs));
    const value = (type: string) =>
      parts.find((part) => part.type === type)?.value;
    const dayIndex = WEEKDAY_SHORT.get(value('weekday') ?? '');
    const hour = Number(value('hour'));
    const minute = Number(value('minute'));
    if (
      dayIndex === undefined ||
      !Number.isInteger(hour) ||
      !Number.isInteger(minute)
    )
      return null;
    return {dayIndex, minutes: (hour % 24) * 60 + minute};
  } catch {
    return null;
  }
}

export type NextOpening = {
  readonly dayIndex: DayIndex;
  /** "today", "tomorrow" or the weekday name. */
  readonly dayLabel: string;
  readonly opensAt: string;
};

export type OpenStatus =
  | {
      readonly status: 'open';
      readonly closesAt: string;
      readonly minutesUntilClose: number;
    }
  | {readonly status: 'closed'; readonly next: NextOpening | null}
  | {readonly status: 'unknown'};

function nextOpening(hours: WeeklyHours, local: LocalTime): NextOpening | null {
  for (let offset = 0; offset <= 7; offset += 1) {
    const dayIndex = toDayIndex((local.dayIndex + offset) % 7);
    if (dayIndex === null) return null;
    const upcoming = hours[dayIndex].find(
      (interval) => offset > 0 || interval.openMinutes > local.minutes,
    );
    if (upcoming) {
      const dayLabel =
        offset === 0
          ? 'today'
          : offset === 1
            ? 'tomorrow'
            : DAY_NAMES[dayIndex];
      return {dayIndex, dayLabel, opensAt: formatMinutes(upcoming.openMinutes)};
    }
  }
  return null;
}

/**
 * Whether the store is open at `now` in `timeZone`, plus when it closes or next
 * opens. `unknown` when the store has no hours or the zone is not usable.
 */
export function openStatus(
  store: Pick<Store, 'hours'>,
  now: Date | number,
  timeZone: string,
): OpenStatus {
  const hours = store.hours;
  const local = localTime(now, timeZone);
  if (!hours || !local) return {status: 'unknown'};

  // An overnight interval that started yesterday still covers the early hours.
  const yesterday = hours[(local.dayIndex + 6) % 7];
  for (const interval of yesterday ?? []) {
    const closeToday = interval.closeMinutes - MINUTES_PER_DAY;
    if (closeToday > 0 && local.minutes < closeToday) {
      return {
        status: 'open',
        closesAt: formatMinutes(closeToday),
        minutesUntilClose: closeToday - local.minutes,
      };
    }
  }
  for (const interval of hours[local.dayIndex]) {
    if (
      local.minutes >= interval.openMinutes &&
      local.minutes < interval.closeMinutes
    ) {
      return {
        status: 'open',
        closesAt: formatMinutes(interval.closeMinutes),
        minutesUntilClose: interval.closeMinutes - local.minutes,
      };
    }
  }
  return {status: 'closed', next: nextOpening(hours, local)};
}

/** True only when the store is known to be open. Unknown hours are not "open". */
export function isOpenNow(
  store: Pick<Store, 'hours'>,
  now: Date | number,
  timeZone: string,
): boolean {
  return openStatus(store, now, timeZone).status === 'open';
}

export type TodaysHours =
  | {
      readonly status: 'hours';
      readonly dayIndex: DayIndex;
      readonly day: string;
      readonly text: string;
    }
  | {
      readonly status: 'closed_today';
      readonly dayIndex: DayIndex;
      readonly day: string;
      readonly text: 'Closed today';
    }
  | {readonly status: 'unknown'; readonly text: 'Hours not available'};

/** Today's hours as text for the store card (today in the store's time zone). */
export function todaysHours(
  store: Pick<Store, 'hours'>,
  now: Date | number,
  timeZone: string,
): TodaysHours {
  const local = localTime(now, timeZone);
  if (!store.hours || !local)
    return {status: 'unknown', text: 'Hours not available'};
  const today = store.hours[local.dayIndex];
  const day = DAY_NAMES[local.dayIndex];
  return today.length === 0
    ? {
        status: 'closed_today',
        dayIndex: local.dayIndex,
        day,
        text: 'Closed today',
      }
    : {
        status: 'hours',
        dayIndex: local.dayIndex,
        day,
        text: formatDayHours(today),
      };
}
