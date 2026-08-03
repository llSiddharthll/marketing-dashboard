/**
 * POST /api/auth/login — authenticate with email and password.
 * GET /api/auth/login — redirect to the login page.
 */

import { SheetRepository } from '@/lib/server/repository';
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, serialiseCookie } from '@/lib/server/session';
import { resolveSignIn } from '@/lib/server/userService';
import { getAuthConfig } from '@/lib/server/env';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { email, password } = body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return Response.json(
        { error: 'Email address is required.' },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string') {
      return Response.json(
        { error: 'Password is required.' },
        { status: 400 }
      );
    }

    const normalisedEmail = email.trim().toLowerCase();

    // There is no per-user password store yet — this checks against the one
    // configured demo account only, so knowing the password does not grant
    // access to any *other* email that happens to be on the Users allowlist.
    const { demoUser } = getAuthConfig();
    const isValid =
      normalisedEmail === demoUser.email && password === demoUser.password;

    if (!isValid) {
      return Response.json(
        { error: 'Invalid email address or password.' },
        { status: 401 }
      );
    }

    const repo = new SheetRepository();
    const outcome = await resolveSignIn(repo, {
      email: normalisedEmail,
      name: normalisedEmail.split('@')[0],
      emailVerified: true,
    });

    if (!outcome.allowed) {
      return Response.json(
        { error: outcome.reason },
        { status: 403 }
      );
    }

    const token = createSessionToken({
      email: outcome.user.email,
      name: outcome.user.name,
    });

    const headers = new Headers();
    headers.append(
      'Set-Cookie',
      serialiseCookie(SESSION_COOKIE, token, {
        maxAgeSeconds: SESSION_TTL_SECONDS,
      })
    );

    return Response.json(
      { success: true, user: outcome.user },
      { status: 200, headers }
    );
  } catch (err) {
    console.error('[auth/login] login error', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Sign-in failed.' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return Response.redirect(new URL('/login', request.nextUrl.origin), 302);
}
