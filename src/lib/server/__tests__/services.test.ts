/**
 * Service-layer tests: the write paths the API routes delegate to.
 *
 * These verify the parts that sit between HTTP and the spreadsheet — payload
 * filtering, server-authoritative automation, audit-log attribution, and the
 * master-data in-use rule — against a fake spreadsheet.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { SheetRepository } from '../repository';
import { createHealthyTransport, type FakeSheetsTransport } from './fakeTransport';
import {
  createTask,
  decideTask,
  deleteTask,
  updateTask,
} from '../taskService';
import {
  createMasterItem,
  removeMasterItem,
  updateMasterItem,
} from '../masterService';
import type { Actor } from '../apiHelpers';
import { ValidationError } from '@/lib/validation';
import { today } from '@/lib/dates';

const ADMIN: Actor = {
  email: 'sid@company.com',
  name: 'Sid (Admin)',
  role: 'Admin',
};
const MARKETER: Actor = {
  email: 'aarav@company.com',
  name: 'Aarav Sharma',
  role: 'Marketing Team',
};
const MANAGER: Actor = {
  email: 'neha@company.com',
  name: 'Neha Iyer',
  role: 'Management',
};

function validTaskBody(overrides: Record<string, unknown> = {}) {
  return {
    project: 'Q3 Brand Awareness',
    taskName: 'Launch teaser film',
    taskBrief: 'Cut a 30s teaser.',
    department: 'Brand & Creative',
    internalPoc: 'Aarav Sharma',
    deadline: '2026-12-15',
    priority: 'High',
    budget: 120000,
    actualSpend: 0,
    ...overrides,
  };
}

describe('taskService', () => {
  let transport: FakeSheetsTransport;
  let repo: SheetRepository;

  beforeEach(() => {
    transport = createHealthyTransport();
    repo = new SheetRepository(transport);
  });

  describe('createTask', () => {
    it('persists a task and writes a creation audit row', async () => {
      const { task } = await createTask(repo, validTaskBody(), MARKETER);

      expect(task.id).toMatch(/^TSK-/);
      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks).toHaveLength(1);
      expect(snapshot.tasks[0].taskName).toBe('Launch teaser film');

      const log = snapshot.activityLogs.find((l) => l.action === 'Task Created');
      expect(log).toBeDefined();
      // Attributed to the actual actor, not a hardcoded string.
      expect(log!.user).toBe('Aarav Sharma');
      expect(log!.role).toBe('Marketing Team');
      expect(log!.target).toBe(task.id);
    });

    it('generates unique ids so a delete cannot cause a collision', async () => {
      const a = await createTask(repo, validTaskBody(), ADMIN);
      await deleteTask(repo, a.task.id, ADMIN);
      const b = await createTask(repo, validTaskBody(), ADMIN);
      const c = await createTask(repo, validTaskBody(), ADMIN);

      expect(new Set([a.task.id, b.task.id, c.task.id]).size).toBe(3);
    });

    it('ignores client-supplied server-managed fields', async () => {
      // A client must not be able to backdate a completion or forge an approval.
      const { task } = await createTask(
        repo,
        validTaskBody({
          id: 'TSK-forged',
          approvalDate: '2020-01-01',
          actualFinishedDate: '2020-01-01',
          executionStartDate: '2020-01-01',
          deletedAt: '2020-01-01',
          createdAt: '1999-01-01T00:00:00.000Z',
        }),
        MARKETER
      );

      expect(task.id).not.toBe('TSK-forged');
      expect(task.approvalDate).toBeNull();
      expect(task.actualFinishedDate).toBeNull();
      expect(task.executionStartDate).toBeNull();
      expect(task.deletedAt).toBeNull();
      expect(task.createdAt).not.toBe('1999-01-01T00:00:00.000Z');
    });

    it('applies rule 1 on creation when execution is already ticked', async () => {
      const { task } = await createTask(
        repo,
        validTaskBody({ executionStarted: true }),
        MARKETER
      );
      expect(task.executionStartDate).toBe(today());
    });

    it('rejects an invalid payload before writing anything', async () => {
      await expect(
        createTask(repo, { taskName: '', project: '' }, MARKETER)
      ).rejects.toBeInstanceOf(ValidationError);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks).toHaveLength(0);
      expect(snapshot.activityLogs).toHaveLength(0);
    });

    it('coerces a money value sent as a string', async () => {
      const { task } = await createTask(
        repo,
        validTaskBody({ budget: '250000', actualSpend: '' }),
        ADMIN
      );
      expect(task.budget).toBe(250000);
      expect(task.actualSpend).toBe(0);
    });

    it('rejects a negative budget', async () => {
      await expect(
        createTask(repo, validTaskBody({ budget: -5 }), ADMIN)
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('trims whitespace from text fields', async () => {
      const { task } = await createTask(
        repo,
        validTaskBody({ taskName: '  Padded name  ' }),
        ADMIN
      );
      expect(task.taskName).toBe('Padded name');
    });
  });

  describe('updateTask', () => {
    it('saves an edit and records an audit row', async () => {
      const created = await createTask(repo, validTaskBody(), MARKETER);
      const { task } = await updateTask(
        repo,
        created.task.id,
        { taskName: 'Renamed film', expectedUpdatedAt: created.task.updatedAt },
        MARKETER
      );

      expect(task.taskName).toBe('Renamed film');
      const snapshot = await repo.readSnapshot();
      expect(
        snapshot.activityLogs.some((l) => l.action === 'Task Updated')
      ).toBe(true);
    });

    it('records every automation log entry, not just the last one', async () => {
      // Regression: the old client-side addLog read stale state inside a loop,
      // so a change that triggered several rules persisted only one entry.
      const created = await createTask(
        repo,
        validTaskBody({ deadline: '2020-01-01' }),
        MARKETER
      );

      await updateTask(
        repo,
        created.task.id,
        {
          executionStarted: true,
          toBeApprovedByManagement: true,
          expectedUpdatedAt: created.task.updatedAt,
        },
        MARKETER
      );

      const snapshot = await repo.readSnapshot();
      const actions = snapshot.activityLogs.map((l) => l.action);
      expect(actions).toContain('Execution Started');
      expect(actions).toContain('Sent For Management Approval');
    });

    it('applies rule 3 and stamps the submission timestamp', async () => {
      const created = await createTask(repo, validTaskBody(), MARKETER);
      const { task } = await updateTask(
        repo,
        created.task.id,
        {
          toBeApprovedByManagement: true,
          expectedUpdatedAt: created.task.updatedAt,
        },
        MARKETER
      );

      expect(task.taskProgress).toBe('To Be Approved by Management');
      expect(task.submittedForApprovalAt).toBeTruthy();
    });

    it('locks the completion date against a non-admin', async () => {
      const created = await createTask(repo, validTaskBody(), MARKETER);
      const completed = await updateTask(
        repo,
        created.task.id,
        { taskProgress: 'Completed', expectedUpdatedAt: created.task.updatedAt },
        MARKETER
      );
      const originalFinish = completed.task.actualFinishedDate;
      expect(originalFinish).toBe(today());

      // A marketer tries to reopen it.
      const attempted = await updateTask(
        repo,
        created.task.id,
        {
          taskProgress: 'In Progress',
          expectedUpdatedAt: completed.task.updatedAt,
        },
        MARKETER
      );
      expect(attempted.task.taskProgress).toBe('Completed');
      expect(attempted.task.actualFinishedDate).toBe(originalFinish);
    });

    it('lets an Admin reopen a completed task', async () => {
      const created = await createTask(repo, validTaskBody(), ADMIN);
      const completed = await updateTask(
        repo,
        created.task.id,
        { taskProgress: 'Completed', expectedUpdatedAt: created.task.updatedAt },
        ADMIN
      );

      const reopened = await updateTask(
        repo,
        created.task.id,
        {
          taskProgress: 'In Progress',
          expectedUpdatedAt: completed.task.updatedAt,
        },
        ADMIN
      );
      expect(reopened.task.taskProgress).toBe('In Progress');
      expect(reopened.task.actualFinishedDate).toBeNull();
    });

    it('preserves fields the client did not send', async () => {
      const created = await createTask(
        repo,
        validTaskBody({ remarks: 'Keep me', budget: 99000 }),
        ADMIN
      );

      const { task } = await updateTask(
        repo,
        created.task.id,
        { taskName: 'Only the name changed', expectedUpdatedAt: created.task.updatedAt },
        ADMIN
      );

      expect(task.remarks).toBe('Keep me');
      expect(task.budget).toBe(99000);
    });
  });

  describe('decideTask', () => {
    async function submitForApproval() {
      const created = await createTask(repo, validTaskBody(), MARKETER);
      const submitted = await updateTask(
        repo,
        created.task.id,
        {
          toBeApprovedByManagement: true,
          expectedUpdatedAt: created.task.updatedAt,
        },
        MARKETER
      );
      return submitted.task;
    }

    it('approving completes the task and logs the approver', async () => {
      const pending = await submitForApproval();
      const { task } = await decideTask(
        repo,
        pending.id,
        'approve',
        undefined,
        MANAGER
      );

      expect(task.taskProgress).toBe('Completed');
      expect(task.approvalDate).toBe(today());
      expect(task.executionStartDate).toBe(today());

      const snapshot = await repo.readSnapshot();
      const log = snapshot.activityLogs.find(
        (l) => l.action === 'Approval Granted'
      );
      expect(log?.user).toBe('Neha Iyer');
      expect(log?.newValue).toContain('Neha Iyer');
    });

    it('rejecting returns the task to In Progress with the comment', async () => {
      const pending = await submitForApproval();
      const { task } = await decideTask(
        repo,
        pending.id,
        'reject',
        'Colour grade is too warm.',
        MANAGER
      );

      expect(task.taskProgress).toBe('In Progress');
      expect(task.rejectionReason).toBe('Colour grade is too warm.');

      const snapshot = await repo.readSnapshot();
      expect(
        snapshot.activityLogs.some((l) => l.action === 'Approval Rejected')
      ).toBe(true);
    });

    it('the decision is persisted, not just returned', async () => {
      const pending = await submitForApproval();
      await decideTask(repo, pending.id, 'approve', undefined, MANAGER);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks[0].taskProgress).toBe('Completed');
      expect(snapshot.tasks[0].approvalDate).toBe(today());
    });
  });

  describe('deleteTask', () => {
    it('archives the task and logs it', async () => {
      const created = await createTask(repo, validTaskBody(), ADMIN);
      await deleteTask(repo, created.task.id, ADMIN);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks).toHaveLength(0);
      expect(
        snapshot.activityLogs.some((l) => l.action === 'Task Deleted')
      ).toBe(true);
    });
  });
});

describe('masterService', () => {
  let transport: FakeSheetsTransport;
  let repo: SheetRepository;

  beforeEach(() => {
    transport = createHealthyTransport();
    repo = new SheetRepository(transport);
  });

  it('adds an item and logs it', async () => {
    const item = await createMasterItem(
      repo,
      { category: 'Vendors', name: 'PrintCraft Solutions' },
      ADMIN
    );

    expect(item.status).toBe('Active');
    const snapshot = await repo.readSnapshot();
    expect(snapshot.masterItems).toHaveLength(1);
    expect(
      snapshot.activityLogs.some((l) => l.action === 'Vendors Added')
    ).toBe(true);
  });

  it('rejects a case-insensitive duplicate name', async () => {
    await createMasterItem(repo, { category: 'Vendors', name: 'PrintCraft' }, ADMIN);

    await expect(
      createMasterItem(repo, { category: 'Vendors', name: '  printcraft  ' }, ADMIN)
    ).rejects.toBeInstanceOf(ValidationError);

    // Same name in a different category is fine.
    await expect(
      createMasterItem(repo, { category: 'Agencies', name: 'PrintCraft' }, ADMIN)
    ).resolves.toBeDefined();
  });

  it('rejects an unknown category', async () => {
    await expect(
      createMasterItem(repo, { category: 'Robots', name: 'X' }, ADMIN)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('cascades a rename to every referencing task', async () => {
    const project = await createMasterItem(
      repo,
      { category: 'Projects', name: 'Old Campaign' },
      ADMIN
    );
    await createTask(repo, validTaskBody({ project: 'Old Campaign' }), ADMIN);
    await createTask(repo, validTaskBody({ project: 'Old Campaign' }), ADMIN);
    await createTask(repo, validTaskBody({ project: 'Untouched' }), ADMIN);

    const result = await updateMasterItem(
      repo,
      'Projects',
      project.id,
      { name: 'New Campaign', expectedUpdatedAt: project.updatedAt },
      ADMIN
    );

    expect(result.tasksUpdated).toBe(2);

    const snapshot = await repo.readSnapshot();
    const projects = snapshot.tasks.map((t) => t.project).sort();
    expect(projects).toEqual(['New Campaign', 'New Campaign', 'Untouched']);

    const log = snapshot.activityLogs.find(
      (l) => l.action === 'Projects Renamed'
    );
    expect(log?.oldValue).toBe('Old Campaign');
    expect(log?.newValue).toContain('2 task(s) updated');
  });

  it('deactivates an in-use item instead of removing it', async () => {
    const vendor = await createMasterItem(
      repo,
      { category: 'Vendors', name: 'PrintCraft' },
      ADMIN
    );
    await createTask(repo, validTaskBody({ vendor: 'PrintCraft' }), ADMIN);

    const outcome = await removeMasterItem(repo, 'Vendors', vendor.id, ADMIN);

    expect(outcome.action).toBe('deactivated');
    expect(outcome.referenceCount).toBe(1);
    expect(outcome.item?.status).toBe('Inactive');

    // Still present for historical tasks, but no longer offered for new ones.
    const snapshot = await repo.readSnapshot();
    const stored = snapshot.masterItems.find((m) => m.id === vendor.id);
    expect(stored?.status).toBe('Inactive');
    expect(snapshot.tasks[0].vendor).toBe('PrintCraft');
  });

  it('archives an unused item outright', async () => {
    const vendor = await createMasterItem(
      repo,
      { category: 'Vendors', name: 'Unused Vendor' },
      ADMIN
    );

    const outcome = await removeMasterItem(repo, 'Vendors', vendor.id, ADMIN);

    expect(outcome.action).toBe('archived');
    expect(outcome.referenceCount).toBe(0);

    const snapshot = await repo.readSnapshot();
    expect(snapshot.masterItems).toHaveLength(0);
    expect(
      snapshot.activityLogs.some((l) => l.action === 'Vendors Removed')
    ).toBe(true);
  });

  it('does not count an archived task as a reference', async () => {
    const vendor = await createMasterItem(
      repo,
      { category: 'Vendors', name: 'PrintCraft' },
      ADMIN
    );
    const task = await createTask(
      repo,
      validTaskBody({ vendor: 'PrintCraft' }),
      ADMIN
    );
    await deleteTask(repo, task.task.id, ADMIN);

    const outcome = await removeMasterItem(repo, 'Vendors', vendor.id, ADMIN);
    // The only referencing task was archived, so removal is safe.
    expect(outcome.action).toBe('archived');
  });

  it('logs a status change on manual deactivation', async () => {
    const item = await createMasterItem(
      repo,
      { category: 'Departments', name: 'Events' },
      ADMIN
    );

    await updateMasterItem(
      repo,
      'Departments',
      item.id,
      { status: 'Inactive', expectedUpdatedAt: item.updatedAt },
      ADMIN
    );

    const snapshot = await repo.readSnapshot();
    const log = snapshot.activityLogs.find(
      (l) => l.action === 'Departments Status Changed'
    );
    expect(log?.oldValue).toBe('Active');
    expect(log?.newValue).toBe('Inactive');
  });
});
