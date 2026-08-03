/**
 * PATCH  /api/users/[email] — change role, or suspend/restore (Admin only).
 * DELETE /api/users/[email] — revoke access (Admin only).
 *
 * The service layer refuses any change that would leave the workspace with no
 * active Admin, and refuses self-suspension and self-removal. Those guards live
 * in `userService` rather than here so they cannot be bypassed by a future
 * caller.
 */

import { SheetRepository } from '@/lib/server/repository';
import {
  assertCan,
  handle,
  jsonError,
  readJsonObject,
  requireUser,
} from '@/lib/server/apiHelpers';
import {
  changeUserRole,
  removeUser,
  setUserStatus,
} from '@/lib/server/userService';
import { newActivityLogId } from '@/lib/ids';
import { nowTimeString, today } from '@/lib/dates';
import type { ActivityLog } from '@/types/dashboard';
import type { Actor } from '@/lib/server/apiHelpers';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/users/[email]'>
) {
  return handle(async () => {
    const { email: rawEmail } = await ctx.params;
    const email = decodeURIComponent(rawEmail);

    const actor = await requireUser(request);
    assertCan(actor, 'manage-users');

    const body = await readJsonObject(request);
    const repo = new SheetRepository();

    if (typeof body.role === 'string') {
      const updated = await changeUserRole(repo, email, body.role, actor.email);
      await repo.appendActivityLogs([
        auditRow(
          actor,
          'User Role Changed',
          updated.email,
          'previous role',
          updated.role
        ),
      ]);
      return Response.json({ user: updated });
    }

    if (body.status === 'Active' || body.status === 'Suspended') {
      const updated = await setUserStatus(
        repo,
        email,
        body.status,
        actor.email
      );
      await repo.appendActivityLogs([
        auditRow(
          actor,
          updated.status === 'Suspended'
            ? 'User Suspended'
            : 'User Reinstated',
          updated.email,
          updated.status === 'Suspended' ? 'Active' : 'Suspended',
          updated.status
        ),
      ]);
      return Response.json({ user: updated });
    }

    return jsonError(400, {
      error: 'Send either a "role" or a "status" to change.',
    });
  });
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<'/api/users/[email]'>
) {
  return handle(async () => {
    const { email: rawEmail } = await ctx.params;
    const email = decodeURIComponent(rawEmail);

    const actor = await requireUser(request);
    assertCan(actor, 'manage-users');

    const repo = new SheetRepository();
    await removeUser(repo, email, actor.email);
    await repo.appendActivityLogs([
      auditRow(actor, 'User Access Revoked', email, 'Had access', 'Removed'),
    ]);

    return new Response(null, { status: 204 });
  });
}
