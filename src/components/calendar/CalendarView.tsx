'use client';

import React, { useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';
import type { Task } from '@/types/dashboard';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { StatusLegend } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Panel';
import { getStatusVisual, STATUS_ORDER } from '@/lib/design/statusStyles';
import { today } from '@/lib/dates';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** `YYYY-MM-DD` for a given year/month/day, without touching the timezone. */
function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const CalendarView: React.FC = () => {
  const { tasks } = useData();
  const todayDate = today();

  // Opens on the current month. The previous build hardcoded
  // `new Date(2026, 6, 1)` — July 2026 — so the calendar showed the wrong month
  // for everyone, forever.
  const [cursor, setCursor] = useState(() => {
    const [year, month] = todayDate.split('-').map(Number);
    return { year, month: month - 1 };
  });

  const [selected, setSelected] = useState<Task | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const { year, month } = cursor;

  /** Tasks grouped by deadline, so each cell is a lookup rather than a scan. */
  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.deadline) continue;
      const existing = map.get(task.deadline);
      if (existing) existing.push(task);
      else map.set(task.deadline, [task]);
    }
    // Most urgent first within a day.
    for (const list of map.values()) {
      list.sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue));
    }
    return map;
  }, [tasks]);

  const cells = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    // Monday-first, which matches how work weeks are planned. getUTCDay() is
    // Sunday-based, so Sunday (0) becomes 6.
    const leading = (firstOfMonth.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const result: { day: number | null; key: string }[] = [];
    for (let i = 0; i < leading; i++) result.push({ day: null, key: `pad-${i}` });
    for (let day = 1; day <= daysInMonth; day++) {
      result.push({ day, key: dateKey(year, month, day) });
    }
    // Pad to a whole number of weeks so the grid has no ragged final row.
    while (result.length % 7 !== 0) {
      result.push({ day: null, key: `tail-${result.length}` });
    }
    return result;
  }, [year, month]);

  const step = (delta: number) => {
    setExpandedDay(null);
    setCursor((previous) => {
      const next = previous.month + delta;
      return {
        year: previous.year + Math.floor(next / 12),
        month: ((next % 12) + 12) % 12,
      };
    });
  };

  const goToToday = () => {
    const [y, m] = todayDate.split('-').map(Number);
    setCursor({ year: y, month: m - 1 });
    setExpandedDay(null);
  };

  const monthTaskCount = useMemo(
    () =>
      cells.filter((cell) => cell.day !== null && byDate.has(cell.key)).reduce(
        (sum, cell) => sum + (byDate.get(cell.key)?.length ?? 0),
        0
      ),
    [cells, byDate]
  );

  const isCurrentMonth =
    todayDate.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            onClick={() => step(-1)}
            aria-label="Previous month"
            icon={<ChevronLeft className="w-4 h-4" aria-hidden="true" />}
          />
          <h2 className="text-section-title min-w-40 text-center" aria-live="polite">
            {MONTH_NAMES[month]} {year}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            onClick={() => step(1)}
            aria-label="Next month"
            icon={<ChevronRight className="w-4 h-4" aria-hidden="true" />}
          />
        </div>

        <div className="flex items-center gap-2">
          <p className="text-meta hidden sm:block">
            {monthTaskCount} deadline{monthTaskCount === 1 ? '' : 's'} this month
          </p>
          {!isCurrentMonth && (
            <Button size="sm" onClick={goToToday}>
              Today
            </Button>
          )}
        </div>
      </div>

      {/* Legend, driven by the same table the events are, so the swatches can no
          longer disagree with the cards they describe. */}
      <div className="card px-4 py-3">
        <StatusLegend keys={STATUS_ORDER} />
      </div>

      {/* Grid */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-surface-sunken/60">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="px-2 py-2 text-center">
              <span className="text-label">
                <span className="sm:hidden">{weekday.charAt(0)}</span>
                <span className="hidden sm:inline">{weekday}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell, index) => {
            if (cell.day === null) {
              return (
                <div
                  key={cell.key}
                  className="min-h-20 sm:min-h-28 bg-surface-sunken/40 border-b border-r border-line last:border-r-0"
                  aria-hidden="true"
                />
              );
            }

            const dayTasks = byDate.get(cell.key) ?? [];
            const isToday = cell.key === todayDate;
            const isExpanded = expandedDay === cell.key;
            // Two on a phone, four on larger screens, so a busy day does not
            // stretch the row to twenty items tall.
            const visible = isExpanded ? dayTasks : dayTasks.slice(0, 3);
            const hidden = dayTasks.length - visible.length;

            return (
              <div
                key={cell.key}
                className={`min-h-20 sm:min-h-28 p-1.5 border-b border-r border-line last:border-r-0 ${
                  (index + 1) % 7 === 0 ? 'border-r-0' : ''
                } ${isToday ? 'bg-accent-soft/40' : ''}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`inline-flex items-center justify-center w-5 h-5 rounded text-[12px] tabular ${
                      isToday
                        ? 'bg-accent text-accent-fg font-semibold'
                        : 'text-fg-muted'
                    }`}
                  >
                    {cell.day}
                  </span>
                  {isToday && <span className="sr-only">Today</span>}
                </div>

                <ul className="space-y-1">
                  {visible.map((task) => {
                    const visual = getStatusVisual(
                      task.taskProgress,
                      task.isOverdue
                    );
                    return (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(task)}
                          title={`${task.taskName} — ${visual.label}`}
                          className={`w-full text-left px-1.5 py-1 rounded border text-[11px] leading-tight truncate transition-opacity hover:opacity-80 ${visual.className}`}
                        >
                          {task.taskName}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedDay(cell.key)}
                    className="mt-1 w-full text-left px-1.5 text-[11px] font-medium text-fg-subtle hover:text-fg transition-colors"
                  >
                    +{hidden} more
                  </button>
                )}
                {isExpanded && dayTasks.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setExpandedDay(null)}
                    className="mt-1 w-full text-left px-1.5 text-[11px] font-medium text-fg-subtle hover:text-fg transition-colors"
                  >
                    Show less
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {monthTaskCount === 0 && (
        <div className="card">
          <EmptyState
            icon={<CalendarDays className="w-6 h-6" />}
            message={`Nothing is due in ${MONTH_NAMES[month]} ${year}.`}
            hint="Use the arrows to look at another month."
          />
        </div>
      )}

      <TaskDrawer
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        taskToEdit={selected}
      />
    </div>
  );
};
