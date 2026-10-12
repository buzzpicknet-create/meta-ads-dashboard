import { Router } from "express";
import { query } from "../lib/db.js";
import { requireAdmin } from "../lib/auth-middleware.js";
const router = Router();
let initialized = false;
async function init() {
  if (initialized) return;
  await query("CREATE TABLE IF NOT EXISTS buyer_teams (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, leader_user_id INTEGER NOT NULL REFERENCES users(id))");
  await query("CREATE TABLE IF NOT EXISTS buyer_team_members (user_id INTEGER PRIMARY KEY REFERENCES users(id), team_id INTEGER NOT NULL REFERENCES buyer_teams(id))");
  await query("CREATE TABLE IF NOT EXISTS buyer_team_reviews (id SERIAL PRIMARY KEY, team_id INTEGER REFERENCES buyer_teams(id), member_user_id INTEGER REFERENCES users(id), reviewer_user_id INTEGER REFERENCES users(id), speed INTEGER CHECK(speed BETWEEN 1 AND 10), accuracy INTEGER CHECK(accuracy BETWEEN 1 AND 10), followup INTEGER CHECK(followup BETWEEN 1 AND 10), notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())");
  initialized = true;
}
router.use("/teams", async (_req,res,next)=>{try{await init();next();}catch(e){next(e);}});
router.get("/teams",async(req,res)=>{
 const teams=await query<any>("SELECT t.*,u.username AS leader_name FROM buyer_teams t JOIN users u ON u.id=t.leader_user_id WHERE $1::boolean OR t.leader_user_id=$2 OR EXISTS(SELECT 1 FROM buyer_team_members m WHERE m.team_id=t.id AND m.user_id=$2)",[req.session!.role==="admin",req.session!.userId]);
 const members=await query<any>("SELECT m.*,u.username FROM buyer_team_members m JOIN users u ON u.id=m.user_id");
 res.json(teams.map(t=>({...t,members:members.filter(m=>m.team_id===t.id)})));
});
router.post("/teams",requireAdmin,async(req,res)=>{
 const name=String(req.body.name||"").trim(),leader=Number(req.body.leader_user_id);
 if(!name||!Number.isSafeInteger(leader))return res.status(400).json({error:"Invalid team"});
 const [row]=await query<any>("INSERT INTO buyer_teams(name,leader_user_id) VALUES($1,$2) RETURNING *",[name,leader]);
 await query("INSERT INTO buyer_team_members(user_id,team_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET team_id=EXCLUDED.team_id",[leader,row.id]);
 res.status(201).json(row);
});
router.put("/teams/:id/members",requireAdmin,async(req,res)=>{
 await query("INSERT INTO buyer_team_members(user_id,team_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET team_id=EXCLUDED.team_id",[req.body.user_id,req.params.id]);
 res.json({success:true});
});
router.post("/teams/:id/reviews",async(req,res)=>{
 const team=Number(req.params.id),member=Number(req.body.member_user_id),uid=req.session!.userId;
 const leader=await query("SELECT 1 FROM buyer_teams WHERE id=$1 AND leader_user_id=$2",[team,uid]);
 if(req.session!.role!=="admin"&&!leader.length)return res.status(403).json({error:"Not authorized"});
 const scores=[req.body.speed,req.body.accuracy,req.body.followup].map(Number);
 if(scores.some(s=>!Number.isInteger(s)||s<1||s>10))return res.status(400).json({error:"Scores must be 1 to 10"});
 const [row]=await query("INSERT INTO buyer_team_reviews(team_id,member_user_id,reviewer_user_id,speed,accuracy,followup,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[team,member,uid,...scores,req.body.notes||""]);
 res.status(201).json(row);
});
export default router;
