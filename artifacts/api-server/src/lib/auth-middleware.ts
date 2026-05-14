import { type Request, type Response, type NextFunction } from "express";

declare module "express-session" {
  interface SessionData {
    userId: number;
    username: string;
    role: "admin" | "media_buyer" | "media_manager";
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId || req.session.role !== "admin") {
    return res.status(403).json({ error: "غير مصرح — هذه العملية للأدمن فقط" });
  }
  next();
}
