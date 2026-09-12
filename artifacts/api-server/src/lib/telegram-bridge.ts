import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { query } from "./db";

const bridgeUrl = (process.env["TELEGRAM_BRIDGE_URL"] || "").replace(/\/$/, "");
const bridgeSecret = process.env["TELEGRAM_BRIDGE_SECRET"] || "";
const keyMaterial = process.env["TELEGRAM_CREDENTIALS_KEY"] || process.env["SESSION_SECRET"] || "dev-only-change-me";
const encKey = createHash("sha256").update(keyMaterial).digest();

export function encryptTelegramValue(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${body.toString("base64")}`;
}

export function decryptTelegramValue(value: string) {
  const [ivB64, tagB64, bodyB64] = value.split(".");
  if (!ivB64 || !tagB64 || !bodyB64) throw new Error("قيمة Telegram المشفرة غير صالحة");
  const decipher = createDecipheriv("aes-256-gcm", encKey, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(bodyB64, "base64")), decipher.final()]).toString("utf8");
}

export async function telegramBridge(path: string, body?: unknown) {
  if (!bridgeUrl || !bridgeSecret) throw new Error("Telegram bridge غير مهيأ على Render");
  const response = await fetch(`${bridgeUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-bridge-secret": bridgeSecret },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `HTTP ${response.status}` }; }
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { bridgeCode: data.error });
  return data;
}

export function telegramBridgeMediaUrl(token: string) {
  return `${bridgeUrl}/media/${encodeURIComponent(token)}`;
}

export function telegramBridgeHeaders() {
  return { "x-bridge-secret": bridgeSecret };
}

export async function ensureTelegramTables() {
  await query(`CREATE TABLE IF NOT EXISTS telegram_account_connection (
    id INT PRIMARY KEY DEFAULT 1,
    api_id INT NOT NULL,
    api_hash_enc TEXT NOT NULL,
    session_enc TEXT NOT NULL,
    phone TEXT,
    account_name TEXT,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS telegram_login_attempts (
    user_id INT PRIMARY KEY,
    api_id INT NOT NULL,
    api_hash_enc TEXT NOT NULL,
    phone TEXT NOT NULL,
    phone_code_hash TEXT NOT NULL,
    temp_session_enc TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

export async function getTelegramConnection() {
  await ensureTelegramTables();
  const rows = await query<any>(`SELECT * FROM telegram_account_connection WHERE id=1 LIMIT 1`);
  if (!rows[0]) return null;
  return {
    api_id: Number(rows[0].api_id),
    api_hash: decryptTelegramValue(rows[0].api_hash_enc),
    session: decryptTelegramValue(rows[0].session_enc),
    phone: rows[0].phone,
    account_name: rows[0].account_name,
  };
}
