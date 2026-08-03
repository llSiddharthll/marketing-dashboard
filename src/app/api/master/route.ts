/**
 * POST /api/master — add a project, vendor, agency, department or team member.
 */

import { SheetRepository } from '@/lib/server/repository';
import {
  assertCan,
  requireUser,
  handle,
  readJsonObject,
} from '@/lib/server/apiHelpers';
import { createMasterItem } from '@/lib/server/masterService';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser(request);
    assertCan(actor, 'manage-master');

    const body = await readJsonObject(request);
    const repo = new SheetRepository();
    const item = await createMasterItem(repo, body, actor);

    return Response.json({ item }, { status: 201 });
  });
}
