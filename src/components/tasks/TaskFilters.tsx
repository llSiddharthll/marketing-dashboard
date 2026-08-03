'use client';

/**
 * The task filter bar.
 *
 * Adds the two filters the brief asks for that were missing — vendor and agency —
 * and replaces the three fixed date presets ("this week", "this month",
 * "overdue") with a real from/to range, which is what the brief specifies.
 *
 * Collapsed by default on small screens so it does not push the task list below
 * the fold on a phone.
 */

import React, { useState } from 'react';
import { useData } from '@/context/DataContext';
import type { Priority, TaskStatus } from '@/types/dashboard';
import { PRIORITY_ORDER, STATUS_VISUALS } from '@/lib/design/statusStyles';
import { TASK_STATUSES } from '@/lib/sheets/schema';
import { addDays, today } from '@/lib/dates';
import { SlidersHorizontal, X } from 'lucide-react';

export interface Filters {
  project: string;
  department: string;
  internalPoc: string;
  vendor: string;
  agency: string;
  priority: Priority | '';
  status: TaskStatus | '';
  dueFrom: string;
  dueTo: string;
  overdueOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  project: '',
  department: '',
  internalPoc: '',
  vendor: '',
  agency: '',
  priority: '',
  status: '',
  dueFrom: '',
  dueTo: '',
  overdueOnly: false,
};

interface TaskFiltersProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  taskCount: number;
}

export const TaskFilters: React.FC<TaskFiltersProps> = ({
  filters,
  onChange,
}) => {
  const { getActiveMasterOptions } = useData();
  const [expanded, setExpanded] = useState(false);

  const activeCount = Object.entries(filters).filter(([key, value]) =>
    key === 'overdueOnly' ? value === true : value !== ''
  ).length;

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onChange({ ...filters, [key]: value });

  const selects: {
    key: keyof Filters;
    label: string;
    options: string[];
  }[] = [
    { key: 'project', label: 'Project', options: getActiveMasterOptions('Projects') },
    {
      key: 'department',
      label: 'Department',
      options: getActiveMasterOptions('Departments'),
    },
    {
      key: 'internalPoc',
      label: 'Assigned to',
      options: getActiveMasterOptions('Team Members'),
    },
    { key: 'agency', label: 'Agency', options: getActiveMasterOptions('Agencies') },
    { key: 'vendor', label: 'Vendor', options: getActiveMasterOptions('Vendors') },
  ];

  return (
    <section className="card" aria-label="Filters">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-center gap-2 text-[13px] font-medium text-fg-muted hover:text-fg transition-colors"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
          Filters
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-accent text-accent-fg text-[11px] font-semibold tabular">
              {activeCount}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2">
          {/* Quick toggle kept out of the collapsed panel: "what is late" is the
              question people ask most often. */}
          <label className="flex items-center gap-1.5 text-[13px] text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={filters.overdueOnly}
              onChange={(event) => set('overdueOnly', event.target.checked)}
              className="rounded border-line-strong"
            />
            Overdue only
          </label>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="flex items-center gap-1 text-[13px] font-medium text-fg-subtle hover:text-fg transition-colors"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-line grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {selects.map((select) => (
            <div key={select.key}>
              <label
                htmlFor={`filter-${select.key}`}
                className="field-label"
              >
                {select.label}
              </label>
              <select
                id={`filter-${select.key}`}
                value={filters[select.key] as string}
                onChange={(event) =>
                  set(select.key, event.target.value as never)
                }
                className="field"
              >
                <option value="">All</option>
                {select.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div>
            <label htmlFor="filter-priority" className="field-label">
              Priority
            </label>
            <select
              id="filter-priority"
              value={filters.priority}
              onChange={(event) =>
                set('priority', event.target.value as Priority | '')
              }
              className="field"
            >
              <option value="">All</option>
              {PRIORITY_ORDER.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-status" className="field-label">
              Status
            </label>
            <select
              id="filter-status"
              value={filters.status}
              onChange={(event) =>
                set('status', event.target.value as TaskStatus | '')
              }
              className="field"
            >
              <option value="">All</option>
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_VISUALS[status].label}
                </option>
              ))}
            </select>
          </div>

          {/* A real range, rather than the previous fixed presets. */}
          <div>
            <label htmlFor="filter-due-from" className="field-label">
              Due from
            </label>
            <input
              id="filter-due-from"
              type="date"
              value={filters.dueFrom}
              max={filters.dueTo || undefined}
              onChange={(event) => set('dueFrom', event.target.value)}
              className="field"
            />
          </div>

          <div>
            <label htmlFor="filter-due-to" className="field-label">
              Due to
            </label>
            <input
              id="filter-due-to"
              type="date"
              value={filters.dueTo}
              min={filters.dueFrom || undefined}
              onChange={(event) => set('dueTo', event.target.value)}
              className="field"
            />
          </div>

          {/* Shortcuts for the ranges people actually ask for, so the common
              case does not need two date pickers. */}
          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[12.5px] text-fg-subtle">Quick range:</span>
            {[
              { label: 'Next 7 days', from: today(), to: addDays(today(), 7) },
              { label: 'Next 30 days', from: today(), to: addDays(today(), 30) },
              { label: 'Past due', from: '', to: addDays(today(), -1) },
            ].map((range) => (
              <button
                key={range.label}
                type="button"
                onClick={() =>
                  onChange({ ...filters, dueFrom: range.from, dueTo: range.to })
                }
                className="px-2.5 py-1 rounded-md border border-line text-[12.5px] font-medium text-fg-muted hover:text-fg hover:border-line-strong transition-colors"
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
