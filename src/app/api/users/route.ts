/**
 * GET  /api/users — list everyone with access (Admin only).
 * POST /api/users — grant access to an email address (Admin only).
 *
 * This is the brief's "Admin can manage users", backed by the `Users` tab so the
 * access list lives with the rest of the master data.
 */

import { SheetRepository } from '@/lib/server/repository';
import {
  assertCan,
  handle,
  readJsonObject,
  requireUser,
} from '@/lib/server/apiHelpers';
import { inviteUser, listUsers } from '@/lib/server/userService';
import { newActivityLogId } from '@/lib/ids';
import { nowTimeString, today } from '@/lib/dates';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser(request);
    assertCan(actor, 'manage-users');

    const repo = new SheetRepository();
    const users = await listUsers(repo);

    return Response.json({ users });
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser(request);
    assertCan(actor, 'manage-users');

    const body = await readJsonObject(request);
    const repo = new SheetRepository();
    const user = await inviteUser(repo, {
      email: body.email,
      name: body.name,
      role: body.role,
    });

    await repo.appendActivityLogs([
      {
        id: newActivityLogId(),
        user: actor.name,
        role: actor.role,
        date: today(),
        time: nowTimeString(),
        action: 'User Access Granted',
        target: user.email,
        oldValue: 'No access',
        newValue: user.role,
      },
    ]);

    return Response.json({ user }, { status: 201 });
  });
}
