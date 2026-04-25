import { Router, type IRouter } from "express";
import healthRouter from "./health";
import metaRouter from "./meta";
import alertsRouter from "./alerts";
import mediaRouter from "./media";

const router: IRouter = Router();

router.use(healthRouter);
router.use(metaRouter);
router.use(alertsRouter);
router.use(mediaRouter);

export default router;
