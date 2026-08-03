/**
 * POST /api/tasks — create a task.
 *
 * Uses `values.append`, which Google serialises, so two people creating a task
 * at the same instant get two rows. The previous implementation rewrote the
 * whole sheet on every save and lost one of them.
 */

import { SheetRepository } from '@/lib/server/repository';
import {
  assertCan,
  requireUser,
  handle,
  readJsonObject,
} from '@/lib/server/apiHelpers';
import { createTask } from '@/lib/server/taskService';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser(request);
    assertCan(actor, 'write-task');

    const body = await readJsonObject(request);
    const repo = new SheetRepository();
    const result = await createTask(repo, body, actor);

    return Response.json(result, { status: 201 });
  });
}
