/**
 * PATCH  /api/tasks/[id] — save an edit, with optimistic concurrency.
 * DELETE /api/tasks/[id] — archive (tombstone) a task.
 *
 * A PATCH carries `expectedUpdatedAt`; if the stored row has changed since the
 * client read it, the request fails with 409 and the server's current copy, so
 * the UI can show the conflict instead of silently overwriting a colleague.
 */

import { SheetRepository } from '@/lib/server/repository';
import {
  assertCan,
  requireUser,
  handle,
  readJsonObject,
} from '@/lib/server/apiHelpers';
import { deleteTask, updateTask } from '@/lib/server/taskService';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/tasks/[id]'>
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const actor = await requireUser(request);
    assertCan(actor, 'write-task');

    const body = await readJsonObject(request);
    const repo = new SheetRepository();
    const result = await updateTask(repo, id, body, actor);

    return Response.json(result);
  });
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<'/api/tasks/[id]'>
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const actor = await requireUser(request);
    assertCan(actor, 'delete-task');

    const repo = new SheetRepository();
    await deleteTask(repo, id, actor);

    return new Response(null, { status: 204 });
  });
}
