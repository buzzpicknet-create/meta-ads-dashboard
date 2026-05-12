import express, { type Express } from "express";
import compression from "compression";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "./lib/db";

const PgSession = connectPgSimple(session);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    credentials: true,
    origin: true,
  }),
);

// Skip compression for SSE routes — gzip buffering prevents heartbeats from
// reaching the proxy, causing the connection to be killed after ~60 seconds.
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers.accept?.includes("text/event-stream")) return false;
      if (res.getHeader("Content-Type") === "text/event-stream") return false;
      return compression.filter(req, res);
    },
  }),
);
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: false,
    }),
    name: "sid",
    secret: process.env["SESSION_SECRET"] ?? "fallback-dev-secret-change-in-prod",
    resave: false,
    rolling: true,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", router);

export default app;
