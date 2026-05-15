/**
 * Job handler registrations — imported once at server startup.
 * Each handler calls registerJobHandler(type, fn).
 */
import { registerJobHandler, RateLimitError, type JobContext } from "./job-runner.js";
import { scanAccountNames } from "./meta-api.js";
import { getAccessToken } from "./meta-token.js";
import { logger } from "./logger.js";

const API_VERSION = "v21.0";

// ── Low-level Meta write helper ───────────────────────────────────────────────
// Mirrors fbGetSingle but uses POST (Meta Graph API writes are POST, not PATCH).

async function metaWrite(
  path: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const body = new URLSearchParams({ ...fields, access_token: token });
  const url = `https://graph.facebook.com/${API_VERSION}${path}`;

  const res = await fetch(url, { method: "POST", body });
  const json = (await res.json()) as Record<string, unknown>;

  const err = json["error"] as { code?: number; message?: string } | undefined;
  if (err) {
    // Rate-limit codes: 17 (user limit), 80000 (ad account limit), 80003 (campaign limit)
    if (err.code === 17 || err.code === 80000 || err.code === 80003 || err.code === 613) {
      throw new RateLimitError(30_000);
    }
    throw new Error(err.message ?? JSON.stringify(err));
  }
  return json;
}

// Helper: retry once on 5xx
async function metaWriteWithRetry(
  path: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  try {
    return await metaWrite(path, fields);
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    // one retry for transient errors
    await new Promise(r => setTimeout(r, 2000));
    return metaWrite(path, fields);
  }
}

// ── Helpers per action type ───────────────────────────────────────────────────

async function applyAction(action: Record<string, unknown>): Promise<{ ok: boolean; id: string; detail?: string }> {
  const type  = String(action["type"] ?? "");
  const id    = String(action["id"] ?? action["campaignId"] ?? action["adsetId"] ?? action["adId"] ?? "");
  const newName = String(action["newName"] ?? action["name"] ?? "");
  const status  = String(action["status"] ?? "");
  const amount  = Number(action["amount"] ?? 0);
  const budgetType = String(action["budgetType"] ?? "daily");

  if (!id) return { ok: false, id: "?", detail: "id مفقود" };

  if (type.startsWith("rename_")) {
    if (!newName) return { ok: false, id, detail: "newName مفقود" };
    await metaWriteWithRetry(`/${id}`, { name: newName });
    return { ok: true, id };
  }
  if (type.startsWith("pause_")) {
    await metaWriteWithRetry(`/${id}`, { status: "PAUSED" });
    return { ok: true, id };
  }
  if (type.startsWith("enable_")) {
    await metaWriteWithRetry(`/${id}`, { status: "ACTIVE" });
    return { ok: true, id };
  }
  if (type === "update_budget" || type === "scale_budget") {
    const field = budgetType === "lifetime" ? "lifetime_budget" : "daily_budget";
    // Meta budget is in account currency sub-units (piasters for EGP)
    const subUnits = String(Math.round(amount * 100));
    await metaWriteWithRetry(`/${id}`, { [field]: subUnits });
    return { ok: true, id };
  }
  if (type === "archive_campaign" || type === "archive_adset" || type === "archive_ad") {
    await metaWriteWithRetry(`/${id}`, { status: "ARCHIVED" });
    return { ok: true, id };
  }

  return { ok: false, id, detail: `نوع غير مدعوم: ${type}` };
}

// ── Job: cleanup_names ────────────────────────────────────────────────────────
// Flow: scan account → flag names with special chars → pending_confirmation
//       → approved → batch-rename with checkpoint

registerJobHandler("cleanup_names", async (ctx: JobContext) => {
  const BATCH = 20;
  const SPECIAL = /[|`\u200f\u200e\u202a-\u202e\u2066-\u2069\u0000-\u001f]/;

  // ── Phase 1: scan (once, checkpoint-guarded) ──────────────────────────────
  if (!ctx.checkpoint["scanned"]) {
    await ctx.setProgress(0, 0);
    let entries;
    try {
      entries = await scanAccountNames(ctx.accountId);
    } catch {
      throw new RateLimitError(30_000);
    }

    const flagged = entries.filter(e => SPECIAL.test(e.name));

    await ctx.saveCheckpoint({ scanned: true, flagged, done: 0 });
    await ctx.addResults([{
      phase: "scan",
      total_entities: entries.length,
      flagged_count: flagged.length,
      flagged_sample: flagged.slice(0, 5).map(e => ({ id: e.id, name: e.name, type: e.type })),
    }]);
    await ctx.setProgress(0, flagged.length);

    if (flagged.length === 0) {
      return { phase: "done", message: "✅ لا توجد أسماء تحتاج تنظيف في هذا الحساب" };
    }
  }

  // ── Phase 2: confirmation gate ────────────────────────────────────────────
  const flagged = (ctx.checkpoint["flagged"] ?? []) as Array<{ id: string; name: string; type: string }>;
  const alreadyDone = (ctx.checkpoint["done"] as number) ?? 0;

  if (!ctx.params["_approved"]) {
    const renameActions = flagged.map(e => {
      const cleanName = e.name
        .replace(/[\u200f\u200e\u202a-\u202e\u2066-\u2069]/g, "")
        .replace(/\|/g, "-")
        .replace(/`/g, "'")
        .replace(/[\u0000-\u001f]/g, "")
        .trim();
      const renameType =
        e.type === "campaign" ? "rename_campaign"
        : e.type === "adset"  ? "rename_adset"
        : "rename_ad";
      return { type: renameType, id: e.id, currentName: e.name, newName: cleanName };
    });
    ctx.requestConfirmation(renameActions); // throws ConfirmationRequiredError
  }

  // ── Phase 3: execute approved renames (resumable from alreadyDone) ────────
  const pendingActions = (ctx.params["_pending_actions"] as Record<string, unknown>[]) ?? [];
  const toExecute = pendingActions.slice(alreadyDone);
  let done = alreadyDone;

  for (let i = 0; i < toExecute.length; i += BATCH) {
    const batch = toExecute.slice(i, i + BATCH);
    const batchResults: Array<{ ok: boolean; id: string; detail?: string }> = [];

    for (const action of batch) {
      try {
        const r = await applyAction(action);
        batchResults.push(r);
      } catch (err) {
        if (err instanceof RateLimitError) {
          // Save progress before re-throwing so we resume correctly
          await ctx.saveCheckpoint({ ...ctx.checkpoint, done });
          await ctx.setProgress(done, pendingActions.length);
          throw err;
        }
        batchResults.push({ ok: false, id: String(action["id"] ?? "?"), detail: String(err) });
      }
    }

    done += batch.length;
    await ctx.saveCheckpoint({ ...ctx.checkpoint, done });
    await ctx.setProgress(done, pendingActions.length);
    await ctx.addResults(batchResults);
  }

  return { phase: "done", renamed: done };
});

// ── Job: bulk_write ───────────────────────────────────────────────────────────
// General-purpose write executor with batching + checkpoint + confirmation.
// params: { actions: [...], title?: string }
// Supports: rename_*/pause_*/enable_*/update_budget/archive_*

registerJobHandler("bulk_write", async (ctx: JobContext) => {
  const BATCH = 15;
  const allActions = (ctx.params["actions"] as Record<string, unknown>[]) ?? [];
  let done = (ctx.checkpoint["done"] as number) ?? 0;

  if (allActions.length === 0) {
    return { phase: "done", message: "لا توجد إجراءات للتنفيذ" };
  }

  // Confirmation gate — skip if already approved OR if resuming mid-job
  if (!ctx.params["_approved"] && done === 0) {
    ctx.requestConfirmation(allActions); // throws
  }

  const pending = allActions.slice(done);
  await ctx.setProgress(done, allActions.length);

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const batchResults: Array<{ ok: boolean; id: string; detail?: string }> = [];

    for (const action of batch) {
      try {
        const r = await applyAction(action);
        batchResults.push(r);
      } catch (err) {
        if (err instanceof RateLimitError) {
          await ctx.saveCheckpoint({ done });
          await ctx.setProgress(done, allActions.length);
          throw err;
        }
        batchResults.push({ ok: false, id: String(action["id"] ?? "?"), detail: String(err) });
      }
    }

    done += batch.length;
    await ctx.saveCheckpoint({ done });
    await ctx.setProgress(done, allActions.length);
    await ctx.addResults(batchResults);
  }

  return { phase: "done", processed: done };
});

// ── Job: creative_audit (stub — future) ──────────────────────────────────────
// Scans all ads in account, groups by Hook Rate / ThruPlay / CTR.
// Returns ranked list of winners + losers for decision-making.

registerJobHandler("creative_audit", async (ctx: JobContext) => {
  logger.info({ jobId: ctx.jobId }, "creative_audit job started (stub)");
  await ctx.setProgress(0, 1);
  await ctx.addResults([{ phase: "scan", note: "creative_audit سيُنفَّذ في إصدار قادم" }]);
  await ctx.setProgress(1, 1);
  return { phase: "done" };
});

// ── Job: scale_budgets ────────────────────────────────────────────────────────
// params: { actions: [{type:"update_budget", id, amount, budgetType}], title? }
// Thin wrapper over bulk_write — handles budgets specifically.

registerJobHandler("scale_budgets", async (ctx: JobContext) => {
  const allActions = (ctx.params["actions"] as Record<string, unknown>[]) ?? [];
  const BATCH = 10;
  let done = (ctx.checkpoint["done"] as number) ?? 0;

  if (!ctx.params["_approved"] && done === 0) {
    ctx.requestConfirmation(allActions);
  }

  const pending = allActions.slice(done);
  await ctx.setProgress(done, allActions.length);

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const batchResults: Array<{ ok: boolean; id: string; detail?: string }> = [];

    for (const action of batch) {
      try {
        const r = await applyAction(action);
        batchResults.push(r);
      } catch (err) {
        if (err instanceof RateLimitError) {
          await ctx.saveCheckpoint({ done });
          await ctx.setProgress(done, allActions.length);
          throw err;
        }
        batchResults.push({ ok: false, id: String(action["id"] ?? "?"), detail: String(err) });
      }
    }

    done += batch.length;
    await ctx.saveCheckpoint({ done });
    await ctx.setProgress(done, allActions.length);
    await ctx.addResults(batchResults);
  }

  return { phase: "done", processed: done };
});

// ── Job: pause_ads ────────────────────────────────────────────────────────────
// params: { actions: [{type:"pause_ad", id}] }

registerJobHandler("pause_ads", async (ctx: JobContext) => {
  const allActions = (ctx.params["actions"] as Record<string, unknown>[]) ?? [];
  const BATCH = 20;
  let done = (ctx.checkpoint["done"] as number) ?? 0;

  if (!ctx.params["_approved"] && done === 0) {
    ctx.requestConfirmation(allActions);
  }

  const pending = allActions.slice(done);
  await ctx.setProgress(done, allActions.length);

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const batchResults: Array<{ ok: boolean; id: string; detail?: string }> = [];

    for (const action of batch) {
      try {
        const r = await applyAction(action);
        batchResults.push(r);
      } catch (err) {
        if (err instanceof RateLimitError) {
          await ctx.saveCheckpoint({ done });
          await ctx.setProgress(done, allActions.length);
          throw err;
        }
        batchResults.push({ ok: false, id: String(action["id"] ?? "?"), detail: String(err) });
      }
    }

    done += batch.length;
    await ctx.saveCheckpoint({ done });
    await ctx.setProgress(done, allActions.length);
    await ctx.addResults(batchResults);
  }

  return { phase: "done", processed: done };
});

export {};
