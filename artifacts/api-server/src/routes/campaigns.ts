import { Router } from "express";
import { query } from "../lib/db";

const router = Router();

interface CampaignIssueRow {
  id: number;
  campaign_id: string;
  campaign_name: string | null;
  account_id: string;
  issue_types: string | null;
  first_seen_at: string;
}

interface CampaignNoteRow {
  id: number;
  campaign_id: string;
  campaign_name: string | null;
  account_id: string;
  note: string;
  action_type: string | null;
  noted_by: string | null;
  created_at: string;
}

// ── POST /api/campaigns/track ─────────────────────────────────
// Register campaigns as "first seen" with issues (idempotent)
router.post("/campaigns/track", async (req, res) => {
  const { accountId, campaigns } = req.body as {
    accountId: string;
    campaigns: { id: string; name: string; issueTypes: string[] }[];
  };

  if (!accountId || !Array.isArray(campaigns)) {
    return res.status(400).json({ error: "accountId and campaigns[] required" });
  }

  try {
    for (const c of campaigns) {
      await query(
        `INSERT INTO campaign_issues (campaign_id, campaign_name, account_id, issue_types)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (campaign_id, account_id) DO NOTHING`,
        [c.id, c.name, accountId, c.issueTypes.join(",")]
      );
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/campaigns/meta?campaign_id=X&account_id=Y ───────
// Get first-seen date + notes for a campaign
router.get("/campaigns/meta", async (req, res) => {
  const { campaign_id, account_id } = req.query as {
    campaign_id?: string;
    account_id?: string;
  };

  if (!campaign_id || !account_id) {
    return res.status(400).json({ error: "campaign_id and account_id required" });
  }

  try {
    const [issue] = await query<CampaignIssueRow>(
      `SELECT * FROM campaign_issues WHERE campaign_id = $1 AND account_id = $2 LIMIT 1`,
      [campaign_id, account_id]
    );

    const notes = await query<CampaignNoteRow>(
      `SELECT * FROM campaign_notes WHERE campaign_id = $1 AND account_id = $2 ORDER BY created_at DESC`,
      [campaign_id, account_id]
    );

    return res.json({ first_seen_at: issue?.first_seen_at ?? null, notes });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/campaigns/note ──────────────────────────────────
// Add a note / action taken for a campaign issue
router.post("/campaigns/note", async (req, res) => {
  const { campaignId, campaignName, accountId, note, actionType, notedBy } =
    req.body as {
      campaignId: string;
      campaignName?: string;
      accountId: string;
      note: string;
      actionType?: string;
      notedBy?: string;
    };

  if (!campaignId || !accountId || !note?.trim()) {
    return res.status(400).json({ error: "campaignId, accountId, note required" });
  }

  try {
    const rows = await query<CampaignNoteRow>(
      `INSERT INTO campaign_notes (campaign_id, campaign_name, account_id, note, action_type, noted_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        campaignId,
        campaignName ?? null,
        accountId,
        note.trim(),
        actionType ?? null,
        notedBy?.trim() || "الميدياباير",
      ]
    );
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
