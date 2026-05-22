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

// ── AI Learnings — auto-record successful solutions ──────────────────────────
export async function recordLearning(problem: string, solution: string, toolUsed: string, errorPattern?: string, errorCode?: string): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_learnings (problem, solution, tool_used, error_pattern, error_code, success_count, last_seen)
       VALUES ($1, $2, $3, $4, $5, 1, NOW())
       ON CONFLICT (problem) DO UPDATE SET
         success_count = ai_learnings.success_count + 1,
         last_seen = NOW(),
         solution = EXCLUDED.solution,
         tool_used = EXCLUDED.tool_used,
         error_code = COALESCE(EXCLUDED.error_code, ai_learnings.error_code)`,
      [problem, solution, toolUsed, errorPattern ?? null, errorCode ?? null]
    );
  } catch (e) {
    // non-fatal
  }
}

export async function getRecentLearnings(): Promise<string> {
  try {
    const result = await query(
      `SELECT problem, solution, tool_used, error_code, error_pattern, success_count, TO_CHAR(last_seen, 'DD-MM-YYYY') as date
       FROM ai_learnings
       ORDER BY success_count DESC, last_seen DESC
       LIMIT 50`,
      []
    );
    if (!result.length) return "";
    const lines = result.map((r: Record<string,unknown>) => {
      const code = r.error_code ? ` [code:${r.error_code}]` : "";
      return `[${r.date}]${code} ${r.problem} → ${r.solution} (${r.tool_used}) ×${r.success_count}`;
    });
    return "\n\n══════════ LEARNED SOLUTIONS (auto-updated) ══════════\n" + lines.join("\n") + "\n══════════════════════════════════════";
  } catch (e) {
    return "";
  }
}
