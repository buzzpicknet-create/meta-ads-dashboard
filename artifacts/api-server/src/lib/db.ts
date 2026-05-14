import { Pool } from "pg";
import { logger } from "./logger";

const pool = new Pool({
  connectionString: process.env["DATABASE_URL"],
  ssl: process.env["NODE_ENV"] === "production" ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected database error");
});

export { pool };

export async function query<T extends object = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
