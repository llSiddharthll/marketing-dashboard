/**
 * POST /api/setup — create any missing tabs and repair header rows.
 *
 * Idempotent and non-destructive: it only ever writes row 1 and creates tabs
 * that do not exist. Existing data rows are never touched, so it is safe to run
 * against a spreadsheet that already holds live tasks.
 *
 * Exposed as an explicit action (a button in Settings) rather than running
 * automatically, because silently restructuring someone's spreadsheet is not a
 * side effect a page load should have.
 */

import { SheetRepository } from '@/lib/server/repository';
import {
  assertCan,
  requireUser,
  handle,
  readJsonObject,
} from '@/lib/server/apiHelpers';
import {
  INITIAL_MASTER_ITEMS,
  INITIAL_TASKS,
} from '@/lib/initialData';
import { nowIso } from '@/lib/dates';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser(request);
    // Restructuring the master database is an Admin action.
    assertCan(actor, 'delete-task');

    // Body is optional: a plain POST just repairs structure.
    let seed = false;
    try {
      const body = await readJsonObject(request);
      seed = body.seed === true;
    } catch {
      /* no body sent — structure-only run */
    }

    const repo = new SheetRepository();
    const result = await repo.bootstrap();

    let seeded: { tasks: number; masterItems: number } | null = null;
    if (seed) {
      // Only ever seed an empty spreadsheet. Refusing to seed over existing
      // rows means this button cannot duplicate a live dataset.
      const existing = await repo.readSnapshot();
      if (existing.tasks.length === 0 && existing.masterItems.length === 0) {
        const stamp = nowIso();

        for (const item of INITIAL_MASTER_ITEMS) {
          await repo.createMasterItem({
            ...item,
            createdAt: stamp,
            updatedAt: stamp,
            deletedAt: null,
          });
        }
        for (const task of INITIAL_TASKS) {
          await repo.createTask({ ...task, updatedAt: stamp, deletedAt: null });
        }

        seeded = {
          tasks: INITIAL_TASKS.length,
          masterItems: INITIAL_MASTER_ITEMS.length,
        };
      }
    }

    const problems = await repo.validateSchema();

    return Response.json({
      created: result.created,
      repairedHeaders: result.repairedHeaders,
      seeded,
      remainingProblems: problems,
      ok: problems.length === 0,
    });
  });
}
