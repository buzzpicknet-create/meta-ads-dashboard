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
  await query("ALTER TABLE buyer_team_reviews ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id)");
  await query("CREATE UNIQUE INDEX IF NOT EXISTS buyer_team_reviews_task_unique ON buyer_team_reviews(task_id) WHERE task_id IS NOT NULL");
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
router.post("/teams/:id/reviews",(_req,res)=>res.status(410).json({error:"التقييم يتم من داخل التاسك المكتمل فقط"}));
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

router.patch("/teams/:id",requireAdmin,async(req,res)=>{
 const team=Number(req.params.id),name=String(req.body?.name||"").trim(),leader=Number(req.body?.leader_user_id);
 if(!Number.isSafeInteger(team)||!Number.isSafeInteger(leader)||!name)return res.status(400).json({error:"بيانات الفريق غير صحيحة"});
 const valid=await query("SELECT 1 FROM users WHERE id=$1 AND role='media_buyer' AND deleted_at IS NULL",[leader]);
 if(!valid.length)return res.status(400).json({error:"قائد الفريق غير صالح"});
 const [result]=await query("UPDATE buyer_teams SET name=$2,leader_user_id=$3 WHERE id=$1 RETURNING *",[team,name,leader]);
 if(!result)return res.status(404).json({error:"الفريق غير موجود"});
 await query("INSERT INTO buyer_team_members(user_id,team_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET team_id=EXCLUDED.team_id",[leader,team]);
 res.json(result);
});
router.delete("/teams/:id/members/:userId",requireAdmin,async(req,res)=>{
 const team=Number(req.params.id),user=Number(req.params.userId);
 if(!Number.isSafeInteger(team)||!Number.isSafeInteger(user))return res.status(400).json({error:"معرّف غير صالح"});
 const leader=await query("SELECT 1 FROM buyer_teams WHERE id=$1 AND leader_user_id=$2",[team,user]);
 if(leader.length)return res.status(400).json({error:"غيّر قائد الفريق أولًا قبل إزالته"});
 await query("DELETE FROM buyer_team_members WHERE team_id=$1 AND user_id=$2",[team,user]);
 res.json({success:true});
});
router.get("/teams/task-reviews/:taskId",async(req,res)=>{
 const task=Number(req.params.taskId);
 if(!Number.isSafeInteger(task))return res.status(400).json({error:"رقم التاسك غير صحيح"});
 const [target]=await query<any>("SELECT assigned_to_id FROM tasks WHERE id=$1",[task]);
 if(!target)return res.status(404).json({error:"التاسك غير موجود"});
 const uid=req.session!.userId;
 const access=await query("SELECT 1 FROM buyer_team_members m JOIN buyer_teams t ON t.id=m.team_id WHERE m.user_id=$1 AND (t.leader_user_id=$2 OR $3::boolean)",[target.assigned_to_id,uid,req.session!.role==="admin"]);
 if(req.session!.role!=="admin"&&target.assigned_to_id!==uid&&!access.length)return res.status(403).json({error:"غير مصرح"});
 res.json(await query("SELECT r.*,u.username AS reviewer_name FROM buyer_team_reviews r JOIN users u ON u.id=r.reviewer_user_id WHERE task_id=$1",[task]));
});
router.post("/teams/task-reviews/:taskId",async(req,res)=>{
 const task=Number(req.params.taskId),uid=req.session!.userId;
 if(!Number.isSafeInteger(task))return res.status(400).json({error:"رقم التاسك غير صحيح"});
 const [target]=await query<any>("SELECT id,assigned_to_id,status FROM tasks WHERE id=$1",[task]);
 if(!target)return res.status(404).json({error:"التاسك غير موجود"});
 if(target.status!=="completed")return res.status(400).json({error:"التقييم متاح بعد إكمال التاسك فقط"});
 if(!target.assigned_to_id)return res.status(400).json({error:"التاسك غير مسند لعضو"});
 const [membership]=await query<any>("SELECT team_id FROM buyer_team_members WHERE user_id=$1",[target.assigned_to_id]);
 if(!membership)return res.status(400).json({error:"عضو التاسك غير تابع لفريق"});
 const [team]=await query<any>("SELECT id FROM buyer_teams WHERE id=$1 AND leader_user_id=$2",[membership.team_id,uid]);
 if(req.session!.role!=="admin"&&!team)return res.status(403).json({error:"التقييم لقائد الفريق أو الأدمن فقط"});
 const scores=[req.body?.speed,req.body?.accuracy,req.body?.followup].map(Number);
 if(scores.some(s=>!Number.isInteger(s)||s<1||s>10))return res.status(400).json({error:"كل معيار من 1 إلى 10 نقاط"});
 const [row]=await query("INSERT INTO buyer_team_reviews(task_id,team_id,member_user_id,reviewer_user_id,speed,accuracy,followup,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(task_id) WHERE task_id IS NOT NULL DO UPDATE SET speed=EXCLUDED.speed,accuracy=EXCLUDED.accuracy,followup=EXCLUDED.followup,notes=EXCLUDED.notes,reviewer_user_id=EXCLUDED.reviewer_user_id RETURNING *",[task,membership.team_id,target.assigned_to_id,uid,...scores,String(req.body?.notes||"").slice(0,2000)]);
 res.json(row);
});

export default router;
