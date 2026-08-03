/**
 * POST /api/tasks/[id]/decision — management approve or reject (brief rule 4).
 *
 * A separate endpoint from PATCH because it is a distinct authority: only
 * Management and Admin may call it, and it applies its own transition
 * (complete + stamp approval date, or return to In Progress with a comment)
 * rather than accepting arbitrary field edits.
 */

import { SheetRepository } from '@/lib/server/repository';
import {
  assertCan,
  requireUser,
  handle,
  jsonError,
  readJsonObject,
} from '@/lib/server/apiHelpers';
import { decideTask } from '@/lib/server/taskService';
import { LIMITS } from '@/lib/validation';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/tasks/[id]/decision'>
) {
  return handle(async () => {
    const { id } = await ctx.params;
    const actor = await requireUser(request);
    assertCan(actor, 'approve');

    const body = await readJsonObject(request);
    const decision = body.decision;

    if (decision !== 'approve' && decision !== 'reject') {
      return jsonError(400, {
        error: 'decision must be either "approve" or "reject".',
      });
    }

    const rawComment = typeof body.comment === 'string' ? body.comment.trim() : '';

    // A rejection without feedback is not actionable for the assignee, so the
    // brief's "allow Management to enter rejection comments" is enforced.
    if (decision === 'reject' && rawComment.length === 0) {
      return jsonError(422, {
        error: 'A rejection comment is required so the assignee knows what to change.',
      });
    }

    if (rawComment.length > LIMITS.rejectionReason) {
      return jsonError(422, {
        error: `Keep the comment under ${LIMITS.rejectionReason} characters.`,
      });
    }

    const repo = new SheetRepository();
    const result = await decideTask(repo, id, decision, rawComment, actor);

    return Response.json(result);
  });
}
