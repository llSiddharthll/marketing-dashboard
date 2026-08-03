/**
 * Server-side configuration.
 *
 * Nothing here is ever imported from a client component — the private key must
 * not reach the browser bundle. Config is read lazily so that a missing
 * variable produces a clear runtime error on the affected request instead of
 * crashing the whole build.
 */

export interface ServerConfig {
  spreadsheetId: string;
  /**
   * Present only in `key` auth mode. `null` in `metadata` mode, where the
   * identity is whichever service account the runtime has attached — nothing
   * in this app's config names it.
   */
  clientEmail: string | null;
  /** Present only in `key` auth mode; see {@link clientEmail}. */
  privateKey: string | null;
  /**
   * `key`: sign a JWT with `GOOGLE_PRIVATE_KEY` (local dev, Vercel — anywhere
   * with no ambient GCP identity).
   * `metadata`: fetch a token from the GCP metadata server using whichever
   * service account the compute environment has attached (Cloud Run, GCE,
   * GKE). No secret ever exists for this mode: there is no key to leak,
   * rotate or accidentally commit.
   *
   * Selected by whether `GOOGLE_PRIVATE_KEY` is set — there is no separate
   * on/off switch, so a deployment can't drift out of sync with which mode it
   * actually needs.
   */
  authMode: 'key' | 'metadata';
  /** IANA timezone used for all business dates (deadlines, overdue, etc.). */
  timezone: string;
}

export interface AuthConfig {
  /** Key used to sign session cookies. */
  sessionSecret: string;
  /**
   * Public origin of this deployment, e.g. https://dashboard.example.com.
   */
  appUrl: string;
  /**
   * Emails allowed to claim the first Admin account when the Users tab is
   * empty. Without this, nobody could ever grant themselves access.
   */
  initialAdminEmails: string[];
  /**
   * Optional: restrict sign-in to one email domain, e.g. "company.com".
   * Defence in depth on top of the Users allowlist.
   */
  allowedDomain: string | null;
  /**
   * The single email/password pair `/api/auth/login` accepts. There is no
   * per-user password store — anyone else on the Users tab is reached via the
   * normal allowlist once they have a way to prove who they are, which today
   * means this one shared demo login.
   */
  demoUser: { email: string; password: string };
}

export class ConfigError extends Error {
  /** The env var names that are missing or malformed. */
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `Google Sheets integration is not configured. Missing or invalid: ${missing.join(
        ', '
      )}`
    );
    this.name = 'ConfigError';
    this.missing = missing;
  }
}

/**
 * Private keys are stored in env as a single line with literal `\n` sequences
 * (the format Google's JSON key file produces once escaped). Some hosts also
 * wrap the value in quotes. Normalise both.
 */
function normalisePrivateKey(raw: string): string {
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
}

let cached: ServerConfig | null = null;

let dynamicSpreadsheetId: string | null = null;

export function setDynamicSpreadsheetId(id: string): void {
  dynamicSpreadsheetId = id;
  cached = null; // Invalidate cached server config so new spreadsheet ID takes effect immediately
}

/**
 * Returns the server config, or throws {@link ConfigError} listing exactly
 * which variables the operator needs to set.
 */
export function getServerConfig(): ServerConfig {
  if (cached) return cached;

  const spreadsheetId =
    dynamicSpreadsheetId ||
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
    '';
  const timezone = process.env.APP_TIMEZONE?.trim() || 'Asia/Kolkata';

  const missing: string[] = [];
  if (!spreadsheetId) missing.push('GOOGLE_SHEETS_SPREADSHEET_ID');

  // GOOGLE_PRIVATE_KEY absent is what selects metadata mode — deliberately not
  // a separate flag. A host with no key and no attached service account will
  // simply fail at the first real API call with a clear "not running on GCP
  // infrastructure" error from googleAuth.ts, rather than at config time here,
  // since that failure can only be confirmed by actually trying the metadata
  // server.
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY ?? '';
  const clientEmailRaw = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() ?? '';

  let clientEmail: string | null = null;
  let privateKey: string | null = null;
  let authMode: 'key' | 'metadata' = 'metadata';

  if (privateKeyRaw.trim()) {
    authMode = 'key';

    if (!clientEmailRaw) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    clientEmail = clientEmailRaw || null;

    const normalisedKey = normalisePrivateKey(privateKeyRaw);
    if (!normalisedKey.includes('BEGIN') || !normalisedKey.includes('PRIVATE KEY')) {
      // A key pasted without its PEM armour is the single most common setup
      // mistake; catching it here gives a precise message instead of an
      // opaque crypto error later.
      missing.push('GOOGLE_PRIVATE_KEY (not a valid PEM private key)');
    } else {
      privateKey = normalisedKey;
    }
  }

  if (missing.length > 0) throw new ConfigError(missing);

  cached = { spreadsheetId, clientEmail, privateKey, authMode, timezone };
  return cached;
}

/** True when every required variable is present and well-formed. */
export function isConfigured(): boolean {
  try {
    getServerConfig();
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Auth configuration                                                         */
/* -------------------------------------------------------------------------- */

/** Minimum session-secret length. 32 bytes of entropy for HMAC-SHA256. */
const MIN_SESSION_SECRET_LENGTH = 32;

let cachedAuth: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (cachedAuth) return cachedAuth;

  const sessionSecret =
    process.env.SESSION_SECRET?.trim() ||
    'default-session-secret-min-32-chars-long-for-hmac!';
  const appUrl = (process.env.APP_URL?.trim() || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  );
  const allowedDomain =
    process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, '') ||
    null;

  let initialAdminEmails = (process.env.INITIAL_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  const demoEmail = (
    process.env.DEMO_USER_EMAIL?.trim() || 'admin@marketingdashboard.com'
  ).toLowerCase();
  const demoPassword = process.env.DEMO_USER_PASSWORD?.trim() || 'password123';

  // Nothing else can sign in yet (no per-user passwords), so with no operator
  // override the demo account has to be the one that can claim the first
  // Admin seat — otherwise nobody could ever get in at all.
  if (initialAdminEmails.length === 0) {
    initialAdminEmails = [demoEmail];
  }

  const missing: string[] = [];
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    missing.push(
      `SESSION_SECRET (must be at least ${MIN_SESSION_SECRET_LENGTH} characters)`
    );
  }

  if (missing.length > 0) throw new ConfigError(missing);

  cachedAuth = {
    sessionSecret,
    appUrl,
    initialAdminEmails,
    allowedDomain,
    demoUser: { email: demoEmail, password: demoPassword },
  };
  return cachedAuth;
}

export function isAuthConfigured(): boolean {
  try {
    getAuthConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the missing auth variables without throwing, for the health endpoint.
 */
export function getMissingAuthVars(): string[] {
  try {
    getAuthConfig();
    return [];
  } catch (err) {
    return err instanceof ConfigError ? err.missing : ['unknown'];
  }
}

/** Test seam: clears the memoised config. */
export function resetServerConfigCache(): void {
  cached = null;
  cachedAuth = null;
}
