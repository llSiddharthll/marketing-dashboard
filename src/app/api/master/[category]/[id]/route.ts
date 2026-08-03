/**
 * GET    /api/master/[category]/[id] — read an item plus how many tasks use it.
 * PATCH  /api/master/[category]/[id] — rename / edit, cascading to tasks.
 * DELETE /api/master/[category]/[id] — remove, or deactivate if in use.
 *
 * The GET exists so the confirmation dialog can tell the user what will actually
 * happen ("used by 7 tasks — will be marked Inactive") before they commit.
 */

import { SheetRepository } from '@/lib/server/repository';
import {
  assertCan,
  requireUser,
  handle,
  readJsonObject,
} from '@/lib/server/apiHelpers';
import {
  assertKnownCategory,
  countReferences,
  removeMasterItem,
  updateMasterItem,
} from '@/lib/server/masterService';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/master/[category]/[id]'>
) {
  return handle(async () => {
    const { category: rawCategory, id } = await ctx.params;
    const category = assertKnownCategory(decodeURIComponent(rawCategory));

    // A read, so any signed-in role is fine — but not anonymous.
    await requireUser(request);

    const repo = new SheetRepository();
    const result = await countReferences(repo, category, id);

    return Response.json({
      item: result.item,
      referenceCount: result.referenceCount,
      // Tells the client which branch a DELETE would take.
      removalAction: result.referenceCount > 0 ? 'deactivated' : 'archived',
    });
  });
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/master/[category]/[id]'>
) {
  return handle(async () => {
    const { category: rawCategory, id } = await ctx.params;
    const category = assertKnownCategory(decodeURIComponent(rawCategory));

    const actor = await requireUser(request);
    assertCan(actor, 'manage-master');

    const body = await readJsonObject(request);
    const repo = new SheetRepository();
    const result = await updateMasterItem(repo, category, id, body, actor);

    return Response.json(result);
  });
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<'/api/master/[category]/[id]'>
) {
  return handle(async () => {
    const { category: rawCategory, id } = await ctx.params;
    const category = assertKnownCategory(decodeURIComponent(rawCategory));

    const actor = await requireUser(request);
    assertCan(actor, 'manage-master');

    const repo = new SheetRepository();
    const outcome = await removeMasterItem(repo, category, id, actor);

    return Response.json(outcome);
  });
}
