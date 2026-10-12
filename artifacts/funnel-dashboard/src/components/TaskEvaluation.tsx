import {useEffect,useState} from "react";
type Review={speed:number;accuracy:number;followup:number;notes:string;reviewer_name?:string};
export default function TaskEvaluation({taskId,completed,canReview}:{taskId:number;completed:boolean;canReview:boolean}){
 const [review,setReview]=useState<Review|null>(null),[speed,setSpeed]=useState(5),[accuracy,setAccuracy]=useState(5),[followup,setFollowup]=useState(5),[notes,setNotes]=useState(""),[saving,setSaving]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{setReview(null);setMessage("");fetch("/api/teams/task-reviews/"+taskId,{credentials:"include"}).then(async r=>{if(!r.ok)return [];return r.json()}).then((rows:Review[])=>{if(rows.length){const v=rows[0];setReview(v);setSpeed(v.speed);setAccuracy(v.accuracy);setFollowup(v.followup);setNotes(v.notes||"")}}).catch(()=>{});},[taskId]);
 if(!completed)return null;
 const save=async()=>{setSaving(true);setMessage("");try{const r=await fetch("/api/teams/task-reviews/"+taskId,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({speed,accuracy,followup,notes})});const data=await r.json();if(!r.ok)throw new Error(data.error||"فشل الحفظ");setReview(data);setMessage("تم حفظ تقييم التاسك بالنقاط");}catch(e){setMessage((e as Error).message)}finally{setSaving(false)}};
 return <div dir="rtl" className="border border-slate-700 rounded-xl p-3 space-y-3 mt-3 bg-slate-900/60">
  <h3 className="text-sm font-semibold text-blue-300">تقييم تنفيذ التاسك</h3>
  {review&&<p className="text-xs text-emerald-400">التقييم المسجل: سرعة {review.speed}/10 — عدم أخطاء {review.accuracy}/10 — متابعة {review.followup}/10</p>}
  {canReview&&<><div className="flex flex-wrap gap-3">{([["السرعة",speed,setSpeed],["عدم وجود أخطاء",accuracy,setAccuracy],["المتابعة",followup,setFollowup]] as const).map(([label,value,change])=><label key={label} className="flex items-center gap-2 text-xs">{label}<select className="bg-slate-800 rounded p-1" value={value} onChange={e=>change(Number(e.target.value))}>{Array.from({length:10},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label>)}</div><textarea className="w-full rounded bg-slate-800 p-2 text-sm" placeholder="ملاحظات الأداء" value={notes} onChange={e=>setNotes(e.target.value)}/><button className="rounded bg-blue-600 px-3 py-2 text-white text-sm disabled:opacity-50" disabled={saving} onClick={save}>{saving?"جاري الحفظ...":"حفظ تقييم التاسك"}</button></>}
  {message&&<p className="text-xs">{message}</p>}
 </div>;
}
