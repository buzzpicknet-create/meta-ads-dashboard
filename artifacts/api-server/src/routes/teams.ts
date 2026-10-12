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
  await query("CREATE TABLE IF NOT EXISTS buyer_team_products (inventory_product_id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES buyer_teams(id), assigned_at TIMESTAMPTZ DEFAULT NOW())");
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
 const validLeader=await query("SELECT 1 FROM users WHERE id=$1 AND role='media_buyer' AND deleted_at IS NULL",[leader]);
 if(!validLeader.length)return res.status(400).json({error:"Leader must be an active media buyer"});
 const [row]=await query<any>("INSERT INTO buyer_teams(name,leader_user_id) VALUES($1,$2) RETURNING *",[name,leader]);
 await query("INSERT INTO buyer_team_members(user_id,team_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET team_id=EXCLUDED.team_id",[leader,row.id]);
 await query("INSERT INTO buyer_team_products(inventory_product_id,team_id) SELECT DISTINCT inventory_product_id,$1 FROM inventory_media_assignments WHERE assigned_to_id=$2 AND is_active=TRUE AND inventory_product_id IS NOT NULL ON CONFLICT(inventory_product_id) DO NOTHING",[row.id,leader]);
 res.status(201).json(row);
});
router.put("/teams/:id/members",requireAdmin,async(req,res)=>{
 const team=Number(req.params.id),user=Number(req.body.user_id);
 if(!Number.isSafeInteger(team)||!Number.isSafeInteger(user))return res.status(400).json({error:"Invalid team or user"});
 const existing=await query("SELECT 1 FROM users WHERE id=$1 AND role='media_buyer' AND deleted_at IS NULL",[user]);
 const target=await query("SELECT 1 FROM buyer_teams WHERE id=$1",[team]);
 if(!existing.length||!target.length)return res.status(404).json({error:"Team or buyer not found"});
 await query("INSERT INTO buyer_team_members(user_id,team_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET team_id=EXCLUDED.team_id",[user,team]);
 res.json({success:true});
});
router.post("/teams/:id/reviews",async(req,res)=>{
 const team=Number(req.params.id),member=Number(req.body.member_user_id),uid=req.session!.userId;
 const leader=await query("SELECT 1 FROM buyer_teams WHERE id=$1 AND leader_user_id=$2",[team,uid]);
 if(req.session!.role!=="admin"&&!leader.length)return res.status(403).json({error:"Not authorized"});
 const membership=await query("SELECT 1 FROM buyer_team_members WHERE user_id=$1 AND team_id=$2",[member,team]);
 if(!membership.length)return res.status(400).json({error:"Member does not belong to team"});
 const scores=[req.body.speed,req.body.accuracy,req.body.followup].map(Number);
 if(scores.some(s=>!Number.isInteger(s)||s<1||s>10))return res.status(400).json({error:"Scores must be 1 to 10"});
 const [row]=await query("INSERT INTO buyer_team_reviews(team_id,member_user_id,reviewer_user_id,speed,accuracy,followup,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[team,member,uid,...scores,req.body.notes||""]);
 res.status(201).json(row);
});
router.get("/teams/:id/products",async(req,res)=>{
 const team=Number(req.params.id),uid=req.session!.userId;
 const access=await query("SELECT 1 FROM buyer_teams t WHERE t.id=$1 AND ($2::boolean OR t.leader_user_id=$3 OR EXISTS(SELECT 1 FROM buyer_team_members m WHERE m.team_id=t.id AND m.user_id=$3))",[team,req.session!.role==="admin",uid]);
 if(!access.length)return res.status(403).json({error:"Not authorized"});
 const rows=await query("SELECT p.inventory_product_id,a.product_name,a.source_store FROM buyer_team_products p LEFT JOIN LATERAL (SELECT product_name,source_store FROM inventory_media_assignments WHERE inventory_product_id=p.inventory_product_id ORDER BY is_active DESC LIMIT 1) a ON TRUE WHERE p.team_id=$1 ORDER BY a.product_name",[team]);
 res.json(rows);
});
router.put("/teams/:id/products/:productId",requireAdmin,async(req,res)=>{
 const team=Number(req.params.id),product=Number(req.params.productId);
 if(!Number.isSafeInteger(team)||!Number.isSafeInteger(product))return res.status(400).json({error:"Invalid identifiers"});
 const exists=await query("SELECT 1 FROM buyer_teams WHERE id=$1",[team]);
 if(!exists.length)return res.status(404).json({error:"Team not found"});
 const row=await query("SELECT 1 FROM inventory_media_assignments WHERE inventory_product_id=$1 LIMIT 1",[product]);
 if(!row.length)return res.status(404).json({error:"Product not found"});
 await query("INSERT INTO buyer_team_products(inventory_product_id,team_id) VALUES($1,$2) ON CONFLICT(inventory_product_id) DO UPDATE SET team_id=EXCLUDED.team_id",[product,team]);
 res.json({success:true});
});
router.patch("/teams/:id/tasks/:taskId/assign",async(req,res)=>{
 const team=Number(req.params.id),task=Number(req.params.taskId),buyer=Number(req.body?.assigned_to_id),uid=req.session!.userId;
 if(![team,task,buyer].every(Number.isSafeInteger))return res.status(400).json({error:"Invalid identifiers"});
 const leader=await query("SELECT 1 FROM buyer_teams WHERE id=$1 AND leader_user_id=$2",[team,uid]);
 if(req.session!.role!=="admin"&&!leader.length)return res.status(403).json({error:"Only a team leader may assign work"});
 const member=await query("SELECT u.username FROM buyer_team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 AND m.user_id=$2 AND u.deleted_at IS NULL",[team,buyer]);
 if(!member.length)return res.status(400).json({error:"Assignee is not in this team"});
 const target=await query<any>("SELECT id,assigned_to_id,inventory_product_id FROM tasks WHERE id=$1",[task]);
 if(!target.length)return res.status(404).json({error:"Task not found"});
 if(req.session!.role!=="admin"){
   const owner=await query("SELECT 1 FROM buyer_team_members WHERE team_id=$1 AND user_id=$2",[team,target[0].assigned_to_id]);
   const product=target[0].inventory_product_id == null ? [] : await query("SELECT 1 FROM buyer_team_products WHERE team_id=$1 AND inventory_product_id=$2",[team,target[0].inventory_product_id]);
   if(!owner.length&&!product.length)return res.status(403).json({error:"Task belongs to another team"});
 }
 const [updated]=await query("UPDATE tasks SET assigned_to_id=$2,assigned_to_name=$3,updated_at=NOW() WHERE id=$1 RETURNING *",[task,buyer,(member[0] as {username:string}).username]);
 res.json(updated);
});
export default router;
