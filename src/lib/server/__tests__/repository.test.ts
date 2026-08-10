/**
 * Repository tests.
 *
 * These target the failure modes the previous implementation actually had:
 * whole-sheet rewrites destroying hand-edits, concurrent saves silently losing
 * one another, and deletes shifting row indices under a concurrent update.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  ConflictError,
  NotFoundError,
  SheetRepository,
} from '../repository';
import {
  createHealthyTransport,
  FakeSheetsTransport,
} from './fakeTransport';
import {
  MASTER_COLUMNS,
  SHEET_NAMES,
  TASK_COLUMNS,
  taskToRow,
} from '@/lib/sheets/schema';
import type { MasterItem, Task } from '@/types/dashboard';

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
    taskProgress: 'In Progress',
    deadline: '2026-08-15',
    executionStarted: true,
    executionStartDate: '2026-07-20',
    actualFinishedDate: null,
    toBeApprovedByManagement: false,
    submittedForApprovalAt: null,
    approvalDate: null,
    rejectionReason: null,
    remarks: '',
    budget: 120000,
    actualSpend: 45000,
    boqLink: null,
    reportLink: null,
    approver: '',
    subtasks: [],
    comments: [],
    attachments: [],
    isOverdue: false,
    createdAt: '2026-07-18T06:00:00.000Z',
    updatedAt: '2026-07-20T06:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function makeMasterItem(overrides: Partial<MasterItem> = {}): MasterItem {
  return {
    id: 'proj-1',
    name: 'Q3 Brand Awareness',
    category: 'Projects',
    status: 'Active',
    description: 'National digital campaign',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('SheetRepository', () => {
  let transport: FakeSheetsTransport;
  let repo: SheetRepository;

  beforeEach(() => {
    transport = createHealthyTransport();
    repo = new SheetRepository(transport);
  });

  describe('readSnapshot', () => {
    it('returns an empty snapshot for a freshly initialised spreadsheet', async () => {
      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks).toEqual([]);
      expect(snapshot.masterItems).toEqual([]);
      expect(snapshot.activityLogs).toEqual([]);
      expect(snapshot.revision).toBeTruthy();
    });

    it('reads all entities in a single batched round trip', async () => {
      transport.resetCallCounts();
      await repo.readSnapshot();
      // One batchGet covering tasks + 5 master tabs + activity log.
      expect(transport.calls.batchGet).toBe(1);
    });

    it('round-trips a task without losing any field', async () => {
      const task = makeTask({
        subtasks: [{ id: 'st-1', title: 'Storyboard', completed: true }],
        comments: [
          {
            id: 'c-1',
            author: 'Aarav Sharma',
            role: 'Marketing Team',
            text: 'First cut is ready.',
            timestamp: '2026-07-21T09:00:00.000Z',
          },
        ],
      });
      await repo.createTask(task);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks).toHaveLength(1);
      expect(snapshot.tasks[0]).toEqual(task);
    });

    it('persists budget and actual spend', async () => {
      // Regression: these were UI-only before and were lost on every sync.
      await repo.createTask(makeTask({ budget: 250000, actualSpend: 99000 }));
      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks[0].budget).toBe(250000);
      expect(snapshot.tasks[0].actualSpend).toBe(99000);
    });

    it('excludes tombstoned tasks', async () => {
      await repo.createTask(makeTask({ id: 'TSK-1' }));
      await repo.createTask(makeTask({ id: 'TSK-2' }));
      await repo.deleteTask('TSK-1');

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks.map((t) => t.id)).toEqual(['TSK-2']);
    });

    it('tolerates a human typing loose values into the sheet', async () => {
      // Someone edits directly in Sheets: lowercase status, "yes" for a
      // boolean, a rupee-formatted budget, and an unknown priority.
      transport.seedSheet('Scratch', ['x']);
      await repo.createTask(makeTask());

      const priorityCol = TASK_COLUMNS.indexOf('Priority');
      const startedCol = TASK_COLUMNS.indexOf('Execution Started');
      const budgetCol = TASK_COLUMNS.indexOf('Budget');
      const progressCol = TASK_COLUMNS.indexOf('Task Progress');

      transport.setCell(SHEET_NAMES.TASKS, 2, priorityCol, 'Nonsense');
      transport.setCell(SHEET_NAMES.TASKS, 2, startedCol, 'yes');
      transport.setCell(SHEET_NAMES.TASKS, 2, budgetCol, '₹1,20,000');
      transport.setCell(SHEET_NAMES.TASKS, 2, progressCol, 'in progress');

      const snapshot = await repo.readSnapshot();
      const task = snapshot.tasks[0];
      expect(task.priority).toBe('Medium'); // falls back, does not crash
      expect(task.executionStarted).toBe(true);
      expect(task.budget).toBe(120000);
      expect(task.taskProgress).toBe('In Progress'); // case-insensitive match
    });

    it('recovers an empty list from malformed subtask JSON', async () => {
      await repo.createTask(makeTask());
      const subtasksCol = TASK_COLUMNS.indexOf('Subtasks');
      transport.setCell(SHEET_NAMES.TASKS, 2, subtasksCol, '{not json');

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks[0].subtasks).toEqual([]);
    });

    it('skips rows with no id, so a stray note in the sheet is ignored', async () => {
      await repo.createTask(makeTask());
      const sheet = transport.getDataRows(SHEET_NAMES.TASKS);
      expect(sheet).toHaveLength(1);

      // A person types a comment two rows below the data.
      transport.setCell(SHEET_NAMES.TASKS, 4, 1, 'remember to check with legal');

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks).toHaveLength(1);
    });

    it('changes revision when content changes and holds it steady otherwise', async () => {
      await repo.createTask(makeTask());
      const first = await repo.readSnapshot();
      const second = await repo.readSnapshot();
      expect(second.revision).toBe(first.revision);

      await repo.updateTask(
        { ...first.tasks[0], taskName: 'Renamed' },
        first.tasks[0].updatedAt
      );
      const third = await repo.readSnapshot();
      expect(third.revision).not.toBe(first.revision);
    });
  });

  describe('createTask', () => {
    it('appends rather than rewriting the table', async () => {
      await repo.createTask(makeTask({ id: 'TSK-1' }));
      transport.resetCallCounts();
      await repo.createTask(makeTask({ id: 'TSK-2' }));

      expect(transport.calls.append).toBe(1);
      // Critically: no bulk write. The old implementation cleared and rewrote
      // every row on each save.
      expect(transport.calls.batchUpdate).toBe(0);
    });

    it('keeps both records when two creates interleave', async () => {
      await Promise.all([
        repo.createTask(makeTask({ id: 'TSK-A' })),
        repo.createTask(makeTask({ id: 'TSK-B' })),
      ]);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks.map((t) => t.id).sort()).toEqual(['TSK-A', 'TSK-B']);
    });
  });

  describe('updateTask', () => {
    it('writes exactly one row range', async () => {
      await repo.createTask(makeTask({ id: 'TSK-1' }));
      await repo.createTask(makeTask({ id: 'TSK-2' }));
      const snapshot = await repo.readSnapshot();
      const target = snapshot.tasks.find((t) => t.id === 'TSK-2')!;

      transport.resetCallCounts();
      await repo.updateTask({ ...target, taskName: 'Updated' }, target.updatedAt);

      expect(transport.calls.batchUpdate).toBe(1);
      expect(transport.writtenRanges).toHaveLength(1);
      // TSK-2 is the second data row, i.e. sheet row 3.
      expect(transport.writtenRanges[0]).toContain('A3:');
    });

    it('advances updatedAt on every write', async () => {
      const task = makeTask();
      await repo.createTask(task);

      const saved = await repo.updateTask(
        { ...task, taskName: 'Changed' },
        task.updatedAt
      );
      expect(saved.updatedAt).not.toBe(task.updatedAt);
      expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(0);
    });

    it('rejects a stale write instead of clobbering a newer one', async () => {
      const task = makeTask();
      await repo.createTask(task);

      // User A saves.
      const afterA = await repo.updateTask(
        { ...task, taskName: 'A wins' },
        task.updatedAt
      );

      // User B, still holding the original version, tries to save.
      await expect(
        repo.updateTask({ ...task, taskName: 'B overwrites' }, task.updatedAt)
      ).rejects.toBeInstanceOf(ConflictError);

      // A's edit survived.
      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks[0].taskName).toBe('A wins');
      expect(snapshot.tasks[0].updatedAt).toBe(afterA.updatedAt);
    });

    it('surfaces the current record on conflict so the client can merge', async () => {
      const task = makeTask();
      await repo.createTask(task);
      await repo.updateTask({ ...task, taskName: 'Newer' }, task.updatedAt);

      try {
        await repo.updateTask({ ...task, taskName: 'Stale' }, task.updatedAt);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        const conflict = err as ConflictError;
        expect((conflict.current as Task).taskName).toBe('Newer');
      }
    });

    it('detects a writer that lands inside the read-verify-write window', async () => {
      const task = makeTask();
      await repo.createTask(task);
      const updatedAtCol = TASK_COLUMNS.indexOf('Updated At');

      // Simulate another process writing immediately after our row write, which
      // optimistic concurrency alone would not catch.
      transport.onAfterBatchUpdate = () => {
        transport.onAfterBatchUpdate = null;
        transport.setCell(
          SHEET_NAMES.TASKS,
          2,
          updatedAtCol,
          '2099-01-01T00:00:00.000Z'
        );
      };

      await expect(
        repo.updateTask({ ...task, taskName: 'Mine' }, task.updatedAt)
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('forces the write when no expected version is supplied', async () => {
      const task = makeTask();
      await repo.createTask(task);
      await repo.updateTask({ ...task, taskName: 'First' }, task.updatedAt);

      // Admin repair path: no version check.
      const forced = await repo.updateTask({ ...task, taskName: 'Forced' });
      expect(forced.taskName).toBe('Forced');
    });

    it('throws NotFoundError for an unknown id', async () => {
      await expect(
        repo.updateTask(makeTask({ id: 'TSK-missing' }), 'whenever')
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws NotFoundError for a tombstoned task', async () => {
      const task = makeTask();
      await repo.createTask(task);
      await repo.deleteTask(task.id);

      await expect(
        repo.updateTask({ ...task, taskName: 'Zombie' })
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('leaves neighbouring rows untouched', async () => {
      await repo.createTask(makeTask({ id: 'TSK-1', taskName: 'One' }));
      await repo.createTask(makeTask({ id: 'TSK-2', taskName: 'Two' }));
      await repo.createTask(makeTask({ id: 'TSK-3', taskName: 'Three' }));

      const before = await repo.readSnapshot();
      const middle = before.tasks.find((t) => t.id === 'TSK-2')!;
      await repo.updateTask({ ...middle, taskName: 'Two edited' }, middle.updatedAt);

      const after = await repo.readSnapshot();
      expect(after.tasks.find((t) => t.id === 'TSK-1')).toEqual(
        before.tasks.find((t) => t.id === 'TSK-1')
      );
      expect(after.tasks.find((t) => t.id === 'TSK-3')).toEqual(
        before.tasks.find((t) => t.id === 'TSK-3')
      );
    });
  });

  describe('deleteTask', () => {
    it('tombstones instead of removing the row, keeping indices stable', async () => {
      await repo.createTask(makeTask({ id: 'TSK-1' }));
      await repo.createTask(makeTask({ id: 'TSK-2' }));
      await repo.deleteTask('TSK-1');

      // Both rows still physically present.
      expect(transport.getDataRows(SHEET_NAMES.TASKS)).toHaveLength(2);
      // No physical row deletion occurred.
      expect(transport.calls.deleteRow).toBe(0);
    });

    it('does not disturb a concurrent update to another task', async () => {
      // This is the scenario physical row deletion would corrupt: deleting row
      // 2 shifts TSK-2 up, so an in-flight write aimed at row 3 would land on
      // the wrong record or an empty row.
      await repo.createTask(makeTask({ id: 'TSK-1' }));
      await repo.createTask(makeTask({ id: 'TSK-2', taskName: 'Survivor' }));

      const snapshot = await repo.readSnapshot();
      const second = snapshot.tasks.find((t) => t.id === 'TSK-2')!;

      await repo.deleteTask('TSK-1');
      await repo.updateTask(
        { ...second, taskName: 'Survivor edited' },
        second.updatedAt
      );

      const after = await repo.readSnapshot();
      expect(after.tasks).toHaveLength(1);
      expect(after.tasks[0].id).toBe('TSK-2');
      expect(after.tasks[0].taskName).toBe('Survivor edited');
    });

    it('refuses a stale delete', async () => {
      const task = makeTask();
      await repo.createTask(task);
      await repo.updateTask({ ...task, taskName: 'Moved on' }, task.updatedAt);

      await expect(
        repo.deleteTask(task.id, task.updatedAt)
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('is not repeatable on an already-deleted task', async () => {
      const task = makeTask();
      await repo.createTask(task);
      await repo.deleteTask(task.id);
      await expect(repo.deleteTask(task.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('master data', () => {
    it('round-trips an item into its category tab', async () => {
      const item = makeMasterItem({ category: 'Vendors', id: 'vend-1', name: 'PrintCraft' });
      await repo.createMasterItem(item);

      expect(transport.getDataRows(SHEET_NAMES.VENDORS)).toHaveLength(1);
      expect(transport.getDataRows(SHEET_NAMES.PROJECTS)).toHaveLength(0);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.masterItems).toEqual([item]);
    });

    it('reads every category', async () => {
      await repo.createMasterItem(makeMasterItem({ id: 'p1', category: 'Projects', name: 'P' }));
      await repo.createMasterItem(makeMasterItem({ id: 'v1', category: 'Vendors', name: 'V' }));
      await repo.createMasterItem(makeMasterItem({ id: 'a1', category: 'Agencies', name: 'A' }));
      await repo.createMasterItem(makeMasterItem({ id: 'd1', category: 'Departments', name: 'D' }));
      await repo.createMasterItem(makeMasterItem({ id: 't1', category: 'Team Members', name: 'T' }));

      const snapshot = await repo.readSnapshot();
      expect(snapshot.masterItems).toHaveLength(5);
      expect(new Set(snapshot.masterItems.map((m) => m.category))).toEqual(
        new Set(['Projects', 'Vendors', 'Agencies', 'Departments', 'Team Members'])
      );
    });

    it('applies optimistic concurrency to master edits too', async () => {
      const item = makeMasterItem();
      await repo.createMasterItem(item);
      await repo.updateMasterItem({ ...item, name: 'Renamed' }, item.updatedAt);

      await expect(
        repo.updateMasterItem({ ...item, name: 'Stale rename' }, item.updatedAt)
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('excludes tombstoned master items', async () => {
      const item = makeMasterItem();
      await repo.createMasterItem(item);
      await repo.deleteMasterItem('Projects', item.id);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.masterItems).toEqual([]);
    });
  });

  describe('renameMasterItemReferences', () => {
    it('rewrites only the tasks that referenced the old name', async () => {
      await repo.createTask(makeTask({ id: 'TSK-1', project: 'Old Name' }));
      await repo.createTask(makeTask({ id: 'TSK-2', project: 'Other' }));
      await repo.createTask(makeTask({ id: 'TSK-3', project: 'Old Name' }));

      transport.resetCallCounts();
      const count = await repo.renameMasterItemReferences(
        'Projects',
        'Old Name',
        'New Name'
      );

      expect(count).toBe(2);
      // Both rows written in one batch, and only those two.
      expect(transport.writtenRanges).toHaveLength(2);

      const snapshot = await repo.readSnapshot();
      const byId = new Map(snapshot.tasks.map((t) => [t.id, t]));
      expect(byId.get('TSK-1')!.project).toBe('New Name');
      expect(byId.get('TSK-2')!.project).toBe('Other');
      expect(byId.get('TSK-3')!.project).toBe('New Name');
    });

    it('renames across every reference field', async () => {
      await repo.createTask(makeTask({ id: 'TSK-1', vendor: 'V1' }));
      await repo.createTask(makeTask({ id: 'TSK-2', internalPoc: 'Person' }));
      await repo.createTask(makeTask({ id: 'TSK-3', department: 'Dept' }));
      await repo.createTask(makeTask({ id: 'TSK-4', agency: 'Ag' }));

      expect(await repo.renameMasterItemReferences('Vendors', 'V1', 'V2')).toBe(1);
      expect(
        await repo.renameMasterItemReferences('Team Members', 'Person', 'Person B')
      ).toBe(1);
      expect(await repo.renameMasterItemReferences('Departments', 'Dept', 'Dept B')).toBe(1);
      expect(await repo.renameMasterItemReferences('Agencies', 'Ag', 'Ag B')).toBe(1);

      const snapshot = await repo.readSnapshot();
      const byId = new Map(snapshot.tasks.map((t) => [t.id, t]));
      expect(byId.get('TSK-1')!.vendor).toBe('V2');
      expect(byId.get('TSK-2')!.internalPoc).toBe('Person B');
      expect(byId.get('TSK-3')!.department).toBe('Dept B');
      expect(byId.get('TSK-4')!.agency).toBe('Ag B');
    });

    it('skips tombstoned tasks and is a no-op when the name is unchanged', async () => {
      await repo.createTask(makeTask({ id: 'TSK-1', project: 'Same' }));
      await repo.createTask(makeTask({ id: 'TSK-2', project: 'Same' }));
      await repo.deleteTask('TSK-2');

      expect(await repo.renameMasterItemReferences('Projects', 'Same', 'Same')).toBe(0);
      expect(await repo.renameMasterItemReferences('Projects', 'Same', 'Fresh')).toBe(1);
    });
  });

  describe('countMasterItemReferences', () => {
    it('counts live references only', async () => {
      await repo.createTask(makeTask({ id: 'TSK-1', vendor: 'PrintCraft' }));
      await repo.createTask(makeTask({ id: 'TSK-2', vendor: 'PrintCraft' }));
      await repo.createTask(makeTask({ id: 'TSK-3', vendor: 'Someone else' }));
      await repo.deleteTask('TSK-2');

      expect(await repo.countMasterItemReferences('Vendors', 'PrintCraft')).toBe(1);
      expect(await repo.countMasterItemReferences('Vendors', 'Unused')).toBe(0);
    });
  });

  describe('appendActivityLogs', () => {
    it('appends every entry in a batch', async () => {
      // Regression: the old client-side addLog read stale state in a loop, so
      // multi-rule automations persisted only the last entry.
      await repo.appendActivityLogs([
        {
          id: 'log-1',
          user: 'Aarav',
          role: 'Marketing Team',
          date: '2026-07-30',
          time: '10:00:00',
          action: 'Task Created',
          target: 'TSK-1',
          oldValue: 'None',
          newValue: 'Launch teaser film',
        },
        {
          id: 'log-2',
          user: 'Aarav',
          role: 'Marketing Team',
          date: '2026-07-30',
          time: '10:00:01',
          action: 'Execution Started',
          target: 'TSK-1',
          oldValue: 'None',
          newValue: '2026-07-30',
        },
      ]);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.activityLogs).toHaveLength(2);
      // Newest first.
      expect(snapshot.activityLogs[0].id).toBe('log-2');
    });

    it('does nothing for an empty batch', async () => {
      transport.resetCallCounts();
      await repo.appendActivityLogs([]);
      expect(transport.calls.append).toBe(0);
    });
  });

  describe('validateSchema', () => {
    it('reports a healthy spreadsheet', async () => {
      expect(await repo.validateSchema()).toEqual([]);
    });

    it('reports missing tabs', async () => {
      const bare = new FakeSheetsTransport();
      bare.seedSheet(SHEET_NAMES.TASKS, TASK_COLUMNS);
      const problems = await new SheetRepository(bare).validateSchema();

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('missing tab');
      expect(problems[0]).toContain(SHEET_NAMES.PROJECTS);
    });

    it('reports a renamed header column with its exact cell', async () => {
      const drifted = createHealthyTransport();
      drifted.setCell(SHEET_NAMES.TASKS, 1, 2, 'Title');
      const problems = await new SheetRepository(drifted).validateSchema();

      expect(problems.some((p) => p.includes('Tasks!C1'))).toBe(true);
      expect(problems.some((p) => p.includes('Task Name'))).toBe(true);
    });

    it('accepts extra user columns appended to the right', async () => {
      const extended = createHealthyTransport();
      extended.setCell(SHEET_NAMES.TASKS, 1, TASK_COLUMNS.length, 'My own notes');
      expect(await new SheetRepository(extended).validateSchema()).toEqual([]);
    });
  });

  describe('bootstrap', () => {
    it('creates every missing tab with headers', async () => {
      const empty = new FakeSheetsTransport();
      const fresh = new SheetRepository(empty);

      const result = await fresh.bootstrap();

      expect(result.created).toContain(SHEET_NAMES.TASKS);
      expect(result.created).toContain(SHEET_NAMES.ACTIVITY_LOG);
      expect(empty.hasSheet(SHEET_NAMES.TASKS)).toBe(true);
      expect(await fresh.validateSchema()).toEqual([]);
    });

    it('is idempotent and preserves existing data', async () => {
      await repo.createTask(makeTask());

      const result = await repo.bootstrap();
      expect(result.created).toEqual([]);
      expect(result.repairedHeaders).toEqual([]);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks).toHaveLength(1);
    });

    it('repairs a drifted header without touching data rows', async () => {
      await repo.createTask(makeTask({ taskName: 'Keep me' }));
      transport.setCell(SHEET_NAMES.TASKS, 1, 2, 'Wrong Header');

      const result = await repo.bootstrap();
      expect(result.repairedHeaders).toContain(SHEET_NAMES.TASKS);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks[0].taskName).toBe('Keep me');
      expect(await repo.validateSchema()).toEqual([]);
    });
  });

  describe('hand-edits made directly in the sheet', () => {
    it('survive a subsequent dashboard write to a different task', async () => {
      // The previous implementation cleared the whole sheet on every save, so
      // anything typed in Sheets was destroyed by the next dashboard action.
      await repo.createTask(makeTask({ id: 'TSK-1' }));
      await repo.createTask(makeTask({ id: 'TSK-2' }));

      const remarksCol = TASK_COLUMNS.indexOf('Remarks');
      transport.setCell(SHEET_NAMES.TASKS, 2, remarksCol, 'Typed in the sheet');

      const snapshot = await repo.readSnapshot();
      const other = snapshot.tasks.find((t) => t.id === 'TSK-2')!;
      await repo.updateTask({ ...other, taskName: 'Edited' }, other.updatedAt);

      const after = await repo.readSnapshot();
      expect(after.tasks.find((t) => t.id === 'TSK-1')!.remarks).toBe(
        'Typed in the sheet'
      );
    });

    it('are visible to the dashboard on the next read', async () => {
      await repo.createTask(makeTask());
      const nameCol = TASK_COLUMNS.indexOf('Task Name');
      transport.setCell(SHEET_NAMES.TASKS, 2, nameCol, 'Renamed in Sheets');

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks[0].taskName).toBe('Renamed in Sheets');
    });

    it('let a new task typed into the sheet appear in the dashboard', async () => {
      // A row added by hand with only the essentials filled in.
      await transport.append(`'${SHEET_NAMES.TASKS}'!A2:AA`, [
        ['TSK-manual', 'Some Project', 'Typed by hand'],
      ]);

      const snapshot = await repo.readSnapshot();
      expect(snapshot.tasks).toHaveLength(1);
      expect(snapshot.tasks[0].id).toBe('TSK-manual');
      expect(snapshot.tasks[0].taskName).toBe('Typed by hand');
      // Unfilled fields fall back to sane defaults rather than undefined.
      expect(snapshot.tasks[0].priority).toBe('Medium');
      expect(snapshot.tasks[0].taskProgress).toBe('Not Started');
      expect(snapshot.tasks[0].budget).toBe(0);
    });
  });
});

describe('schema column mapping', () => {
  it('serialises a task to exactly the declared column count', () => {
    expect(taskToRow(makeTask())).toHaveLength(TASK_COLUMNS.length);
  });

  it('keeps the master column count in sync', () => {
    expect(MASTER_COLUMNS.length).toBe(7);
  });
});
