import {useEffect,useMemo,useState} from "react";
type Comment={task_id:number;title:string;text:string;at:string;platform:string|null};
type Task={id:number;title:string;kind:string;status:string};
type Person={id:number;name:string;tasks:Task[];comments:Comment[]};
type Report={date:string;people:Person[]};
const dateInCairo=(offset=0)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Date.now()+offset*86400000));
const statusName:Record<string,string>={pending:"معلقة",in_progress:"جارية",partial_completed:"مكتملة جزئيًا",completed:"مكتملة",expired:"منتهية"};
export default function DailyManagerReport({onOpenTask}:{onOpenTask:(taskId:number)=>void}){
 const [date,setDate]=useState(dateInCairo()),[report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const [person,setPerson]=useState("all");
 useEffect(()=>{let active=true;setLoading(true);setError("");
 fetch("/api/tasks/daily-manager-report?date="+encodeURIComponent(date),{credentials:"include"})
 .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تحميل التقرير");return d as Report})
 .then(d=>{if(active)setReport(d)}).catch(e=>{if(active){setError(e.message);setReport(null)}})
 .finally(()=>{if(active)setLoading(false)});return()=>{active=false};},[date]);
 const rows=useMemo(()=>{
  if(!report)return [];
  return report.people.flatMap(p=>{
   const byTask=new Map<number,Comment[]>();
   for(const note of p.comments){const arr=byTask.get(note.task_id)||[];arr.push(note);byTask.set(note.task_id,arr);}
   const allTasks=new Map<number,Task>(p.tasks.map(t=>[t.id,t]));
   for(const note of p.comments){if(!allTasks.has(note.task_id))allTasks.set(note.task_id,{id:note.task_id,title:note.title,kind:"",status:""});}
   return [...allTasks.values()].map(task=>({personId:p.id,person:p.name,task,notes:byTask.get(task.id)||[]}));
  }).filter(r=>person==="all"||r.personId===Number(person));
 },[report,person]);
 return <section dir="rtl" className="space-y-3">
  <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 flex flex-wrap items-center justify-between gap-3">
   <h2 className="font-semibold text-sm">تقرير تاسكات الفريق</h2>
   <div className="flex flex-wrap items-center gap-2">
    <button className="rounded-lg border border-slate-600 px-3 py-2 text-xs" onClick={()=>setDate(dateInCairo())}>النهارده</button>
    <button className="rounded-lg border border-slate-600 px-3 py-2 text-xs" onClick={()=>setDate(dateInCairo(-1))}>امبارح</button>
    <input aria-label="تاريخ التقرير" type="date" value={date} onChange={e=>setDate(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-800 p-2 text-xs"/>
    <select aria-label="الميديا باير" value={person} onChange={e=>setPerson(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-800 p-2 text-xs">
     <option value="all">كل السينيور والجونيور</option>
     {report?.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
   </div>
  </div>
  {loading&&<p className="text-xs text-slate-400">جاري تحميل التقرير...</p>}
  {error&&<p className="text-xs text-red-400">{error}</p>}
  {!loading&&report&&<div className="overflow-x-auto rounded-xl border border-slate-700">
   <table className="w-full min-w-[690px] text-right text-xs">
    <thead className="bg-slate-800 text-slate-200"><tr>
     <th className="p-3 w-[130px]">الميديا باير</th><th className="p-3 w-[32%]">التاسك</th><th className="p-3">التعليق المكتوب</th><th className="p-3 w-[120px]">حالة التاسك</th>
    </tr></thead>
    <tbody className="divide-y divide-slate-800">
     {rows.map(r=><tr key={r.personId+"-"+r.task.id} className="bg-slate-900/50 align-top hover:bg-slate-800/60">
      <td className="p-3 font-semibold text-slate-200">{r.person}</td>
      <td className="p-3 text-slate-200"><button type="button" onClick={()=>onOpenTask(r.task.id)} className="text-right font-semibold text-blue-200 hover:text-blue-100 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 rounded" title="فتح تفاصيل المهمة">{r.task.title}</button><span className="block mt-1 text-[10px] text-slate-500">#{r.task.id} {r.task.kind==="يومية"?"• يومية":r.task.kind==="عادية"?"• عادية":""}</span></td>
      <td className="p-3 text-slate-300">{r.notes.length?r.notes.map((n,i)=><p key={i} className="whitespace-pre-wrap break-words mb-1">{n.platform&&<span className="text-blue-300">{n.platform}: </span>}{n.text}</p>):<span className="text-slate-500">لم يُكتب تعليق في اليوم المحدد</span>}</td>
      <td className="p-3"><span className={r.task.status==="completed"?"text-emerald-400":r.task.status==="expired"?"text-red-400":"text-amber-300"}>{statusName[r.task.status]||"غير محددة لهذا اليوم"}</span></td>
     </tr>)}
     {!rows.length&&<tr><td colSpan={4} className="p-8 text-center text-slate-400">لا توجد تاسكات أو تعليقات مسجلة في التاريخ ده.</td></tr>}
    </tbody>
   </table>
  </div>}
  <p className="text-[11px] text-slate-500">التعليقات تخص التاريخ المختار. حالة التاسك المعروضة هي حالته الحالية، وليست بالضرورة حالته التاريخية.</p>
 </section>;
}
