import { Router, type IRouter } from "express";
import { query } from "../lib/db";
import { listCampaigns } from "../lib/meta-api";
import { getAdAccountIds } from "../lib/meta-token";
import { requireAuth } from "../lib/auth-middleware";

const router: IRouter = Router();

// ── Cairo helpers ─────────────────────────────────────────────────────────────
function cairoNow(): Date {
  return new Date(Date.now() + 2 * 3600000);
}

function cairoToday(): string {
  return cairoNow().toISOString().slice(0, 10);
}

function currentMonthRange(): { since: string; until: string; daysInMonth: number; daysElapsed: number } {
  const now = cairoNow();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const since = `${year}-${String(month).padStart(2, "0")}-01`;
  const until = cairoToday();
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysElapsed = day;
  return { since, until, daysInMonth, daysElapsed };
}

// ── GET /api/budget/targets?ad_account_id=... ─────────────────────────────────
// Returns all budget targets for the given account (or all accounts if none specified)
router.get("/budget/targets", requireAuth, async (req, res) => {
  try {
    const accountId = (req.query["ad_account_id"] as string) || null;
    let rows;
    if (accountId) {
      rows = await query<{
        campaign_id: string;
        account_id: string;
        monthly_budget: number;
        updated_at: string;
      }>(
        `SELECT campaign_id, account_id, monthly_budget, updated_at
         FROM budget_targets
         WHERE account_id = $1
         ORDER BY updated_at DESC`,
        [accountId]
      );
    } else {
      rows = await query<{
        campaign_id: string;
        account_id: string;
        monthly_budget: number;
        updated_at: string;
      }>(
        `SELECT campaign_id, account_id, monthly_budget, updated_at
         FROM budget_targets
         ORDER BY updated_at DESC`
      );
    }
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /budget/targets failed");
    res.status(500).json({ error: "فشل تحميل أهداف الميزانية" });
  }
});

// ── PUT /api/budget/targets ────────────────────────────────────────────────────
// Upsert a budget target for a campaign
// Body: { campaign_id, account_id, monthly_budget }
router.put("/budget/targets", requireAuth, async (req, res) => {
  try {
    const { campaign_id, account_id, monthly_budget } = req.body as {
      campaign_id: string;
      account_id: string;
      monthly_budget: number;
    };

    if (!campaign_id || !account_id || monthly_budget == null) {
      return res.status(400).json({ error: "campaign_id و account_id و monthly_budget مطلوبة" });
    }
    if (typeof monthly_budget !== "number" || monthly_budget < 0) {
      return res.status(400).json({ error: "monthly_budget يجب أن يكون رقماً موجباً" });
    }

    // Delete if budget = 0 (remove target)
    if (monthly_budget === 0) {
      await query(
        `DELETE FROM budget_targets WHERE campaign_id = $1 AND account_id = $2`,
        [campaign_id, account_id]
      );
      return res.json({ ok: true, deleted: true });
    }

    const rows = await query<{ campaign_id: string; monthly_budget: number }>(
      `INSERT INTO budget_targets (campaign_id, account_id, monthly_budget)
       VALUES ($1, $2, $3)
       ON CONFLICT (campaign_id, account_id)
       DO UPDATE SET monthly_budget = EXCLUDED.monthly_budget, updated_at = NOW()
       RETURNING campaign_id, monthly_budget`,
      [campaign_id, account_id, monthly_budget]
    );
    res.json({ ok: true, target: rows[0] });
  } catch (err) {
    req.log.error({ err }, "PUT /budget/targets failed");
    res.status(500).json({ error: "فشل حفظ هدف الميزانية" });
  }
});

// ── GET /api/budget/pacing?ad_account_id=... ─────────────────────────────────
// Returns pacing data: current-month spend vs monthly targets per campaign
router.get("/budget/pacing", requireAuth, async (req, res) => {
  try {
    const rawAccountId = (req.query["ad_account_id"] as string) || getAdAccountIds()[0] || "";
    if (!rawAccountId) {
      return res.status(400).json({ error: "لا يوجد حساب إعلاني مكوَّن" });
    }

    const { since, until, daysInMonth, daysElapsed } = currentMonthRange();

    // Fetch campaigns (current month spend) + targets in parallel
    const [campaigns, targets] = await Promise.all([
      listCampaigns({ since, until, adAccountId: rawAccountId }),
      query<{ campaign_id: string; monthly_budget: number }>(
        `SELECT campaign_id, monthly_budget FROM budget_targets WHERE account_id = $1`,
        [rawAccountId]
      ),
    ]);

    const targetMap = new Map(targets.map((t) => [t.campaign_id, t.monthly_budget]));

    // Expected fraction of month elapsed
    const monthFraction = daysElapsed / daysInMonth;

    const items = campaigns
      .filter((c) => c.effective_status === "ACTIVE" || c.spend > 0 || targetMap.has(c.id))
      .map((c) => {
        const monthlyTarget = targetMap.get(c.id) ?? null;
        const spendSoFar = c.spend;

        let pacingPct: number | null = null;
        let expectedSpend: number | null = null;
        let projectedMonthlySpend: number | null = null;
        let status: "on_track" | "overpacing" | "underpacing" | "no_target" = "no_target";

        if (monthlyTarget && monthlyTarget > 0) {
          expectedSpend = monthlyTarget * monthFraction;
          // Pacing % = actual / expected × 100
          pacingPct = expectedSpend > 0 ? (spendSoFar / expectedSpend) * 100 : null;
          // Projected end-of-month spend based on current daily rate
          projectedMonthlySpend = daysElapsed > 0 ? (spendSoFar / daysElapsed) * daysInMonth : 0;

          if (pacingPct === null) {
            status = "on_track";
          } else if (pacingPct > 115) {
            status = "overpacing";
          } else if (pacingPct < 85) {
            status = "underpacing";
          } else {
            status = "on_track";
          }
        }

        return {
          id: c.id,
          name: c.name,
          effective_status: c.effective_status,
          spend_so_far: spendSoFar,
          purchases: c.purchases,
          cpa: c.cpa,
          monthly_target: monthlyTarget,
          expected_spend: expectedSpend,
          pacing_pct: pacingPct,
          projected_monthly: projectedMonthlySpend,
          status,
        };
      });

    // Sort: with targets first (by pacing status), then no-target campaigns by spend
    items.sort((a, b) => {
      const hasTgtA = a.monthly_target !== null;
      const hasTgtB = b.monthly_target !== null;
      if (hasTgtA && !hasTgtB) return -1;
      if (!hasTgtA && hasTgtB) return 1;
      return b.spend_so_far - a.spend_so_far;
    });

    res.json({
      period: { since, until },
      days_elapsed: daysElapsed,
      days_in_month: daysInMonth,
      month_fraction: monthFraction,
      account_id: rawAccountId,
      items,
    });
  } catch (err) {
    req.log.error({ err }, "GET /budget/pacing failed");
    res.status(500).json({ error: "فشل تحميل بيانات التوزيع" });
  }
});

export default router;
