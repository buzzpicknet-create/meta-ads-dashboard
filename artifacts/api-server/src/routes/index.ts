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
import jobsRouter from "./jobs";
import inventoryRouter from "./inventory";
import tasksRouter from "./tasks";
import storageRouter from "./storage";
import productHuntingTaskMediaRouter from "./product-hunting-task-media";
import landingPageGenRouter from "./landing-page-gen";
import landingPageRecordsRouter from "./landing-page-records";
import shopifyStoresRouter, { shopifyPublicRouter } from "./shopify-stores";
import productHuntingRouter from "./product-hunting";
import productHuntingPrivateGuardRouter from "./product-hunting-private-guard";
import telegramProductBotRouter, { telegramProductBotPublicRouter } from "./telegram-product-bot";
import telegramProductBotSetupRouter from "./telegram-product-bot-setup";
import telegramProductBotV2Router from "./telegram-product-bot-v2";
import "./telegram-product-bot-autoregister";
import creativeRoutineRouter from "./creative-routine";
import landingLibraryIntegrationRouter from "./landing-library-integration";
import creativeShopifyProductsRouter from "./creative-shopify-products";
const router = Router();

warmUpPipeboard();

router.use(authRouter);
router.use(healthRouter);
router.use(shopifyPublicRouter);
router.use(telegramProductBotSetupRouter);
router.use(telegramProductBotV2Router);
router.use(telegramProductBotPublicRouter);

router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
  }
  next();
});

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
router.use(jobsRouter);
router.use(inventoryRouter);
router.use(productHuntingTaskMediaRouter);
router.use(tasksRouter);
router.use(storageRouter);
router.use(landingPageGenRouter);
router.use(landingPageRecordsRouter);
router.use(creativeShopifyProductsRouter);
router.use(shopifyStoresRouter);
router.use(telegramProductBotRouter);
router.use(productHuntingPrivateGuardRouter);
router.use(productHuntingRouter);
router.use(creativeRoutineRouter);
router.use(landingLibraryIntegrationRouter);

export default router;
