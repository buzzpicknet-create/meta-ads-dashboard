import { Router } from "express";
import { query } from "../lib/db";
import { requireAdmin } from "../lib/auth-middleware";

const router = Router();

type TeamRow = {
  id: number;
  name: string;
  senior_user_id: number;
  senior_name: string;
  is_active: boolean;
};

type TeamMemberRow = {
  team_id: number;
  user_id: number;
  username: string;
  member_role: "senior" | "junior";
};

async function teamForUser(userId: number) {
  const [row] = await query<{
    team_id: number;
    team_name: string;
    member_role: "senior" | "junior";
    senior_user_id: number;
    senior_name: string;
  }>(`
    SELECT
      t.id AS team_id,
      t.name AS team_name,
      m.member_role,
      t.senior_user_id,
      s.username AS senior_name
    FROM media_buyer_team_members m
    INNER JOIN media_buyer_teams t ON t.id = m.team_id AND t.is_active = TRUE
    INNER JOIN users s ON s.id = t.senior_user_id
    WHERE m.user_id = $1
      AND m.is_active = TRUE
    LIMIT 1
  `, [userId]);
  return row ?? null;
}

async function membersForTeam(teamId: number) {
  return query<TeamMemberRow>(`
    SELECT
      m.team_id,
      m.user_id,
      u.username,
      m.member_role
    FROM media_buyer_team_members m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.team_id = $1
      AND m.is_active = TRUE
      AND u.deleted_at IS NULL
    ORDER BY CASE WHEN m.member_role = 'senior' THEN 0 ELSE 1 END, u.username
  `, [teamId]);
}

async function serializeTeam(team: TeamRow) {
  return { ...team, members: await membersForTeam(team.id) };
}

router.get("/teams", async (req, res) => {
  const role = req.session!.role;
  const userId = req.session!.userId;

  if (role === "admin") {
    const teams = await query<TeamRow>(`
      SELECT t.id, t.name, t.senior_user_id, s.username AS senior_name, t.is_active
      FROM media_buyer_teams t
      INNER JOIN users s ON s.id = t.senior_user_id
      WHERE t.is_active = TRUE
      ORDER BY t.id
    `);
    return res.json({
      teams: await Promise.all(teams.map(serializeTeam)),
      my_team: null,
      member_role: "admin",
    });
  }

  const mine = await teamForUser(userId);
  if (!mine) return res.json({ teams: [], my_team: null, member_role: null });

  const [team] = await query<TeamRow>(`
    SELECT t.id, t.name, t.senior_user_id, s.username AS senior_name, t.is_active
    FROM media_buyer_teams t
    INNER JOIN users s ON s.id = t.senior_user_id
    WHERE t.id = $1
  `, [mine.team_id]);

  const serialized = team ? await serializeTeam(team) : null;
  return res.json({
    teams: serialized ? [serialized] : [],
    my_team: serialized,
    member_role: mine.member_role,
  });
});

router.get("/admin/teams", requireAdmin, async (_req, res) => {
  const teams = await query<TeamRow>(`
    SELECT t.id, t.name, t.senior_user_id, s.username AS senior_name, t.is_active
    FROM media_buyer_teams t
    INNER JOIN users s ON s.id = t.senior_user_id
    WHERE t.is_active = TRUE
    ORDER BY t.id
  `);
  res.json({ teams: await Promise.all(teams.map(serializeTeam)) });
});

router.post("/admin/teams", requireAdmin, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const seniorId = Number(req.body?.senior_user_id);
  const juniorIds = Array.isArray(req.body?.junior_user_ids)
    ? req.body.junior_user_ids.map(Number).filter(Number.isSafeInteger)
    : [];

  if (!name || !Number.isSafeInteger(seniorId)) {
    return res.status(400).json({ error: "اسم الفريق والسنيور مطلوبان" });
  }

  const [senior] = await query<{ id: number; username: string }>(`
    SELECT id, username FROM users
    WHERE id = $1 AND role = 'media_buyer' AND deleted_at IS NULL
  `, [seniorId]);
  if (!senior) return res.status(400).json({ error: "السنيور غير صالح" });

  const desiredIds = Array.from(new Set([seniorId, ...juniorIds.filter((id: number) => id !== seniorId)]));
  const existingMember = await query<{ user_id: number }>(`
    SELECT user_id FROM media_buyer_team_members
    WHERE user_id = ANY($1::int[]) AND is_active = TRUE
  `, [desiredIds]);
  if (existingMember.length) {
    return res.status(409).json({ error: "واحد أو أكثر من الأعضاء موجود بالفعل في فريق آخر" });
  }

  const [team] = await query<TeamRow>(`
    INSERT INTO media_buyer_teams (name, senior_user_id)
    VALUES ($1,$2)
    RETURNING id, name, senior_user_id, $3::text AS senior_name, is_active
  `, [name, seniorId, senior.username]);

  await query(`
    INSERT INTO media_buyer_team_members (team_id, user_id, member_role)
    VALUES ($1,$2,'senior')
    ON CONFLICT (user_id) DO UPDATE SET
      team_id = EXCLUDED.team_id,
      member_role = 'senior',
      is_active = TRUE,
      updated_at = NOW()
  `, [team.id, seniorId]);

  for (const juniorId of desiredIds.filter((id) => id !== seniorId)) {
    await query(`
      INSERT INTO media_buyer_team_members (team_id, user_id, member_role)
      SELECT $1, id, 'junior'
      FROM users
      WHERE id = $2 AND role = 'media_buyer' AND deleted_at IS NULL
      ON CONFLICT (user_id) DO UPDATE SET
        team_id = EXCLUDED.team_id,
        member_role = 'junior',
        is_active = TRUE,
        updated_at = NOW()
    `, [team.id, juniorId]);
  }

  res.status(201).json(await serializeTeam(team));
});

router.put("/admin/teams/:id", requireAdmin, async (req, res) => {
  const teamId = Number(req.params.id);
  const name = String(req.body?.name || "").trim();
  const seniorId = Number(req.body?.senior_user_id);
  const juniorIds = Array.isArray(req.body?.junior_user_ids)
    ? req.body.junior_user_ids.map(Number).filter(Number.isSafeInteger)
    : [];

  if (!Number.isSafeInteger(teamId) || !name || !Number.isSafeInteger(seniorId)) {
    return res.status(400).json({ error: "بيانات الفريق غير صحيحة" });
  }

  const [senior] = await query<{ id: number; username: string }>(`
    SELECT id, username FROM users
    WHERE id = $1 AND role = 'media_buyer' AND deleted_at IS NULL
  `, [seniorId]);
  if (!senior) return res.status(400).json({ error: "السنيور غير صالح" });

  const desiredIds = Array.from(new Set([seniorId, ...juniorIds.filter((id: number) => id !== seniorId)]));
  const conflict = await query<{ user_id: number; team_id: number }>(`
    SELECT user_id, team_id
    FROM media_buyer_team_members
    WHERE user_id = ANY($1::int[])
      AND is_active = TRUE
      AND team_id <> $2
  `, [desiredIds, teamId]);
  if (conflict.length) {
    return res.status(409).json({ error: "واحد أو أكثر من الأعضاء تابع لفريق آخر" });
  }

  await query(`
    UPDATE media_buyer_teams
    SET name = $1, senior_user_id = $2, updated_at = NOW()
    WHERE id = $3
  `, [name, seniorId, teamId]);

  await query(`
    UPDATE media_buyer_team_members
    SET is_active = FALSE, updated_at = NOW()
    WHERE team_id = $1
  `, [teamId]);

  await query(`
    INSERT INTO media_buyer_team_members (team_id, user_id, member_role, is_active)
    VALUES ($1,$2,'senior',TRUE)
    ON CONFLICT (user_id) DO UPDATE SET
      team_id = EXCLUDED.team_id,
      member_role = 'senior',
      is_active = TRUE,
      updated_at = NOW()
  `, [teamId, seniorId]);

  for (const juniorId of desiredIds.filter((id) => id !== seniorId)) {
    await query(`
      INSERT INTO media_buyer_team_members (team_id, user_id, member_role, is_active)
      SELECT $1, id, 'junior', TRUE
      FROM users
      WHERE id = $2 AND role = 'media_buyer' AND deleted_at IS NULL
      ON CONFLICT (user_id) DO UPDATE SET
        team_id = EXCLUDED.team_id,
        member_role = 'junior',
        is_active = TRUE,
        updated_at = NOW()
    `, [teamId, juniorId]);
  }

  const [team] = await query<TeamRow>(`
    SELECT t.id, t.name, t.senior_user_id, s.username AS senior_name, t.is_active
    FROM media_buyer_teams t
    INNER JOIN users s ON s.id = t.senior_user_id
    WHERE t.id = $1
  `, [teamId]);

  res.json(await serializeTeam(team));
});

router.get("/team-ratings", async (req, res) => {
  const role = req.session!.role;
  const userId = req.session!.userId;

  if (role === "admin") {
    const rows = await query(`
      SELECT r.*, t.name AS team_name
      FROM team_member_ratings r
      INNER JOIN media_buyer_teams t ON t.id = r.team_id
      ORDER BY r.created_at DESC
      LIMIT 300
    `);
    return res.json(rows);
  }

  const mine = await teamForUser(userId);
  if (!mine) return res.json([]);

  if (mine.member_role === "senior") {
    const rows = await query(`
      SELECT r.*, t.name AS team_name
      FROM team_member_ratings r
      INNER JOIN media_buyer_teams t ON t.id = r.team_id
      WHERE r.team_id = $1
      ORDER BY r.created_at DESC
      LIMIT 200
    `, [mine.team_id]);
    return res.json(rows);
  }

  const rows = await query(`
    SELECT r.*, t.name AS team_name
    FROM team_member_ratings r
    INNER JOIN media_buyer_teams t ON t.id = r.team_id
    WHERE r.member_user_id = $1
    ORDER BY r.created_at DESC
    LIMIT 100
  `, [userId]);
  res.json(rows);
});

router.post("/team-ratings", async (req, res) => {
  const sessionRole = req.session!.role;
  const raterId = req.session!.userId;
  const memberUserId = Number(req.body?.member_user_id);
  const speed = Number(req.body?.speed);
  const accuracy = Number(req.body?.accuracy);
  const followup = Number(req.body?.followup);
  const note = String(req.body?.note || "").trim() || null;

  for (const value of [speed, accuracy, followup]) {
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      return res.status(400).json({ error: "كل تقييم لازم يكون من 1 إلى 10" });
    }
  }

  let teamId: number | null = null;
  if (sessionRole === "admin") {
    teamId = Number(req.body?.team_id);
    if (!Number.isSafeInteger(teamId)) return res.status(400).json({ error: "الفريق مطلوب" });
  } else {
    const mine = await teamForUser(raterId);
    if (!mine || mine.member_role !== "senior") {
      return res.status(403).json({ error: "التقييم متاح لمدير الفريق فقط" });
    }
    teamId = mine.team_id;
  }

  const [target] = await query<{ username: string; member_role: string }>(`
    SELECT u.username, m.member_role
    FROM media_buyer_team_members m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.team_id = $1
      AND m.user_id = $2
      AND m.is_active = TRUE
      AND u.deleted_at IS NULL
  `, [teamId, memberUserId]);

  if (!target || target.member_role !== "junior") {
    return res.status(400).json({ error: "يمكن تقييم أعضاء الجونيور داخل الفريق فقط" });
  }

  const [row] = await query(`
    INSERT INTO team_member_ratings (
      team_id, member_user_id, member_name,
      rated_by_id, rated_by_name,
      speed_points, accuracy_points, followup_points, note
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *
  `, [
    teamId,
    memberUserId,
    target.username,
    raterId,
    req.session!.username,
    speed,
    accuracy,
    followup,
    note,
  ]);

  res.status(201).json(row);
});

router.get("/team-ratings/summary", async (req, res) => {
  const role = req.session!.role;
  const userId = req.session!.userId;
  let teamId: number | null = null;

  if (role === "admin") {
    const requested = Number(req.query.teamId || 0);
    teamId = Number.isSafeInteger(requested) && requested > 0 ? requested : null;
  } else {
    const mine = await teamForUser(userId);
    if (!mine) return res.json([]);
    teamId = mine.team_id;
  }

  const params: unknown[] = [];
  const where: string[] = [];
  if (teamId) {
    params.push(teamId);
    where.push(`m.team_id = $${params.length}`);
  }
  if (role !== "admin") {
    const mine = await teamForUser(userId);
    if (mine?.member_role === "junior") {
      params.push(userId);
      where.push(`m.user_id = $${params.length}`);
    }
  }

  const rows = await query<{
    user_id: number;
    username: string;
    team_id: number;
    team_name: string;
    speed: string;
    accuracy: string;
    followup: string;
    rating_count: string;
    deductions: string;
  }>(`
    SELECT
      m.user_id,
      u.username,
      m.team_id,
      t.name AS team_name,
      COALESCE(ROUND(AVG(r.speed_points), 1), 0)::text AS speed,
      COALESCE(ROUND(AVG(r.accuracy_points), 1), 0)::text AS accuracy,
      COALESCE(ROUND(AVG(r.followup_points), 1), 0)::text AS followup,
      COUNT(r.id)::text AS rating_count,
      COALESCE((
        SELECT SUM(d.points)
        FROM media_buyer_score_deductions d
        WHERE d.media_buyer_id = m.user_id
          AND d.reversed_at IS NULL
      ), 0)::text AS deductions
    FROM media_buyer_team_members m
    INNER JOIN users u ON u.id = m.user_id
    INNER JOIN media_buyer_teams t ON t.id = m.team_id
    LEFT JOIN team_member_ratings r ON r.member_user_id = m.user_id
    WHERE m.is_active = TRUE
      AND m.member_role = 'junior'
      ${where.length ? `AND ${where.join(" AND ")}` : ""}
    GROUP BY m.user_id, u.username, m.team_id, t.name
    ORDER BY t.name, u.username
  `, params);

  res.json(rows.map((row) => {
    const speed = Number(row.speed);
    const accuracy = Number(row.accuracy);
    const followup = Number(row.followup);
    const deductions = Number(row.deductions);
    return {
      ...row,
      speed,
      accuracy,
      followup,
      rating_count: Number(row.rating_count),
      deductions,
      total_points: Math.max(0, Math.round((speed + accuracy + followup - deductions) * 10) / 10),
      max_points: 30,
    };
  }));
});

export { teamForUser, membersForTeam };
export default router;
