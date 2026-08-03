/**
 * Automation rule tests — one describe block per rule in the brief, plus the
 * interactions between rules, which is where the original implementation was
 * weakest.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  applyAutomationRules,
  applyManagementDecision,
  refreshDerivedFlags,
} from '../automations';
import type { Task } from '@/types/dashboard';

const TODAY = '2026-07-30';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TSK-1',
    project: 'Q3 Brand Awareness',
    taskName: 'Launch teaser film',
    taskBrief: '',
    department: 'Brand & Creative',
    internalPoc: 'Aarav Sharma',
    agency: '',
    vendor: '',
    priority: 'Medium',
    taskProgress: 'Not Started',
    deadline: '2026-08-15',
    executionStarted: false,
    executionStartDate: null,
    actualFinishedDate: null,
    toBeApprovedByManagement: false,
    submittedForApprovalAt: null,
    approvalDate: null,
    rejectionReason: null,
    remarks: '',
    budget: 0,
    actualSpend: 0,
    subtasks: [],
    comments: [],
    isOverdue: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

const opts = { todayDate: TODAY };

describe('Rule 1 — Execution Started', () => {
  it('stamps the start date when the box is first ticked', () => {
    const { task, logs } = applyAutomationRules(
      makeTask({ executionStarted: true }),
      makeTask({ executionStarted: false }),
      opts
    );
    expect(task.executionStartDate).toBe(TODAY);
    expect(logs.map((l) => l.action)).toContain('Execution Started');
  });

  it('does not move the date on subsequent saves', () => {
    const previous = makeTask({
      executionStarted: true,
      executionStartDate: '2026-07-02',
    });
    const { task, logs } = applyAutomationRules(
      { ...previous, taskName: 'Renamed' },
      previous,
      opts
    );
    expect(task.executionStartDate).toBe('2026-07-02');
    expect(logs.map((l) => l.action)).not.toContain('Execution Started');
  });

  it('does not stamp a date while the box is unticked', () => {
    const { task } = applyAutomationRules(makeTask(), undefined, opts);
    expect(task.executionStartDate).toBeNull();
  });

  it('prevents a non-admin from erasing a recorded start date', () => {
    const previous = makeTask({
      executionStarted: true,
      executionStartDate: '2026-07-02',
    });
    const { task } = applyAutomationRules(
      { ...previous, executionStarted: false },
      previous,
      { ...opts, role: 'Marketing Team' }
    );
    expect(task.executionStarted).toBe(true);
    expect(task.executionStartDate).toBe('2026-07-02');
  });

  it('lets an Admin untick it', () => {
    const previous = makeTask({
      executionStarted: true,
      executionStartDate: '2026-07-02',
    });
    const { task } = applyAutomationRules(
      { ...previous, executionStarted: false },
      previous,
      { ...opts, role: 'Admin' }
    );
    expect(task.executionStarted).toBe(false);
  });
});

describe('Rule 2 — Task Completed', () => {
  it('stamps the finish date when status becomes Completed', () => {
    const { task, logs, notifications } = applyAutomationRules(
      makeTask({ taskProgress: 'Completed' }),
      makeTask({ taskProgress: 'In Progress' }),
      opts
    );
    expect(task.actualFinishedDate).toBe(TODAY);
    expect(logs.map((l) => l.action)).toContain('Task Completed');
    expect(notifications.map((n) => n.type)).toContain('completed');
  });

  it('locks the finish date against a non-admin edit', () => {
    const previous = makeTask({
      taskProgress: 'Completed',
      actualFinishedDate: '2026-07-10',
    });
    const { task } = applyAutomationRules(
      { ...previous, actualFinishedDate: '2026-01-01' },
      previous,
      { ...opts, role: 'Marketing Team' }
    );
    expect(task.actualFinishedDate).toBe('2026-07-10');
  });

  it('lets an Admin change the finish date', () => {
    const previous = makeTask({
      taskProgress: 'Completed',
      actualFinishedDate: '2026-07-10',
    });
    const { task } = applyAutomationRules(
      { ...previous, actualFinishedDate: '2026-07-12' },
      previous,
      { ...opts, role: 'Admin' }
    );
    expect(task.actualFinishedDate).toBe('2026-07-12');
  });

  it('blocks a non-admin from reopening a completed task', () => {
    const previous = makeTask({
      taskProgress: 'Completed',
      actualFinishedDate: '2026-07-10',
    });
    const { task } = applyAutomationRules(
      { ...previous, taskProgress: 'In Progress' },
      previous,
      { ...opts, role: 'Marketing Team' }
    );
    expect(task.taskProgress).toBe('Completed');
    expect(task.actualFinishedDate).toBe('2026-07-10');
  });

  it('lets an Admin reopen a task and clears the finish date', () => {
    const previous = makeTask({
      taskProgress: 'Completed',
      actualFinishedDate: '2026-07-10',
    });
    const { task, logs } = applyAutomationRules(
      { ...previous, taskProgress: 'In Progress' },
      previous,
      { ...opts, role: 'Admin' }
    );
    expect(task.taskProgress).toBe('In Progress');
    expect(task.actualFinishedDate).toBeNull();
    expect(logs.map((l) => l.action)).toContain('Task Reopened');
  });

  it('clears a pending approval flag on completion', () => {
    const { task } = applyAutomationRules(
      makeTask({ taskProgress: 'Completed', toBeApprovedByManagement: true }),
      makeTask({ taskProgress: 'In Progress' }),
      opts
    );
    expect(task.toBeApprovedByManagement).toBe(false);
  });
});

describe('Rule 3 — Send for Management Approval', () => {
  it('moves the task to the approval status and records the timestamp', () => {
    const { task, logs, notifications } = applyAutomationRules(
      makeTask({ toBeApprovedByManagement: true, taskProgress: 'In Progress' }),
      makeTask({ taskProgress: 'In Progress' }),
      opts
    );
    expect(task.taskProgress).toBe('To Be Approved by Management');
    // The brief requires the submission timestamp; it was never recorded before.
    expect(task.submittedForApprovalAt).toBeTruthy();
    expect(new Date(task.submittedForApprovalAt!).getTime()).toBeGreaterThan(0);
    expect(logs.map((l) => l.action)).toContain('Sent For Management Approval');
    expect(notifications.map((n) => n.type)).toContain('approval_request');
  });

  it('treats picking the status directly as a submission', () => {
    const { task, notifications } = applyAutomationRules(
      makeTask({ taskProgress: 'To Be Approved by Management' }),
      makeTask({ taskProgress: 'In Progress' }),
      opts
    );
    expect(task.toBeApprovedByManagement).toBe(true);
    expect(task.submittedForApprovalAt).toBeTruthy();
    expect(notifications.map((n) => n.type)).toContain('approval_request');
  });

  it('does not re-notify on an unrelated save while awaiting approval', () => {
    const previous = makeTask({
      taskProgress: 'To Be Approved by Management',
      toBeApprovedByManagement: true,
      submittedForApprovalAt: '2026-07-28T10:00:00.000Z',
    });
    const { task, notifications } = applyAutomationRules(
      { ...previous, remarks: 'Adding a note' },
      previous,
      opts
    );
    expect(task.submittedForApprovalAt).toBe('2026-07-28T10:00:00.000Z');
    expect(notifications).toHaveLength(0);
  });

  it('does not send an already-completed task for approval', () => {
    const { task } = applyAutomationRules(
      makeTask({ taskProgress: 'Completed', toBeApprovedByManagement: true }),
      makeTask({ taskProgress: 'Completed', actualFinishedDate: '2026-07-01' }),
      opts
    );
    expect(task.taskProgress).toBe('Completed');
  });
});

describe('Rule 4 — Management approval', () => {
  const awaiting = makeTask({
    taskProgress: 'To Be Approved by Management',
    toBeApprovedByManagement: true,
    submittedForApprovalAt: '2026-07-28T10:00:00.000Z',
  });

  it('approving completes the task and stamps the approval date', () => {
    const { task, logs, notifications } = applyManagementDecision(
      awaiting,
      'approve',
      { todayDate: TODAY, decidedBy: 'Neha (Management)' }
    );
    expect(task.taskProgress).toBe('Completed');
    expect(task.approvalDate).toBe(TODAY);
    expect(task.actualFinishedDate).toBe(TODAY);
    expect(task.toBeApprovedByManagement).toBe(false);
    expect(logs.map((l) => l.action)).toContain('Approval Granted');
    expect(notifications.map((n) => n.type)).toContain('approval_granted');
  });

  it('backfills the execution start date if it was never set', () => {
    const { task } = applyManagementDecision(awaiting, 'approve', {
      todayDate: TODAY,
    });
    expect(task.executionStartDate).toBe(TODAY);
    expect(task.executionStarted).toBe(true);
  });

  it('preserves an existing execution start date', () => {
    const { task } = applyManagementDecision(
      { ...awaiting, executionStarted: true, executionStartDate: '2026-07-05' },
      'approve',
      { todayDate: TODAY }
    );
    expect(task.executionStartDate).toBe('2026-07-05');
  });

  it('clears the overdue flag on approval', () => {
    const { task } = applyManagementDecision(
      { ...awaiting, deadline: '2026-07-01', isOverdue: true },
      'approve',
      { todayDate: TODAY }
    );
    expect(task.isOverdue).toBe(false);
  });

  it('rejecting returns the task to In Progress with the comment', () => {
    const { task, logs, notifications } = applyManagementDecision(
      awaiting,
      'reject',
      { comment: 'Colour grade is too warm.', todayDate: TODAY }
    );
    expect(task.taskProgress).toBe('In Progress');
    expect(task.rejectionReason).toBe('Colour grade is too warm.');
    expect(task.approvalDate).toBeNull();
    expect(task.submittedForApprovalAt).toBeNull();
    expect(logs.map((l) => l.action)).toContain('Approval Rejected');
    expect(notifications.map((n) => n.type)).toContain('approval_rejected');
  });

  it('notifies the assignee by name on rejection', () => {
    const { notifications } = applyManagementDecision(awaiting, 'reject', {
      comment: 'Needs work',
      todayDate: TODAY,
    });
    expect(notifications[0].message).toContain('Aarav Sharma');
  });

  it('records a placeholder when no reason is given', () => {
    const { task } = applyManagementDecision(awaiting, 'reject', {
      todayDate: TODAY,
    });
    expect(task.rejectionReason).toBe('No reason provided');
  });

  it('re-flags overdue when a rejected task is already past its deadline', () => {
    const { task } = applyManagementDecision(
      { ...awaiting, deadline: '2026-07-01' },
      'reject',
      { comment: 'Redo', todayDate: TODAY }
    );
    expect(task.isOverdue).toBe(true);
  });

  it('clears a prior rejection reason when later approved', () => {
    const { task } = applyManagementDecision(
      { ...awaiting, rejectionReason: 'Earlier complaint' },
      'approve',
      { todayDate: TODAY }
    );
    expect(task.rejectionReason).toBeNull();
  });
});

describe('Rule 5 — Overdue', () => {
  it('flags a task past its deadline and notifies once', () => {
    const { task, logs, notifications } = applyAutomationRules(
      makeTask({ deadline: '2026-07-29', taskProgress: 'In Progress' }),
      makeTask({ deadline: '2026-07-29', taskProgress: 'In Progress' }),
      opts
    );
    expect(task.isOverdue).toBe(true);
    expect(logs.map((l) => l.action)).toContain('Marked Overdue');
    expect(notifications.map((n) => n.type)).toContain('overdue');
  });

  it('does not re-notify on later saves of an already-overdue task', () => {
    const previous = makeTask({ deadline: '2026-07-29', isOverdue: true });
    const { notifications } = applyAutomationRules(
      { ...previous, remarks: 'chasing the vendor' },
      previous,
      opts
    );
    expect(notifications.map((n) => n.type)).not.toContain('overdue');
  });

  it('does not flag a task due today', () => {
    const { task } = applyAutomationRules(
      makeTask({ deadline: TODAY }),
      undefined,
      opts
    );
    expect(task.isOverdue).toBe(false);
  });

  it('clears the flag once the task is completed', () => {
    const previous = makeTask({ deadline: '2026-07-01', isOverdue: true });
    const { task } = applyAutomationRules(
      { ...previous, taskProgress: 'Completed' },
      previous,
      opts
    );
    expect(task.isOverdue).toBe(false);
  });

  it('clears the flag when the deadline is pushed out', () => {
    const previous = makeTask({ deadline: '2026-07-01', isOverdue: true });
    const { task } = applyAutomationRules(
      { ...previous, deadline: '2026-09-01' },
      previous,
      opts
    );
    expect(task.isOverdue).toBe(false);
  });

  it('ignores a task with no deadline', () => {
    const { task } = applyAutomationRules(
      makeTask({ deadline: '' }),
      undefined,
      opts
    );
    expect(task.isOverdue).toBe(false);
  });
});

describe('Deadline-tomorrow notification', () => {
  it('fires the day before the deadline', () => {
    // The brief asks for this; the previous implementation never sent it.
    const { notifications } = applyAutomationRules(
      makeTask({ deadline: '2026-07-31' }),
      makeTask({ deadline: '2026-07-31' }),
      opts
    );
    expect(notifications.map((n) => n.type)).toContain('deadline');
  });

  it('does not fire two days out, or for completed tasks', () => {
    expect(
      applyAutomationRules(makeTask({ deadline: '2026-08-01' }), undefined, opts)
        .notifications.map((n) => n.type)
    ).not.toContain('deadline');

    expect(
      applyAutomationRules(
        makeTask({ deadline: '2026-07-31', taskProgress: 'Completed' }),
        undefined,
        opts
      ).notifications.map((n) => n.type)
    ).not.toContain('deadline');
  });
});

describe('rule interactions', () => {
  it('a brand-new completed task gets both dates in one pass', () => {
    const { task } = applyAutomationRules(
      makeTask({ taskProgress: 'Completed', executionStarted: true }),
      undefined,
      opts
    );
    expect(task.executionStartDate).toBe(TODAY);
    expect(task.actualFinishedDate).toBe(TODAY);
    expect(task.isOverdue).toBe(false);
  });

  it('an overdue task sent for approval reports both', () => {
    const { task, notifications } = applyAutomationRules(
      makeTask({
        deadline: '2026-07-20',
        toBeApprovedByManagement: true,
        taskProgress: 'In Progress',
      }),
      makeTask({ deadline: '2026-07-20', taskProgress: 'In Progress' }),
      opts
    );
    expect(task.taskProgress).toBe('To Be Approved by Management');
    expect(task.isOverdue).toBe(true);
    const types = notifications.map((n) => n.type);
    expect(types).toContain('approval_request');
    expect(types).toContain('overdue');
  });

  it('the full submit -> approve cycle leaves a consistent task', () => {
    const submitted = applyAutomationRules(
      makeTask({ executionStarted: true, toBeApprovedByManagement: true }),
      makeTask(),
      opts
    ).task;

    const approved = applyManagementDecision(submitted, 'approve', {
      todayDate: TODAY,
      decidedBy: 'Management',
    }).task;

    expect(approved.taskProgress).toBe('Completed');
    expect(approved.executionStartDate).toBe(TODAY);
    expect(approved.actualFinishedDate).toBe(TODAY);
    expect(approved.approvalDate).toBe(TODAY);
    expect(approved.toBeApprovedByManagement).toBe(false);
    expect(approved.isOverdue).toBe(false);
  });

  it('the submit -> reject -> resubmit cycle issues a fresh timestamp', () => {
    // Fake timers so the two submissions land on distinguishable instants;
    // without this the whole cycle completes inside a single millisecond.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T10:00:00.000Z'));

    const submitted = applyAutomationRules(
      makeTask({ toBeApprovedByManagement: true }),
      makeTask(),
      opts
    ).task;
    const firstSubmission = submitted.submittedForApprovalAt;
    expect(firstSubmission).toBe('2026-07-28T10:00:00.000Z');

    const rejected = applyManagementDecision(submitted, 'reject', {
      comment: 'Fix the copy',
      todayDate: TODAY,
    }).task;
    expect(rejected.submittedForApprovalAt).toBeNull();

    vi.setSystemTime(new Date('2026-07-29T14:00:00.000Z'));

    const resubmitted = applyAutomationRules(
      { ...rejected, toBeApprovedByManagement: true },
      rejected,
      opts
    ).task;
    expect(resubmitted.submittedForApprovalAt).toBe('2026-07-29T14:00:00.000Z');
    expect(resubmitted.submittedForApprovalAt).not.toBe(firstSubmission);
    // The rejection note is kept so the assignee can still see the feedback.
    expect(resubmitted.rejectionReason).toBe('Fix the copy');

    vi.useRealTimers();
  });

  it('always advances updatedAt so concurrency checks stay meaningful', () => {
    const previous = makeTask();
    const { task } = applyAutomationRules(previous, previous, opts);
    expect(task.updatedAt).not.toBe(previous.updatedAt);
  });
});

describe('refreshDerivedFlags', () => {
  it('flips a task to overdue when the day rolls over', () => {
    // This is what makes an open browser tab notice a passed deadline; the
    // previous build only recomputed on reload.
    const task = makeTask({ deadline: '2026-07-30', isOverdue: false });
    const sameDay = refreshDerivedFlags(task, '2026-07-30');
    expect(sameDay.changed).toBe(false);

    const nextDay = refreshDerivedFlags(task, '2026-07-31');
    expect(nextDay.changed).toBe(true);
    expect(nextDay.task.isOverdue).toBe(true);
  });

  it('reports no change when nothing moved', () => {
    const task = makeTask({ deadline: '2026-07-01', isOverdue: true });
    expect(refreshDerivedFlags(task, TODAY).changed).toBe(false);
  });

  it('does not mutate the input', () => {
    const task = makeTask({ deadline: '2026-07-01', isOverdue: false });
    refreshDerivedFlags(task, TODAY);
    expect(task.isOverdue).toBe(false);
  });
});
