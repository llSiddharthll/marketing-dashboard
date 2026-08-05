import { describe, expect, it } from 'vitest';
import { TASK_COLUMNS, taskFromRow, taskToRow } from '../schema';
import type { Task } from '@/types/dashboard';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TSK-1',
    project: 'Q3 Brand Awareness',
    taskName: 'Launch teaser film',
    taskBrief: 'Cut a 30s teaser for social.',
    department: 'Brand & Creative',
    internalPoc: 'Aarav Sharma',
    agency: 'Apex Creative Studio',
    vendor: '',
    priority: 'High',
    taskProgress: 'To Be Approved by Management',
    deadline: '2026-08-15',
    executionStarted: true,
    executionStartDate: '2026-07-20',
    actualFinishedDate: null,
    toBeApprovedByManagement: true,
    submittedForApprovalAt: '2026-07-25T06:00:00.000Z',
    approvalDate: null,
    rejectionReason: null,
    remarks: '',
    budget: 120000,
    actualSpend: 45000,
    boqLink: 'https://docs.google.com/spreadsheets/d/boq123',
    approver: 'Sahil Sehgal',
    subtasks: [],
    comments: [],
    attachments: [
      {
        id: 'ATT-1',
        label: 'Vendor proposal',
        url: 'https://drive.google.com/file/vendor-proposal',
        addedBy: 'Aarav Sharma',
        addedAt: '2026-07-20T06:00:00.000Z',
      },
    ],
    isOverdue: false,
    createdAt: '2026-07-18T06:00:00.000Z',
    updatedAt: '2026-07-20T06:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('task schema — BOQ link, approver, attachments', () => {
  it('round-trips through taskToRow/taskFromRow without loss', () => {
    const task = makeTask();
    const row = taskToRow(task);
    expect(row).toHaveLength(TASK_COLUMNS.length);
    expect(taskFromRow(row)).toEqual(task);
  });

  it('defaults cleanly when these columns are absent from an older row', () => {
    const task = makeTask();
    const row = taskToRow(task).slice(0, 27); // pre-migration column count
    const parsed = taskFromRow(row);
    expect(parsed.boqLink).toBeNull();
    expect(parsed.approver).toBe('');
    expect(parsed.attachments).toEqual([]);
  });

  it('writes an empty attachments list as a blank cell, not "[]"', () => {
    const row = taskToRow(makeTask({ attachments: [] }));
    expect(row[TASK_COLUMNS.indexOf('Attachments')]).toBe('');
  });

  it('writes a null BOQ link and empty approver as blank cells', () => {
    const row = taskToRow(makeTask({ boqLink: null, approver: undefined }));
    expect(row[TASK_COLUMNS.indexOf('BOQ Link')]).toBe('');
    expect(row[TASK_COLUMNS.indexOf('Approver')]).toBe('');
  });

  it('drops a malformed Attachments cell to an empty list rather than throwing', () => {
    const row = taskToRow(makeTask());
    row[TASK_COLUMNS.indexOf('Attachments')] = 'not valid json';
    expect(taskFromRow(row).attachments).toEqual([]);
  });
});
