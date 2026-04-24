import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

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

function loadFromDisk(): TokenCache {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(
      `Meta token cache not found at ${TOKEN_FILE}. Run setup first.`,
    );
  }
  const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
  return JSON.parse(raw) as TokenCache;
}

function writeToDisk(token: TokenCache): void {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
}

export function getToken(): TokenCache {
  if (!cached) {
    cached = loadFromDisk();
  }
  return cached;
}

export function getAccessToken(): string {
  return getToken().access_token;
}

export function getAdAccountId(): string {
  return getToken().ad_account_id;
}

export function getAdAccountIds(): string[] {
  const token = getToken();
  return [token.ad_account_id, ...(token.ad_account_ids || [])].filter(
    (value, index, arr) => arr.indexOf(value) === index,
  );
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

export async function refreshLongLivedToken(): Promise<TokenCache> {
  const current = getToken();
  const appSecret = process.env["META_APP_SECRET"];
  if (!appSecret) {
    throw new Error("META_APP_SECRET environment variable is not set.");
  }

  const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", current.app_id);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", current.access_token);

  logger.info("Refreshing Meta long-lived token...");
  const res = await fetch(url.toString());
  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: { message: string; code: number };
  };

  if (data.error || !data.access_token) {
    throw new Error(
      `Failed to refresh token: ${JSON.stringify(data.error || data)}`,
    );
  }

  const expiresIn = data.expires_in || 60 * 24 * 60 * 60;
  const newToken: TokenCache = {
    access_token: data.access_token,
    token_type: data.token_type || "bearer",
    expires_in: expiresIn,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    issued_at: new Date().toISOString(),
    app_id: current.app_id,
    ad_account_id: current.ad_account_id,
  };

  writeToDisk(newToken);
  cached = newToken;
  logger.info({ expires_at: newToken.expires_at }, "Token refreshed");
  return newToken;
}
