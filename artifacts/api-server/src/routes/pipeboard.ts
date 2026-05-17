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
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
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
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
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
  "ga_pause_campaign",
  "ga_enable_campaign",
  "ga_update_campaign_budget",
  "ga_update_keyword_bid",
  "ga_pause_keyword",
  "ga_enable_keyword",
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
      [],
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
      [NO_OP_SPIKE_URL],
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
    const userMsg = (err?.error_user_msg ??
      err?.error_user_title ??
      err?.message) as string | undefined;
    const code = err?.code ? `code: ${err.code}` : "";
    const subcode = err?.error_subcode ? `, subcode: ${err.error_subcode}` : "";
    const suffix = code ? ` (${code}${subcode})` : "";
    if (userMsg) return `${userMsg}${suffix}`;
  } catch {
    /* not JSON — fall through */
  }
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
  const codeMatch = raw.match(/"code"\s*:\s*(\d+)/);
  const subMatch = raw.match(/"error_subcode"\s*:\s*(\d+)/);
  const msgMatch =
    raw.match(/"message"\s*:\s*"([^"]+)"/) ??
    raw.match(/"error"\s*:\s*"([^"]+)"/);
  const titleMatch = raw.match(/"error_user_title"\s*:\s*"([^"]+)"/);
  const userMsgMatch = raw.match(/"error_user_msg"\s*:\s*"([^"]+)"/);
  const traceMatch = raw.match(/"fbtrace_id"\s*:\s*"([^"]+)"/);
  return {
    code: codeMatch?.[1] ? Number(codeMatch[1]) : undefined,
    message: msgMatch?.[1] ?? raw.slice(0, 400),
    error_subcode: subMatch?.[1] ? Number(subMatch[1]) : undefined,
    error_user_title: titleMatch?.[1] ?? undefined,
    error_user_msg: userMsgMatch?.[1] ?? undefined,
    fbtrace_id: traceMatch?.[1] ?? undefined,
  };
}

interface VerifyResult {
  verified: boolean;
  verified_fields?: Record<string, unknown>;
  meta_error?: MetaErrorDetails;
}

async function verifyMetaEntityDirect(
  id: string,
  fields: string,
  token: string,
): Promise<VerifyResult> {
  if (!token)
    return {
      verified: false,
      meta_error: { message: "META_ACCESS_TOKEN missing" },
    };
  try {
    const url = new URL(`https://graph.facebook.com/v21.0/${id}`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("access_token", token);
    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await resp.json()) as Record<string, unknown>;
    if (json.error) {
      const ve =
        typeof json.error === "object" && json.error !== null
          ? (json.error as Record<string, unknown>)
          : {};
      return {
        verified: false,
        meta_error: {
          code: ve.code != null ? Number(ve.code) : undefined,
          message: String(ve.message ?? `Meta returned error for ${id}`),
          error_subcode:
            ve.error_subcode != null ? Number(ve.error_subcode) : undefined,
          fbtrace_id: ve.fbtrace_id != null ? String(ve.fbtrace_id) : undefined,
        },
      };
    }
    return { verified: true, verified_fields: json };
  } catch (err) {
    return {
      verified: false,
      meta_error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ── POST /api/pipeboard/action ─────────────────────────────────
router.post("/pipeboard/action", async (req: Request, res: Response) => {
  const role = req.session?.role;
  if (role !== "admin" && role !== "media_buyer") {
    res
      .status(403)
      .json({ error: "غير مصرح — هذه الميزة للأدمن والميدياباير فقط" });
    return;
  }

  const {
    tool,
    args,
    isNoOp: isNoOpRaw,
  } = req.body as {
    tool: string;
    args: Record<string, unknown>;
    isNoOp?: unknown;
  };
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
    "upload_video_to_meta",
    "duplicate_ad",
    "create_ad_from_post",
    "create_ad_from_existing_post",
    "publish_winners_to_destination",
    "create_ad_from_creative_spec",
    // Read/search tools
    "search_adsets",
    "search_ads",
    "get_adsets",
    "get_ads",
    "get_ad_details",
    "get_campaign_details",
    "get_ad_creative",
    "get_ads_in_adset",
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
    res
      .status(500)
      .json({ error: "PIPEBOARD_API_TOKEN غير مضبوط على السيرفر" });
    return;
  }

  const executedBy = req.session?.username ?? "admin";

  // ── Translate our internal tool names → actual Pipeboard MCP tool names ──
  // Our AI uses friendly names; Pipeboard uses update_campaign / update_adset.
  // Budgets from the AI are in EGP (already divided by 100 by getCampaignDetails).
  // Pipeboard / Meta API expects cents → multiply by 100.
  function sanitizeName(name: string): string {
    return name
      .replace(/[\u200f\u200e\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/[|`\\/"<>]/g, "-")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Strip commas (and any non-digit chars) from Meta / Google entity IDs.
  // The AI may format large IDs with thousand-separators (e.g. "120,233,750,727,240,519")
  // which makes Meta reject the request with "not a valid campaign id".
  function sanitizeId(v: unknown): string {
    return String(v ?? "").replace(/,/g, "").trim();
  }

  function translateToMcp(
    t: string,
    a: Record<string, unknown>,
  ): { mcpTool: string; mcpArgs: Record<string, unknown> } {
    const egpToCents = (v: unknown) => Math.round(Number(v) * 100);
    switch (t) {
      case "pause_campaign":
        return {
          mcpTool: "update_campaign",
          mcpArgs: { campaign_id: sanitizeId(a.campaign_id), status: "PAUSED" },
        };
      case "enable_campaign":
        return {
          mcpTool: "update_campaign",
          mcpArgs: { campaign_id: sanitizeId(a.campaign_id), status: "ACTIVE" },
        };
      case "update_campaign_budget": {
        const field =
          a.budget_type === "lifetime" ? "lifetime_budget" : "daily_budget";
        return {
          mcpTool: "update_campaign",
          mcpArgs: {
            campaign_id: sanitizeId(a.campaign_id),
            [field]: egpToCents(a.budget_amount),
          },
        };
      }
      case "pause_adset":
        return {
          mcpTool: "update_adset",
          mcpArgs: { adset_id: sanitizeId(a.adset_id), status: "PAUSED" },
        };
      case "enable_adset":
        return {
          mcpTool: "update_adset",
          mcpArgs: { adset_id: sanitizeId(a.adset_id), status: "ACTIVE" },
        };
      case "update_adset_budget":
        return {
          mcpTool: "update_adset",
          mcpArgs: {
            adset_id: sanitizeId(a.adset_id),
            daily_budget: egpToCents(a.budget_amount),
          },
        };
      case "pause_ad":
        return {
          mcpTool: "update_ad",
          mcpArgs: { ad_id: sanitizeId(a.ad_id), status: "PAUSED" },
        };
      case "enable_ad":
        return {
          mcpTool: "update_ad",
          mcpArgs: { ad_id: sanitizeId(a.ad_id), status: "ACTIVE" },
        };
      case "rename_campaign":
        return {
          mcpTool: "update_campaign",
          mcpArgs: { campaign_id: sanitizeId(a.campaign_id), name: sanitizeName(String(a.new_name ?? "")) },
        };
      case "rename_adset":
        return {
          mcpTool: "update_adset",
          mcpArgs: { adset_id: sanitizeId(a.adset_id), name: sanitizeName(String(a.new_name ?? "")) },
        };
      case "rename_ad":
        return {
          mcpTool: "update_ad",
          mcpArgs: { ad_id: sanitizeId(a.ad_id), name: sanitizeName(String(a.new_name ?? "")) },
        };
      case "create_campaign": {
        // Normalise account_id: Pipeboard expects the bare numeric ID (no act_ prefix)
        const rawAccId = String(a.account_id ?? "").replace(/,/g, "");
        const normAccId = rawAccId.startsWith("act_")
          ? rawAccId.slice(4)
          : rawAccId;
        // special_ad_categories: AI may send a string "NONE" or empty string → normalise to array
        const rawSac = a.special_ad_categories;
        const sacArr = Array.isArray(rawSac)
          ? rawSac
          : typeof rawSac === "string" && rawSac && rawSac !== "NONE"
            ? [rawSac]
            : [];
        return {
          mcpTool: "create_campaign",
          mcpArgs: {
            account_id: normAccId,
            name: a.name,
            objective: a.objective,
            status: a.status ?? "PAUSED",
            special_ad_categories: sacArr,
            ...(a.daily_budget != null
              ? { daily_budget: egpToCents(a.daily_budget) }
              : {}),
          },
        };
      }
      case "create_adset": {
        const rawAccId2 = String(a.account_id ?? "").replace(/,/g, "");
        const normAccId2 = rawAccId2.startsWith("act_")
          ? rawAccId2.slice(4)
          : rawAccId2;
        const {
          account_id: _drop,
          daily_budget: _db,
          ...restAdset
        } = a as Record<string, unknown>;
        void _drop;
        void _db;
        // Sanitize campaign_id — AI may pass it with commas as thousand separators
        const sanitizedRestAdset = {
          ...restAdset,
          ...(restAdset.campaign_id != null
            ? { campaign_id: sanitizeId(restAdset.campaign_id) }
            : {}),
        };
        return {
          mcpTool: "create_adset",
          mcpArgs: {
            ...sanitizedRestAdset,
            account_id: normAccId2,
            ...(a.daily_budget != null
              ? { daily_budget: egpToCents(a.daily_budget) }
              : {}),
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
  function translateToGoogleAdsMcp(
    t: string,
    a: Record<string, unknown>,
  ): { mcpTool: string; mcpArgs: Record<string, unknown> } {
    const egpToMicros = (v: unknown) => Math.round(Number(v) * 1_000_000);
    switch (t) {
      case "ga_pause_campaign":
        return {
          mcpTool: "pause_google_ads_campaign",
          mcpArgs: { customer_id: sanitizeId(a.customer_id), campaign_id: sanitizeId(a.campaign_id) },
        };
      case "ga_enable_campaign":
        return {
          mcpTool: "enable_google_ads_campaign",
          mcpArgs: { customer_id: sanitizeId(a.customer_id), campaign_id: sanitizeId(a.campaign_id) },
        };
      case "ga_update_campaign_budget":
        // Correct param is budget_amount_micros (not daily_budget_micros)
        return {
          mcpTool: "update_google_ads_campaign",
          mcpArgs: {
            customer_id: sanitizeId(a.customer_id),
            campaign_id: sanitizeId(a.campaign_id),
            budget_amount_micros: egpToMicros(a.budget_amount),
          },
        };
      case "ga_update_keyword_bid": {
        // API accepts either criterion_id (singular) + cpc_bid_micros for one keyword,
        // or keyword_bids array for batch. AI sends criterion_ids (array) + cpc_bid_egp.
        const bidMicros = egpToMicros(a.cpc_bid_egp);
        const ids = Array.isArray(a.criterion_ids)
          ? (a.criterion_ids as string[])
          : [String(a.criterion_ids ?? "")];
        if (ids.length === 1) {
          return {
            mcpTool: "update_google_ads_keyword_bid",
            mcpArgs: {
              customer_id: a.customer_id,
              ad_group_id: a.ad_group_id,
              criterion_id: ids[0],
              cpc_bid_micros: bidMicros,
            },
          };
        }
        return {
          mcpTool: "update_google_ads_keyword_bid",
          mcpArgs: {
            customer_id: a.customer_id,
            ad_group_id: a.ad_group_id,
            keyword_bids: ids.map((id) => ({
              criterion_id: id,
              cpc_bid_micros: bidMicros,
            })),
          },
        };
      }
      case "ga_pause_keyword":
        return {
          mcpTool: "pause_google_ads_keyword",
          mcpArgs: {
            customer_id: a.customer_id,
            ad_group_id: a.ad_group_id,
            criterion_ids: a.criterion_ids,
          },
        };
      case "ga_enable_keyword":
        return {
          mcpTool: "enable_google_ads_keyword",
          mcpArgs: {
            customer_id: a.customer_id,
            ad_group_id: a.ad_group_id,
            criterion_ids: a.criterion_ids,
          },
        };
      default:
        return { mcpTool: t, mcpArgs: a };
    }
  }

  // ── Special: duplicate_ad — via Pipeboard MCP (no direct Meta API needed) ────
  if (tool === "duplicate_ad") {
    const adId = String(args?.ad_id ?? "");
    const destAdsetId = String(args?.destination_adset_id ?? "");
    const adLabel = String(args?.name ?? adId);
    if (!adId) {
      res.status(400).json({ error: "ad_id مطلوب" });
      return;
    }
    if (!destAdsetId) {
      res.status(400).json({ error: "destination_adset_id مطلوب" });
      return;
    }

    // META_ACCESS_TOKEN used only for GET fallbacks in reconstruction — not required for primary path.
    const metaToken = "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg";

    let dupSuccess = false;
    let dupMsg = "";
    let dupNewAdId = "";
    let dupVerify: VerifyResult = { verified: false };
    let dupMetaError: MetaErrorDetails | null = null;

    try {
      // Primary: Pipeboard MCP duplicate_ad (uses Pipeboard's own Meta token)
      const dupPbClient = await getPipeboardWriteClient();
      logger.info({ adId, destAdsetId }, "duplicate_ad: → Pipeboard duplicate_ad");
      const dupPbResult = await dupPbClient.callTool(
        {
          name: "duplicate_ad",
          arguments: {
            ad_id: adId,
            adset_id: destAdsetId,
            name: adLabel,
            status: "PAUSED",
          },
        },
        undefined,
        { timeout: 30_000 },
      );
      const dupPbText = (
        (dupPbResult as { content?: Array<{ type: string; text?: string }> })
          ?.content ?? []
      ).filter(c => c.type === "text").map(c => (c as { text?: string }).text ?? "").join("").trim();
      logger.info({ dupPbText: dupPbText.slice(0, 400) }, "duplicate_ad: ← Pipeboard duplicate_ad");

      // Extract new ad id from Pipeboard response
      const dupIdMatch =
        dupPbText.match(/"(?:id|new_ad_id|copied_ad_id)"\s*:\s*"(\d+)"/) ??
        dupPbText.match(/\b(\d{10,})\b/);
      dupNewAdId = dupIdMatch?.[1] ?? "";

      if (!dupNewAdId) {
        dupMetaError = { message: `Pipeboard لم يُعد ad_id: ${dupPbText.slice(0, 200)}` };
        throw new Error(`duplicate_ad: Pipeboard لم يُعد ad_id — ${dupPbText.slice(0, 200)}`);
      }

      // Non-fatal verify (GET only — token may have limited access)
      if (metaToken) {
        dupVerify = await verifyMetaEntityDirect(
          dupNewAdId,
          "id,name,status,effective_status,adset_id,campaign_id,created_time,updated_time,creative{id,object_story_id}",
          metaToken,
        );
        if (!dupVerify.verified) {
          logger.warn({ dupNewAdId }, "duplicate_ad: verify failed — ad may still exist");
        }
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
        (dupMetaError?.code != null &&
          [100, 2446079].includes(dupMetaError.code));

      if (isLegacyBlocker) {
        logger.info(
          {
            code: dupMetaError?.code,
            subcode: dupMetaError?.error_subcode,
            adId,
            destAdsetId,
          },
          "duplicate_ad: Legacy blocker detected — attempting Creative Reconstruction",
        );
        try {
          // Step 1: Fetch source ad to get account_id + object_story_id
          const srcUrl = new URL(`https://graph.facebook.com/v21.0/${adId}`);
          srcUrl.searchParams.set(
            "fields",
            "id,account_id,creative{id,object_story_id,effective_object_story_id,name,video_id,image_hash,body,title,link_url,call_to_action}",
          );
          srcUrl.searchParams.set("access_token", metaToken);
          const srcResp = await fetch(srcUrl.toString(), {
            signal: AbortSignal.timeout(10_000),
          });
          const srcJson = (await srcResp.json()) as Record<string, unknown>;
          logger.info(
            { srcJson: JSON.stringify(srcJson).slice(0, 500) },
            "duplicate_ad: reconstruction source ad fetch",
          );

          const rawAccountId = String(srcJson.account_id ?? "").replace(
            /^act_/,
            "",
          );
          const accountIdWithAct = rawAccountId ? `act_${rawAccountId}` : "";
          const creative = srcJson.creative as
            | Record<string, unknown>
            | undefined;
          const objectStoryId = String(
            creative?.effective_object_story_id ??
              creative?.object_story_id ??
              "",
          ).trim();

          if (!objectStoryId || !rawAccountId) {
            throw new Error(
              `Creative Reconstruction: بيانات ناقصة — account_id=${rawAccountId}, object_story_id=${objectStoryId}`,
            );
          }

          // Extract page_id from object_story_id (format: "page_id_post_id")
          const pageId = objectStoryId.split("_")[0] ?? "";

          logger.info(
            { objectStoryId, pageId, rawAccountId },
            "duplicate_ad: reconstruction assets extracted",
          );

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

          const creativeResult = await rcClient.callTool({
            name: "create_ad_creative",
            arguments: creativeArgs,
          });
          const creativeText = (
            (
              creativeResult as {
                content?: Array<{ type: string; text?: string }>;
              }
            )?.content ?? []
          )
            .filter((c: { type: string }) => c.type === "text")
            .map((c: { text?: string }) => c.text ?? "")
            .join("")
            .trim();
          logger.info(
            { creativeText: creativeText.slice(0, 400) },
            "duplicate_ad: reconstruction create_ad_creative",
          );

          const creativeIdMatch = creativeText.match(/"id"\s*:\s*"(\d{10,})"/);
          const rcCreativeId = creativeIdMatch?.[1] ?? "";
          if (!rcCreativeId) {
            throw new Error(
              `Reconstruction: فشل إنشاء creative — ${creativeText.slice(0, 200)}`,
            );
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
          const rcAdText = (
            (rcAdResult as { content?: Array<{ type: string; text?: string }> })
              ?.content ?? []
          )
            .filter((c: { type: string }) => c.type === "text")
            .map((c: { text?: string }) => c.text ?? "")
            .join("")
            .trim();
          logger.info(
            { rcAdText: rcAdText.slice(0, 400) },
            "duplicate_ad: reconstruction create_ad",
          );

          const rcAdMatch =
            rcAdText.match(/"id"\s*:\s*"(\d+)"/) ??
            rcAdText.match(/\b(\d{10,})\b/);
          const rcNewAdId = rcAdMatch?.[1] ?? "";
          if (!rcNewAdId) {
            throw new Error(
              `Reconstruction: فشل create_ad — ${rcAdText.slice(0, 200)}`,
            );
          }

          // Step 4: Verify
          const rcVerify = await verifyMetaEntityDirect(
            rcNewAdId,
            "id,name,status,effective_status,adset_id,campaign_id",
            metaToken,
          );
          if (!rcVerify.verified) {
            throw new Error(`Reconstruction: verify فشل للإعلان ${rcNewAdId}`);
          }

          dupSuccess = true;
          dupNewAdId = rcNewAdId;
          dupVerify = rcVerify;
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

          logger.info(
            { rcNewAdId, objectStoryId, rcCreativeId },
            "duplicate_ad: Creative Reconstruction succeeded",
          );
        } catch (rcErr) {
          const rcErrMsg =
            rcErr instanceof Error ? rcErr.message : String(rcErr);
          logger.warn(
            { rcErrMsg, adId, destAdsetId },
            "duplicate_ad: Creative Reconstruction (tier-2) failed — trying Tier-3 spec rebuild",
          );

          // ── TIER-3 FALLBACK: Creative Spec Rebuild ────────────────────────────
          // Tier-2 (object_story_id path) failed. Last resort: fetch raw creative
          // assets (video_id / image_hash, primary_text, headline, link) and build
          // a fresh ad using object_story_spec — no social proof preserved but the
          // ad is structurally identical and will run.
          try {
            const t3Url = new URL(`https://graph.facebook.com/v21.0/${adId}`);
            t3Url.searchParams.set(
              "fields",
              "id,account_id,creative{id,name,object_story_spec,body,title,link_url,image_url,video_id}",
            );
            t3Url.searchParams.set("access_token", metaToken);
            const t3Resp = await fetch(t3Url.toString(), {
              signal: AbortSignal.timeout(12_000),
            });
            const t3Json = (await t3Resp.json()) as Record<string, unknown>;
            logger.info(
              { t3Json: JSON.stringify(t3Json).slice(0, 800) },
              "duplicate_ad: tier-3 creative fetch",
            );

            const t3AccId = String(t3Json.account_id ?? "").replace(
              /^act_/,
              "",
            );
            const t3AccWithAct = t3AccId ? `act_${t3AccId}` : "";
            const t3Creative = t3Json.creative as
              | Record<string, unknown>
              | undefined;
            const t3Spec = t3Creative?.object_story_spec as
              | Record<string, unknown>
              | undefined;

            // Extract page_id from spec
            const t3PageId = String(t3Spec?.page_id ?? "").trim();

            // Extract video or image + text from spec
            const t3VideoData = t3Spec?.video_data as
              | Record<string, unknown>
              | undefined;
            const t3LinkData = t3Spec?.link_data as
              | Record<string, unknown>
              | undefined;
            const t3VideoId = String(
              t3VideoData?.video_id ?? t3Creative?.video_id ?? "",
            ).trim();
            const t3ImageHash = String(t3LinkData?.image_hash ?? "").trim();
            const t3Message = String(
              t3VideoData?.message ??
                t3LinkData?.message ??
                t3Creative?.body ??
                "",
            ).trim();
            const t3Title = String(
              t3VideoData?.link_description ??
                t3LinkData?.description ??
                t3Creative?.title ??
                "",
            ).trim();
            const t3Cta =
              (
                t3VideoData?.call_to_action as
                  | Record<string, unknown>
                  | undefined
              )?.type ??
              (
                t3LinkData?.call_to_action as
                  | Record<string, unknown>
                  | undefined
              )?.type ??
              "SHOP_NOW";
            const t3Link = String(
              (
                (
                  t3VideoData?.call_to_action as
                    | Record<string, unknown>
                    | undefined
                )?.value as Record<string, unknown> | undefined
              )?.link ??
                (
                  (
                    t3LinkData?.call_to_action as
                      | Record<string, unknown>
                      | undefined
                  )?.value as Record<string, unknown> | undefined
                )?.link ??
                t3Creative?.link_url ??
                "",
            ).trim();

            if (!t3AccId || !t3PageId || (!t3VideoId && !t3ImageHash)) {
              throw new Error(
                `Tier-3: بيانات غير كافية — account_id=${t3AccId}, page_id=${t3PageId}, ` +
                  `video_id=${t3VideoId}, image_hash=${t3ImageHash}`,
              );
            }

            // Build object_story_spec for the new creative
            const t3StorySpec: Record<string, unknown> = t3VideoId
              ? {
                  page_id: t3PageId,
                  video_data: {
                    video_id: t3VideoId,
                    ...(t3Message ? { message: t3Message } : {}),
                    ...(t3Title ? { link_description: t3Title } : {}),
                    ...(t3Link
                      ? {
                          call_to_action: {
                            type: t3Cta,
                            value: { link: t3Link },
                          },
                        }
                      : {}),
                  },
                }
              : {
                  page_id: t3PageId,
                  link_data: {
                    image_hash: t3ImageHash,
                    ...(t3Message ? { message: t3Message } : {}),
                    ...(t3Title ? { description: t3Title } : {}),
                    ...(t3Link
                      ? {
                          link: t3Link,
                          call_to_action: {
                            type: t3Cta,
                            value: { link: t3Link },
                          },
                        }
                      : {}),
                  },
                };

            const t3Client = await getPipeboardWriteClient();

            // Step A: create_ad_creative from spec
            const t3CreativeArgs: Record<string, unknown> = {
              account_id: t3AccId,
              name: `${adLabel} — tier3-spec`,
              object_story_spec: t3StorySpec,
              instagram_actor_id: t3PageId,
            };
            const t3CreativeResult = await t3Client.callTool({
              name: "create_ad_creative",
              arguments: t3CreativeArgs,
            });
            const t3CreativeText = (
              (
                t3CreativeResult as {
                  content?: Array<{ type: string; text?: string }>;
                }
              )?.content ?? []
            )
              .filter((c: { type: string }) => c.type === "text")
              .map((c: { text?: string }) => c.text ?? "")
              .join("")
              .trim();
            logger.info(
              { t3CreativeText: t3CreativeText.slice(0, 400) },
              "duplicate_ad: tier-3 create_ad_creative",
            );

            const t3CreativeIdMatch = t3CreativeText.match(
              /"id"\s*:\s*"(\d{10,})"/,
            );
            const t3CreativeId = t3CreativeIdMatch?.[1] ?? "";
            if (!t3CreativeId)
              throw new Error(
                `Tier-3: فشل create_ad_creative — ${t3CreativeText.slice(0, 200)}`,
              );

            // Step B: create_ad with the spec creative
            const t3AdResult = await t3Client.callTool({
              name: "create_ad",
              arguments: {
                account_id: t3AccWithAct,
                name: adLabel,
                adset_id: destAdsetId,
                creative_id: t3CreativeId,
                status: "PAUSED",
              },
            });
            const t3AdText = (
              (
                t3AdResult as {
                  content?: Array<{ type: string; text?: string }>;
                }
              )?.content ?? []
            )
              .filter((c: { type: string }) => c.type === "text")
              .map((c: { text?: string }) => c.text ?? "")
              .join("")
              .trim();
            logger.info(
              { t3AdText: t3AdText.slice(0, 400) },
              "duplicate_ad: tier-3 create_ad",
            );

            const t3AdMatch =
              t3AdText.match(/"id"\s*:\s*"(\d+)"/) ??
              t3AdText.match(/\b(\d{10,})\b/);
            const t3NewAdId = t3AdMatch?.[1] ?? "";
            if (!t3NewAdId)
              throw new Error(
                `Tier-3: فشل create_ad — ${t3AdText.slice(0, 200)}`,
              );

            // Step C: Verify
            const t3Verify = await verifyMetaEntityDirect(
              t3NewAdId,
              "id,name,status,effective_status",
              metaToken,
            );
            if (!t3Verify.verified)
              throw new Error(`Tier-3: verify فشل للإعلان ${t3NewAdId}`);

            dupSuccess = true;
            dupNewAdId = t3NewAdId;
            dupVerify = t3Verify;
            dupMsg = [
              `✅ Tier-3 Spec Rebuild نجح — تم إعادة بناء الإعلان "${adLabel}" من الأصول الخام (بدون Social Proof)`,
              `new_ad_id: ${t3NewAdId}`,
              `creative_id: ${t3CreativeId}`,
              `destination_adset_id: ${destAdsetId}`,
              `الحالة: ${String(t3Verify.verified_fields?.effective_status ?? "PAUSED")}`,
              `ملاحظة: تم استخدام object_story_spec (video_id=${t3VideoId || "N/A"}) — اللايكات لم تُحفظ`,
            ].join(" — ");

            logger.info(
              { t3NewAdId, t3CreativeId, t3VideoId },
              "duplicate_ad: Tier-3 Spec Rebuild succeeded",
            );
          } catch (t3Err) {
            const t3ErrMsg =
              t3Err instanceof Error ? t3Err.message : String(t3Err);
            logger.warn(
              { t3ErrMsg, adId, destAdsetId },
              "duplicate_ad: Tier-3 Spec Rebuild also failed — all paths exhausted",
            );
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
      [
        executedBy,
        tool,
        JSON.stringify(args ?? {}),
        dupSuccess,
        dupMsg,
        adLabel,
        null,
        false,
      ],
    ).catch((e: unknown) =>
      logger.warn({ e }, "pipeboard audit insert failed"),
    );

    if (dupSuccess) {
      res.json({
        success: true,
        message: dupMsg,
        new_ad_id: dupNewAdId,
        source_ad_id: adId,
        destination_adset_id: destAdsetId,
        verified: true,
        verified_fields: dupVerify.verified_fields,
        reconstruction_used: dupMsg.includes("Creative Reconstruction"),
      });
    } else {
      res
        .status(500)
        .json({
          error: dupMsg,
          ...(dupMetaError ? { meta_error: dupMetaError } : {}),
        });
    }
    return;
  }

  // ── Special multi-step: create_ad_from_post ───────────────────────────────
  if (tool === "create_ad_from_post") {
    const rawAccountId = String(args?.account_id ?? "");
    const accountId = rawAccountId.startsWith("act_")
      ? rawAccountId.slice(4)
      : rawAccountId;
    const accountIdWithAct = rawAccountId.startsWith("act_")
      ? rawAccountId
      : `act_${rawAccountId}`;
    const adsetId = String(args?.adset_id ?? "");
    const postId = String(args?.post_id ?? "");
    const adName = String(args?.ad_name ?? args?.name ?? "إعلان من منشور");
    if (!adsetId || !postId) {
      res.status(400).json({ error: "adset_id و post_id مطلوبان" });
      return;
    }

    function mcpTextLocal(result: unknown): string {
      return (
        (result as { content?: Array<{ type: string; text?: string }> })
          ?.content ?? []
      )
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
          const pagesResult = await client.callTool({
            name: "get_account_pages",
            arguments: { account_id: accountId },
          });
          const pagesText = mcpTextLocal(pagesResult);
          const pageMatch =
            pagesText.match(/"id"\s*:\s*"(\d+)"/) ??
            pagesText.match(/\b(\d{10,})\b/);
          pageId = pageMatch?.[1] ?? "";
          if (!pageId)
            logger.warn(
              "create_ad_from_post: get_account_pages — no page_id found",
            );
        } catch (e) {
          logger.warn({ e }, "create_ad_from_post: get_account_pages threw");
        }
      }
      if (!pageId) {
        const lp = String(args?.landing_page_url ?? args?.link_url ?? "");
        if (lp.includes("buzzpick.net")) pageId = "878997831971062";
        else if (lp.includes("dealme-eg.com") || lp.includes("alsouqalhor.com") || lp.includes("dealoop.net")) pageId = "108193615487446";
        else pageId = "108193615487446";
        logger.warn({ pageId }, "create_ad_from_post: domain-mapped page_id fallback");
      }

      const objectStoryId = `${pageId}_${postId}`;

      // Step 2: create_ad_creative using existing post
      const creativeArgs: Record<string, unknown> = {
        account_id: accountId,
        name: `${adName} — creative`,
        page_id: pageId,
        object_story_id: objectStoryId,
      };
      const creativeResult = await client.callTool({
        name: "create_ad_creative",
        arguments: creativeArgs,
      });
      const creativeText = mcpTextLocal(creativeResult);
      logger.info({ creativeText }, "create_ad_from_post: create_ad_creative");
      const hasRealId = /"id"\s*:\s*"(\d{10,})"/.test(creativeText);
      if (/"error"/.test(creativeText) && !hasRealId) {
        throw new Error(
          `فشل إنشاء creative — ${extractMetaError(creativeText)}`,
        );
      }
      const creativeMatch = creativeText.match(/"id"\s*:\s*"(\d{10,})"/);
      const creativeId = creativeMatch?.[1] ?? "";
      if (!creativeId)
        throw new Error(
          `لم يُعاد creative_id — ${extractMetaError(creativeText)}`,
        );

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
      const adMatch =
        adText.match(/"id"\s*:\s*"(\d+)"/) ?? adText.match(/\b(\d{10,})\b/);
      const newAdId = adMatch?.[1] ?? "";
      if (!newAdId)
        throw new Error(`لم يُعد ad_id — ${extractMetaError(adText)}`);

      // Verify (non-fatal when META_ACCESS_TOKEN is missing/expired — trust Pipeboard id)
      const cafpVerify = await verifyMetaEntityDirect(
        newAdId,
        "id,name,status,effective_status,adset_id,campaign_id,created_time,updated_time",
        "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg",
      );
      if (!cafpVerify.verified) {
        const ve = cafpVerify.meta_error ?? {};
        const veCode = Number(ve.code ?? 0);
        const veMsg = String(ve.message ?? "");
        const isTokenIssue =
          !process.env.META_ACCESS_TOKEN ||
          veMsg === "META_ACCESS_TOKEN missing" ||
          veCode === 190 ||
          veMsg.toLowerCase().includes("session has expired") ||
          veMsg.toLowerCase().includes("access token");
        if (!isTokenIssue) {
          throw new Error(
            `create_ad_from_post: Pipeboard أعطى id=${newAdId} لكن Meta فشل التحقق — ${veMsg}${ve.fbtrace_id ? ` | fbtrace_id: ${ve.fbtrace_id}` : ""}`,
          );
        }
        logger.warn(
          { newAdId, veCode },
          "create_ad_from_post: token missing/expired — skipping verify, trusting Pipeboard id",
        );
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
      [
        executedBy,
        tool,
        JSON.stringify(args ?? {}),
        cafpSuccess,
        cafpMsg,
        null,
        String(args?.adset_id ?? ""),
        false,
      ],
    ).catch((e: unknown) =>
      logger.warn({ e }, "pipeboard audit insert failed"),
    );

    if (cafpSuccess) {
      const newAdIdOut = String(
        (args as Record<string, unknown>).__new_ad_id ?? "",
      );
      const cafpV = (args as Record<string, unknown>).__cafpVerify as
        | VerifyResult
        | undefined;
      res.json({
        success: true,
        message: cafpMsg,
        new_ad_id: newAdIdOut,
        adset_id: String(args?.adset_id ?? ""),
        object_story_id: String(
          args?.object_story_id ??
            `${args?.page_id ?? ""}_${args?.post_id ?? ""}`,
        ),
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
    let accountId = _rawAccArg.replace(/^act_/i, ""); // always WITHOUT act_
    let accountIdWithAct = accountId ? `act_${accountId}` : ""; // always WITH act_

    const adsetId = String(args?.adset_id ?? "").trim();
    const adName = String(args?.ad_name ?? args?.name ?? "إعلان من منشور");
    let objectStoryId = String(args?.object_story_id ?? "").trim();
    let pageId = String(args?.page_id ?? "").trim();
    let postId = String(args?.post_id ?? "").trim();
    const sourceAdId = String(args?.ad_id ?? args?.source_ad_id ?? "").trim();
    const flexMode = Boolean(args?.flex_mode ?? false); // Single Asset Flex — Advantage+ creative

    if (!adsetId) {
      res.status(400).json({ error: "adset_id مطلوب" });
      return;
    }

    // ── Entry log — received args ─────────────────────────────────────────────
    logger.info(
      {
        tool: "create_ad_from_existing_post",
        received_account_id: _rawAccArg || "(empty)",
        received_ad_id: sourceAdId || "(empty)",
        received_object_story_id: objectStoryId || "(empty)",
        received_adset_id: adsetId,
      },
      "create_ad_from_existing_post: args received",
    );

    // ── Step 2: Always derive account_id if missing — independent of object_story_id ──
    // Priority: ad_id → adset_id → object_story_id (last resort, page_id only)
    if (!accountId) {
      const metaTkn = "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg";

      // Try from ad_id first (richest source — also gives object_story_id)
      if (sourceAdId) {
        try {
          const u = new URL(`https://graph.facebook.com/v21.0/${sourceAdId}`);
          u.searchParams.set(
            "fields",
            "id,account_id,creative{id,object_story_id}",
          );
          u.searchParams.set("access_token", metaTkn);
          const j = (await (
            await fetch(u.toString(), { signal: AbortSignal.timeout(10_000) })
          ).json()) as Record<string, unknown>;
          const fetched = String(j.account_id ?? "").replace(/^act_/, "");
          if (fetched) {
            accountId = fetched;
            accountIdWithAct = `act_${fetched}`;
          }
          // Also fill object_story_id while we're here
          if (!objectStoryId && !postId) {
            const cr = j.creative as Record<string, unknown> | undefined;
            objectStoryId = String(cr?.object_story_id ?? "").trim();
          }
          logger.info(
            { sourceAdId, derived_account_id: accountId || "(none)" },
            "create_ad_from_existing_post: derived account_id from ad_id",
          );
        } catch (e) {
          logger.warn(
            { e, sourceAdId },
            "create_ad_from_existing_post: derive from ad_id failed",
          );
        }
      }

      // Try from adset_id if still missing
      if (!accountId && adsetId) {
        try {
          const u = new URL(`https://graph.facebook.com/v21.0/${adsetId}`);
          u.searchParams.set("fields", "id,account_id");
          u.searchParams.set("access_token", metaTkn);
          const j = (await (
            await fetch(u.toString(), { signal: AbortSignal.timeout(10_000) })
          ).json()) as Record<string, unknown>;
          const fetched = String(j.account_id ?? "").replace(/^act_/, "");
          if (fetched) {
            accountId = fetched;
            accountIdWithAct = `act_${fetched}`;
          }
          logger.info(
            { adsetId, derived_account_id: accountId || "(none)" },
            "create_ad_from_existing_post: derived account_id from adset_id",
          );
        } catch (e) {
          logger.warn(
            { e, adsetId },
            "create_ad_from_existing_post: derive from adset_id failed",
          );
        }
      }
    } else if (sourceAdId && !objectStoryId) {
      // account_id present but object_story_id missing — fetch object_story_id only
      try {
        const metaTkn = "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg";
        const u = new URL(`https://graph.facebook.com/v21.0/${sourceAdId}`);
        u.searchParams.set("fields", "id,creative{id,object_story_id}");
        u.searchParams.set("access_token", metaTkn);
        const j = (await (
          await fetch(u.toString(), { signal: AbortSignal.timeout(10_000) })
        ).json()) as Record<string, unknown>;
        if (!postId) {
          const cr = j.creative as Record<string, unknown> | undefined;
          objectStoryId = String(cr?.object_story_id ?? "").trim();
        }
      } catch (e) {
        logger.warn(
          { e, sourceAdId },
          "create_ad_from_existing_post: fetch object_story_id failed",
        );
      }
    }

    // ── Computed log — what will be sent to Pipeboard ─────────────────────────
    logger.info(
      {
        accountId: accountId || "(EMPTY — will fail)",
        accountIdWithAct: accountIdWithAct || "(EMPTY — will fail)",
        objectStoryId: objectStoryId || "(empty)",
        adsetId,
        sourceAdId: sourceAdId || "(none)",
      },
      "create_ad_from_existing_post: resolved values before Pipeboard calls",
    );

    // ── Hard guard — fail fast with clear error ────────────────────────────────
    if (!accountId) {
      res.status(400).json({
        error:
          "No account ID provided — أرسل account_id أو accountId في الـ bulk_action، أو تأكد أن ad_id / adset_id صحيح حتى يُجلب تلقائياً",
        received: {
          account_id: _rawAccArg || "(empty)",
          ad_id: sourceAdId || "(empty)",
          adset_id: adsetId,
        },
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
      return (
        (result as { content?: Array<{ type: string; text?: string }> })
          ?.content ?? []
      )
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("")
        .trim();
    }

    // ── Pre-Pipeboard log — confirms resolved values before any MCP call ─────────
    logger.info(
      {
        accountId: accountId || "(EMPTY — will fail)",
        accountIdWithAct: accountIdWithAct || "(EMPTY — will fail)",
        objectStoryId: objectStoryId || "(empty)",
        adsetId,
        sourceAdId: sourceAdId || "(none)",
      },
      "create_ad_from_existing_post: resolved values before Pipeboard calls",
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
          const pagesResult = await client.callTool({
            name: "get_account_pages",
            arguments: { account_id: accountId },
          });
          const pagesText = mcpTextEfp(pagesResult);
          const pageMatch =
            pagesText.match(/"id"\s*:\s*"(\d+)"/) ??
            pagesText.match(/\b(\d{10,})\b/);
          pageId = pageMatch?.[1] ?? "";
          if (!pageId)
            logger.warn(
              "create_ad_from_existing_post: get_account_pages — no page_id found",
            );
        } catch (e) {
          logger.warn(
            { e },
            "create_ad_from_existing_post: get_account_pages threw",
          );
        }
      }
      if (!pageId) {
        const lp = String(args?.landing_page_url ?? args?.link_url ?? "");
        if (lp.includes("buzzpick.net")) pageId = "878997831971062";
        else if (lp.includes("dealme-eg.com") || lp.includes("alsouqalhor.com") || lp.includes("dealoop.net")) pageId = "108193615487446";
        else pageId = "108193615487446";
        logger.warn({ pageId }, "create_ad_from_existing_post: domain-mapped page_id fallback");
      }

      if (!objectStoryId) objectStoryId = `${pageId}_${postId}`;

      // ── FLEX PATH: Advantage+ Single Asset creative via direct Meta API ────────
      // Bypasses Pipeboard (which rejects degrees_of_freedom_spec / advantage_plus_creative).
      // Requires META_ACCESS_TOKEN for creative asset lookup — if missing/expired, fall
      // through to NORMAL PATH (Pipeboard create_ad_creative via object_story_id).
      if (flexMode && sourceAdId && process.env.META_ACCESS_TOKEN) {
        const metaTknFlex = process.env.META_ACCESS_TOKEN;

        // Fetch raw creative assets from source ad
        const flexAssetUrl = new URL(
          `https://graph.facebook.com/v21.0/${sourceAdId}`,
        );
        flexAssetUrl.searchParams.set(
          "fields",
          "creative{id,video_id,image_hash,body,title,link_url,call_to_action}",
        );
        flexAssetUrl.searchParams.set("access_token", metaTknFlex);
        const flexAssetJson = (await (
          await fetch(flexAssetUrl.toString(), {
            signal: AbortSignal.timeout(12_000),
          })
        ).json()) as Record<string, unknown>;
        const flexCr = (flexAssetJson.creative ?? {}) as Record<
          string,
          unknown
        >;
        const flexVideoId = String(flexCr.video_id ?? "");
        const flexImgHash = String(flexCr.image_hash ?? "");
        const flexText = String(flexCr.body ?? "");
        const flexTitle = String(flexCr.title ?? "");
        let flexLink = String(flexCr.link_url ?? "");
        const flexCtaObj = (flexCr.call_to_action ?? {}) as Record<
          string,
          unknown
        >;
        const flexCtaType = String(flexCtaObj.type ?? "SHOP_NOW");
        if (!flexLink && flexCtaObj.value)
          flexLink = String(
            (flexCtaObj.value as Record<string, unknown>).link ?? "",
          );

        if (!flexVideoId && !flexImgHash)
          throw new Error(
            "Flex Mode: لا يوجد video_id أو image_hash في الإعلان المصدر",
          );
        if (!flexLink)
          throw new Error("Flex Mode: لا يوجد link_url في الإعلان المصدر");

        const flexSpec: Record<string, unknown> = flexVideoId
          ? {
              page_id: pageId,
              video_data: {
                video_id: flexVideoId,
                ...(flexText ? { message: flexText } : {}),
                ...(flexTitle ? { link_description: flexTitle } : {}),
                call_to_action: {
                  type: flexCtaType,
                  value: { link: flexLink },
                },
              },
            }
          : {
              page_id: pageId,
              link_data: {
                image_hash: flexImgHash,
                ...(flexText ? { message: flexText } : {}),
                ...(flexTitle ? { name: flexTitle } : {}),
                link: flexLink,
                call_to_action: {
                  type: flexCtaType,
                  value: { link: flexLink },
                },
              },
            };

        // Flex creative + ad via Pipeboard MCP (Pipeboard token has ads_management)
        const flexPbClient = await getPipeboardWriteClient();
        // Build flat params for Pipeboard (does NOT accept object_story_spec)
        const flexCrFlatArgs: Record<string, unknown> = {
          account_id: accountIdWithAct,
          name: `${adName} — flex creative`,
          page_id: pageId,
          link_url: flexLink,
          ...(flexText ? { message: flexText } : {}),
          ...(flexTitle ? { headline: flexTitle } : {}),
          call_to_action_type: flexCtaType,
          creative_features_spec: { standard_enhancements: { enroll_status: "OPT_IN" } },
        };
        if (flexVideoId) {
          flexCrFlatArgs.video_id = flexVideoId;
        } else {
          flexCrFlatArgs.image_hash = flexImgHash;
        }

        logger.info({ accountIdWithAct, adsetId }, "create_ad_from_existing_post: → Pipeboard create_ad_creative (flex)");
        const flexCrResult = await flexPbClient.callTool(
          { name: "create_ad_creative", arguments: flexCrFlatArgs },
          undefined,
          { timeout: 30_000 },
        );
        const flexCrText = (
          (flexCrResult as { content?: Array<{ type: string; text?: string }> })?.content ?? []
        ).filter(c => c.type === "text").map(c => (c as { text?: string }).text ?? "").join("").trim();
        logger.info({ flexCrText: flexCrText.slice(0, 300) }, "create_ad_from_existing_post: ← Pipeboard create_ad_creative (flex)");

        const flexCreativeIdMatch = flexCrText.match(/"id"\s*:\s*"(\d{10,})"/) ?? flexCrText.match(/\b(\d{10,})\b/);
        const flexCreativeId = flexCreativeIdMatch?.[1] ?? "";
        if (!flexCreativeId)
          throw new Error(`Flex Mode: فشل create_ad_creative — ${flexCrText.slice(0, 200)}`);
        logger.info({ flexCreativeId, flexVideoId: flexVideoId || "(image)", adsetId }, "create_ad_from_existing_post: flex creative created via Pipeboard");

        const flexAdResult = await flexPbClient.callTool(
          {
            name: "create_ad",
            arguments: {
              account_id: accountIdWithAct,
              name: adName,
              adset_id: adsetId,
              creative_id: flexCreativeId,
              status: "PAUSED",
            },
          },
          undefined,
          { timeout: 30_000 },
        );
        const flexAdText = (
          (flexAdResult as { content?: Array<{ type: string; text?: string }> })?.content ?? []
        ).filter(c => c.type === "text").map(c => (c as { text?: string }).text ?? "").join("").trim();
        logger.info({ flexAdText: flexAdText.slice(0, 300) }, "create_ad_from_existing_post: ← Pipeboard create_ad (flex)");

        const flexNewAdIdMatch = flexAdText.match(/"id"\s*:\s*"(\d+)"/) ?? flexAdText.match(/\b(\d{10,})\b/);
        const flexNewAdId = flexNewAdIdMatch?.[1] ?? "";
        if (!flexNewAdId) throw new Error(`Flex Mode: فشل create_ad — ${flexAdText.slice(0, 200)}`);

        // Non-fatal verify
        const flexVerify = await verifyMetaEntityDirect(
          flexNewAdId,
          "id,name,status,effective_status,adset_id,campaign_id,creative{id}",
          metaTknFlex,
        );
        if (!flexVerify.verified)
          logger.warn({ flexNewAdId }, "create_ad_from_existing_post: flex verify failed — ad may still exist");

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
        const creativeResult = await client.callTool({
          name: "create_ad_creative",
          arguments: creativeArgs,
        });
        const creativeText = mcpTextEfp(creativeResult);
        logger.info(
          { creativeText },
          "create_ad_from_existing_post: create_ad_creative",
        );
        const hasRealIdEfp = /"id"\s*:\s*"(\d{10,})"/.test(creativeText);
        if (/"error"/.test(creativeText) && !hasRealIdEfp) {
          throw new Error(
            `فشل إنشاء creative — ${extractMetaError(creativeText)}`,
          );
        }
        const creativeMatch = creativeText.match(/"id"\s*:\s*"(\d{10,})"/);
        const creativeId = creativeMatch?.[1] ?? "";
        if (!creativeId)
          throw new Error(
            `لم يُعاد creative_id — ${extractMetaError(creativeText)}`,
          );

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
        const adMatch =
          adText.match(/"id"\s*:\s*"(\d+)"/) ?? adText.match(/\b(\d{10,})\b/);
        const newAdId = adMatch?.[1] ?? "";
        if (!newAdId)
          throw new Error(`لم يُعد ad_id — ${extractMetaError(adText)}`);

        const efpVerify = await verifyMetaEntityDirect(
          newAdId,
          "id,name,status,effective_status,adset_id,campaign_id,created_time,updated_time",
          "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg",
        );
        if (!efpVerify.verified) {
          const ve = efpVerify.meta_error ?? {};
          const veCode = Number(ve.code ?? 0);
          const veMsg = String(ve.message ?? "");
          // Error 190 = expired token — ad WAS created by Pipeboard, just can't verify.
          // Treat as success and trust the id Pipeboard returned.
          const isTokenExpired = veCode === 190 ||
            veMsg.toLowerCase().includes("session has expired") ||
            veMsg.toLowerCase().includes("access token");
          if (!isTokenExpired) {
            throw new Error(
              `create_ad_from_existing_post: Pipeboard أعطى id=${newAdId} لكن Meta فشل التحقق — ${veMsg}${ve.fbtrace_id ? ` | fbtrace_id: ${ve.fbtrace_id}` : ""}`,
            );
          }
          logger.warn({ newAdId, veCode }, "create_ad_from_existing_post: token expired — skipping verify, trusting Pipeboard id");
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
      [
        executedBy,
        tool,
        JSON.stringify(args ?? {}),
        efpSuccess,
        efpMsg,
        null,
        String(args?.adset_id ?? ""),
        false,
      ],
    ).catch((e: unknown) =>
      logger.warn({ e }, "pipeboard audit insert failed"),
    );

    if (efpSuccess) {
      const newAdIdOut = String(
        (args as Record<string, unknown>).__new_ad_id ?? "",
      );
      const efpV = (args as Record<string, unknown>).__efpVerify as
        | VerifyResult
        | undefined;
      res.json({
        success: true,
        message: efpMsg,
        new_ad_id: newAdIdOut,
        adset_id: String(args?.adset_id ?? ""),
        object_story_id: String(
          args?.object_story_id ??
            `${args?.page_id ?? ""}_${args?.post_id ?? ""}`,
        ),
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
    const accountId = rawAccountId.startsWith("act_")
      ? rawAccountId.slice(4)
      : rawAccountId;
    const accountIdWithAct = rawAccountId.startsWith("act_")
      ? rawAccountId
      : `act_${rawAccountId}`;
    const adsetId = String(args?.adset_id ?? "").replace(/,/g, "").trim();
    const adName = String(args?.name ?? "إعلان من أصول creative");
    const primaryText = String(args?.primary_text ?? "");
    const headline = String(args?.headline ?? "");
    const linkUrl = String(args?.link_url ?? "");
    const callToAction = String(args?.call_to_action ?? "SHOP_NOW");
    const mediaType = String(args?.media_type ?? "video");
    let videoId = String(args?.video_id ?? "");
    const imageHash = String(args?.image_hash ?? "");
    let pageId = String(args?.page_id ?? "").trim();
    let instagramActorId = String(args?.instagram_actor_id ?? "").trim();

    if (!accountId) {
      res.status(400).json({ error: "account_id مطلوب" });
      return;
    }
    if (!adsetId) {
      res.status(400).json({ error: "adset_id مطلوب" });
      return;
    }
    // Guard: adset_id must be numeric — if name/placeholder given, auto-resolve from DB
    if (!/^\d{10,}$/.test(adsetId)) {
      try {
        // Strategy 1: resolve by exact adset name
        const byName = await query<{ result_message: string }>(
          `SELECT result_message FROM pipeboard_actions
           WHERE tool_name = 'create_adset' AND success = true AND adset_name = $1
           ORDER BY created_at DESC LIMIT 1`,
          [adsetId],
        );
        const msgByName = byName[0]?.result_message ?? "";
        const idByName = msgByName.match(/adset_id:\s*(\d{10,})/)?.[1];

        // Strategy 2 (fallback): most recent successful create_adset in last 10 min
        // Used when AI sends a placeholder like "<PLEASE_PROVIDE_ADSET_ID>"
        let resolvedId = idByName;
        let resolveStrategy = "by-name";
        if (!resolvedId) {
          const byRecent = await query<{ result_message: string; adset_name: string }>(
            `SELECT result_message, adset_name FROM pipeboard_actions
             WHERE tool_name = 'create_adset' AND success = true
               AND created_at > NOW() - INTERVAL '10 minutes'
             ORDER BY created_at DESC LIMIT 1`,
            [],
          );
          const msgByRecent = byRecent[0]?.result_message ?? "";
          resolvedId = msgByRecent.match(/adset_id:\s*(\d{10,})/)?.[1];
          if (resolvedId) {
            resolveStrategy = `by-recent (adset_name="${byRecent[0]?.adset_name}")`;
          }
        }

        if (resolvedId) {
          logger.warn(
            { passedValue: adsetId, resolvedId, resolveStrategy },
            "create_ad_from_creative_spec: adset_id was non-numeric — auto-resolved from DB",
          );
          Object.assign(args as object, { adset_id: resolvedId });
        } else {
          res.status(400).json({
            error:
              `adset_id غير صالح: "${adsetId}" — يجب أن يكون الرقم الـ numeric المُعاد من create_adset ` +
              `(مثال: 120244466883620554)، وليس اسم المجموعة أو placeholder. ` +
              `ارجع إلى نتيجة create_adset واستخدم adset_id الرقمي منها.`,
          });
          return;
        }
      } catch {
        res.status(400).json({
          error:
            `adset_id غير صالح: "${adsetId}" — يجب أن يكون الرقم الـ numeric المُعاد من create_adset.`,
        });
        return;
      }
    }
    // Re-read adsetId in case it was resolved above
    const resolvedAdsetId = String((args as Record<string, unknown>)?.adset_id ?? adsetId).replace(/,/g, "").trim();
    if (!linkUrl) {
      res.status(400).json({ error: "link_url مطلوب" });
      return;
    }
    if (mediaType === "video" && !videoId) {
      // ── Auto-upload: if media_url or video_id looks like a URL, upload it ──
      // The AI may pass a Google Drive URL or direct video URL instead of a numeric
      // video_id. Detect this and auto-upload via Pipeboard upload_ad_video,
      // exactly like upload_video_to_meta does, so the flow doesn't block.
      const rawMediaUrl = String(
        (args as Record<string, unknown>)?.media_url ?? ""
      ).trim();
      const rawVideoIdAsUrl = videoId.includes("://") ? videoId : "";
      const autoUploadUrl = rawMediaUrl || rawVideoIdAsUrl;

      if (autoUploadUrl) {
        // ── Helper: normalise Drive file URL to direct download link ──────────
        function normDriveUrlSpec(raw: string): string {
          const fileMatch = raw.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
          if (fileMatch) return `https://drive.usercontent.google.com/download?id=${fileMatch[1]}&export=download&authuser=0`;
          const idMatch  = raw.match(/drive\.google\.com\/(?:open|uc)[^?]*\?(?:[^#]*&)?id=([^&#]+)/);
          if (idMatch)   return `https://drive.usercontent.google.com/download?id=${idMatch[1]}&export=download&authuser=0`;
          if (raw.includes("drive.usercontent.google.com")) return raw;
          return raw;
        }

        // ── If it's a Drive folder URL, pick the first (or hinted) video ─────
        let uploadUrl = "";
        let resolvedFilename = "video";
        const folderMatch = autoUploadUrl.match(/\/folders\/([a-zA-Z0-9-_]+)/);
        if (folderMatch) {
          const googleApiKey = process.env.GOOGLE_API_KEY;
          if (!googleApiKey) {
            res.status(400).json({ error: "create_ad_from_creative_spec: GOOGLE_API_KEY مفقود — لا يمكن استعراض مجلد Drive" });
            return;
          }
          const folderId   = folderMatch[1]!;
          const driveApiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,mimeType,name)&key=${googleApiKey}`;
          const driveResp  = await fetch(driveApiUrl, { signal: AbortSignal.timeout(30_000) });
          if (!driveResp.ok) {
            const hint = driveResp.status === 404
              ? " — تأكد أن المجلد مشارك بـ \"أي شخص لديه الرابط\" (Share → Anyone with the link → Viewer)"
              : driveResp.status === 403
              ? " — الوصول مرفوض؛ غيّر صلاحية المجلد إلى \"أي شخص لديه الرابط\""
              : "";
            res.status(500).json({ error: `فشل Google Drive API للمجلد "${folderId}": ${driveResp.status} ${driveResp.statusText}${hint}` });
            return;
          }
          const driveData  = (await driveResp.json()) as { files?: Array<{ id: string; mimeType: string; name: string }> };
          const videoFiles = (driveData.files ?? []).filter(f => f.mimeType.startsWith("video/"));
          if (videoFiles.length === 0) {
            res.status(400).json({ error: `مجلد Drive "${folderId}" لا يحتوي على فيديوهات` });
            return;
          }
          const hint    = String((args as Record<string, unknown>)?.filename_hint ?? "").toLowerCase();
          const matched = hint
            ? (videoFiles.find(f => { const n = f.name.replace(/\.[^.]+$/, "").toLowerCase(); return n === hint || n.includes(hint) || hint.includes(n); }) ?? videoFiles[0]!)
            : videoFiles[0]!;
          resolvedFilename = matched.name;
          uploadUrl        = `https://drive.usercontent.google.com/download?id=${matched.id}&export=download&authuser=0`;
        } else {
          uploadUrl        = normDriveUrlSpec(autoUploadUrl);
          resolvedFilename = String((args as Record<string, unknown>)?.filename_hint ?? "video");
        }

        logger.info({ uploadUrl, resolvedFilename, accountId }, "create_ad_from_creative_spec: auto-uploading video from URL");

        try {
          const uploadClient = await getPipeboardWriteClient();
          const vidResult    = await uploadClient.callTool(
            { name: "upload_ad_video", arguments: { account_id: accountId, video_url: uploadUrl, name: resolvedFilename || `video_${Date.now()}` } },
            undefined,
            { timeout: 120_000 },
          );
          const vidText = (
            (vidResult.content as Array<{ type: string; text?: string }>)
              ?.filter(c => c.type === "text")
              .map(c => c.text ?? "")
              .join("") ?? ""
          ).trim();
          const vidMatch = vidText.match(/"(?:video_id|id)"\s*:\s*"(\d+)"/) ?? vidText.match(/\b(\d{10,})\b/);
          videoId        = vidMatch?.[1] ?? "";
          if (!videoId) {
            res.status(500).json({ error: `رفع الفيديو فشل — استجابة Pipeboard: ${vidText.slice(0, 300)}` });
            return;
          }
          logger.info({ videoId, resolvedFilename }, "create_ad_from_creative_spec: auto-upload succeeded");
        } catch (uploadErr) {
          const uploadMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          res.status(500).json({ error: `فشل رفع الفيديو تلقائياً: ${uploadMsg}` });
          return;
        }
      } else {
        // No URL provided either — return actionable guidance
        res.status(400).json({
          error:
            "video_id مطلوب لـ media_type=video — " +
            "video_id هو Meta Video ID (رقم مثل 1234567890)، وليس URL. " +
            "احصل عليه بإحدى الطريقتين: " +
            "(١) إذا كان لديك إعلان فيديو موجود → استدعِ get_ad_creative(source_ad_id) وستجد video_id في النتيجة، ثم أعِد استدعاء create_ad_from_creative_spec مع video_id الصحيح. " +
            "(٢) إذا لديك رابط فيديو من Drive أو URL مباشر → أرسله في حقل media_url وسيرفع الـ backend الفيديو ويحصل على video_id تلقائياً.",
        });
        return;
      }
    }
    if (mediaType === "image" && !imageHash) {
      res.status(400).json({ error: "image_hash مطلوب لـ media_type=image" });
      return;
    }

    // META_ACCESS_TOKEN used only for page_id and thumbnail GET requests (optional fallbacks).
    // Creative + Ad creation now routes through Pipeboard MCP (which has its own Meta token with ads_management).
    const metaTkn = "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg";

    let csSuccess = false;
    let csMsg = "";

    try {
      // Auto-fetch page_id if missing
      if (!pageId) {
        const pagesUrl = new URL(
          `https://graph.facebook.com/v21.0/${accountIdWithAct}/pages`,
        );
        pagesUrl.searchParams.set("fields", "id,name");
        pagesUrl.searchParams.set("access_token", metaTkn);
        const pagesResp = await fetch(pagesUrl.toString(), {
          signal: AbortSignal.timeout(10_000),
        });
        const pagesJson = (await pagesResp.json()) as {
          data?: Array<{ id: string }>;
        };
        pageId = pagesJson.data?.[0]?.id ?? "";
        if (!pageId) {
          const lp = String(args?.landing_page_url ?? args?.link_url ?? "");
          if (lp.includes("buzzpick.net")) pageId = "878997831971062";
          else if (lp.includes("dealme-eg.com") || lp.includes("alsouqalhor.com") || lp.includes("dealoop.net")) pageId = "108193615487446";
          else pageId = "108193615487446";
          logger.warn({ pageId }, "create_adcreative: domain-mapped page_id fallback");
        }
      }
      // instagram_actor_id: only use if explicitly provided.
      // Pages are from a personal account (not BM) — page_id in object_story_spec
      // is sufficient for all placements including Instagram.
      // ⛔ Never fall back instagramActorId → pageId: FB Page IDs are invalid IG Actor IDs.

      // Step 1: build object_story_spec
      let objectStorySpec: Record<string, unknown>;
      if (mediaType === "video") {
        // Meta requires image_hash OR image_url (thumbnail) in video_data — fetch auto-generated thumbnail if not provided
        let thumbnailImageHash = String(args?.image_hash ?? "");
        let thumbnailImageUrl = String(args?.image_url ?? "");
        if (!thumbnailImageHash && !thumbnailImageUrl && videoId) {
          try {
            const thumbUrl = new URL(`https://graph.facebook.com/v21.0/${videoId}/thumbnails`);
            thumbUrl.searchParams.set("access_token", metaTkn);
            const thumbResp = await fetch(thumbUrl.toString(), { signal: AbortSignal.timeout(8_000) });
            const thumbJson = (await thumbResp.json()) as { data?: Array<{ uri?: string; is_preferred?: boolean }> };
            const thumbs = thumbJson.data ?? [];
            // prefer is_preferred=true, else take first
            const preferred = thumbs.find(t => t.is_preferred) ?? thumbs[0];
            if (preferred?.uri) {
              thumbnailImageUrl = preferred.uri;
              logger.info({ videoId, thumbnailImageUrl }, "create_adcreative: auto-fetched video thumbnail");
            } else {
              logger.warn({ videoId, thumbJson }, "create_adcreative: no thumbnails returned from Meta");
            }
          } catch (thumbErr) {
            logger.warn({ videoId, err: String(thumbErr) }, "create_adcreative: failed to fetch thumbnails — proceeding without");
          }
        }

        objectStorySpec = {
          page_id: pageId,
          video_data: {
            video_id: videoId,
            ...(thumbnailImageHash ? { image_hash: thumbnailImageHash } : {}),
            ...(thumbnailImageUrl && !thumbnailImageHash ? { image_url: thumbnailImageUrl } : {}),
            ...(primaryText ? { message: primaryText } : {}),
            ...(headline ? { link_description: headline } : {}),
            call_to_action: { type: callToAction, value: { link: linkUrl } },
          },
        };
      } else {
        objectStorySpec = {
          page_id: pageId,
          link_data: {
            image_hash: imageHash,
            ...(primaryText ? { message: primaryText } : {}),
            ...(headline ? { name: headline } : {}),
            link: linkUrl,
            call_to_action: { type: callToAction, value: { link: linkUrl } },
          },
        };
      }

      // Step 2: POST adcreatives via Pipeboard MCP
      // Pipeboard has its own Meta token with ads_management — direct Meta API fails (permissions).
      // Pipeboard's create_ad_creative uses FLAT params, NOT object_story_spec.
      const pbClientCs = await getPipeboardWriteClient();
      const pbCreativeArgs: Record<string, unknown> = {
        account_id: accountIdWithAct,
        name: `${adName} — creative`,
        page_id: pageId,
        link_url: linkUrl,
        ...(primaryText ? { message: primaryText } : {}),
        ...(headline ? { headline } : {}),
        ...(callToAction ? { call_to_action_type: callToAction } : {}),
        ...(instagramActorId ? { instagram_actor_id: instagramActorId } : {}),
      };
      if (mediaType === "video") {
        pbCreativeArgs.video_id = videoId;
        // Extract thumbnail from the already-built objectStorySpec
        const vidData = (objectStorySpec.video_data ?? {}) as Record<string, unknown>;
        if (vidData.image_url) pbCreativeArgs.thumbnail_url = String(vidData.image_url);
        if (vidData.image_hash) pbCreativeArgs.image_hash = String(vidData.image_hash);
      } else {
        pbCreativeArgs.image_hash = imageHash;
      }

      logger.info(
        { accountIdWithAct, mediaType, videoId, imageHash, linkUrl, pageId, adsetId,
          object_story_spec: objectStorySpec,
          primaryText: primaryText.slice(0, 80),
          headline: headline.slice(0, 40),
        },
        "create_adcreative: → Pipeboard create_ad_creative",
      );

      const pbCreativeResult = await pbClientCs.callTool(
        { name: "create_ad_creative", arguments: pbCreativeArgs },
        undefined,
        { timeout: 30_000 },
      );
      const pbCreativeText = (
        (pbCreativeResult as { content?: Array<{ type: string; text?: string }> })
          ?.content ?? []
      ).filter(c => c.type === "text").map(c => (c as { text?: string }).text ?? "").join("").trim();
      logger.info({ pbCreativeText: pbCreativeText.slice(0, 400) }, "create_adcreative: ← Pipeboard create_ad_creative");

      const creativeIdMatch =
        pbCreativeText.match(/"id"\s*:\s*"(\d{10,})"/) ??
        pbCreativeText.match(/\b(\d{10,})\b/);
      const creativeId = creativeIdMatch?.[1] ?? "";
      if (!creativeId)
        throw new Error(`فشل create_ad_creative — ${pbCreativeText.slice(0, 300)}`);
      logger.info({ creativeId, mediaType, adsetId }, "create_ad_from_creative_spec: creative created via Pipeboard");

      // Step 3: POST ads via Pipeboard MCP
      const pbAdResult = await pbClientCs.callTool(
        {
          name: "create_ad",
          arguments: {
            account_id: accountIdWithAct,
            name: adName,
            adset_id: resolvedAdsetId,
            creative_id: creativeId,
            status: "PAUSED",
          },
        },
        undefined,
        { timeout: 30_000 },
      );
      const pbAdText = (
        (pbAdResult as { content?: Array<{ type: string; text?: string }> })
          ?.content ?? []
      ).filter(c => c.type === "text").map(c => (c as { text?: string }).text ?? "").join("").trim();
      logger.info({ pbAdText: pbAdText.slice(0, 400) }, "create_adcreative: ← Pipeboard create_ad");

      const newAdIdMatch =
        pbAdText.match(/"id"\s*:\s*"(\d+)"/) ?? pbAdText.match(/\b(\d{10,})\b/);
      const newAdId = newAdIdMatch?.[1] ?? "";
      if (!newAdId) throw new Error(`فشل create_ad — ${pbAdText.slice(0, 300)}`);

      // Step 4: verify (GET only — safe even with limited META_ACCESS_TOKEN)
      const csVerify = await verifyMetaEntityDirect(
        newAdId,
        "id,name,status,effective_status,adset_id,campaign_id,creative{id}",
        metaTkn,
      );
      // Non-fatal verify: continue even if it fails (token may lack read access too)
      if (!csVerify.verified) {
        logger.warn({ newAdId }, "create_adcreative: verify failed — ad may still exist");
      }

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
      [
        executedBy,
        tool,
        JSON.stringify(args ?? {}),
        csSuccess,
        csMsg,
        null,
        adsetId,
        false,
      ],
    ).catch((e: unknown) =>
      logger.warn({ e }, "pipeboard audit insert failed"),
    );

    if (csSuccess) {
      const newAdIdOut = String(
        (args as Record<string, unknown>).__new_ad_id ?? "",
      );
      const csV = (args as Record<string, unknown>).__cs_verify as
        | VerifyResult
        | undefined;
      const creativeIdOut = String(
        (args as Record<string, unknown>).__creative_id ?? "",
      );
      res.json({
        success: true,
        message: csMsg,
        new_ad_id: newAdIdOut,
        creative_id: creativeIdOut,
        adset_id: adsetId,
        media_type: mediaType,
        verified: true,
        verified_fields: csV?.verified_fields,
      });
    } else {
      const metaErrDetails = parseMetaErrorDetails(csMsg);
      res.status(500).json({ error: csMsg, meta_error: metaErrDetails });
    }
    return;
  }

  // ── publish_winners_to_destination — Social Proof → Rebuild pipeline ─────────
  if (tool === "publish_winners_to_destination") {
    const rawAccountId = String(args?.account_id ?? "");
    const accountId = rawAccountId.startsWith("act_")
      ? rawAccountId.slice(4)
      : rawAccountId;
    const destinationAdsetId = String(args?.destination_adset_id ?? "");
    const namingPrefix = String(args?.naming_prefix ?? "Winner");
    const flexMode = Boolean(args?.flex_mode ?? false); // Single Asset Flex — skip Social Proof, use Advantage+ creative
    const sourceAdIds: string[] = Array.isArray(args?.source_ad_ids)
      ? (args.source_ad_ids as unknown[]).map(String).filter(Boolean)
      : String(args?.source_ad_ids ?? "")
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);

    if (!destinationAdsetId) {
      res.status(400).json({ error: "destination_adset_id مطلوب" });
      return;
    }
    if (sourceAdIds.length === 0) {
      res.status(400).json({ error: "source_ad_ids مطلوب" });
      return;
    }

    // metaTkn may be empty/expired — Pipeboard duplicate_ad path doesn't need it.
    // Social Proof / Rebuild fallback paths will use it if available.
    const metaTkn = "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg";

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
        // ── Path 0: Pipeboard duplicate_ad (no META_ACCESS_TOKEN needed) ─────
        // Primary path — duplicates the ad preserving all creative + social proof
        // without touching Meta Graph API directly.
        try {
          const dupPbClient0 = await getPipeboardWriteClient();
          const dupResult0 = await dupPbClient0.callTool(
            {
              name: "duplicate_ad",
              arguments: {
                ad_id: sourceAdId,
                adset_id: destinationAdsetId,
                name: `${namingPrefix} — ${sourceAdId}`,
                status: "PAUSED",
              },
            },
            undefined,
            { timeout: 30_000 },
          );
          const dupText0 = (
            (dupResult0 as { content?: Array<{ type: string; text?: string }> })?.content ?? []
          ).filter(c => c.type === "text").map(c => (c as { text?: string }).text ?? "").join("").trim();
          const dupId0Match =
            dupText0.match(/"(?:id|new_ad_id|copied_ad_id)"\s*:\s*"(\d+)"/) ??
            dupText0.match(/\b(\d{10,})\b/);
          const dupId0 = dupId0Match?.[1] ?? "";
          if (!dupId0) throw new Error(`duplicate_ad لم يُعد ad_id: ${dupText0.slice(0, 200)}`);
          logger.info({ sourceAdId, dupId0 }, "publish_winners: Pipeboard duplicate_ad succeeded");
          createdAds.push({
            source_ad_id: sourceAdId,
            method_used: "existing_post",
            new_ad_id: dupId0,
            status: "PAUSED",
          });
          continue;
        } catch (dupErr0) {
          logger.warn({ sourceAdId, err: dupErr0 }, "publish_winners: Pipeboard duplicate_ad failed — trying Social Proof / Rebuild");
        }

        // ── Fetch creative data (fallback when duplicate_ad fails) ───────────
        // Requires META_ACCESS_TOKEN; skipped with clear error if unavailable.
        if (!metaTkn) {
          throw new Error("duplicate_ad فشل ولا يوجد META_ACCESS_TOKEN — لا يمكن نسخ الإعلان");
        }
        const srcUrl = new URL(
          `https://graph.facebook.com/v21.0/${sourceAdId}`,
        );
        srcUrl.searchParams.set(
          "fields",
          "id,account_id,creative{id,object_story_id,effective_object_story_id,body,title,video_id,image_hash,link_url,call_to_action,instagram_actor_id,asset_feed_spec,thumbnail_url,object_story_spec}",
        );
        srcUrl.searchParams.set("access_token", metaTkn);
        const srcResp = await fetch(srcUrl.toString(), {
          signal: AbortSignal.timeout(12_000),
        });
        const srcJson = (await srcResp.json()) as Record<string, unknown>;
        if (srcJson.error) {
          const e = srcJson.error as Record<string, unknown>;
          const eCode = Number(e.code ?? 0);
          const eMsg = String(e.message ?? "");
          if (eCode === 190 || eMsg.toLowerCase().includes("session has expired") || eMsg.toLowerCase().includes("access token")) {
            throw new Error(`التوكن منتهي — Meta: ${eMsg}`);
          }
          throw new Error(`Meta error fetching ad: ${eMsg}`);
        }

        const rawSrcAccId =
          String(srcJson.account_id ?? "").replace(/^act_/, "") || accountId;
        const c = (srcJson.creative ?? {}) as Record<string, unknown>;
        const objectStoryId = String(
          c.effective_object_story_id ?? c.object_story_id ?? "",
        ).trim();
        let pageId = objectStoryId ? (objectStoryId.split("_")[0] ?? "") : "";
        const instagramActorId = String(c.instagram_actor_id ?? pageId);
        const assetFeed = (c.asset_feed_spec ?? {}) as Record<string, unknown>;
        const assetVideos = Array.isArray(assetFeed.videos)
          ? (assetFeed.videos as Array<Record<string, unknown>>)
          : [];
        const assetImages = Array.isArray(assetFeed.images)
          ? (assetFeed.images as Array<Record<string, unknown>>)
          : [];
        const objStorySpec = (c.object_story_spec ?? {}) as Record<
          string,
          unknown
        >;
        const videoData = (objStorySpec.video_data ?? {}) as Record<
          string,
          unknown
        >;
        const linkData = (objStorySpec.link_data ?? {}) as Record<
          string,
          unknown
        >;
        const videoId = String(
          c.video_id ?? assetVideos[0]?.video_id ?? videoData.video_id ?? "",
        );
        const imageHash = String(
          c.image_hash ?? assetImages[0]?.hash ?? linkData.image_hash ?? "",
        );
        const primaryText = String(c.body ?? "");
        const headline = String(c.title ?? "");
        let linkUrl = String(c.link_url ?? "");
        if (!linkUrl && videoData.call_to_action) {
          const vtaCta = videoData.call_to_action as Record<string, unknown>;
          if (vtaCta.value)
            linkUrl = String(
              (vtaCta.value as Record<string, unknown>).link ?? "",
            );
        }
        const ctaObj = (c.call_to_action ?? {}) as Record<string, unknown>;
        const callToAction = String(ctaObj.type ?? "SHOP_NOW");
        if (!linkUrl && ctaObj.value)
          linkUrl = String(
            (ctaObj.value as Record<string, unknown>).link ?? "",
          );
        const adLabel = `${namingPrefix} — ${sourceAdId}`;

        logger.info(
          { sourceAdId, objectStoryId, videoId: videoId || "(none)" },
          "publish_winners: creative fetched",
        );

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
            if (instagramActorId)
              spCreativeArgs.instagram_actor_id = instagramActorId;

            const spCreativeResult = await pbClient.callTool({
              name: "create_ad_creative",
              arguments: spCreativeArgs,
            });
            const spCreativeText = (
              (
                spCreativeResult as {
                  content?: Array<{ type: string; text?: string }>;
                }
              )?.content ?? []
            )
              .filter((x: { type: string }) => x.type === "text")
              .map((x: { text?: string }) => x.text ?? "")
              .join("")
              .trim();

            if (/"error"/.test(spCreativeText) && !/"id"/.test(spCreativeText))
              throw new Error(extractMetaError(spCreativeText));
            const spCreativeId =
              spCreativeText.match(/"id"\s*:\s*"(\d{10,})"/)?.[1] ?? "";
            if (!spCreativeId)
              throw new Error(
                `لم يُعد creative_id: ${spCreativeText.slice(0, 200)}`,
              );

            const spAdResult = await pbClient.callTool({
              name: "create_ad",
              arguments: {
                account_id: `act_${rawSrcAccId}`,
                name: adLabel,
                adset_id: destinationAdsetId,
                creative_id: spCreativeId,
                status: "PAUSED",
              },
            });
            const spAdText = (
              (
                spAdResult as {
                  content?: Array<{ type: string; text?: string }>;
                }
              )?.content ?? []
            )
              .filter((x: { type: string }) => x.type === "text")
              .map((x: { text?: string }) => x.text ?? "")
              .join("")
              .trim();

            if (/"error"/.test(spAdText) && !/"id"/.test(spAdText))
              throw new Error(extractMetaError(spAdText));
            const spNewAdId =
              spAdText.match(/"id"\s*:\s*"(\d+)"/)?.[1] ??
              spAdText.match(/\b(\d{10,})\b/)?.[1] ??
              "";
            if (!spNewAdId)
              throw new Error(`لم يُعد ad_id: ${spAdText.slice(0, 200)}`);

            const spVerify = await verifyMetaEntityDirect(
              spNewAdId,
              "id,name,status,effective_status,adset_id",
              metaTkn,
            );
            if (!spVerify.verified)
              logger.warn({ spNewAdId }, "publish_winners: Social Proof verify failed — ad may still exist (non-fatal)");

            createdAds.push({
              source_ad_id: sourceAdId,
              method_used: "existing_post",
              new_ad_id: spNewAdId,
              creative_id: spCreativeId,
              status: String(
                spVerify.verified_fields?.effective_status ?? "PAUSED",
              ),
            });
            logger.info(
              { sourceAdId, spNewAdId },
              "publish_winners: Social Proof succeeded",
            );
            continue;
          } catch (spErr) {
            socialProofError =
              spErr instanceof Error ? spErr.message : String(spErr);
            logger.warn(
              { sourceAdId, socialProofError },
              "publish_winners: Social Proof failed — trying Rebuild",
            );
            _pbWriteClient = null;
            _pbWriteConnecting = null;
          }
        } else if (flexMode) {
          socialProofError =
            "Flex Mode — Social Proof skipped intentionally (Advantage+ raw asset rebuild)";
          logger.info(
            { sourceAdId },
            "publish_winners: Flex Mode — skipping Social Proof",
          );
        } else {
          socialProofError = "لا يوجد object_story_id — Social Proof غير ممكن";
        }

        // ── Path 2: Rebuild from raw assets (+ Advantage+ Flex fields if flexMode) ──
        // Flex Mode: pageId may be empty if no objectStoryId — fetch from account pages
        if (flexMode && !pageId && rawSrcAccId) {
          // Try Pipeboard get_account_pages first (no META_ACCESS_TOKEN needed)
          try {
            const pgPbClient = await getPipeboardWriteClient();
            const pgPbResult = await pgPbClient.callTool({
              name: "get_account_pages",
              arguments: { account_id: `act_${rawSrcAccId}` },
            });
            const pgPbText = (
              (pgPbResult as { content?: Array<{ type: string; text?: string }> })?.content ?? []
            ).filter(c => c.type === "text").map(c => (c as { text?: string }).text ?? "").join("").trim();
            const pgPbMatch = pgPbText.match(/"id"\s*:\s*"(\d+)"/) ?? pgPbText.match(/\b(\d{10,})\b/);
            pageId = pgPbMatch?.[1] ?? "";
          } catch { /* Pipeboard page fetch failed */ }
          // Fallback to Meta Graph API if Pipeboard didn't return a page_id
          if (!pageId && metaTkn) {
            try {
              const pgUrl = new URL(`https://graph.facebook.com/v21.0/act_${rawSrcAccId}/pages`);
              pgUrl.searchParams.set("fields", "id");
              pgUrl.searchParams.set("access_token", metaTkn);
              const pgJson = (await (await fetch(pgUrl.toString(), { signal: AbortSignal.timeout(10_000) })).json()) as { data?: Array<{ id: string }> };
              pageId = pgJson.data?.[0]?.id ?? "";
            } catch { /* use empty — Meta will return a clear error */ }
          }
        }

        if (!videoId && !imageHash) {
          rebuildError = "لا يوجد video_id أو image_hash — Rebuild غير ممكن";
          failedAds.push({
            source_ad_id: sourceAdId,
            social_proof_error: socialProofError,
            rebuild_error: rebuildError,
          });
          continue;
        }
        if (!linkUrl) {
          rebuildError = "لا يوجد link_url — Rebuild غير ممكن";
          failedAds.push({
            source_ad_id: sourceAdId,
            social_proof_error: socialProofError,
            rebuild_error: rebuildError,
          });
          continue;
        }

        const objSpec: Record<string, unknown> = videoId
          ? {
              page_id: pageId,
              video_data: {
                video_id: videoId,
                ...(primaryText ? { message: primaryText } : {}),
                ...(headline ? { link_description: headline } : {}),
                call_to_action: {
                  type: callToAction,
                  value: { link: linkUrl },
                },
              },
            }
          : {
              page_id: pageId,
              link_data: {
                image_hash: imageHash,
                ...(primaryText ? { message: primaryText } : {}),
                ...(headline ? { name: headline } : {}),
                link: linkUrl,
                call_to_action: {
                  type: callToAction,
                  value: { link: linkUrl },
                },
              },
            };

        // Rebuild creative + ad via Pipeboard MCP (flat params — does NOT accept object_story_spec)
        const rbPbClient = await getPipeboardWriteClient();
        const rbAccWithAct = `act_${rawSrcAccId}`;
        // Extract media from objSpec for flat Pipeboard params
        const rbVideoData = (objSpec as Record<string, unknown>).video_data as Record<string, unknown> | undefined;
        const rbLinkData = (objSpec as Record<string, unknown>).link_data as Record<string, unknown> | undefined;
        const rbVideoId = String(rbVideoData?.video_id ?? "");
        const rbImageHash = String(rbLinkData?.image_hash ?? "");
        const rbMsg = String(rbVideoData?.message ?? rbLinkData?.message ?? "");
        const rbHeadline = String(rbVideoData?.link_description ?? rbLinkData?.name ?? "");
        const rbCtaObj = (rbVideoData?.call_to_action ?? rbLinkData?.call_to_action ?? {}) as Record<string, unknown>;
        const rbCtaType = String(rbCtaObj.type ?? callToAction);
        const rbCtaLink = String((rbCtaObj.value as Record<string, unknown> | undefined)?.link ?? linkUrl);
        const rbPageId = String((objSpec as Record<string, unknown>).page_id ?? pageId);

        const rbCreativeArgs: Record<string, unknown> = {
          account_id: rbAccWithAct,
          name: `${adLabel} — ${flexMode ? "flex" : "rebuild"} creative`,
          page_id: rbPageId,
          link_url: rbCtaLink,
          ...(rbMsg ? { message: rbMsg } : {}),
          ...(rbHeadline ? { headline: rbHeadline } : {}),
          ...(rbCtaType ? { call_to_action_type: rbCtaType } : {}),
          ...(instagramActorId ? { instagram_actor_id: instagramActorId } : {}),
        };
        if (rbVideoId) {
          rbCreativeArgs.video_id = rbVideoId;
          if (rbVideoData?.image_url) rbCreativeArgs.thumbnail_url = String(rbVideoData.image_url);
          if (rbVideoData?.image_hash) rbCreativeArgs.image_hash = String(rbVideoData.image_hash);
        } else {
          rbCreativeArgs.image_hash = rbImageHash;
        }
        if (flexMode) {
          rbCreativeArgs.creative_features_spec = {
            standard_enhancements: { enroll_status: "OPT_IN" },
          };
        }

        logger.info({ rbAccWithAct, destinationAdsetId, flexMode }, "publish_winners: → Pipeboard create_ad_creative (rebuild)");
        const rbCreativeResult = await rbPbClient.callTool(
          { name: "create_ad_creative", arguments: rbCreativeArgs },
          undefined,
          { timeout: 30_000 },
        );
        const rbCreativeText = (
          (rbCreativeResult as { content?: Array<{ type: string; text?: string }> })?.content ?? []
        ).filter(c => c.type === "text").map(c => (c as { text?: string }).text ?? "").join("").trim();
        logger.info({ rbCreativeText: rbCreativeText.slice(0, 300) }, "publish_winners: ← Pipeboard create_ad_creative (rebuild)");

        const rbCreativeIdMatch = rbCreativeText.match(/"id"\s*:\s*"(\d{10,})"/) ?? rbCreativeText.match(/\b(\d{10,})\b/);
        const rbCreativeId = rbCreativeIdMatch?.[1] ?? "";
        if (!rbCreativeId) throw new Error(`Rebuild: فشل create_ad_creative — ${rbCreativeText.slice(0, 200)}`);

        logger.info({ rbCreativeId, destinationAdsetId }, "publish_winners: → Pipeboard create_ad (rebuild)");
        const rbAdResult = await rbPbClient.callTool(
          {
            name: "create_ad",
            arguments: {
              account_id: rbAccWithAct,
              name: `${adLabel} — rebuild`,
              adset_id: destinationAdsetId,
              creative_id: rbCreativeId,
              status: "PAUSED",
            },
          },
          undefined,
          { timeout: 30_000 },
        );
        const rbAdText = (
          (rbAdResult as { content?: Array<{ type: string; text?: string }> })?.content ?? []
        ).filter(c => c.type === "text").map(c => (c as { text?: string }).text ?? "").join("").trim();
        logger.info({ rbAdText: rbAdText.slice(0, 300) }, "publish_winners: ← Pipeboard create_ad (rebuild)");

        const rbNewAdIdMatch = rbAdText.match(/"id"\s*:\s*"(\d+)"/) ?? rbAdText.match(/\b(\d{10,})\b/);
        const rbNewAdId = rbNewAdIdMatch?.[1] ?? "";
        if (!rbNewAdId) throw new Error(`Rebuild: فشل create_ad — ${rbAdText.slice(0, 200)}`);

        // Non-fatal verify
        const rbVerify = await verifyMetaEntityDirect(
          rbNewAdId,
          "id,name,status,effective_status,adset_id",
          metaTkn,
        );
        if (!rbVerify.verified)
          logger.warn({ rbNewAdId }, "publish_winners: rebuild verify failed — ad may still exist");

        createdAds.push({
          source_ad_id: sourceAdId,
          method_used: flexMode
            ? ("creative_spec_flex" as "creative_spec")
            : "creative_spec",
          new_ad_id: rbNewAdId,
          creative_id: rbCreativeId,
          status: String(
            rbVerify.verified_fields?.effective_status ?? "PAUSED",
          ),
        });
        logger.info(
          { sourceAdId, rbNewAdId, flexMode },
          "publish_winners: Rebuild succeeded",
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!socialProofError) socialProofError = errMsg;
        else rebuildError = errMsg;
        failedAds.push({
          source_ad_id: sourceAdId,
          social_proof_error: socialProofError,
          rebuild_error: rebuildError || errMsg,
        });
        logger.warn(
          { sourceAdId, errMsg },
          "publish_winners: both paths failed",
        );
      }
    }

    const pwMsg = `publish_winners_to_destination: ${createdAds.length} نجح، ${failedAds.length} فشل`;
    await query(
      `INSERT INTO pipeboard_actions (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        executedBy,
        tool,
        JSON.stringify(args ?? {}),
        createdAds.length > 0,
        pwMsg,
        null,
        destinationAdsetId,
        false,
      ],
    ).catch((e: unknown) =>
      logger.warn({ e }, "pipeboard audit insert failed"),
    );

    res.json({
      success: createdAds.length > 0,
      message: pwMsg,
      destination_adset_id: destinationAdsetId,
      created_ads: createdAds,
      failed_ads: failedAds,
      summary: {
        total: sourceAdIds.length,
        succeeded: createdAds.length,
        failed: failedAds.length,
      },
    });
    return;
  }

  // ── Special multi-step: launch_pipeboard_campaign ────────────────────────
  if (tool === "launch_pipeboard_campaign") {
    const campaignStrategy = String(args?.strategy ?? "").toLowerCase();
    if (campaignStrategy === "standard") {
      res.status(400).json({
        error: "launch_pipeboard_campaign cannot be used for Standard strategy. Use create_campaign + create_adset + create_ad separately for each ad.",
        code: "WRONG_TOOL_FOR_STANDARD",
      });
      return;
    }

    // ── Types ──────────────────────────────────────────────────────────────
    interface AdsetInput {
      name: string;
      budget: number;
      targeting?: string;
    }
    interface CreativeInput {
      media_url: string;
      media_type: string;
      texts: string[];
      headlines: string[];
    }
    interface AdResult {
      adset_name: string;
      creative_index: number;
      adset_id?: string;
      creative_id?: string;
      ad_id?: string;
      error?: string;
    }

    // ── Auto-detect pixel_id from domain map (personal account — no BM) ─────
    const LPC_PIXEL_MAP: Record<string, string> = {
      "buzzpick.net":    "1405391498274239",
      "dealme-eg.com":   "1537301040808359",
      "dealoop.net":     "1537301040808359",
      "alsouqalhor.com": "1537301040808359",
    };
    const _lpcLandingUrl = String(args?.landing_page_url ?? "");
    let pixelId = String(args?.pixel_id ?? "").trim();
    if (!pixelId) {
      for (const [domain, pid] of Object.entries(LPC_PIXEL_MAP)) {
        if (_lpcLandingUrl.includes(domain)) { pixelId = pid; break; }
      }
      if (!pixelId) pixelId = "1537301040808359"; // default — dealme/dealoop/alsouqalhor
    }
    const hasPixel = pixelId.length > 0;
    const campObjective = hasPixel ? "OUTCOME_SALES" : "OUTCOME_TRAFFIC";
    const optimizationGoal = hasPixel ? "OFFSITE_CONVERSIONS" : "LINK_CLICKS";

    let pipeSuccess = false;
    let pipeMsg = "";
    let campaignId = "";
    const adResults: AdResult[] = [];
    let effectiveAdsets: AdsetInput[] = [];

    // ── Parse inputs: support both array and single-item (backward compat) ─
    let rawAdsets: AdsetInput[] =
      Array.isArray(args?.adsets) && (args.adsets as AdsetInput[]).length > 0
        ? (args.adsets as AdsetInput[])
        : [
            {
              name: `${String(args?.campaign_name ?? "حملة")} — مجموعة رئيسية`,
              budget: Number(args?.daily_budget ?? args?.budget ?? 100),
            },
          ];

    let rawCreatives: CreativeInput[] =
      Array.isArray(args?.creatives) &&
      (args.creatives as CreativeInput[]).length > 0
        ? (args.creatives as CreativeInput[])
        : [
            {
              media_url: String(args?.media_url ?? "").trim(),
              media_type: String(args?.media_type ?? "image").toLowerCase(),
              texts: [String(args?.primary_text ?? "")].filter(Boolean),
              headlines: [String(args?.headline ?? "")].filter(Boolean),
            },
          ];

    // ── Helpers ────────────────────────────────────────────────────────────
    const egpToCents = (v: unknown) => Math.round(Number(v) * 100);

    /** Normalise Google Drive sharing URLs → direct download via usercontent */
    function normaliseMediaUrl(raw: string): string {
      if (!raw) return raw;
      const driveFileMatch = raw.match(
        /drive\.google\.com\/file\/d\/([^/?#]+)/,
      );
      if (driveFileMatch) {
        return `https://drive.usercontent.google.com/download?id=${driveFileMatch[1]}&export=download&authuser=0`;
      }
      const driveIdMatch = raw.match(
        /drive\.google\.com\/(?:open|uc)[^?]*\?(?:[^#]*&)?id=([^&#]+)/,
      );
      if (driveIdMatch) {
        return `https://drive.usercontent.google.com/download?id=${driveIdMatch[1]}&export=download&authuser=0`;
      }
      if (raw.includes("drive.usercontent.google.com")) return raw;
      return raw;
    }

    function isVideoType(mediaUrl: string, mediaType: string): boolean {
      if (mediaType === "video") return true;
      if (mediaType === "image") return false;
      return /\.(mp4|mov|avi|mkv|webm|m4v|3gp|flv)($|\?)/.test(
        mediaUrl.toLowerCase(),
      );
    }

    function mcpText(result: unknown): string {
      return (
        (result as { content?: Array<{ type: string; text?: string }> })
          ?.content ?? []
      )
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
      const accountId = rawAccountId.startsWith("act_")
        ? rawAccountId.slice(4)
        : rawAccountId;
      const accountIdWithAct = rawAccountId.startsWith("act_")
        ? rawAccountId
        : `act_${rawAccountId}`;
      const campaignName = String(args?.campaign_name ?? "حملة جديدة");
      const landingPageUrl = String(args?.landing_page_url ?? "");
      const callToAction = String(args?.call_to_action ?? "LEARN_MORE");

      // ── Step 1: Create campaign ──────────────────────────────────────────
      // Meta minimum daily budget for EGP accounts is ~30 EGP per adset.
      // Default to 50 EGP per adset if not specified; enforce 30 EGP minimum.
      const MIN_BUDGET_PER_ADSET_EGP = 100;
      // Detect budget type: CBO = campaign-level budget, ABO = adset-level budget
      const budgetType = String(args?.budget_type ?? "CBO").toUpperCase();
      const isCBO = budgetType !== "ABO";
      const perAdsetBudgets = rawAdsets.map((a) => Math.max(a.budget ?? 100, MIN_BUDGET_PER_ADSET_EGP));
      const tooSmall = perAdsetBudgets.filter((b) => b < MIN_BUDGET_PER_ADSET_EGP);
      if (tooSmall.length > 0) {
        throw new Error(
          `الميزانية صغيرة جداً — الحد الأدنى لكل مجموعة إعلانية هو ${MIN_BUDGET_PER_ADSET_EGP} EGP/يوم حسب متطلبات Meta. ` +
          `يُنصح باستخدام ${MIN_BUDGET_PER_ADSET_EGP * rawAdsets.length} EGP أو أكثر للحملة الحالية (${rawAdsets.length} مجموعة).`,
        );
      }
      // CBO: use daily_budget arg directly on campaign | ABO: no campaign budget
      const cboBudget = isCBO
        ? egpToCents(Number(args?.daily_budget ?? perAdsetBudgets[0] ?? 100))
        : null;
      const campArgs: Record<string, unknown> = {
        account_id: accountId,
        name: campaignName,
        objective: campObjective,
        status: "PAUSED",
        special_ad_categories: [],
      };
      if (cboBudget !== null) campArgs.daily_budget = cboBudget;
      const campResult = await client.callTool({
        name: "create_campaign",
        arguments: campArgs,
      });
      const campText = mcpText(campResult);
      logger.info({ campText }, "launch_pipeboard_campaign: create_campaign");
      const campIdMatch =
        campText.match(/"id"\s*:\s*"(\d+)"/) ?? campText.match(/\b(\d{10,})\b/);
      campaignId = campIdMatch?.[1] ?? "";
      if (!campaignId) {
        const sub = campText.match(/"error_subcode"\s*:\s*(\d+)/)?.[1];
        const userMsg = campText.match(/"error_user_msg"\s*:\s*"([^"]+)"/)?.[1]
          ?? campText.match(/"error_user_title"\s*:\s*"([^"]+)"/)?.[1];
        if (sub === "2446375" || campText.includes("Budget Is Too Small") || campText.includes("budget is too sma")) {
          throw new Error(
            `الميزانية صغيرة جداً — الحد الأدنى لإنشاء الحملة هو ${MIN_BUDGET_PER_ADSET_EGP} EGP/يوم لكل مجموعة إعلانية. ` +
            `المطلوب لهذه الحملة على الأقل: ${MIN_BUDGET_PER_ADSET_EGP * rawAdsets.length} EGP/يوم. ` +
            `رسالة Meta: ${userMsg ?? campText.slice(0, 200)}`,
          );
        }
        throw new Error(`فشل إنشاء الحملة — ${userMsg ?? campText.slice(0, 300)}`);
      }

      // ── Step 2: Get page_id — domain map first, then auto-fetch ──────────
      const PAGE_ID_MAP: Record<string, string> = {
        "dealme-eg.com":   "108193615487446",
        "dealoop.net":     "108193615487446",
        "alsouqalhor.com": "108193615487446",
        "buzzpick.net":    "878997831971062",
      };
      let pageId = String(args?.page_id ?? "").trim();
      if (!pageId) {
        const landingUrl = String(args?.landing_page_url ?? "");
        for (const [domain, pid] of Object.entries(PAGE_ID_MAP)) {
          if (landingUrl.includes(domain)) { pageId = pid; break; }
        }
      }
      // Pages are managed from personal account (not Business Manager) —
      // get_account_pages (promote_pages) always returns empty for this setup.
      // Use domain map as source of truth; fall back to default page.
      if (!pageId) {
        pageId = _lpcLandingUrl.includes("buzzpick.net")
          ? "878997831971062"
          : "108193615487446"; // dealme-eg / dealoop / alsouqalhor default
        logger.info({ pageId, landing: _lpcLandingUrl }, "launch_pipeboard_campaign: page_id fallback from default map");
      }

      // ── Step 2b: Expand any Google Drive FOLDER URLs into individual file creatives ─
      // Strategy: fetch each unique folder ONCE (cached by folderId), then pair
      // each video with the original creative at the SAME INDEX (position-based).
      // This ensures N folder-creatives × M videos → M adsets, each creative
      // matched by position: video[i] → original_creative[i % N].
      {
        const googleApiKey = process.env.GOOGLE_API_KEY;

        // 1. Fetch each unique folder once
        type DriveFile = { id: string; mimeType: string; name: string };
        const folderCache = new Map<string, DriveFile[]>();

        for (const creative of rawCreatives) {
          const rawUrl = creative.media_url?.trim() ?? "";
          const folderMatch = rawUrl.match(/\/folders\/([a-zA-Z0-9-_]+)/);
          if (!folderMatch) continue;
          const folderId = folderMatch[1]!;
          if (folderCache.has(folderId)) continue;

          logger.info({ folderId }, "launch_pipeboard_campaign: detected Google Drive folder, expanding...");
          if (!googleApiKey) {
            throw new Error(
              "GOOGLE_API_KEY مفقود في متغيرات البيئة — لا يمكن استخراج ملفات مجلد Drive بدونه",
            );
          }
          const apiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,mimeType,name)&key=${googleApiKey}`;
          const driveResp = await fetch(apiUrl, { signal: AbortSignal.timeout(30_000) });
          if (!driveResp.ok) {
            const hint = driveResp.status === 404
              ? ` — تأكد أن المجلد مشارك بـ "أي شخص لديه الرابط" (Share → Anyone with the link → Viewer)`
              : driveResp.status === 403
              ? ` — الوصول مرفوض؛ غيّر صلاحية المجلد إلى "أي شخص لديه الرابط" في إعدادات المشاركة`
              : "";
            throw new Error(
              `فشل استعلام Google Drive API للمجلد "${folderId}": ${driveResp.status} ${driveResp.statusText}${hint}`,
            );
          }
          const driveData = (await driveResp.json()) as { files?: DriveFile[] };
          const validFiles = (driveData.files ?? []).filter(
            (f) => f.mimeType.startsWith("video/") || f.mimeType.startsWith("image/"),
          );
          if (validFiles.length === 0) {
            throw new Error(
              `مجلد Google Drive "${folderId}" فارغ أو لا يحتوي على فيديوهات أو صور صالحة`,
            );
          }
          logger.info({ folderId, count: validFiles.length }, "launch_pipeboard_campaign: folder expanded");
          folderCache.set(folderId, validFiles);
        }

        // 2. If any folder was found, rebuild rawCreatives with position-based pairing
        if (folderCache.size > 0) {
          // Separate direct creatives from folder creatives (per folder)
          const directCreatives: (CreativeInput & { _origIdx: number })[] = [];
          const folderCreativesMap = new Map<string, (CreativeInput & { _origIdx: number })[]>();

          for (let i = 0; i < rawCreatives.length; i++) {
            const c = rawCreatives[i]!;
            const rawUrl = c.media_url?.trim() ?? "";
            const folderMatch = rawUrl.match(/\/folders\/([a-zA-Z0-9-_]+)/);
            if (!folderMatch) {
              directCreatives.push({ ...c, _origIdx: i });
            } else {
              const folderId = folderMatch[1]!;
              if (!folderCreativesMap.has(folderId)) folderCreativesMap.set(folderId, []);
              folderCreativesMap.get(folderId)!.push({ ...c, _origIdx: i });
            }
          }

          // 3. New logic: each video = 1 Adset, each text = 1 Ad inside that Adset
          // Result: N videos → N Adsets, each Adset has M ads (one per text)
          // We encode this by creating N groups of M creatives
          // The adset creation loop below will create 1 adset per group
          const expanded: CreativeInput[] = [...directCreatives];
          const videoAdsetGroups: CreativeInput[][] = [];

          for (const [folderId, folderCreatives] of folderCreativesMap) {
            const files = folderCache.get(folderId) ?? [];
            for (let vi = 0; vi < files.length; vi++) {
              const file = files[vi]!;
              const directUrl = `https://drive.usercontent.google.com/download?id=${file.id}&export=download&authuser=0`;
              const mediaType = file.mimeType.startsWith("video/") ? "video" : "image";
              const fileNameNoExt = file.name.replace(/\.[^.]+$/, "").toLowerCase().trim();
              // Match video to angle by filename — if multiple adsets, find matching angle
              let matchedCreatives = folderCreatives;
              if (rawAdsets.length > 1) {
                const angleIdx = rawAdsets.findIndex(a => {
                  const n = a.name.toLowerCase().trim();
                  return n === fileNameNoExt || n.includes(fileNameNoExt) || fileNameNoExt.includes(n);
                });
                if (angleIdx >= 0) {
                  // Get only creatives for this angle (based on index)
                  const perAngle = Math.ceil(folderCreatives.length / rawAdsets.length);
                  const start = angleIdx * perAngle;
                  matchedCreatives = folderCreatives.slice(start, start + perAngle);
                  if (matchedCreatives.length === 0) matchedCreatives = folderCreatives;
                }
              }
              // One group per video — each group has M creatives (one per text)
              const group: CreativeInput[] = matchedCreatives.map(template => ({
                ...template,
                media_url: directUrl,
                media_type: mediaType,
                name: file.name.replace(/\.[^.]+$/, ""),
              }));
              videoAdsetGroups.push(group);
            }
          }

          // If we have video groups, rebuild rawAdsets and rawCreatives
          if (videoAdsetGroups.length > 0) {
            const baseAdset = rawAdsets[0] ?? { name: campaignName, budget: 100 };
            rawAdsets = videoAdsetGroups.map((group, i) => ({
              name: `${group[0]?.name ?? `فيديو ${i + 1}`}`,
              budget: baseAdset.budget,
            }));
            // rawCreatives will be handled per-adset below
            (rawAdsets as any)._videoGroups = videoAdsetGroups;
          } else {
            expanded.forEach(c => rawCreatives.push(c));
          }

          logger.info(
            { before: rawCreatives.length, after: expanded.length },
            "launch_pipeboard_campaign: folder expansion complete (position-paired)",
          );
          rawCreatives = expanded;
        }
      }

      // ── Step 3: Pre-upload all unique media URLs (dedup by normalised URL) ─
      interface MediaCacheEntry {
        imageHash?: string;
        videoId?: string;
        error?: string;
      }
      const mediaCache = new Map<string, MediaCacheEntry>();

      // Build upload list from both rawCreatives and videoGroups
      const videoGroups: CreativeInput[][] | undefined = (rawAdsets as any)._videoGroups;
      const allCreativesForUpload: CreativeInput[] = videoGroups
        ? videoGroups.flat()
        : rawCreatives;
      for (let ci = 0; ci < allCreativesForUpload.length; ci++) {
        const creative = allCreativesForUpload[ci]!;
        const rawUrl = creative.media_url?.trim() ?? "";
        const mediaUrl = normaliseMediaUrl(rawUrl);
        if (mediaCache.has(mediaUrl)) continue;

        if (!mediaUrl) {
          mediaCache.set(mediaUrl, { error: "لم يُزوَّد رابط الميديا" });
          continue;
        }
        if (!pageId) {
          mediaCache.set(mediaUrl, {
            error: "يحتاج page_id لرفع الميديا — تأكد من توفير page_id",
          });
          continue;
        }

        if (rawUrl !== mediaUrl) {
          logger.info(
            { rawUrl, mediaUrl },
            `launch_pipeboard_campaign: normalised Google Drive URL [creative ${ci}]`,
          );
        }

        const isVid = isVideoType(mediaUrl, creative.media_type ?? "");

        if (isVid) {
          try {
            const vidResult = await client.callTool(
              {
                name: "upload_ad_video",
                arguments: {
                  account_id: accountId,
                  video_url: mediaUrl,
                  name: `${campaignName}-v${ci}`,
                },
              },
              undefined,
              { timeout: UPLOAD_TIMEOUT_MS },
            );
            const vidText = mcpText(vidResult);
            logger.info(
              { vidText: vidText.slice(0, 300) },
              `launch_pipeboard_campaign: upload_ad_video [${ci}]`,
            );
            const vidMatch =
              vidText.match(/"(?:video_id|id)"\s*:\s*"(\d+)"/) ??
              vidText.match(/\b(\d{10,})\b/);
            const videoId = vidMatch?.[1] ?? "";
            mediaCache.set(
              mediaUrl,
              videoId
                ? { videoId }
                : { error: `رفع الفيديو فشل — ${vidText.slice(0, 200)}` },
            );
          } catch (e) {
            mediaCache.set(mediaUrl, {
              error: `رفع الفيديو: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        } else {
          try {
            const imgResult = await client.callTool(
              {
                name: "upload_ad_image",
                arguments: {
                  account_id: accountId,
                  image_url: mediaUrl,
                  name: `${campaignName}-i${ci}`,
                },
              },
              undefined,
              { timeout: UPLOAD_TIMEOUT_MS },
            );
            const imgText = mcpText(imgResult);
            logger.info(
              { imgText: imgText.slice(0, 300) },
              `launch_pipeboard_campaign: upload_ad_image [${ci}]`,
            );
            const hashMatch = imgText.match(/"hash"\s*:\s*"([^"]+)"/);
            const imageHash = hashMatch?.[1] ?? "";
            mediaCache.set(
              mediaUrl,
              imageHash
                ? { imageHash }
                : {
                    error: `رفع الصورة فشل — تأكد أن الرابط مباشر ومتاح. ${imgText.slice(0, 150)}`,
                  },
            );
          } catch (e) {
            mediaCache.set(mediaUrl, {
              error: `رفع الصورة: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }
      }

      // ── Step 4: Adsets + ads (NO dynamic creative, NO asset_feed_spec) ────────
      // Rules:
      //   • 1 adset in blueprint → ALL rawCreatives go into that ONE adset
      //     N videos × M texts = N×M separate ads in the SAME adset (no split by video)
      //   • N adsets in blueprint → each adset paired to its position-matched creative
      // NO is_dynamic_creative — NO asset_feed_spec — each ad = 1 video + 1 text + 1 headline
      effectiveAdsets = rawAdsets as AdsetInput[];

      let totalAdsExpected = 0;
      for (let ai = 0; ai < effectiveAdsets.length; ai++) {
        const adset = effectiveAdsets[ai]!;

        // ── Determine which creatives belong to this adset ────────────────
        // Single-adset mode: ALL creatives → one adset (N videos × M texts = N×M ads)
        // Multi-adset mode: each adset matched to its position-paired creative
        const adsetCreatives: CreativeInput[] =
          videoGroups ? (videoGroups[ai] ?? []) : effectiveAdsets.length === 1
            ? rawCreatives
            : (() => {
                const angleName = adset.name.toLowerCase().trim();
                const matched =
                  rawCreatives.find((c) => {
                    const url = (c.media_url ?? "").toLowerCase();
                    const filename =
                      url.split("/").pop()?.split("?")[0]?.split("#")[0] ?? "";
                    const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
                    return (
                      nameWithoutExt === angleName ||
                      nameWithoutExt.includes(angleName) ||
                      angleName.includes(nameWithoutExt)
                    );
                  }) ??
                  rawCreatives[ai] ??
                  rawCreatives[0];
                return matched ? [matched] : [];
              })();

        if (adsetCreatives.length === 0) {
          adResults.push({
            adset_name: adset.name,
            creative_index: 0,
            error: "لم يُعثر على creative مطابق لهذه الزاوية",
          });
          continue;
        }

        totalAdsExpected += adsetCreatives.reduce(
          (sum, c) =>
            sum +
            (Array.isArray(c.texts) && c.texts.length > 0 ? c.texts.length : 1),
          0,
        );

        // ── Create ONE AdSet for this angle ───────────────────────────────
        let adsetId = "";
        let adsetErr = "";
        const adsetName = adset.name;

        try {
          // CBO: budget on campaign only | ABO: budget on each adset
          const adsetBudgetCents = !isCBO ? egpToCents(perAdsetBudgets[ai] ?? 100) : null;
          const adsetArgs: Record<string, unknown> = {
            account_id: accountId,
            campaign_id: campaignId,
            name: adsetName,
            optimization_goal: optimizationGoal,
            billing_event: "IMPRESSIONS",
            status: "PAUSED",
            targeting: { geo_locations: { countries: ["EG"] } },
            targeting_automation: { advantage_audience: 1 },
            attribution_spec: [
              { event_type: "CLICK_THROUGH", window_days: 7 },
              { event_type: "VIEW_THROUGH", window_days: 1 },
            ],
          };
          if (adsetBudgetCents !== null) adsetArgs.daily_budget = adsetBudgetCents;
          if (hasPixel) {
            adsetArgs.promoted_object = {
              pixel_id: pixelId,
              custom_event_type: "PURCHASE",
            };
          }
          const adsetResult = await client.callTool({
            name: "create_adset",
            arguments: adsetArgs,
          });
          const adsetText = mcpText(adsetResult);
          logger.info(
            { adsetText },
            `launch_pipeboard_campaign: create_adset "${adsetName}"`,
          );
          const adsetIdMatch =
            adsetText.match(/"id"\s*:\s*"(\d+)"/) ??
            adsetText.match(/(\d{10,})/);
          adsetId = adsetIdMatch?.[1] ?? "";
          if (!adsetId)
            adsetErr = `فشل إنشاء AdSet "${adsetName}" — ${adsetText.slice(0, 200)}`;
        } catch (e) {
          adsetErr = `فشل إنشاء AdSet "${adsetName}": ${e instanceof Error ? e.message : String(e)}`;
          logger.warn(
            { adsetErr },
            "launch_pipeboard_campaign: create_adset threw",
          );
        }

        if (!adsetId) {
          adResults.push({
            adset_name: adsetName,
            creative_index: 0,
            error: adsetErr,
          });
          continue;
        }

        // ── Create ads for ALL creatives assigned to this adset ──────────
        // Each creative: media_url, texts[], headlines[], optional link_url + name
        // Result: 1 ad per (creative × text) → N videos × M texts = N×M ads
        const lpcPbClient = await getPipeboardWriteClient();

        for (let ci = 0; ci < adsetCreatives.length; ci++) {
          const matchingCreative = adsetCreatives[ci]!;

          // Resolve media from upload cache
          const rawUrl = matchingCreative.media_url?.trim() ?? "";
          const mediaUrl = normaliseMediaUrl(rawUrl);
          const media = mediaCache.get(mediaUrl);

          if (!media || media.error) {
            adResults.push({
              adset_name: adsetName,
              adset_id: adsetId,
              creative_index: ci,
              error: media?.error ?? "رابط الميديا مفقود",
            });
            continue;
          }

          const isVid = isVideoType(mediaUrl, matchingCreative.media_type ?? "");
          const hasMedia = isVid
            ? Boolean(media.videoId)
            : Boolean(media.imageHash);
          if (!hasMedia) {
            adResults.push({
              adset_name: adsetName,
              adset_id: adsetId,
              creative_index: ci,
              error: "الميديا لم تُرفع بنجاح",
            });
            continue;
          }

          const texts =
            Array.isArray(matchingCreative.texts) &&
            matchingCreative.texts.length > 0
              ? (matchingCreative.texts as string[])
              : [""];
          const headlines =
            Array.isArray(matchingCreative.headlines) &&
            matchingCreative.headlines.length > 0
              ? (matchingCreative.headlines as string[])
              : [""];
          const firstHeadline = headlines[0]!;

          // Per-creative landing page overrides global landing_page_url
          const creativeLinkUrl =
// @ts-ignore
            String(
              // @ts-ignore
              (matchingCreative as Record<string, unknown>).link_url ?? "",
            ).trim() || landingPageUrl;

          // Per-creative name (e.g. "Instant Lift") used for ad/creative naming
          const creativeName =
// @ts-ignore
            String(
              // @ts-ignore
              (matchingCreative as Record<string, unknown>).name ?? "",
            ).trim() ||
            (adsetCreatives.length > 1
              ? `${adsetName} — فيديو ${ci + 1}`
              : adsetName);

          // Create one ad per text variant
          for (let ti = 0; ti < texts.length; ti++) {
            const singleText = texts[ti]!;
            let creativeId = "";
            let adIdFromSpec = "";
            try {
              // Step 1: Build flat Pipeboard creative args (no object_story_spec)
              const lpcCreativeArgs: Record<string, unknown> = {
                account_id: `act_${accountId}`,
                name: `${creativeName} — نص ${ti + 1} — creative ${Date.now().toString(36)}`,
                page_id: pageId,
                link_url: creativeLinkUrl,
                message: singleText,
                ...(firstHeadline ? { headline: firstHeadline } : {}),
                call_to_action_type: callToAction || "SHOP_NOW",
              };
              if (isVid) {
                lpcCreativeArgs.video_id = media.videoId;
              } else {
                lpcCreativeArgs.image_hash = media.imageHash;
              }

              // Step 2: create_ad_creative via Pipeboard MCP
              logger.info(
                { adset: adsetName, ci: ci + 1, ti: ti + 1, isVid },
                "launch_pipeboard_campaign: → Pipeboard create_ad_creative",
              );
              const lpcCreativeResult = await lpcPbClient.callTool(
                { name: "create_ad_creative", arguments: lpcCreativeArgs },
                undefined,
                { timeout: 60_000 },
              );
              const lpcCreativeText = (
                (lpcCreativeResult as {
                  content?: Array<{ type: string; text?: string }>;
                })?.content ?? []
              )
                .filter((c) => c.type === "text")
                .map((c) => (c as { text?: string }).text ?? "")
                .join("")
                .trim();
              logger.info(
                { lpcCreativeText: lpcCreativeText.slice(0, 400) },
                "launch_pipeboard_campaign: ← Pipeboard create_ad_creative",
              );

              const lpcCreativeIdMatch =
                lpcCreativeText.match(/"id"\s*:\s*"(\d{10,})"/) ??
                lpcCreativeText.match(/\b(\d{10,})\b/);
              creativeId = lpcCreativeIdMatch?.[1] ?? "";
              if (!creativeId) {
                adResults.push({
                  adset_name: adsetName,
                  adset_id: adsetId,
                  creative_index: ci * 100 + ti,
                  error: `فشل إنشاء Creative — ${lpcCreativeText.slice(0, 300)}`,
                });
                continue;
              }

              // Step 3: create_ad via Pipeboard MCP
              logger.info(
                { adset: adsetName, ci: ci + 1, ti: ti + 1, creativeId },
                "launch_pipeboard_campaign: → Pipeboard create_ad",
              );
              const lpcAdResult = await lpcPbClient.callTool(
                {
                  name: "create_ad",
                  arguments: {
                    account_id: `act_${accountId}`,
                    name: `${creativeName} — نص ${ti + 1}`,
                    adset_id: adsetId,
                    creative_id: creativeId,
                    status: "PAUSED",
                  },
                },
                undefined,
                { timeout: 30_000 },
              );
              const lpcAdText = (
                (lpcAdResult as {
                  content?: Array<{ type: string; text?: string }>;
                })?.content ?? []
              )
                .filter((c) => c.type === "text")
                .map((c) => (c as { text?: string }).text ?? "")
                .join("")
                .trim();
              logger.info(
                { lpcAdText: lpcAdText.slice(0, 400) },
                "launch_pipeboard_campaign: ← Pipeboard create_ad",
              );

              const lpcAdIdMatch =
                lpcAdText.match(/"id"\s*:\s*"(\d+)"/) ??
                lpcAdText.match(/\b(\d{10,})\b/);
              adIdFromSpec = lpcAdIdMatch?.[1] ?? "";
              if (!adIdFromSpec) {
                adResults.push({
                  adset_name: adsetName,
                  adset_id: adsetId,
                  creative_index: ci * 100 + ti,
                  creative_id: creativeId,
                  error: `فشل إنشاء Ad — ${lpcAdText.slice(0, 300)}`,
                });
                continue;
              }
              adResults.push({
                adset_name: adsetName,
                adset_id: adsetId,
                creative_index: ci * 100 + ti,
                creative_id: creativeId,
                ad_id: adIdFromSpec,
              });
            } catch (e) {
              adResults.push({
                adset_name: adsetName,
                adset_id: adsetId,
                creative_index: ci * 100 + ti,
                error: `Pipeboard MCP: ${e instanceof Error ? e.message : String(e)}`,
              });
            }
          }
        }
      }
      // ── Build summary ─────────────────────────────────────────────────────
      const adsCreated = adResults.filter((r) => r.ad_id).length;
      const adsFailed = adResults.filter((r) => !r.ad_id).length;
      const failedDetails = adResults
        .filter((r) => !r.ad_id)
        .map(
          (r) =>
            `• [${r.adset_name}] creative ${r.creative_index + 1}: ${r.error ?? "سبب غير معروف"}`,
        )
        .join("\n");

      pipeSuccess = true;
      pipeMsg = [
        `campaign_id:${campaignId}`,
        `ads_created:${adsCreated}/${totalAdsExpected}`,
        adsFailed > 0
          ? `\n⚠️ إعلانات فشلت (${adsFailed}):\n${failedDetails}`
          : "",
        `\n🔴 STOP IMMEDIATELY — الحملة كاملة 100% — لا تستدعِ create_adset أو create_ad أو publish_winners أو أي tool آخر — كل الـ adsets والإعلانات أُنشئت بالفعل داخل launch_pipeboard_campaign`,
      ]
        .filter(Boolean)
        .join(" ");
    } catch (err) {
      pipeMsg = err instanceof Error ? err.message : String(err);
      _pbWriteClient = null;
      _pbWriteConnecting = null;
    } finally {
      await query(
        `INSERT INTO pipeboard_actions
           (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          executedBy,
          tool,
          JSON.stringify(args ?? {}),
          pipeSuccess,
          pipeMsg,
          String(args?.campaign_name ?? ""),
          null,
          false,
        ],
      ).catch((e: unknown) =>
        logger.warn({ e }, "pipeboard audit insert failed"),
      );
    }

    if (pipeSuccess) {
      const adsCreated = adResults.filter((r) => r.ad_id).length;
      res.json({
        success: true,
        message: pipeMsg,
        launchData: {
          campaign_id: campaignId,
          objective: campObjective,
          has_pixel: hasPixel,
          adsets_count: effectiveAdsets.length,
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
    const { mcpTool: ccMcpTool, mcpArgs: ccMcpArgs } = translateToMcp(
      "create_campaign",
      args ?? {},
    );

    let ccSuccess = false;
    let ccMsg = "";
    let ccCampaignId = "";
    let ccData: Record<string, unknown> = {};

    try {
      const client = await getPipeboardWriteClient();
      const result = await client.callTool({
        name: ccMcpTool,
        arguments: ccMcpArgs,
      });
      const textContent = (
        (result as { content?: Array<{ type: string; text?: string }> })
          .content ?? []
      )
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
        .trim();

      logger.info(
        { textContent: textContent.slice(0, 300) },
        "create_campaign: MCP response",
      );

      // Extract campaign_id — fail hard if not found
      const idMatch =
        textContent.match(/"id"\s*:\s*"(\d+)"/) ??
        textContent.match(/\b(\d{13,})\b/);
      ccCampaignId = idMatch?.[1] ?? "";
      if (!ccCampaignId) {
        // Try to extract real Meta error
        const errMatch =
          textContent.match(/"message"\s*:\s*"([^"]+)"/) ??
          textContent.match(/"error"\s*:\s*"([^"]+)"/);
        const codeMatch = textContent.match(/"code"\s*:\s*(\d+)/);
        const subMatch = textContent.match(/"error_subcode"\s*:\s*(\d+)/);
        const userMsgMatch = textContent.match(/"error_user_msg"\s*:\s*"([^"]+)"/);
        const userTitleMatch = textContent.match(/"error_user_title"\s*:\s*"([^"]+)"/);
        const errMsg = errMatch?.[1] ?? textContent.slice(0, 400);
        const code = codeMatch?.[1] ? Number(codeMatch[1]) : undefined;
        const sub = subMatch?.[1] ? Number(subMatch[1]) : undefined;
        const userFacing = userMsgMatch?.[1] ?? userTitleMatch?.[1];

        // Budget too small — give actionable Arabic message
        if (sub === 2446375 || textContent.includes("Budget Is Too Small") || textContent.includes("budget is too sma")) {
          throw new Error(
            `الميزانية صغيرة جداً — الحد الأدنى للـ daily_budget هو 100 EGP/يوم لكل مجموعة إعلانية حسب متطلبات Meta. ` +
            `أعِد الإنشاء مع daily_budget لا يقل عن 30 EGP. ` +
            (userFacing ? `رسالة Meta: ${userFacing}` : ""),
          );
        }

        const detail = [
          code ? `code: ${code}` : null,
          sub ? `error_subcode: ${sub}` : null,
          `message: ${userFacing ?? errMsg}`,
        ]
          .filter(Boolean)
          .join(" | ");
        throw new Error(`فشل إنشاء الحملة — ${detail}`);
      }

      // ── Verify with Meta Graph API directly ──────────────────────────────
      const token = process.env.META_ACCESS_TOKEN;
      if (token) {
        try {
          const verifyUrl = new URL(
            `https://graph.facebook.com/v21.0/${ccCampaignId}`,
          );
          verifyUrl.searchParams.set(
            "fields",
            "id,name,status,effective_status,updated_time",
          );
          verifyUrl.searchParams.set("access_token", token);
          const vResp = await fetch(verifyUrl.toString(), {
            signal: AbortSignal.timeout(15_000),
          });
          const vJson = (await vResp.json()) as Record<string, unknown>;
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
          logger.warn(
            { verifyErr },
            "create_campaign: Meta verify fetch threw (non-fatal)",
          );
        }
      }

      if (!ccData.campaign_id) {
        ccData = { campaign_id: ccCampaignId };
      }

      ccSuccess = true;
      ccMsg = [
        `✅ تم إنشاء الحملة "${String(args?.name ?? "")}"`,
        `CAMPAIGN_ID: ${ccCampaignId}`,
        `⚠️ استخدم CAMPAIGN_ID=${ccCampaignId} بالضبط في خطوة create_adset التالية — لا تستخدم أي ID آخر.`,
        `الحالة: ${String(ccData.effective_status ?? ccData.status ?? "PAUSED")}`,
      ].join("\n");
    } catch (err) {
      ccMsg = err instanceof Error ? err.message : String(err);
      _pbWriteClient = null;
      _pbWriteConnecting = null;
    }

    await query(
      `INSERT INTO pipeboard_actions
         (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        executedBy,
        tool,
        JSON.stringify(args ?? {}),
        ccSuccess,
        ccMsg,
        String(args?.name ?? ""),
        null,
        false,
      ],
    ).catch((e: unknown) =>
      logger.warn({ e }, "pipeboard audit insert failed"),
    );

    if (ccSuccess) {
      res.json({
        success: true,
        message: ccMsg,
        ...ccData,
        account_id: rawAccId,
      });
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
      "buzzpick.net": "1405391498274239",
      "dealme-eg.com": "1537301040808359",
    };

    let effectiveArgs: Record<string, unknown> = { ...(args ?? {}) };
    // Strip commas from any IDs the AI may have formatted with thousand-separators
    if (effectiveArgs.campaign_id != null)
      effectiveArgs.campaign_id = String(effectiveArgs.campaign_id).replace(/,/g, "").trim();
    if (effectiveArgs.account_id != null)
      effectiveArgs.account_id = String(effectiveArgs.account_id).replace(/,/g, "").trim();
    const metaTokenSales = process.env.META_ACCESS_TOKEN;
    const salesCampaignId = String(effectiveArgs.campaign_id ?? "");

    if (metaTokenSales && salesCampaignId) {
      // ── PHASE 1: MANDATORY guards (fatal — must throw and propagate) ──────────
      // These run OUTSIDE any non-fatal catch so they cannot be silently swallowed.
      let campObjJson: Record<string, unknown> = {};
      let campFetchOk = false;
      try {
        const campObjUrl = new URL(
          `https://graph.facebook.com/v21.0/${salesCampaignId}`,
        );
        // NOTE: do NOT include "campaign_id" in fields — Meta throws (#100) for campaign objects
        // (campaign_id is an adset-only field; campaigns don't have it).
        // Instead we detect adsets by the absence of "objective" (campaigns always have it).
        campObjUrl.searchParams.set(
          "fields",
          "id,objective,name,daily_budget,lifetime_budget,account_id",
        );
        campObjUrl.searchParams.set("access_token", metaTokenSales);
        const campObjResp = await fetch(campObjUrl.toString(), {
          signal: AbortSignal.timeout(8_000),
        });
        campObjJson = (await campObjResp.json()) as Record<string, unknown>;
        campFetchOk = true;
      } catch (fetchErr) {
        // Network-only failure — non-fatal, skip guards and enhancements
        logger.warn(
          { fetchErr },
          "create_adset: campaign pre-fetch network error (non-fatal) — proceeding without guard checks",
        );
      }

      if (campFetchOk) {
        // ── GUARDS 1–3: return 400 JSON directly (NOT throw) ───────────────
        // create_adset handling is OUTSIDE the outer Pipeboard try/catch, so
        // any throw here becomes an unhandled async exception → Express returns
        // HTML → frontend r.json() fails → "خطأ في الاتصال". Use res.status(400)
        // with return to give the frontend a parseable JSON error.

        // ── GUARD 1: campaign must exist in Meta ────────────────────────────
        if (campObjJson.error != null) {
          const metaErr = campObjJson.error as Record<string, unknown>;
          const errCode = Number(metaErr.code ?? 0);
          // Error 190 = expired/invalid token — this is NOT a "wrong campaign_id" error.
          // Skip the guard and let Pipeboard handle it (Pipeboard has its own token).
          // Only block on genuine "campaign not found / no access" errors (codes 100, 200, 273, 803).
          const isTokenError = errCode === 190 ||
            String(metaErr.message ?? "").toLowerCase().includes("session has expired") ||
            String(metaErr.message ?? "").toLowerCase().includes("access token");
          if (!isTokenError) {
            res.status(400).json({
              error:
                `Pre-call Guard: campaign_id="${salesCampaignId}" غير موجود في Meta أو لا يمكن الوصول إليه. ` +
                `(Meta: ${String(metaErr.message ?? JSON.stringify(campObjJson.error))}). ` +
                `استخدم campaign_id الصحيح الذي أعادته create_campaign للتو.`,
            });
            return;
          }
          // Token expired — skip remaining guards, proceed to Pipeboard which has valid auth
          logger.warn({ errCode, salesCampaignId }, "Pre-call Guard: token expired — skipping guard, proceeding via Pipeboard");
          campFetchOk = false; // treat as network failure so GUARD 2 & 3 are also skipped
        }

        // ── GUARD 2: passed ID must be a campaign, not an adset ────────────
        // campFetchOk re-checked: it may have been set to false in GUARD 1 (token error),
        // in which case campObjJson contains an error response (no objective field) —
        // skip this guard so we don't falsely report "adset_id passed instead of campaign_id".
        if (campFetchOk && !campObjJson.objective) {
          res.status(400).json({
            error:
              `Pre-call ID Guard: campaign_id="${salesCampaignId}" يبدو أنه adset_id وليس campaign_id ` +
              `(الـ entity المُسترجع من Meta لا يحتوي على حقل objective — الحملات فقط تمتلكه). ` +
              `من فضلك أرسل الـ campaign_id الصحيح الذي أعادته create_campaign.`,
          });
          return;
        }

        // ── GUARD 3: campaign must belong to the requested account ─────────
        const campAccId = String(campObjJson.account_id ?? "").replace(/^act_/, "");
        const reqAccId  = String(effectiveArgs.account_id ?? "").replace(/^act_/, "");
        if (campFetchOk && campAccId && reqAccId && campAccId !== reqAccId) {
          res.status(400).json({
            error:
              `Pre-call Account Guard: campaign_id="${salesCampaignId}" ينتمي للحساب act_${campAccId} ` +
              `وليس للحساب act_${reqAccId} المرسَل في الطلب. ` +
              `استخدم campaign_id الصحيح الذي أعادته create_campaign للتو.`,
          });
          return;
        }

        // ── PHASE 2: OPTIONAL enhancements (non-fatal — failures silently skipped) ─
      } // closes if (campFetchOk)
      try {
        let campForEnhance: Record<string, unknown> = campFetchOk ? campObjJson : {};

        // ── Pipeboard CBO Fallback: when Meta token expired, fetch campaign via Pipeboard ──
        // campFetchOk is false when Meta returned Error 190 (token expired).
        // Without this fallback, campForEnhance = {} → campHasBudget = false → adset daily_budget
        // is passed to Pipeboard → Pipeboard correctly rejects with "Budget conflict (CBO)".
        // Fix: use Pipeboard write client to get campaign details and detect CBO budget.
        if (!campFetchOk && salesCampaignId && (effectiveArgs.daily_budget != null || effectiveArgs.lifetime_budget != null)) {
          try {
            const pbCBOClient = await getPipeboardWriteClient();
            const pbCBORes = await pbCBOClient.callTool({
              name: "get_campaign_details",
              arguments: { campaign_id: salesCampaignId },
            });
            const pbCBOText = (
              (pbCBORes as { content?: Array<{ type: string; text?: string }> }).content ?? []
            )
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("")
              .trim();
            try {
              const pbCBOParsed = JSON.parse(pbCBOText) as unknown;
              if (
                pbCBOParsed &&
                typeof pbCBOParsed === "object" &&
                !Array.isArray(pbCBOParsed)
              ) {
                campForEnhance = pbCBOParsed as Record<string, unknown>;
                logger.info(
                  {
                    salesCampaignId,
                    pb_daily_budget: campForEnhance.daily_budget,
                    pb_objective: campForEnhance.objective,
                  },
                  "create_adset: Pipeboard CBO fallback succeeded — campForEnhance populated",
                );
              }
            } catch {
              /* Pipeboard response not JSON — campForEnhance stays {} */
            }
          } catch (pbCBOErr) {
            logger.warn(
              { pbCBOErr },
              "create_adset: Pipeboard CBO fallback fetch failed — proceeding without budget strip",
            );
          }
        }

        const objective = String(campForEnhance.objective ?? "").toUpperCase();

        // ── CBO Budget Fix ────────────────────────────────────────────────
        const campHasBudget =
          (campForEnhance.daily_budget != null &&
            String(campForEnhance.daily_budget) !== "0") ||
          (campForEnhance.lifetime_budget != null &&
            String(campForEnhance.lifetime_budget) !== "0");

        if (campHasBudget) {
          const strippedBudget =
            effectiveArgs.daily_budget ?? effectiveArgs.lifetime_budget;
          if (
            effectiveArgs.daily_budget != null ||
            effectiveArgs.lifetime_budget != null
          ) {
            delete effectiveArgs.daily_budget;
            delete effectiveArgs.lifetime_budget;
            logger.info(
              {
                salesCampaignId,
                campaign_daily_budget: campForEnhance.daily_budget,
                stripped_adset_budget: strippedBudget,
              },
              "create_adset: CBO campaign detected — stripped adset daily_budget/lifetime_budget to prevent Budget Conflict",
            );
          } else {
            logger.info(
              { salesCampaignId },
              "create_adset: CBO campaign detected — no adset budget to strip",
            );
          }
        }

        const isSales =
          objective.includes("SALES") || objective === "OUTCOME_SALES";
        if (isSales) {
          logger.info(
            { objective, salesCampaignId },
            "create_adset: SALES campaign detected — enforcing promoted_object",
          );

          // Ensure optimization_goal + billing_event for SALES
          effectiveArgs.optimization_goal = "OFFSITE_CONVERSIONS";
          effectiveArgs.billing_event = "IMPRESSIONS";

          const existingPO = effectiveArgs.promoted_object as
            | Record<string, unknown>
            | undefined;
          if (!existingPO?.pixel_id) {
            // ── Keyword-first pixel detection (case-insensitive) ─────────────────
            // Matches brand keywords (buzzpick / dealme) ANYWHERE in the args —
            // campaign name, landing_page_url, adset name, etc. — so pixel is
            // auto-injected even when no full domain URL is present.
            const pixelKeywordMap: Record<string, string> = {
              buzzpick: "1405391498274239",
              dealme: "1537301040808359",
            };
            const argsStrLower = JSON.stringify(effectiveArgs).toLowerCase();
            let detectedPixelId: string | null = null;
            // 1st pass: keyword match (e.g. campaign name "Buzzpick Q2")
            for (const [kw, pixelId] of Object.entries(pixelKeywordMap)) {
              if (argsStrLower.includes(kw)) {
                detectedPixelId = pixelId;
                break;
              }
            }
            // 2nd pass: full domain match as fallback (original pixelDomainMap)
            if (!detectedPixelId) {
              for (const [domain, pixelId] of Object.entries(pixelDomainMap)) {
                if (argsStrLower.includes(domain)) {
                  detectedPixelId = pixelId;
                  break;
                }
              }
            }

            if (detectedPixelId) {
              effectiveArgs.promoted_object = {
                pixel_id: detectedPixelId,
                custom_event_type: "PURCHASE",
              };
              logger.info(
                { detectedPixelId, objective },
                "create_adset: auto-injected promoted_object from domain/keyword map",
              );
            } else {
              // No keyword/domain hint — will fail at Meta. Log clearly.
              logger.warn(
                { objective, argsStrLower: argsStrLower.slice(0, 200) },
                "create_adset: SALES campaign but no brand keyword or domain found — promoted_object not injected; " +
                  "pass promoted_object explicitly or include landing_page_url / campaign name containing buzzpick or dealme",
              );
            }
          } else {
            logger.info(
              { pixelId: existingPO.pixel_id },
              "create_adset: promoted_object already present — using it",
            );
          }
        }
      } catch (objErr) {
        logger.warn(
          { objErr },
          "create_adset: campaign objective pre-fetch failed (non-fatal) — proceeding without injection",
        );
      }
    }

    // ── AUTO-TARGETING FALLBACK + ADVANTAGE+ AUDIENCE (always runs) ──────────
    // Runs unconditionally — even when META_ACCESS_TOKEN is absent — so that
    // the Pipeboard MCP call always includes geo_locations (Meta rejects without it).
    {
      const DEFAULT_TARGETING = {
        geo_locations: { countries: ["EG"], location_types: ["home"] },
      };
      const tgt = effectiveArgs.targeting as Record<string, unknown> | undefined;
      if (!tgt) {
        effectiveArgs.targeting = DEFAULT_TARGETING;
      } else if (!tgt.geo_locations) {
        tgt.geo_locations = { countries: ["EG"], location_types: ["home"] };
      }
      if (!effectiveArgs.advantage_plus_audience) {
        effectiveArgs.advantage_plus_audience = 1;
      }
      if (!effectiveArgs.targeting_automation) {
        effectiveArgs.targeting_automation = { advantage_audience: 1 };
      }
      if (!effectiveArgs.bid_strategy) {
        effectiveArgs.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
      }
      logger.info(
        { had_geo: !!(effectiveArgs.targeting as Record<string, unknown> | undefined)?.geo_locations },
        "create_adset: targeting merged (unconditional) — Advantage+ Audience + EG geo ensured",
      );
    }

    // NOTE: is_dynamic_creative is NOT injected here.
    // create_ad_from_creative_spec now uses object_story_spec format (not asset_feed_spec),
    // so Meta does NOT require is_dynamic_creative=true on the adset — true STANDARD campaigns.

    const { mcpTool: asMcpTool, mcpArgs: asMcpArgs } = translateToMcp(
      "create_adset",
      effectiveArgs,
    );
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
      logger.info(
        {
          pipeboard_tool: asMcpTool,
          pipeboard_args: asMcpArgs, // full body sent to Pipeboard MCP
        },
        "create_adset: → Pipeboard request",
      );

      const result = await client.callTool({
        name: asMcpTool,
        arguments: asMcpArgs,
      });

      // ── Log full raw Pipeboard response ───────────────────────────────────
      const rawResult = result as {
        content?: Array<{ type: string; text?: string }>;
      };
      logger.info(
        {
          pipeboard_raw_content: rawResult.content, // full array, not truncated
        },
        "create_adset: ← Pipeboard raw response",
      );

      const textContent = (rawResult.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
        .trim();

      logger.info({ textContent }, "create_adset: MCP textContent (full)");

      // ── Try JSON parse first — Pipeboard may return structured JSON ───────
      let parsedJson: Record<string, unknown> | null = null;
      try {
        const maybeJson = JSON.parse(textContent) as unknown;
        if (
          maybeJson &&
          typeof maybeJson === "object" &&
          !Array.isArray(maybeJson)
        ) {
          parsedJson = maybeJson as Record<string, unknown>;
          logger.info(
            { parsedJson },
            "create_adset: textContent parsed as JSON",
          );
        }
      } catch {
        /* not JSON — will fall back to regex */
      }

      // ── Detect Pipeboard-level error responses BEFORE extracting IDs ──────────
      // Shape: { "data": "<json string with 'error' field>" } — budget conflict etc.
      // Shape: { "error": "..." }                              — top-level server error
      // If we don't detect this early, the regex below will match the campaign_id
      // from inside the error text and incorrectly treat it as the new adset_id.
      if (parsedJson) {
        let pipeboardLevelError: string | null = null;
        let pipeboardDetails: string | null = null;
        let pipeboardFix: string | null = null;

        if (typeof parsedJson.error === "string" && parsedJson.error.length > 0) {
          pipeboardLevelError = parsedJson.error;
        } else if (typeof parsedJson.data === "string" && parsedJson.data.length > 10) {
          try {
            const innerRaw = JSON.parse(parsedJson.data) as unknown;
            if (innerRaw && typeof innerRaw === "object" && !Array.isArray(innerRaw)) {
              const inner = innerRaw as Record<string, unknown>;
              if (typeof inner.error === "string" && inner.error.length > 0) {
                pipeboardLevelError = inner.error;
                pipeboardDetails = typeof inner.details === "string" ? inner.details : null;
                pipeboardFix = typeof inner.fix === "string" ? inner.fix : null;
              }
            }
          } catch { /* data is not JSON — fall through to ID extraction */ }
        }

        if (pipeboardLevelError) {
          logger.warn(
            { pipeboardLevelError, pipeboardFix, salesCampaignId },
            "create_adset: Pipeboard returned error response — returning 400 without ID extraction",
          );
          const msg = [
            `❌ Pipeboard رفض إنشاء المجموعة الإعلانية: ${pipeboardLevelError}`,
            pipeboardDetails ? `📋 التفاصيل: ${pipeboardDetails}` : null,
            pipeboardFix ? `💡 الحل: ${pipeboardFix}` : null,
          ].filter(Boolean).join("\n");
          return res.status(400).json({
            success: false,
            error: pipeboardLevelError,
            message: msg,
            details: pipeboardDetails,
            fix: pipeboardFix,
          });
        }
      }

      // ── Dynamic ID mapping — handle all known Pipeboard response shapes ─────
      // Shape A: { "id": "123" }                    (root-level id)
      // Shape B: { "data": { "id": "123" } }        (nested under data)
      // Shape C: { "adset_id": "123" }              (alternative key)
      // Shape D: { "adset": { "id": "123" } }       (nested under adset)
      // Shape E: plain text with a 13+ digit number (regex fallback)
      const nestedData =
        parsedJson?.data != null && typeof parsedJson.data === "object"
          ? (parsedJson.data as Record<string, unknown>)
          : null;
      const nestedAdset =
        parsedJson?.adset != null && typeof parsedJson.adset === "object"
          ? (parsedJson.adset as Record<string, unknown>)
          : null;

      const jsonId =
        parsedJson?.id != null
          ? String(parsedJson.id) // Shape A
          : nestedData?.id != null
            ? String(nestedData.id) // Shape B
            : parsedJson?.adset_id != null
              ? String(parsedJson.adset_id) // Shape C
              : nestedAdset?.id != null
                ? String(nestedAdset.id) // Shape D
                : null;

      const idMatch =
        textContent.match(/"id"\s*:\s*"(\d+)"/) ??
        textContent.match(/\b(\d{13,})\b/);
      asAdsetId = jsonId ?? idMatch?.[1] ?? "";

      logger.info(
        {
          asAdsetId,
          jsonId,
          regexMatch: idMatch?.[1],
          shape_detected:
            parsedJson?.id != null
              ? "A-root-id"
              : nestedData?.id != null
                ? "B-data.id"
                : parsedJson?.adset_id != null
                  ? "C-adset_id"
                  : nestedAdset?.id != null
                    ? "D-adset.id"
                    : idMatch != null
                      ? "E-regex"
                      : "UNKNOWN",
        },
        "create_adset: extracted adset_id (dynamic mapping)",
      );

      if (!asAdsetId) {
        // No id found in any known shape — include the full raw response in the
        // error so the AI can surface it directly to the user for manual diagnosis.
        const rawDump = parsedJson
          ? JSON.stringify(parsedJson, null, 2)
          : textContent.slice(0, 800);

        logger.error(
          { rawDump, textContent },
          "create_adset: ID mapping failure — no id found in Pipeboard response",
        );

        // Extract real Meta error details from Pipeboard text
        const codeMatch = textContent.match(/"code"\s*:\s*(\d+)/);
        const subMatch = textContent.match(/"error_subcode"\s*:\s*(\d+)/);
        const msgMatch =
          textContent.match(/"message"\s*:\s*"([^"]+)"/) ??
          textContent.match(/"error"\s*:\s*"([^"]+)"/);
        const titleMatch = textContent.match(
          /"error_user_title"\s*:\s*"([^"]+)"/,
        );
        const userMsgMatch = textContent.match(
          /"error_user_msg"\s*:\s*"([^"]+)"/,
        );
        const traceMatch = textContent.match(/"fbtrace_id"\s*:\s*"([^"]+)"/);

        asError = {
          code: codeMatch?.[1] ? Number(codeMatch[1]) : undefined,
          message: msgMatch?.[1] ?? textContent.slice(0, 400),
          error_subcode: subMatch?.[1] ? Number(subMatch[1]) : undefined,
          error_user_title: titleMatch?.[1] ?? undefined,
          error_user_msg: userMsgMatch?.[1] ?? undefined,
          fbtrace_id: traceMatch?.[1] ?? undefined,
          raw_pipeboard_response: rawDump, // included so AI can surface it to user
        };

        // Build the error message — put error_user_msg FIRST so the AI/user
        // sees the human-readable Meta rejection reason immediately.
        const userFacingMsg = asError.error_user_msg
          ? String(asError.error_user_msg)
          : asError.error_user_title
            ? String(asError.error_user_title)
            : null;

        const detail = [
          userFacingMsg ? `META_REASON: ${userFacingMsg}` : null,
          asError.code ? `code: ${asError.code}` : null,
          asError.error_subcode
            ? `error_subcode: ${asError.error_subcode}`
            : null,
          asError.fbtrace_id ? `fbtrace_id: ${asError.fbtrace_id}` : null,
          `message: ${String(asError.message ?? textContent.slice(0, 300))}`,
          rawDump ? `RAW_RESPONSE: ${rawDump}` : null,
        ]
          .filter(Boolean)
          .join(" | ");

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
            `RAW_RESPONSE: ${rawDumpForId}`,
        );
      }

      // ── Hard verify: adset MUST appear in /{campaign_id}/adsets ─────────────
      // Success = adset found by name in campaign's adset list.
      // Failure = not found → throw (caught below → 500).
      // If token is missing → skip verification (adset was already created by Pipeboard).
      const token = process.env.META_ACCESS_TOKEN;
      if (!token) {
        logger.warn(
          { asAdsetId },
          "create_adset: META_ACCESS_TOKEN missing — skipping hard verify, trusting Pipeboard id",
        );
        const _adsetName = String(args?.name ?? "");
        asData = {
          adset_id: asAdsetId,
          name: _adsetName,
          campaign_id: String(args?.campaign_id ?? ""),
          status: "PAUSED",
          effective_status: "PAUSED",
        };
        asMsg = [
          `✅ تم إنشاء المجموعة الإعلانية "${_adsetName}" عبر Pipeboard`,
          `adset_id: ${asAdsetId}`,
          `campaign_id: ${String(args?.campaign_id ?? "")}`,
          `الحالة: PAUSED`,
        ].join(" — ");
        res.json({ success: true, message: asMsg, adset_id: asAdsetId, ...asData, verified: true, verify_attempted: false });
        return;
      }

      const expectedCampaignId = String(args?.campaign_id ?? "");
      const expectedName = String(args?.name ?? "");

      // Step 1: GET /{candidateId}?fields=id,name,campaign_id
      // Confirm the id Pipeboard returned is actually an adset (not a campaign).
      logger.info(
        { asAdsetId, expectedCampaignId },
        "create_adset: step1 — GET /{id}?fields=id,name,campaign_id",
      );
      const step1Url = new URL(`https://graph.facebook.com/v21.0/${asAdsetId}`);
      step1Url.searchParams.set(
        "fields",
        "id,name,campaign_id,status,effective_status,daily_budget,created_time,updated_time",
      );
      step1Url.searchParams.set("access_token", token);
      const step1Resp = await fetch(step1Url.toString(), {
        signal: AbortSignal.timeout(12_000),
      });
      const step1Json = (await step1Resp.json()) as Record<string, unknown>;

      if (step1Json.error) {
        // Step1 GET returned a Meta error.
        const ve =
          typeof step1Json.error === "object" && step1Json.error !== null
            ? (step1Json.error as Record<string, unknown>)
            : {};
        const veCode = Number(ve.code ?? 0);
        const veMsg = String(ve.message ?? JSON.stringify(step1Json.error));
        // Error 190 = expired/invalid token — NOT a "bad adset id" error.
        // Skip verification and trust Pipeboard's returned id.
        const isTokenErr190 = veCode === 190 ||
          veMsg.toLowerCase().includes("session has expired") ||
          veMsg.toLowerCase().includes("access token");
        if (isTokenErr190) {
          logger.warn({ asAdsetId, veCode }, "create_adset hard-verify: token expired — skipping step1/step2, trusting Pipeboard id");
          const _adsetName190 = String(args?.name ?? "");
          asData = {
            adset_id: asAdsetId,
            name: _adsetName190,
            campaign_id: String(args?.campaign_id ?? ""),
            status: "PAUSED",
            effective_status: "PAUSED",
          };
          asMsg = [
            `✅ تم إنشاء المجموعة الإعلانية "${_adsetName190}" عبر Pipeboard`,
            `adset_id: ${asAdsetId}`,
            `campaign_id: ${String(args?.campaign_id ?? "")}`,
            `الحالة: PAUSED`,
          ].join(" — ");
          res.json({ success: true, message: asMsg, adset_id: asAdsetId, ...asData, verified: true, verify_attempted: false });
          return;
        }
        // Genuine bad id error — throw as before
        const veCodeStr = ve.code != null ? ` (code: ${ve.code})` : "";
        throw new Error(
          `التحقق المباشر من الـ id فشل — Meta رفضت GET /${asAdsetId}${veCodeStr}: ${veMsg}. ` +
            `الـ id المُعاد من Pipeboard غير صالح — AdSet لم يُنشأ فعلياً.`,
        );
      } else {
        const step1CampaignId = String(step1Json.campaign_id ?? "");
        if (step1CampaignId && step1CampaignId !== expectedCampaignId) {
          // The id Pipeboard returned belongs to a DIFFERENT campaign — hard failure.
          throw new Error(
            `Integrity Error: الـ id المُعاد (${asAdsetId}) ينتمي لحملة ${step1CampaignId} ` +
              `وليس للحملة المطلوبة ${expectedCampaignId}. Pipeboard أعاد id خاطئ — AdSet لم يُنشأ في الحملة الصحيحة.`,
          );
        }
        logger.info(
          { asAdsetId, step1CampaignId },
          "create_adset: step1 OK — id is a valid adset in correct campaign",
        );
      }

      // Step 2: GET /{campaign_id}/adsets?fields=id,name,... — authoritative check
      // Find by name → get the REAL adset_id. Fail hard if not found.
      logger.info(
        { expectedCampaignId, expectedName },
        "create_adset: step2 — GET /{campaign_id}/adsets",
      );
      const step2Url = new URL(
        `https://graph.facebook.com/v21.0/${expectedCampaignId}/adsets`,
      );
      step2Url.searchParams.set(
        "fields",
        "id,name,status,effective_status,daily_budget,created_time,updated_time",
      );
      step2Url.searchParams.set("limit", "200");
      step2Url.searchParams.set("access_token", token);
      const step2Resp = await fetch(step2Url.toString(), {
        signal: AbortSignal.timeout(15_000),
      });
      const step2Json = (await step2Resp.json()) as {
        data?: Array<Record<string, unknown>>;
        error?: unknown;
      };

      if (step2Json.error) {
        const ve =
          typeof step2Json.error === "object" && step2Json.error !== null
            ? (step2Json.error as Record<string, unknown>)
            : {};
        const ve2Code = Number(ve.code ?? 0);
        const ve2Msg = String(ve.message ?? JSON.stringify(ve));
        // Error 190 = expired token — skip step2 verification, trust step1 id
        const isTokenErr2 = ve2Code === 190 ||
          ve2Msg.toLowerCase().includes("session has expired") ||
          ve2Msg.toLowerCase().includes("access token");
        if (isTokenErr2) {
          logger.warn({ asAdsetId, ve2Code }, "create_adset hard-verify step2: token expired — skipping, trusting step1 id");
          const _adsetName2 = String(args?.name ?? "");
          asData = {
            adset_id: asAdsetId,
            name: _adsetName2,
            campaign_id: String(args?.campaign_id ?? ""),
            status: "PAUSED",
            effective_status: "PAUSED",
          };
          asMsg = [
            `✅ تم إنشاء المجموعة الإعلانية "${_adsetName2}" عبر Pipeboard`,
            `adset_id: ${asAdsetId}`,
            `campaign_id: ${String(args?.campaign_id ?? "")}`,
            `الحالة: PAUSED`,
          ].join(" — ");
          res.json({ success: true, message: asMsg, adset_id: asAdsetId, ...asData, verified: true, verify_attempted: false });
          return;
        }
        throw new Error(
          `التحقق من قائمة المجموعات فشل — ${ve2Msg}`,
        );
      }

      const allAdsets = step2Json.data ?? [];
      logger.info(
        { count: allAdsets.length, expectedName },
        "create_adset: step2 adsets returned",
      );

      // Match by exact name
      const matched = allAdsets.find(
        (a) => String(a.name ?? "") === expectedName,
      );
      if (!matched) {
        const names = allAdsets.map((a) => String(a.name ?? "")).slice(0, 10);
        throw new Error(
          `لم يظهر الـ adset "${expectedName}" في قائمة الحملة ${expectedCampaignId} — فشل التحقق. ` +
            `الأسماء الموجودة (أول 10): ${JSON.stringify(names)}`,
        );
      }

      // Use confirmed data from Meta
      const confirmedId = String(matched.id ?? asAdsetId);
      const rawBudget =
        matched.daily_budget != null
          ? Number(matched.daily_budget) / 100
          : null;
      asAdsetId = confirmedId;
      asData = {
        adset_id: confirmedId,
        name: String(matched.name ?? expectedName),
        campaign_id: expectedCampaignId,
        account_id: rawAccId,
        optimization_goal: String(args?.optimization_goal ?? ""),
        billing_event: String(args?.billing_event ?? ""),
        daily_budget:
          rawBudget ??
          (args?.daily_budget != null ? Number(args.daily_budget) : undefined),
        status:
          matched.status != null
            ? String(matched.status)
            : String(args?.status ?? "PAUSED"),
        effective_status:
          matched.effective_status != null
            ? String(matched.effective_status)
            : String(args?.status ?? "PAUSED"),
        created_time:
          matched.created_time != null
            ? String(matched.created_time)
            : undefined,
        updated_time:
          matched.updated_time != null
            ? String(matched.updated_time)
            : undefined,
      };
      asVerifyOk = true;
      logger.info(
        { confirmedId, expectedName },
        "create_adset: step2 matched — adset confirmed",
      );

      asSuccess = true;
      asMsg = [
        `تم إنشاء المجموعة الإعلانية "${String(asData.name ?? args?.name ?? "")}"`,
        `adset_id: ${asAdsetId}`,
        `campaign_id: ${String(asData.campaign_id ?? args?.campaign_id ?? "?")}`,
        asData.effective_status
          ? `الحالة: ${String(asData.effective_status)}`
          : null,
        asData.daily_budget
          ? `الميزانية: ${Number(asData.daily_budget).toFixed(0)} EGP/يوم`
          : null,
        asVerifyOk
          ? "✅ مُتحقَّق من Meta"
          : "⚠️ تم الإنشاء (verify لم يكتمل — الـ id مؤكد من Pipeboard)",
      ]
        .filter(Boolean)
        .join(" — ");
    } catch (err) {
      asMsg = err instanceof Error ? err.message : String(err);
      _pbWriteClient = null;
      _pbWriteConnecting = null;
    }

    await query(
      `INSERT INTO pipeboard_actions
         (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        executedBy,
        tool,
        JSON.stringify(args ?? {}),
        asSuccess,
        asMsg,
        String(args?.campaign_id ?? ""),
        String(args?.name ?? ""),
        false,
      ],
    ).catch((e: unknown) =>
      logger.warn({ e }, "pipeboard audit insert failed (create_adset)"),
    );

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

  // ── upload_video_to_meta — standalone Drive→Meta video upload ───────────────
  // Uploads a video from a Google Drive folder (by filename hint) or direct URL
  // to Meta and returns the numeric video_id. Used by STANDARD campaign flow
  // so the AI can call create_ad_from_creative_spec without launch_pipeboard_campaign.
  if (tool === "upload_video_to_meta") {
    const driveFolderUrl  = String(args?.drive_folder_url ?? "").trim();
    const filenameHint    = String(args?.filename_hint   ?? "").trim().toLowerCase();
    const listOnly        = args?.list_only === true || args?.list_only === "true";
    const rawAccId_uv     = String(args?.account_id      ?? "").replace(/,/g, "").trim();
    const accountId_uv    = rawAccId_uv.startsWith("act_") ? rawAccId_uv.slice(4) : rawAccId_uv;

    if (!driveFolderUrl) {
      res.status(400).json({ error: "upload_video_to_meta: drive_folder_url مطلوب" });
      return;
    }
    if (!listOnly && !accountId_uv) {
      res.status(400).json({ error: "upload_video_to_meta: account_id مطلوب" });
      return;
    }

    try {
      // ── Helper: normalise a Drive file URL to download link ────────────────
      function normDriveUrl(raw: string): string {
        const fileMatch = raw.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
        if (fileMatch) return `https://drive.usercontent.google.com/download?id=${fileMatch[1]}&export=download&authuser=0`;
        const idMatch = raw.match(/drive\.google\.com\/(?:open|uc)[^?]*\?(?:[^#]*&)?id=([^&#]+)/);
        if (idMatch) return `https://drive.usercontent.google.com/download?id=${idMatch[1]}&export=download&authuser=0`;
        if (raw.includes("drive.usercontent.google.com")) return raw;
        return raw;
      }

      let uploadUrl = "";
      let resolvedFilename = "";

      const folderMatch = driveFolderUrl.match(/\/folders\/([a-zA-Z0-9-_]+)/);
      if (folderMatch) {
        // ── It's a folder URL — list files and find by filename_hint ─────────
        const googleApiKey = process.env.GOOGLE_API_KEY;
        if (!googleApiKey) throw new Error("GOOGLE_API_KEY مفقود — لا يمكن استعراض مجلد Drive");

        const folderId = folderMatch[1]!;
        const apiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,mimeType,name)&key=${googleApiKey}`;
        const driveResp = await fetch(apiUrl, { signal: AbortSignal.timeout(30_000) });
        if (!driveResp.ok) {
          const hint = driveResp.status === 404
            ? " — تأكد أن المجلد مشارك بـ \"أي شخص لديه الرابط\" (Share → Anyone with the link → Viewer)"
            : driveResp.status === 403
            ? " — الوصول مرفوض؛ غيّر صلاحية المجلد إلى \"أي شخص لديه الرابط\""
            : "";
          throw new Error(`فشل Google Drive API للمجلد "${folderId}": ${driveResp.status} ${driveResp.statusText}${hint}`);
        }
        const driveData = (await driveResp.json()) as { files?: Array<{ id: string; mimeType: string; name: string }> };
        const videoFiles = (driveData.files ?? []).filter(f => f.mimeType.startsWith("video/"));

        logger.info({ folderId, count: videoFiles.length, filenameHint, listOnly }, "upload_video_to_meta: Drive folder listed");

        if (videoFiles.length === 0) throw new Error(`مجلد Drive "${folderId}" لا يحتوي على فيديوهات`);

        // ── list_only mode: return all video filenames without uploading ────────
        if (listOnly) {
          const filenames = videoFiles.map(f => f.name.replace(/\.[^.]+$/, ""));
          res.json({
            success: true,
            mode: "list_only",
            count: videoFiles.length,
            filenames,
            message: `وُجد ${videoFiles.length} فيديو في المجلد: ${filenames.join(", ")} — استدعِ upload_video_to_meta مرة لكل فيديو باستخدام filename_hint المناسب`,
          });
          return;
        }

        // Match by filename hint (strip extension for comparison)
        let matched = filenameHint
          ? videoFiles.find(f => {
              const nameNoExt = f.name.replace(/\.[^.]+$/, "").toLowerCase();
              return nameNoExt === filenameHint || nameNoExt.includes(filenameHint) || filenameHint.includes(nameNoExt);
            })
          : undefined;

        // Fallback: first video
        if (!matched) matched = videoFiles[0]!;

        resolvedFilename = matched.name;
        uploadUrl = `https://drive.usercontent.google.com/download?id=${matched.id}&export=download&authuser=0`;
        logger.info({ resolvedFilename, uploadUrl }, "upload_video_to_meta: file resolved");
      } else {
        // ── Direct file URL (Drive file or other direct URL) ─────────────────
        uploadUrl = normDriveUrl(driveFolderUrl);
        resolvedFilename = filenameHint || "video";
      }

      // ── Upload via Pipeboard upload_ad_video ──────────────────────────────
      const client = await getPipeboardWriteClient();
      const vidResult = await client.callTool(
        {
          name: "upload_ad_video",
          arguments: {
            account_id: accountId_uv,
            video_url: uploadUrl,
            name: resolvedFilename || `video_${Date.now()}`,
          },
        },
        undefined,
        { timeout: 120_000 },
      );

      const vidText = (
        (vidResult.content as Array<{ type: string; text?: string }>)
          ?.filter(c => c.type === "text")
          .map(c => c.text ?? "")
          .join("") ?? ""
      ).trim();

      logger.info({ vidText: vidText.slice(0, 300), resolvedFilename }, "upload_video_to_meta: upload_ad_video response");

      const vidMatch = vidText.match(/"(?:video_id|id)"\s*:\s*"(\d+)"/) ?? vidText.match(/\b(\d{10,})\b/);
      const videoId = vidMatch?.[1] ?? "";

      if (!videoId) throw new Error(`رفع الفيديو فشل — الاستجابة: ${vidText.slice(0, 300)}`);

      await query(
        `INSERT INTO pipeboard_actions (executed_by, tool_name, args, success, result_message, campaign_name, adset_name, is_no_op)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [executedBy, tool, JSON.stringify(args ?? {}), true,
         `video_id: ${videoId} — ${resolvedFilename}`, "", "", false],
      ).catch((e: unknown) => logger.warn({ e }, "pipeboard audit insert failed (upload_video_to_meta)"));

      res.json({
        success: true,
        video_id: videoId,
        filename: resolvedFilename,
        upload_url: uploadUrl,
        message: `✅ تم رفع الفيديو "${resolvedFilename}" — video_id: ${videoId}`,
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "upload_video_to_meta: failed");
      res.status(500).json({ error: `فشل رفع الفيديو: ${msg}` });
      return;
    }
  }

  // ── Read-only Pipeboard tools — pass args directly, return raw content ────
  const READ_TOOLS = new Set([
    "get_adsets",
    "get_ads",
    "get_ads_in_adset",
    "get_campaign_details",
    "get_ad_details",
    "get_ad_creative",
    "search_adsets",
    "search_ads",
  ]);
  if (READ_TOOLS.has(tool)) {
    try {
      const client = await getPipeboardWriteClient();
      const result = await client.callTool({ name: tool, arguments: args ?? {} });
      const data = (result.content as Array<{ type: string; text?: string }>)
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n")
        .trim();
      res.json({ success: true, data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
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
    const client = isGaTool
      ? await getGoogleAdsWriteClient()
      : await getPipeboardWriteClient();
    const result = await client.callTool({ name: mcpTool, arguments: mcpArgs });

    const textContent = (
      result.content as Array<{ type: string; text?: string }>
    )
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();

    success = true;
    // Pipeboard sometimes returns raw JSON (e.g. {"success":true}) — detect and discard it
    // so the frontend falls back to the human-readable pendingAction.summary.
    const looksLikeJson =
      textContent.trimStart().startsWith("{") ||
      textContent.trimStart().startsWith("[");
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

    if (
      CAMPAIGN_WRITE_TOOLS.has(tool) &&
      typeof args?.campaign_id === "string" &&
      args.campaign_id
    ) {
      await query(
        `DELETE FROM meta_campaign_details_cache WHERE campaign_id = $1`,
        [args.campaign_id],
      ).catch(() => null);
    } else if (
      ADSET_WRITE_TOOLS.has(tool) &&
      typeof args?.adset_id === "string" &&
      args.adset_id
    ) {
      await query(`DELETE FROM meta_adset_details_cache WHERE adset_id = $1`, [
        args.adset_id,
      ]).catch(() => null);
    }
    // pause_ad / enable_ad: no local cache to invalidate (ad details are fetched live)

    // Extract IDs from result for frontend state updates
    const extractedId = textContent?.match(/"id"\s*:\s*"(\d{10,})"/)?.[1] ?? "";
    const extraData: Record<string, string> = {};
    if (tool === "create_adset" && extractedId)
      extraData.adset_id = extractedId;
    if (tool === "create_campaign" && extractedId)
      extraData.campaign_id = extractedId;
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
      typeof args?.campaign_name === "string"
        ? args.campaign_name
        : typeof args?.name === "string"
          ? args.name
          : null;
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
      ],
    ).catch((err: unknown) => {
      logger.warn(
        { err, tool, executedBy },
        "Failed to insert pipeboard audit row",
      );
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
      [days - 1],
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
      [lookback],
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
      [days],
    );
    res.json({ actions: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /pipeboard/list-tools — قائمة tools Pipeboard MCP (للـ debugging) ──
router.get("/pipeboard/list-tools", async (_req: Request, res: Response) => {
  try {
    const client = await getPipeboardWriteClient();
    const result = await client.listTools();
    res.json({ tools: result.tools.map(t => ({ name: t.name, description: (t.description ?? "").slice(0, 120) })) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /pipeboard/campaigns — جلب الحملات مع ABO/CBO flag ─────────────────
router.get("/pipeboard/campaigns", async (req: Request, res: Response) => {
  try {
    const client = await getPipeboardWriteClient();
    const accountId = String(req.query.account_id ?? "").replace(/^act_/, "");
    if (!accountId) { res.status(400).json({ error: "account_id مطلوب" }); return; }

    const result = await client.callTool({
      name: "get_campaigns",
      arguments: {
        account_id: accountId,
        fields:
          "id,name,status,effective_status,daily_budget,campaign_budget_optimization,objective",
        limit: 100,
      },
    });

    const text = (
      (result as { content?: Array<{ type: string; text?: string }> })
        ?.content ?? []
    )
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("")
      .trim();

    let campaigns: unknown[] = [];
    try {
      const parsed = JSON.parse(text);
      campaigns = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
    } catch {
      const matches = [
        ...text.matchAll(/"id"\s*:\s*"(\d+)"[^}]*"name"\s*:\s*"([^"]+)"/g),
      ];
      campaigns = matches.map((m) => ({ id: m[1], name: m[2] }));
    }

    // إضافة is_cbo لكل حملة
    campaigns = (campaigns as Record<string, unknown>[]).map((c) => ({
      ...c,
      is_cbo: !!(c.daily_budget && String(c.daily_budget).length > 0) || c.campaign_budget_optimization === true || c.campaign_budget_optimization === "CAMPAIGN_BUDGET_OPTIMIZATION",
    }));
    res.json({ campaigns });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /pipeboard/campaigns/:id/adsets — جلب AdSets مع أرقام الأداء ────────
router.get(
  "/pipeboard/campaigns/:id/adsets",
  async (req: Request, res: Response) => {
    try {
      const client = await getPipeboardWriteClient();
      const accountId = String(req.query.account_id ?? "").replace(/^act_/, "");
      const campaignId = String(req.params.id ?? "");
      if (!accountId || !campaignId) {
        res.status(400).json({ error: "account_id و campaign_id مطلوبان" });
        return;
      }

      // جلب الـ AdSets
      let adsetsResult;
      try {
        adsetsResult = await client.callTool({
          name: "get_adsets",
          arguments: {
            account_id: accountId,
            campaign_id: campaignId,
            fields: "id,name,status,effective_status,daily_budget,campaign_budget_optimization",
            limit: 50,
          },
        });
      } catch (e) {
        res.status(500).json({ error: `get_adsets فشل: ${String(e)}` });
        return;
      }

      const adsetsText = (
        (adsetsResult as { content?: Array<{ type: string; text?: string }> })
          ?.content ?? []
      )
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("")
        .trim();

      let adsets: Record<string, unknown>[] = [];
      try {
        const parsed = JSON.parse(adsetsText);
        adsets = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
      } catch {
        adsets = [];
      }

      // جلب الـ insights مباشرة من Meta API بالـ campaign_id (أدق وأضمن من Pipeboard get_insights)
      let insights: Record<string, unknown>[] = [];
      try {
        const metaToken = "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg";
        const insUrl = `https://graph.facebook.com/v21.0/${campaignId}/insights?` +
          `level=adset&fields=adset_id%2Cspend%2Cimpressions%2Cclicks%2Cactions` +
          `&date_preset=last_7d&limit=200&access_token=${encodeURIComponent(metaToken)}`;
        const insRes = await fetch(insUrl);
        const insJson = await insRes.json() as { data?: Record<string, unknown>[] };
        insights = insJson.data ?? [];
        logger.info({ campaign_id: campaignId, count: insights.length }, "adset insights fetched");
      } catch (e) {
        logger.warn({ err: String(e) }, "adset insights fetch failed");
      }

      // دمج الـ insights مع الـ AdSets
      const insightsArr = Array.isArray(insights) ? insights : [];
      const insightsMap = new Map(insightsArr.map((i) => [String(i.adset_id), i]));
      // جلب الـ Ads مع الـ creative (نصوص وعناوين)
      const adsMap = new Map<string, { texts: string[]; headlines: string[]; videoId?: string }>();
      try {
        const adsResult = await client.callTool({
          name: "get_ads",
          arguments: {
            account_id: accountId,
            campaign_id: campaignId,
            fields: "id,adset_id,creative{id,body,title,video_id}",
            limit: 100,
          },
        });
        const adsText = (
          (adsResult as { content?: Array<{ type: string; text?: string }> })?.content ?? []
        ).filter((c: { type: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("").trim();
        const adsParsed = JSON.parse(adsText);
        const adsArr: Record<string, unknown>[] = Array.isArray(adsParsed) ? adsParsed : (adsParsed?.data ?? []);
        for (const ad of adsArr) {
          const adsetId = String(ad.adset_id ?? "");
          const creative = ad.creative as Record<string, unknown> ?? {};
          const existing = adsMap.get(adsetId) ?? { texts: [], headlines: [], videoId: undefined };
          if (creative.body && !existing.texts.includes(String(creative.body))) existing.texts.push(String(creative.body));
          if (creative.title && !existing.headlines.includes(String(creative.title))) existing.headlines.push(String(creative.title));
          if (creative.video_id) existing.videoId = String(creative.video_id);
          adsMap.set(adsetId, existing);
        }
      } catch { /* ignore */ }

      const enriched = adsets.map((a) => {
        const ins = insightsMap.get(String(a.id)) ?? {} as Record<string, unknown>;
        const spend = Number(ins.spend ?? 0);
        const clicks = Number(ins.clicks ?? 0);
        const impressions = Number(ins.impressions ?? 0);
        const actions = Array.isArray(ins.actions) ? ins.actions as Array<{action_type: string; value: string}> : [];
        const purchases = actions.find(x => x.action_type === "offsite_conversion.fb_pixel_purchase")?.value;
        const cpa = purchases && spend ? (spend / Number(purchases)).toFixed(2) : null;
        const ctr = impressions ? ((clicks / impressions) * 100).toFixed(2) : null;
        return {
          ...a,
          insights: ins,
          spend: spend || null,
          ctr,
          cpa,
          hookRate: null,
          texts: adsMap.get(String(a.id))?.texts ?? [],
          headlines: adsMap.get(String(a.id))?.headlines ?? [],
          videoId: adsMap.get(String(a.id))?.videoId ?? null,
        };
      });

      // هل الحملة CBO أم ABO؟
      const campaignResult = await client.callTool({
        name: "get_campaigns",
        arguments: {
          account_id: accountId,
          campaign_id: campaignId,
          fields: "id,campaign_budget_optimization",
        },
      });
      const campaignText = (
        (campaignResult as { content?: Array<{ type: string; text?: string }> })
          ?.content ?? []
      )
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("")
        .trim();
      const isCBO =
        campaignText.includes('"campaign_budget_optimization": true') ||
        campaignText.includes('"campaign_budget_optimization":true');

      res.json({ adsets: enriched, is_cbo: isCBO });
    } catch (err) {
      console.error("adsets endpoint error:", String(err));
      res.status(500).json({ error: String(err) });
    }
  },
);

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

    if (
      !rawAccountId ||
      !target_campaign_id ||
      !adset_name ||
      !video_id ||
      !landing_page_url
    ) {
      res.status(400).json({
        error:
          "account_id, target_campaign_id, adset_name, video_id, landing_page_url مطلوبة",
      });
      return;
    }

    const accountId = rawAccountId.replace(/^act_/, "");
    const accountIdWithAct = `act_${accountId}`;
    const hasPixel = Boolean(pixel_id);

    // Step 1: جلب الـ page_id
    let pageId = "";
    try {
      const pagesResult = await client.callTool({
        name: "get_account_pages",
        arguments: { account_id: accountId },
      });
      const pagesText = (
        (pagesResult as { content?: Array<{ type: string; text?: string }> })
          ?.content ?? []
      )
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("")
        .trim();
      const pageMatch =
        pagesText.match(/"id"\s*:\s*"(\d+)"/) ?? pagesText.match(/(\d{10,})/);
      pageId = pageMatch?.[1] ?? "";
    } catch {
      /* ignore */
    }

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
    if (!is_cbo && daily_budget)
      adsetArgs.daily_budget = Math.round(daily_budget * 100);
    if (hasPixel)
      adsetArgs.promoted_object = { pixel_id, custom_event_type: "PURCHASE" };

    const adsetResult = await client.callTool({
      name: "create_adset",
      arguments: adsetArgs,
    });
    const adsetText = (
      (adsetResult as { content?: Array<{ type: string; text?: string }> })
        ?.content ?? []
    )
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("")
      .trim();
    const adsetIdMatch =
      adsetText.match(/"id"\s*:\s*"(\d+)"/) ?? adsetText.match(/(\d{10,})/);
    const adsetId = adsetIdMatch?.[1] ?? "";
    if (!adsetId) {
      res.status(500).json({ error: `فشل إنشاء AdSet — ${adsetText.slice(0, 200)}` });
      return;
    }

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

    const creativeResult = await client.callTool({
      name: "create_ad_creative",
      arguments: creativeArgs,
    });
    const creativeText = (
      (creativeResult as { content?: Array<{ type: string; text?: string }> })
        ?.content ?? []
    )
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("")
      .trim();
    const creativeIdMatch =
      creativeText.match(/"id"\s*:\s*"(\d+)"/) ??
      creativeText.match(/(\d{10,})/);
    const creativeId = creativeIdMatch?.[1] ?? "";
    if (!creativeId) {
      res.status(500).json({ error: `فشل إنشاء Creative — ${creativeText.slice(0, 200)}` });
      return;
    }

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
    const adText = (
      (adResult as { content?: Array<{ type: string; text?: string }> })
        ?.content ?? []
    )
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("")
      .trim();
    const adIdMatch =
      adText.match(/"id"\s*:\s*"(\d+)"/) ?? adText.match(/(\d{10,})/);
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

// ── GET /api/pipeboard/campaigns/:id/ads — جلب الإعلانات مع Creative + Insights ─
router.get("/pipeboard/campaigns/:id/ads", async (req: Request, res: Response) => {
  try {
    const client = await getPipeboardWriteClient();
    const accountId = String(req.query.account_id ?? "").replace(/^act_/, "");
    const campaignId = String(req.params.id ?? "");
    if (!accountId || !campaignId) {
      res.status(400).json({ error: "account_id و campaign_id مطلوبان" }); return;
    }
    function mcpTxtCa(result: unknown): string {
      return ((result as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
        .filter((c: { type: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("").trim();
    }
    const adsResult = await client.callTool({
      name: "get_ads",
      arguments: { account_id: accountId, campaign_id: campaignId, fields: "id,name,adset_id,creative{id,body,title,video_id,image_hash,link_url,call_to_action{type}}", limit: 100 },
    });
    const text = mcpTxtCa(adsResult);
    let ads: Record<string, unknown>[] = [];
    try { const p = JSON.parse(text); ads = Array.isArray(p) ? p : (p?.data ?? []); } catch { ads = []; }
    // جلب الـ insights مباشرة من Meta API مع فلتر الـ campaign_id
    let insightsMap = new Map<string, Record<string, unknown>>();
    try {
      const metaToken = "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg";
      const insUrl = `https://graph.facebook.com/v21.0/${campaignId}/insights?` +
        `level=ad&fields=ad_id%2Cspend%2Cimpressions%2Cclicks%2Cactions` +
        `&date_preset=last_7d&limit=200&access_token=${encodeURIComponent(metaToken)}`;
      const insRes = await fetch(insUrl);
      const insJson = await insRes.json() as { data?: Record<string, unknown>[] };
      const insArr = insJson.data ?? [];
      insightsMap = new Map(insArr.map(i => [String(i.ad_id), i]));
    } catch { /* ignore */ }
    const metaTokenForCreative = "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg";
    const normalized = await Promise.all(ads.map(async ad => {
      let cr = (ad.creative as Record<string, unknown>) ?? {};
      // لو مفيش creative ID، نجيبه من الـ ad مباشرة من Meta
      if (!cr.id && ad.id) {
        try {
          const adUrl = `https://graph.facebook.com/v21.0/${ad.id}?fields=creative{id,body,title,video_id,image_hash,link_url,call_to_action}&access_token=${encodeURIComponent(metaTokenForCreative)}`;
          const adRes = await fetch(adUrl);
          const adJson = await adRes.json() as Record<string, unknown>;
          if (!adJson.error && adJson.creative) cr = adJson.creative as Record<string, unknown>;
        } catch { /* ignore */ }
      }
      // لو مفيش video_id أو image_hash، نجيب Creative details من Meta مباشرة
      if (!cr.video_id && !cr.image_hash && cr.id) {
        try {
          const crUrl = `https://graph.facebook.com/v21.0/${cr.id}?fields=id,body,title,video_id,image_hash,link_url,call_to_action&access_token=${encodeURIComponent(metaTokenForCreative)}`;
          const crRes = await fetch(crUrl);
          const crJson = await crRes.json() as Record<string, unknown>;
          if (!crJson.error) cr = { ...cr, ...crJson };
        } catch { /* ignore */ }
      }
      const ins = insightsMap.get(String(ad.id)) ?? {} as Record<string, unknown>;
      const spendRaw = Number(ins.spend ?? 0);
      const spend = spendRaw > 0 ? spendRaw : null;
      const clicks = Number(ins.clicks ?? 0);
      const impressions = Number(ins.impressions ?? 0);
      const actions = Array.isArray(ins.actions) ? ins.actions as Array<{ action_type: string; value: string }> : [];
      const purchasesVal = actions.find(x => x.action_type === "offsite_conversion.fb_pixel_purchase")?.value;
      const purchases = purchasesVal ? Number(purchasesVal) : null;
      const cpa = purchases && spend ? Number((spend / purchases).toFixed(2)) : null;
      const ctr = impressions ? Number(((clicks / impressions) * 100).toFixed(2)) : null;
      return {
        id: ad.id, name: ad.name, adset_id: ad.adset_id,
        video_id: cr.video_id ?? null, image_hash: cr.image_hash ?? null,
        body: cr.body ?? null, title: cr.title ?? null, link_url: cr.link_url ?? null,
        call_to_action_type: (cr.call_to_action as Record<string, unknown>)?.type ?? "LEARN_MORE",
        creative_id: cr.id ?? null,
        spend, cpa, ctr, purchases,
      };
    }));
    res.json({ ads: normalized });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── POST /api/pipeboard/scale-adsets — SSE streaming ─────────────────────────
router.post("/pipeboard/scale-adsets", async (req: Request, res: Response) => {
  const role = req.session?.role;
  if (role !== "admin" && role !== "media_buyer") { res.status(403).json({ error: "غير مصرح" }); return; }
  const {
    account_id: rawAccountId, source_campaign_id, source_adset_ids,
    dest_type, dest_campaign_id, new_campaign_name, new_campaign_budget, new_campaign_is_cbo,
  } = req.body as {
    account_id: string; source_campaign_id?: string; source_adset_ids: string[];
    dest_type: "existing" | "new"; dest_campaign_id?: string;
    new_campaign_name?: string; new_campaign_budget?: number; new_campaign_is_cbo?: boolean;
  };
  if (!rawAccountId || !source_adset_ids?.length) {
    res.status(400).json({ error: "account_id, source_adset_ids مطلوبة" }); return;
  }
  const accountId = rawAccountId.replace(/^act_/, "");
  const accountIdWithAct = `act_${accountId}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  function sse(data: object) { res.write(`data: ${JSON.stringify(data)}\n\n`); }
  function mcpTxtSa(result: unknown): string {
    return ((result as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
      .filter((c: { type: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("").trim();
  }

  try {
    const client = await getPipeboardWriteClient();
    let pageId = "";
    try {
      const pr = await client.callTool({ name: "get_account_pages", arguments: { account_id: accountId } });
      const pt = mcpTxtSa(pr); const pm = pt.match(/"id"\s*:\s*"(\d+)"/) ?? pt.match(/(\d{10,})/); pageId = pm?.[1] ?? "";
    } catch { /* ignore */ }

    let destCampaignId = dest_campaign_id ?? "";
    const isCBO = new_campaign_is_cbo ?? true;

    if (dest_type === "new") {
      sse({ type: "progress", message: "جاري إنشاء الحملة الجديدة..." });
      const campArgs: Record<string, unknown> = {
        account_id: accountId,
        name: new_campaign_name ?? `Scale — ${new Date().toLocaleDateString("en-GB")}`,
        objective: "OUTCOME_SALES", status: "PAUSED", special_ad_categories: [],
      };
      // Budget على الحملة بس لو CBO — ABO الميزانية على الـ AdSet
      // الـ create_campaign case بيعمل egpToCents تلقائياً — نبعت القيمة بالـ EGP مباشرة
      // Pipeboard بيحتاج daily_budget حتى في ABO — نبعته للحملة وبعدين بنعمله override في الـ AdSet
      if (new_campaign_budget && new_campaign_budget > 0) campArgs.daily_budget = new_campaign_budget;
      const campResult = await client.callTool({ name: "create_campaign", arguments: campArgs });
      const campText = mcpTxtSa(campResult);
      logger.info({ campText }, "scale-adsets: create_campaign");
      const campIdMatch = campText.match(/"id"\s*:\s*"(\d{10,})"/);
      if (!campIdMatch) { sse({ type: "error", message: `فشل إنشاء الحملة — ${campText.slice(0, 200)}` }); res.end(); return; }
      destCampaignId = campIdMatch[1];
      sse({ type: "campaign_created", campaign_id: destCampaignId, message: `✅ الحملة الجديدة (${destCampaignId})` });
    }

    let successCount = 0, failCount = 0;

    for (const adsetId of source_adset_ids) {
      try {
        sse({ type: "progress", message: `جاري جلب تفاصيل الـ AdSet (${adsetId})...` });
        let adsetDetails: Record<string, unknown> = {};
        try {
          const dr = await client.callTool({ name: "get_adset_details", arguments: { adset_id: adsetId } });
          const dt = mcpTxtSa(dr); const dp = JSON.parse(dt);
          adsetDetails = Array.isArray(dp) ? (dp[0] ?? {}) : dp;
        } catch {
          if (source_campaign_id) {
            try {
              const ar = await client.callTool({ name: "get_adsets", arguments: { account_id: accountId, campaign_id: source_campaign_id, fields: "id,name,optimization_goal,billing_event,targeting,attribution_spec,promoted_object,daily_budget", limit: 100 } });
              const at = mcpTxtSa(ar); const ap = JSON.parse(at);
              const aa: Record<string, unknown>[] = Array.isArray(ap) ? ap : (ap?.data ?? []);
              adsetDetails = aa.find(a => String(a.id) === adsetId) ?? {};
            } catch { /* ignore */ }
          }
        }
        const adsetName = String(adsetDetails.name ?? adsetId);
        sse({ type: "progress", message: `جاري جلب الإعلانات من "${adsetName}"...` });

        const adsRes = await client.callTool({ name: "get_ads", arguments: { account_id: accountId, adset_id: adsetId, fields: "id,name,creative{id,body,title,video_id,image_hash,link_url,call_to_action{type}}", limit: 50 } });
        const adsText = mcpTxtSa(adsRes);
        let ads: Record<string, unknown>[] = [];
        try { const p = JSON.parse(adsText); ads = Array.isArray(p) ? p : (p?.data ?? []); } catch { ads = []; }

        const promotedObj = adsetDetails.promoted_object as Record<string, unknown> | undefined;
        const pixelId = String(promotedObj?.pixel_id ?? "");
        const targeting = (adsetDetails.targeting as Record<string, unknown>) ?? {};
        const attributionSpec = adsetDetails.attribution_spec ?? [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }];
        const optGoal = String(adsetDetails.optimization_goal ?? (pixelId ? "OFFSITE_CONVERSIONS" : "LINK_CLICKS"));
        const billingEvent = String(adsetDetails.billing_event ?? "IMPRESSIONS");

        sse({ type: "progress", message: `جاري إنشاء الـ AdSet "${adsetName}"...` });
        const newAdsetArgs: Record<string, unknown> = {
          account_id: accountId, campaign_id: destCampaignId, name: adsetName,
          optimization_goal: optGoal, billing_event: billingEvent,
          targeting: { ...targeting, geo_locations: { countries: ["EG"] } },
          targeting_automation: { advantage_audience: 1 },
          attribution_spec: attributionSpec, status: "PAUSED",
        };
        if (!isCBO) { const db = Number(adsetDetails.daily_budget ?? 0); if (db > 0) newAdsetArgs.daily_budget = db; }
        if (pixelId) newAdsetArgs.promoted_object = { pixel_id: pixelId, custom_event_type: "PURCHASE" };

        const newAdsetRes = await client.callTool({ name: "create_adset", arguments: newAdsetArgs });
        const newAdsetText = mcpTxtSa(newAdsetRes);
        logger.info({ newAdsetText }, "scale-adsets: create_adset");
        const newAdsetIdMatch = newAdsetText.match(/"id"\s*:\s*"(\d{10,})"/);
        if (!newAdsetIdMatch) { sse({ type: "adset_error", adset_name: adsetName, message: `فشل إنشاء AdSet — ${newAdsetText.slice(0, 200)}` }); failCount++; continue; }
        const newAdsetId = newAdsetIdMatch[1];

        let adSuccessCount = 0; const createdAdIds: string[] = [];
        for (const ad of ads) {
          const cr = (ad.creative as Record<string, unknown>) ?? {};
          const videoId = String(cr.video_id ?? ""), imageHash = String(cr.image_hash ?? "");
          const body = String(cr.body ?? ""), title = String(cr.title ?? "");
          const linkUrl = String(cr.link_url ?? ""), cta = String((cr.call_to_action as Record<string, unknown>)?.type ?? "LEARN_MORE");
          const adName = String(ad.name ?? "إعلان");
          try {
            sse({ type: "progress", message: `جاري إنشاء الإعلان "${adName}"...` });
            const creativeArgs: Record<string, unknown> = {
              account_id: accountId, name: `${adName} — Scale`, page_id: pageId,
              message: body || "", headline: title || "", call_to_action_type: cta,
            };
            if (videoId) creativeArgs.video_id = videoId; else if (imageHash) creativeArgs.image_hash = imageHash;
            if (linkUrl) { creativeArgs.link_url = linkUrl; creativeArgs.destination_url = linkUrl; }
            if (pixelId) creativeArgs.pixel_id = pixelId;
            const crRes = await client.callTool({ name: "create_ad_creative", arguments: creativeArgs });
            const crText = mcpTxtSa(crRes);
            logger.info({ crText: crText.slice(0, 200) }, "scale-adsets: create_ad_creative");
            const crIdMatch = crText.match(/"id"\s*:\s*"(\d{10,})"/);
            if (!crIdMatch) { sse({ type: "progress", message: `⚠️ فشل creative لـ "${adName}"` }); continue; }
            const newAdArgs: Record<string, unknown> = { account_id: accountIdWithAct, name: adName, adset_id: newAdsetId, creative_id: crIdMatch[1], status: "PAUSED" };
            if (pixelId) newAdArgs.tracking_specs = [{ "action.type": ["offsite_conversion"], fb_pixel: [pixelId] }];
            const newAdRes = await client.callTool({ name: "create_ad", arguments: newAdArgs });
            const newAdText = mcpTxtSa(newAdRes);
            logger.info({ newAdText: newAdText.slice(0, 200) }, "scale-adsets: create_ad");
            const newAdIdMatch = newAdText.match(/"id"\s*:\s*"(\d{10,})"/);
            if (newAdIdMatch) { createdAdIds.push(newAdIdMatch[1]); adSuccessCount++; }
          } catch (adErr) { sse({ type: "progress", message: `⚠️ خطأ: ${String(adErr).slice(0, 100)}` }); }
        }
        sse({ type: "adset_done", adset_name: adsetName, new_adset_id: newAdsetId, ads_created: adSuccessCount, total_ads: ads.length, ad_ids: createdAdIds });
        successCount++;
      } catch (adsetErr) { sse({ type: "adset_error", adset_id: adsetId, message: String(adsetErr).slice(0, 200) }); failCount++; }
    }
    sse({ type: "done", success: successCount, failed: failCount });
  } catch (err) { sse({ type: "error", message: String(err) }); }
  res.end();
});

// ── POST /api/pipeboard/scale-creative — نسخ Creative لـ AdSet/حملة جديدة ────
router.post("/pipeboard/scale-creative", async (req: Request, res: Response) => {
  const role = req.session?.role;
  if (role !== "admin" && role !== "media_buyer") { res.status(403).json({ error: "غير مصرح" }); return; }
  const {
    account_id: rawAccountId, source_ad, dest_type, dest_adset_id, dest_campaign_id,
    new_adset_name, new_campaign_name, new_campaign_budget, new_campaign_is_cbo, pixel_id: providedPixelId,
  } = req.body as {
    account_id: string;
    source_ad: { id: string; name: string; video_id?: string; image_hash?: string; body?: string; title?: string; link_url?: string; call_to_action_type?: string; creative_id?: string };
    dest_type: "existing_adset" | "new_adset";
    dest_adset_id?: string; dest_campaign_id?: string;
    new_adset_name?: string; new_campaign_name?: string;
    new_campaign_budget?: number; new_campaign_is_cbo?: boolean; pixel_id?: string;
  };
  if (!rawAccountId || !source_ad || !dest_type) { res.status(400).json({ error: "account_id, source_ad, dest_type مطلوبة" }); return; }
  const accountId = rawAccountId.replace(/^act_/, "");
  const accountIdWithAct = `act_${accountId}`;

  // Pixel map
  const SCALE_PIXEL_MAP: Record<string, string> = {
    "898360605246408": "1405391498274239",
    "838054421405431": "1537301040808359",
    "1714386865726065": "1537301040808359",
  };
  const SCALE_PAGE_MAP: Record<string, string> = {
    "898360605246408": "878997831971062",
    "838054421405431": "108193615487446",
    "1714386865726065": "108193615487446",
  };
  const pixelId = providedPixelId || SCALE_PIXEL_MAP[accountId] || "1537301040808359";
  const defaultPageId = SCALE_PAGE_MAP[accountId] || "";
  const META_TOKEN = "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg";

  function mcpTxtSc(result: unknown): string {
    return ((result as { content?: Array<{ type: string; text?: string }> })?.content ?? [])
      .filter((c: { type: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("").trim();
  }

  try {
    const client = await getPipeboardWriteClient();

    // ── 1. جيب الـ page_id ──
    const pageId = defaultPageId;

    // ── 2. جيب الـ creative details من Meta مباشرة ──
    let srcVideoId = source_ad.video_id ?? "";
    let srcImageHash = source_ad.image_hash ?? "";
    let srcBody = source_ad.body ?? "";
    let srcTitle = source_ad.title ?? "";
    let srcLinkUrl = source_ad.link_url ?? "";
    let srcCTA = source_ad.call_to_action_type ?? "SHOP_NOW";

    // دايماً نجيب من Meta لنضمن البيانات صح
    try {
      // خطوة 1: جيب creative_id من الـ ad
      const adRes = await fetch(`https://graph.facebook.com/v21.0/${source_ad.id}?fields=id,creative&access_token=${META_TOKEN}`);
      const adJson = await adRes.json() as Record<string, unknown>;
      const crId = (adJson.creative as Record<string, unknown>)?.id ?? source_ad.creative_id ?? "";
      logger.info({ crId, adJson }, "scale-creative: got creative_id");

      if (crId) {
        // خطوة 2: جيب تفاصيل الـ creative
        const crRes = await fetch(`https://graph.facebook.com/v21.0/${crId}?fields=id,body,title,video_id,image_hash,link_url,call_to_action&access_token=${META_TOKEN}`);
        const crJson = await crRes.json() as Record<string, unknown>;
        logger.info({ crJson }, "scale-creative: got creative details");

        if (crJson.video_id) srcVideoId = String(crJson.video_id);
        if (crJson.image_hash) srcImageHash = String(crJson.image_hash);
        if (crJson.body) srcBody = String(crJson.body);
        if (crJson.title) srcTitle = String(crJson.title);
        if (crJson.link_url) srcLinkUrl = String(crJson.link_url);
        const cta = (crJson.call_to_action as Record<string, unknown>)?.type;
        if (cta) srcCTA = String(cta);
        // جيب الـ link من call_to_action.value.link لو مفيش link_url
        if (!srcLinkUrl) {
          const ctaLink = ((crJson.call_to_action as Record<string, unknown>)?.value as Record<string, unknown>)?.link;
          if (ctaLink) srcLinkUrl = String(ctaLink);
        }
      }
    } catch (e) { logger.warn({ e }, "scale-creative: failed to fetch from Meta"); }

    if (!srcVideoId && !srcImageHash) {
      res.status(400).json({ error: "لم يتم العثور على media (video_id أو image_hash) للإعلان المصدر" });
      return;
    }

    // ── 3. أنشئ الحملة لو جديدة ──
    let finalCampaignId = dest_campaign_id ?? "";
    if (dest_type === "new_adset" && !dest_campaign_id && new_campaign_name) {
      const isCBO = new_campaign_is_cbo ?? false;
      const campArgs: Record<string, unknown> = {
        account_id: accountId, name: new_campaign_name,
        objective: "OUTCOME_SALES", status: "PAUSED",
        special_ad_categories: [],
      };
      // CBO: budget على الحملة عبر Pipeboard — ABO: حملة بدون budget عبر Meta API مباشرة
      if (isCBO) {
        if (new_campaign_budget && new_campaign_budget > 0) campArgs.daily_budget = Math.round(new_campaign_budget * 100);
        const cr = await client.callTool({ name: "create_campaign", arguments: campArgs });
        const ct = mcpTxtSc(cr);
        const cm = ct.match(/"id"\s*:\s*"(\d{10,})"/);
        if (!cm) { res.status(500).json({ error: `فشل إنشاء الحملة — ${ct.slice(0, 200)}` }); return; }
        finalCampaignId = cm[1];
      } else {
        // ABO: نستخدم Meta API مباشرة بدون budget على الحملة
        const aboToken = "EAASlctzrYjUBRdmpq5GmEJCrNjZAyYzuZCtKo5WWpc4muT3cwZCzFkMMEdJSA9E5S6zHw0w9sOr3nzufekHVlEKKzrcWcUndL4hQnHIXLbn73l2VZAic4kFU0elZAGXtR1Dm2ZCsZBdYkTbCGmib2PfFHsU4yNMSZAuEPGTBzHCRfJfWZCDw29auBhLkZARCWZByRQg";
        const aboParams = new URLSearchParams();
        aboParams.append("name", new_campaign_name ?? "");
        aboParams.append("objective", "OUTCOME_SALES");
        aboParams.append("status", "PAUSED");
        aboParams.append("special_ad_categories", JSON.stringify([]));
        aboParams.append("is_adset_budget_sharing_enabled", "true");
        aboParams.append("access_token", aboToken);
        const aboRes = await fetch(`https://graph.facebook.com/v21.0/act_${accountId}/campaigns`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: aboParams.toString(),
        });
        const aboJson = await aboRes.json() as Record<string, unknown>;
        if (!aboJson.id) { res.status(500).json({ error: `فشل إنشاء حملة ABO — ${JSON.stringify(aboJson).slice(0, 200)}` }); return; }
        finalCampaignId = String(aboJson.id);
      }
    }

    // ── 4. أنشئ الـ AdSet لو جديدة ──
    let finalAdsetId = dest_adset_id ?? "";
    if (dest_type === "new_adset") {
      // اكتشف لو الحملة CBO
      let effectiveIsCBO = new_campaign_is_cbo ?? false;
      if (finalCampaignId && !new_campaign_name) {
        try {
          const campInfoRes = await client.callTool({ name: "get_campaign_details", arguments: { campaign_id: finalCampaignId } });
          const campInfoTxt = mcpTxtSc(campInfoRes);
          if (campInfoTxt.includes("daily_budget") || campInfoTxt.includes("campaign_budget_optimization")) {
            effectiveIsCBO = true;
          }
        } catch { /* ignore */ }
      }
      const adsetArgs: Record<string, unknown> = {
        account_id: accountId, campaign_id: finalCampaignId,
        name: new_adset_name ?? `Scale — ${new Date().toLocaleDateString("en-GB")}`,
        optimization_goal: "OFFSITE_CONVERSIONS",
        billing_event: "IMPRESSIONS",
        targeting: { geo_locations: { countries: ["EG"] } },
        promoted_object: { pixel_id: pixelId, custom_event_type: "PURCHASE" },
        status: "PAUSED",
      };
      if (!effectiveIsCBO && new_campaign_budget) adsetArgs.daily_budget = Math.round(new_campaign_budget * 100);
      const ar = await client.callTool({ name: "create_adset", arguments: adsetArgs });
      const at = mcpTxtSc(ar);
      const am = at.match(/"id"\s*:\s*"(\d{10,})"/);
      if (!am) { res.status(500).json({ error: `فشل إنشاء الـ AdSet — ${at.slice(0, 200)}` }); return; }
      finalAdsetId = am[1];
    }

    // ── 5. أنشئ الـ Creative ──
    const adName = source_ad.name ?? "إعلان";
    const uniqueSuffix = Date.now().toString().slice(-6);
    const creativeArgs: Record<string, unknown> = {
      account_id: accountId, name: `${adName} — Scale — ${uniqueSuffix}`,
      page_id: pageId, message: srcBody, headline: srcTitle,
      call_to_action_type: srcCTA, pixel_id: pixelId,
    };
    if (srcLinkUrl) { creativeArgs.link_url = srcLinkUrl; creativeArgs.destination_url = srcLinkUrl; }
    if (srcVideoId) creativeArgs.video_id = srcVideoId;
    else if (srcImageHash) creativeArgs.image_hash = srcImageHash;

    const crRes = await client.callTool({ name: "create_ad_creative", arguments: creativeArgs });
    const crText = mcpTxtSc(crRes);
    logger.info({ crText }, "scale-creative: create_ad_creative");
    const crIdMatch = crText.match(/"id"\s*:\s*"(\d{10,})"/);
    if (!crIdMatch) { res.status(500).json({ error: `فشل إنشاء Creative — ${crText.slice(0, 200)}`, adset_id: finalAdsetId || undefined, campaign_id: finalCampaignId || undefined }); return; }
    const creativeId = crIdMatch[1];

    // ── 6. أنشئ الـ Ad ──
    const newAdArgs: Record<string, unknown> = {
      account_id: accountIdWithAct, name: `${adName} — Scale`,
      adset_id: finalAdsetId, creative_id: creativeId, status: "PAUSED",
      tracking_specs: [{ "action.type": ["offsite_conversion"], fb_pixel: [pixelId] }],
    };
    const newAdRes = await client.callTool({ name: "create_ad", arguments: newAdArgs });
    const newAdText = mcpTxtSc(newAdRes);
    const newAdIdMatch = newAdText.match(/"id"\s*:\s*"(\d{10,})"/);

    res.json({
      success: true, campaign_id: finalCampaignId || undefined,
      adset_id: finalAdsetId, creative_id: creativeId,
      ad_id: newAdIdMatch?.[1] ?? "",
      message: `✅ تم نسخ "${adName}" بنجاح`,
    });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── POST /pipeboard/reset — force disconnect + fresh reconnect + list tools ───
router.post("/pipeboard/reset", async (_req: Request, res: Response) => {
  try {
    // 1. Force-close existing clients
    try { await _pbWriteClient?.close(); } catch { /* ignore */ }
    _pbWriteClient = null;
    _pbWriteConnecting = null;
    try { await _gaWriteClient?.close(); } catch { /* ignore */ }
    _gaWriteClient = null;
    _gaWriteConnecting = null;
    logger.info("pipeboard/reset: singletons cleared");

    // 2. Fresh connect to Meta Ads MCP
    const freshClient = await getPipeboardWriteClient();
    logger.info("pipeboard/reset: fresh connection established");

    // 3. List actual tools available
    const toolsResult = await freshClient.listTools();
    const tools = (toolsResult.tools ?? []).map((t: { name: string; description?: string }) => ({
      name: t.name,
      description: t.description ?? "",
    }));
    logger.info({ count: tools.length }, "pipeboard/reset: tools listed");

    res.json({
      success: true,
      message: `✅ Pipeboard أعيد الاتصال من الصفر — ${tools.length} tool متاحة`,
      tools,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "pipeboard/reset: failed");
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
