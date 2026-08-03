import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  daysBetween,
  isOverdue,
  isValidDateString,
  nowTimeString,
  toDateString,
  today,
} from '../dates';

afterEach(() => {
  vi.useRealTimers();
});

describe('toDateString', () => {
  it('returns the local calendar date, not the UTC date', () => {
    // 2026-07-30T22:30:00Z is already 2026-07-31 in IST (UTC+5:30).
    // The previous implementation used toISOString() and returned the 30th.
    const instant = new Date('2026-07-30T22:30:00.000Z');
    expect(toDateString(instant, 'Asia/Kolkata')).toBe('2026-07-31');
    expect(toDateString(instant, 'UTC')).toBe('2026-07-30');
  });

  it('does not roll back the date in the early IST morning', () => {
    // This is the bug that mis-stamped every task created before 05:30 IST:
    // 02:00 IST on the 30th is 20:30 UTC on the 29th.
    const instant = new Date('2026-07-29T20:30:00.000Z');
    expect(toDateString(instant, 'Asia/Kolkata')).toBe('2026-07-30');
    expect(toDateString(instant, 'UTC')).toBe('2026-07-29');
  });

  it('handles a timezone behind UTC', () => {
    const instant = new Date('2026-07-30T02:00:00.000Z');
    expect(toDateString(instant, 'America/New_York')).toBe('2026-07-29');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toDateString(new Date('2026-01-05T12:00:00.000Z'), 'UTC')).toBe(
      '2026-01-05'
    );
  });
});

describe('today', () => {
  it('tracks the mocked clock in the configured timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T20:00:00.000Z'));
    // 01:30 IST on the 31st.
    expect(today('Asia/Kolkata')).toBe('2026-07-31');
  });
});

describe('nowTimeString', () => {
  it('renders 24-hour local time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T09:05:03.000Z'));
    // 09:05:03 UTC is 14:35:03 IST.
    expect(nowTimeString('Asia/Kolkata')).toBe('14:35:03');
    expect(nowTimeString('UTC')).toBe('09:05:03');
  });
});

describe('addDays', () => {
  it('adds and subtracts days', () => {
    expect(addDays('2026-07-30', 1)).toBe('2026-07-31');
    expect(addDays('2026-07-30', -1)).toBe('2026-07-29');
    expect(addDays('2026-07-30', 0)).toBe('2026-07-30');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('daysBetween', () => {
  it('counts forwards and backwards', () => {
    expect(daysBetween('2026-07-30', '2026-08-02')).toBe(3);
    expect(daysBetween('2026-08-02', '2026-07-30')).toBe(-3);
    expect(daysBetween('2026-07-30', '2026-07-30')).toBe(0);
  });

  it('is unaffected by DST transitions', () => {
    // Northern-hemisphere DST change; a naive local-time diff would give 89.96
    // days and round wrong.
    expect(daysBetween('2026-03-01', '2026-05-30')).toBe(90);
  });
});

describe('isValidDateString', () => {
  it('accepts well-formed dates', () => {
    expect(isValidDateString('2026-07-30')).toBe(true);
    expect(isValidDateString('2028-02-29')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isValidDateString('')).toBe(false);
    expect(isValidDateString('30-07-2026')).toBe(false);
    expect(isValidDateString('2026-7-30')).toBe(false);
    expect(isValidDateString('not a date')).toBe(false);
  });

  it('rejects impossible calendar dates', () => {
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('2026-00-10')).toBe(false);
    expect(isValidDateString('2026-04-31')).toBe(false);
  });
});

describe('isOverdue', () => {
  it('flags an incomplete task past its deadline', () => {
    expect(isOverdue('2026-07-29', false, '2026-07-30')).toBe(true);
  });

  it('does not flag a task due today', () => {
    // A task is not late until the day is over.
    expect(isOverdue('2026-07-30', false, '2026-07-30')).toBe(false);
  });

  it('never flags a completed task', () => {
    expect(isOverdue('2020-01-01', true, '2026-07-30')).toBe(false);
  });

  it('does not flag a task with no or invalid deadline', () => {
    expect(isOverdue('', false, '2026-07-30')).toBe(false);
    expect(isOverdue('garbage', false, '2026-07-30')).toBe(false);
  });
});
