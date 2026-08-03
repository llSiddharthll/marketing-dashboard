/**
 * GET /api/snapshot — the whole dataset in one batched read.
 *
 * This is the pull half of two-way sync. The client polls it, and because the
 * spreadsheet is the source of truth, an edit typed directly into Sheets shows
 * up in the dashboard on the next poll.
 *
 * Supports `?since=<revision>`: when the content has not changed the handler
 * returns 304 with no body, so a poll every few seconds costs almost nothing.
 */

import { SheetRepository } from '@/lib/server/repository';
import { handle, requireUser } from '@/lib/server/apiHelpers';
import { refreshDerivedFlags } from '@/lib/automations';
import { today } from '@/lib/dates';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    // Every role may read, but only signed-in users. Without this the whole
    // dataset would be downloadable by anyone who knew the URL.
    await requireUser(request);

    const since = request.nextUrl.searchParams.get('since');
    const repo = new SheetRepository();
    const snapshot = await repo.readSnapshot();

    if (since && since === snapshot.revision) {
      // Nothing changed. 304 carries no body by definition.
      return new Response(null, {
        status: 304,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // Recompute the overdue flag at read time so a task that crossed its
    // deadline reads as overdue even if no one has saved it since. The stored
    // flag is only refreshed lazily on the next write, which keeps reads cheap.
    const todayDate = today();
    const tasks = snapshot.tasks.map(
      (task) => refreshDerivedFlags(task, todayDate).task
    );

    return Response.json(
      { ...snapshot, tasks },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  });
}
