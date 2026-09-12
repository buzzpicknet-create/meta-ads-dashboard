import { Router, type Request, type Response, type NextFunction } from "express";

const router = Router();

function isPrivateTelegramLink(value: unknown) {
  if (typeof value !== "string") return false;
  return /^https?:\/\/(?:www\.)?t\.me\/c\/\d+\/\d+(?:[/?#]|$)/i.test(value.trim());
}

router.post("/product-hunting", (req: Request, res: Response, next: NextFunction) => {
  if (!isPrivateTelegramLink(req.body?.source_url)) return next();
  return res.status(422).json({
    error: "ده رابط Telegram خاص. لازم نربط البوت/Telegram bridge بالقناة الأول علشان نسحب النص والصور والفيديوهات الحقيقية.",
    code: "PRIVATE_TELEGRAM_CONNECTION_REQUIRED",
  });
});

export default router;
