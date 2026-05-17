import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { query } from "./db";

interface TokenCache {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: string;
  issued_at: string;
  app_id: string;
  ad_account_id: string;
  ad_account_ids?: string[];
}

function findWorkspaceRoot(start: string): string {
  let dir = path.resolve(start);
  while (dir !== "/") {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Could not find workspace root from " + start);
}

const WORKSPACE_ROOT = findWorkspaceRoot(process.cwd());
const TOKEN_FILE = path.join(WORKSPACE_ROOT, ".local/meta/token-cache.json");

let cached: TokenCache | null = null;

function writeToDisk(token: TokenCache): void {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
  } catch {
    // disk write is best-effort — DB is the real store in production
  }
}

function buildFromEnv(): TokenCache {
  const token = process.env["META_ACCESS_TOKEN"];
  if (!token) {
    throw new Error(
      "No Meta token available. Set META_ACCESS_TOKEN environment variable or use the admin panel to save a new token.",
    );
  }
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: 0,
    expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    issued_at: new Date().toISOString(),
    app_id: process.env["META_APP_ID"] ?? "",
    ad_account_id: "1714386865726065",
  };
}

// ── DB persistence ─────────────────────────────────────────────────────────────

/**
 * Called once after DB migrations complete.
 * Loads the most recent token from meta_tokens table into the in-memory cache.
 * Falls back to ENV if table is empty.
 */
export async function initTokenFromDb(): Promise<void> {
  try {
    const rows = await query<{
      access_token: string;
      app_id: string;
      expires_at: string;
      issued_at: string;
    }>(
      `SELECT access_token, app_id, expires_at, issued_at
       FROM meta_tokens
       ORDER BY id DESC
       LIMIT 1`,
    );
    if (rows.length > 0 && rows[0]!.access_token) {
      const row = rows[0]!;
      cached = {
        access_token: row.access_token,
        token_type: "bearer",
        expires_in: 0,
        expires_at:
          row.expires_at ??
          new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        issued_at: row.issued_at ?? new Date().toISOString(),
        app_id: row.app_id ?? process.env["META_APP_ID"] ?? "",
        ad_account_id: "1714386865726065",
      };
      logger.info(
        { expires_at: cached.expires_at },
        "Meta token loaded from DB",
      );
    } else {
      logger.info(
        "meta_tokens table empty — falling back to META_ACCESS_TOKEN env var",
      );
    }
  } catch (err) {
    logger.warn({ err }, "initTokenFromDb: failed, falling back to env var");
  }
}

async function storeTokenInDb(token: TokenCache): Promise<void> {
  await query(
    `INSERT INTO meta_tokens (access_token, app_id, expires_at, issued_at)
     VALUES ($1, $2, $3, $4)`,
    [token.access_token, token.app_id, token.expires_at, token.issued_at],
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function getToken(): TokenCache {
  if (!cached) {
    cached = buildFromEnv();
  }
  return cached;
}

export function getAccessToken(): string {
  return getToken().access_token;
}

export function getAdAccountId(): string {
  return "1714386865726065";
}

export function getAdAccountIds(): string[] {
  return ["1714386865726065", "838054421405431", "898360605246408"];
}

export function getAppId(): string {
  return getToken().app_id;
}

export function getTokenInfo() {
  const t = getToken();
  const expiresAt = new Date(t.expires_at);
  const now = new Date();
  const daysLeft = Math.floor(
    (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  return {
    issued_at: t.issued_at,
    expires_at: t.expires_at,
    days_left: daysLeft,
    app_id: t.app_id,
    ad_account_id: t.ad_account_id,
    needs_refresh: daysLeft < 14,
  };
}

/**
 * Validate the token against the real Facebook API.
 * Calls GET /me?fields=id — succeeds if token is valid, fails if expired.
 */
export async function validateTokenWithMeta(): Promise<{
  valid: boolean;
  user_id?: string;
  error?: string;
}> {
  const token = getToken();
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id&access_token=${encodeURIComponent(token.access_token)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const data = (await res.json()) as Record<string, unknown>;
    if (data["error"]) {
      const err = data["error"] as Record<string, unknown>;
      return {
        valid: false,
        error: String(err["message"] ?? err["type"] ?? "Token invalid"),
      };
    }
    return { valid: true, user_id: String(data["id"] ?? "") };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Admin endpoint: save a brand-new access token (e.g. after manual refresh).
 * Stores in DB and updates in-memory cache.
 */
export async function updateAccessToken(
  accessToken: string,
  appId?: string,
  expiresAt?: string,
): Promise<TokenCache> {
  const resolvedAppId =
    appId?.trim() ||
    cached?.app_id ||
    process.env["META_APP_ID"] ||
    "";
  const resolvedExpiresAt =
    expiresAt ??
    new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const issuedAt = new Date().toISOString();
  const newToken: TokenCache = {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 60 * 24 * 60 * 60,
    expires_at: resolvedExpiresAt,
    issued_at: issuedAt,
    app_id: resolvedAppId,
    ad_account_id: "1714386865726065",
  };
  await storeTokenInDb(newToken);
  cached = newToken;
  writeToDisk(newToken);
  logger.info({ expires_at: newToken.expires_at }, "Meta token updated by admin");
  return newToken;
}

/**
 * Exchange the current token for a new long-lived token (60 days).
 * Requires META_APP_SECRET in env AND app_id stored in DB or META_APP_ID env.
 * Only works if the current token is still VALID — cannot revive an expired token.
 */
export async function refreshLongLivedToken(): Promise<TokenCache> {
  const current = getToken();
  const appSecret = process.env["META_APP_SECRET"];
  if (!appSecret) {
    throw new Error(
      "META_APP_SECRET غير موجود في متغيرات البيئة — لا يمكن تجديد الـ token.",
    );
  }

  const appId = current.app_id || process.env["META_APP_ID"] || "";
  if (!appId) {
    throw new Error(
      "App ID غير متاح — أدخل الـ Meta App ID في لوحة الإدارة أولاً ثم أعِد المحاولة.",
    );
  }

  const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", current.access_token);

  logger.info({ appId }, "Refreshing Meta long-lived token...");
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: { message: string; code: number; error_subcode?: number };
  };

  if (data.error || !data.access_token) {
    const errMsg = data.error?.message ?? JSON.stringify(data);
    throw new Error(`فشل تجديد الـ token: ${errMsg}`);
  }

  const expiresIn = data.expires_in ?? 60 * 24 * 60 * 60;
  const newToken: TokenCache = {
    access_token: data.access_token,
    token_type: data.token_type ?? "bearer",
    expires_in: expiresIn,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    issued_at: new Date().toISOString(),
    app_id: appId,
    ad_account_id: current.ad_account_id,
  };

  await storeTokenInDb(newToken);
  cached = newToken;
  writeToDisk(newToken);
  logger.info({ expires_at: newToken.expires_at }, "Token refreshed successfully");
  return newToken;
}
