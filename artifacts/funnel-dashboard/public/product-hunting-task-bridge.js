(() => {
  if (window.__productHuntingTaskBridgeInstalled) return;
  window.__productHuntingTaskBridgeInstalled = true;

  let cache = [];
  let cacheAt = 0;
  let busy = false;

  const css = `
    .ph-task-btn{height:36px;padding:0 12px;border-radius:9px;border:1px solid #86efac;background:#ecfdf5;color:#047857;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
    .ph-task-btn:hover{background:#d1fae5}.ph-modal{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.58);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl}
    .ph-card{width:min(720px,96vw);max-height:92vh;overflow:auto;background:#fff;color:#111827;border-radius:18px;box-shadow:0 25px 80px rgba(0,0,0,.35);border:1px solid #e5e7eb}
    .ph-head{position:sticky;top:0;background:#fff;z-index:3;display:flex;align-items:flex-start;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #e5e7eb}.ph-head h3{margin:0;font-size:18px}.ph-head p{margin:5px 0 0;color:#6b7280;font-size:12px}.ph-close{border:0;background:#f3f4f6;width:36px;height:36px;border-radius:10px;font-size:22px;cursor:pointer}
    .ph-form{padding:20px;display:grid;gap:16px}.ph-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ph-field{display:grid;gap:6px}.ph-field label,.ph-label{font-size:13px;font-weight:700}.ph-field input,.ph-field textarea,.ph-field select{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:10px;padding:10px 11px;font:inherit;background:#fff;color:#111827}.ph-field textarea{min-height:82px;resize:vertical}.ph-buyers{display:grid;grid-template-columns:1fr 1fr;gap:8px;max-height:180px;overflow:auto;border:1px solid #e5e7eb;border-radius:12px;padding:8px}.ph-buyer{display:flex;align-items:center;gap:8px;border:1px solid #e5e7eb;border-radius:9px;padding:9px 10px;cursor:pointer;font-size:13px}.ph-buyer input{width:auto}.ph-presets{display:flex;gap:7px;flex-wrap:wrap}.ph-preset{border:1px solid #d1d5db;background:#fff;border-radius:9px;padding:7px 10px;cursor:pointer}.ph-actions{position:sticky;bottom:0;background:#fff;border-top:1px solid #e5e7eb;padding-top:14px;display:flex;justify-content:flex-end;gap:8px}.ph-submit{border:0;background:#4f46e5;color:#fff;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer}.ph-cancel{border:1px solid #d1d5db;background:#fff;border-radius:10px;padding:10px 16px;cursor:pointer}.ph-error{display:none;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;padding:10px;border-radius:10px;font-size:13px}.ph-toast{position:fixed;z-index:100000;left:50%;bottom:28px;transform:translateX(-50%);background:#111827;color:white;padding:11px 16px;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.25);direction:rtl;font-size:13px;max-width:90vw;text-align:center}
    @media(max-width:640px){.ph-grid2,.ph-buyers{grid-template-columns:1fr}.ph-card{max-height:95vh}.ph-form{padding:14px}.ph-head{padding:14px}}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  function toast(text){ const n=document.createElement('div'); n.className='ph-toast'; n.textContent=text; document.body.appendChild(n); setTimeout(()=>n.remove(),4500); }
  function norm(v){ try{return new URL(v,location.origin).href.replace(/\/$/,'')}catch{return String(v||'').replace(/\/$/,'')} }
  function localPlusHours(h){ const d=new Date(Date.now()+h*3600000); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

  async function getItems(force=false){
    if(!force && cache.length && Date.now()-cacheAt<5000) return cache;
    const r=await fetch('/api/product-hunting',{credentials:'include'}); const d=await r.json(); if(!r.ok) throw new Error(d.error||'تعذر تحميل المنتجات'); cache=Array.isArray(d.items)?d.items:[]; cacheAt=Date.now(); return cache;
  }
  async function getBuyers(){ const r=await fetch('/api/tasks/assignees',{credentials:'include'}); const d=await r.json(); if(!r.ok) throw new Error(d.error||'تعذر تحميل الميديا بايرز'); return (Array.isArray(d)?d:[]).filter(x=>x.role==='media_buyer'); }

  function field(label,type='input'){
    const w=document.createElement('div'); w.className='ph-field'; const l=document.createElement('label'); l.textContent=label; const el=document.createElement(type==='textarea'?'textarea':type==='select'?'select':'input'); w.append(l,el); return {w,el};
  }

  async function openModal(product){
    const overlay=document.createElement('div'); overlay.className='ph-modal';
    const card=document.createElement('div'); card.className='ph-card'; overlay.appendChild(card);
    const head=document.createElement('div'); head.className='ph-head'; const ht=document.createElement('div'); const h3=document.createElement('h3'); h3.textContent='تحويل المنتج لمهمة'; const hp=document.createElement('p'); hp.textContent='راجع سعر الجملة والعروض وحدد الميديا باير قبل إنشاء المهمة.'; ht.append(h3,hp); const close=document.createElement('button'); close.className='ph-close'; close.type='button'; close.textContent='×'; head.append(ht,close); card.appendChild(head);
    const form=document.createElement('form'); form.className='ph-form'; card.appendChild(form);
    const err=document.createElement('div'); err.className='ph-error'; form.appendChild(err);
    const showErr=t=>{err.textContent=t;err.style.display='block'};

    const title=field('عنوان المهمة *'); title.el.value=`اختبار منتج — ${product.title||'منتج جديد'}`;
    const pname=field('اسم المنتج'); pname.el.value=product.title||'';
    form.append(title.w,pname.w);

    const priceRow=document.createElement('div'); priceRow.className='ph-grid2'; const price=field('سعر الجملة / التكلفة'); price.el.inputMode='decimal'; price.el.value=product.cost_price??product.target_price_egp??''; const curr=field('العملة','select'); ['EGP','CNY','USD'].forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v==='EGP'?'ج.م':v;curr.el.appendChild(o)}); curr.el.value=product.cost_price?(product.cost_currency||'CNY'):'EGP'; priceRow.append(price.w,curr.w); form.appendChild(priceRow);

    const offers=field('العروض للميديا بايرز','textarea'); offers.el.placeholder='مثال: 1 قطعة 399ج — 2 قطعة 649ج — شحن مجاني...'; form.appendChild(offers.w);

    const buyersLabel=document.createElement('div'); buyersLabel.className='ph-label'; buyersLabel.textContent='الميديا بايرز *'; form.appendChild(buyersLabel);
    const buyersBox=document.createElement('div'); buyersBox.className='ph-buyers'; buyersBox.textContent='جاري تحميل الميديا بايرز...'; form.appendChild(buyersBox);
    let buyers=[];
    try{ buyers=await getBuyers(); buyersBox.textContent=''; if(!buyers.length) buyersBox.textContent='لا يوجد Media Buyers متاحون.'; buyers.forEach(b=>{const lab=document.createElement('label'); lab.className='ph-buyer'; const ch=document.createElement('input'); ch.type='checkbox'; ch.value=String(b.id); const sp=document.createElement('span'); sp.textContent=b.username; lab.append(ch,sp); buyersBox.appendChild(lab);}); }catch(e){ buyersBox.textContent='تعذر تحميل الميديا بايرز'; showErr(e.message||String(e)); }

    const metric=field('مقياس النجاح'); metric.el.placeholder='مثال: CPA أقل من 80 ج / 5 مبيعات أول يوم'; form.appendChild(metric.w);
    const deadline=field('الموعد النهائي'); deadline.el.type='datetime-local'; deadline.el.value=localPlusHours(24); const presets=document.createElement('div'); presets.className='ph-presets'; [{h:3,t:'٣ ساعات'},{h:12,t:'١٢ ساعة'},{h:24,t:'يوم'},{h:48,t:'يومان'},{h:72,t:'٣ أيام'}].forEach(p=>{const b=document.createElement('button');b.type='button';b.className='ph-preset';b.textContent=p.t;b.onclick=()=>deadline.el.value=localPlusHours(p.h);presets.appendChild(b)}); form.append(presets,deadline.w);
    const notes=field('تعليمات إضافية','textarea'); notes.el.placeholder='أي تعليمات إضافية للميديا باير...'; form.appendChild(notes.w);

    const actions=document.createElement('div'); actions.className='ph-actions'; const cancel=document.createElement('button'); cancel.type='button'; cancel.className='ph-cancel'; cancel.textContent='إلغاء'; const submit=document.createElement('button'); submit.type='submit'; submit.className='ph-submit'; submit.textContent='إنشاء المهمة'; actions.append(cancel,submit); form.appendChild(actions);
    const dispose=()=>overlay.remove(); close.onclick=dispose; cancel.onclick=dispose; overlay.addEventListener('mousedown',e=>{if(e.target===overlay)dispose()}); document.body.appendChild(overlay);

    form.onsubmit=async e=>{
      e.preventDefault(); err.style.display='none';
      const selected=[...buyersBox.querySelectorAll('input[type=checkbox]:checked')].map(x=>Number(x.value));
      if(!title.el.value.trim()||!deadline.el.value) return showErr('عنوان المهمة والموعد النهائي مطلوبان');
      if(!selected.length) return showErr('اختار ميديا باير واحد على الأقل');
      const wp=price.el.value.trim()?Number(price.el.value.replace(/,/g,'')):null; if(price.el.value.trim()&&!Number.isFinite(wp)) return showErr('سعر الجملة غير صحيح');
      submit.disabled=true; submit.textContent='جاري الإنشاء...';
      try{
        if(wp!==null){ const pr=await fetch(`/api/product-hunting/${product.id}`,{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({cost_price:wp,cost_currency:curr.el.value})}); const pd=await pr.json(); if(!pr.ok) throw new Error(pd.error||'تعذر حفظ سعر الجملة'); }
        const structured=[wp!==null?`سعر الجملة: ${wp} ${curr.el.value}`:null,offers.el.value.trim()?`العروض المقترحة للميديا باير:\n${offers.el.value.trim()}`:null,product.source_url?`رابط البوست/المصدر: ${product.source_url}`:null,product.supplier_url?`رابط المورد: ${product.supplier_url}`:null,product.description?`تفاصيل المنتج:\n${product.description}`:null,notes.el.value.trim()?`تعليمات إضافية:\n${notes.el.value.trim()}`:null].filter(Boolean).join('\n\n');
        for(const id of selected){ const buyer=buyers.find(b=>b.id===id); const r=await fetch('/api/tasks',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({title:title.el.value.trim(),product_name:pname.el.value.trim()||product.title||null,assigned_to_id:id,assigned_to_name:buyer?.username||null,deadline:new Date(deadline.el.value).toISOString(),success_metric:metric.el.value.trim()||null,notes:structured||null})}); const d=await r.json(); if(!r.ok) throw new Error(d.error||`تعذر إنشاء المهمة لـ ${buyer?.username||'الميديا باير'}`); }
        dispose(); cacheAt=0; toast(`تم تحويل المنتج إلى ${selected.length} ${selected.length===1?'مهمة':'مهام'} وظهورها في المهام اليومية.`);
      }catch(ex){ showErr(ex.message||String(ex)); submit.disabled=false; submit.textContent='إنشاء المهمة'; }
    };
  }

  async function inject(){
    if(location.pathname!='/product-hunting'||busy) return; busy=true;
    try{ const items=await getItems(); const articles=[...document.querySelectorAll('main article')]; for(const article of articles){ if(article.querySelector('[data-ph-task-btn]')) continue; const source=article.querySelector('a[title="فتح المصدر"]'); if(!source) continue; const product=items.find(x=>norm(x.source_url)===norm(source.href)); if(!product) continue; const row=source.parentElement; if(!row) continue; const b=document.createElement('button'); b.type='button'; b.className='ph-task-btn'; b.dataset.phTaskBtn='1'; b.textContent='تحويل لمهمة'; b.title='تحويل المنتج إلى المهام اليومية'; b.onclick=()=>openModal(product); row.insertBefore(b,row.firstChild); } }catch(e){ console.error('Product Hunting task bridge',e); }finally{busy=false;}
  }

  const boot=()=>{ inject(); const o=new MutationObserver(inject); o.observe(document.body,{childList:true,subtree:true}); };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
