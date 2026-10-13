import { Router } from "express";
import { query } from "../lib/db";
import { requireAdmin } from "../lib/auth-middleware";

const router=Router();
router.get("/tasks/daily-manager-report",requireAdmin,async(req,res)=>{
 const date=String(req.query.date??"");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+"T00:00:00Z")))return res.status(400).json({error:"اختار تاريخ صحيح"});
 const people=await query<{id:number;username:string}>(`SELECT id,username FROM users WHERE role='media_buyer' AND deleted_at IS NULL ORDER BY username`);
 const taskRows=await query<any>(`SELECT t.id,t.title,t.task_kind,t.status,t.assigned_to_id,t.assigned_to_name,t.daily_followup_date,t.deadline,t.completed_at,
   CASE WHEN t.task_kind='daily_product_followup' THEN 'يومية' ELSE 'عادية' END AS kind
   FROM tasks t WHERE t.assigned_to_id IS NOT NULL AND (
      t.daily_followup_date=$1::date
      OR ((t.created_at AT TIME ZONE 'Africa/Cairo')::date=$1::date AND t.task_kind IS DISTINCT FROM 'daily_product_followup')
      OR (t.completed_at AT TIME ZONE 'Africa/Cairo')::date=$1::date
      OR ((t.deadline AT TIME ZONE 'Africa/Cairo')::date=$1::date AND t.status IN ('pending','in_progress','expired','partial_completed'))
   ) ORDER BY t.id DESC`,[date]);
 const notes=await query<any>(`SELECT n.task_id,n.user_id,n.username,n.note_text,n.created_at,t.title
   FROM task_notes n JOIN tasks t ON t.id=n.task_id
   WHERE (n.created_at AT TIME ZONE 'Africa/Cairo')::date=$1::date AND n.user_id IS NOT NULL
   ORDER BY n.created_at DESC LIMIT 2000`,[date]);
 const platforms=await query<any>(`SELECT p.task_id,t.assigned_to_id AS user_id,t.title,p.platform,p.comment_text,p.completed_at
   FROM task_platform_followups p JOIN tasks t ON t.id=p.task_id
   WHERE p.comment_text IS NOT NULL AND LENGTH(TRIM(p.comment_text))>0
   AND (p.completed_at AT TIME ZONE 'Africa/Cairo')::date=$1::date
   ORDER BY p.completed_at DESC LIMIT 2000`,[date]);
 const result=people.map(person=>{
   const owned=taskRows.filter(t=>t.assigned_to_id===person.id);
   const comments=[
     ...notes.filter(n=>n.user_id===person.id).map(n=>({task_id:n.task_id,title:n.title,text:n.note_text,at:n.created_at,platform:null})),
     ...platforms.filter(p=>p.user_id===person.id).map(p=>({task_id:p.task_id,title:p.title,text:p.comment_text,at:p.completed_at,platform:p.platform}))
   ].sort((a,b)=>new Date(b.at).getTime()-new Date(a.at).getTime());
   return {id:person.id,name:person.username,completed:owned.filter(t=>t.completed_at && new Date(t.completed_at).toLocaleDateString("en-CA",{timeZone:"Africa/Cairo"})===date).length,
     pending:owned.filter(t=>["pending","in_progress","partial_completed","expired"].includes(t.status)).length,
     overdue:owned.filter(t=>t.status==="expired"||(t.status!=="completed" && t.deadline && new Date(t.deadline).getTime()<new Date(date+"T21:00:00+03:00").getTime())).length,
     tasks:owned.map(t=>({id:t.id,title:t.title,kind:t.kind,status:t.status,completed_at:t.completed_at})),
     comments:comments.slice(0,80),comment_count:comments.length
   };
 });
 res.json({date,people:result.filter(p=>p.tasks.length||p.comment_count),totals:{completed:result.reduce((a,p)=>a+p.completed,0),comments:result.reduce((a,p)=>a+p.comment_count,0),pending:result.reduce((a,p)=>a+p.pending,0)}});
});
export default router;
