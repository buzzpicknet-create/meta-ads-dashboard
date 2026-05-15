import { query, pool } from "./db.js";
import { logger } from "./logger.js";

// ── Custom errors ─────────────────────────────────────────────────────────────

export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`Rate limited — retry in ${Math.round(retryAfterMs / 1000)}s`);
  }
}

export class ConfirmationRequiredError extends Error {
  constructor(public actions: unknown[]) {
    super("Confirmation required before executing write actions");
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobStatus =
  | "queued"
  | "running"
  | "waiting_rate_limit"
  | "pending_confirmation"
  | "succeeded"
  | "failed";

export interface JobRow {
  id: string;
  type: string;
  account_id: string;
  params: Record<string, unknown>;
  status: JobStatus;
  progress_done: number;
  progress_total: number;
  checkpoint: Record<string, unknown> | null;
  results: unknown[];
  actions_diff: unknown[] | null;
  error_msg: string | null;
  retry_after: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobContext {
  jobId: string;
  type: string;
  accountId: string;
  params: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  setProgress: (done: number, total: number) => Promise<void>;
  saveCheckpoint: (cp: Record<string, unknown>) => Promise<void>;
  addResults: (items: unknown[]) => Promise<void>;
  requestConfirmation: (actions: unknown[]) => never;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

// ── DB migration ──────────────────────────────────────────────────────────────

export async function initJobsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_jobs (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      type         VARCHAR(64) NOT NULL,
      account_id   VARCHAR(64) NOT NULL,
      params       JSONB       NOT NULL DEFAULT '{}',
      status       VARCHAR(32) NOT NULL DEFAULT 'queued',
      progress_done  INT       NOT NULL DEFAULT 0,
      progress_total INT       NOT NULL DEFAULT 0,
      checkpoint   JSONB,
      results      JSONB       NOT NULL DEFAULT '[]',
      actions_diff JSONB,
      error_msg    TEXT,
      retry_after  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS meta_jobs_account_idx ON meta_jobs(account_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS meta_jobs_status_idx  ON meta_jobs(status)`);
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

export async function createJob(
  type: string,
  accountId: string,
  params: Record<string, unknown>,
): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO meta_jobs(type, account_id, params) VALUES($1,$2,$3) RETURNING id`,
    [type, accountId, JSON.stringify(params)],
  );
  return rows[0].id;
}

export async function getJob(id: string): Promise<JobRow | null> {
  const rows = await query<JobRow>(`SELECT * FROM meta_jobs WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listJobs(accountId?: string, limit = 20): Promise<Omit<JobRow, "results" | "actions_diff" | "checkpoint">[]> {
  if (accountId) {
    return query(
      `SELECT id, type, account_id, status, progress_done, progress_total, error_msg, retry_after, created_at, updated_at
       FROM meta_jobs WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [accountId, limit],
    );
  }
  return query(
    `SELECT id, type, account_id, status, progress_done, progress_total, error_msg, retry_after, created_at, updated_at
     FROM meta_jobs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
}

async function updateJob(id: string, fields: Record<string, unknown>): Promise<void> {
  const sets: string[] = ["updated_at = NOW()"];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    vals.push(typeof v === "object" && v !== null ? JSON.stringify(v) : v);
  }
  vals.push(id);
  await pool.query(`UPDATE meta_jobs SET ${sets.join(",")} WHERE id = $${i}`, vals);
}

// ── Handler registry ──────────────────────────────────────────────────────────

const _handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, fn: JobHandler): void {
  _handlers.set(type, fn);
}

// ── Core executor ─────────────────────────────────────────────────────────────

export function startJob(jobId: string): void {
  setImmediate(() => void executeJob(jobId));
}

async function executeJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  if (job.status === "running") return; // already executing

  await updateJob(jobId, { status: "running" });

  const results: unknown[] = Array.isArray(job.results) ? [...job.results] : [];
  const checkpoint: Record<string, unknown> = { ...(job.checkpoint ?? {}) };

  const ctx: JobContext = {
    jobId,
    type: job.type,
    accountId: job.account_id,
    params: job.params,
    checkpoint,
    setProgress: async (done, total) => {
      await updateJob(jobId, { progress_done: done, progress_total: total });
    },
    saveCheckpoint: async (cp) => {
      Object.assign(checkpoint, cp);
      await updateJob(jobId, { checkpoint: { ...checkpoint } });
    },
    addResults: async (items) => {
      results.push(...items);
      await updateJob(jobId, { results: [...results] });
    },
    requestConfirmation: (actions) => {
      throw new ConfirmationRequiredError(actions);
    },
  };

  const handler = _handlers.get(job.type);
  if (!handler) {
    await updateJob(jobId, { status: "failed", error_msg: `نوع job غير معروف: ${job.type}` });
    return;
  }

  try {
    const finalResult = await handler(ctx);
    const allResults = finalResult !== undefined ? [...results, finalResult] : results;
    await updateJob(jobId, {
      status: "succeeded",
      results: allResults,
      progress_done: ctx.checkpoint["_done"] ?? allResults.length,
    });
    logger.info({ jobId, type: job.type }, "Job succeeded");
  } catch (err) {
    if (err instanceof ConfirmationRequiredError) {
      await updateJob(jobId, {
        status: "pending_confirmation",
        actions_diff: err.actions,
        checkpoint: { ...checkpoint },
      });
      return;
    }

    if (err instanceof RateLimitError) {
      const retryAt = new Date(Date.now() + err.retryAfterMs);
      await updateJob(jobId, {
        status: "waiting_rate_limit",
        retry_after: retryAt.toISOString(),
        checkpoint: { ...checkpoint },
      });
      logger.warn({ jobId, retryAfterMs: err.retryAfterMs }, "Job waiting for rate limit");
      setTimeout(() => void executeJob(jobId), err.retryAfterMs);
      return;
    }

    const msg = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, { status: "failed", error_msg: msg, checkpoint: { ...checkpoint } });
    logger.error({ jobId, err }, "Job failed");
  }
}

// ── Approve write actions ─────────────────────────────────────────────────────

export async function approveJob(jobId: string): Promise<boolean> {
  const job = await getJob(jobId);
  if (!job || job.status !== "pending_confirmation") return false;

  const updatedParams: Record<string, unknown> = {
    ...job.params,
    _approved: true,
    _pending_actions: job.actions_diff ?? [],
  };

  await updateJob(jobId, {
    status: "queued",
    params: updatedParams,
    actions_diff: null,
  });

  startJob(jobId);
  return true;
}

// ── Cancel job ────────────────────────────────────────────────────────────────

export async function cancelJob(jobId: string): Promise<boolean> {
  const job = await getJob(jobId);
  if (!job || job.status === "succeeded" || job.status === "failed") return false;
  await updateJob(jobId, { status: "failed", error_msg: "تم الإلغاء من المستخدم" });
  return true;
}

// ── Summarise job for AI ──────────────────────────────────────────────────────

export function formatJobSummary(job: JobRow): string {
  const statusAr: Record<JobStatus, string> = {
    queued: "⏳ في الانتظار",
    running: "🔄 قيد التشغيل",
    waiting_rate_limit: "⏸ انتظار rate limit",
    pending_confirmation: "✋ بانتظار موافقة",
    succeeded: "✅ اكتمل",
    failed: "❌ فشل",
  };
  const pct = job.progress_total > 0
    ? ` (${Math.round(100 * job.progress_done / job.progress_total)}%)`
    : "";
  const lines = [
    `**Job ${job.id.slice(0, 8)}…** — النوع: \`${job.type}\` — الحالة: ${statusAr[job.status]}`,
    `التقدم: ${job.progress_done}/${job.progress_total}${pct}`,
  ];
  if (job.status === "waiting_rate_limit" && job.retry_after) {
    const wait = Math.max(0, Math.round((new Date(job.retry_after).getTime() - Date.now()) / 1000));
    lines.push(`⏰ يُستأنف خلال ${wait} ثانية`);
  }
  if (job.status === "pending_confirmation" && Array.isArray(job.actions_diff)) {
    lines.push(`✋ ${job.actions_diff.length} إجراء بانتظار موافقتك — استخدم approve_job("${job.id}") للتأكيد`);
    const preview = (job.actions_diff as Record<string, unknown>[]).slice(0, 5);
    lines.push("```json\n" + JSON.stringify(preview, null, 2) + "\n```");
    if (job.actions_diff.length > 5) lines.push(`> وأكثر من ذلك (${job.actions_diff.length - 5} إجراء إضافي)...`);
  }
  if (job.status === "failed" && job.error_msg) {
    lines.push(`سبب الفشل: ${job.error_msg}`);
  }
  if (job.status === "succeeded" && Array.isArray(job.results) && job.results.length > 0) {
    const last = job.results[job.results.length - 1];
    lines.push("النتيجة النهائية:\n```json\n" + JSON.stringify(last, null, 2) + "\n```");
  }
  return lines.join("\n");
}
