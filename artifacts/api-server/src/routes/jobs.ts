import { Router, type Request, type Response } from "express";
import {
  createJob,
  getJob,
  listJobs,
  startJob,
  approveJob,
  cancelJob,
  formatJobSummary,
} from "../lib/job-runner.js";

const router = Router();

// POST /api/jobs — create and immediately start a new job
router.post("/jobs", async (req: Request, res: Response) => {
  const { type, account_id, params = {} } = (req.body ?? {}) as {
    type?: string;
    account_id?: string;
    params?: Record<string, unknown>;
  };

  if (!type)       { res.status(400).json({ error: "type مطلوب" }); return; }
  if (!account_id) { res.status(400).json({ error: "account_id مطلوب" }); return; }

  const SUPPORTED = ["cleanup_names", "bulk_write", "scale_budgets", "pause_ads", "creative_audit"];
  if (!SUPPORTED.includes(type)) {
    res.status(400).json({ error: `نوع غير مدعوم. المدعوم: ${SUPPORTED.join(", ")}` });
    return;
  }

  try {
    const jobId = await createJob(type, account_id, params as Record<string, unknown>);
    startJob(jobId);
    res.status(201).json({ job_id: jobId, status: "queued" });
  } catch (err) {
    req.log.error({ err }, "POST /api/jobs error");
    res.status(500).json({ error: "خطأ في إنشاء الـ job" });
  }
});

// GET /api/jobs — list recent jobs (optional ?account_id=&limit=)
router.get("/jobs", async (req: Request, res: Response) => {
  const accountId = req.query["account_id"] ? String(req.query["account_id"]) : undefined;
  const limit     = Math.min(50, parseInt(String(req.query["limit"] ?? "20"), 10) || 20);
  try {
    const rows = await listJobs(accountId, limit);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /api/jobs error");
    res.status(500).json({ error: "خطأ في جلب الـ jobs" });
  }
});

// GET /api/jobs/:id — full job state (status, progress, results, actions_diff)
router.get("/jobs/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"] ?? "");
    const job = await getJob(id);
    if (!job) { res.status(404).json({ error: "لم يُعثر على الـ job" }); return; }

    const pct = job.progress_total > 0
      ? Math.round(100 * job.progress_done / job.progress_total)
      : 0;

    res.json({
      job_id:       job.id,
      type:         job.type,
      account_id:   job.account_id,
      status:       job.status,
      progress:     { done: job.progress_done, total: job.progress_total, pct },
      results:      job.results,
      actions_diff: job.actions_diff,
      error:        job.error_msg,
      retry_after:  job.retry_after,
      created_at:   job.created_at,
      updated_at:   job.updated_at,
    });
  } catch (err) {
    req.log.error({ err }, "GET /api/jobs/:id error");
    res.status(500).json({ error: "خطأ في جلب تفاصيل الـ job" });
  }
});

// POST /api/jobs/:id/approve — approve pending write actions and resume job
router.post("/jobs/:id/approve", async (req: Request, res: Response) => {
  try {
    const ok = await approveJob(String(req.params["id"] ?? ""));
    if (!ok) {
      res.status(409).json({ error: "الـ job ليس في حالة انتظار تأكيد (pending_confirmation)" });
      return;
    }
    res.json({ message: "✅ تمت الموافقة — الـ job يستأنف التنفيذ الآن", status: "running" });
  } catch (err) {
    req.log.error({ err }, "POST /api/jobs/:id/approve error");
    res.status(500).json({ error: "خطأ في الموافقة على الـ job" });
  }
});

// POST /api/jobs/:id/cancel — cancel a queued/running/waiting job
router.post("/jobs/:id/cancel", async (req: Request, res: Response) => {
  try {
    const ok = await cancelJob(String(req.params["id"] ?? ""));
    if (!ok) {
      res.status(409).json({ error: "لا يمكن إلغاء job في هذه الحالة" });
      return;
    }
    res.json({ message: "تم إلغاء الـ job" });
  } catch (err) {
    req.log.error({ err }, "POST /api/jobs/:id/cancel error");
    res.status(500).json({ error: "خطأ في إلغاء الـ job" });
  }
});

// GET /api/jobs/:id/summary — human-readable Arabic summary (used by AI check_job)
router.get("/jobs/:id/summary", async (req: Request, res: Response) => {
  try {
    const job = await getJob(String(req.params["id"] ?? ""));
    if (!job) { res.status(404).json({ error: "لم يُعثر على الـ job" }); return; }
    res.json({ summary: formatJobSummary(job), status: job.status });
  } catch (err) {
    req.log.error({ err }, "GET /api/jobs/:id/summary error");
    res.status(500).json({ error: "خطأ في جلب ملخص الـ job" });
  }
});

export default router;
