import { Router, type IRouter } from "express";
import healthRouter from "./health";
import metaRouter from "./meta";

const router: IRouter = Router();

router.use(healthRouter);
router.use(metaRouter);

export default router;
