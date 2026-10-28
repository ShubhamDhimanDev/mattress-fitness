// Weekly opening hours: a port of the storefront reader, storefront/app/lib/stores/hours.ts (parseWeeklyHours,
// parseDaySelector, isValidTimeZone). The sheet is checked with the SAME rules the website applies, so a row that passes
// here is read by the site without dropping anything. Keep the two in step: if hours.ts changes, change this file and
// the cases in hours.test.mjs. The port differs in one way: instead of one list of warnings it separates the notes that
// are harmless ("no hours for Sunday, shown as closed") from real problems.

const MINUTES_PER_DAY = 1440;
const MAX_OVERNIGHT_MINUTES = 16 * 60;
const MAX_INTERVALS_PER_DAY = 3;
const MAX_ENTRIES = 50;
const MAX_INPUT_LENGTH = 4000;
// U+2012 to U+2015 (figure dash .. horizontal bar) and U+2212 (minus sign), as in hours.ts.
const DASH_CLASS = '\\u2012-\\u2015\\u2212';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** @typedef {{ openMinutes: number, closeMinutes: number }} Interval */

const DAY_ALIASES = new Map([
  ['sun', 0], ['sunday', 0], ['mon', 1], ['monday', 1], ['tue', 2], ['tues', 2], ['tuesday', 2], ['wed', 3], ['weds', 3], ['wednesday', 3],
  ['thu', 4], ['thur', 4], ['thurs', 4], ['thursday', 4], ['fri', 5], ['friday', 5], ['sat', 6], ['saturday', 6],
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Short excerpt of untrusted text for a message. @param {string} text */
function shown(text) {
  return text.replace(/\s+/g, ' ').replace(/[<>]/g, '').trim().slice(0, 30);
}

/** @param {number} totalMinutes */
function formatMinutes(totalMinutes) {
  const minutes = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h24 = Math.floor(minutes / 60);
  return `${h24 % 12 === 0 ? 12 : h24 % 12}:${String(minutes % 60).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

/** @param {number} from @param {number} to */
function rangeOfDays(from, to) {
  const days = [];
  for (let step = 0; step < 7; step += 1) {
    const day = (from + step) % 7;
    days.push(day);
    if (day === to) break;
  }
  return days;
}

/**
 * "Mon-Fri", "Sat, Sun", "Fri-Mon", "weekdays", "daily"; null when unreadable.
 * @param {string} text
 * @returns {number[] | null}
 */
export function parseDaySelector(text) {
  const cleaned = text
    .toLowerCase()
    .replace(new RegExp(`[${DASH_CLASS}]`, 'g'), '-')
    .replace(/\b(?:through|thru|to)\b/g, '-')
    .replace(/&|\band\b/g, ',')
    .replace(/[.:]/g, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return null;
  if (/^(?:daily|every ?day|7 days(?: a week)?)$/.test(cleaned)) return [...ALL_DAYS];
  if (cleaned === 'weekdays') return [1, 2, 3, 4, 5];
  if (cleaned === 'weekends') return [0, 6];
  const days = new Set();
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

/** @param {string} text @returns {number | null} */
function parseClock(text) {
  const value = text.trim().toLowerCase().replace(/\./g, '');
  if (value === 'noon') return 720;
  if (value === 'midnight') return 0;
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)$/.exec(value);
  if (twelve) {
    const hour = Number(twelve[1]);
    const minute = Number(twelve[2] ?? '0');
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return (hour % 12) * 60 + minute + (twelve[3].startsWith('p') ? 720 : 0);
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

/** @param {string} openText @param {string} closeText @returns {{ ok: true, interval: Interval } | { ok: false, problem: string }} */
function makeInterval(openText, closeText) {
  const open = parseClock(openText);
  const close = parseClock(closeText);
  if (open === null || close === null) {
    return { ok: false, problem: `"${shown(openText)} to ${shown(closeText)}" is not a readable time range (write 9:00 AM - 5:00 PM or 09:00-17:00)` };
  }
  if (open >= MINUTES_PER_DAY) return { ok: false, problem: 'An opening time cannot be 24:00.' };
  if (close === open) return { ok: false, problem: 'Opening and closing times are the same.' };
  if (close > open) return { ok: true, interval: { openMinutes: open, closeMinutes: close } };
  const overnightClose = close + MINUTES_PER_DAY;
  if (overnightClose - open > MAX_OVERNIGHT_MINUTES) {
    return { ok: false, problem: `Closing at ${formatMinutes(close)} after opening at ${formatMinutes(open)} would be over 16 hours; check AM and PM.` };
  }
  return { ok: true, interval: { openMinutes: open, closeMinutes: overnightClose } };
}

const ALL_DAY = /^(?:open\s+)?(?:24\s*(?:h|hr|hrs|hours?)|24\/7|all day)$/;
const CLOSED = /^(?:closed(?:\s+all\s+day)?|not open|none)$/;

/** @param {string} text @param {string[]} problems @returns {Interval[] | null} */
function parseHoursSpec(text, problems) {
  const spec = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (CLOSED.test(spec)) return [];
  if (ALL_DAY.test(spec)) return [{ openMinutes: 0, closeMinutes: MINUTES_PER_DAY }];
  const intervals = [];
  for (const range of spec.split(/\s*(?:,|&|\band\b)\s*/)) {
    const ends = range.split(new RegExp(`\\s*(?:[-${DASH_CLASS}]|\\bto\\b)\\s*`));
    if (ends.length !== 2) {
      problems.push(`"${shown(range)}" is not a readable time range.`);
      return null;
    }
    const result = makeInterval(ends[0], ends[1]);
    if (!result.ok) {
      problems.push(result.problem);
      return null;
    }
    intervals.push(result.interval);
  }
  return intervals;
}

/** @param {Interval[]} intervals @param {string[]} problems */
function tidyDay(intervals, problems) {
  const sorted = [...intervals].sort((a, b) => a.openMinutes - b.openMinutes);
  const kept = [];
  for (const interval of sorted) {
    const previous = kept[kept.length - 1];
    if (previous && interval.openMinutes < previous.closeMinutes) {
      problems.push('Two opening times overlap; the site would ignore the later one.');
      continue;
    }
    if (kept.length >= MAX_INTERVALS_PER_DAY) {
      problems.push(`Only ${MAX_INTERVALS_PER_DAY} opening times per day are used.`);
      break;
    }
    kept.push(interval);
  }
  return kept;
}

/**
 * Splits "Mon-Fri 9am-5pm" or "Sun: Closed" into its day part and hours part, the way the site does.
 * @param {string} line
 * @returns {{ dayPart: string, hoursPart: string } | null}
 */
export function splitTextLine(line) {
  const split = /(?:\d|\bclosed\b|\bopen\b|\bnot open\b|\bnoon\b|\bmidnight\b)/i.exec(line);
  if (!split) return null;
  return {
    dayPart: line.slice(0, split.index).replace(/[\s:,-]+$/, ''),
    hoursPart: line.slice(split.index).replace(/^[\s:,-]+/, ''),
  };
}

/** @param {string} line @param {string[]} problems */
function parseTextLine(line, problems) {
  const parts = splitTextLine(line);
  if (!parts) {
    problems.push(`"${shown(line)}" has no hours.`);
    return null;
  }
  const days = parseDaySelector(parts.dayPart);
  if (!days) {
    problems.push(`"${shown(parts.dayPart)}" is not a readable day or day range.`);
    return null;
  }
  const intervals = parseHoursSpec(parts.hoursPart, problems);
  return intervals ? { days, intervals } : null;
}

/** @param {unknown} value */
function selectorFrom(value) {
  if (typeof value === 'string') return parseDaySelector(value);
  if (Array.isArray(value)) {
    const days = new Set();
    for (const item of value) {
      const part = typeof item === 'string' ? parseDaySelector(item) : null;
      if (!part) return null;
      for (const day of part) days.add(day);
    }
    return days.size > 0 ? [...days] : null;
  }
  return null;
}

/** @param {Record<string, unknown>} record @param {string[]} names */
function firstDefined(record, names) {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** @param {unknown} value @param {string[]} problems @returns {Interval[] | null} */
function intervalsFromValue(value, problems) {
  if (value === null || value === false) return [];
  if (typeof value === 'string') return parseHoursSpec(value, problems);
  if (Array.isArray(value)) {
    const all = [];
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

/** @param {Record<string, unknown>} record @param {string[]} problems */
function assignmentsFromRecord(record, problems) {
  const out = [];
  for (const [key, value] of Object.entries(record).slice(0, MAX_ENTRIES)) {
    const days = parseDaySelector(key);
    if (!days) {
      problems.push(`"${shown(key)}" is not a readable day or day range.`);
      continue;
    }
    const intervals = intervalsFromValue(value, problems);
    if (intervals) out.push({ days, intervals });
  }
  return out;
}

/** @param {readonly unknown[]} list @param {string[]} problems */
function assignmentsFromList(list, problems) {
  const out = [];
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
    if (intervals) out.push({ days, intervals });
  }
  return out;
}

/** @param {unknown} raw @param {string[]} problems */
function assignmentsFromRaw(raw, problems) {
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
      const lines = text.split(/[\n\r;|]+/).map((line) => line.trim()).filter((line) => line !== '');
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
 * `problems` are things the website would drop or ignore (a sheet must not contain them); `missingDays` only lists days
 * with no hours, which the website shows as closed.
 * @typedef {{ hours: Interval[][] | null, problems: string[], missingDays: string[] }} HoursResult
 */

/**
 * @param {unknown} raw text as typed in the sheet, or an already parsed value
 * @returns {HoursResult}
 */
export function parseWeeklyHours(raw) {
  if (raw === null || raw === undefined || raw === '') return { hours: null, problems: [], missingDays: [] };
  /** @type {string[]} */
  const problems = [];
  try {
    const assignments = assignmentsFromRaw(raw, problems);
    if (assignments.length === 0) {
      problems.push('No readable opening hours were found.');
      return { hours: null, problems, missingDays: [] };
    }
    /** @type {(Interval[] | null)[]} */
    const week = [null, null, null, null, null, null, null];
    for (const assignment of assignments) {
      for (const day of assignment.days) {
        if (week[day] !== null) problems.push(`${DAY_NAMES[day]} is given more than once; the site would use only the later entry.`);
        week[day] = assignment.intervals;
      }
    }
    const missingDays = ALL_DAYS.filter((day) => week[day] === null).map((day) => DAY_NAMES[day]);
    return { hours: week.map((day) => tidyDay(day ?? [], problems)), problems, missingDays };
  } catch {
    return { hours: null, problems: [...problems, 'The hours could not be read.'], missingDays: [] };
  }
}

const TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/**
 * The site accepts anything Intl accepts (it would also take "EST"). The sheet is stricter on purpose: an Area/Location
 * name in the usual capitalisation (America/Chicago), or UTC, because the admin guide promises IANA names only.
 * @param {unknown} value
 */
export function isValidTimeZone(value) {
  if (typeof value !== 'string' || value.length > 64 || !TIME_ZONE_PATTERN.test(value)) return false;
  if (value !== 'UTC' && !/^[A-Z][A-Za-z]*(?:\/[A-Z][A-Za-z0-9_+-]*){1,2}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value, hourCycle: 'h23' });
    return true;
  } catch {
    return false;
  }
}
