import {useEffect,useState} from "react";
type Comment={task_id:number;title:string;text:string;at:string;platform:string|null};
type Person={id:number;name:string;completed:number;pending:number;overdue:number;tasks:{id:number;title:string;kind:string;status:string}[];comments:Comment[];comment_count:number};
type Report={date:string;people:Person[];totals:{completed:number;comments:number;pending:number}};
const cairoDate=(offset=0)=>{const d=new Date(Date.now()+offset*86400000);return new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)};
export default function DailyManagerReport(){
 const [date,setDate]=useState(cairoDate()),[report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(""),[expanded,setExpanded]=useState<number|null>(null);
 useEffect(()=>{let alive=true;setLoading(true);setError("");fetch("/api/tasks/daily-manager-report?date="+encodeURIComponent(date),{credentials:"include"}).then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||"تعذر تحميل التقرير");return body}).then(data=>{if(alive)setReport(data)}).catch(e=>{if(alive){setError(e.message);setReport(null)}}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[date]);
 return <section className="space-y-4" dir="rtl">
  <div className="flex flex-wrap gap-2 items-center justify-between rounded-xl border border-slate-700 bg-slate-900/70 p-3">
   <div><h2 className="text-base font-bold">ملخص شغل الميديا بايرز</h2><p className="text-xs text-slate-400">متابعة يومية مختصرة — التوقيت بتوقيت القاهرة</p></div>
   <div className="flex flex-wrap gap-2 items-center">
    <button className="rounded-lg border border-slate-600 px-3 py-2 text-xs" onClick={()=>setDate(cairoDate())}>النهارده</button>
    <button className="rounded-lg border border-slate-600 px-3 py-2 text-xs" onClick={()=>setDate(cairoDate(-1))}>امبارح</button>
    <input aria-label="تاريخ التقرير" type="date" value={date} onChange={e=>setDate(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-800 p-2 text-sm"/>
   </div>
  </div>
  {loading&&<p className="text-slate-400 text-sm">جاري إعداد التقرير...</p>}
  {error&&<p className="text-red-300 text-sm">{error}</p>}
  {!loading&&report&&<><div className="flex gap-2 flex-wrap text-xs">
   <span className="rounded-lg border border-slate-700 p-2">مهام مكتملة: <b>{report.totals.completed}</b></span>
   <span className="rounded-lg border border-slate-700 p-2">تعليقات متابعة: <b>{report.totals.comments}</b></span>
   <span className="rounded-lg border border-slate-700 p-2">مهام تحتاج متابعة: <b>{report.totals.pending}</b></span>
  </div>
  {!report.people.length&&<p className="text-slate-400 text-sm">مفيش نشاط مسجل في التاريخ ده.</p>}
  <div className="grid gap-3 lg:grid-cols-2">{report.people.map(p=><article key={p.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">{p.name}</h3><div className="text-xs text-slate-300 flex gap-3"><span>أنجز {p.completed}</span><span>كتب {p.comment_count}</span><span>للمتابعة {p.pending}</span></div></div>
    {p.comments.length ? <div className="space-y-2">{p.comments.slice(0,expanded===p.id?80:3).map((n,i)=><div key={n.task_id+"-"+i} className="border-r-2 border-blue-500/50 pr-2 text-xs">
     <div className="text-slate-300 font-medium">{n.title}{n.platform?" — "+n.platform:""}</div>
     <p className="text-slate-400 whitespace-pre-wrap break-words mt-0.5">{n.text}</p>
    </div>)}</div>:<p className="text-xs text-slate-500">مفيش تعليق متابعة متسجل منه في اليوم ده</p>}
    {p.tasks.length>0&&<p className="text-xs text-slate-400">المهام المرتبطة باليوم: {p.tasks.length} {p.overdue>0?"• محتاجة مراجعة: "+p.overdue:""}</p>}
    {(p.comments.length>3||p.tasks.length>0)&&<button className="text-blue-300 text-xs" onClick={()=>setExpanded(expanded===p.id?null:p.id)}>{expanded===p.id?"عرض أقل":"عرض كل التفاصيل"} </button>}
    {expanded===p.id&&<div className="space-y-1 border-t border-slate-700 pt-2">{p.tasks.map(t=><div className="text-xs text-slate-400 flex justify-between gap-2" key={t.id}><span>{t.title}</span><span>{t.status==="completed"?"مكتملة":t.status==="expired"?"منتهية":"قيد المتابعة"}</span></div>)}</div>}
  </article>)}</div></>}
 </section>;
}
