import { Router, type Request, type Response } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join, extname } from "path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { query } from "../lib/db";

const router = Router();
const attempts = new Map<number, { client: TelegramClient; apiId: number; apiHash: string; phone: string; phoneCodeHash: string }>();
let cachedClient: TelegramClient | null = null;

const mediaDir = process.env["TELEGRAM_MEDIA_DIR"] || "/var/data/product-hunting-telegram";
const keyMaterial = process.env["TELEGRAM_CREDENTIALS_KEY"] || process.env["SESSION_SECRET"] || "dev-only-change-me";
const encKey = createHash("sha256").update(keyMaterial).digest();

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${body.toString("base64")}`;
}
function decrypt(value: string) {
  const [ivB64, tagB64, bodyB64] = value.split(".");
  if (!ivB64 || !tagB64 || !bodyB64) throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", encKey, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(bodyB64, "base64")), decipher.final()]).toString("utf8");
}

async function ensureTable() {
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
}

export async function getTelegramClient() {
  if (cachedClient && await cachedClient.checkAuthorization()) return cachedClient;
  await ensureTable();
  const rows = await query<any>(`SELECT * FROM telegram_account_connection WHERE id = 1 LIMIT 1`);
  if (!rows[0]) return null;
  const apiId = Number(rows[0].api_id);
  const apiHash = decrypt(rows[0].api_hash_enc);
  const session = decrypt(rows[0].session_enc);
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 });
  await client.connect();
  if (!await client.checkAuthorization()) return null;
  cachedClient = client;
  return client;
}

async function saveConnected(client: TelegramClient, apiId: number, apiHash: string, phone: string) {
  await ensureTable();
  const me: any = await client.getMe();
  const accountName = [me?.firstName, me?.lastName].filter(Boolean).join(" ") || me?.username || phone;
  const session = (client.session as StringSession).save();
  await query(`INSERT INTO telegram_account_connection (id, api_id, api_hash_enc, session_enc, phone, account_name)
    VALUES (1,$1,$2,$3,$4,$5)
    ON CONFLICT (id) DO UPDATE SET api_id=EXCLUDED.api_id, api_hash_enc=EXCLUDED.api_hash_enc, session_enc=EXCLUDED.session_enc, phone=EXCLUDED.phone, account_name=EXCLUDED.account_name, updated_at=NOW()`,
    [apiId, encrypt(apiHash), encrypt(session), phone, accountName]);
  cachedClient = client;
  return accountName;
}

router.get("/telegram-account/status", async (_req: Request, res: Response) => {
  try {
    await ensureTable();
    const rows = await query<any>(`SELECT phone, account_name, connected_at, updated_at FROM telegram_account_connection WHERE id=1 LIMIT 1`);
    const client = await getTelegramClient().catch(() => null);
    res.json({ connected: Boolean(client), account: rows[0] ?? null });
  } catch (e) {
    console.error("telegram status error", e);
    res.status(500).json({ error: "تعذر فحص اتصال Telegram" });
  }
});

router.post("/telegram-account/send-code", async (req: Request, res: Response) => {
  try {
    const userId = Number(req.session?.userId);
    const apiId = Number(req.body?.api_id);
    const apiHash = String(req.body?.api_hash || "").trim();
    const phone = String(req.body?.phone || "").trim();
    if (!userId || !Number.isFinite(apiId) || !apiHash || !phone) return res.status(400).json({ error: "API ID و API Hash ورقم الهاتف مطلوبين" });
    const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3 });
    await client.connect();
    const sent = await client.sendCode({ apiId, apiHash }, phone);
    attempts.set(userId, { client, apiId, apiHash, phone, phoneCodeHash: sent.phoneCodeHash });
    res.json({ ok: true, via_app: sent.isCodeViaApp });
  } catch (e: any) {
    console.error("telegram send code error", e);
    res.status(400).json({ error: e?.errorMessage || e?.message || "تعذر إرسال كود Telegram" });
  }
});

router.post("/telegram-account/verify-code", async (req: Request, res: Response) => {
  const userId = Number(req.session?.userId);
  const attempt = attempts.get(userId);
  if (!attempt) return res.status(400).json({ error: "ابدأ بإرسال الكود أولاً" });
  try {
    const code = String(req.body?.code || "").trim();
    if (!code) return res.status(400).json({ error: "اكتب كود Telegram" });
    try {
      await attempt.client.invoke(new Api.auth.SignIn({ phoneNumber: attempt.phone, phoneCodeHash: attempt.phoneCodeHash, phoneCode: code }));
    } catch (e: any) {
      if (e?.errorMessage === "SESSION_PASSWORD_NEEDED") return res.status(200).json({ ok: true, needs_password: true });
      throw e;
    }
    const accountName = await saveConnected(attempt.client, attempt.apiId, attempt.apiHash, attempt.phone);
    attempts.delete(userId);
    res.json({ ok: true, connected: true, account_name: accountName });
  } catch (e: any) {
    res.status(400).json({ error: e?.errorMessage || e?.message || "كود Telegram غير صحيح" });
  }
});

router.post("/telegram-account/verify-password", async (req: Request, res: Response) => {
  const userId = Number(req.session?.userId);
  const attempt = attempts.get(userId);
  if (!attempt) return res.status(400).json({ error: "جلسة تسجيل الدخول انتهت" });
  try {
    const password = String(req.body?.password || "");
    await attempt.client.signInWithPassword({ apiId: attempt.apiId, apiHash: attempt.apiHash }, { password: async () => password, onError: async () => true });
    const accountName = await saveConnected(attempt.client, attempt.apiId, attempt.apiHash, attempt.phone);
    attempts.delete(userId);
    res.json({ ok: true, connected: true, account_name: accountName });
  } catch (e: any) {
    res.status(400).json({ error: e?.errorMessage || e?.message || "كلمة مرور التحقق بخطوتين غير صحيحة" });
  }
});

router.delete("/telegram-account", async (_req: Request, res: Response) => {
  await ensureTable();
  await query(`DELETE FROM telegram_account_connection WHERE id=1`);
  try { await cachedClient?.disconnect(); } catch {}
  cachedClient = null;
  res.json({ ok: true });
});

function mediaType(message: any): "image" | "video" | null {
  if (message?.photo) return "image";
  const mime = message?.document?.mimeType || "";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return null;
}
function extensionFor(message: any, type: "image" | "video") {
  const mime = message?.document?.mimeType || "";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  return type === "video" ? ".mp4" : ".jpg";
}

async function resolvePrivateEntity(client: TelegramClient, internalId: string) {
  const dialogs: any[] = await client.getDialogs({ limit: 500 });
  return dialogs.map((d: any) => d.entity).find((e: any) => e?.id?.toString?.() === internalId) || null;
}

async function messageSet(client: TelegramClient, entity: any, id: number) {
  const first: any[] = await client.getMessages(entity, { ids: [id] });
  const msg: any = first[0];
  if (!msg) return [];
  if (!msg.groupedId) return [msg];
  const ids = Array.from({ length: 21 }, (_, i) => id - 10 + i).filter(x => x > 0);
  const nearby: any[] = await client.getMessages(entity, { ids });
  return nearby.filter((m: any) => m?.groupedId?.toString?.() === msg.groupedId.toString());
}

export async function scrapePrivateTelegramLink(rawUrl: string) {
  const match = rawUrl.match(/^https?:\/\/(?:www\.)?t\.me\/c\/(\d+)\/(\d+)/i);
  if (!match) return null;
  const [, internalId, postRaw] = match;
  const postId = Number(postRaw);
  const client = await getTelegramClient();
  if (!client) return { error: "PRIVATE_TELEGRAM_NOT_CONNECTED" };
  const entity: any = await resolvePrivateEntity(client, internalId);
  if (!entity) return { error: "PRIVATE_TELEGRAM_CHANNEL_NOT_FOUND" };

  let messages = await messageSet(client, entity, postId);
  const original: any = messages[0];
  const description = original?.message || null;
  let mediaMessages = messages.filter(m => mediaType(m));
  let mediaFromPostId: number | null = null;
  if (!mediaMessages.length) {
    for (let offset = 1; offset <= 12; offset++) {
      const candidate = postId - offset;
      if (candidate <= 0) break;
      const set = await messageSet(client, entity, candidate);
      const found = set.filter(m => mediaType(m));
      if (found.length) { mediaMessages = found; mediaFromPostId = candidate; break; }
    }
  }

  await mkdir(mediaDir, { recursive: true });
  const media: Array<{ type: "image" | "video"; url: string; thumbnail_url?: string | null }> = [];
  for (const m of mediaMessages.slice(0, 20)) {
    const type = mediaType(m);
    if (!type) continue;
    const buffer: any = await client.downloadMedia(m, {});
    if (!buffer || typeof buffer === "string") continue;
    const ext = extensionFor(m, type);
    const filename = `tg-${internalId}-${m.id}-${Date.now()}${ext}`;
    await writeFile(join(mediaDir, filename), buffer);
    media.push({ type, url: `/api/product-hunting/media/${encodeURIComponent(filename)}` });
  }
  return {
    title: entity?.title || `Telegram private • ${internalId}`,
    description,
    channel_name: entity?.title || internalId,
    media,
    image_url: media.find(x => x.type === "image")?.url || null,
    media_from_post_id: mediaFromPostId ? String(mediaFromPostId) : null,
    private: true,
  };
}

router.get("/product-hunting/media/:filename", async (req: Request, res: Response) => {
  const filename = String(req.params.filename || "");
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return res.status(400).end();
  res.sendFile(join(mediaDir, filename), err => { if (err && !res.headersSent) res.status(404).end(); });
});

export default router;
