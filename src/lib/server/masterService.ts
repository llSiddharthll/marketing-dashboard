/**
 * Master-data write operations.
 *
 * Implements the brief's rules for the shared dropdown lists:
 *  - Adding updates the master tab immediately.
 *  - Editing a name cascades to every task that referenced the old name, so a
 *    rename can never orphan a task.
 *  - Removing an item that is in use marks it Inactive instead of deleting it;
 *    unused items are archived outright. Inactive items disappear from new
 *    dropdowns but stay visible on historical tasks.
 */

import type { ActivityLog, MasterCategory, MasterItem } from '@/types/dashboard';
import { newActivityLogId, newMasterItemId } from '@/lib/ids';
import { nowIso, nowTimeString, today } from '@/lib/dates';
import {
  assertValid,
  findDuplicateName,
  validateMasterItemInput,
  ValidationError,
} from '@/lib/validation';
import { MASTER_CATEGORIES } from '@/lib/sheets/schema';
import type { Actor } from './apiHelpers';
import { NotFoundError, SheetRepository } from './repository';

export interface RemovalOutcome {
  /** 'archived' when nothing referenced it; 'deactivated' when it was in use. */
  action: 'archived' | 'deactivated';
  referenceCount: number;
  item: MasterItem | null;
}

function auditRow(
  actor: Actor,
  action: string,
  target: string,
  oldValue: string,
  newValue: string
): ActivityLog {
  return {
    id: newActivityLogId(),
    user: actor.name,
    role: actor.role,
    date: today(),
    time: nowTimeString(),
    action,
    target,
    oldValue,
    newValue,
  };
}

export function assertKnownCategory(value: unknown): MasterCategory {
  if (
    typeof value !== 'string' ||
    !MASTER_CATEGORIES.includes(value as MasterCategory)
  ) {
    throw new ValidationError([
      `category: must be one of ${MASTER_CATEGORIES.join(', ')}.`,
    ]);
  }
  return value as MasterCategory;
}

export async function createMasterItem(
  repo: SheetRepository,
  body: Record<string, unknown>,
  actor: Actor
): Promise<MasterItem> {
  const category = assertKnownCategory(body.category);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';

  assertValid(validateMasterItemInput({ name, category, description }));

  // Reject a case-insensitive duplicate so the dropdown cannot end up with two
  // entries that look identical to a user.
  const snapshot = await repo.readSnapshot();
  const duplicate = findDuplicateName(snapshot.masterItems, category, name);
  if (duplicate) {
    throw new ValidationError([
      `name: "${duplicate.name}" already exists in ${category}.`,
    ]);
  }

  const timestamp = nowIso();
  const item: MasterItem = {
    id: newMasterItemId(category),
    name,
    category,
    status: 'Active',
    description,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };

  await repo.createMasterItem(item);
  await repo.appendActivityLogs([
    auditRow(actor, `${category} Added`, item.id, 'None', name),
  ]);

  return item;
}

export async function updateMasterItem(
  repo: SheetRepository,
  category: MasterCategory,
  id: string,
  body: Record<string, unknown>,
  actor: Actor
): Promise<{ item: MasterItem; tasksUpdated: number }> {
  const located = await repo.getMasterItem(category, id);
  if (!located || located.item.deletedAt) {
    throw new NotFoundError(`${category} item ${id} does not exist.`);
  }
  const previous = located.item;

  const name =
    typeof body.name === 'string' ? body.name.trim() : previous.name;
  const description =
    typeof body.description === 'string'
      ? body.description.trim()
      : (previous.description ?? '');
  const status =
    body.status === 'Active' || body.status === 'Inactive'
      ? body.status
      : previous.status;

  assertValid(validateMasterItemInput({ name, category, description, status }));

  if (name !== previous.name) {
    const snapshot = await repo.readSnapshot();
    const duplicate = findDuplicateName(
      snapshot.masterItems,
      category,
      name,
      id
    );
    if (duplicate) {
      throw new ValidationError([
        `name: "${duplicate.name}" already exists in ${category}.`,
      ]);
    }
  }

  const next: MasterItem = { ...previous, name, description, status };
  const saved = await repo.updateMasterItem(
    next,
    typeof body.expectedUpdatedAt === 'string'
      ? body.expectedUpdatedAt
      : previous.updatedAt
  );

  // Cascade the rename to referencing tasks. Done after the master row is
  // safely written, so a failure here leaves the rename visible and retryable
  // rather than half-applied to tasks with no master record.
  let tasksUpdated = 0;
  if (name !== previous.name) {
    tasksUpdated = await repo.renameMasterItemReferences(
      category,
      previous.name,
      name
    );
  }

  const logs: ActivityLog[] = [];
  if (name !== previous.name) {
    logs.push(
      auditRow(
        actor,
        `${category} Renamed`,
        id,
        previous.name,
        `${name} (${tasksUpdated} task(s) updated)`
      )
    );
  }
  if (status !== previous.status) {
    logs.push(
      auditRow(actor, `${category} Status Changed`, id, previous.status, status)
    );
  }
  if (logs.length === 0) {
    logs.push(auditRow(actor, `${category} Edited`, id, previous.name, name));
  }
  await repo.appendActivityLogs(logs);

  return { item: saved, tasksUpdated };
}

/**
 * Removes a master item, honouring the brief's in-use rule.
 *
 * Callers should first read {@link countReferences} to show the user what will
 * happen; this function re-checks so the decision cannot be raced.
 */
export async function removeMasterItem(
  repo: SheetRepository,
  category: MasterCategory,
  id: string,
  actor: Actor
): Promise<RemovalOutcome> {
  const located = await repo.getMasterItem(category, id);
  if (!located || located.item.deletedAt) {
    throw new NotFoundError(`${category} item ${id} does not exist.`);
  }
  const item = located.item;

  const referenceCount = await repo.countMasterItemReferences(
    category,
    item.name
  );

  if (referenceCount > 0) {
    // In use: deactivate rather than delete, so historical tasks keep a valid
    // reference while the item stops appearing in new dropdowns.
    const saved = await repo.updateMasterItem(
      { ...item, status: 'Inactive' },
      item.updatedAt
    );
    await repo.appendActivityLogs([
      auditRow(
        actor,
        `${category} Deactivated`,
        id,
        'Active',
        `Inactive (still used by ${referenceCount} task(s))`
      ),
    ]);
    return { action: 'deactivated', referenceCount, item: saved };
  }

  await repo.deleteMasterItem(category, id);
  await repo.appendActivityLogs([
    auditRow(actor, `${category} Removed`, id, item.name, 'Archived'),
  ]);
  return { action: 'archived', referenceCount: 0, item: null };
}

export async function countReferences(
  repo: SheetRepository,
  category: MasterCategory,
  id: string
): Promise<{ item: MasterItem; referenceCount: number }> {
  const located = await repo.getMasterItem(category, id);
  if (!located || located.item.deletedAt) {
    throw new NotFoundError(`${category} item ${id} does not exist.`);
  }
  const referenceCount = await repo.countMasterItemReferences(
    category,
    located.item.name
  );
  return { item: located.item, referenceCount };
}
