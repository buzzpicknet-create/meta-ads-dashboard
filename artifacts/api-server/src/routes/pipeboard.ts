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
    "publish_winners_to_destination",
    "create_ad_from_creative_spec",
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

      // ── CREATIVE RECONSTRUCTION FALLBACK (Subcode 33 / Code 100) ─────────────
      // Meta error 100 / subcode 33 = "Unsupported post request / Object does not
      // exist" — happens when copying a legacy ad into a new CBO/Broad structure.
      // Raw duplication carries incompatible metadata → we reconstruct instead.
      const isLegacyBlocker =
        dupMetaError?.code === 100 ||
        dupMetaError?.error_subcode === 33 ||
        (dupMetaError?.code != null && [100, 2446079].includes(dupMetaError.code));

      if (isLegacyBlocker) {
        logger.info(
          { code: dupMetaError?.code, subcode: dupMetaError?.error_subcode, adId, destAdsetId },
          "duplicate_ad: Legacy blocker detected — attempting Creative Reconstruction"
        );
        try {
          // Step 1: Fetch source ad to get account_id + object_story_id
          const srcUrl = new URL(`https://graph.facebook.com/v21.0/${adId}`);
          srcUrl.searchParams.set("fields", "id,account_id,creative{id,object_story_id,effective_object_story_id,name,video_id,image_hash,body,title,link_url,call_to_action}");
          srcUrl.searchParams.set("access_token", metaToken);
          const srcResp = await fetch(srcUrl.toString(), { signal: AbortSignal.timeout(10_000) });
          const srcJson = await srcResp.json() as Record<string, unknown>;
          logger.info({ srcJson: JSON.stringify(srcJson).slice(0, 500) }, "duplicate_ad: reconstruction source ad fetch");

          const rawAccountId = String(srcJson.account_id ?? "").replace(/^act_/, "");
          const accountIdWithAct = rawAccountId ? `act_${rawAccountId}` : "";
          const creative = srcJson.creative as Record<string, unknown> | undefined;
          const objectStoryId = String(creative?.effective_object_story_id ?? creative?.object_story_id ?? "").trim();

          if (!objectStoryId || !rawAccountId) {
            throw new Error(
              `Creative Reconstruction: بيانات ناقصة — account_id=${rawAccountId}, object_story_id=${objectStoryId}`
            );
          }

          // Extract page_id from object_story_id (format: "page_id_post_id")
          const pageId = objectStoryId.split("_")[0] ?? "";

          logger.info({ objectStoryId, pageId, rawAccountId }, "duplicate_ad: reconstruction assets extracted");

          // Step 2: create_ad_creative using object_story_id
          const rcClient = await getPipeboardWriteClient();
          const creativeArgs: Record<string, unknown> = {
            account_id: rawAccountId,
            name: `${adLabel} — reconstructed creative`,
            page_id: pageId,
            object_story_id: objectStoryId,
          };
          // instagram_actor_id = page_id fixes IG review errors during reconstruction
          if (pageId) creativeArgs.instagram_actor_id = pageId;

          const creativeResult = await rcClient.callTool({ name: "create_ad_creative", arguments: creativeArgs });
          const creativeText = ((creativeResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
            .filter((c: { type: string }) => c.type === "text")
            .map((c: { text?: string }) => c.text ?? "")
            .join("").trim();
          logger.info({ creativeText: creativeText.slice(0, 400) }, "duplicate_ad: reconstruction create_ad_creative");

          const creativeIdMatch = creativeText.match(/"id"\s*:\s*"(\d{10,})"/);
          const rcCreativeId = creativeIdMatch?.[1] ?? "";
          if (!rcCreativeId) {
            throw new Error(`Reconstruction: فشل إنشاء creative — ${creativeText.slice(0, 200)}`);
          }

          // Step 3: create_ad with the reconstructed creative
          const rcAdResult = await rcClient.callTool({
            name: "create_ad",
            arguments: {
              account_id: accountIdWithAct,
              name: adLabel,
              adset_id: destAdsetId,
              creative_id: rcCreativeId,
              status: "PAUSED",
            },
          });
          const rcAdText = ((rcAdResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
            .filter((c: { type: string }) => c.type === "text")
            .map((c: { text?: string }) => c.text ?? "")
            .join("").trim();
          logger.info({ rcAdText: rcAdText.slice(0, 400) }, "duplicate_ad: reconstruction create_ad");

          const rcAdMatch = rcAdText.match(/"id"\s*:\s*"(\d+)"/) ?? rcAdText.match(/\b(\d{10,})\b/);
          const rcNewAdId = rcAdMatch?.[1] ?? "";
          if (!rcNewAdId) {
            throw new Error(`Reconstruction: فشل create_ad — ${rcAdText.slice(0, 200)}`);
          }

          // Step 4: Verify
          const rcVerify = await verifyMetaEntityDirect(
            rcNewAdId,
            "id,name,status,effective_status,adset_id,campaign_id",
            metaToken
          );
          if (!rcVerify.verified) {
            throw new Error(`Reconstruction: verify فشل للإعلان ${rcNewAdId}`);
          }

          dupSuccess = true;
          dupNewAdId = rcNewAdId;
          dupVerify  = rcVerify;
          dupMsg = [
            `✅ Creative Reconstruction نجح — تم إعادة بناء الإعلان "${adLabel}" بدلاً من النسخ المباشر (الذي فشل بـ subcode 33)`,
            `new_ad_id: ${rcNewAdId}`,
            `source_ad_id: ${adId}`,
            `object_story_id: ${objectStoryId}`,
            `creative_id: ${rcCreativeId}`,
            `destination_adset_id: ${destAdsetId}`,
            `الحالة: ${String(rcVerify.verified_fields?.effective_status ?? "PAUSED")}`,
            `ملاحظة: تم إنشاء creative جديد — Social Proof (اللايكات) محفوظة عبر object_story_id`,
          ].join(" — ");

          logger.info({ rcNewAdId, objectStoryId, rcCreativeId }, "duplicate_ad: Creative Reconstruction succeeded");
        } catch (rcErr) {
          const rcErrMsg = rcErr instanceof Error ? rcErr.message : String(rcErr);
          logger.warn({ rcErrMsg, adId, destAdsetId }, "duplicate_ad: Creative Reconstruction (tier-2) failed — trying Tier-3 spec rebuild");

          // ── TIER-3 FALLBACK: Creative Spec Rebuild ────────────────────────────
          // Tier-2 (object_story_id path) failed. Last resort: fetch raw creative
          // assets (video_id / image_hash, primary_text, headline, link) and build
          // a fresh ad using object_story_spec — no social proof preserved but the
          // ad is structurally identical and will run.
          try {
            const t3Url = new URL(`https://graph.facebook.com/v21.0/${adId}`);
            t3Url.searchParams.set(
              "fields",
              "id,account_id,creative{id,name,object_story_spec,body,title,link_url,image_url,video_id}"
            );
            t3Url.searchParams.set("access_token", metaToken);
            const t3Resp = await fetch(t3Url.toString(), { signal: AbortSignal.timeout(12_000) });
            const t3Json = await t3Resp.json() as Record<string, unknown>;
            logger.info({ t3Json: JSON.stringify(t3Json).slice(0, 800) }, "duplicate_ad: tier-3 creative fetch");

            const t3AccId = String(t3Json.account_id ?? "").replace(/^act_/, "");
            const t3AccWithAct = t3AccId ? `act_${t3AccId}` : "";
            const t3Creative = t3Json.creative as Record<string, unknown> | undefined;
            const t3Spec = t3Creative?.object_story_spec as Record<string, unknown> | undefined;

            // Extract page_id from spec
            const t3PageId = String(t3Spec?.page_id ?? "").trim();

            // Extract video or image + text from spec
            const t3VideoData = t3Spec?.video_data as Record<string, unknown> | undefined;
            const t3LinkData  = t3Spec?.link_data  as Record<string, unknown> | undefined;
            const t3VideoId   = String(t3VideoData?.video_id ?? t3Creative?.video_id ?? "").trim();
            const t3ImageHash = String(t3LinkData?.image_hash ?? "").trim();
            const t3Message   = String(t3VideoData?.message ?? t3LinkData?.message ?? t3Creative?.body ?? "").trim();
            const t3Title     = String(t3VideoData?.link_description ?? t3LinkData?.description ?? t3Creative?.title ?? "").trim();
            const t3Cta       = (t3VideoData?.call_to_action as Record<string, unknown> | undefined)?.type
                             ?? (t3LinkData?.call_to_action  as Record<string, unknown> | undefined)?.type
                             ?? "SHOP_NOW";
            const t3Link      = String(
              ((t3VideoData?.call_to_action as Record<string, unknown> | undefined)?.value as Record<string, unknown> | undefined)?.link
              ?? ((t3LinkData?.call_to_action as Record<string, unknown> | undefined)?.value as Record<string, unknown> | undefined)?.link
              ?? t3Creative?.link_url ?? ""
            ).trim();

            if (!t3AccId || !t3PageId || (!t3VideoId && !t3ImageHash)) {
              throw new Error(
                `Tier-3: بيانات غير كافية — account_id=${t3AccId}, page_id=${t3PageId}, ` +
                `video_id=${t3VideoId}, image_hash=${t3ImageHash}`
              );
            }

            // Build object_story_spec for the new creative
            const t3StorySpec: Record<string, unknown> = t3VideoId
              ? {
                  page_id: t3PageId,
                  video_data: {
                    video_id: t3VideoId,
                    ...(t3Message ? { message: t3Message } : {}),
                    ...(t3Title   ? { link_description: t3Title } : {}),
                    ...(t3Link    ? { call_to_action: { type: t3Cta, value: { link: t3Link } } } : {}),
                  },
                }
              : {
                  page_id: t3PageId,
                  link_data: {
                    image_hash: t3ImageHash,
                    ...(t3Message ? { message: t3Message } : {}),
                    ...(t3Title   ? { description: t3Title } : {}),
                    ...(t3Link    ? { link: t3Link, call_to_action: { type: t3Cta, value: { link: t3Link } } } : {}),
                  },
                };

            const t3Client = await getPipeboardWriteClient();

            // Step A: create_ad_creative from spec
            const t3CreativeArgs: Record<string, unknown> = {
              account_id:        t3AccId,
              name:              `${adLabel} — tier3-spec`,
              object_story_spec: t3StorySpec,
              instagram_actor_id: t3PageId,
            };
            const t3CreativeResult = await t3Client.callTool({ name: "create_ad_creative", arguments: t3CreativeArgs });
            const t3CreativeText = ((t3CreativeResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
              .filter((c: { type: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("").trim();
            logger.info({ t3CreativeText: t3CreativeText.slice(0, 400) }, "duplicate_ad: tier-3 create_ad_creative");

            const t3CreativeIdMatch = t3CreativeText.match(/"id"\s*:\s*"(\d{10,})"/);
            const t3CreativeId = t3CreativeIdMatch?.[1] ?? "";
            if (!t3CreativeId) throw new Error(`Tier-3: فشل create_ad_creative — ${t3CreativeText.slice(0, 200)}`);

            // Step B: create_ad with the spec creative
            const t3AdResult = await t3Client.callTool({
              name: "create_ad",
              arguments: { account_id: t3AccWithAct, name: adLabel, adset_id: destAdsetId, creative_id: t3CreativeId, status: "PAUSED" },
            });
            const t3AdText = ((t3AdResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
              .filter((c: { type: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("").trim();
            logger.info({ t3AdText: t3AdText.slice(0, 400) }, "duplicate_ad: tier-3 create_ad");

            const t3AdMatch = t3AdText.match(/"id"\s*:\s*"(\d+)"/) ?? t3AdText.match(/\b(\d{10,})\b/);
            const t3NewAdId = t3AdMatch?.[1] ?? "";
            if (!t3NewAdId) throw new Error(`Tier-3: فشل create_ad — ${t3AdText.slice(0, 200)}`);

            // Step C: Verify
            const t3Verify = await verifyMetaEntityDirect(t3NewAdId, "id,name,status,effective_status", metaToken);
            if (!t3Verify.verified) throw new Error(`Tier-3: verify فشل للإعلان ${t3NewAdId}`);

            dupSuccess = true;
            dupNewAdId = t3NewAdId;
            dupVerify  = t3Verify;
            dupMsg = [
              `✅ Tier-3 Spec Rebuild نجح — تم إعادة بناء الإعلان "${adLabel}" من الأصول الخام (بدون Social Proof)`,
              `new_ad_id: ${t3NewAdId}`,
              `creative_id: ${t3CreativeId}`,
              `destination_adset_id: ${destAdsetId}`,
              `الحالة: ${String(t3Verify.verified_fields?.effective_status ?? "PAUSED")}`,
              `ملاحظة: تم استخدام object_story_spec (video_id=${t3VideoId || "N/A"}) — اللايكات لم تُحفظ`,
            ].join(" — ");

            logger.info({ t3NewAdId, t3CreativeId, t3VideoId }, "duplicate_ad: Tier-3 Spec Rebuild succeeded");

          } catch (t3Err) {
            const t3ErrMsg = t3Err instanceof Error ? t3Err.message : String(t3Err);
            logger.warn({ t3ErrMsg, adId, destAdsetId }, "duplicate_ad: Tier-3 Spec Rebuild also failed — all paths exhausted");
            dupMsg = [
              dupMsg,
              `[Tier-2 Creative Reconstruction فشل: ${rcErrMsg}]`,
              `[Tier-3 Spec Rebuild فشل: ${t3ErrMsg}]`,
              `[كل المسارات فشلت — استخدم get_ad_creative(${adId}) ثم create_ad_from_creative_spec يدوياً]`,
            ].join(" | ");
          }
        }
      }
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
        reconstruction_used: dupMsg.includes("Creative Reconstruction"),
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
    // ── Step 1: normalize account_id — accept snake_case OR camelCase, with or without "act_" ──
    const _rawAccArg = String(args?.account_id ?? args?.accountId ?? "").trim();
    let accountId = _rawAccArg.replace(/^act_/i, "");          // always WITHOUT act_
    let accountIdWithAct = accountId ? `act_${accountId}` : ""; // always WITH act_

    const adsetId    = String(args?.adset_id ?? "").trim();
    const adName     = String(args?.ad_name ?? args?.name ?? "إعلان من منشور");
    let objectStoryId = String(args?.object_story_id ?? "").trim();
    let pageId        = String(args?.page_id ?? "").trim();
    let postId        = String(args?.post_id ?? "").trim();
    const sourceAdId  = String(args?.ad_id ?? args?.source_ad_id ?? "").trim();
    const flexMode    = Boolean(args?.flex_mode ?? false); // Single Asset Flex — Advantage+ creative

    if (!adsetId) {
      res.status(400).json({ error: "adset_id مطلوب" });
      return;
    }

    // ── Entry log — received args ─────────────────────────────────────────────
    logger.info(
      {
        tool: "create_ad_from_existing_post",
        received_account_id:      _rawAccArg    || "(empty)",
        received_ad_id:           sourceAdId    || "(empty)",
        received_object_story_id: objectStoryId || "(empty)",
        received_adset_id:        adsetId,
      },
      "create_ad_from_existing_post: args received"
    );

    // ── Step 2: Always derive account_id if missing — independent of object_story_id ──
    // Priority: ad_id → adset_id → object_story_id (last resort, page_id only)
    if (!accountId) {
      const metaTkn = process.env.META_ACCESS_TOKEN ?? "";

      // Try from ad_id first (richest source — also gives object_story_id)
      if (sourceAdId) {
        try {
          const u = new URL(`https://graph.facebook.com/v21.0/${sourceAdId}`);
          u.searchParams.set("fields", "id,account_id,creative{id,object_story_id}");
          u.searchParams.set("access_token", metaTkn);
          const j = await (await fetch(u.toString(), { signal: AbortSignal.timeout(10_000) })).json() as Record<string, unknown>;
          const fetched = String(j.account_id ?? "").replace(/^act_/, "");
          if (fetched) { accountId = fetched; accountIdWithAct = `act_${fetched}`; }
          // Also fill object_story_id while we're here
          if (!objectStoryId && !postId) {
            const cr = j.creative as Record<string, unknown> | undefined;
            objectStoryId = String(cr?.object_story_id ?? "").trim();
          }
          logger.info({ sourceAdId, derived_account_id: accountId || "(none)" }, "create_ad_from_existing_post: derived account_id from ad_id");
        } catch (e) { logger.warn({ e, sourceAdId }, "create_ad_from_existing_post: derive from ad_id failed"); }
      }

      // Try from adset_id if still missing
      if (!accountId && adsetId) {
        try {
          const u = new URL(`https://graph.facebook.com/v21.0/${adsetId}`);
          u.searchParams.set("fields", "id,account_id");
          u.searchParams.set("access_token", metaTkn);
          const j = await (await fetch(u.toString(), { signal: AbortSignal.timeout(10_000) })).json() as Record<string, unknown>;
          const fetched = String(j.account_id ?? "").replace(/^act_/, "");
          if (fetched) { accountId = fetched; accountIdWithAct = `act_${fetched}`; }
          logger.info({ adsetId, derived_account_id: accountId || "(none)" }, "create_ad_from_existing_post: derived account_id from adset_id");
        } catch (e) { logger.warn({ e, adsetId }, "create_ad_from_existing_post: derive from adset_id failed"); }
      }
    } else if (sourceAdId && !objectStoryId) {
      // account_id present but object_story_id missing — fetch object_story_id only
      try {
        const metaTkn = process.env.META_ACCESS_TOKEN ?? "";
        const u = new URL(`https://graph.facebook.com/v21.0/${sourceAdId}`);
        u.searchParams.set("fields", "id,creative{id,object_story_id}");
        u.searchParams.set("access_token", metaTkn);
        const j = await (await fetch(u.toString(), { signal: AbortSignal.timeout(10_000) })).json() as Record<string, unknown>;
        if (!postId) {
          const cr = j.creative as Record<string, unknown> | undefined;
          objectStoryId = String(cr?.object_story_id ?? "").trim();
        }
      } catch (e) { logger.warn({ e, sourceAdId }, "create_ad_from_existing_post: fetch object_story_id failed"); }
    }

    // ── Computed log — what will be sent to Pipeboard ─────────────────────────
    logger.info(
      {
        accountId:        accountId        || "(EMPTY — will fail)",
        accountIdWithAct: accountIdWithAct || "(EMPTY — will fail)",
        objectStoryId:    objectStoryId    || "(empty)",
        adsetId,
        sourceAdId: sourceAdId || "(none)",
      },
      "create_ad_from_existing_post: resolved values before Pipeboard calls"
    );

    // ── Hard guard — fail fast with clear error ────────────────────────────────
    if (!accountId) {
      res.status(400).json({
        error: "No account ID provided — أرسل account_id أو accountId في الـ bulk_action، أو تأكد أن ad_id / adset_id صحيح حتى يُجلب تلقائياً",
        received: { account_id: _rawAccArg || "(empty)", ad_id: sourceAdId || "(empty)", adset_id: adsetId },
      });
      return;
    }

    if (!objectStoryId && !postId && !(flexMode && sourceAdId)) {
      res.status(400).json({
        error: sourceAdId
          ? `فشل جلب object_story_id من الإعلان ${sourceAdId} — تأكد أن الإعلان يحتوي على منشور (object_story_id) أو استخدم flex_mode=true لإنشاء Advantage+ creative من الأصول الخام`
          : "object_story_id أو post_id أو ad_id مطلوب",
      });
      return;
    }

    function mcpTextEfp(result: unknown): string {
      return ((result as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("")
        .trim();
    }

    // ── Pre-Pipeboard log — confirms resolved values before any MCP call ─────────
    logger.info(
      {
        accountId:        accountId        || "(EMPTY — will fail)",
        accountIdWithAct: accountIdWithAct || "(EMPTY — will fail)",
        objectStoryId:    objectStoryId    || "(empty)",
        adsetId,
        sourceAdId: sourceAdId || "(none)",
      },
      "create_ad_from_existing_post: resolved values before Pipeboard calls"
    );

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

      // ── FLEX PATH: Advantage+ Single Asset creative via direct Meta API ────────
      // Bypasses Pipeboard (which rejects degrees_of_freedom_spec / advantage_plus_creative).
      if (flexMode && sourceAdId) {
        const metaTknFlex = process.env.META_ACCESS_TOKEN ?? "";

        // Fetch raw creative assets from source ad
        const flexAssetUrl = new URL(`https://graph.facebook.com/v21.0/${sourceAdId}`);
        flexAssetUrl.searchParams.set("fields", "creative{id,video_id,image_hash,body,title,link_url,call_to_action}");
        flexAssetUrl.searchParams.set("access_token", metaTknFlex);
        const flexAssetJson = await (await fetch(flexAssetUrl.toString(), { signal: AbortSignal.timeout(12_000) })).json() as Record<string, unknown>;
        const flexCr      = (flexAssetJson.creative ?? {}) as Record<string, unknown>;
        const flexVideoId = String(flexCr.video_id   ?? "");
        const flexImgHash = String(flexCr.image_hash  ?? "");
        const flexText    = String(flexCr.body        ?? "");
        const flexTitle   = String(flexCr.title       ?? "");
        let   flexLink    = String(flexCr.link_url    ?? "");
        const flexCtaObj  = (flexCr.call_to_action ?? {}) as Record<string, unknown>;
        const flexCtaType = String(flexCtaObj.type ?? "SHOP_NOW");
        if (!flexLink && flexCtaObj.value) flexLink = String((flexCtaObj.value as Record<string, unknown>).link ?? "");

        if (!flexVideoId && !flexImgHash) throw new Error("Flex Mode: لا يوجد video_id أو image_hash في الإعلان المصدر");
        if (!flexLink) throw new Error("Flex Mode: لا يوجد link_url في الإعلان المصدر");

        const flexSpec: Record<string, unknown> = flexVideoId
          ? { page_id: pageId, video_data: { video_id: flexVideoId, ...(flexText ? { message: flexText } : {}), ...(flexTitle ? { link_description: flexTitle } : {}), call_to_action: { type: flexCtaType, value: { link: flexLink } } } }
          : { page_id: pageId, link_data: { image_hash: flexImgHash, ...(flexText ? { message: flexText } : {}), ...(flexTitle ? { name: flexTitle } : {}), link: flexLink, call_to_action: { type: flexCtaType, value: { link: flexLink } } } };

        const flexCreativeBody = new URLSearchParams({
          name:                    `${adName} — flex creative`,
          object_story_spec:       JSON.stringify(flexSpec),
          degrees_of_freedom_spec: JSON.stringify({ creative_features_spec: { standard_enhancements: { enroll_status: "OPT_IN" } } }),
          advantage_plus_creative: JSON.stringify({ enroll_status: "OPT_IN" }),
          access_token:            metaTknFlex,
        });

        const flexCrResp = await fetch(`https://graph.facebook.com/v21.0/${accountIdWithAct}/adcreatives`,
          { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: flexCreativeBody, signal: AbortSignal.timeout(15_000) });
        const flexCrJson = await flexCrResp.json() as Record<string, unknown>;
        if (flexCrJson.error) {
          const fe = flexCrJson.error as Record<string, unknown>;
          throw new Error(`Flex create_ad_creative فشل — ${String(fe.message ?? "")}${fe.fbtrace_id ? ` | fbtrace: ${String(fe.fbtrace_id)}` : ""}`);
        }
        const flexCreativeId = String(flexCrJson.id ?? "");
        if (!flexCreativeId) throw new Error("Flex Mode: Meta لم يُعد creative_id");
        logger.info({ flexCreativeId, flexVideoId: flexVideoId || "(image)", adsetId }, "create_ad_from_existing_post: flex creative created (Advantage+)");

        const flexAdBody = new URLSearchParams({
          name: adName, adset_id: adsetId,
          creative: JSON.stringify({ creative_id: flexCreativeId }),
          status: "PAUSED", access_token: metaTknFlex,
        });
        const flexAdJson = await (await fetch(`https://graph.facebook.com/v21.0/${accountIdWithAct}/ads`,
          { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: flexAdBody, signal: AbortSignal.timeout(15_000) })).json() as Record<string, unknown>;
        if (flexAdJson.error) {
          const fe = flexAdJson.error as Record<string, unknown>;
          throw new Error(`Flex create_ad فشل — ${String(fe.message ?? "")}`);
        }
        const flexNewAdId = String(flexAdJson.id ?? "");
        if (!flexNewAdId) throw new Error("Flex Mode: Meta لم يُعد ad_id");

        const flexVerify = await verifyMetaEntityDirect(flexNewAdId, "id,name,status,effective_status,adset_id,campaign_id,creative{id}", metaTknFlex);
        if (!flexVerify.verified) throw new Error(`Flex Mode: verify فشل للإعلان ${flexNewAdId}`);

        efpSuccess = true;
        efpMsg = [
          `✅ Flex Creative (Advantage+) تم إنشاؤه — Standard Enhancements: OPT_IN`,
          `new_ad_id: ${flexNewAdId}`,
          `creative_id: ${flexCreativeId}`,
          `adset_id: ${adsetId}`,
          `نوع: ${flexVideoId ? "Video" : "Image"} — Meta قد يولّد تنسيقات إضافية تلقائياً`,
          `الحالة: ${String(flexVerify.verified_fields?.effective_status ?? "PAUSED")}`,
        ].join(" — ");
        (args as Record<string, unknown>).__new_ad_id = flexNewAdId;
        (args as Record<string, unknown>).__efpVerify = flexVerify;

      } else {
        // ── NORMAL PATH: Pipeboard create_ad_creative (Social Proof preserved) ──
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
          arguments: { account_id: accountIdWithAct, name: adName, adset_id: adsetId, creative_id: creativeId, status: "PAUSED" },
        });
        const adText = mcpTextEfp(adResult);
        logger.info({ adText }, "create_ad_from_existing_post: create_ad");
        if (/"error"/.test(adText) && !/"id"/.test(adText)) {
          throw new Error(`فشل create_ad — ${extractMetaError(adText)}`);
        }
        const adMatch = adText.match(/"id"\s*:\s*"(\d+)"/) ?? adText.match(/\b(\d{10,})\b/);
        const newAdId = adMatch?.[1] ?? "";
        if (!newAdId) throw new Error(`لم يُعد ad_id — ${extractMetaError(adText)}`);

        const efpVerify = await verifyMetaEntityDirect(
          newAdId, "id,name,status,effective_status,adset_id,campaign_id,created_time,updated_time",
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
      } // end flex vs normal
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

  // ── create_ad_from_creative_spec — fallback: rebuild from raw assets ─────────
  if (tool === "create_ad_from_creative_spec") {
    const rawAccountId = String(args?.account_id ?? "");
    const accountId = rawAccountId.startsWith("act_") ? rawAccountId.slice(4) : rawAccountId;
    const accountIdWithAct = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;
    const adsetId = String(args?.adset_id ?? "");
    const adName = String(args?.name ?? "إعلان من أصول creative");
    const primaryText = String(args?.primary_text ?? "");
    const headline = String(args?.headline ?? "");
    const linkUrl = String(args?.link_url ?? "");
    const callToAction = String(args?.call_to_action ?? "SHOP_NOW");
    const mediaType = String(args?.media_type ?? "video");
    const videoId = String(args?.video_id ?? "");
    const imageHash = String(args?.image_hash ?? "");
    let pageId = String(args?.page_id ?? "").trim();
    let instagramActorId = String(args?.instagram_actor_id ?? "").trim();

    if (!accountId)   { res.status(400).json({ error: "account_id مطلوب" }); return; }
    if (!adsetId)     { res.status(400).json({ error: "adset_id مطلوب" }); return; }
    if (!linkUrl)     { res.status(400).json({ error: "link_url مطلوب" }); return; }
    if (mediaType === "video" && !videoId)   { res.status(400).json({ error: "video_id مطلوب لـ media_type=video" });  return; }
    if (mediaType === "image" && !imageHash) { res.status(400).json({ error: "image_hash مطلوب لـ media_type=image" }); return; }

    const metaTkn = process.env.META_ACCESS_TOKEN ?? "";
    if (!metaTkn) { res.status(500).json({ error: "META_ACCESS_TOKEN غير مضبوط" }); return; }

    let csSuccess = false;
    let csMsg = "";

    try {
      // Auto-fetch page_id if missing
      if (!pageId) {
        const pagesUrl = new URL(`https://graph.facebook.com/v21.0/${accountIdWithAct}/pages`);
        pagesUrl.searchParams.set("fields", "id,name");
        pagesUrl.searchParams.set("access_token", metaTkn);
        const pagesResp = await fetch(pagesUrl.toString(), { signal: AbortSignal.timeout(10_000) });
        const pagesJson = await pagesResp.json() as { data?: Array<{ id: string }> };
        pageId = pagesJson.data?.[0]?.id ?? "";
        if (!pageId) throw new Error("تعذّر جلب page_id — أرسل page_id يدوياً");
      }
      if (!instagramActorId) instagramActorId = pageId;

      // Step 1: build object_story_spec
      let objectStorySpec: Record<string, unknown>;
      if (mediaType === "video") {
        objectStorySpec = {
          page_id: pageId,
          video_data: {
            video_id: videoId,
            ...(primaryText ? { message: primaryText } : {}),
            ...(headline    ? { link_description: headline } : {}),
            call_to_action: { type: callToAction, value: { link: linkUrl } },
          },
        };
      } else {
        objectStorySpec = {
          page_id: pageId,
          link_data: {
            image_hash: imageHash,
            ...(primaryText ? { message: primaryText } : {}),
            ...(headline    ? { name: headline } : {}),
            link: linkUrl,
            call_to_action: { type: callToAction, value: { link: linkUrl } },
          },
        };
      }

      // Step 2: POST adcreatives
      const creativeBody = new URLSearchParams({
        name: `${adName} — creative`,
        object_story_spec: JSON.stringify(objectStorySpec),
        access_token: metaTkn,
      });
      if (instagramActorId) creativeBody.set("instagram_actor_id", instagramActorId);

      const creativeResp = await fetch(
        `https://graph.facebook.com/v21.0/${accountIdWithAct}/adcreatives`,
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: creativeBody, signal: AbortSignal.timeout(15_000) }
      );
      const creativeJson = await creativeResp.json() as Record<string, unknown>;
      if (creativeJson.error) {
        const metaErr = parseMetaErrorDetails(JSON.stringify(creativeJson));
        const e = creativeJson.error as Record<string, unknown>;
        throw new Error(`فشل create_ad_creative — ${String(e.message ?? "")}${metaErr.fbtrace_id ? ` | fbtrace: ${metaErr.fbtrace_id}` : ""}`);
      }
      const creativeId = String(creativeJson.id ?? "");
      if (!creativeId) throw new Error("Meta لم يُعد creative_id");
      logger.info({ creativeId, mediaType, adsetId }, "create_ad_from_creative_spec: creative created");

      // Step 3: POST ads
      const adBody = new URLSearchParams({
        name: adName,
        adset_id: adsetId,
        creative: JSON.stringify({ creative_id: creativeId }),
        status: "PAUSED",
        access_token: metaTkn,
      });
      const adResp = await fetch(
        `https://graph.facebook.com/v21.0/${accountIdWithAct}/ads`,
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: adBody, signal: AbortSignal.timeout(15_000) }
      );
      const adJson = await adResp.json() as Record<string, unknown>;
      if (adJson.error) {
        const metaErr = parseMetaErrorDetails(JSON.stringify(adJson));
        const e = adJson.error as Record<string, unknown>;
        throw new Error(`فشل create_ad — ${String(e.message ?? "")}${metaErr.fbtrace_id ? ` | fbtrace: ${metaErr.fbtrace_id}` : ""}`);
      }
      const newAdId = String(adJson.id ?? "");
      if (!newAdId) throw new Error("Meta لم يُعد ad_id");

      // Step 4: verify
      const csVerify = await verifyMetaEntityDirect(newAdId, "id,name,status,effective_status,adset_id,campaign_id,creative{id}", metaTkn);
      if (!csVerify.verified) throw new Error(`verify فشل للإعلان ${newAdId}`);

      csSuccess = true;
      csMsg = [
        `✅ create_ad_from_creative_spec نجح — تم بناء الإعلان من أصول خام (بدون Social Proof)`,
        `new_ad_id: ${newAdId}`,
        `creative_id: ${creativeId}`,
        `adset_id: ${adsetId}`,
        `media_type: ${mediaType}`,
        `الحالة: ${String(csVerify.verified_fields?.effective_status ?? "PAUSED")}`,
      ].join(" — ");
      (args as Record<string, unknown>).__new_ad_id = newAdId;
      (args as Record<string, unknown>).__cs_verify = csVerify;
      (args as Record<string, unknown>).__creative_id = creativeId;
    } catch (err) {
      csMsg = err instanceof Error ? err.message : String(err);
    }

    await query(
      `INSERT INTO pipeboard_actions (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [executedBy, tool, JSON.stringify(args ?? {}), csSuccess, csMsg, null, adsetId, false]
    ).catch((e: unknown) => logger.warn({ e }, "pipeboard audit insert failed"));

    if (csSuccess) {
      const newAdIdOut = String((args as Record<string, unknown>).__new_ad_id ?? "");
      const csV = (args as Record<string, unknown>).__cs_verify as VerifyResult | undefined;
      const creativeIdOut = String((args as Record<string, unknown>).__creative_id ?? "");
      res.json({ success: true, message: csMsg, new_ad_id: newAdIdOut, creative_id: creativeIdOut, adset_id: adsetId, media_type: mediaType, verified: true, verified_fields: csV?.verified_fields });
    } else {
      const metaErrDetails = parseMetaErrorDetails(csMsg);
      res.status(500).json({ error: csMsg, meta_error: metaErrDetails });
    }
    return;
  }

  // ── publish_winners_to_destination — Social Proof → Rebuild pipeline ─────────
  if (tool === "publish_winners_to_destination") {
    const rawAccountId = String(args?.account_id ?? "");
    const accountId = rawAccountId.startsWith("act_") ? rawAccountId.slice(4) : rawAccountId;
    const destinationAdsetId = String(args?.destination_adset_id ?? "");
    const namingPrefix = String(args?.naming_prefix ?? "Winner");
    const flexMode = Boolean(args?.flex_mode ?? false); // Single Asset Flex — skip Social Proof, use Advantage+ creative
    const sourceAdIds: string[] = Array.isArray(args?.source_ad_ids)
      ? (args.source_ad_ids as unknown[]).map(String).filter(Boolean)
      : String(args?.source_ad_ids ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);

    if (!destinationAdsetId) { res.status(400).json({ error: "destination_adset_id مطلوب" }); return; }
    if (sourceAdIds.length === 0) { res.status(400).json({ error: "source_ad_ids مطلوب" }); return; }

    const metaTkn = process.env.META_ACCESS_TOKEN ?? "";
    if (!metaTkn) { res.status(500).json({ error: "META_ACCESS_TOKEN غير مضبوط" }); return; }

    interface AdPublishResult {
      source_ad_id: string;
      method_used: "existing_post" | "creative_spec";
      new_ad_id: string;
      creative_id?: string;
      status: string;
    }
    interface AdPublishFailure {
      source_ad_id: string;
      social_proof_error: string;
      rebuild_error: string;
    }

    const createdAds: AdPublishResult[] = [];
    const failedAds: AdPublishFailure[] = [];

    for (const sourceAdId of sourceAdIds) {
      let socialProofError = "";
      let rebuildError = "";

      try {
        // ── Fetch creative data ──────────────────────────────────────────────
        const srcUrl = new URL(`https://graph.facebook.com/v21.0/${sourceAdId}`);
        srcUrl.searchParams.set("fields", "id,account_id,creative{id,object_story_id,effective_object_story_id,body,title,video_id,image_hash,link_url,call_to_action,instagram_actor_id,asset_feed_spec,thumbnail_url,object_story_spec}");
        srcUrl.searchParams.set("access_token", metaTkn);
        const srcResp = await fetch(srcUrl.toString(), { signal: AbortSignal.timeout(12_000) });
        const srcJson = await srcResp.json() as Record<string, unknown>;
        if (srcJson.error) {
          const e = srcJson.error as Record<string, unknown>;
          throw new Error(`Meta error fetching ad: ${String(e.message ?? "")}`);
        }

        const rawSrcAccId = String(srcJson.account_id ?? "").replace(/^act_/, "") || accountId;
        const c = (srcJson.creative ?? {}) as Record<string, unknown>;
        const objectStoryId = String(c.effective_object_story_id ?? c.object_story_id ?? "").trim();
        let pageId = objectStoryId ? objectStoryId.split("_")[0] ?? "" : "";
        const instagramActorId = String(c.instagram_actor_id ?? pageId);
        const assetFeed = (c.asset_feed_spec ?? {}) as Record<string, unknown>;
        const assetVideos = Array.isArray(assetFeed.videos) ? (assetFeed.videos as Array<Record<string,unknown>>) : [];
        const assetImages = Array.isArray(assetFeed.images) ? (assetFeed.images as Array<Record<string,unknown>>) : [];
        const objStorySpec = (c.object_story_spec ?? {}) as Record<string, unknown>;
        const videoData = (objStorySpec.video_data ?? {}) as Record<string, unknown>;
        const linkData = (objStorySpec.link_data ?? {}) as Record<string, unknown>;
        const videoId = String(c.video_id ?? assetVideos[0]?.video_id ?? videoData.video_id ?? "");
        const imageHash = String(c.image_hash ?? assetImages[0]?.hash ?? linkData.image_hash ?? "");
        if (!linkUrl && videoData.call_to_action) {
          const vtaCta = (videoData.call_to_action as Record<string,unknown>);
          if (vtaCta.value) linkUrl = String((vtaCta.value as Record<string,unknown>).link ?? "");
        }
        const primaryText = String(c.body ?? "");
        const headline = String(c.title ?? "");
        let linkUrl = String(c.link_url ?? "");
        const ctaObj = (c.call_to_action ?? {}) as Record<string, unknown>;
        const callToAction = String(ctaObj.type ?? "SHOP_NOW");
        if (!linkUrl && ctaObj.value) linkUrl = String((ctaObj.value as Record<string, unknown>).link ?? "");
        const adLabel = `${namingPrefix} — ${sourceAdId}`;

        logger.info({ sourceAdId, objectStoryId, videoId: videoId || "(none)" }, "publish_winners: creative fetched");

        // ── Path 1: Social Proof (skipped in Flex Mode — Advantage+ needs raw assets) ──
        if (objectStoryId && !flexMode) {
          try {
            const pbClient = await getPipeboardWriteClient();
            const spCreativeArgs: Record<string, unknown> = {
              account_id: rawSrcAccId,
              name: `${adLabel} — creative`,
              page_id: pageId,
              object_story_id: objectStoryId,
            };
            if (instagramActorId) spCreativeArgs.instagram_actor_id = instagramActorId;

            const spCreativeResult = await pbClient.callTool({ name: "create_ad_creative", arguments: spCreativeArgs });
            const spCreativeText = ((spCreativeResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
              .filter((x: { type: string }) => x.type === "text")
              .map((x: { text?: string }) => x.text ?? "")
              .join("").trim();

            if (/"error"/.test(spCreativeText) && !/"id"/.test(spCreativeText)) throw new Error(extractMetaError(spCreativeText));
            const spCreativeId = spCreativeText.match(/"id"\s*:\s*"(\d{10,})"/)?.[1] ?? "";
            if (!spCreativeId) throw new Error(`لم يُعد creative_id: ${spCreativeText.slice(0, 200)}`);

            const spAdResult = await pbClient.callTool({
              name: "create_ad",
              arguments: { account_id: `act_${rawSrcAccId}`, name: adLabel, adset_id: destinationAdsetId, creative_id: spCreativeId, status: "PAUSED" },
            });
            const spAdText = ((spAdResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
              .filter((x: { type: string }) => x.type === "text")
              .map((x: { text?: string }) => x.text ?? "")
              .join("").trim();

            if (/"error"/.test(spAdText) && !/"id"/.test(spAdText)) throw new Error(extractMetaError(spAdText));
            const spNewAdId = spAdText.match(/"id"\s*:\s*"(\d+)"/)?.[1] ?? spAdText.match(/\b(\d{10,})\b/)?.[1] ?? "";
            if (!spNewAdId) throw new Error(`لم يُعد ad_id: ${spAdText.slice(0, 200)}`);

            const spVerify = await verifyMetaEntityDirect(spNewAdId, "id,name,status,effective_status,adset_id", metaTkn);
            if (!spVerify.verified) throw new Error(`verify فشل للإعلان ${spNewAdId}`);

            createdAds.push({ source_ad_id: sourceAdId, method_used: "existing_post", new_ad_id: spNewAdId, creative_id: spCreativeId, status: String(spVerify.verified_fields?.effective_status ?? "PAUSED") });
            logger.info({ sourceAdId, spNewAdId }, "publish_winners: Social Proof succeeded");
            continue;
          } catch (spErr) {
            socialProofError = spErr instanceof Error ? spErr.message : String(spErr);
            logger.warn({ sourceAdId, socialProofError }, "publish_winners: Social Proof failed — trying Rebuild");
            _pbWriteClient = null; _pbWriteConnecting = null;
          }
        } else if (flexMode) {
          socialProofError = "Flex Mode — Social Proof skipped intentionally (Advantage+ raw asset rebuild)";
          logger.info({ sourceAdId }, "publish_winners: Flex Mode — skipping Social Proof");
        } else {
          socialProofError = "لا يوجد object_story_id — Social Proof غير ممكن";
        }

        // ── Path 2: Rebuild from raw assets (+ Advantage+ Flex fields if flexMode) ──
        // Flex Mode: pageId may be empty if no objectStoryId — fetch from account pages
        if (flexMode && !pageId && rawSrcAccId) {
          try {
            const pgUrl = new URL(`https://graph.facebook.com/v21.0/act_${rawSrcAccId}/pages`);
            pgUrl.searchParams.set("fields", "id"); pgUrl.searchParams.set("access_token", metaTkn);
            const pgJson = await (await fetch(pgUrl.toString(), { signal: AbortSignal.timeout(10_000) })).json() as { data?: Array<{ id: string }> };
            pageId = pgJson.data?.[0]?.id ?? "";
          } catch { /* use empty — Meta will return a clear error */ }
        }

        if (!videoId && !imageHash) {
          rebuildError = "لا يوجد video_id أو image_hash — Rebuild غير ممكن";
          failedAds.push({ source_ad_id: sourceAdId, social_proof_error: socialProofError, rebuild_error: rebuildError });
          continue;
        }
        if (!linkUrl) {
          rebuildError = "لا يوجد link_url — Rebuild غير ممكن";
          failedAds.push({ source_ad_id: sourceAdId, social_proof_error: socialProofError, rebuild_error: rebuildError });
          continue;
        }

        const objSpec: Record<string, unknown> = videoId
          ? { page_id: pageId, video_data: { video_id: videoId, ...(primaryText ? { message: primaryText } : {}), ...(headline ? { link_description: headline } : {}), call_to_action: { type: callToAction, value: { link: linkUrl } } } }
          : { page_id: pageId, link_data: { image_hash: imageHash, ...(primaryText ? { message: primaryText } : {}), ...(headline ? { name: headline } : {}), link: linkUrl, call_to_action: { type: callToAction, value: { link: linkUrl } } } };

        const rbCreativeBody = new URLSearchParams({ name: `${adLabel} — ${flexMode ? "flex" : "rebuild"} creative`, object_story_spec: JSON.stringify(objSpec), access_token: metaTkn });
        if (instagramActorId) rbCreativeBody.set("instagram_actor_id", instagramActorId);
        // Advantage+ Single Asset Flex — let Meta generate Collection/Catalog formats automatically
        if (flexMode) {
          rbCreativeBody.set("degrees_of_freedom_spec", JSON.stringify({ creative_features_spec: { standard_enhancements: { enroll_status: "OPT_IN" } } }));
          rbCreativeBody.set("advantage_plus_creative", JSON.stringify({ enroll_status: "OPT_IN" }));
        }

        const rbCreativeResp = await fetch(`https://graph.facebook.com/v21.0/act_${rawSrcAccId}/adcreatives`,
          { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: rbCreativeBody, signal: AbortSignal.timeout(15_000) });
        const rbCreativeJson = await rbCreativeResp.json() as Record<string, unknown>;
        if (rbCreativeJson.error) {
          const e = rbCreativeJson.error as Record<string, unknown>;
          throw new Error(`Rebuild creative فشل: ${String(e.message ?? "")}`);
        }
        const rbCreativeId = String(rbCreativeJson.id ?? "");
        if (!rbCreativeId) throw new Error("Rebuild: Meta لم يُعد creative_id");

        const rbAdBody = new URLSearchParams({ name: `${adLabel} — rebuild`, adset_id: destinationAdsetId, creative: JSON.stringify({ creative_id: rbCreativeId }), status: "PAUSED", access_token: metaTkn });
        const rbAdResp = await fetch(`https://graph.facebook.com/v21.0/act_${rawSrcAccId}/ads`,
          { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: rbAdBody, signal: AbortSignal.timeout(15_000) });
        const rbAdJson = await rbAdResp.json() as Record<string, unknown>;
        if (rbAdJson.error) {
          const e = rbAdJson.error as Record<string, unknown>;
          throw new Error(`Rebuild create_ad فشل: ${String(e.message ?? "")}`);
        }
        const rbNewAdId = String(rbAdJson.id ?? "");
        if (!rbNewAdId) throw new Error("Rebuild: Meta لم يُعد ad_id");

        const rbVerify = await verifyMetaEntityDirect(rbNewAdId, "id,name,status,effective_status,adset_id", metaTkn);
        if (!rbVerify.verified) throw new Error(`Rebuild verify فشل للإعلان ${rbNewAdId}`);

        createdAds.push({ source_ad_id: sourceAdId, method_used: flexMode ? "creative_spec_flex" as "creative_spec" : "creative_spec", new_ad_id: rbNewAdId, creative_id: rbCreativeId, status: String(rbVerify.verified_fields?.effective_status ?? "PAUSED") });
        logger.info({ sourceAdId, rbNewAdId, flexMode }, "publish_winners: Rebuild succeeded");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!socialProofError) socialProofError = errMsg; else rebuildError = errMsg;
        failedAds.push({ source_ad_id: sourceAdId, social_proof_error: socialProofError, rebuild_error: rebuildError || errMsg });
        logger.warn({ sourceAdId, errMsg }, "publish_winners: both paths failed");
      }
    }

    const pwMsg = `publish_winners_to_destination: ${createdAds.length} نجح، ${failedAds.length} فشل`;
    await query(
      `INSERT INTO pipeboard_actions (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [executedBy, tool, JSON.stringify(args ?? {}), createdAds.length > 0, pwMsg, null, destinationAdsetId, false]
    ).catch((e: unknown) => logger.warn({ e }, "pipeboard audit insert failed"));

    res.json({
      success: createdAds.length > 0,
      message: pwMsg,
      destination_adset_id: destinationAdsetId,
      created_ads: createdAds,
      failed_ads: failedAds,
      summary: { total: sourceAdIds.length, succeeded: createdAds.length, failed: failedAds.length },
    });
    return;
  }

  // ── Special multi-step: launch_pipeboard_campaign ────────────────────────
  if (tool === "launch_pipeboard_campaign") {
    // ── Types ──────────────────────────────────────────────────────────────
    interface AdsetInput { name: string; budget: number; targeting?: string }
    interface CreativeInput { media_url: string; media_type: string; texts: string[]; headlines: string[] }
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
          texts: [String(args?.primary_text ?? "")].filter(Boolean),
          headlines: [String(args?.headline ?? "")].filter(Boolean),
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
              messages: creative.texts.length > 0 ? creative.texts : undefined,
              headlines: creative.headlines.length > 0 ? creative.headlines : undefined,
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
    // ── DEEP FIX: Auto-inject promoted_object for SALES campaigns ─────────────
    // Meta REJECTS adsets for OUTCOME_SALES campaigns when promoted_object is
    // missing — the MCP then returns the parent campaign id, triggering the
    // "Logic Error". Fix: fetch campaign objective first; if SALES, inject pixel.
    const pixelDomainMap: Record<string, string> = {
      "buzzpick.net":  "1405391498274239",
      "dealme-eg.com": "1537301040808359",
    };

    let effectiveArgs: Record<string, unknown> = { ...(args ?? {}) };
    const metaTokenSales = process.env.META_ACCESS_TOKEN;
    const salesCampaignId = String(effectiveArgs.campaign_id ?? "");

    if (metaTokenSales && salesCampaignId) {
      try {
        // Fetch campaign — include campaign_id field so we detect if caller passed an adset_id by mistake
        const campObjUrl = new URL(`https://graph.facebook.com/v21.0/${salesCampaignId}`);
        campObjUrl.searchParams.set("fields", "id,objective,name,daily_budget,lifetime_budget,campaign_id");
        campObjUrl.searchParams.set("access_token", metaTokenSales);
        const campObjResp = await fetch(campObjUrl.toString(), { signal: AbortSignal.timeout(8_000) });
        const campObjJson = await campObjResp.json() as Record<string, unknown>;
        const objective = String(campObjJson.objective ?? "").toUpperCase();

        // ── PRE-CALL ID GUARD: campaign_id arg MUST be a campaign, not an adset ──
        // If Meta returns a `campaign_id` field on the fetched entity, the entity IS
        // an adset — caller accidentally passed adset_id where campaign_id is expected.
        if (campObjJson.campaign_id != null) {
          throw new Error(
            `Pre-call ID Guard: campaign_id="${salesCampaignId}" هو adset_id وليس campaign_id ` +
            `(Meta أعاد campaign_id=${campObjJson.campaign_id} للـ entity ده). ` +
            `من فضلك أرسل الـ campaign_id الصحيح، وليس الـ adset_id.`
          );
        }

        // ── CBO Budget Fix: strip adset-level budget for CBO campaigns ────────
        // Meta REJECTS adsets with daily_budget/lifetime_budget when the parent
        // campaign is CBO (has its own daily_budget or lifetime_budget).
        const campHasBudget =
          (campObjJson.daily_budget    != null && String(campObjJson.daily_budget)    !== "0") ||
          (campObjJson.lifetime_budget != null && String(campObjJson.lifetime_budget) !== "0");

        if (campHasBudget) {
          const strippedBudget = effectiveArgs.daily_budget ?? effectiveArgs.lifetime_budget;
          if (effectiveArgs.daily_budget != null || effectiveArgs.lifetime_budget != null) {
            delete effectiveArgs.daily_budget;
            delete effectiveArgs.lifetime_budget;
            logger.info(
              { salesCampaignId, campaign_daily_budget: campObjJson.daily_budget, stripped_adset_budget: strippedBudget },
              "create_adset: CBO campaign detected — stripped adset daily_budget/lifetime_budget to prevent Budget Conflict"
            );
          } else {
            logger.info({ salesCampaignId }, "create_adset: CBO campaign detected — no adset budget to strip");
          }
        }

        // ── AUTO-TARGETING FALLBACK + ADVANTAGE+ AUDIENCE (all campaign types) ──
        // Meta REQUIRES at least one geo_location. Advantage+ Audience (AA) is
        // injected universally for both ABO and CBO — Meta's AI optimises delivery.
        const DEFAULT_TARGETING = {
          geo_locations: { countries: ["EG"], location_types: ["home"] },
        };
        const tgt = effectiveArgs.targeting as Record<string, unknown> | undefined;
        if (!tgt) {
          effectiveArgs.targeting = DEFAULT_TARGETING;
        } else {
          if (!tgt.geo_locations) {
            tgt.geo_locations = { countries: ["EG"], location_types: ["home"] };
          }
        }
        // Advantage+ Audience — top-level parameters (NOT inside targeting)
        if (!effectiveArgs.advantage_plus_audience) {
          effectiveArgs.advantage_plus_audience = 1;
        }
        if (!effectiveArgs.targeting_automation) {
          effectiveArgs.targeting_automation = { advantage_audience: 1 };
        }
        // Always use LOWEST_COST_WITHOUT_CAP to avoid bid amount requirement
        if (!effectiveArgs.bid_strategy) {
          effectiveArgs.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
        }
        logger.info(
          { had_geo: !!(tgt?.geo_locations) },
          "create_adset: targeting merged — Advantage+ Audience top-level + EG residents ensured"
        );

        const isSales = objective.includes("SALES") || objective === "OUTCOME_SALES";
        if (isSales) {
          logger.info({ objective, salesCampaignId }, "create_adset: SALES campaign detected — enforcing promoted_object");

          // Ensure optimization_goal + billing_event for SALES
          effectiveArgs.optimization_goal = "OFFSITE_CONVERSIONS";
          effectiveArgs.billing_event     = "IMPRESSIONS";

          const existingPO = effectiveArgs.promoted_object as Record<string, unknown> | undefined;
          if (!existingPO?.pixel_id) {
            // ── Keyword-first pixel detection (case-insensitive) ─────────────────
            // Matches brand keywords (buzzpick / dealme) ANYWHERE in the args —
            // campaign name, landing_page_url, adset name, etc. — so pixel is
            // auto-injected even when no full domain URL is present.
            const pixelKeywordMap: Record<string, string> = {
              "buzzpick":  "1405391498274239",
              "dealme":    "1537301040808359",
            };
            const argsStrLower = JSON.stringify(effectiveArgs).toLowerCase();
            let detectedPixelId: string | null = null;
            // 1st pass: keyword match (e.g. campaign name "Buzzpick Q2")
            for (const [kw, pixelId] of Object.entries(pixelKeywordMap)) {
              if (argsStrLower.includes(kw)) { detectedPixelId = pixelId; break; }
            }
            // 2nd pass: full domain match as fallback (original pixelDomainMap)
            if (!detectedPixelId) {
              for (const [domain, pixelId] of Object.entries(pixelDomainMap)) {
                if (argsStrLower.includes(domain)) { detectedPixelId = pixelId; break; }
              }
            }

            if (detectedPixelId) {
              effectiveArgs.promoted_object = { pixel_id: detectedPixelId, custom_event_type: "PURCHASE" };
              logger.info({ detectedPixelId, objective }, "create_adset: auto-injected promoted_object from domain/keyword map");
            } else {
              // No keyword/domain hint — will fail at Meta. Log clearly.
              logger.warn({ objective, argsStrLower: argsStrLower.slice(0, 200) },
                "create_adset: SALES campaign but no brand keyword or domain found — promoted_object not injected; " +
                "pass promoted_object explicitly or include landing_page_url / campaign name containing buzzpick or dealme");
            }
          } else {
            logger.info({ pixelId: existingPO.pixel_id }, "create_adset: promoted_object already present — using it");
          }
        }
      } catch (objErr) {
        logger.warn({ objErr }, "create_adset: campaign objective pre-fetch failed (non-fatal) — proceeding without injection");
      }
    }

    const { mcpTool: asMcpTool, mcpArgs: asMcpArgs } = translateToMcp("create_adset", effectiveArgs);
    const rawAccId = String(effectiveArgs.account_id ?? "");

    let asSuccess = false;
    let asMsg = "";
    let asAdsetId = "";
    let asData: Record<string, unknown> = {};
    let asError: Record<string, unknown> | null = null;
    let asVerifyOk = false;
    let asVerifyError: MetaErrorDetails | undefined;

    try {
      const client = await getPipeboardWriteClient();

      // ── Log exact Pipeboard request ───────────────────────────────────────
      logger.info({
        pipeboard_tool:    asMcpTool,
        pipeboard_args:    asMcpArgs,   // full body sent to Pipeboard MCP
      }, "create_adset: → Pipeboard request");

      const result = await client.callTool({ name: asMcpTool, arguments: asMcpArgs });

      // ── Log full raw Pipeboard response ───────────────────────────────────
      const rawResult = result as { content?: Array<{ type: string; text?: string }> };
      logger.info({
        pipeboard_raw_content: rawResult.content,   // full array, not truncated
      }, "create_adset: ← Pipeboard raw response");

      const textContent = (rawResult.content ?? [])
        .filter(c => c.type === "text")
        .map(c => c.text ?? "")
        .join("")
        .trim();

      logger.info({ textContent }, "create_adset: MCP textContent (full)");

      // ── Try JSON parse first — Pipeboard may return structured JSON ───────
      let parsedJson: Record<string, unknown> | null = null;
      try {
        const maybeJson = JSON.parse(textContent) as unknown;
        if (maybeJson && typeof maybeJson === "object" && !Array.isArray(maybeJson)) {
          parsedJson = maybeJson as Record<string, unknown>;
          logger.info({ parsedJson }, "create_adset: textContent parsed as JSON");
        }
      } catch { /* not JSON — will fall back to regex */ }

      // ── Dynamic ID mapping — handle all known Pipeboard response shapes ─────
      // Shape A: { "id": "123" }                    (root-level id)
      // Shape B: { "data": { "id": "123" } }        (nested under data)
      // Shape C: { "adset_id": "123" }              (alternative key)
      // Shape D: { "adset": { "id": "123" } }       (nested under adset)
      // Shape E: plain text with a 13+ digit number (regex fallback)
      const nestedData = parsedJson?.data != null && typeof parsedJson.data === "object"
        ? parsedJson.data as Record<string, unknown> : null;
      const nestedAdset = parsedJson?.adset != null && typeof parsedJson.adset === "object"
        ? parsedJson.adset as Record<string, unknown> : null;

      const jsonId =
        parsedJson?.id       != null ? String(parsedJson.id)        :   // Shape A
        nestedData?.id       != null ? String(nestedData.id)        :   // Shape B
        parsedJson?.adset_id != null ? String(parsedJson.adset_id)  :   // Shape C
        nestedAdset?.id      != null ? String(nestedAdset.id)       :   // Shape D
        null;

      const idMatch = textContent.match(/"id"\s*:\s*"(\d+)"/) ?? textContent.match(/\b(\d{13,})\b/);
      asAdsetId = jsonId ?? idMatch?.[1] ?? "";

      logger.info({
        asAdsetId,
        jsonId,
        regexMatch: idMatch?.[1],
        shape_detected:
          parsedJson?.id        != null ? "A-root-id"    :
          nestedData?.id        != null ? "B-data.id"    :
          parsedJson?.adset_id  != null ? "C-adset_id"   :
          nestedAdset?.id       != null ? "D-adset.id"   :
          idMatch               != null ? "E-regex"       : "UNKNOWN",
      }, "create_adset: extracted adset_id (dynamic mapping)");

      if (!asAdsetId) {
        // No id found in any known shape — include the full raw response in the
        // error so the AI can surface it directly to the user for manual diagnosis.
        const rawDump = parsedJson
          ? JSON.stringify(parsedJson, null, 2)
          : textContent.slice(0, 800);

        logger.error({ rawDump, textContent }, "create_adset: ID mapping failure — no id found in Pipeboard response");

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
          raw_pipeboard_response: rawDump,    // included so AI can surface it to user
        };

        // Build the error message — put error_user_msg FIRST so the AI/user
        // sees the human-readable Meta rejection reason immediately.
        const userFacingMsg = asError.error_user_msg
          ? String(asError.error_user_msg)
          : asError.error_user_title
          ? String(asError.error_user_title)
          : null;

        const detail = [
          userFacingMsg                  ? `META_REASON: ${userFacingMsg}`              : null,
          asError.code                   ? `code: ${asError.code}`                      : null,
          asError.error_subcode          ? `error_subcode: ${asError.error_subcode}`    : null,
          asError.fbtrace_id             ? `fbtrace_id: ${asError.fbtrace_id}`          : null,
          `message: ${String(asError.message ?? textContent.slice(0, 300))}`,
          rawDump                        ? `RAW_RESPONSE: ${rawDump}`                   : null,
        ].filter(Boolean).join(" | ");

        throw new Error(`فشل إنشاء المجموعة الإعلانية — ${detail}`);
      }

      // ── Strict ID check: adset_id MUST differ from campaign_id ──────────────
      // If Pipeboard returns the same id as the campaign, it returned the parent
      // instead of the newly created adset — that is a structural failure.
      if (asAdsetId === String(args?.campaign_id ?? "")) {
        const rawDumpForId = parsedJson
          ? JSON.stringify(parsedJson, null, 2)
          : textContent.slice(0, 600);
        throw new Error(
          `Logic Error: AdSet ID (${asAdsetId}) cannot be the same as Campaign ID — ` +
          `Pipeboard returned the parent campaign ID instead of a new adset ID. ` +
          `الـ id المُعاد هو نفس الـ campaign_id — لم يُنشأ AdSet فعلياً. ` +
          `RAW_RESPONSE: ${rawDumpForId}`
        );
      }

      // ── Hard verify: adset MUST appear in /{campaign_id}/adsets ─────────────
      // Success = adset found by name in campaign's adset list.
      // Failure = not found → throw (caught below → 500).
      const token = process.env.META_ACCESS_TOKEN;
      if (!token) throw new Error("META_ACCESS_TOKEN غير موجود — لا يمكن التحقق من إنشاء المجموعة");

      const expectedCampaignId = String(args?.campaign_id ?? "");
      const expectedName       = String(args?.name ?? "");

      // Step 1: GET /{candidateId}?fields=id,name,campaign_id
      // Confirm the id Pipeboard returned is actually an adset (not a campaign).
      logger.info({ asAdsetId, expectedCampaignId }, "create_adset: step1 — GET /{id}?fields=id,name,campaign_id");
      const step1Url = new URL(`https://graph.facebook.com/v21.0/${asAdsetId}`);
      step1Url.searchParams.set("fields", "id,name,campaign_id,status,effective_status,daily_budget,created_time,updated_time");
      step1Url.searchParams.set("access_token", token);
      const step1Resp = await fetch(step1Url.toString(), { signal: AbortSignal.timeout(12_000) });
      const step1Json = await step1Resp.json() as Record<string, unknown>;

      if (step1Json.error) {
        // Step1 GET returned a Meta error → the id from Pipeboard is wrong/nonexistent.
        // Throw immediately — a bad id cannot proceed to step2.
        const ve = typeof step1Json.error === "object" && step1Json.error !== null
          ? step1Json.error as Record<string, unknown> : {};
        const veMsg = String(ve.message ?? JSON.stringify(step1Json.error));
        const veCode = ve.code != null ? ` (code: ${ve.code})` : "";
        throw new Error(
          `التحقق المباشر من الـ id فشل — Meta رفضت GET /${asAdsetId}${veCode}: ${veMsg}. ` +
          `الـ id المُعاد من Pipeboard غير صالح — AdSet لم يُنشأ فعلياً.`
        );
      } else {
        const step1CampaignId = String(step1Json.campaign_id ?? "");
        if (step1CampaignId && step1CampaignId !== expectedCampaignId) {
          // The id Pipeboard returned belongs to a DIFFERENT campaign — hard failure.
          throw new Error(
            `Integrity Error: الـ id المُعاد (${asAdsetId}) ينتمي لحملة ${step1CampaignId} ` +
            `وليس للحملة المطلوبة ${expectedCampaignId}. Pipeboard أعاد id خاطئ — AdSet لم يُنشأ في الحملة الصحيحة.`
          );
        }
        logger.info({ asAdsetId, step1CampaignId }, "create_adset: step1 OK — id is a valid adset in correct campaign");
      }

      // Step 2: GET /{campaign_id}/adsets?fields=id,name,... — authoritative check
      // Find by name → get the REAL adset_id. Fail hard if not found.
      logger.info({ expectedCampaignId, expectedName }, "create_adset: step2 — GET /{campaign_id}/adsets");
      const step2Url = new URL(`https://graph.facebook.com/v21.0/${expectedCampaignId}/adsets`);
      step2Url.searchParams.set("fields", "id,name,status,effective_status,daily_budget,created_time,updated_time");
      step2Url.searchParams.set("limit", "200");
      step2Url.searchParams.set("access_token", token);
      const step2Resp = await fetch(step2Url.toString(), { signal: AbortSignal.timeout(15_000) });
      const step2Json = await step2Resp.json() as { data?: Array<Record<string, unknown>>; error?: unknown };

      if (step2Json.error) {
        const ve = typeof step2Json.error === "object" && step2Json.error !== null
          ? step2Json.error as Record<string, unknown> : {};
        throw new Error(`التحقق من قائمة المجموعات فشل — ${String(ve.message ?? JSON.stringify(ve))}`);
      }

      const allAdsets = step2Json.data ?? [];
      logger.info({ count: allAdsets.length, expectedName }, "create_adset: step2 adsets returned");

      // Match by exact name
      const matched = allAdsets.find(a => String(a.name ?? "") === expectedName);
      if (!matched) {
        const names = allAdsets.map(a => String(a.name ?? "")).slice(0, 10);
        throw new Error(
          `لم يظهر الـ adset "${expectedName}" في قائمة الحملة ${expectedCampaignId} — فشل التحقق. ` +
          `الأسماء الموجودة (أول 10): ${JSON.stringify(names)}`
        );
      }

      // Use confirmed data from Meta
      const confirmedId  = String(matched.id ?? asAdsetId);
      const rawBudget    = matched.daily_budget != null ? Number(matched.daily_budget) / 100 : null;
      asAdsetId = confirmedId;
      asData = {
        adset_id:          confirmedId,
        name:              String(matched.name ?? expectedName),
        campaign_id:       expectedCampaignId,
        account_id:        rawAccId,
        optimization_goal: String(args?.optimization_goal ?? ""),
        billing_event:     String(args?.billing_event ?? ""),
        daily_budget:      rawBudget ?? (args?.daily_budget != null ? Number(args.daily_budget) : undefined),
        status:            matched.status           != null ? String(matched.status)           : String(args?.status ?? "PAUSED"),
        effective_status:  matched.effective_status != null ? String(matched.effective_status) : String(args?.status ?? "PAUSED"),
        created_time:      matched.created_time     != null ? String(matched.created_time)     : undefined,
        updated_time:      matched.updated_time     != null ? String(matched.updated_time)     : undefined,
      };
      asVerifyOk = true;
      logger.info({ confirmedId, expectedName }, "create_adset: step2 matched — adset confirmed");

      asSuccess = true;
      asMsg = [
        `تم إنشاء المجموعة الإعلانية "${String(asData.name ?? args?.name ?? "")}"`,
        `adset_id: ${asAdsetId}`,
        `campaign_id: ${String(asData.campaign_id ?? args?.campaign_id ?? "?")}`,
        asData.effective_status ? `الحالة: ${String(asData.effective_status)}` : null,
        asData.daily_budget    ? `الميزانية: ${Number(asData.daily_budget).toFixed(0)} EGP/يوم` : null,
        asVerifyOk ? "✅ مُتحقَّق من Meta" : "⚠️ تم الإنشاء (verify لم يكتمل — الـ id مؤكد من Pipeboard)",
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
      res.json({
        success: true,
        message: asMsg,
        account_id: rawAccId,
        ...asData,
        verified: asVerifyOk,
        verify_attempted: true,
        ...(asVerifyError ? { verify_error: asVerifyError } : {}),
      });
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

    // Extract IDs from result for frontend state updates
    const extractedId = textContent?.match(/"id"\s*:\s*"(\d{10,})"/)?.[1] ?? "";
    const extraData: Record<string, string> = {};
    if (tool === "create_adset" && extractedId) extraData.adset_id = extractedId;
    if (tool === "create_campaign" && extractedId) extraData.campaign_id = extractedId;
    res.json({ success: true, message: resultMessage, ...extraData });
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


// ── GET /pipeboard/campaigns — جلب الحملات مع ABO/CBO flag ─────────────────
router.get("/pipeboard/campaigns", async (req: Request, res: Response) => {
  try {
    const client = await getPipeboardWriteClient();
    const accountId = String(req.query.account_id ?? "").replace(/^act_/, "");
    if (!accountId) return res.status(400).json({ error: "account_id مطلوب" });

    const result = await client.callTool({
      name: "get_campaigns",
      arguments: {
        account_id: accountId,
        fields: "id,name,status,effective_status,daily_budget,campaign_budget_optimization,objective",
        limit: 100,
      },
    });

    const text = ((result as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("")
      .trim();

    let campaigns: unknown[] = [];
    try {
      const parsed = JSON.parse(text);
      campaigns = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
    } catch {
      const matches = [...text.matchAll(/"id"\s*:\s*"(\d+)"[^}]*"name"\s*:\s*"([^"]+)"/g)];
      campaigns = matches.map(m => ({ id: m[1], name: m[2] }));
    }

    res.json({ campaigns });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /pipeboard/campaigns/:id/adsets — جلب AdSets مع أرقام الأداء ────────
router.get("/pipeboard/campaigns/:id/adsets", async (req: Request, res: Response) => {
  try {
    const client = await getPipeboardWriteClient();
    const accountId = String(req.query.account_id ?? "").replace(/^act_/, "");
    const campaignId = String(req.params.id ?? "");
    if (!accountId || !campaignId) return res.status(400).json({ error: "account_id و campaign_id مطلوبان" });

    // جلب الـ AdSets
    const adsetsResult = await client.callTool({
      name: "get_adsets",
      arguments: {
        account_id: accountId,
        campaign_id: campaignId,
        fields: "id,name,status,effective_status,daily_budget,campaign_budget_optimization",
        limit: 50,
      },
    });

    const adsetsText = ((adsetsResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("")
      .trim();

    let adsets: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(adsetsText);
      adsets = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
    } catch { adsets = []; }

    // جلب الـ insights لكل AdSet
    const insightsResult = await client.callTool({
      name: "get_insights",
      arguments: {
        account_id: accountId,
        campaign_id: campaignId,
        level: "adset",
        fields: "adset_id,adset_name,spend,cpa,ctr,hook_rate,impressions,actions",
        date_preset: "last_7d",
        limit: 50,
      },
    });

    const insightsText = ((insightsResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("")
      .trim();

    let insights: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(insightsText);
      insights = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
    } catch { insights = []; }

    // دمج الـ insights مع الـ AdSets
    const insightsMap = new Map(insights.map(i => [String(i.adset_id), i]));
    const enriched = adsets.map(a => ({
      ...a,
      insights: insightsMap.get(String(a.id)) ?? null,
    }));

    // هل الحملة CBO أم ABO؟
    const campaignResult = await client.callTool({
      name: "get_campaigns",
      arguments: { account_id: accountId, campaign_id: campaignId, fields: "id,campaign_budget_optimization" },
    });
    const campaignText = ((campaignResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("")
      .trim();
    const isCBO = campaignText.includes('"campaign_budget_optimization": true') ||
                  campaignText.includes('"campaign_budget_optimization":true');

    res.json({ adsets: enriched, is_cbo: isCBO });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /pipeboard/best-combo — إنشاء Best Combination Creative ────────────
router.post("/pipeboard/best-combo", async (req: Request, res: Response) => {
  try {
    const client = await getPipeboardWriteClient();
    const {
      account_id: rawAccountId,
      target_campaign_id,
      adset_name,
      daily_budget,
      pixel_id,
      landing_page_url,
      video_id,
      texts,
      headlines,
      call_to_action = "LEARN_MORE",
      is_cbo = false,
    } = req.body as {
      account_id: string;
      target_campaign_id: string;
      adset_name: string;
      daily_budget?: number;
      pixel_id?: string;
      landing_page_url: string;
      video_id: string;
      texts: string[];
      headlines: string[];
      call_to_action?: string;
      is_cbo?: boolean;
    };

    if (!rawAccountId || !target_campaign_id || !adset_name || !video_id || !landing_page_url) {
      return res.status(400).json({ error: "account_id, target_campaign_id, adset_name, video_id, landing_page_url مطلوبة" });
    }

    const accountId = rawAccountId.replace(/^act_/, "");
    const accountIdWithAct = `act_${accountId}`;
    const hasPixel = Boolean(pixel_id);

    // Step 1: جلب الـ page_id
    let pageId = "";
    try {
      const pagesResult = await client.callTool({ name: "get_account_pages", arguments: { account_id: accountId } });
      const pagesText = ((pagesResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("").trim();
      const pageMatch = pagesText.match(/"id"\s*:\s*"(\d+)"/) ?? pagesText.match(/(\d{10,})/);
      pageId = pageMatch?.[1] ?? "";
    } catch { /* ignore */ }

    // Step 2: إنشاء الـ AdSet
    const adsetArgs: Record<string, unknown> = {
      account_id: accountId,
      campaign_id: target_campaign_id,
      name: adset_name,
      optimization_goal: hasPixel ? "OFFSITE_CONVERSIONS" : "LINK_CLICKS",
      billing_event: "IMPRESSIONS",
      status: "PAUSED",
      targeting: { geo_locations: { countries: ["EG"] } },
      targeting_automation: { advantage_audience: 1 },
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    };
    if (!is_cbo && daily_budget) adsetArgs.daily_budget = Math.round(daily_budget * 100);
    if (hasPixel) adsetArgs.promoted_object = { pixel_id, custom_event_type: "PURCHASE" };

    const adsetResult = await client.callTool({ name: "create_adset", arguments: adsetArgs });
    const adsetText = ((adsetResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("").trim();
    const adsetIdMatch = adsetText.match(/"id"\s*:\s*"(\d+)"/) ?? adsetText.match(/(\d{10,})/);
    const adsetId = adsetIdMatch?.[1] ?? "";
    if (!adsetId) return res.status(500).json({ error: `فشل إنشاء AdSet — ${adsetText.slice(0, 200)}` });

    // Step 3: إنشاء الـ creative بـ video + messages[] + headlines[]
    const creativeArgs: Record<string, unknown> = {
      account_id: accountIdWithAct,
      name: `${adset_name} — Best Combo`,
      page_id: pageId,
      video_id,
      link_url: landing_page_url,
      destination_url: landing_page_url,
      messages: texts.filter(Boolean),
      headlines: headlines.filter(Boolean),
      call_to_action_type: call_to_action,
    };
    if (pixel_id) creativeArgs.pixel_id = pixel_id;

    const creativeResult = await client.callTool({ name: "create_ad_creative", arguments: creativeArgs });
    const creativeText = ((creativeResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("").trim();
    const creativeIdMatch = creativeText.match(/"id"\s*:\s*"(\d+)"/) ?? creativeText.match(/(\d{10,})/);
    const creativeId = creativeIdMatch?.[1] ?? "";
    if (!creativeId) return res.status(500).json({ error: `فشل إنشاء Creative — ${creativeText.slice(0, 200)}` });

    // Step 4: إنشاء الـ Ad
    const adResult = await client.callTool({
      name: "create_ad",
      arguments: {
        account_id: accountIdWithAct,
        name: `${adset_name} — Best Combo Ad`,
        adset_id: adsetId,
        creative_id: creativeId,
        status: "PAUSED",
      },
    });
    const adText = ((adResult as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("").trim();
    const adIdMatch = adText.match(/"id"\s*:\s*"(\d+)"/) ?? adText.match(/(\d{10,})/);
    const adId = adIdMatch?.[1] ?? "";

    res.json({
      success: true,
      adset_id: adsetId,
      creative_id: creativeId,
      ad_id: adId,
      message: `✅ تم إنشاء AdSet "${adset_name}" بـ Best Combination Creative — ${texts.length} نص + ${headlines.length} عنوان`,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
