/**
 * Business-date helpers.
 *
 * Every deadline, execution date and overdue comparison is a *calendar* date in
 * the team's local timezone, not an instant. The previous implementation used
 * `new Date().toISOString().split('T')[0]`, which yields the UTC date — for a
 * team in IST (UTC+5:30) that returns yesterday until 05:30 local, so tasks
 * were stamped with the wrong day and flipped to overdue a day early.
 *
 * These helpers format in an explicit timezone instead. Default is
 * `Asia/Kolkata`, overridable with `APP_TIMEZONE` on the server or
 * `NEXT_PUBLIC_APP_TIMEZONE` in the browser.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export function getTimezone(): string {
  // Server config wins; the public var lets the client agree with the server.
  return (
    process.env.APP_TIMEZONE ||
    process.env.NEXT_PUBLIC_APP_TIMEZONE ||
    DEFAULT_TIMEZONE
  );
}

/**
 * Formats an instant as `YYYY-MM-DD` in the given timezone.
 *
 * Uses `en-CA` because it renders ISO-ordered dates, avoiding manual part
 * assembly.
 */
export function toDateString(
  instant: Date = new Date(),
  timezone: string = getTimezone()
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Today's calendar date in the configured timezone, as `YYYY-MM-DD`. */
export function today(timezone: string = getTimezone()): string {
  return toDateString(new Date(), timezone);
}

/** Current wall-clock time in the configured timezone, as `HH:mm:ss`. */
export function nowTimeString(timezone: string = getTimezone()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

/** ISO-8601 instant, for audit timestamps and concurrency tokens. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Adds days to a `YYYY-MM-DD` date string, returning the same format.
 * Works on the calendar date directly so it is immune to DST shifts.
 */
export function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number);
  // Construct at UTC noon: far enough from either midnight that no timezone
  // offset can push the date across a boundary.
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is
 * earlier. Used for deadline countdowns and completion-time metrics.
 */
export function daysBetween(from: string, to: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const millis = parse(to) - parse(from);
  return Math.round(millis / 86_400_000);
}

/** True when `dateString` is a well-formed, real calendar date. */
export function isValidDateString(dateString: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
  const [year, month, day] = dateString.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Reject impossible days such as 2026-02-30.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * True when a task with this deadline and status should count as overdue.
 * Centralised so the dashboard, the reports and the server all agree.
 */
export function isOverdue(
  deadline: string,
  isCompleted: boolean,
  todayDate: string = today()
): boolean {
  if (isCompleted) return false;
  if (!deadline || !isValidDateString(deadline)) return false;
  return deadline < todayDate;
}
