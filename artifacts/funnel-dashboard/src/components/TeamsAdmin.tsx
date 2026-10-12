import { useEffect, useState } from "react";
type Member = { user_id:number; username:string };
type Team = { id:number; name:string; leader_user_id:number; leader_name:string; members:Member[] };
type User = { id:number; username:string; role:string };
async function api(url:string, init?:RequestInit) {
 const res=await fetch("/api"+url,{credentials:"include",...init,headers:{"Content-Type":"application/json",...(init?.headers||{})}});
 const type=res.headers.get("content-type")||"";
 const raw=await res.text();
 if(!type.includes("application/json")){
   throw new Error(res.ok?"السيرفر رجّع صفحة بدل البيانات. جرّب تحديث الصفحة.":`تعذّر تحميل الفرق من السيرفر (HTTP ${res.status}).`);
 }
 let data:any;
 try{data=JSON.parse(raw)}catch{throw new Error("رد السيرفر غير صالح. جرّب مرة تانية.");}
 if(!res.ok)throw new Error(data.error||`خطأ من السيرفر (${res.status})`);
 return data;
}
export default function TeamsAdmin(){
 const [teams,setTeams]=useState<Team[]>([]),[users,setUsers]=useState<User[]>([]);
 const [productCounts,setProductCounts]=useState<Record<number,number>>({});
 useEffect(()=>{teams.forEach(t=>{api("/teams/"+t.id+"/products").then((rows:unknown[])=>setProductCounts(p=>({...p,[t.id]:rows.length}))).catch(()=>{});});},[teams]);
 const [name,setName]=useState(""),[leader,setLeader]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [ratings,setRatings]=useState<Record<number,{member:string;speed:number;accuracy:number;followup:number;notes:string}>>({});
 const refresh=()=>api("/teams").then(setTeams).catch(e=>setError(e.message));
 useEffect(()=>{refresh();api("/admin/users").then(x=>setUsers(x.users||[])).catch(e=>setError(e.message));},[]);
 const write=async(url:string,method:string,body:unknown)=>{setBusy(true);setError("");try{await api(url,{method,body:JSON.stringify(body)});await refresh();}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const buyers=users.filter(u=>u.role==="media_buyer");
 return <section className="mt-8 space-y-4 rounded-xl border border-border p-4" dir="rtl">
  <h2 className="font-bold text-lg">إدارة فرق الميديا باير</h2>
  <p className="text-xs text-muted-foreground">إنشاء الفرق وتعيين القادة والأعضاء وتقييم السرعة والأخطاء والمتابعة بالنقاط من 1 إلى 10.</p>
  {error&&<p className="text-red-500 text-sm">{error}</p>}
  <div className="flex flex-wrap gap-2">
   <input className="rounded border bg-background p-2 text-sm" value={name} onChange={e=>setName(e.target.value)} placeholder="اسم الفريق"/>
   <select className="rounded border bg-background p-2 text-sm" value={leader} onChange={e=>setLeader(e.target.value)}><option value="">اختر قائد الفريق</option>{buyers.map(u=><option key={u.id} value={u.id}>{u.username}</option>)}</select>
   <button className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={busy||!leader||!name.trim()} onClick={()=>write("/teams","POST",{name,leader_user_id:Number(leader)})}>إنشاء فريق</button>
  </div>
  {teams.map(t=>{const rating=ratings[t.id]||{member:"",speed:5,accuracy:5,followup:5,notes:""};const set=(update:Partial<typeof rating>)=>setRatings(p=>({...p,[t.id]:{...rating,...update}}));return <div key={t.id} className="rounded-lg border p-3 space-y-3">
   <h3 className="font-semibold">{t.name} <span className="text-xs text-muted-foreground">— القائد: {t.leader_name}</span></h3>
   <div className="text-sm">الأعضاء: {t.members.map(m=>m.username).join("، ")||"لا يوجد"} — المنتجات التابعة للفريق: {productCounts[t.id] ?? "…"}</div>
   <div className="flex gap-2"><select className="rounded border bg-background p-2 text-sm" defaultValue="" id={"member-"+t.id}><option value="">إضافة عضو</option>{buyers.filter(u=>!t.members.some(m=>m.user_id===u.id)).map(u=><option key={u.id} value={u.id}>{u.username}</option>)}</select><button className="rounded border px-3 py-1" disabled={busy} onClick={()=>{const el=document.getElementById("member-"+t.id) as HTMLSelectElement;if(el?.value)write("/teams/"+t.id+"/members","PUT",{user_id:Number(el.value)})}}>إضافة</button></div>
   <div className="border-t pt-3 space-y-2"><p className="text-sm font-semibold">تقييم عضو الفريق</p>
    <select className="rounded border bg-background p-2 text-sm" value={rating.member} onChange={e=>set({member:e.target.value})}><option value="">اختر العضو</option>{t.members.map(m=><option key={m.user_id} value={m.user_id}>{m.username}</option>)}</select>
    <div className="flex flex-wrap gap-3">{([["speed","السرعة"],["accuracy","عدم وجود أخطاء"],["followup","المتابعة"]] as const).map(([key,label])=><label key={key} className="text-xs">{label} <select value={rating[key]} className="rounded border bg-background p-1 mr-2" onChange={e=>set({[key]:Number(e.target.value)})}>{Array.from({length:10},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>)}</div>
    <input className="w-full rounded border bg-background p-2 text-sm" placeholder="ملاحظات التقييم" value={rating.notes} onChange={e=>set({notes:e.target.value})}/>
    <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50" disabled={busy||!rating.member} onClick={()=>write("/teams/"+t.id+"/reviews","POST",{member_user_id:Number(rating.member),speed:rating.speed,accuracy:rating.accuracy,followup:rating.followup,notes:rating.notes})}>حفظ التقييم</button>
   </div>
  </div>})}
 </section>;
}
