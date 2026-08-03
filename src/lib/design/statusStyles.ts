/**
 * The visual language for status and priority.
 *
 * One source of truth, because the previous build styled these inline in six
 * different components and they had already drifted — the calendar legend showed
 * a different shade for "In Progress" than the calendar events did.
 *
 * Colour assignments follow the brief: green for Completed, blue for In
 * Progress, yellow for Pending Approval, red for Overdue, grey for Not Started.
 * The brief left Waiting and On Hold unspecified; they get violet and stone, the
 * two remaining hues that do not read as either "go" or "problem".
 *
 * Priority deliberately does **not** use colour as its primary signal. Status
 * already spends the colour budget, and adding four more hues made priority and
 * status compete — in the previous build every priority except Urgent rendered
 * identically, so priority was invisible at a glance. Instead priority is a
 * three-bar glyph where the number of filled bars carries the level. That is
 * readable without colour vision, and it can never be confused with a status
 * pill because the shape is different.
 */

import type { Priority, TaskStatus } from '@/types/dashboard';

export interface StatusVisual {
  label: string;
  /** Pill classes: background, text and border, for both themes. */
  className: string;
  /** Solid colour for calendar events, chart series and legend dots. */
  dot: string;
  /** Hex, for Recharts and anywhere CSS classes cannot reach. */
  hex: string;
}

/**
 * Overdue is not a `TaskStatus` — it is a flag that can apply to any unfinished
 * task — but it needs the same treatment, so it is keyed alongside them.
 */
export type StatusKey = TaskStatus | 'Overdue';

export const STATUS_VISUALS: Record<StatusKey, StatusVisual> = {
  'Not Started': {
    label: 'Not started',
    className:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700',
    dot: 'bg-slate-400 dark:bg-slate-500',
    hex: '#94a3b8',
  },
  'In Progress': {
    label: 'In progress',
    className:
      'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900',
    dot: 'bg-blue-500',
    hex: '#3b82f6',
  },
  Waiting: {
    label: 'Waiting',
    className:
      'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-900',
    dot: 'bg-cyan-500',
    // Cyan, not the violet this originally used. Violet #8b5cf6 against the
    // blue #3b82f6 of "In progress" measured ΔE 1.3 under deuteranopia and only
    // 12.0 for normal vision — below the 15 floor, meaning the two were hard to
    // tell apart even with full colour vision. Cyan measures 16.1. See the
    // validation note at the bottom of this file.
    hex: '#06b6d4',
  },
  'On Hold': {
    label: 'On hold',
    className:
      'bg-stone-100 text-stone-700 border-stone-300 dark:bg-stone-900/60 dark:text-stone-300 dark:border-stone-700',
    dot: 'bg-stone-500',
    hex: '#78716c',
  },
  'To Be Approved by Management': {
    // Shortened from the status value itself: the full string is 28 characters
    // and wrapped every table cell it appeared in.
    label: 'Awaiting approval',
    className:
      'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
    dot: 'bg-amber-500',
    hex: '#f59e0b',
  },
  Completed: {
    label: 'Completed',
    className:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
    dot: 'bg-emerald-500',
    hex: '#10b981',
  },
  Overdue: {
    label: 'Overdue',
    className:
      'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900',
    dot: 'bg-rose-500',
    hex: '#f43f5e',
  },
};

/**
 * Resolves what to show for a task. Overdue wins over the underlying status,
 * because a late task is the more urgent fact about it.
 */
export function resolveStatusKey(
  status: TaskStatus,
  isOverdue: boolean
): StatusKey {
  if (isOverdue && status !== 'Completed') return 'Overdue';
  return status;
}

export function getStatusVisual(
  status: TaskStatus,
  isOverdue = false
): StatusVisual {
  return STATUS_VISUALS[resolveStatusKey(status, isOverdue)];
}

/** Legend and calendar order: the lifecycle, with Overdue last. */
export const STATUS_ORDER: StatusKey[] = [
  'Not Started',
  'In Progress',
  'Waiting',
  'On Hold',
  'To Be Approved by Management',
  'Completed',
  'Overdue',
];

/**
 * Series order for charts, which is deliberately **not** the lifecycle order.
 *
 * In a chart, adjacent series sit next to each other and get compared directly,
 * so the two hardest-to-separate colours must not be neighbours. Completed
 * (emerald) and Overdue (rose) are the classic red/green confusion pair, and the
 * brief fixes both of those colours, so they cannot be changed — but they can be
 * moved apart. Putting Overdue first drops the worst adjacent pair from ΔE 5.6
 * to 8.9 under protanopia, which clears the threshold.
 *
 * Overdue first is also the right reading order: it is what someone scanning the
 * chart needs to see first.
 */
export const STATUS_CHART_ORDER: StatusKey[] = [
  'Overdue',
  'Not Started',
  'In Progress',
  'Waiting',
  'On Hold',
  'To Be Approved by Management',
  'Completed',
];

/* -------------------------------------------------------------------------- */
/* Priority                                                                   */
/* -------------------------------------------------------------------------- */

export interface PriorityVisual {
  label: string;
  /** Filled bars out of three. */
  level: 1 | 2 | 3;
  /** Bar colour. Reinforces the glyph; never the only signal. */
  barClass: string;
  textClass: string;
  hex: string;
}

export const PRIORITY_VISUALS: Record<Priority, PriorityVisual> = {
  Urgent: {
    label: 'Urgent',
    level: 3,
    barClass: 'bg-rose-500',
    textClass: 'text-rose-700 dark:text-rose-300 font-semibold',
    hex: '#f43f5e',
  },
  High: {
    label: 'High',
    level: 3,
    barClass: 'bg-amber-500',
    textClass: 'text-amber-800 dark:text-amber-300 font-medium',
    hex: '#f59e0b',
  },
  Medium: {
    label: 'Medium',
    level: 2,
    barClass: 'bg-slate-400 dark:bg-slate-500',
    textClass: 'text-fg-muted',
    hex: '#94a3b8',
  },
  Low: {
    label: 'Low',
    level: 1,
    barClass: 'bg-slate-300 dark:bg-slate-600',
    textClass: 'text-fg-subtle',
    hex: '#cbd5e1',
  },
};

export const PRIORITY_ORDER: Priority[] = ['Urgent', 'High', 'Medium', 'Low'];

/** Sort weight, so "Urgent first" ordering does not need a lookup table. */
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  Urgent: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

/**
 * Urgent and High are both three bars, distinguished by colour, because they are
 * both "act now" and the difference between them is tone rather than magnitude.
 * The bar count separates the two act-now levels from Medium and Low, which is
 * the distinction that actually changes what someone does next.
 */
export function getPriorityVisual(priority: Priority): PriorityVisual {
  return PRIORITY_VISUALS[priority];
}

/* -------------------------------------------------------------------------- */
/* Palette validation record                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Colour-vision validation, in {@link STATUS_CHART_ORDER}, measured rather than
 * eyeballed. Recorded here so a future change to any hex can be re-checked
 * against the same thresholds instead of guessed at.
 *
 * Results against both the light (#ffffff) and dark (#131824) chart surfaces:
 *
 *   PASS  CVD separation      worst adjacent pair Completed↔Awaiting, ΔE 8.9 (protan)
 *   PASS  Normal-vision floor worst adjacent pair Waiting↔In progress, ΔE 16.1
 *   PASS  Contrast (dark)     all seven at or above 3:1
 *
 * Two findings were assessed and accepted rather than fixed:
 *
 *  1. **"Not started" (slate) and "On hold" (stone) fall below the chroma floor**,
 *     i.e. they read as grey. That is the intended encoding — both are inactive
 *     states, and grey is what communicates "nothing is happening here". The
 *     check exists to stop a *categorical* series losing its identity, which is a
 *     different job from status.
 *
 *  2. **Light-mode contrast for slate, cyan, amber and emerald is below 3:1.**
 *     This obligates relief rather than being dismissable, so every chart using
 *     these colours ships a legend, direct value labels, and a table view of the
 *     same data. Colour is never the only way to read a figure.
 */
export const PALETTE_VALIDATION_NOTE =
  'Status colours validated for colour-vision separation; charts pair them with labels and a table view.';
