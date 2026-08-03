/**
 * Stateless session cookies, signed with HMAC-SHA256.
 *
 * Format: `base64url(payload).base64url(signature)`
 *
 * Design notes:
 *  - The payload carries **identity only** (email, name, picture, iat, exp).
 *    The role is deliberately absent: it is resolved from the `Users` tab on
 *    every request, so demoting or suspending someone takes effect immediately
 *    instead of waiting for their cookie to expire.
 *  - The payload is signed, not encrypted. It contains nothing secret — an
 *    attacker who reads it learns the user's own email — and signing is what
 *    prevents tampering.
 *  - Signature comparison is constant-time to avoid leaking bytes of a valid
 *    signature through timing.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SessionIdentity } from '@/types/dashboard';
import { getAuthConfig } from './env';

export const SESSION_COOKIE = 'mtd_session';

/** Session lifetime. A week balances convenience against stale identity. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function base64urlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function sign(payload: string, secret: string): string {
  return base64urlEncode(
    createHmac('sha256', secret).update(payload).digest()
  );
}

/**
 * Compares two signatures without leaking their contents through timing.
 * `timingSafeEqual` throws on length mismatch, so lengths are checked first —
 * signature length is not secret.
 */
function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Creates a signed session token for the given identity. */
export function createSessionToken(
  identity: Omit<SessionIdentity, 'iat' | 'exp'>,
  options: { ttlSeconds?: number; now?: number } = {}
): string {
  const { sessionSecret } = getAuthConfig();
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? SESSION_TTL_SECONDS;

  const payload: SessionIdentity = {
    email: identity.email.toLowerCase(),
    name: identity.name,
    ...(identity.picture ? { picture: identity.picture } : {}),
    iat: now,
    exp: now + ttl,
  };

  const encoded = base64urlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, sessionSecret)}`;
}

export type SessionVerifyResult =
  | { valid: true; identity: SessionIdentity }
  | { valid: false; reason: 'missing' | 'malformed' | 'bad-signature' | 'expired' };

/**
 * Verifies and decodes a session token.
 *
 * Returns a discriminated result rather than throwing, because "no valid
 * session" is an ordinary state for an unauthenticated request, not an error.
 */
export function verifySessionToken(
  token: string | undefined | null,
  options: { now?: number } = {}
): SessionVerifyResult {
  if (!token) return { valid: false, reason: 'missing' };

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'malformed' };
  }

  const [encoded, providedSignature] = parts;
  const { sessionSecret } = getAuthConfig();

  // Verify the signature *before* parsing the payload, so malformed or hostile
  // JSON is never handed to JSON.parse on the strength of an unverified blob.
  if (!signaturesMatch(providedSignature, sign(encoded, sessionSecret))) {
    return { valid: false, reason: 'bad-signature' };
  }

  let identity: SessionIdentity;
  try {
    const parsed = JSON.parse(base64urlDecode(encoded).toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.email !== 'string' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.iat !== 'number'
    ) {
      return { valid: false, reason: 'malformed' };
    }
    identity = parsed as SessionIdentity;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (identity.exp <= now) return { valid: false, reason: 'expired' };

  return { valid: true, identity };
}

/* -------------------------------------------------------------------------- */
/* Cookie serialisation                                                       */
/* -------------------------------------------------------------------------- */

export interface CookieOptions {
  maxAgeSeconds: number;
  /** Omitted (and forced off) on plain http so local development works. */
  secure?: boolean;
}

/**
 * Builds a `Set-Cookie` header value.
 *
 * `HttpOnly` keeps the token away from JavaScript, so an XSS bug cannot exfiltrate
 * a session. `SameSite=Lax` allows the top-level redirect back from Google while
 * still blocking cross-site POSTs.
 */
export function serialiseCookie(
  name: string,
  value: string,
  options: CookieOptions
): string {
  const { appUrl } = getAuthConfig();
  // Only mark Secure over https; otherwise the browser drops the cookie on
  // http://localhost and sign-in silently fails.
  const secure = options.secure ?? appUrl.startsWith('https://');

  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');

  return parts.join('; ');
}

/** Builds a `Set-Cookie` header that deletes the named cookie. */
export function serialiseClearedCookie(name: string): string {
  return serialiseCookie(name, '', { maxAgeSeconds: 0 });
}

/**
 * Reads a cookie from a request without relying on `next/headers`, so the same
 * helper works in route handlers and in `proxy.ts`.
 */
export function readCookie(
  request: Request,
  name: string
): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;

  for (const chunk of header.split(';')) {
    const separator = chunk.indexOf('=');
    if (separator === -1) continue;
    if (chunk.slice(0, separator).trim() === name) {
      return chunk.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/** Extracts and verifies the session identity from a request. */
export function getSessionFromRequest(
  request: Request,
  options: { now?: number } = {}
): SessionVerifyResult {
  return verifySessionToken(readCookie(request, SESSION_COOKIE), options);
}
