/**
 * Service-account authentication for the Google Sheets API.
 *
 * Two ways to obtain an access token, selected by {@link ServerConfig.authMode}:
 *
 *  - `key`: sign a JWT with `GOOGLE_PRIVATE_KEY` and exchange it at Google's
 *    token endpoint (RFC 7523 JWT-bearer flow). Used wherever there is no
 *    ambient GCP identity — local development, Vercel.
 *  - `metadata`: ask the GCP metadata server for a token. Used on Cloud Run,
 *    GCE and GKE, where the compute environment already has a service account
 *    attached. No key exists in this mode — nothing to leak, rotate, or
 *    accidentally commit — which is also what makes it the only option on a
 *    project whose org policy blocks service-account key creation entirely.
 *
 * The JWT flow avoids depending on `googleapis`, which is a very large package
 * dominated by generated clients this app does not use, and keeps serverless
 * cold starts small.
 */

import { createSign } from 'node:crypto';
import { getServerConfig } from './env';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
/** Google caps assertion lifetime at 1 hour. */
const ASSERTION_LIFETIME_SECONDS = 3600;
/**
 * Refresh this many seconds before nominal expiry so an in-flight request never
 * races the boundary.
 */
const EXPIRY_SKEW_SECONDS = 60;

/**
 * Standard GCE/Cloud Run/GKE metadata endpoint for the attached service
 * account's token. Reachable only from inside GCP compute infrastructure —
 * `metadata.google.internal` does not resolve anywhere else, which is what
 * makes a stray `metadata` mode selection on a non-GCP host fail fast and
 * clearly rather than hang.
 */
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const METADATA_EMAIL_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email';
/** Generous but bounded: a healthy metadata server answers in single-digit ms. */
const METADATA_TIMEOUT_MS = 3000;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export class GoogleAuthError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GoogleAuthError';
    this.status = status;
  }
}

interface CachedToken {
  accessToken: string;
  /** Epoch seconds at which the token stops being usable. */
  expiresAt: number;
  /** Discriminates the cache: a config change (mode or account) must not reuse a stale token. */
  cacheKey: string;
}

let cachedToken: CachedToken | null = null;
/**
 * De-duplicates concurrent token fetches. Without this, a burst of parallel
 * requests on a cold instance would each mint their own token.
 */
let inFlight: Promise<string> | null = null;

/* -------------------------------------------------------------------------- */
/* Key mode                                                                    */
/* -------------------------------------------------------------------------- */

function buildAssertion(clientEmail: string, privateKey: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: issuedAt,
    exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claims)
  )}`;

  let signature: string;
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    signature = base64url(signer.sign(privateKey));
  } catch (err) {
    throw new GoogleAuthError(
      `Could not sign the authentication request with GOOGLE_PRIVATE_KEY. ` +
        `Check that the key was copied complete, including the BEGIN/END lines. ` +
        `(${err instanceof Error ? err.message : String(err)})`
    );
  }

  return `${signingInput}.${signature}`;
}

async function requestTokenWithKey(
  clientEmail: string,
  privateKey: string
): Promise<CachedToken> {
  const assertion = buildAssertion(clientEmail, privateKey);

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    // Never cache an auth exchange.
    cache: 'no-store',
  });

  const bodyText = await response.text();

  if (!response.ok) {
    // Google returns {"error":"invalid_grant","error_description":"..."} which
    // is far more actionable than the status code alone.
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as {
        error?: string;
        error_description?: string;
      };
      detail = parsed.error_description ?? parsed.error ?? bodyText;
    } catch {
      /* keep raw body */
    }
    throw new GoogleAuthError(
      `Google rejected the service-account credentials: ${detail}`,
      response.status
    );
  }

  const payload = JSON.parse(bodyText) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new GoogleAuthError(
      'Google returned a token response with no access_token.'
    );
  }

  const lifetime = payload.expires_in ?? ASSERTION_LIFETIME_SECONDS;
  return {
    accessToken: payload.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + lifetime - EXPIRY_SKEW_SECONDS,
    cacheKey: `key:${clientEmail}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Metadata mode                                                              */
/* -------------------------------------------------------------------------- */

async function requestTokenFromMetadataServer(): Promise<CachedToken> {
  let response: Response;
  try {
    response = await fetch(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      cache: 'no-store',
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch (err) {
    throw new GoogleAuthError(
      `Could not reach the GCP metadata server to authenticate. This mode only ` +
        `works when the app is running on Google Cloud infrastructure (Cloud Run, ` +
        `Compute Engine, GKE) with a service account attached to the instance. ` +
        `If you're running locally or on a non-GCP host, set GOOGLE_PRIVATE_KEY ` +
        `and GOOGLE_SERVICE_ACCOUNT_EMAIL instead. ` +
        `(${err instanceof Error ? err.message : String(err)})`
    );
  }

  const bodyText = await response.text();

  if (!response.ok) {
    throw new GoogleAuthError(
      `The metadata server refused to issue a token (${response.status}): ${bodyText}. ` +
        `Check that a service account is attached to this Cloud Run service / VM, and ` +
        `that it has the "${SCOPE}" scope (or is on Cloud Run, where the attached ` +
        `service account's IAM roles apply directly rather than instance scopes).`,
      response.status
    );
  }

  const payload = JSON.parse(bodyText) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new GoogleAuthError(
      'The metadata server returned a token response with no access_token.'
    );
  }

  const lifetime = payload.expires_in ?? ASSERTION_LIFETIME_SECONDS;
  return {
    accessToken: payload.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + lifetime - EXPIRY_SKEW_SECONDS,
    cacheKey: 'metadata',
  };
}

/**
 * The attached service account's own email, straight from the metadata server.
 * Used only for display (the health diagnostic) — the token flow above never
 * needs to know it, since "default" already resolves to whichever account is
 * attached.
 */
export async function getAmbientServiceAccountEmail(): Promise<string | null> {
  try {
    const response = await fetch(METADATA_EMAIL_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      cache: 'no-store',
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.text()).trim() || null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

async function requestAccessToken(): Promise<CachedToken> {
  const config = getServerConfig();

  if (config.authMode === 'key') {
    // getServerConfig() only returns authMode 'key' when both fields were
    // validated present, but the types stay nullable to keep 'metadata' mode
    // honest — so this is asserted, not re-validated.
    return requestTokenWithKey(config.clientEmail!, config.privateKey!);
  }

  return requestTokenFromMetadataServer();
}

/**
 * Returns a valid OAuth access token, reusing the cached one when possible.
 */
export async function getAccessToken(): Promise<string> {
  const config = getServerConfig();
  const cacheKey = config.authMode === 'key' ? `key:${config.clientEmail}` : 'metadata';
  const now = Math.floor(Date.now() / 1000);

  if (
    cachedToken &&
    cachedToken.cacheKey === cacheKey &&
    cachedToken.expiresAt > now
  ) {
    return cachedToken.accessToken;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const token = await requestAccessToken();
      cachedToken = token;
      return token.accessToken;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test seam: drops the cached token. */
export function resetTokenCache(): void {
  cachedToken = null;
  inFlight = null;
}
