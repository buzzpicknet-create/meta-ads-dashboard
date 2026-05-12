import { Router, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import metaRouter from "./meta";
import alertsRouter from "./alerts";
import mediaRouter from "./media";
import campaignsRouter from "./campaigns";
import authRouter from "./auth";
import adminRouter from "./admin";
import activityRouter from "./activity";
import pushRouter from "./push";
import aiRouter, { warmUpPipeboard } from "./ai";
import chatRouter from "./chat";
import pipeboardRouter from "./pipeboard";
import scheduledReportsRouter from "./scheduled-reports";
import libraryRouter from "./library";
import watchdogRouter from "./watchdog";
const router = Router();

// Pre-warm Pipeboard MCP connection so the first chat request doesn't
// pay the connect+handshake overhead (usually 2-5 seconds).
warmUpPipeboard();

// ── Public routes (no auth required) ──────────────────────────────────────────
router.use(authRouter);
router.use(healthRouter);

// ── Auth guard for all routes below ───────────────────────────────────────────
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
  }
  next();
});

// ── Protected routes ───────────────────────────────────────────────────────────
router.use(metaRouter);
router.use(alertsRouter);
router.use(mediaRouter);
router.use(campaignsRouter);
router.use(adminRouter);
router.use(activityRouter);
router.use(pushRouter);
router.use(aiRouter);
router.use(chatRouter);
router.use(pipeboardRouter);
router.use(scheduledReportsRouter);
router.use(libraryRouter);
router.use(watchdogRouter);

export default router;
