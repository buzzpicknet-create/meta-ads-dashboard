import { Router, type Request, type Response } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { query } from "../lib/db";
import { logger } from "../lib/logger";
import { sendPushForEvent } from "../lib/push";

const router = Router();

// ── Singleton Pipeboard client for Meta Ads write actions ─────────────────────
let _pbWriteClient: Client | null = null;
let _pbWriteConnecting: Promise<Client> | null = null;

async function getPipeboardWriteClient(): Promise<Client> {
  if (_pbWriteClient) return _pbWriteClient;
  if (_pbWriteConnecting) return _pbWriteConnecting;

  _pbWriteConnecting = (async () => {
    const token = process.env.PIPEBOARD_API_TOKEN;
    if (!token) throw new Error("PIPEBOARD_API_TOKEN not set");
    const c = new Client({ name: "meta-ads-dashboard", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.pipeboard.co/meta-ads-mcp"),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    );
    await c.connect(transport);
    _pbWriteClient = c;
    _pbWriteConnecting = null;
    logger.info("Pipeboard write singleton connected");
    return c;
  })();

  try {
    return await _pbWriteConnecting;
  } catch (err) {
    _pbWriteConnecting = null;
    throw err;
  }
}

// ── Singleton Pipeboard client for Google Ads write actions ───────────────────
let _gaWriteClient: Client | null = null;
let _gaWriteConnecting: Promise<Client> | null = null;

async function getGoogleAdsWriteClient(): Promise<Client> {
  if (_gaWriteClient) return _gaWriteClient;
  if (_gaWriteConnecting) return _gaWriteConnecting;

  _gaWriteConnecting = (async () => {
    const token = process.env.PIPEBOARD_API_TOKEN;
    if (!token) throw new Error("PIPEBOARD_API_TOKEN not set");
    const c = new Client({ name: "google-ads-dashboard", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.pipeboard.co/google-ads-mcp"),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    );
    await c.connect(transport);
    _gaWriteClient = c;
    _gaWriteConnecting = null;
    logger.info("Google Ads write singleton connected");
    return c;
  })();

  try {
    return await _gaWriteConnecting;
  } catch (err) {
    _gaWriteConnecting = null;
    throw err;
  }
}

const GA_WRITE_TOOLS = new Set([
  "ga_pause_campaign", "ga_enable_campaign", "ga_update_campaign_budget",
  "ga_update_keyword_bid", "ga_pause_keyword", "ga_enable_keyword",
]);

const NO_OP_DAILY_THRESHOLD = 3;
const NO_OP_SPIKE_EVENT = "no_op_spike";
const NO_OP_SPIKE_URL = "/activity?noOp=1";

async function checkAndNotifyNoOpSpike(): Promise<void> {
  try {
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM pipeboard_actions
       WHERE is_no_op = TRUE
         AND executed_at >= CURRENT_DATE`,
      []
    );
    const todayCount = parseInt(countRows[0]?.count ?? "0", 10);

    if (todayCount < NO_OP_DAILY_THRESHOLD) return;

    // Dedup: only send one notification per day for this event.
    // Match on the event URL rather than title text so it's resilient to
    // copy/localization changes.
    const already = await query<{ id: number }>(
      `SELECT id FROM notification_log
       WHERE url = $1
         AND sent_at >= CURRENT_DATE
       LIMIT 1`,
      [NO_OP_SPIKE_URL]
    );
    if (already.length > 0) return;

    // Route through sendPushForEvent so notification_settings controls
    // whether this fires and which roles receive it.
    await sendPushForEvent(NO_OP_SPIKE_EVENT, {
      title: "⚠️ تكرار إجراءات الذكاء الاصطناعي",
      body: `تم تسجيل ${todayCount} إجراء مكرر (No-Op) اليوم — راجع سجل النشاط`,
      url: NO_OP_SPIKE_URL,
    });

    logger.info({ todayCount }, "No-op spike push notification sent to admins");
  } catch (err) {
    logger.warn({ err }, "checkAndNotifyNoOpSpike failed");
  }
}

// ── Meta error extractor ──────────────────────────────────────────────────────
// Pulls the human-readable error fields (error_user_msg, error_user_title,
// message) from a Meta Graph API error JSON string. Falls back to raw text.
function extractMetaError(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    const obj = parsed as Record<string, unknown>;
    const err = (obj?.error ?? obj) as Record<string, unknown>;
    const userMsg  = (err?.error_user_msg  ?? err?.error_user_title ?? err?.message) as string | undefined;
    const code     = err?.code       ? `code: ${err.code}`        : "";
    const subcode  = err?.error_subcode ? `, subcode: ${err.error_subcode}` : "";
    const suffix   = code ? ` (${code}${subcode})` : "";
    if (userMsg) return `${userMsg}${suffix}`;
  } catch { /* not JSON — fall through */ }
  return raw.slice(0, 350);
}

// ── Standard Write Contract — shared helpers ───────────────────────────────────
interface MetaErrorDetails {
  code?: number;
  message?: string;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

function parseMetaErrorDetails(raw: string): MetaErrorDetails {
  const codeMatch    = raw.match(/"code"\s*:\s*(\d+)/);
  const subMatch     = raw.match(/"error_subcode"\s*:\s*(\d+)/);
  const msgMatch     = raw.match(/"message"\s*:\s*"([^"]+)"/) ?? raw.match(/"error"\s*:\s*"([^"]+)"/);
  const titleMatch   = raw.match(/"error_user_title"\s*:\s*"([^"]+)"/);
  const userMsgMatch = raw.match(/"error_user_msg"\s*:\s*"([^"]+)"/);
  const traceMatch   = raw.match(/"fbtrace_id"\s*:\s*"([^"]+)"/);
  return {
    code:             codeMatch?.[1]    ? Number(codeMatch[1])    : undefined,
    message:          msgMatch?.[1]     ?? raw.slice(0, 400),
    error_subcode:    subMatch?.[1]     ? Number(subMatch[1])     : undefined,
    error_user_title: titleMatch?.[1]   ?? undefined,
    error_user_msg:   userMsgMatch?.[1] ?? undefined,
    fbtrace_id:       traceMatch?.[1]   ?? undefined,
  };
}

interface VerifyResult {
  verified: boolean;
  verified_fields?: Record<string, unknown>;
  meta_error?: MetaErrorDetails;
}

async function verifyMetaEntityDirect(id: string, fields: string, token: string): Promise<VerifyResult> {
  if (!token) return { verified: false, meta_error: { message: "META_ACCESS_TOKEN missing" } };
  try {
    const url = new URL(`https://graph.facebook.com/v21.0/${id}`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("access_token", token);
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const json = await resp.json() as Record<string, unknown>;
    if (json.error) {
      const ve = typeof json.error === "object" && json.error !== null
        ? json.error as Record<string, unknown> : {};
      return {
        verified: false,
        meta_error: {
          code:          ve.code          != null ? Number(ve.code)          : undefined,
          message:       String(ve.message ?? `Meta returned error for ${id}`),
          error_subcode: ve.error_subcode != null ? Number(ve.error_subcode) : undefined,
          fbtrace_id:    ve.fbtrace_id    != null ? String(ve.fbtrace_id)    : undefined,
        },
      };
    }
    return { verified: true, verified_fields: json };
  } catch (err) {
    return { verified: false, meta_error: { message: err instanceof Error ? err.message : String(err) } };
  }
}

// ── POST /api/pipeboard/action ─────────────────────────────────
router.post("/pipeboard/action", async (req: Request, res: Response) => {
  const role = req.session?.role;
  if (role !== "admin" && role !== "media_buyer") {
    res.status(403).json({ error: "غير مصرح — هذه الميزة للأدمن والميدياباير فقط" });
    return;
  }

  const { tool, args, isNoOp: isNoOpRaw } = req.body as { tool: string; args: Record<string, unknown>; isNoOp?: unknown };
  const isNoOp = isNoOpRaw === true;

  const ALLOWED_TOOLS = new Set([
    "pause_campaign",
    "enable_campaign",
    "update_campaign_budget",
    "rename_campaign",
    "pause_adset",
    "enable_adset",
    "update_adset_budget",
    "rename_adset",
    "pause_ad",
    "enable_ad",
    "rename_ad",
    "duplicate_adset",
    "create_campaign",
    "create_adset",
    "duplicate_campaign",
    "launch_pipeboard_campaign",
    "duplicate_ad",
    "create_ad_from_post",
    "create_ad_from_existing_post",
    // Google Ads
    "ga_pause_campaign",
    "ga_enable_campaign",
    "ga_update_campaign_budget",
    "ga_update_keyword_bid",
    "ga_pause_keyword",
    "ga_enable_keyword",
  ]);

  if (!tool || !ALLOWED_TOOLS.has(tool)) {
    res.status(400).json({ error: `أداة غير مسموح بها: ${tool ?? "(فارغ)"}` });
    return;
  }

  const token = process.env.PIPEBOARD_API_TOKEN;
  if (!token) {
    res.status(500).json({ error: "PIPEBOARD_API_TOKEN غير مضبوط على السيرفر" });
    return;
  }

  const executedBy = req.session?.username ?? "admin";

  // ── Translate our internal tool names → actual Pipeboard MCP tool names ──
  // Our AI uses friendly names; Pipeboard uses update_campaign / update_adset.
  // Budgets from the AI are in EGP (already divided by 100 by getCampaignDetails).
  // Pipeboard / Meta API expects cents → multiply by 100.
  function translateToMcp(t: string, a: Record<string, unknown>): { mcpTool: string; mcpArgs: Record<string, unknown> } {
    const egpToCents = (v: unknown) => Math.round(Number(v) * 100);
    switch (t) {
      case "pause_campaign":
        return { mcpTool: "update_campaign", mcpArgs: { campaign_id: a.campaign_id, status: "PAUSED" } };
      case "enable_campaign":
        return { mcpTool: "update_campaign", mcpArgs: { campaign_id: a.campaign_id, status: "ACTIVE" } };
      case "update_campaign_budget": {
        const field = a.budget_type === "lifetime" ? "lifetime_budget" : "daily_budget";
        return { mcpTool: "update_campaign", mcpArgs: { campaign_id: a.campaign_id, [field]: egpToCents(a.budget_amount) } };
      }
      case "pause_adset":
        return { mcpTool: "update_adset", mcpArgs: { adset_id: a.adset_id, status: "PAUSED" } };
      case "enable_adset":
        return { mcpTool: "update_adset", mcpArgs: { adset_id: a.adset_id, status: "ACTIVE" } };
      case "update_adset_budget":
        return { mcpTool: "update_adset", mcpArgs: { adset_id: a.adset_id, daily_budget: egpToCents(a.budget_amount) } };
      case "pause_ad":
        return { mcpTool: "update_ad", mcpArgs: { ad_id: a.ad_id, status: "PAUSED" } };
      case "enable_ad":
        return { mcpTool: "update_ad", mcpArgs: { ad_id: a.ad_id, status: "ACTIVE" } };
      case "rename_campaign":
        return { mcpTool: "update_campaign", mcpArgs: { campaign_id: a.campaign_id, name: a.new_name } };
      case "rename_adset":
        return { mcpTool: "update_adset", mcpArgs: { adset_id: a.adset_id, name: a.new_name } };
      case "rename_ad":
        return { mcpTool: "update_ad", mcpArgs: { ad_id: a.ad_id, name: a.new_name } };
      case "create_campaign": {
        // Normalise account_id: Pipeboard expects the bare numeric ID (no act_ prefix)
        const rawAccId = String(a.account_id ?? "");
        const normAccId = rawAccId.startsWith("act_") ? rawAccId.slice(4) : rawAccId;
        // special_ad_categories: AI may send a string "NONE" or empty string → normalise to array
        const rawSac = a.special_ad_categories;
        const sacArr = Array.isArray(rawSac)
          ? rawSac
          : (typeof rawSac === "string" && rawSac && rawSac !== "NONE")
            ? [rawSac]
            : [];
        return {
          mcpTool: "create_campaign",
          mcpArgs: {
            account_id: normAccId, name: a.name, objective: a.objective,
            status: a.status ?? "PAUSED",
            special_ad_categories: sacArr,
            ...(a.daily_budget != null ? { daily_budget: egpToCents(a.daily_budget) } : {}),
          },
        };
      }
      case "create_adset": {
        const rawAccId2 = String(a.account_id ?? "");
        const normAccId2 = rawAccId2.startsWith("act_") ? rawAccId2.slice(4) : rawAccId2;
        const { account_id: _drop, daily_budget: _db, ...restAdset } = a as Record<string, unknown>;
        void _drop; void _db;
        return {
          mcpTool: "create_adset",
          mcpArgs: {
            ...restAdset,
            account_id: normAccId2,
            ...(a.daily_budget != null ? { daily_budget: egpToCents(a.daily_budget) } : {}),
          },
        };
      }
      // duplicate_adset, duplicate_campaign — same name, no budget conversion needed
      default:
        return { mcpTool: t, mcpArgs: a };
    }
  }

  // ── Google Ads translation ────────────────────────────────────────────────
  // Budgets from AI are in EGP; Google Ads API expects micros (×1,000,000).
  function translateToGoogleAdsMcp(t: string, a: Record<string, unknown>): { mcpTool: string; mcpArgs: Record<string, unknown> } {
    const egpToMicros = (v: unknown) => Math.round(Number(v) * 1_000_000);
    switch (t) {
      case "ga_pause_campaign":
        return { mcpTool: "pause_google_ads_campaign", mcpArgs: { customer_id: a.customer_id, campaign_id: a.campaign_id } };
      case "ga_enable_campaign":
        return { mcpTool: "enable_google_ads_campaign", mcpArgs: { customer_id: a.customer_id, campaign_id: a.campaign_id } };
      case "ga_update_campaign_budget":
        // Correct param is budget_amount_micros (not daily_budget_micros)
        return { mcpTool: "update_google_ads_campaign", mcpArgs: { customer_id: a.customer_id, campaign_id: a.campaign_id, budget_amount_micros: egpToMicros(a.budget_amount) } };
      case "ga_update_keyword_bid": {
        // API accepts either criterion_id (singular) + cpc_bid_micros for one keyword,
        // or keyword_bids array for batch. AI sends criterion_ids (array) + cpc_bid_egp.
        const bidMicros = egpToMicros(a.cpc_bid_egp);
        const ids = Array.isArray(a.criterion_ids) ? (a.criterion_ids as string[]) : [String(a.criterion_ids ?? "")];
        if (ids.length === 1) {
          return { mcpTool: "update_google_ads_keyword_bid", mcpArgs: { customer_id: a.customer_id, ad_group_id: a.ad_group_id, criterion_id: ids[0], cpc_bid_micros: bidMicros } };
        }
        return { mcpTool: "update_google_ads_keyword_bid", mcpArgs: { customer_id: a.customer_id, ad_group_id: a.ad_group_id, keyword_bids: ids.map(id => ({ criterion_id: id, cpc_bid_micros: bidMicros })) } };
      }
      case "ga_pause_keyword":
        return { mcpTool: "pause_google_ads_keyword", mcpArgs: { customer_id: a.customer_id, ad_group_id: a.ad_group_id, criterion_ids: a.criterion_ids } };
      case "ga_enable_keyword":
        return { mcpTool: "enable_google_ads_keyword", mcpArgs: { customer_id: a.customer_id, ad_group_id: a.ad_group_id, criterion_ids: a.criterion_ids } };
      default:
        return { mcpTool: t, mcpArgs: a };
    }
  }

  // ── Special: duplicate_ad — direct Meta Graph API POST /{ad_id}/copies ──────
  if (tool === "duplicate_ad") {
    const adId = String(args?.ad_id ?? "");
    const destAdsetId = String(args?.destination_adset_id ?? "");
    const adLabel = String(args?.name ?? adId);
    if (!adId) { res.status(400).json({ error: "ad_id مطلوب" }); return; }
    if (!destAdsetId) { res.status(400).json({ error: "destination_adset_id مطلوب" }); return; }

    const metaToken = process.env.META_ACCESS_TOKEN;
    if (!metaToken) { res.status(500).json({ error: "META_ACCESS_TOKEN غير مضبوط" }); return; }

    let dupSuccess = false;
    let dupMsg = "";
    let dupNewAdId = "";
    let dupVerify: VerifyResult = { verified: false };
    let dupMetaError: MetaErrorDetails | null = null;

    try {
      const body = new URLSearchParams({
        access_token: metaToken,
        adset_id: destAdsetId,
        status_option: "PAUSED",
      });
      const resp = await fetch(`https://graph.facebook.com/v21.0/${adId}/copies`, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(30_000),
      });
      const json = await resp.json() as Record<string, unknown>;
      logger.info({ json: JSON.stringify(json).slice(0, 400) }, "duplicate_ad: Meta response");

      if (json.error) {
        const e = json.error as Record<string, unknown>;
        dupMetaError = {
          code:             e.code            != null ? Number(e.code)           : undefined,
          message:          String(e.error_user_msg ?? e.message ?? "خطأ Meta غير معروف"),
          error_subcode:    e.error_subcode    != null ? Number(e.error_subcode)  : undefined,
          error_user_title: e.error_user_title != null ? String(e.error_user_title) : undefined,
          error_user_msg:   e.error_user_msg   != null ? String(e.error_user_msg)   : undefined,
          fbtrace_id:       e.fbtrace_id       != null ? String(e.fbtrace_id)     : undefined,
        };
        throw new Error(
          `فشل نسخ الإعلان — ${String(dupMetaError.message)}` +
          (dupMetaError.code         ? ` (code: ${dupMetaError.code})`                : "") +
          (dupMetaError.error_subcode ? `, subcode: ${dupMetaError.error_subcode}`    : "") +
          (dupMetaError.fbtrace_id   ? ` | fbtrace_id: ${dupMetaError.fbtrace_id}`   : "")
        );
      }

      // Extract new_ad_id — fail hard if missing
      const copiesArr = Array.isArray(json.copies) ? json.copies as Array<Record<string, unknown>> : [];
      dupNewAdId = String(copiesArr[0]?.id ?? json.id ?? json.copied_ad_id ?? "");
      if (!dupNewAdId) {
        dupMetaError = { message: "Meta لم يُعد ad_id للإعلان المنسوخ", ...parseMetaErrorDetails(JSON.stringify(json)) };
        throw new Error("duplicate_ad: لم يُعد Meta أي id للإعلان المنسوخ");
      }

      // Verify immediately
      dupVerify = await verifyMetaEntityDirect(
        dupNewAdId,
        "id,name,status,effective_status,adset_id,campaign_id,created_time,updated_time,creative{id,object_story_id}",
        metaToken
      );
      if (!dupVerify.verified) {
        dupMetaError = dupVerify.meta_error ?? { message: `verify failed for new_ad_id ${dupNewAdId}` };
        throw new Error(
          `duplicate_ad: Pipeboard أعطى id=${dupNewAdId} لكن Meta فشل التحقق — ${String(dupMetaError.message)}`
        );
      }

      dupSuccess = true;
      dupMsg = [
        `تم نسخ الإعلان "${adLabel}"`,
        `new_ad_id: ${dupNewAdId}`,
        `source_ad_id: ${adId}`,
        `destination_adset_id: ${destAdsetId}`,
        `الحالة: ${String(dupVerify.verified_fields?.effective_status ?? "PAUSED")}`,
      ].join(" — ");

    } catch (err) {
      dupMsg = err instanceof Error ? err.message : String(err);
    }

    await query(
      `INSERT INTO pipeboard_actions
         (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [executedBy, tool, JSON.stringify(args ?? {}), dupSuccess, dupMsg, adLabel, null, false]
    ).catch((e: unknown) => logger.warn({ e }, "pipeboard audit insert failed"));

    if (dupSuccess) {
      res.json({
        success: true, message: dupMsg,
        new_ad_id: dupNewAdId,
        source_ad_id: adId,
        destination_adset_id: destAdsetId,
        verified: true,
        verified_fields: dupVerify.verified_fields,
      });
    } else {
      res.status(500).json({ error: dupMsg, ...(dupMetaError ? { meta_error: dupMetaError } : {}) });
    }
    return;
  }

  // ── Special multi-step: create_ad_from_post ───────────────────────────────
  if (tool === "create_ad_from_post") {
    const rawAccountId = String(args?.account_id ?? "");
    const accountId = rawAccountId.startsWith("act_") ? rawAccountId.slice(4) : rawAccountId;
    const accountIdWithAct = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;
    const adsetId = String(args?.adset_id ?? "");
    const postId = String(args?.post_id ?? "");
    const adName = String(args?.ad_name ?? args?.name ?? "إعلان من منشور");
    if (!adsetId || !postId) {
      res.status(400).json({ error: "adset_id و post_id مطلوبان" });
      return;
    }

    function mcpTextLocal(result: unknown): string {
      return ((result as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("")
        .trim();
    }

    let cafpSuccess = false;
    let cafpMsg = "";
    try {
      const client = await getPipeboardWriteClient();

      // Step 1: Get page_id (auto-fetch if not provided)
      let pageId = String(args?.page_id ?? "").trim();
      if (!pageId && accountId) {
        try {
          const pagesResult = await client.callTool({ name: "get_account_pages", arguments: { account_id: accountId } });
          const pagesText = mcpTextLocal(pagesResult);
          const pageMatch = pagesText.match(/"id"\s*:\s*"(\d+)"/) ?? pagesText.match(/\b(\d{10,})\b/);
          pageId = pageMatch?.[1] ?? "";
          if (!pageId) logger.warn("create_ad_from_post: get_account_pages — no page_id found");
        } catch (e) {
          logger.warn({ e }, "create_ad_from_post: get_account_pages threw");
        }
      }
      if (!pageId) throw new Error("تعذّر جلب page_id للحساب — أرسل page_id يدوياً في الأمر");

      const objectStoryId = `${pageId}_${postId}`;

      // Step 2: create_ad_creative using existing post
      const creativeArgs: Record<string, unknown> = {
        account_id: accountId,
        name: `${adName} — creative`,
        page_id: pageId,
        object_story_id: objectStoryId,
      };
      const creativeResult = await client.callTool({ name: "create_ad_creative", arguments: creativeArgs });
      const creativeText = mcpTextLocal(creativeResult);
      logger.info({ creativeText }, "create_ad_from_post: create_ad_creative");
      const hasRealId = /"id"\s*:\s*"(\d{10,})"/.test(creativeText);
      if (/"error"/.test(creativeText) && !hasRealId) {
        throw new Error(`فشل إنشاء creative — ${extractMetaError(creativeText)}`);
      }
      const creativeMatch = creativeText.match(/"id"\s*:\s*"(\d{10,})"/);
      const creativeId = creativeMatch?.[1] ?? "";
      if (!creativeId) throw new Error(`لم يُعاد creative_id — ${extractMetaError(creativeText)}`);

      // Step 3: create_ad
      const adResult = await client.callTool({
        name: "create_ad",
        arguments: {
          account_id: accountIdWithAct,
          name: adName,
          adset_id: adsetId,
          creative_id: creativeId,
          status: "PAUSED",
        },
      });
      const adText = mcpTextLocal(adResult);
      logger.info({ adText }, "create_ad_from_post: create_ad");
      if (/"error"/.test(adText) && !/"id"/.test(adText)) {
        throw new Error(`فشل create_ad — ${extractMetaError(adText)}`);
      }
      const adMatch = adText.match(/"id"\s*:\s*"(\d+)"/) ?? adText.match(/\b(\d{10,})\b/);
      const newAdId = adMatch?.[1] ?? "";
      if (!newAdId) throw new Error(`لم يُعد ad_id — ${extractMetaError(adText)}`);

      // Verify immediately (Standard Write Contract)
      const cafpVerify = await verifyMetaEntityDirect(
        newAdId,
        "id,name,status,effective_status,adset_id,campaign_id,created_time,updated_time",
        process.env.META_ACCESS_TOKEN ?? ""
      );
      if (!cafpVerify.verified) {
        const ve = cafpVerify.meta_error ?? {};
        throw new Error(`create_ad_from_post: Pipeboard أعطى id=${newAdId} لكن Meta فشل التحقق — ${String(ve.message ?? "")}${ve.fbtrace_id ? ` | fbtrace_id: ${ve.fbtrace_id}` : ""}`);
      }

      cafpSuccess = true;
      cafpMsg = [
        `تم إنشاء الإعلان من المنشور ${postId}`,
        `new_ad_id: ${newAdId}`,
        `adset_id: ${adsetId}`,
        `object_story_id: ${objectStoryId}`,
        `الحالة: ${String(cafpVerify.verified_fields?.effective_status ?? "PAUSED")}`,
      ].join(" — ");

      // Store new_ad_id for response
      (args as Record<string, unknown>).__new_ad_id = newAdId;
      (args as Record<string, unknown>).__cafpVerify = cafpVerify;
    } catch (err) {
      cafpMsg = err instanceof Error ? err.message : String(err);
      _pbWriteClient = null;
      _pbWriteConnecting = null;
    }

    await query(
      `INSERT INTO pipeboard_actions
         (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [executedBy, tool, JSON.stringify(args ?? {}), cafpSuccess, cafpMsg, null, String(args?.adset_id ?? ""), false]
    ).catch((e: unknown) => logger.warn({ e }, "pipeboard audit insert failed"));

    if (cafpSuccess) {
      const newAdIdOut = String((args as Record<string, unknown>).__new_ad_id ?? "");
      const cafpV = (args as Record<string, unknown>).__cafpVerify as VerifyResult | undefined;
      res.json({
        success: true, message: cafpMsg,
        new_ad_id: newAdIdOut,
        adset_id: String(args?.adset_id ?? ""),
        object_story_id: String(args?.object_story_id ?? `${args?.page_id ?? ""}_${args?.post_id ?? ""}`),
        verified: true,
        verified_fields: cafpV?.verified_fields,
      });
    } else {
      res.status(500).json({ error: cafpMsg });
    }
    return;
  }

  // ── create_ad_from_existing_post — accepts object_story_id directly OR post_id+page_id ──
  if (tool === "create_ad_from_existing_post") {
    const rawAccountId = String(args?.account_id ?? "");
    const accountId = rawAccountId.startsWith("act_") ? rawAccountId.slice(4) : rawAccountId;
    const accountIdWithAct = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;
    const adsetId = String(args?.adset_id ?? "");
    const adName = String(args?.ad_name ?? args?.name ?? "إعلان من منشور");

    // Accept object_story_id directly OR construct from page_id + post_id
    let objectStoryId = String(args?.object_story_id ?? "").trim();
    let pageId = String(args?.page_id ?? "").trim();
    let postId = String(args?.post_id ?? "").trim();

    if (!adsetId) {
      res.status(400).json({ error: "adset_id مطلوب" });
      return;
    }
    if (!objectStoryId && !postId) {
      res.status(400).json({ error: "object_story_id أو post_id مطلوب" });
      return;
    }

    function mcpTextEfp(result: unknown): string {
      return ((result as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("")
        .trim();
    }

    let efpSuccess = false;
    let efpMsg = "";
    try {
      const client = await getPipeboardWriteClient();

      // If object_story_id given, extract page_id + post_id from it
      if (objectStoryId && !pageId) {
        const parts = objectStoryId.split("_");
        pageId = parts[0] ?? "";
        if (!postId) postId = parts.slice(1).join("_");
      }

      // If only post_id given, auto-fetch page_id
      if (!pageId && accountId) {
        try {
          const pagesResult = await client.callTool({ name: "get_account_pages", arguments: { account_id: accountId } });
          const pagesText = mcpTextEfp(pagesResult);
          const pageMatch = pagesText.match(/"id"\s*:\s*"(\d+)"/) ?? pagesText.match(/\b(\d{10,})\b/);
          pageId = pageMatch?.[1] ?? "";
          if (!pageId) logger.warn("create_ad_from_existing_post: get_account_pages — no page_id found");
        } catch (e) {
          logger.warn({ e }, "create_ad_from_existing_post: get_account_pages threw");
        }
      }
      if (!pageId) throw new Error("تعذّر جلب page_id للحساب — أرسل page_id أو object_story_id يدوياً");

      if (!objectStoryId) objectStoryId = `${pageId}_${postId}`;

      // create_ad_creative using object_story_id
      const creativeArgs: Record<string, unknown> = {
        account_id: accountId,
        name: `${adName} — creative`,
        page_id: pageId,
        object_story_id: objectStoryId,
      };
      const creativeResult = await client.callTool({ name: "create_ad_creative", arguments: creativeArgs });
      const creativeText = mcpTextEfp(creativeResult);
      logger.info({ creativeText }, "create_ad_from_existing_post: create_ad_creative");
      const hasRealIdEfp = /"id"\s*:\s*"(\d{10,})"/.test(creativeText);
      if (/"error"/.test(creativeText) && !hasRealIdEfp) {
        throw new Error(`فشل إنشاء creative — ${extractMetaError(creativeText)}`);
      }
      const creativeMatch = creativeText.match(/"id"\s*:\s*"(\d{10,})"/);
      const creativeId = creativeMatch?.[1] ?? "";
      if (!creativeId) throw new Error(`لم يُعاد creative_id — ${extractMetaError(creativeText)}`);

      // create_ad
      const adResult = await client.callTool({
        name: "create_ad",
        arguments: {
          account_id: accountIdWithAct,
          name: adName,
          adset_id: adsetId,
          creative_id: creativeId,
          status: "PAUSED",
        },
      });
      const adText = mcpTextEfp(adResult);
      logger.info({ adText }, "create_ad_from_existing_post: create_ad");
      if (/"error"/.test(adText) && !/"id"/.test(adText)) {
        throw new Error(`فشل create_ad — ${extractMetaError(adText)}`);
      }
      const adMatch = adText.match(/"id"\s*:\s*"(\d+)"/) ?? adText.match(/\b(\d{10,})\b/);
      const newAdId = adMatch?.[1] ?? "";
      if (!newAdId) throw new Error(`لم يُعد ad_id — ${extractMetaError(adText)}`);

      // Verify immediately (Standard Write Contract)
      const efpVerify = await verifyMetaEntityDirect(
        newAdId,
        "id,name,status,effective_status,adset_id,campaign_id,created_time,updated_time",
        process.env.META_ACCESS_TOKEN ?? ""
      );
      if (!efpVerify.verified) {
        const ve = efpVerify.meta_error ?? {};
        throw new Error(`create_ad_from_existing_post: Pipeboard أعطى id=${newAdId} لكن Meta فشل التحقق — ${String(ve.message ?? "")}${ve.fbtrace_id ? ` | fbtrace_id: ${ve.fbtrace_id}` : ""}`);
      }

      efpSuccess = true;
      efpMsg = [
        `تم إنشاء الإعلان من المنشور (object_story_id: ${objectStoryId})`,
        `new_ad_id: ${newAdId}`,
        `adset_id: ${adsetId}`,
        `الحالة: ${String(efpVerify.verified_fields?.effective_status ?? "PAUSED")}`,
      ].join(" — ");

      (args as Record<string, unknown>).__new_ad_id = newAdId;
      (args as Record<string, unknown>).__efpVerify = efpVerify;
    } catch (err) {
      efpMsg = err instanceof Error ? err.message : String(err);
      _pbWriteClient = null;
      _pbWriteConnecting = null;
    }

    await query(
      `INSERT INTO pipeboard_actions
         (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [executedBy, tool, JSON.stringify(args ?? {}), efpSuccess, efpMsg, null, String(args?.adset_id ?? ""), false]
    ).catch((e: unknown) => logger.warn({ e }, "pipeboard audit insert failed"));

    if (efpSuccess) {
      const newAdIdOut = String((args as Record<string, unknown>).__new_ad_id ?? "");
      const efpV = (args as Record<string, unknown>).__efpVerify as VerifyResult | undefined;
      res.json({
        success: true, message: efpMsg,
        new_ad_id: newAdIdOut,
        adset_id: String(args?.adset_id ?? ""),
        object_story_id: String(args?.object_story_id ?? `${args?.page_id ?? ""}_${args?.post_id ?? ""}`),
        verified: true,
        verified_fields: efpV?.verified_fields,
      });
    } else {
      res.status(500).json({ error: efpMsg });
    }
    return;
  }

  // ── Special multi-step: launch_pipeboard_campaign ────────────────────────
  if (tool === "launch_pipeboard_campaign") {
    // ── Types ──────────────────────────────────────────────────────────────
    interface AdsetInput { name: string; budget: number; targeting?: string }
    interface CreativeInput { media_url: string; media_type: string; primary_text: string; headline: string }
    interface AdResult {
      adset_name: string;
      creative_index: number;
      adset_id?: string;
      creative_id?: string;
      ad_id?: string;
      error?: string;
    }

    const pixelId = String(args?.pixel_id ?? "").trim();
    const hasPixel = pixelId.length > 0;
    const campObjective = hasPixel ? "OUTCOME_SALES" : "OUTCOME_TRAFFIC";
    const optimizationGoal = hasPixel ? "OFFSITE_CONVERSIONS" : "LINK_CLICKS";

    let pipeSuccess = false;
    let pipeMsg = "";
    let campaignId = "";
    const adResults: AdResult[] = [];

    // ── Parse inputs: support both array and single-item (backward compat) ─
    const rawAdsets: AdsetInput[] = Array.isArray(args?.adsets) && (args.adsets as AdsetInput[]).length > 0
      ? (args.adsets as AdsetInput[])
      : [{ name: `${String(args?.campaign_name ?? "حملة")} — مجموعة رئيسية`, budget: Number(args?.daily_budget ?? 20) }];

    let rawCreatives: CreativeInput[] = Array.isArray(args?.creatives) && (args.creatives as CreativeInput[]).length > 0
      ? (args.creatives as CreativeInput[])
      : [{
          media_url: String(args?.media_url ?? "").trim(),
          media_type: String(args?.media_type ?? "image").toLowerCase(),
          primary_text: String(args?.primary_text ?? ""),
          headline: String(args?.headline ?? ""),
        }];

    // ── Helpers ────────────────────────────────────────────────────────────
    const egpToCents = (v: unknown) => Math.round(Number(v) * 100);

    /** Normalise Google Drive sharing URLs → direct download via usercontent */
    function normaliseMediaUrl(raw: string): string {
      if (!raw) return raw;
      const driveFileMatch = raw.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
      if (driveFileMatch) {
        return `https://drive.usercontent.google.com/download?id=${driveFileMatch[1]}&export=download&authuser=0`;
      }
      const driveIdMatch = raw.match(/drive\.google\.com\/(?:open|uc)[^?]*\?(?:[^#]*&)?id=([^&#]+)/);
      if (driveIdMatch) {
        return `https://drive.usercontent.google.com/download?id=${driveIdMatch[1]}&export=download&authuser=0`;
      }
      if (raw.includes("drive.usercontent.google.com")) return raw;
      return raw;
    }

    function isVideoType(mediaUrl: string, mediaType: string): boolean {
      if (mediaType === "video") return true;
      if (mediaType === "image") return false;
      return /\.(mp4|mov|avi|mkv|webm|m4v|3gp|flv)($|\?)/.test(mediaUrl.toLowerCase());
    }

    function mcpText(result: unknown): string {
      return ((result as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("")
        .trim();
    }

    const UPLOAD_TIMEOUT_MS = 120_000; // 2 minutes for video uploads

    try {
      const client = await getPipeboardWriteClient();

      const rawAccountId = String(args?.account_id ?? "");
      // Pipeboard campaign/adset/creative tools expect bare numeric ID (no act_ prefix).
      // Pipeboard create_ad tool needs the act_ prefix — Meta's /ads endpoint requires it.
      const accountId = rawAccountId.startsWith("act_") ? rawAccountId.slice(4) : rawAccountId;
      const accountIdWithAct = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;
      const campaignName = String(args?.campaign_name ?? "حملة جديدة");
      const landingPageUrl = String(args?.landing_page_url ?? "");
      const callToAction = String(args?.call_to_action ?? "LEARN_MORE");

      // ── Step 1: Create campaign ──────────────────────────────────────────
      const totalBudget = egpToCents(rawAdsets.reduce((s, a) => s + (a.budget ?? 20), 0));
      const campResult = await client.callTool({
        name: "create_campaign",
        arguments: {
          account_id: accountId,
          name: campaignName,
          objective: campObjective,
          status: "PAUSED",
          special_ad_categories: [],
          daily_budget: totalBudget,
        },
      });
      const campText = mcpText(campResult);
      logger.info({ campText }, "launch_pipeboard_campaign: create_campaign");
      const campIdMatch = campText.match(/"id"\s*:\s*"(\d+)"/) ?? campText.match(/\b(\d{10,})\b/);
      campaignId = campIdMatch?.[1] ?? "";
      if (!campaignId) throw new Error(`فشل إنشاء الحملة — ${campText.slice(0, 300)}`);

      // ── Step 2: Get page_id (auto-fetch if not provided) ─────────────────
      let pageId = String(args?.page_id ?? "").trim();
      if (!pageId) {
        try {
          const pagesResult = await client.callTool({ name: "get_account_pages", arguments: { account_id: accountId } });
          const pagesText = mcpText(pagesResult);
          logger.info({ pagesText: pagesText.slice(0, 300) }, "launch_pipeboard_campaign: get_account_pages");
          const pageMatch = pagesText.match(/"id"\s*:\s*"(\d+)"/) ?? pagesText.match(/\b(\d{10,})\b/);
          pageId = pageMatch?.[1] ?? "";
          if (!pageId) logger.warn("launch_pipeboard_campaign: get_account_pages — no page_id found");
        } catch (e) {
          logger.warn({ e }, "launch_pipeboard_campaign: get_account_pages threw");
        }
      }

      // ── Step 2b: Expand any Google Drive FOLDER URLs into individual file creatives ─
      {
        const googleApiKey = process.env.GOOGLE_API_KEY;
        const expanded: CreativeInput[] = [];
        for (const creative of rawCreatives) {
          const rawUrl = creative.media_url?.trim() ?? "";
          const folderMatch = rawUrl.match(/\/folders\/([a-zA-Z0-9-_]+)/);
          if (!folderMatch) {
            expanded.push(creative);
            continue;
          }
          // It's a folder link
          const folderId = folderMatch[1]!;
          logger.info({ folderId }, "launch_pipeboard_campaign: detected Google Drive folder, expanding...");
          if (!googleApiKey) {
            throw new Error("GOOGLE_API_KEY مفقود في متغيرات البيئة — لا يمكن استخراج ملفات مجلد Drive بدونه");
          }
          const apiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,mimeType,name)&key=${googleApiKey}`;
          const driveResp = await fetch(apiUrl, { signal: AbortSignal.timeout(30_000) });
          if (!driveResp.ok) {
            throw new Error(`فشل استعلام Google Drive API للمجلد "${folderId}": ${driveResp.status} ${driveResp.statusText}`);
          }
          const driveData = await driveResp.json() as { files?: Array<{ id: string; mimeType: string; name: string }> };
          const validFiles = (driveData.files ?? []).filter(
            f => f.mimeType.startsWith("video/") || f.mimeType.startsWith("image/")
          );
          if (validFiles.length === 0) {
            throw new Error(`مجلد Google Drive "${folderId}" فارغ أو لا يحتوي على فيديوهات أو صور صالحة`);
          }
          logger.info({ folderId, count: validFiles.length }, "launch_pipeboard_campaign: folder expanded");
          for (const file of validFiles) {
            const directUrl = `https://drive.usercontent.google.com/download?id=${file.id}&export=download&authuser=0`;
            const mediaType = file.mimeType.startsWith("video/") ? "video" : "image";
            expanded.push({ ...creative, media_url: directUrl, media_type: mediaType });
          }
        }
        rawCreatives = expanded;
      }

      // ── Step 3: Pre-upload all unique media URLs (dedup by normalised URL) ─
      interface MediaCacheEntry { imageHash?: string; videoId?: string; error?: string }
      const mediaCache = new Map<string, MediaCacheEntry>();

      for (let ci = 0; ci < rawCreatives.length; ci++) {
        const creative = rawCreatives[ci]!;
        const rawUrl = creative.media_url?.trim() ?? "";
        const mediaUrl = normaliseMediaUrl(rawUrl);
        if (mediaCache.has(mediaUrl)) continue;

        if (!mediaUrl) { mediaCache.set(mediaUrl, { error: "لم يُزوَّد رابط الميديا" }); continue; }
        if (!pageId) { mediaCache.set(mediaUrl, { error: "يحتاج page_id لرفع الميديا — تأكد من توفير page_id" }); continue; }

        if (rawUrl !== mediaUrl) {
          logger.info({ rawUrl, mediaUrl }, `launch_pipeboard_campaign: normalised Google Drive URL [creative ${ci}]`);
        }

        const isVid = isVideoType(mediaUrl, creative.media_type ?? "");

        if (isVid) {
          try {
            const vidResult = await client.callTool(
              { name: "upload_ad_video", arguments: { account_id: accountId, video_url: mediaUrl, name: `${campaignName}-v${ci}` } },
              undefined,
              { timeout: UPLOAD_TIMEOUT_MS },
            );
            const vidText = mcpText(vidResult);
            logger.info({ vidText: vidText.slice(0, 300) }, `launch_pipeboard_campaign: upload_ad_video [${ci}]`);
            const vidMatch = vidText.match(/"(?:video_id|id)"\s*:\s*"(\d+)"/) ?? vidText.match(/\b(\d{10,})\b/);
            const videoId = vidMatch?.[1] ?? "";
            mediaCache.set(mediaUrl, videoId ? { videoId } : { error: `رفع الفيديو فشل — ${vidText.slice(0, 200)}` });
          } catch (e) {
            mediaCache.set(mediaUrl, { error: `رفع الفيديو: ${e instanceof Error ? e.message : String(e)}` });
          }
        } else {
          try {
            const imgResult = await client.callTool(
              { name: "upload_ad_image", arguments: { account_id: accountId, image_url: mediaUrl, name: `${campaignName}-i${ci}` } },
              undefined,
              { timeout: UPLOAD_TIMEOUT_MS },
            );
            const imgText = mcpText(imgResult);
            logger.info({ imgText: imgText.slice(0, 300) }, `launch_pipeboard_campaign: upload_ad_image [${ci}]`);
            const hashMatch = imgText.match(/"hash"\s*:\s*"([^"]+)"/);
            const imageHash = hashMatch?.[1] ?? "";
            mediaCache.set(mediaUrl, imageHash ? { imageHash } : { error: `رفع الصورة فشل — تأكد أن الرابط مباشر ومتاح. ${imgText.slice(0, 150)}` });
          } catch (e) {
            mediaCache.set(mediaUrl, { error: `رفع الصورة: ${e instanceof Error ? e.message : String(e)}` });
          }
        }
      }

      // ── Step 4: Create adsets × creatives → ads ──────────────────────────
      for (const adset of rawAdsets) {
        let adsetId = "";
        let adsetErr = "";

        try {
          // NOTE: Budget lives on the CAMPAIGN (CBO mode). Do NOT set daily_budget on
          // adsets — it conflicts with CBO and causes Meta to ignore the campaign budget.
          const adsetArgs: Record<string, unknown> = {
            account_id: accountId,
            campaign_id: campaignId,
            name: adset.name,
            optimization_goal: optimizationGoal,
            billing_event: "IMPRESSIONS",
            status: "PAUSED",
            targeting: { geo_locations: { countries: ["EG"] } },
            targeting_automation: { advantage_audience: 1 },
          };
          if (hasPixel) {
            adsetArgs.promoted_object = { pixel_id: pixelId, custom_event_type: "PURCHASE" };
          }
          const adsetResult = await client.callTool({ name: "create_adset", arguments: adsetArgs });
          const adsetText = mcpText(adsetResult);
          logger.info({ adsetText }, `launch_pipeboard_campaign: create_adset "${adset.name}"`);
          const adsetIdMatch = adsetText.match(/"id"\s*:\s*"(\d+)"/) ?? adsetText.match(/\b(\d{10,})\b/);
          adsetId = adsetIdMatch?.[1] ?? "";
          if (!adsetId) adsetErr = `فشل إنشاء AdSet "${adset.name}" — ${adsetText.slice(0, 200)}`;
        } catch (e) {
          adsetErr = `فشل إنشاء AdSet "${adset.name}": ${e instanceof Error ? e.message : String(e)}`;
          logger.warn({ adsetErr }, "launch_pipeboard_campaign: create_adset threw");
        }

        if (!adsetId) {
          for (let ci = 0; ci < rawCreatives.length; ci++) {
            adResults.push({ adset_name: adset.name, creative_index: ci, error: adsetErr });
          }
          continue;
        }

        // Create creative + ad for each creative in this adset
        for (let ci = 0; ci < rawCreatives.length; ci++) {
          const creative = rawCreatives[ci]!;
          const rawUrl = creative.media_url?.trim() ?? "";
          const mediaUrl = normaliseMediaUrl(rawUrl);
          const media = mediaCache.get(mediaUrl);

          if (!media || media.error) {
            adResults.push({ adset_name: adset.name, adset_id: adsetId, creative_index: ci, error: media?.error ?? "رابط الميديا مفقود" });
            continue;
          }

          const isVid = isVideoType(mediaUrl, creative.media_type ?? "");
          const hasMedia = isVid ? Boolean(media.videoId) : Boolean(media.imageHash);
          if (!hasMedia) {
            adResults.push({ adset_name: adset.name, adset_id: adsetId, creative_index: ci, error: "الميديا لم تُرفع بنجاح" });
            continue;
          }

          // Create ad creative — inject page_id, pixel_id, destination_url + Advantage+ enhancements
          let creativeId = "";
          try {
            const creativeArgs: Record<string, unknown> = {
              account_id: accountId,
              name: `${adset.name} — creative ${ci + 1}`,
              page_id: pageId,
              // NOTE: Do NOT pass instagram_actor_id here.
              // Pipeboard validates that the token has instagram_basic permission
              // when instagram_actor_id is present, and rejects the request if not —
              // causing a Pipeboard-level error before Meta is even reached.
              // Without instagram_actor_id, Meta will use automatic placements
              // (Facebook + Instagram where available based on page permissions).
              //
              // NOTE: Do NOT add advantage_plus_creative / degrees_of_freedom_spec
              // here — those create an Advantage+ creative format that is incompatible
              // with Pipeboard's create_ad tool and causes error 1487015
              // ("Ad Creative Invalid") at the ad-creation step.
              link_url: landingPageUrl,
              destination_url: landingPageUrl,
              message: creative.primary_text,
              headline: creative.headline,
              call_to_action_type: callToAction,
            };
            if (pixelId) creativeArgs.pixel_id = pixelId;
            if (isVid) creativeArgs.video_id = media.videoId;
            else creativeArgs.image_hash = media.imageHash;

            const creativeResult = await client.callTool({ name: "create_ad_creative", arguments: creativeArgs });
            const creativeText = mcpText(creativeResult);
            logger.info({ creativeText }, `launch_pipeboard_campaign: create_ad_creative [${adset.name}][${ci}]`);

            // ── Strict error parsing: check for nested errors even on 200 ──
            // Use tight regex: a real creative ID appears as "id": "NNNNN" (standalone key).
            // This avoids false matches on keys like "instagram_actor_id", "account_id", etc.
            // that also contain "id" as a substring.
            const hasRealId = /"id"\s*:\s*"(\d{10,})"/.test(creativeText);
            if (/"error"/.test(creativeText) && !hasRealId) {
              adResults.push({ adset_name: adset.name, adset_id: adsetId, creative_index: ci, error: `فشل creative — ${extractMetaError(creativeText)}` });
              continue;
            }
            // Extract creative ID using tight regex (standalone "id" key only)
            const creativeMatch = creativeText.match(/"id"\s*:\s*"(\d{10,})"/);
            creativeId = creativeMatch?.[1] ?? "";
            if (!creativeId) {
              adResults.push({ adset_name: adset.name, adset_id: adsetId, creative_index: ci, error: `لم يُعاد creative_id — ${extractMetaError(creativeText)}` });
              continue;
            }
          } catch (e) {
            adResults.push({ adset_name: adset.name, adset_id: adsetId, creative_index: ci, error: `create_ad_creative: ${e instanceof Error ? e.message : String(e)}` });
            continue;
          }

          // Create ad — must use act_ prefix for Meta's /ads endpoint
          try {
            const adArgs: Record<string, unknown> = {
              account_id: accountIdWithAct,
              name: `${adset.name} — إعلان ${ci + 1}`,
              adset_id: adsetId,
              creative_id: creativeId,
              status: "PAUSED",
            };
            // For SALES/PURCHASE campaigns Meta requires tracking_specs on the ad
            // itself (not just promoted_object on the adset) — without this the
            // creative is considered "invalid" for the conversion context (error 1487015).
            if (hasPixel && pixelId) {
              adArgs.tracking_specs = [{ "action.type": ["offsite_conversion"], fb_pixel: [pixelId] }];
            }
            const adResult = await client.callTool({
              name: "create_ad",
              arguments: adArgs,
            });
            const adText = mcpText(adResult);
            logger.info({ adText }, `launch_pipeboard_campaign: create_ad [${adset.name}][${ci}]`);

            // ── Strict error parsing for ads ─────────────────────────────
            if (/"error"/.test(adText) && !/"id"/.test(adText)) {
              adResults.push({ adset_name: adset.name, adset_id: adsetId, creative_index: ci, creative_id: creativeId, error: `فشل create_ad — ${extractMetaError(adText)}` });
              continue;
            }
            const adMatch = adText.match(/"id"\s*:\s*"(\d+)"/) ?? adText.match(/\b(\d{10,})\b/);
            const adId = adMatch?.[1] ?? "";
            adResults.push({ adset_name: adset.name, adset_id: adsetId, creative_index: ci, creative_id: creativeId, ad_id: adId || undefined, error: adId ? undefined : `لم يُعاد ad_id — ${extractMetaError(adText)}` });
          } catch (e) {
            adResults.push({ adset_name: adset.name, adset_id: adsetId, creative_index: ci, creative_id: creativeId, error: `create_ad: ${e instanceof Error ? e.message : String(e)}` });
          }
        }
      }

      // ── Build summary ─────────────────────────────────────────────────────
      const adsCreated = adResults.filter(r => r.ad_id).length;
      const adsFailed = adResults.filter(r => !r.ad_id).length;
      const failedDetails = adResults
        .filter(r => !r.ad_id)
        .map(r => `• [${r.adset_name}] creative ${r.creative_index + 1}: ${r.error ?? "سبب غير معروف"}`)
        .join("\n");

      pipeSuccess = true;
      pipeMsg = [
        `campaign_id:${campaignId}`,
        `ads_created:${adsCreated}/${rawAdsets.length * rawCreatives.length}`,
        adsFailed > 0 ? `\n⚠️ إعلانات فشلت (${adsFailed}):\n${failedDetails}` : "",
      ].filter(Boolean).join(" ");

    } catch (err) {
      pipeMsg = err instanceof Error ? err.message : String(err);
      _pbWriteClient = null;
      _pbWriteConnecting = null;
    } finally {
      await query(
        `INSERT INTO pipeboard_actions
           (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [executedBy, tool, JSON.stringify(args ?? {}), pipeSuccess, pipeMsg,
          String(args?.campaign_name ?? ""), null, false]
      ).catch((e: unknown) => logger.warn({ e }, "pipeboard audit insert failed"));
    }

    if (pipeSuccess) {
      const adsCreated = adResults.filter(r => r.ad_id).length;
      res.json({
        success: true,
        message: pipeMsg,
        launchData: {
          campaign_id: campaignId,
          objective: campObjective,
          has_pixel: hasPixel,
          adsets_count: rawAdsets.length,
          creatives_count: rawCreatives.length,
          ads_created: adsCreated,
          ads_failed: adResults.length - adsCreated,
          ad_results: adResults,
        },
      });
    } else {
      res.status(500).json({ error: pipeMsg });
    }
    return;
  }

  // ── Special: create_campaign — verify with Meta after Pipeboard MCP ─────────
  if (tool === "create_campaign") {
    const rawAccId = String(args?.account_id ?? "");
    const { mcpTool: ccMcpTool, mcpArgs: ccMcpArgs } = translateToMcp("create_campaign", args ?? {});

    let ccSuccess = false;
    let ccMsg = "";
    let ccCampaignId = "";
    let ccData: Record<string, unknown> = {};

    try {
      const client = await getPipeboardWriteClient();
      const result = await client.callTool({ name: ccMcpTool, arguments: ccMcpArgs });
      const textContent = ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
        .filter(c => c.type === "text")
        .map(c => c.text ?? "")
        .join("")
        .trim();

      logger.info({ textContent: textContent.slice(0, 300) }, "create_campaign: MCP response");

      // Extract campaign_id — fail hard if not found
      const idMatch = textContent.match(/"id"\s*:\s*"(\d+)"/) ?? textContent.match(/\b(\d{13,})\b/);
      ccCampaignId = idMatch?.[1] ?? "";
      if (!ccCampaignId) {
        // Try to extract real Meta error
        const errMatch = textContent.match(/"message"\s*:\s*"([^"]+)"/) ?? textContent.match(/"error"\s*:\s*"([^"]+)"/);
        const codeMatch = textContent.match(/"code"\s*:\s*(\d+)/);
        const subMatch = textContent.match(/"error_subcode"\s*:\s*(\d+)/);
        const errMsg = errMatch?.[1] ?? textContent.slice(0, 400);
        const code = codeMatch?.[1] ? Number(codeMatch[1]) : undefined;
        const sub = subMatch?.[1] ? Number(subMatch[1]) : undefined;
        const detail = [
          code ? `code: ${code}` : null,
          sub  ? `error_subcode: ${sub}` : null,
          `message: ${errMsg}`,
        ].filter(Boolean).join(" | ");
        throw new Error(`فشل إنشاء الحملة — ${detail}`);
      }

      // ── Verify with Meta Graph API directly ──────────────────────────────
      const token = process.env.META_ACCESS_TOKEN;
      if (token) {
        try {
          const verifyUrl = new URL(`https://graph.facebook.com/v21.0/${ccCampaignId}`);
          verifyUrl.searchParams.set("fields", "id,name,status,effective_status,updated_time");
          verifyUrl.searchParams.set("access_token", token);
          const vResp = await fetch(verifyUrl.toString(), { signal: AbortSignal.timeout(15_000) });
          const vJson = await vResp.json() as Record<string, unknown>;
          if (!vJson.error) {
            ccData = {
              campaign_id: vJson.id,
              name: vJson.name,
              status: vJson.status,
              effective_status: vJson.effective_status,
              updated_time: vJson.updated_time,
            };
          }
        } catch (verifyErr) {
          logger.warn({ verifyErr }, "create_campaign: Meta verify fetch threw (non-fatal)");
        }
      }

      if (!ccData.campaign_id) {
        ccData = { campaign_id: ccCampaignId };
      }

      ccSuccess = true;
      ccMsg = `تم إنشاء الحملة "${String(args?.name ?? "")}" — campaign_id: ${ccCampaignId} — الحالة: ${String(ccData.effective_status ?? ccData.status ?? "PAUSED")}`;
    } catch (err) {
      ccMsg = err instanceof Error ? err.message : String(err);
      _pbWriteClient = null;
      _pbWriteConnecting = null;
    }

    await query(
      `INSERT INTO pipeboard_actions
         (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [executedBy, tool, JSON.stringify(args ?? {}), ccSuccess, ccMsg, String(args?.name ?? ""), null, false]
    ).catch((e: unknown) => logger.warn({ e }, "pipeboard audit insert failed"));

    if (ccSuccess) {
      res.json({ success: true, message: ccMsg, ...ccData, account_id: rawAccId });
    } else {
      res.status(500).json({ error: ccMsg });
    }
    return;
  }

  // ── Special: create_adset — verify with Meta after Pipeboard MCP ────────────
  if (tool === "create_adset") {
    const { mcpTool: asMcpTool, mcpArgs: asMcpArgs } = translateToMcp("create_adset", args ?? {});
    const rawAccId = String(args?.account_id ?? "");

    let asSuccess = false;
    let asMsg = "";
    let asAdsetId = "";
    let asData: Record<string, unknown> = {};
    let asError: Record<string, unknown> | null = null;

    try {
      const client = await getPipeboardWriteClient();
      const result = await client.callTool({ name: asMcpTool, arguments: asMcpArgs });
      const textContent = ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
        .filter(c => c.type === "text")
        .map(c => c.text ?? "")
        .join("")
        .trim();

      logger.info({ textContent: textContent.slice(0, 400) }, "create_adset: MCP response");

      // ── Extract adset_id — fail hard if missing ───────────────────────────
      const idMatch = textContent.match(/"id"\s*:\s*"(\d+)"/) ?? textContent.match(/\b(\d{13,})\b/);
      asAdsetId = idMatch?.[1] ?? "";

      if (!asAdsetId) {
        // Extract real Meta error details from Pipeboard text
        const codeMatch    = textContent.match(/"code"\s*:\s*(\d+)/);
        const subMatch     = textContent.match(/"error_subcode"\s*:\s*(\d+)/);
        const msgMatch     = textContent.match(/"message"\s*:\s*"([^"]+)"/) ?? textContent.match(/"error"\s*:\s*"([^"]+)"/);
        const titleMatch   = textContent.match(/"error_user_title"\s*:\s*"([^"]+)"/);
        const userMsgMatch = textContent.match(/"error_user_msg"\s*:\s*"([^"]+)"/);
        const traceMatch   = textContent.match(/"fbtrace_id"\s*:\s*"([^"]+)"/);

        asError = {
          code:             codeMatch?.[1]    ? Number(codeMatch[1])    : undefined,
          message:          msgMatch?.[1]     ?? textContent.slice(0, 400),
          error_subcode:    subMatch?.[1]     ? Number(subMatch[1])     : undefined,
          error_user_title: titleMatch?.[1]   ?? undefined,
          error_user_msg:   userMsgMatch?.[1] ?? undefined,
          fbtrace_id:       traceMatch?.[1]   ?? undefined,
        };

        const detail = [
          asError.code        ? `code: ${asError.code}`                     : null,
          asError.error_subcode ? `error_subcode: ${asError.error_subcode}` : null,
          asError.fbtrace_id  ? `fbtrace_id: ${asError.fbtrace_id}`         : null,
          `message: ${String(asError.message ?? "")}`,
        ].filter(Boolean).join(" | ");

        throw new Error(`فشل إنشاء المجموعة الإعلانية — ${detail}`);
      }

      // ── Verify with Meta Graph API directly ──────────────────────────────
      const token = process.env.META_ACCESS_TOKEN;
      if (!token) {
        // No token: trust Pipeboard id but flag clearly
        asData = { adset_id: asAdsetId };
        logger.warn("create_adset: META_ACCESS_TOKEN missing — cannot verify with Meta");
      } else {
        const verifyUrl = new URL(`https://graph.facebook.com/v21.0/${asAdsetId}`);
        verifyUrl.searchParams.set(
          "fields",
          "id,name,status,effective_status,created_time,updated_time,daily_budget,optimization_goal,billing_event"
        );
        verifyUrl.searchParams.set("access_token", token);

        let vJson: Record<string, unknown>;
        try {
          const vResp = await fetch(verifyUrl.toString(), { signal: AbortSignal.timeout(15_000) });
          vJson = await vResp.json() as Record<string, unknown>;
        } catch (fetchErr) {
          logger.warn({ fetchErr }, "create_adset: Meta verify fetch threw");
          // Non-fatal — trust Pipeboard id
          asData = { adset_id: asAdsetId };
          vJson = {};
        }

        if (vJson.error) {
          // Verification returned an error — treat as failure
          const ve = (typeof vJson.error === "object" && vJson.error !== null)
            ? vJson.error as Record<string, unknown>
            : {};
          asError = {
            code:          ve.code          ?? undefined,
            message:       ve.message       ?? `Meta returned error for adset_id ${asAdsetId}`,
            error_subcode: ve.error_subcode ?? undefined,
            fbtrace_id:    ve.fbtrace_id    ?? undefined,
          };
          throw new Error(
            `create_adset: Pipeboard أعطى id=${asAdsetId} لكن Meta فشل التحقق — ` +
            `code: ${String(asError.code ?? "?")} | message: ${String(asError.message)}`
          );
        }

        // ── Success: build full response from Meta data ───────────────────
        const rawBudget = vJson.daily_budget != null ? Number(vJson.daily_budget) / 100 : null;
        asData = {
          adset_id:         vJson.id,
          name:             vJson.name,
          campaign_id:      vJson.campaign_id,
          status:           vJson.status,
          effective_status: vJson.effective_status,
          daily_budget:     rawBudget != null ? rawBudget : undefined,
          optimization_goal: vJson.optimization_goal,
          billing_event:    vJson.billing_event,
          created_time:     vJson.created_time,
          updated_time:     vJson.updated_time,
        };
      }

      asSuccess = true;
      asMsg = [
        `تم إنشاء المجموعة الإعلانية "${String(args?.name ?? "")}"`,
        `adset_id: ${asAdsetId}`,
        asData.campaign_id ? `campaign_id: ${String(asData.campaign_id)}` : null,
        asData.effective_status ? `الحالة: ${String(asData.effective_status)}` : null,
        asData.daily_budget    ? `الميزانية: ${String(asData.daily_budget)} EGP/يوم` : null,
      ].filter(Boolean).join(" — ");

    } catch (err) {
      asMsg = err instanceof Error ? err.message : String(err);
      _pbWriteClient = null;
      _pbWriteConnecting = null;
    }

    await query(
      `INSERT INTO pipeboard_actions
         (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [executedBy, tool, JSON.stringify(args ?? {}), asSuccess, asMsg,
        String(args?.campaign_id ?? ""), String(args?.name ?? ""), false]
    ).catch((e: unknown) => logger.warn({ e }, "pipeboard audit insert failed (create_adset)"));

    if (asSuccess) {
      res.json({ success: true, message: asMsg, account_id: rawAccId, ...asData });
    } else {
      res.status(500).json({
        error: asMsg,
        ...(asError ? { meta_error: asError } : {}),
      });
    }
    return;
  }

  const isGaTool = GA_WRITE_TOOLS.has(tool);
  const { mcpTool, mcpArgs } = isGaTool
    ? translateToGoogleAdsMcp(tool, args ?? {})
    : translateToMcp(tool, args ?? {});

  let success = false;
  let resultMessage = "";

  try {
    const client = isGaTool ? await getGoogleAdsWriteClient() : await getPipeboardWriteClient();
    const result = await client.callTool({ name: mcpTool, arguments: mcpArgs });

    const textContent = (result.content as Array<{ type: string; text?: string }>)
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();

    success = true;
    // Pipeboard sometimes returns raw JSON (e.g. {"success":true}) — detect and discard it
    // so the frontend falls back to the human-readable pendingAction.summary.
    const looksLikeJson = textContent.trimStart().startsWith("{") || textContent.trimStart().startsWith("[");
    resultMessage = textContent && !looksLikeJson ? textContent : "";

    // Invalidate the details cache for the affected entity so the next
    // read-tool call returns the updated status/budget without waiting
    // for the 5-minute TTL to expire.
    const CAMPAIGN_WRITE_TOOLS = new Set([
      "pause_campaign",
      "enable_campaign",
      "update_campaign_budget",
    ]);
    const ADSET_WRITE_TOOLS = new Set([
      "pause_adset",
      "enable_adset",
      "update_adset_budget",
    ]);

    if (CAMPAIGN_WRITE_TOOLS.has(tool) && typeof args?.campaign_id === "string" && args.campaign_id) {
      await query(
        `DELETE FROM meta_campaign_details_cache WHERE campaign_id = $1`,
        [args.campaign_id]
      ).catch(() => null);
    } else if (ADSET_WRITE_TOOLS.has(tool) && typeof args?.adset_id === "string" && args.adset_id) {
      await query(
        `DELETE FROM meta_adset_details_cache WHERE adset_id = $1`,
        [args.adset_id]
      ).catch(() => null);
    }
    // pause_ad / enable_ad: no local cache to invalidate (ad details are fetched live)

    res.json({ success: true, message: resultMessage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    resultMessage = msg;
    // Reset the correct singleton on error so next action reconnects fresh
    if (isGaTool) {
      _gaWriteClient = null;
      _gaWriteConnecting = null;
    } else {
      _pbWriteClient = null;
      _pbWriteConnecting = null;
    }
    res.status(500).json({ error: msg });
  } finally {
    // Extract human-readable names from args for audit log
    const campaignName =
      typeof args?.campaign_name === "string" ? args.campaign_name :
      typeof args?.name === "string" ? args.name : null;
    const adsetName =
      typeof args?.adset_name === "string" ? args.adset_name : null;

    await query(
      `INSERT INTO pipeboard_actions
         (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        executedBy,
        tool,
        JSON.stringify(args ?? {}),
        success,
        resultMessage,
        campaignName,
        adsetName,
        isNoOp === true,
      ]
    ).catch((err: unknown) => {
      logger.warn({ err, tool, executedBy }, "Failed to insert pipeboard audit row");
    });

    // After every no-op action, check whether the daily threshold has been
    // crossed and send a push notification to admins if so (once per day).
    if (isNoOp) {
      void checkAndNotifyNoOpSpike();
    }
  }
});

// ── GET /api/pipeboard/no-op-count ─────────────────────────────
router.get("/pipeboard/no-op-count", async (req: Request, res: Response) => {
  const rawDays = parseInt(String(req.query.days ?? "14"), 10);
  const days = isNaN(rawDays) || rawDays < 1 ? 14 : Math.min(rawDays, 60);

  try {
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM pipeboard_actions
       WHERE is_no_op = TRUE
         AND executed_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - ($1::int * INTERVAL '1 day')`,
      [days - 1]
    );
    res.json({ count: parseInt(rows[0]?.count ?? "0", 10), days });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/pipeboard/no-op-trend ─────────────────────────────
router.get("/pipeboard/no-op-trend", async (req: Request, res: Response) => {
  const rawDays = parseInt(String(req.query.days ?? "14"), 10);
  const days = isNaN(rawDays) || rawDays < 1 ? 14 : Math.min(rawDays, 60);
  const lookback = days - 1; // e.g. days=14 → go back 13 days from today

  try {
    // Use calendar-day boundaries so SQL rows and the zero-fill loop
    // cover the exact same N days (today-lookback through today, UTC).
    const rows = await query<{ day: string; count: string }>(
      `SELECT
         TO_CHAR(DATE_TRUNC('day', executed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
         COUNT(*)::text AS count
       FROM pipeboard_actions
       WHERE is_no_op = TRUE
         AND executed_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - ($1::int * INTERVAL '1 day')
         AND executed_at <  DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day'
       GROUP BY DATE_TRUNC('day', executed_at AT TIME ZONE 'UTC')
       ORDER BY DATE_TRUNC('day', executed_at AT TIME ZONE 'UTC') ASC`,
      [lookback]
    );

    // Zero-fill: emit exactly `days` UTC calendar days (today-lookback .. today)
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const trend: { day: string; count: number }[] = [];
    for (let i = lookback; i >= 0; i--) {
      const d = new Date(todayUTC);
      d.setUTCDate(d.getUTCDate() - i);
      const dayStr = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
      const found = rows.find((r) => r.day === dayStr);
      trend.push({ day: dayStr, count: found ? parseInt(found.count, 10) : 0 });
    }

    res.json({ trend, days });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/pipeboard/history ─────────────────────────────────
router.get("/pipeboard/history", async (req: Request, res: Response) => {
  const rawDays = parseInt(String(req.query.days ?? "14"), 10);
  const days = isNaN(rawDays) || rawDays < 1 ? 14 : Math.min(rawDays, 90);

  try {
    const rows = await query<{
      id: number;
      executed_at: string;
      executed_by: string;
      tool_name: string;
      args: Record<string, unknown>;
      success: boolean;
      result_message: string | null;
      campaign_name: string | null;
      adset_name: string | null;
      is_no_op: boolean;
    }>(
      `SELECT id, executed_at, executed_by, tool_name, args, success, result_message,
              campaign_name, adset_name, is_no_op
       FROM pipeboard_actions
       WHERE executed_at > NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY executed_at DESC
       LIMIT 200`,
      [days]
    );
    res.json({ actions: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
