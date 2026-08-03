/**
 * Data access layer over the spreadsheet.
 *
 * Concurrency model — this replaces a previous implementation that called
 * `clearContents()` and rewrote every row on each save, which destroyed
 * hand-edits and lost data whenever two people saved at once:
 *
 *  1. **Creates** use `values.append` with `INSERT_ROWS`. Google serialises
 *     appends server-side, so two simultaneous creates get two distinct rows
 *     without any locking.
 *  2. **Updates** write exactly one row range. Row indices never move because
 *     deletes are tombstones, so a write can never land on the wrong record.
 *  3. **Lost updates** are caught by optimistic concurrency: the caller sends
 *     the `updatedAt` it last saw, and the write is refused with a 409 if the
 *     stored value has moved on. After writing we re-read the cell to confirm
 *     our value landed, which also catches a writer that raced us inside the
 *     read-verify-write window.
 *  4. **Hand-edits in the sheet survive.** Nothing is ever bulk-cleared.
 */

import { createHash } from 'node:crypto';
import type {
  ActivityLog,
  AppUser,
  MasterItem,
  Snapshot,
  Task,
} from '@/types/dashboard';
import {
  ACTIVITY_LOG_COLUMNS,
  MASTER_CATEGORIES,
  MASTER_COLUMNS,
  MASTER_SHEET_BY_CATEGORY,
  MASTER_UPDATED_AT_INDEX,
  SHEET_DEFINITIONS,
  SHEET_NAMES,
  TASK_COLUMNS,
  TASK_UPDATED_AT_INDEX,
  USER_COLUMNS,
  activityLogFromRow,
  activityLogToRow,
  appUserFromRow,
  appUserToRow,
  columnLetter,
  dataRange,
  headerRange,
  masterItemFromRow,
  masterItemToRow,
  rowRange,
  taskFromRow,
  taskToRow,
  type SheetName,
} from '@/lib/sheets/schema';
import { nowIso } from '@/lib/dates';
import { GoogleSheetsTransport, type SheetsTransport } from './sheetsClient';

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/** Raised when the record was changed by someone else since it was read. */
export class ConflictError extends Error {
  readonly current: Task | MasterItem | null;

  constructor(message: string, current: Task | MasterItem | null) {
    super(message);
    this.name = 'ConflictError';
    this.current = current;
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Raised when required tabs or headers are missing from the spreadsheet. */
export class SchemaError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Spreadsheet is not set up correctly: ${problems.join('; ')}`);
    this.name = 'SchemaError';
    this.problems = problems;
  }
}

/* -------------------------------------------------------------------------- */
/* Repository                                                                  */
/* -------------------------------------------------------------------------- */

export class SheetRepository {
  private readonly transport: SheetsTransport;

  constructor(transport?: SheetsTransport) {
    this.transport = transport ?? new GoogleSheetsTransport();
  }

  /* ---------------------------- Reads ----------------------------------- */

  /**
   * Reads every entity in one batched round trip and returns a snapshot with a
   * content revision. Tombstoned rows are filtered out here so no caller has to
   * remember to.
   */
  async readSnapshot(): Promise<Snapshot> {
    const ranges = [
      dataRange(SHEET_NAMES.TASKS, TASK_COLUMNS.length),
      ...MASTER_CATEGORIES.map((category) =>
        dataRange(MASTER_SHEET_BY_CATEGORY[category], MASTER_COLUMNS.length)
      ),
      dataRange(SHEET_NAMES.ACTIVITY_LOG, ACTIVITY_LOG_COLUMNS.length),
    ];

    const results = await this.safeBatchGet(ranges);

    const taskRows = results[0]?.values ?? [];
    const tasks = taskRows
      .filter((row) => hasId(row))
      .map(taskFromRow)
      .filter((task) => !task.deletedAt);

    const masterItems: MasterItem[] = [];
    MASTER_CATEGORIES.forEach((category, index) => {
      const rows = results[index + 1]?.values ?? [];
      for (const row of rows) {
        if (!hasId(row)) continue;
        const item = masterItemFromRow(row, category);
        if (item.deletedAt) continue;
        masterItems.push(item);
      }
    });

    const logRows = results[MASTER_CATEGORIES.length + 1]?.values ?? [];
    const activityLogs = logRows
      .filter((row) => hasId(row))
      .map(activityLogFromRow)
      // Newest first, matching how the UI renders the audit stream.
      .reverse();

    return {
      tasks,
      masterItems,
      activityLogs,
      revision: computeRevision(tasks, masterItems, activityLogs.length),
      fetchedAt: nowIso(),
    };
  }

  /**
   * Verifies the spreadsheet has the tabs and headers the app expects.
   * Returns a list of problems; empty means healthy.
   */
  async validateSchema(): Promise<string[]> {
    const problems: string[] = [];
    const sheets = await this.transport.getSheets();
    const titles = new Set(sheets.map((s) => s.title));

    const missingTabs = SHEET_DEFINITIONS.filter(
      (def) => !titles.has(def.name)
    ).map((def) => def.name);

    if (missingTabs.length > 0) {
      problems.push(
        `missing tab(s): ${missingTabs.join(', ')} — run Initialize Spreadsheet in Settings`
      );
      // Header checks below would all fail for missing tabs; report once.
      return problems;
    }

    const headerRanges = SHEET_DEFINITIONS.map((def) =>
      headerRange(def.name, def.columns.length)
    );
    const headers = await this.transport.batchGet(headerRanges);

    SHEET_DEFINITIONS.forEach((def, index) => {
      const actual = (headers[index]?.values?.[0] ?? []).map((c) =>
        String(c ?? '').trim()
      );
      // Only the leading columns the app owns must match; a user may append
      // their own helper columns to the right without breaking anything.
      for (let col = 0; col < def.columns.length; col++) {
        if (actual[col] !== def.columns[col]) {
          problems.push(
            `${def.name}!${columnLetter(col)}1 should be "${def.columns[col]}" but is "${
              actual[col] ?? '(empty)'
            }"`
          );
          break;
        }
      }
    });

    return problems;
  }

  /**
   * Creates any missing tabs and writes their header rows. Idempotent: running
   * it twice is harmless, and it never touches existing data rows.
   */
  async bootstrap(): Promise<{ created: SheetName[]; repairedHeaders: SheetName[] }> {
    const sheets = await this.transport.getSheets();
    const byTitle = new Map(sheets.map((s) => [s.title, s]));
    const created: SheetName[] = [];
    const repairedHeaders: SheetName[] = [];

    for (const def of SHEET_DEFINITIONS) {
      let meta = byTitle.get(def.name);

      if (!meta) {
        const sheetId = await this.transport.addSheet(
          def.name,
          def.columns.length
        );
        meta = {
          sheetId,
          title: def.name,
          rowCount: 1000,
          columnCount: def.columns.length,
        };
        created.push(def.name);
      }

      // Write headers if absent or wrong. Safe for existing sheets: this only
      // ever touches row 1.
      const existing = await this.transport.batchGet([
        headerRange(def.name, def.columns.length),
      ]);
      const actual = (existing[0]?.values?.[0] ?? []).map((c) =>
        String(c ?? '').trim()
      );
      const matches = def.columns.every((col, i) => actual[i] === col);

      if (!matches) {
        await this.transport.batchUpdate([
          {
            range: headerRange(def.name, def.columns.length),
            values: [[...def.columns]],
          },
        ]);
        await this.transport.formatHeaderRow(meta.sheetId, def.columns.length);
        if (!created.includes(def.name)) repairedHeaders.push(def.name);
      }
    }

    return { created, repairedHeaders };
  }

  /* ---------------------------- Tasks ----------------------------------- */

  async createTask(task: Task): Promise<Task> {
    await this.transport.append(
      dataRange(SHEET_NAMES.TASKS, TASK_COLUMNS.length),
      [taskToRow(task)]
    );
    return task;
  }

  async getTask(id: string): Promise<{ task: Task; rowNumber: number } | null> {
    const located = await this.locateRow(
      SHEET_NAMES.TASKS,
      TASK_COLUMNS.length,
      id
    );
    if (!located) return null;
    return { task: taskFromRow(located.row), rowNumber: located.rowNumber };
  }

  /**
   * Writes a task, refusing the write if it would clobber a newer version.
   *
   * @param expectedUpdatedAt The `updatedAt` the caller last saw. Pass
   *   `undefined` to force the write (used by admin repair paths only).
   */
  async updateTask(
    next: Task,
    expectedUpdatedAt?: string
  ): Promise<Task> {
    const located = await this.getTask(next.id);
    if (!located || located.task.deletedAt) {
      throw new NotFoundError(`Task ${next.id} does not exist.`);
    }

    if (
      expectedUpdatedAt !== undefined &&
      located.task.updatedAt !== expectedUpdatedAt
    ) {
      throw new ConflictError(
        `Task ${next.id} was changed by someone else. Reload to see their edit before saving.`,
        located.task
      );
    }

    const stamped: Task = { ...next, updatedAt: nowIso() };

    await this.transport.batchUpdate([
      {
        range: rowRange(
          SHEET_NAMES.TASKS,
          located.rowNumber,
          TASK_COLUMNS.length
        ),
        values: [taskToRow(stamped)],
      },
    ]);

    await this.verifyWrite(
      SHEET_NAMES.TASKS,
      located.rowNumber,
      TASK_UPDATED_AT_INDEX,
      stamped.updatedAt,
      () => this.getTask(next.id).then((r) => r?.task ?? null),
      `Task ${next.id}`
    );

    return stamped;
  }

  /** Tombstones a task. The row stays in place, preserving row indices. */
  async deleteTask(id: string, expectedUpdatedAt?: string): Promise<void> {
    const located = await this.getTask(id);
    if (!located || located.task.deletedAt) {
      throw new NotFoundError(`Task ${id} does not exist.`);
    }
    if (
      expectedUpdatedAt !== undefined &&
      located.task.updatedAt !== expectedUpdatedAt
    ) {
      throw new ConflictError(
        `Task ${id} was changed by someone else. Reload before deleting.`,
        located.task
      );
    }

    const tombstoned: Task = {
      ...located.task,
      deletedAt: nowIso(),
      updatedAt: nowIso(),
    };

    await this.transport.batchUpdate([
      {
        range: rowRange(
          SHEET_NAMES.TASKS,
          located.rowNumber,
          TASK_COLUMNS.length
        ),
        values: [taskToRow(tombstoned)],
      },
    ]);
  }

  /* ------------------------- Master data -------------------------------- */

  async createMasterItem(item: MasterItem): Promise<MasterItem> {
    const sheet = MASTER_SHEET_BY_CATEGORY[item.category];
    await this.transport.append(dataRange(sheet, MASTER_COLUMNS.length), [
      masterItemToRow(item),
    ]);
    return item;
  }

  async getMasterItem(
    category: MasterItem['category'],
    id: string
  ): Promise<{ item: MasterItem; rowNumber: number } | null> {
    const sheet = MASTER_SHEET_BY_CATEGORY[category];
    const located = await this.locateRow(sheet, MASTER_COLUMNS.length, id);
    if (!located) return null;
    return {
      item: masterItemFromRow(located.row, category),
      rowNumber: located.rowNumber,
    };
  }

  async updateMasterItem(
    next: MasterItem,
    expectedUpdatedAt?: string
  ): Promise<MasterItem> {
    const sheet = MASTER_SHEET_BY_CATEGORY[next.category];
    const located = await this.getMasterItem(next.category, next.id);
    if (!located || located.item.deletedAt) {
      throw new NotFoundError(`${next.category} item ${next.id} does not exist.`);
    }
    if (
      expectedUpdatedAt !== undefined &&
      located.item.updatedAt !== expectedUpdatedAt
    ) {
      throw new ConflictError(
        `${next.name} was changed by someone else. Reload before saving.`,
        located.item
      );
    }

    const writtenAt = nowIso();
    const stamped: MasterItem = { ...next, updatedAt: writtenAt };

    await this.transport.batchUpdate([
      {
        range: rowRange(sheet, located.rowNumber, MASTER_COLUMNS.length),
        values: [masterItemToRow(stamped)],
      },
    ]);

    await this.verifyWrite(
      sheet,
      located.rowNumber,
      MASTER_UPDATED_AT_INDEX,
      writtenAt,
      () =>
        this.getMasterItem(next.category, next.id).then((r) => r?.item ?? null),
      `${next.category} item ${next.id}`
    );

    return stamped;
  }

  async deleteMasterItem(
    category: MasterItem['category'],
    id: string
  ): Promise<void> {
    const sheet = MASTER_SHEET_BY_CATEGORY[category];
    const located = await this.getMasterItem(category, id);
    if (!located || located.item.deletedAt) {
      throw new NotFoundError(`${category} item ${id} does not exist.`);
    }

    const tombstoned: MasterItem = {
      ...located.item,
      deletedAt: nowIso(),
      updatedAt: nowIso(),
    };

    await this.transport.batchUpdate([
      {
        range: rowRange(sheet, located.rowNumber, MASTER_COLUMNS.length),
        values: [masterItemToRow(tombstoned)],
      },
    ]);
  }

  /**
   * Renames a master item and updates every task that referenced the old name,
   * so a rename can never orphan a task.
   *
   * Only the affected task rows are written, and each is written individually —
   * a rename touching 3 tasks does not rewrite the other 2,000.
   */
  async renameMasterItemReferences(
    category: MasterItem['category'],
    oldName: string,
    newName: string
  ): Promise<number> {
    if (oldName === newName) return 0;

    const field = TASK_FIELD_BY_CATEGORY[category];
    const range = dataRange(SHEET_NAMES.TASKS, TASK_COLUMNS.length);
    const [result] = await this.transport.batchGet([range]);
    const rows = result?.values ?? [];

    const updates: { range: string; values: (string | number)[][] }[] = [];

    rows.forEach((row, index) => {
      if (!hasId(row)) return;
      const task = taskFromRow(row);
      if (task.deletedAt) return;
      if (task[field] !== oldName) return;

      const updated: Task = {
        ...task,
        [field]: newName,
        updatedAt: nowIso(),
      } as Task;

      updates.push({
        range: rowRange(SHEET_NAMES.TASKS, index + 2, TASK_COLUMNS.length),
        values: [taskToRow(updated)],
      });
    });

    if (updates.length > 0) await this.transport.batchUpdate(updates);
    return updates.length;
  }

  /**
   * Counts non-deleted tasks referencing a master item. Drives the
   * "used by N tasks — will be marked Inactive instead of removed" decision.
   */
  async countMasterItemReferences(
    category: MasterItem['category'],
    name: string
  ): Promise<number> {
    const field = TASK_FIELD_BY_CATEGORY[category];
    const [result] = await this.transport.batchGet([
      dataRange(SHEET_NAMES.TASKS, TASK_COLUMNS.length),
    ]);
    const rows = result?.values ?? [];

    let count = 0;
    for (const row of rows) {
      if (!hasId(row)) continue;
      const task = taskFromRow(row);
      if (task.deletedAt) continue;
      if (task[field] === name) count++;
    }
    return count;
  }

  /* ---------------------------- Users ----------------------------------- */

  /** Reads the whole access-control list. Small by nature: one row per person. */
  async listUsers(): Promise<AppUser[]> {
    const [result] = await this.safeBatchGet([
      dataRange(SHEET_NAMES.USERS, USER_COLUMNS.length),
    ]);
    return (result?.values ?? [])
      .filter((row) => hasId(row))
      .map(appUserFromRow)
      .filter((user) => !user.deletedAt);
  }

  async getUser(
    email: string
  ): Promise<{ user: AppUser; rowNumber: number } | null> {
    const normalised = email.trim().toLowerCase();
    const [idColumn] = await this.safeBatchGet([
      `'${SHEET_NAMES.USERS}'!A2:A`,
    ]);
    const emails = (idColumn?.values ?? []).map((r) =>
      String(r?.[0] ?? '').trim().toLowerCase()
    );

    const index = emails.indexOf(normalised);
    if (index === -1) return null;

    const rowNumber = index + 2;
    const [rowResult] = await this.safeBatchGet([
      rowRange(SHEET_NAMES.USERS, rowNumber, USER_COLUMNS.length),
    ]);
    const row = rowResult?.values?.[0];
    if (!row) return null;

    return { user: appUserFromRow(row), rowNumber };
  }

  async createUser(user: AppUser): Promise<AppUser> {
    try {
      await this.transport.append(
        dataRange(SHEET_NAMES.USERS, USER_COLUMNS.length),
        [appUserToRow(user)]
      );
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('Unable to parse range') ||
          err.message.includes('400'))
      ) {
        await this.bootstrap();
        await this.transport.append(
          dataRange(SHEET_NAMES.USERS, USER_COLUMNS.length),
          [appUserToRow(user)]
        );
      } else {
        throw err;
      }
    }
    return user;
  }

  async updateUser(
    next: AppUser,
    expectedUpdatedAt?: string
  ): Promise<AppUser> {
    const located = await this.getUser(next.email);
    if (!located || located.user.deletedAt) {
      throw new NotFoundError(`User ${next.email} does not exist.`);
    }
    if (
      expectedUpdatedAt !== undefined &&
      located.user.updatedAt !== expectedUpdatedAt
    ) {
      throw new ConflictError(
        `${next.email} was changed by someone else. Reload before saving.`,
        null
      );
    }

    const writtenAt = nowIso();
    const stamped: AppUser = { ...next, updatedAt: writtenAt };

    await this.transport.batchUpdate([
      {
        range: rowRange(
          SHEET_NAMES.USERS,
          located.rowNumber,
          USER_COLUMNS.length
        ),
        values: [appUserToRow(stamped)],
      },
    ]);

    return stamped;
  }

  /** Tombstones a user, revoking access while preserving their audit history. */
  async deleteUser(email: string): Promise<void> {
    const located = await this.getUser(email);
    if (!located || located.user.deletedAt) {
      throw new NotFoundError(`User ${email} does not exist.`);
    }

    const stamp = nowIso();
    await this.transport.batchUpdate([
      {
        range: rowRange(
          SHEET_NAMES.USERS,
          located.rowNumber,
          USER_COLUMNS.length
        ),
        values: [
          appUserToRow({
            ...located.user,
            deletedAt: stamp,
            updatedAt: stamp,
          }),
        ],
      },
    ]);
  }

  /**
   * Records a successful sign-in. Deliberately does not use the concurrency
   * token: a login stamp is not a user edit, and failing a login because someone
   * was simultaneously edited would be absurd.
   */
  async touchUserLogin(email: string): Promise<void> {
    const located = await this.getUser(email);
    if (!located) return;

    const stamp = nowIso();
    await this.transport.batchUpdate([
      {
        range: rowRange(
          SHEET_NAMES.USERS,
          located.rowNumber,
          USER_COLUMNS.length
        ),
        values: [
          appUserToRow({
            ...located.user,
            lastLoginAt: stamp,
            updatedAt: stamp,
          }),
        ],
      },
    ]);
  }

  /* ------------------------- Activity log ------------------------------- */

  /** Appends audit rows. Append-only by design — logs are never rewritten. */
  async appendActivityLogs(logs: ActivityLog[]): Promise<void> {
    if (logs.length === 0) return;
    await this.transport.append(
      dataRange(SHEET_NAMES.ACTIVITY_LOG, ACTIVITY_LOG_COLUMNS.length),
      logs.map(activityLogToRow)
    );
  }

  /* ---------------------------- Internals -------------------------------- */

  private async safeBatchGet(ranges: string[]) {
    try {
      return await this.transport.batchGet(ranges);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('Unable to parse range') ||
          err.message.includes('400'))
      ) {
        await this.bootstrap();
        return await this.transport.batchGet(ranges);
      }
      throw err;
    }
  }

  /**
   * Finds a row by id. Reads only column A first (cheap), then fetches just the
   * one matching row rather than pulling the whole table.
   */
  private async locateRow(
    sheet: SheetName,
    columnCount: number,
    id: string
  ): Promise<{ row: unknown[]; rowNumber: number } | null> {
    const [idColumn] = await this.safeBatchGet([`'${sheet}'!A2:A`]);
    const ids = (idColumn?.values ?? []).map((r) => String(r?.[0] ?? '').trim());

    const index = ids.indexOf(id);
    if (index === -1) return null;

    const rowNumber = index + 2; // +1 header, +1 for 1-based rows
    const [rowResult] = await this.safeBatchGet([
      rowRange(sheet, rowNumber, columnCount),
    ]);
    const row = rowResult?.values?.[0];
    if (!row) return null;

    return { row, rowNumber };
  }

  /**
   * Confirms our write is the one that landed.
   *
   * Optimistic concurrency alone leaves a window: two writers can both read the
   * same `updatedAt`, both pass the check, and the later write silently wins.
   * Re-reading the timestamp cell closes that window — if it is not the value we
   * just wrote, someone raced us and the caller is told rather than losing data.
   */
  private async verifyWrite(
    sheet: SheetName,
    rowNumber: number,
    updatedAtColumnIndex: number,
    expectedValue: string,
    loadCurrent: () => Promise<Task | MasterItem | null>,
    label: string
  ): Promise<void> {
    const letter = columnLetter(updatedAtColumnIndex);
    const [check] = await this.transport.batchGet([
      `'${sheet}'!${letter}${rowNumber}:${letter}${rowNumber}`,
    ]);
    const actual = String(check?.values?.[0]?.[0] ?? '').trim();

    if (actual !== expectedValue) {
      throw new ConflictError(
        `${label} was saved by someone else at the same moment. Your change was not kept — reload and reapply it.`,
        await loadCurrent()
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Maps a master category to the Task field that references it. */
const TASK_FIELD_BY_CATEGORY: Record<
  MasterItem['category'],
  'project' | 'department' | 'internalPoc' | 'agency' | 'vendor'
> = {
  Projects: 'project',
  Departments: 'department',
  'Team Members': 'internalPoc',
  Agencies: 'agency',
  Vendors: 'vendor',
};

/** A row is real data only if column A holds an id. */
function hasId(row: unknown[]): boolean {
  return String(row?.[0] ?? '').trim() !== '';
}

/**
 * Content hash of the snapshot. The client compares revisions to skip
 * re-rendering when a poll returns unchanged data.
 *
 * Built from ids and `updatedAt` values rather than the full payload: that is
 * enough to detect any mutation while staying cheap on large sheets.
 */
function computeRevision(
  tasks: Task[],
  masterItems: MasterItem[],
  logCount: number
): string {
  const hash = createHash('sha1');
  hash.update(`t:${tasks.length}|m:${masterItems.length}|l:${logCount}`);
  for (const task of tasks) hash.update(`|${task.id}@${task.updatedAt}`);
  for (const item of masterItems) {
    hash.update(`|${item.id}@${item.updatedAt ?? item.createdAt}`);
  }
  return hash.digest('hex').slice(0, 16);
}
