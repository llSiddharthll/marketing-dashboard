/**
 * CSV export.
 *
 * Fixes three problems with the previous implementation:
 *  - It wrote an eight-row "executive summary" block *above* the header row, so
 *    the file did not parse as CSV in anything that expected a header on line 1.
 *  - It never revoked the object URL, leaking a blob per export.
 *  - It never appended the link to the DOM, which happens to work in Chrome but
 *    is unreliable elsewhere.
 *
 * Also emits a UTF-8 BOM so Excel opens rupee symbols and accented names
 * correctly instead of mangling them.
 */

import type { Task } from '@/types/dashboard';
import { today } from '@/lib/dates';

/** Escapes one value for CSV: quote it, and double any inner quotes. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Only quote when necessary, which keeps the file readable.
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const COLUMNS: { header: string; get: (task: Task) => unknown }[] = [
  { header: 'Task ID', get: (t) => t.id },
  { header: 'Task Name', get: (t) => t.taskName },
  { header: 'Task Brief', get: (t) => t.taskBrief },
  { header: 'Project', get: (t) => t.project },
  { header: 'Department', get: (t) => t.department },
  { header: 'Assigned To', get: (t) => t.internalPoc },
  { header: 'Agency', get: (t) => t.agency },
  { header: 'Vendor', get: (t) => t.vendor },
  { header: 'Priority', get: (t) => t.priority },
  { header: 'Status', get: (t) => t.taskProgress },
  { header: 'Overdue', get: (t) => (t.isOverdue ? 'Yes' : 'No') },
  { header: 'Deadline', get: (t) => t.deadline },
  { header: 'Execution Start Date', get: (t) => t.executionStartDate ?? '' },
  { header: 'Actual Finished Date', get: (t) => t.actualFinishedDate ?? '' },
  { header: 'Approval Date', get: (t) => t.approvalDate ?? '' },
  { header: 'Rejection Reason', get: (t) => t.rejectionReason ?? '' },
  // Plain numbers, not "₹1,20,000" — a currency-formatted string cannot be
  // summed in a spreadsheet, which is the first thing anyone does with this.
  { header: 'Budget (INR)', get: (t) => t.budget ?? 0 },
  { header: 'Actual Spend (INR)', get: (t) => t.actualSpend ?? 0 },
  {
    header: 'Variance (INR)',
    get: (t) => (t.budget ?? 0) - (t.actualSpend ?? 0),
  },
  {
    header: 'Subtasks Done',
    get: (t) => (t.subtasks ?? []).filter((s) => s.completed).length,
  },
  { header: 'Subtasks Total', get: (t) => (t.subtasks ?? []).length },
  { header: 'Comments', get: (t) => (t.comments ?? []).length },
  { header: 'Remarks', get: (t) => t.remarks },
  { header: 'Created At', get: (t) => t.createdAt },
  { header: 'Updated At', get: (t) => t.updatedAt },
];

/** Downloads the given tasks as a CSV file. */
export function exportTasksToCsv(tasks: Task[], filenamePrefix = 'tasks'): void {
  if (typeof window === 'undefined') return;

  const lines = [
    COLUMNS.map((column) => cell(column.header)).join(','),
    ...tasks.map((task) =>
      COLUMNS.map((column) => cell(column.get(task))).join(',')
    ),
  ];

  // ﻿ is the BOM; \r\n because that is what spreadsheet software expects.
  const content = `﻿${lines.join('\r\n')}`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}-${today()}.csv`;
  // Appended so the click works consistently across browsers.
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
