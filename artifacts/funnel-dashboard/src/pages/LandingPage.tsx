import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import {
  Sparkles, Loader2, Download, Globe, X, Link2,
  AlertCircle, CheckCircle2, RefreshCw, ImageIcon, ExternalLink,
  BookOpen, Trash2, Settings2, Search, ChevronDown, ChevronUp,
  RotateCcw, Eye, Users, TrendingUp, Maximize2, Pin, Upload, Pencil,
  Smartphone, Tablet, Monitor, Megaphone, GripVertical,
  ShoppingBag, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

// ─── Local request types ───────────────────────────────────────────────────────
interface LandingPageGenerateRequest {
  productTitle: string;
  productPrice?: string;
  comparePrice?: string;
  productDesc?: string;
  imageUrls?: string[];
  frameworkKey?: string;
  styleKey?: string;
  referenceUrl?: string;
  hasFreeShipping?: boolean;
  customFocusPoints?: string;
  reviewsToken?: string;
  selectedReviewIndices?: number[];
  inlineReviews?: Array<{ text: string; customerName: string; imageUrl: string; rating: number }>;
}

interface LandingPagePublishShopifyRequest {
  html: string;
  title: string;
  productHandle?: string;
  productName?: string;
  productPrice?: string;
  comparePrice?: string;
  productImage?: string;
  productId?: string;
  headline?: string;
  lpModel?: string;
  customSlug?: string;
  existingPageId?: number;
  existingAssetKey?: string;
  existingSuffix?: string;
  adCreatives?: Record<string, unknown>;
  storeId?: number;
}

interface ShopifyProductScrapeRequest {
  url: string;
}

interface ShopifyProductCreateRequest {
  title: string;
  description?: string;
  bodyHtml?: string;
  price: string;
  images?: string[];
  storeId?: number;
}

// ─── Frameworks ───────────────────────────────────────────────────────────────
const FRAMEWORKS = [
  { key: "Auto",                label: "Auto",               emoji: "✨", sublabel: "Gemini يختار تلقائياً" },
  { key: "PAS",                 label: "PAS",                emoji: "💡", sublabel: "مشكلة → تضخيم → حل" },
  { key: "AIDA",                label: "AIDA",               emoji: "🎯", sublabel: "انتباه → رغبة → فعل" },
  { key: "FAB",                 label: "FAB",                emoji: "⚙️", sublabel: "مميزات → مزايا → فوائد" },
  { key: "BAB",                 label: "BAB",                emoji: "🔄", sublabel: "قبل → بعد → الجسر" },
  { key: "ProblemSolutionStack",label: "Prob/Sol Stack",     emoji: "🧩", sublabel: "مشاكل وحلول متراكمة" },
  { key: "VSL",                 label: "VSL",                emoji: "🎬", sublabel: "Video Sales Letter" },
  { key: "Storytelling",        label: "Storytelling",       emoji: "📖", sublabel: "قصة مؤسس / عميل" },
  { key: "OfferStack",          label: "Offer Stack",        emoji: "🔥", sublabel: "عرض حزمة / فلاش سيل" },
] as const;

// ─── Styles ───────────────────────────────────────────────────────────────────
const STYLES = [
  { key: "Auto",        label: "Auto",       emoji: "✨", sublabel: "Gemini يختار" },
  { key: "Aurora",      label: "Aurora",     emoji: "🌌", sublabel: "تدرجات وتوهج" },
  { key: "Minimalism",  label: "Minimalism", emoji: "💎", sublabel: "فخامة وأناقة" },
  { key: "Brutalism",   label: "Brutalism",  emoji: "🔩", sublabel: "جريء وصارخ" },
  { key: "Flat2",       label: "Flat 2.0",   emoji: "⚡", sublabel: "وضوح وسرعة" },
  { key: "Neumorphism", label: "Neumorph",   emoji: "🫧", sublabel: "ثلاثي الأبعاد" },
] as const;

type FrameworkKey = typeof FRAMEWORKS[number]["key"];
type StyleKey = typeof STYLES[number]["key"];

const VALID_FRAMEWORK_KEYS = FRAMEWORKS.map(f => f.key);
function toFrameworkKey(raw: string): FrameworkKey {
  if (!raw) return "Auto";
  const exact = VALID_FRAMEWORK_KEYS.find(k => k === raw);
  if (exact) return exact;
  const lower = raw.toLowerCase();
  return (VALID_FRAMEWORK_KEYS.find(k => k.toLowerCase() === lower) ?? "Auto") as FrameworkKey;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  price: string;
  comparePrice: string | null;
  image: string | null;
  images?: string[];
  variants: { id: string; title: string; price: string }[];
}

interface GenerateResult {
  html: string;
  headline: string;
  model: string;
}

interface ABVariantResult {
  html: string;
  headline: string;
  model: string;
}

interface ABResult {
  variants: ABVariantResult[];
  adCreatives?: AdCreatives;
}

interface AdScript {
  title: string;
  hook_first_3_seconds: string;
  body_script: string;
  visual_idea: string;
}

interface AdCreatives {
  scripts?: AdScript[];
  meta_ads?: { primary_texts: string[]; headlines: string[] };
  google_ads?: { short_headlines: string[]; long_headlines: string[]; descriptions: string[] };
  tiktok_ads?: { captions: string[] };
}

interface VariantConfig {
  id: string;
  frameworkKey: FrameworkKey;
  styleKey: StyleKey;
}

// Contrasting framework/style maps — mirrors backend getContrastingVariantB
const FW_CONTRAST: Partial<Record<FrameworkKey, FrameworkKey>> = {
  PAS: "FAB", Storytelling: "ProblemSolutionStack", AIDA: "OfferStack",
  FAB: "PAS", ProblemSolutionStack: "PAS", OfferStack: "AIDA",
  VSL: "ProblemSolutionStack", BAB: "FAB", Auto: "Auto",
};
const ST_CONTRAST: Partial<Record<StyleKey, StyleKey>> = {
  Flat2: "Neumorphism", Minimalism: "Brutalism", Aurora: "Flat2",
  Neumorphism: "Minimalism", Brutalism: "Minimalism", Auto: "Auto",
};
function contrastFw(fw: FrameworkKey): FrameworkKey { return FW_CONTRAST[fw] ?? "AIDA"; }
function contrastSt(st: StyleKey): StyleKey { return ST_CONTRAST[st] ?? "Auto"; }

// ─── Library types ────────────────────────────────────────────────────────────
interface PageRecord {
  id: number;
  productId: string;
  productName: string;
  productHandle: string;
  productImage: string;
  pageUrl: string;
  adminUrl: string;
  suffix: string;
  assetKey: string;
  headline: string;
  lpModel: string;
  publishedAt: string;
  adCreatives?: AdCreatives | null;
}

interface ProductGroup {
  productId: string;
  productName: string;
  productHandle: string;
  productImage: string;
  pages: PageRecord[];
}

// ─── LP Inline Visual Editor ─────────────────────────────────────────────────
/* eslint-disable no-useless-escape */
const EDITOR_SCRIPT = `<script id="__lp-es">(function(){
'use strict';
var mode=null,undoStack=[],redoStack=[],popup=null,bar=null;

function snap(){var c=document.body.cloneNode(true);var b=c.querySelector('#__lp-bar');if(b)b.parentNode.removeChild(b);return c.innerHTML;}
function pushUndo(){undoStack.push(snap());if(undoStack.length>40)undoStack.shift();redoStack=[];syncUI();}
function restoreSnap(h){document.body.innerHTML=h;document.body.insertBefore(bar,document.body.firstChild);document.body.style.paddingTop='48px';if(!document.body.contains(_fi))document.body.appendChild(_fi);bindBtns();syncUI();}
function undo(){if(!undoStack.length)return;redoStack.push(snap());restoreSnap(undoStack.pop());}
function redo(){if(!redoStack.length)return;undoStack.push(snap());restoreSnap(redoStack.pop());}
function closePopup(){if(popup){popup.parentNode&&popup.parentNode.removeChild(popup);popup=null;}}

var BS='background:rgba(255,255,255,0.08);color:#cbd5e1;border:1px solid rgba(255,255,255,0.15);padding:5px 9px;border-radius:8px;cursor:pointer;font-size:11px;font-family:Cairo,sans-serif;white-space:nowrap;flex-shrink:0;';
var BSG='background:rgba(34,197,94,0.15);color:#4ade80;border:1px solid rgba(34,197,94,0.3);padding:5px 9px;border-radius:8px;cursor:pointer;font-size:11px;font-family:Cairo,sans-serif;white-space:nowrap;flex-shrink:0;';
bar=document.createElement('div');
bar.id='__lp-bar';
bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0f172a;padding:6px 10px;display:flex;align-items:center;gap:6px;direction:rtl;font-family:Cairo,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.7);border-bottom:1px solid rgba(255,255,255,.1);box-sizing:border-box;flex-wrap:nowrap;overflow-x:auto;';
bar.innerHTML=
  '<span style="color:#94a3b8;font-size:10px;font-weight:700;flex-shrink:0">✏️ محرر</span>'+
  '<span style="color:rgba(255,255,255,.1);flex-shrink:0">|</span>'+
  '<button id="__bt" style="'+BS+'">📝 تعديل نص</button>'+
  '<button id="__bi" style="'+BS+'">🖼️ تعديل صورة</button>'+
  '<button id="__bc" style="'+BS+'">🎨 ألوان القسم</button>'+
  '<span style="color:rgba(255,255,255,.1);flex-shrink:0">|</span>'+
  '<button id="__ban" style="'+BSG+'">➕ نص جديد</button>'+
  '<button id="__bai" style="'+BSG+'">➕ صورة جديدة</button>'+
  '<span style="flex:1;min-width:4px"></span>'+
  '<button id="__bu" style="'+BS+';opacity:.4" disabled>↩</button>'+
  '<button id="__br" style="'+BS+';opacity:.4" disabled>↪</button>'+
  '<button id="__bs" style="background:#16a34a;color:#fff;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:Cairo,sans-serif;flex-shrink:0;">💾 حفظ</button>'+
  '<button id="__bx" style="background:#dc2626;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;flex-shrink:0;">✕</button>';
document.body.insertBefore(bar,document.body.firstChild);
document.body.style.paddingTop='48px';

function setAct(id,on,grn){
  var b=document.getElementById(id);if(!b)return;
  if(on){b.style.background=grn?'rgba(34,197,94,.35)':'rgba(249,115,22,.3)';b.style.color=grn?'#4ade80':'#fb923c';b.style.borderColor=grn?'rgba(34,197,94,.6)':'rgba(249,115,22,.6)';}
  else{b.style.background=grn?'rgba(34,197,94,0.15)':'rgba(255,255,255,.08)';b.style.color=grn?'#4ade80':'#cbd5e1';b.style.borderColor=grn?'rgba(34,197,94,0.3)':'rgba(255,255,255,.15)';}
}
function syncUI(){
  setAct('__bt',mode==='t');setAct('__bi',mode==='i');setAct('__bc',mode==='c');
  setAct('__ban',mode==='an',true);setAct('__bai',mode==='ai',true);
  var u=document.getElementById('__bu'),r=document.getElementById('__br');
  if(u){u.disabled=!undoStack.length;u.style.opacity=undoStack.length?'1':'.4';}
  if(r){r.disabled=!redoStack.length;r.style.opacity=redoStack.length?'1':'.4';}
  document.body.style.cursor=mode?'crosshair':'default';
}
function toggleMode(m){
  closePopup();
  document.querySelectorAll('[contenteditable]').forEach(function(el){el.removeAttribute('contenteditable');el.style.outline='';});
  mode=mode===m?null:m;syncUI();
}
function bindBtns(){
  var bt=document.getElementById('__bt'),bi=document.getElementById('__bi'),bc=document.getElementById('__bc');
  var ban=document.getElementById('__ban'),bai=document.getElementById('__bai');
  var bu=document.getElementById('__bu'),br=document.getElementById('__br');
  var bs=document.getElementById('__bs'),bx=document.getElementById('__bx');
  if(bt)bt.onclick=function(){toggleMode('t');};
  if(bi)bi.onclick=function(){toggleMode('i');};
  if(bc)bc.onclick=function(){toggleMode('c');};
  if(ban)ban.onclick=function(){toggleMode('an');};
  if(bai)bai.onclick=function(){toggleMode('ai');};
  if(bu)bu.onclick=undo;
  if(br)br.onclick=redo;
  if(bs){bs.onclick=null;bs.onmousedown=function(e){e.preventDefault();saveAll();};}
  if(bx){bx.onclick=null;bx.onmousedown=function(e){e.preventDefault();saveAll();};}
}
bindBtns();

var _curImg=null,_insertRef=null;
var _fi=document.createElement('input');_fi.type='file';_fi.accept='image/*';_fi.style.cssText='display:none;position:fixed;';
document.body.appendChild(_fi);
_fi.onchange=function(){
  var f=_fi.files&&_fi.files[0];if(!f)return;
  var rd=new FileReader();
  rd.onload=function(ev){
    var b64=(ev.target.result||'').toString().split(',')[1]||'';
    var bsEl=document.getElementById('__bs');
    var origTxt=bsEl?bsEl.textContent:'';
    if(bsEl)bsEl.textContent='⏳ جاري الرفع...';
    fetch((window.parent.location.origin||'')+'/api/shopify/upload-custom-image',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body:JSON.stringify({imageBase64:b64,mimeType:f.type})
    }).then(function(r){return r.json();}).then(function(data){
      if(bsEl)bsEl.textContent=origTxt;
      var url=data.url||'';
      if(!url){alert('فشل الرفع: '+( data.error||'لا يوجد رابط'));return;}
      var origin=window.parent.location.origin||'';
      if(url.startsWith('/'))url=origin+url;
      if(_curImg){_curImg.src=url;_curImg.srcset='';_curImg=null;}
      else if(_insertRef){doInsertImg(_insertRef,url,'100%');_insertRef=null;}
    }).catch(function(err){if(bsEl)bsEl.textContent=origTxt;alert('خطأ في الرفع: '+(err&&err.message||err));});
  };
  rd.readAsDataURL(f);_fi.value='';
};

function doInsertImg(ref,url,w){
  var img=document.createElement('img');
  img.src=url;
  img.style.cssText='width:'+w+';max-width:100%;height:auto;display:block;margin:10px auto;border-radius:8px;';
  var par=ref.parentNode||document.body;
  par.insertBefore(img,ref.nextSibling);
}

document.addEventListener('click',function(e){
  if(!mode)return;
  if(bar.contains(e.target))return;
  if(popup&&popup.contains(e.target))return;
  if(e.target===_fi)return;
  e.preventDefault();e.stopPropagation();
  if(mode==='t'){
    var el=e.target;
    if(!el||el===document.body||el===document.documentElement)return;
    if(el.tagName==='IMG'||el.tagName==='INPUT'||el.tagName==='SELECT')return;
    showTextPopup(el,e.clientX,e.clientY);
  } else if(mode==='i'){
    var img=e.target.tagName==='IMG'?e.target:(e.target.closest?e.target.closest('img'):null);
    if(!img)return;
    showImgPopup(img,e.clientX,e.clientY);
  } else if(mode==='c'){
    var el2=e.target;
    if(el2.closest&&el2.closest('#__lp-bar'))return;
    var bl=el2,tags=['DIV','SECTION','HEADER','FOOTER','ARTICLE','MAIN','NAV'];
    while(bl&&bl!==document.body&&tags.indexOf(bl.tagName)===-1)bl=bl.parentElement;
    if(!bl||bl===document.body)bl=el2;
    showColPopup(bl,e.clientX,e.clientY);
  } else if(mode==='an'){
    var ref=e.target;if(!ref||ref===document.body)return;
    showAddTextPopup(ref,e.clientX,e.clientY);
  } else if(mode==='ai'){
    var ref2=e.target;if(!ref2||ref2===document.body)return;
    showAddImgPopup(ref2,e.clientX,e.clientY);
  }
},true);

function mkPop(x,y,w){
  closePopup();
  popup=document.createElement('div');
  popup.style.cssText='position:fixed;z-index:2147483646;background:#1e293b;border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:14px;width:'+(w||280)+'px;box-shadow:0 8px 32px rgba(0,0,0,.8);direction:rtl;font-family:Cairo,sans-serif;box-sizing:border-box;';
  var top=Math.min(y+12,window.innerHeight-340);if(top<60)top=60;
  var right=window.innerWidth-x-10;
  if(right<10)right=10;
  if(right+(w||280)>window.innerWidth-10)right=window.innerWidth-(w||280)-10;
  popup.style.top=top+'px';popup.style.right=right+'px';
  document.body.appendChild(popup);
  return popup;
}
function rgb2hex(rgb){
  var m=rgb?rgb.match(/\d+/g):null;
  if(!m||m.length<3)return '#ffffff';
  return '#'+[m[0],m[1],m[2]].map(function(v){return ('0'+parseInt(v).toString(16)).slice(-2);}).join('');
}

function showImgPopup(img,x,y){
  pushUndo();_curImg=img;
  var p=mkPop(x,y,290);
  p.innerHTML='<p style="color:#94a3b8;font-size:11px;margin:0 0 8px;font-weight:700">🖼️ تعديل الصورة</p>'+
    '<input id="__iu" type="text" placeholder="رابط الصورة..." style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:7px 10px;color:#fff;font-size:12px;font-family:Cairo,sans-serif;outline:none;direction:ltr;margin-bottom:8px;">'+
    '<div style="display:flex;gap:6px;margin-bottom:6px;">'+
    '<button id="__iok" style="flex:1;background:#2563eb;color:#fff;border:none;padding:7px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;font-weight:700">✓ رابط</button>'+
    '<button id="__iup" style="flex:1;background:#7c3aed;color:#fff;border:none;padding:7px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;font-weight:700">📁 رفع</button>'+
    '</div>'+
    '<div style="display:flex;gap:6px;">'+
    '<button id="__idel" style="flex:1;background:#dc2626;color:#fff;border:none;padding:7px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;font-weight:700">🗑️ حذف</button>'+
    '<button id="__ican" style="flex:1;background:rgba(255,255,255,.1);color:#94a3b8;border:none;padding:7px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;">✕ إلغاء</button>'+
    '</div>';
  var inp=document.getElementById('__iu');inp.value=img.src||'';inp.select();
  document.getElementById('__iok').onclick=function(){var u=inp.value.trim();if(u){img.src=u;img.srcset='';}closePopup();};
  document.getElementById('__iup').onclick=function(){_fi.click();closePopup();};
  document.getElementById('__idel').onclick=function(){img.parentNode&&img.parentNode.removeChild(img);_curImg=null;closePopup();};
  document.getElementById('__ican').onclick=function(){undo();closePopup();};
}

function showTextPopup(el,x,y){
  pushUndo();
  var cs=window.getComputedStyle(el);
  var p=mkPop(x,y,250);
  p.innerHTML=
    '<p style="color:#94a3b8;font-size:11px;margin:0 0 8px;font-weight:700">📝 تعديل النص</p>'+
    '<div style="display:flex;gap:6px;margin-bottom:10px;">'+
    '<button id="__tedit" style="flex:1;background:#2563eb;color:#fff;border:none;padding:7px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;font-weight:700">✏️ تعديل</button>'+
    '<button id="__tdel" style="flex:1;background:#dc2626;color:#fff;border:none;padding:7px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;font-weight:700">🗑️ حذف</button>'+
    '</div>'+
    '<p style="color:#94a3b8;font-size:10px;margin:0 0 5px;font-weight:700">🎨 لون النص</p>'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'+
    '<input id="__ttxtcol" type="color" style="width:44px;height:34px;border:none;border-radius:7px;cursor:pointer;background:none;padding:0;flex-shrink:0;">'+
    '<span id="__ttxtcolval" style="font-size:11px;color:#94a3b8;font-family:monospace;"></span>'+
    '</div>'+
    '<p style="color:#94a3b8;font-size:10px;margin:0 0 5px;font-weight:700">📐 حجم الخط</p>'+
    '<div style="display:flex;align-items:center;gap:8px;">'+
    '<input id="__tfsize" type="range" min="8" max="96" style="flex:1;cursor:pointer;accent-color:#fb923c;">'+
    '<span id="__tfsizeval" style="font-size:11px;color:#94a3b8;width:34px;text-align:left;flex-shrink:0;font-family:monospace;"></span>'+
    '</div>';
  var curColor=rgb2hex(cs.color);
  var curSize=parseInt(cs.fontSize)||16;
  var tcol=document.getElementById('__ttxtcol');
  var tcolval=document.getElementById('__ttxtcolval');
  var tfsize=document.getElementById('__tfsize');
  var tfsizeval=document.getElementById('__tfsizeval');
  tcol.value=curColor;tcolval.textContent=curColor;
  tfsize.value=String(curSize);tfsizeval.textContent=curSize+'px';
  tcol.oninput=function(ev){el.style.setProperty('color',ev.target.value,'important');tcolval.textContent=ev.target.value;};
  tfsize.oninput=function(ev){el.style.setProperty('font-size',ev.target.value+'px','important');tfsizeval.textContent=ev.target.value+'px';};
  document.getElementById('__tedit').onclick=function(){
    closePopup();
    el.contentEditable='true';el.focus();
    el.style.outline='2px dashed #fb923c';el.style.outlineOffset='2px';
    el.addEventListener('blur',function onB(){el.removeAttribute('contenteditable');el.style.outline='';el.removeEventListener('blur',onB);});
  };
  document.getElementById('__tdel').onclick=function(){el.parentNode&&el.parentNode.removeChild(el);closePopup();};
}

function showColPopup(el,x,y){
  pushUndo();
  var cs=window.getComputedStyle(el);
  var p=mkPop(x,y,200);
  p.innerHTML='<p style="color:#94a3b8;font-size:11px;margin:0 0 6px;font-weight:700">🎨 لون الخلفية</p>'+
    '<input id="__cbg" type="color" style="width:100%;height:40px;border:none;border-radius:8px;cursor:pointer;background:none;padding:0;margin-bottom:10px;accent-color:#fb923c;">'+
    '<p style="color:#94a3b8;font-size:11px;margin:0 0 6px;font-weight:700">🔤 لون النص</p>'+
    '<input id="__ctxt" type="color" style="width:100%;height:36px;border:none;border-radius:8px;cursor:pointer;background:none;padding:0;margin-bottom:8px;accent-color:#fb923c;">'+
    '<button id="__cclose" style="width:100%;background:rgba(255,255,255,.1);color:#94a3b8;border:none;padding:6px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;">إغلاق</button>';
  document.getElementById('__cbg').value=rgb2hex(cs.backgroundColor);
  document.getElementById('__ctxt').value=rgb2hex(cs.color);
  document.getElementById('__cbg').oninput=function(ev){el.style.setProperty('background-color',ev.target.value,'important');};
  document.getElementById('__ctxt').oninput=function(ev){el.style.setProperty('color',ev.target.value,'important');};
  document.getElementById('__cclose').onclick=closePopup;
}

function showAddTextPopup(ref,x,y){
  pushUndo();
  var p=mkPop(x,y,300);
  p.innerHTML=
    '<p style="color:#4ade80;font-size:11px;margin:0 0 8px;font-weight:700">➕ إضافة نص جديد</p>'+
    '<textarea id="__atext" placeholder="اكتب النص هنا..." style="width:100%;box-sizing:border-box;height:72px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:7px 10px;color:#fff;font-size:14px;font-family:Cairo,sans-serif;outline:none;direction:rtl;resize:none;margin-bottom:8px;line-height:1.5;"></textarea>'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'+
    '<label style="color:#94a3b8;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0;">لون النص:</label>'+
    '<input id="__atcol" type="color" value="#ffffff" style="width:38px;height:30px;border:none;border-radius:6px;cursor:pointer;background:none;padding:0;flex-shrink:0;">'+
    '<span id="__atcolval" style="font-size:10px;color:#94a3b8;font-family:monospace;flex-shrink:0;"></span>'+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'+
    '<label style="color:#94a3b8;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0;">حجم الخط:</label>'+
    '<select id="__atsize" style="flex:1;background:#1e293b;border:1px solid rgba(255,255,255,.2);border-radius:6px;color:#fff;padding:4px 8px;font-size:11px;font-family:Cairo,sans-serif;">'+
    '<option value="13px">صغير (13)</option>'+
    '<option value="16px">عادي (16)</option>'+
    '<option value="20px" selected>متوسط (20)</option>'+
    '<option value="28px">كبير (28)</option>'+
    '<option value="36px">عنوان (36)</option>'+
    '<option value="48px">بانر (48)</option>'+
    '</select>'+
    '</div>'+
    '<div style="display:flex;gap:6px;">'+
    '<button id="__atadd" style="flex:1;background:#16a34a;color:#fff;border:none;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;font-weight:700">✓ إضافة</button>'+
    '<button id="__atcan" style="flex:1;background:rgba(255,255,255,.1);color:#94a3b8;border:none;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;">✕ إلغاء</button>'+
    '</div>';
  var ta=document.getElementById('__atext');
  var atcol=document.getElementById('__atcol');
  var atcolval=document.getElementById('__atcolval');
  atcolval.textContent='#ffffff';
  atcol.oninput=function(ev){atcolval.textContent=ev.target.value;};
  ta.focus();
  document.getElementById('__atadd').onclick=function(){
    var txt=ta.value.trim();if(!txt){closePopup();return;}
    var col=atcol.value||'#ffffff';
    var sz=document.getElementById('__atsize').value;
    var el=document.createElement('p');
    el.textContent=txt;
    el.style.cssText='color:'+col+';font-size:'+sz+';font-family:Cairo,sans-serif;text-align:right;direction:rtl;margin:10px 0;padding:4px 8px;line-height:1.6;';
    var par=ref.parentNode||document.body;
    par.insertBefore(el,ref.nextSibling);
    closePopup();
  };
  document.getElementById('__atcan').onclick=function(){undo();closePopup();};
}

function showAddImgPopup(ref,x,y){
  pushUndo();_insertRef=ref;
  var p=mkPop(x,y,300);
  p.innerHTML=
    '<p style="color:#4ade80;font-size:11px;margin:0 0 8px;font-weight:700">➕ إضافة صورة جديدة</p>'+
    '<input id="__aiurl" type="text" placeholder="رابط الصورة (URL)..." style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:7px 10px;color:#fff;font-size:12px;font-family:Cairo,sans-serif;outline:none;direction:ltr;margin-bottom:8px;">'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'+
    '<label style="color:#94a3b8;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0;">العرض:</label>'+
    '<select id="__aiwidth" style="flex:1;background:#1e293b;border:1px solid rgba(255,255,255,.2);border-radius:6px;color:#fff;padding:4px 8px;font-size:11px;font-family:Cairo,sans-serif;">'+
    '<option value="100%">كامل العرض (100%)</option>'+
    '<option value="75%">ثلاثة أرباع (75%)</option>'+
    '<option value="50%">نصف العرض (50%)</option>'+
    '<option value="300px">ثابت 300px</option>'+
    '<option value="200px">ثابت 200px</option>'+
    '</select>'+
    '</div>'+
    '<div style="display:flex;gap:6px;">'+
    '<button id="__aiok" style="flex:1;background:#2563eb;color:#fff;border:none;padding:7px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;font-weight:700">✓ رابط</button>'+
    '<button id="__aiup" style="flex:1;background:#7c3aed;color:#fff;border:none;padding:7px;border-radius:8px;cursor:pointer;font-size:12px;font-family:Cairo,sans-serif;font-weight:700">📁 رفع</button>'+
    '<button id="__aican" style="flex:1;background:rgba(255,255,255,.1);color:#94a3b8;border:none;padding:7px;border-radius:8px;cursor:pointer;font-size:11px;font-family:Cairo,sans-serif;">✕</button>'+
    '</div>';
  var inp=document.getElementById('__aiurl');inp.focus();
  function getW(){return document.getElementById('__aiwidth').value;}
  document.getElementById('__aiok').onclick=function(){
    var u=inp.value.trim();if(!u)return;
    doInsertImg(ref,u,getW());_insertRef=null;closePopup();
  };
  document.getElementById('__aiup').onclick=function(){_fi.click();closePopup();};
  document.getElementById('__aican').onclick=function(){_insertRef=null;undo();closePopup();};
}

document.addEventListener('mousedown',function(e){
  if(popup&&!popup.contains(e.target)&&!bar.contains(e.target))closePopup();
});
function saveAll(){
  closePopup();
  document.querySelectorAll('[contenteditable]').forEach(function(el){el.removeAttribute('contenteditable');el.style.outline='';});
  var b=document.getElementById('__lp-bar');if(b)b.parentNode.removeChild(b);
  var sc=document.getElementById('__lp-es');if(sc)sc.parentNode.removeChild(sc);
  document.body.style.paddingTop='';document.body.style.cursor='';
  var html='<!DOCTYPE html>\\n'+document.documentElement.outerHTML;
  window.parent.postMessage({type:'lp-editor-save',html:html},'*');
}
syncUI();
})();</script>`;
/* eslint-enable no-useless-escape */

function injectEditorScript(html: string): string {
  if (html.includes("</body>")) return html.replace("</body>", EDITOR_SCRIPT + "</body>");
  if (html.includes("</html>")) return html.replace("</html>", EDITOR_SCRIPT + "</html>");
  return html + EDITOR_SCRIPT;
}

/** Strip all traces of the editor script/toolbar from HTML before publishing */
function cleanEditorFromHtml(html: string): string {
  let cleaned = html.replace(/<script[^>]*id="__lp-es"[^>]*>[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<div[^>]*id="__lp-bar"[^>]*>[\s\S]*?<\/div>/gi, "");
  cleaned = cleaned.replace(/(<body[^>]*style="[^"]*?)padding-top:\s*52px;?\s*/gi, "$1");
  return cleaned;
}

interface StorePickerInfo { id: number; domain: string; shopName: string | null; isDefault: boolean; }
interface EditorModalProps {
  html: string;
  headline: string;
  onSave: (editedHtml: string) => void;
  onClose: () => void;
  stores?: StorePickerInfo[];
  selectedStoreId?: number | null;
  onStoreChange?: (id: number) => void;
}

function EditorModal({ html, headline, onSave, onClose, stores, selectedStoreId, onStoreChange }: EditorModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [savedBadge, setSavedBadge] = useState(false);
  const onSaveRef = useRef(onSave);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.srcdoc = injectEditorScript(html);
    }
  }, [html]);

  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; html?: string; base64?: string; mimeType?: string };
      if (data?.type === "lp-editor-save" && data.html) {
        onSaveRef.current(data.html);
        setSavedBadge(true);
        setTimeout(() => setSavedBadge(false), 3500);
      } else if (data?.type === "lp-editor-exit") {
        onCloseRef.current();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const showStorePicker = stores && stores.length > 1 && onStoreChange;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#080c18]" dir="rtl">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#0d1425] border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Pencil className="w-4 h-4 text-orange-400 flex-shrink-0" />
          <span className="text-sm text-gray-200 font-medium truncate">
            تعديل: {headline || "الصفحة"}
          </span>
          {savedBadge && (
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
              <CheckCircle2 className="w-3 h-3" />تم الحفظ — جاهز للنشر
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {showStorePicker && (
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
              <Globe className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span className="text-[10px] text-gray-400 whitespace-nowrap">نشر على:</span>
              <select
                value={selectedStoreId ?? ""}
                onChange={e => onStoreChange(Number(e.target.value))}
                className="bg-transparent text-[11px] text-white font-medium appearance-none cursor-pointer focus:outline-none"
                style={{ colorScheme: "dark" }}>
                {stores.map(s => (
                  <option key={s.id} value={s.id} style={{ background: "#1a2035", color: "#fff" }}>
                    {s.shopName || s.domain}{s.isDefault ? " ★" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <span className="text-[10px] text-gray-500">اضغط ✕ بالـ toolbar داخل الصفحة للخروج • أو</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          title="محرر صفحة البيع"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
        />
      </div>
    </div>
  );
}

// ─── Full-screen Preview Modal ───────────────────────────────────────────────
interface PreviewModalProps {
  headline: string;
  model: string;
  html: string | null;
  loading: boolean;
  error: string;
  isCached?: boolean;
  onClose: () => void;
}

function PreviewModal({ headline, model, html, loading, error, isCached, onClose }: PreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showCacheBadge, setShowCacheBadge] = useState(!!isCached);

  useEffect(() => {
    if (iframeRef.current && html) {
      iframeRef.current.srcdoc = html;
    }
  }, [html]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!showCacheBadge) return;
    const timer = setTimeout(() => setShowCacheBadge(false), 2000);
    return () => clearTimeout(timer);
  }, [showCacheBadge]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#080c18]" dir="rtl">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#0d1425] border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-sm text-gray-200 font-medium truncate">
            {headline || "معاينة الصفحة"}
          </span>
          {model && model !== "Auto" && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-orange-500/10 text-orange-400 border border-orange-500/20 flex-shrink-0">
              {model}
            </span>
          )}
          {showCacheBadge && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
              ⚡ محفوظة مؤقتاً
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
          title="إغلاق"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#080c18] z-10">
            <div className="w-16 h-16 rounded-full border-2 border-emerald-500/20 flex items-center justify-center mb-4">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
            <p className="text-sm text-gray-300 font-medium">جاري تحميل المعاينة...</p>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#080c18] z-10">
            <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}
        {html && !loading && (
          <iframe
            ref={iframeRef}
            className="w-full h-full border-0"
            title="معاينة صفحة البيع"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        )}
      </div>
    </div>
  );
}

// ─── Shared inline copy button ────────────────────────────────────────────────
function AdCopyBtn({ text }: { text: string }) {
  const { toast } = useToast();
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        toast({ title: "تم النسخ ✓", description: text.slice(0, 60) + (text.length > 60 ? "..." : "") });
      }}
      className="flex-shrink-0 p-1 rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
      title="نسخ"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    </button>
  );
}

// ─── Ad Campaign Assets Panel ─────────────────────────────────────────────────
interface AdPanelProps {
  adCreatives: AdCreatives;
  isRefreshing: boolean;
  onRefresh: () => void;
}

function AdPanel({ adCreatives, isRefreshing, onRefresh }: AdPanelProps) {
  const [tab, setTab] = useState<"scripts" | "meta" | "google" | "tiktok">("scripts");
  const [open, setOpen] = useState(true);

  const tabs = [
    { key: "scripts" as const, label: "🎥 سكريبتات فيديو" },
    { key: "meta"    as const, label: "📘 Meta Ads" },
    { key: "google"  as const, label: "🔍 Google Ads" },
    { key: "tiktok"  as const, label: "🎵 TikTok Ads" },
  ];

  return (
    <div className="border-t border-white/10 bg-[#090e1c] flex-shrink-0" dir="rtl">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <span className="text-xs font-bold text-violet-400 whitespace-nowrap">📱 Ad Campaign Assets</span>
        <div className="flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-none">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); if (!open) setOpen(true); }}
              className={cn(
                "px-2 py-1 rounded text-[11px] font-semibold whitespace-nowrap transition-colors flex-shrink-0",
                tab === t.key && open
                  ? "bg-violet-600/30 text-violet-300 border border-violet-500/40"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-violet-700/30 text-violet-300 border border-violet-500/30 hover:bg-violet-700/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          {isRefreshing
            ? <><Loader2 className="w-3 h-3 animate-spin" />جاري...</>
            : <><RefreshCw className="w-3 h-3" />تجديد الإعلانات</>}
        </button>
        <button
          onClick={() => setOpen(p => !p)}
          className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>
      {open && (
        <div className="h-56 overflow-y-auto overflow-x-hidden px-3 py-2.5 space-y-2 text-xs">
          {tab === "scripts" && (
            <div className="space-y-3">
              {(adCreatives.scripts ?? []).map((s, i) => (
                <div key={s.title || String(i)} className="rounded-lg border border-white/8 bg-white/3 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-white text-[12px]">{s.title}</span>
                    <AdCopyBtn text={[s.title, s.hook_first_3_seconds, s.body_script, s.visual_idea].join("\n\n")} />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-1.5">
                      <span className="text-[10px] font-bold text-orange-400 whitespace-nowrap mt-0.5">⚡ الهوك (3 ثوانٍ):</span>
                      <span className="text-gray-300 leading-relaxed">{s.hook_first_3_seconds}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[10px] font-bold text-blue-400 whitespace-nowrap mt-0.5">📝 السكريبت:</span>
                      <span className="text-gray-400 leading-relaxed">{s.body_script}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[10px] font-bold text-green-400 whitespace-nowrap mt-0.5">🎬 الفيجوال:</span>
                      <span className="text-gray-500 leading-relaxed">{s.visual_idea}</span>
                    </div>
                  </div>
                </div>
              ))}
              {!adCreatives.scripts?.length && <p className="text-gray-600 text-center py-8">لا توجد سكريبتات</p>}
            </div>
          )}
          {tab === "meta" && (
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-bold text-blue-400 mb-1.5 uppercase tracking-wide">Primary Texts (5) — نصوص Meta الكاملة</p>
                {(adCreatives.meta_ads?.primary_texts ?? []).map((t, i) => (
                  <div key={t.slice(0, 50)} className="rounded-lg border border-white/8 bg-white/3 p-3 mb-2">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-bold text-blue-400">نص {i + 1}</span>
                      <AdCopyBtn text={t} />
                    </div>
                    <span className="text-gray-300 flex-1 leading-relaxed whitespace-pre-wrap text-[12px] block">{t}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] font-bold text-indigo-400 mb-1.5 uppercase tracking-wide">Headlines (5)</p>
                {(adCreatives.meta_ads?.headlines ?? []).map((h, i) => (
                  <div key={h} className="flex items-center gap-2 py-1 border-b border-white/5 last:border-0">
                    <span className="text-gray-500 text-[10px] w-4 flex-shrink-0">{i + 1}.</span>
                    <span className="text-gray-200 flex-1 font-medium">{h}</span>
                    <AdCopyBtn text={h} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {tab === "google" && (
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-bold text-green-400 mb-1.5 uppercase tracking-wide">Short Headlines — max 30 chars (10)</p>
                <div className="grid grid-cols-2 gap-x-3">
                  {(adCreatives.google_ads?.short_headlines ?? []).map((h, i) => (
                    <div key={h} className="flex items-center gap-1.5 py-1 border-b border-white/5">
                      <span className="text-gray-500 text-[10px] w-4 flex-shrink-0">{i + 1}.</span>
                      <span className="text-gray-200 flex-1 text-[11px] truncate">{h}</span>
                      <span className={cn("text-[9px] flex-shrink-0", h.length > 30 ? "text-red-400" : "text-gray-600")}>{h.length}</span>
                      <AdCopyBtn text={h} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold text-teal-400 mb-1.5 uppercase tracking-wide">Long Headlines — max 90 chars (10)</p>
                {(adCreatives.google_ads?.long_headlines ?? []).map((h, i) => (
                  <div key={h} className="flex items-center gap-2 py-1 border-b border-white/5">
                    <span className="text-gray-500 text-[10px] w-4 flex-shrink-0">{i + 1}.</span>
                    <span className="text-gray-200 flex-1">{h}</span>
                    <span className={cn("text-[9px] flex-shrink-0", h.length > 90 ? "text-red-400" : "text-gray-600")}>{h.length}</span>
                    <AdCopyBtn text={h} />
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] font-bold text-cyan-400 mb-1.5 uppercase tracking-wide">Descriptions — max 90 chars (10)</p>
                {(adCreatives.google_ads?.descriptions ?? []).map((d, i) => (
                  <div key={d} className="flex items-start gap-2 py-1 border-b border-white/5">
                    <span className="text-gray-500 text-[10px] w-4 flex-shrink-0 mt-0.5">{i + 1}.</span>
                    <span className="text-gray-400 flex-1 leading-relaxed">{d}</span>
                    <span className={cn("text-[9px] flex-shrink-0 mt-0.5", d.length > 90 ? "text-red-400" : "text-gray-600")}>{d.length}</span>
                    <AdCopyBtn text={d} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {tab === "tiktok" && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-pink-400 mb-1.5 uppercase tracking-wide">TikTok Captions — نصوص كاملة مع هاشتاج (5)</p>
              {(adCreatives.tiktok_ads?.captions ?? []).map((c, i) => (
                <div key={c.slice(0, 50)} className="rounded-lg border border-pink-500/20 bg-pink-500/5 p-3 mb-2">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-bold text-pink-400">كابشن {i + 1}</span>
                    <AdCopyBtn text={c} />
                  </div>
                  <span className="text-gray-200 flex-1 leading-relaxed whitespace-pre-wrap text-[12px] block">{c}</span>
                </div>
              ))}
              {!adCreatives.tiktok_ads?.captions?.length && <p className="text-gray-600 text-center py-8">لا توجد كابشنات</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PageAnalytics {
  sessions: number;
  conversions: number;
  conversionRate: number;
}

// ─── Import-from-URL modal ────────────────────────────────────────────────────
interface ImportModalProps {
  onClose: () => void;
  onProductCreated: (p: ShopifyProduct) => void;
  storeId?: number | null;
}

function ImportModal({ onClose, onProductCreated, storeId }: ImportModalProps) {
  const [step, setStep] = useState<"url" | "scraping" | "preview" | "creating" | "done">("url");
  const [importUrl, setImportUrl] = useState("");
  const [scrapeError, setScrapeError] = useState("");
  const [createError, setCreateError] = useState("");
  const [scraped, setScraped] = useState<{ title: string; description: string; bodyHtml?: string; images: string[]; urlOnly?: boolean } | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [price, setPrice] = useState("");
  const [isManualMode, setIsManualMode] = useState(false);

  const isCaptchaError = scrapeError.includes("CAPTCHA") || scrapeError.includes("حظر") || scrapeError.includes("التحقق");

  function enterManualMode() {
    setIsManualMode(true);
    setScraped({ title: "", description: "", images: [] });
    setEditTitle("");
    setEditDesc("");
    setSelectedImages([]);
    setStep("preview");
    setScrapeError("");
  }

  async function handleScrape() {
    if (!importUrl.startsWith("http")) { setScrapeError("أدخل رابطاً صحيحاً يبدأ بـ https://"); return; }
    setScrapeError("");
    setStep("scraping");
    try {
      const scrapeBody: ShopifyProductScrapeRequest = { url: importUrl };
      const res = await fetch("/api/shopify/products/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scrapeBody),
      });
      const data = await res.json() as { success?: boolean; title?: string; description?: string; body_html?: string; images?: string[]; error?: string; urlOnlyMode?: boolean };
      if (!res.ok || !data.success) { setScrapeError(data.error || "فشل جلب البيانات"); setStep("url"); return; }
      setScraped({ title: data.title!, description: data.description ?? "", bodyHtml: data.body_html, images: data.images ?? [], urlOnly: data.urlOnlyMode });
      setEditTitle(data.title!);
      setEditDesc(data.description ?? "");
      setSelectedImages(data.images?.slice(0, 4) ?? []);
      setStep("preview");
    } catch {
      setScrapeError("خطأ في الاتصال بالخادم");
      setStep("url");
    }
  }

  async function handleCreate() {
    if (!editTitle.trim()) { setCreateError("أدخل اسم المنتج"); return; }
    const priceNum = parseFloat(price);
    if (!price || isNaN(priceNum) || priceNum <= 0) { setCreateError("أدخل سعراً صحيحاً"); return; }
    setCreateError("");
    setStep("creating");
    try {
      const createBody: ShopifyProductCreateRequest = {
        title: editTitle.trim(),
        description: editDesc.trim(),
        bodyHtml: scraped?.bodyHtml || undefined,
        price: String(priceNum),
        images: selectedImages,
        storeId: storeId ?? undefined,
      };
      const res = await fetch("/api/shopify/products/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createBody),
      });
      const data = await res.json() as { success?: boolean; product?: ShopifyProduct; error?: string };
      if (!res.ok || !data.success || !data.product) { setCreateError(data.error || "فشل إنشاء المنتج"); setStep("preview"); return; }
      onProductCreated(data.product);
      setStep("done");
    } catch {
      setCreateError("خطأ في الاتصال بالخادم");
      setStep("preview");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.65)" }}>
      <div dir="rtl" className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-orange-500" />
            <span className="font-bold text-gray-900">استيراد منتج من رابط</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 rounded-lg p-1 hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {(step === "url" || step === "scraping") && (
            <div className="space-y-4">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-xs text-orange-800">
                <p className="font-bold">🤖 Gemini يسحب بيانات المنتج أوتوماتيك</p>
                <p className="text-gray-500 mt-1">متوافق مع: Amazon، AliExpress، أي متجر إلكتروني</p>
              </div>
              <input type="url" value={importUrl} onChange={e => { setImportUrl(e.target.value); setScrapeError(""); }}
                onKeyDown={e => e.key === "Enter" && handleScrape()}
                placeholder="https://www.amazon.com/dp/..." disabled={step === "scraping"}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50"
                style={{ direction: "ltr", textAlign: "left", color: "#111827", background: "#fff" }} />
              {scrapeError && (
                <div className="space-y-2">
                  <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{scrapeError}</p>
                  {isCaptchaError && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-amber-800 font-semibold">💡 حل بديل — أدخل البيانات يدوياً</p>
                      <p className="text-[11px] text-amber-700">الموقع يمنع الجلب التلقائي. يمكنك إدخال اسم المنتج ووصفه يدوياً بدلاً من الاستيراد.</p>
                      <button onClick={enterManualMode}
                        className="w-full flex items-center justify-center gap-2 font-bold py-2 rounded-lg text-xs text-white"
                        style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}>
                        ✏️ إدخال البيانات يدوياً
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button onClick={handleScrape} disabled={step === "scraping" || !importUrl.startsWith("http")}
                className="w-full flex items-center justify-center gap-2 font-bold py-3 rounded-xl text-sm transition-all disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white"
                style={step !== "scraping" && importUrl.startsWith("http") ? { background: "linear-gradient(135deg,#f97316,#ef4444)" } : {}}>
                {step === "scraping" ? <><Loader2 className="w-4 h-4 animate-spin" />Gemini يحلل الصفحة...</> : <><Sparkles className="w-4 h-4" />جلب بيانات المنتج</>}
              </button>
              <button onClick={enterManualMode}
                className="w-full text-xs text-gray-400 hover:text-gray-600 py-1 transition-colors">
                أو أدخل بيانات المنتج يدوياً
              </button>
            </div>
          )}
          {(step === "preview" || step === "creating") && scraped && (
            <div className="space-y-3">
              {isManualMode && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-700 font-medium">
                  ✏️ وضع الإدخال اليدوي — أدخل بيانات المنتج أدناه ثم اضغط حفظ
                </div>
              )}
              {scraped?.urlOnly && !isManualMode && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800 space-y-0.5">
                  <div>⚡ الموقع لا يسمح بالوصول التلقائي — تم استخراج البيانات من الرابط بواسطة Gemini</div>
                  {scraped.images.length > 0 && (
                    <div className="text-amber-700">🔍 الصور من منتجات مشابهة على AliExpress — تحقق منها وأزل غير المناسبة</div>
                  )}
                </div>
              )}
              <button onClick={() => { setStep("url"); setIsManualMode(false); }} disabled={step === "creating"} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 disabled:opacity-40">← {isManualMode ? "رجوع" : "تغيير الرابط"}</button>
              <div>
                <label className="text-sm font-semibold text-gray-700 block mb-1">اسم المنتج</label>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)} disabled={step === "creating"}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50" />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 block mb-1">وصف المنتج</label>
                {scraped.bodyHtml ? (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 border-b border-gray-100 px-3 py-1.5 flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">معاينة المحتوى التسويقي</span>
                      <button onClick={() => setScraped(s => s ? { ...s, bodyHtml: undefined } : s)}
                        className="text-[10px] text-orange-500 hover:text-orange-700">تحرير نصي</button>
                    </div>
                    <div className="max-h-56 overflow-y-auto bg-white p-3 text-sm text-gray-800" dir="rtl"
                      dangerouslySetInnerHTML={{ __html: scraped.bodyHtml }} />
                  </div>
                ) : (
                  <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} disabled={step === "creating"}
                    rows={3} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none disabled:bg-gray-50" />
                )}
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 block mb-1">السعر (جنيه)</label>
                <input type="number" value={price} onChange={e => setPrice(e.target.value)} disabled={step === "creating"}
                  placeholder="350" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50"
                  style={{ direction: "ltr" }} />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 block mb-1">
                  الصور {selectedImages.length > 0 ? `(${selectedImages.length} محددة)` : ""}
                </label>
                {scraped.images.length === 0 && (
                  <div className="mb-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    {/temu\.com/i.test(importUrl)
                      ? "⚠️ Temu يمنع جلب الصور تلقائياً — الصق رابط الصورة مباشرةً من صفحة المنتج ثم اضغط «إضافة»"
                      : "⚠️ لم يتم جلب أي صور من هذا الموقع — أضف روابط الصور يدوياً أدناه"}
                  </div>
                )}
                {scraped.images.length > 0 && (
                  <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                    {scraped.images.slice(0, 8).map((img) => (
                      <button key={img} onClick={() => setSelectedImages(prev => prev.includes(img) ? prev.filter(u => u !== img) : [...prev, img])}
                        className={cn("relative aspect-square rounded-lg overflow-hidden border-2 transition-all",
                          selectedImages.includes(img) ? "border-orange-400 ring-1 ring-orange-200" : "border-gray-200 opacity-60 hover:opacity-80")}>
                        <img src={img} alt="" className="w-full h-full object-cover" />
                        {selectedImages.includes(img) && (
                          <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center">
                            <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {selectedImages.length > 0 && scraped.images.length === 0 && (
                  <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                    {selectedImages.map((img) => (
                      <button key={img} onClick={() => setSelectedImages(prev => prev.filter(u => u !== img))}
                        className="relative aspect-square rounded-lg overflow-hidden border-2 border-orange-400 ring-1 ring-orange-200 transition-all">
                        <img src={img} alt="" className="w-full h-full object-cover" />
                        <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center">
                          <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input value={manualImageUrl} onChange={e => setManualImageUrl(e.target.value)}
                    placeholder="https://... الصق رابط الصورة"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-orange-400"
                    style={{ direction: "ltr" }}
                    onKeyDown={e => { if (e.key === "Enter" && manualImageUrl.startsWith("http")) { setSelectedImages(p => [...p, manualImageUrl]); setScraped(s => s ? { ...s, images: [...s.images, manualImageUrl] } : s); setManualImageUrl(""); } }} />
                  <button onClick={() => { if (manualImageUrl.startsWith("http")) { setSelectedImages(p => [...p, manualImageUrl]); setScraped(s => s ? { ...s, images: [...s.images, manualImageUrl] } : s); setManualImageUrl(""); } }}
                    className="text-xs px-3 py-1.5 bg-orange-500 text-white rounded-lg font-bold hover:bg-orange-600">إضافة</button>
                </div>
              </div>
              {createError && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{createError}</p>}
              <button onClick={handleCreate} disabled={step === "creating"}
                className="w-full flex items-center justify-center gap-2 font-bold py-3 rounded-xl text-sm text-white transition-all"
                style={{ background: "linear-gradient(135deg,#f97316,#ef4444)" }}>
                {step === "creating" ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الإنشاء...</> : "إنشاء المنتج على Shopify"}
              </button>
            </div>
          )}
          {step === "done" && (
            <div className="text-center py-8 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
              <p className="font-bold text-gray-900">تم إنشاء المنتج بنجاح!</p>
              <button onClick={onClose} className="text-sm text-orange-600 hover:underline">إغلاق وبدء توليد الصفحة</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Inline Library Panel ─────────────────────────────────────────────────────
function formatDate(iso: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

// ── SaResultPanel — filtered AdPanel for Standalone Ad Generator ─────────────
interface SaResultPanelProps {
  adCreatives: AdCreatives;
  activePlatforms: Record<"scripts"|"meta"|"google"|"tiktok", boolean>;
  platforms: { key: "scripts"|"meta"|"google"|"tiktok"; label: string; icon: string }[];
  isRefreshing: boolean;
  onRefresh: () => void;
}
function SaResultPanel({ adCreatives, activePlatforms, platforms, isRefreshing, onRefresh }: SaResultPanelProps) {
  const visiblePlatforms = platforms.filter(p => activePlatforms[p.key]);
  const [tab, setTab] = useState<"scripts"|"meta"|"google"|"tiktok">(visiblePlatforms[0]?.key ?? "scripts");
  const activeTab = visiblePlatforms.find(p => p.key === tab) ? tab : (visiblePlatforms[0]?.key ?? "scripts");

  return (
    <div className="rounded-xl border border-white/10 bg-[#09101f] overflow-hidden">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/8 flex-wrap">
        {visiblePlatforms.map(p => (
          <button key={p.key} onClick={() => setTab(p.key)}
            className={cn("px-2.5 py-1 rounded text-[11px] font-semibold whitespace-nowrap transition-colors",
              activeTab === p.key ? "bg-violet-600/30 text-violet-300 border border-violet-500/40" : "text-gray-500 hover:text-gray-300 hover:bg-white/5")}
          >{p.icon} {p.label}</button>
        ))}
        <button onClick={onRefresh} disabled={isRefreshing}
          className="mr-auto flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-violet-700/20 text-violet-400 border border-violet-500/20 hover:bg-violet-700/40 transition-colors disabled:opacity-40">
          {isRefreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          تجديد
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto px-3 py-2.5 space-y-2 text-xs">
        {activeTab === "scripts" && (
          <div className="space-y-3">
            {(adCreatives.scripts ?? []).map((s, i) => (
              <div key={s.title || String(i)} className="rounded-lg border border-white/8 bg-white/3 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold text-white text-[12px]">{s.title}</span>
                  <AdCopyBtn text={[s.title, s.hook_first_3_seconds, s.body_script, s.visual_idea].join("\n\n")} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-start gap-1.5"><span className="text-[10px] font-bold text-orange-400 whitespace-nowrap mt-0.5">⚡ الهوك:</span><span className="text-gray-300 leading-relaxed">{s.hook_first_3_seconds}</span></div>
                  <div className="flex items-start gap-1.5"><span className="text-[10px] font-bold text-blue-400 whitespace-nowrap mt-0.5">📝 السكريبت:</span><span className="text-gray-400 leading-relaxed">{s.body_script}</span></div>
                  <div className="flex items-start gap-1.5"><span className="text-[10px] font-bold text-green-400 whitespace-nowrap mt-0.5">🎬 الفيجوال:</span><span className="text-gray-500 leading-relaxed">{s.visual_idea}</span></div>
                </div>
              </div>
            ))}
            {!adCreatives.scripts?.length && <p className="text-gray-600 text-center py-6">لا توجد سكريبتات</p>}
          </div>
        )}
        {activeTab === "meta" && (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold text-blue-400 mb-1.5">Primary Texts</p>
              {(adCreatives.meta_ads?.primary_texts ?? []).map((t, i) => (
                <div key={t} className="flex items-start gap-2 py-1.5 border-b border-white/5 last:border-0">
                  <span className="text-gray-500 text-[10px] mt-0.5 w-4 flex-shrink-0">{i+1}.</span>
                  <span className="text-gray-300 flex-1 leading-relaxed">{t}</span>
                  <AdCopyBtn text={t} />
                </div>
              ))}
            </div>
            <div>
              <p className="text-[10px] font-bold text-indigo-400 mb-1.5">Headlines</p>
              {(adCreatives.meta_ads?.headlines ?? []).map((h, i) => (
                <div key={h} className="flex items-center gap-2 py-1 border-b border-white/5 last:border-0">
                  <span className="text-gray-500 text-[10px] w-4 flex-shrink-0">{i+1}.</span>
                  <span className="text-gray-200 flex-1 font-medium">{h}</span>
                  <AdCopyBtn text={h} />
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === "google" && (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold text-green-400 mb-1.5">Short Headlines — max 30 chars</p>
              <div className="grid grid-cols-2 gap-x-3">
                {(adCreatives.google_ads?.short_headlines ?? []).map((h, i) => (
                  <div key={h} className="flex items-center gap-1.5 py-1 border-b border-white/5">
                    <span className="text-gray-500 text-[10px] w-4 flex-shrink-0">{i+1}.</span>
                    <span className="text-gray-200 flex-1 text-[11px] truncate">{h}</span>
                    <span className={cn("text-[9px] flex-shrink-0", h.length > 30 ? "text-red-400" : "text-gray-600")}>{h.length}</span>
                    <AdCopyBtn text={h} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold text-teal-400 mb-1.5">Long Headlines — max 90 chars</p>
              {(adCreatives.google_ads?.long_headlines ?? []).map((h, i) => (
                <div key={h} className="flex items-center gap-2 py-1 border-b border-white/5">
                  <span className="text-gray-500 text-[10px] w-4 flex-shrink-0">{i+1}.</span>
                  <span className="text-gray-200 flex-1">{h}</span>
                  <span className={cn("text-[9px] flex-shrink-0", h.length > 90 ? "text-red-400" : "text-gray-600")}>{h.length}</span>
                  <AdCopyBtn text={h} />
                </div>
              ))}
            </div>
            <div>
              <p className="text-[10px] font-bold text-cyan-400 mb-1.5">Descriptions — max 90 chars</p>
              {(adCreatives.google_ads?.descriptions ?? []).map((d, i) => (
                <div key={d} className="flex items-start gap-2 py-1 border-b border-white/5">
                  <span className="text-gray-500 text-[10px] w-4 flex-shrink-0 mt-0.5">{i+1}.</span>
                  <span className="text-gray-400 flex-1 leading-relaxed">{d}</span>
                  <span className={cn("text-[9px] flex-shrink-0 mt-0.5", d.length > 90 ? "text-red-400" : "text-gray-600")}>{d.length}</span>
                  <AdCopyBtn text={d} />
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === "tiktok" && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-pink-400 mb-1.5">TikTok Captions — max 80 chars</p>
            {(adCreatives.tiktok_ads?.captions ?? []).map((c, i) => (
              <div key={c} className="flex items-start gap-2 p-2.5 rounded-lg border border-white/8 bg-white/3">
                <span className="text-gray-500 text-[10px] w-4 flex-shrink-0 mt-0.5">{i+1}.</span>
                <span className="text-gray-200 flex-1 leading-relaxed">{c}</span>
                <span className={cn("text-[9px] flex-shrink-0 mt-0.5", c.length > 80 ? "text-red-400" : "text-gray-600")}>{c.length}</span>
                <AdCopyBtn text={c} />
              </div>
            ))}
            {!adCreatives.tiktok_ads?.captions?.length && <p className="text-gray-600 text-center py-6">لا توجد كابشنات</p>}
          </div>
        )}
      </div>
    </div>
  );
}

interface LibraryPanelProps {
  onRegenerate: (productId: string, frameworkKey: FrameworkKey) => void;
  onPreview: (pageId: number, headline: string, model: string) => void;
  onEdit: (page: PageRecord) => void;
  onClearPreviewCache: () => void;
  onEvictCacheEntry: (id: number) => void;
  onWarmCache: (pages: Array<{ id: number; headline: string; model: string }>) => void;
  onGa4StatusChange?: (connected: boolean) => void;
}

const WARM_CACHE_LIMIT = 5;

function LibraryPanel({ onRegenerate, onPreview, onEdit, onClearPreviewCache, onEvictCacheEntry, onWarmCache, onGa4StatusChange }: LibraryPanelProps) {
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);

  const [saOpen, setSaOpen] = useState(false);
  const [saUrl, setSaUrl] = useState("");
  const [saProductName, setSaProductName] = useState("");
  const [saPlatforms, setSaPlatforms] = useState<Record<"scripts"|"meta"|"google"|"tiktok", boolean>>(
    { scripts: true, meta: true, google: true, tiktok: true }
  );
  const [saLoading, setSaLoading] = useState(false);
  const [saResult, setSaResult] = useState<AdCreatives | null>(null);
  const [saRefreshing, setSaRefreshing] = useState(false);
  const [_saLastBody, setSaLastBody] = useState<Record<string,unknown> | null>(null);

  async function saGenerate(isRefresh = false) {
    const url = saUrl.trim();
    const name = saProductName.trim();
    if (!url && !name) {
      toast({ title: "أدخل رابط الصفحة أو اسم المنتج على الأقل", variant: "destructive" });
      return;
    }
    if (url) {
      try { new URL(url); } catch {
        toast({ title: "رابط الصفحة غير صالح", variant: "destructive" });
        return;
      }
    }
    const body = { productName: name, pageUrl: url || undefined, isRefresh, selectedFramework: "Auto" };
    setSaLastBody(body);
    if (isRefresh) setSaRefreshing(true); else setSaLoading(true);
    if (!isRefresh) setSaResult(null);
    try {
      const res = await fetch("/api/landing-page/regenerate-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { success?: boolean; adCreatives?: AdCreatives; error?: string };
      if (data.adCreatives) {
        setSaResult(data.adCreatives);
        if (!isRefresh) toast({ title: "✓ تم توليد النصوص الإعلانية" });
      } else {
        toast({ title: data.error ?? "فشل التوليد — حاول مجدداً", variant: "destructive" });
      }
    } catch {
      toast({ title: "خطأ في الاتصال بالخادم", variant: "destructive" });
    } finally {
      setSaLoading(false);
      setSaRefreshing(false);
    }
  }

  const [adsByPage, setAdsByPage] = useState<Record<number, AdCreatives>>({});
  const [adsLoadingPage, setAdsLoadingPage] = useState<number | null>(null);
  const [adsOpenPage, setAdsOpenPage] = useState<number | null>(null);

  async function fetchAdsForPage(page: PageRecord) {
    if (adsLoadingPage !== null) return;
    if (adsOpenPage === page.id && adsByPage[page.id]) {
      setAdsOpenPage(null);
      return;
    }
    if (adsByPage[page.id]) {
      setAdsOpenPage(page.id);
      return;
    }
    setAdsLoadingPage(page.id);
    setAdsOpenPage(page.id);
    try {
      const res = await fetch("/api/landing-page/regenerate-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: page.productName,
          selectedFramework: page.lpModel || "Auto",
          recordId: page.id,
          isRefresh: false,
        }),
      });
      const data = await res.json() as { success?: boolean; adCreatives?: AdCreatives; error?: string };
      if (data.adCreatives) {
        setAdsByPage(prev => ({ ...prev, [page.id]: data.adCreatives! }));
        toast({ title: "✓ تم توليد النصوص الإعلانية من زاوية الصفحة" });
      } else {
        toast({ title: data.error ?? "فشل التوليد — حاول مجدداً", variant: "destructive" });
        setAdsOpenPage(null);
      }
    } catch {
      toast({ title: "خطأ في الاتصال بالخادم", variant: "destructive" });
      setAdsOpenPage(null);
    } finally {
      setAdsLoadingPage(null);
    }
  }

  async function refreshAdsForPage(page: PageRecord) {
    if (adsLoadingPage !== null) return;
    setAdsLoadingPage(page.id);
    try {
      const res = await fetch("/api/landing-page/regenerate-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: page.productName,
          selectedFramework: page.lpModel || "Auto",
          recordId: page.id,
          isRefresh: true,
        }),
      });
      const data = await res.json() as { success?: boolean; adCreatives?: AdCreatives; error?: string };
      if (data.adCreatives) {
        setAdsByPage(prev => ({ ...prev, [page.id]: data.adCreatives! }));
        toast({ title: "✓ تم تجديد النصوص بأفكار مختلفة" });
      } else {
        toast({ title: "فشل التجديد — حاول مجدداً", variant: "destructive" });
      }
    } catch {
      toast({ title: "خطأ في الاتصال بالخادم", variant: "destructive" });
    } finally {
      setAdsLoadingPage(null);
    }
  }

  const [analytics, setAnalytics] = useState<Record<string, PageAnalytics>>({});
  const [ga4Available, setGa4Available] = useState(false);
  const [ga4BannerDismissed, setGa4BannerDismissed] = useState(false);

  const [fetchVersion, setFetchVersion] = useState(0);
  const [fetchedVersion, setFetchedVersion] = useState(-1);
  const [analyticsLoadedVersion, setAnalyticsLoadedVersion] = useState(-1);
  const loading = fetchedVersion < fetchVersion;
  const analyticsLoading = analyticsLoadedVersion < fetchVersion;

  useEffect(() => {
    let cancelled = false;
    async function doFetch() {
      try {
        const res = await fetch("/api/landing-page-records");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { products: ProductGroup[]; total: number };
        if (cancelled) return;
        setProducts(json.products);
        setTotal(json.total);
        setError(null);
        onClearPreviewCache();
        const allPages: Array<{ id: number; headline: string; model: string }> = [];
        const savedAds: Record<number, AdCreatives> = {};
        for (const group of json.products) {
          for (const page of group.pages) {
            allPages.push({ id: page.id, headline: page.headline, model: page.lpModel });
            if (page.adCreatives) savedAds[page.id] = page.adCreatives as AdCreatives;
          }
        }
        if (Object.keys(savedAds).length > 0) {
          setAdsByPage(prev => ({ ...savedAds, ...prev }));
        }
        if (allPages.length > 0) onWarmCache(allPages);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "خطأ في التحميل");
      } finally {
        if (!cancelled) setFetchedVersion(fetchVersion);
      }
    }
    async function doAnalytics() {
      try {
        const res = await fetch("/api/landing-page-records/analytics");
        if (!res.ok) return;
        const json = await res.json() as { analytics: Record<string, PageAnalytics>; ga4Available: boolean };
        if (cancelled) return;
        setAnalytics(json.analytics);
        setGa4Available(json.ga4Available);
        onGa4StatusChange?.(json.ga4Available);
      } catch { } finally {
        if (!cancelled) setAnalyticsLoadedVersion(fetchVersion);
      }
    }
    void doFetch();
    void doAnalytics();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchVersion]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    setDeleting(id);
    try {
      const res = await fetch(`/api/landing-page-records/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("فشل الحذف");
      const data = await res.json() as { success: boolean; shopifyDeleted?: boolean };
      const updatedProducts = products
        .map(g => ({ ...g, pages: g.pages.filter(p => p.id !== id) }))
        .filter(g => g.pages.length > 0);
      setProducts(updatedProducts);
      setTotal(t => Math.max(0, t - 1));
      onEvictCacheEntry(id);
      const firstPages: Array<{ id: number; headline: string; model: string }> = [];
      outer: for (const group of updatedProducts) {
        for (const page of group.pages) {
          firstPages.push({ id: page.id, headline: page.headline, model: page.lpModel });
          if (firstPages.length >= WARM_CACHE_LIMIT) break outer;
        }
      }
      if (firstPages.length > 0) onWarmCache(firstPages);
      if (data.shopifyDeleted) {
        toast({ title: "تم الحذف من Shopify والسجلات ✓" });
      } else {
        toast({ title: "تم حذف السجل", description: "الصفحة قد تبقى على Shopify" });
      }
    } catch {
      toast({ title: "فشل الحذف — حاول مرة أخرى", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  }

  function toggleProduct(productId: string) {
    setExpanded(prev => ({ ...prev, [productId]: !prev[productId] }));
  }

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => products.filter(g => {
    if (!q) return true;
    if (g.productName.toLowerCase().includes(q)) return true;
    if (g.productHandle.toLowerCase().includes(q)) return true;
    return g.pages.some(p => p.headline.toLowerCase().includes(q) || p.pageUrl.toLowerCase().includes(q));
  }), [products, q]);

  useEffect(() => {
    if (filtered.length === 0) return;
    const firstPages: Array<{ id: number; headline: string; model: string }> = [];
    outer: for (const group of filtered) {
      for (const page of group.pages) {
        firstPages.push({ id: page.id, headline: page.headline, model: page.lpModel });
        if (firstPages.length >= WARM_CACHE_LIMIT) break outer;
      }
    }
    if (firstPages.length > 0) onWarmCache(firstPages);
  }, [filtered, onWarmCache]);

  const totalSessions = ga4Available
    ? Object.values(analytics).reduce((s, a) => s + a.sessions, 0)
    : null;
  const avgCvr = ga4Available && Object.values(analytics).length > 0
    ? (Object.values(analytics).reduce((s, a) => s + a.conversionRate, 0) / Object.values(analytics).length).toFixed(1)
    : null;

  const SA_PLATFORMS: { key: "scripts"|"meta"|"google"|"tiktok"; label: string; icon: string }[] = [
    { key: "scripts", label: "سكريبت فيديو",  icon: "🎥" },
    { key: "meta",    label: "Meta Ads",        icon: "📘" },
    { key: "google",  label: "Google Ads",      icon: "🔍" },
    { key: "tiktok",  label: "TikTok Ads",      icon: "🎵" },
  ];

  return (
    <div dir="rtl" className="flex-1 overflow-y-auto p-5 space-y-4" style={{ scrollbarWidth: "thin", scrollbarColor: "#374151 transparent" }}>

      {/* ── Standalone Ad Generator ── */}
      <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 overflow-hidden">
        <button
          onClick={() => setSaOpen(p => !p)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-violet-500/10 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-violet-400" />
            <span className="font-bold text-violet-300">توليد إعلانات من رابط صفحة</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30 font-semibold">NEW</span>
          </div>
          <ChevronDown className={cn("w-4 h-4 text-gray-500 transition-transform", saOpen && "rotate-180")} />
        </button>

        {saOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-violet-500/15">
            <div className="pt-3 space-y-1">
              <label className="text-xs font-semibold text-gray-400">رابط صفحة الهبوط</label>
              <input
                value={saUrl}
                onChange={e => setSaUrl(e.target.value)}
                placeholder="https://buzzpick.net/pages/..."
                dir="ltr"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-violet-500/60 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400">اسم المنتج <span className="text-gray-600 font-normal">(اختياري إذا أدخلت رابط)</span></label>
              <input
                value={saProductName}
                onChange={e => setSaProductName(e.target.value)}
                placeholder="مثال: كريم إزالة الشعر"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-violet-500/60 transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400">المنصات</label>
              <div className="flex flex-wrap gap-2">
                {SA_PLATFORMS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setSaPlatforms(prev => ({ ...prev, [p.key]: !prev[p.key] }))}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all",
                      saPlatforms[p.key]
                        ? "bg-violet-600/25 border-violet-500/50 text-violet-300"
                        : "bg-white/3 border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/5",
                    )}
                  >
                    <span className={cn(
                      "w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 text-[9px]",
                      saPlatforms[p.key] ? "bg-violet-500 border-violet-500 text-white" : "border-white/20",
                    )}>
                      {saPlatforms[p.key] && "✓"}
                    </span>
                    {p.icon} {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => void saGenerate(false)}
                disabled={saLoading || saRefreshing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" />جاري التوليد...</>
                  : <><Sparkles className="w-4 h-4" />توليد الإعلانات</>}
              </button>
              {saResult && (
                <button
                  onClick={() => void saGenerate(true)}
                  disabled={saLoading || saRefreshing}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-xs font-semibold disabled:opacity-40 transition-colors"
                >
                  {saRefreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  تجديد
                </button>
              )}
            </div>
            {(saLoading && !saResult) && (
              <div className="flex items-center gap-2 py-6 justify-center text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                <span>Gemini يحلل الصفحة ويكتب الإعلانات...</span>
              </div>
            )}
            {saResult && (
              <SaResultPanel
                adCreatives={saResult}
                activePlatforms={saPlatforms}
                platforms={SA_PLATFORMS}
                isRefreshing={saRefreshing}
                onRefresh={() => void saGenerate(true)}
              />
            )}
          </div>
        )}
      </div>

      {/* Stats + Refresh */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {!loading && products.length > 0 && (
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <span className="text-gray-400">
              <span className="font-bold text-white">{products.length}</span> منتج
            </span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-400">
              <span className="font-bold text-white">{total}</span> صفحة منشورة
            </span>
            {ga4Available && totalSessions !== null && (
              <>
                <span className="text-gray-600">·</span>
                <span className="flex items-center gap-1 text-blue-400">
                  <Users className="w-3.5 h-3.5" />
                  <span className="font-bold">{totalSessions.toLocaleString("ar-EG")}</span>
                  <span className="text-gray-500 text-xs">زيارة</span>
                </span>
                <span className="text-gray-600">·</span>
                <span className="flex items-center gap-1 text-green-400">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span className="font-bold">{avgCvr}%</span>
                  <span className="text-gray-500 text-xs">CVR</span>
                </span>
              </>
            )}
          </div>
        )}
        <button
          onClick={() => setFetchVersion(v => v + 1)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", (loading || analyticsLoading) && "animate-spin")} />
          تحديث
        </button>
      </div>

      {/* GA4 not connected banner */}
      {!loading && !analyticsLoading && !ga4Available && !ga4BannerDismissed && products.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-blue-500/20 bg-blue-500/5 text-sm">
          <div className="flex items-center gap-2 text-blue-300">
            <TrendingUp className="w-4 h-4 flex-shrink-0 text-blue-400" />
            <span>ربط GA4 لرؤية بيانات الزيارات والتحويل لكل صفحة</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href="/settings#ga4"
              className="text-xs font-medium text-blue-400 hover:text-blue-300 hover:underline transition-colors"
            >
              إعداد GA4
            </Link>
            <button
              onClick={() => setGa4BannerDismissed(true)}
              className="text-gray-600 hover:text-gray-400 transition-colors"
              aria-label="إغلاق"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      {!loading && total > 0 && (
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث عن منتج أو عنوان صفحة..."
            className="w-full pr-9 pl-8 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/40"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm text-center">
          خطأ في تحميل البيانات
          <button onClick={() => setFetchVersion(v => v + 1)} className="mr-2 underline">إعادة المحاولة</button>
        </div>
      )}

      {!loading && !error && products.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <BookOpen className="w-12 h-12 text-gray-700 mb-3" />
          <p className="text-gray-400 font-medium">لا توجد صفحات منشورة بعد</p>
          <p className="text-gray-600 text-sm mt-1">انشر صفحة من تبويب "توليد" لتظهر هنا</p>
        </div>
      )}

      {!loading && products.length > 0 && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-600">
          <p>لا توجد نتائج لـ "{search}"</p>
          <button onClick={() => setSearch("")} className="text-orange-400 text-sm mt-1 hover:underline">مسح البحث</button>
        </div>
      )}

      {!loading && filtered.map(group => {
        const isOpen = expanded[group.productId] !== false;
        return (
          <div key={group.productId} className="rounded-2xl border border-white/10 bg-white/3 overflow-hidden" style={{ background: "rgba(255,255,255,0.02)" }}>
            <button
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/5 transition-colors"
              onClick={() => toggleProduct(group.productId)}
            >
              <div className="flex items-center gap-3 min-w-0">
                {group.productImage ? (
                  <img src={group.productImage} alt={group.productName}
                    className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-white/10"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-orange-400 font-bold text-sm">{group.productName.charAt(0)}</span>
                  </div>
                )}
                <div className="text-right min-w-0">
                  <p className="font-semibold text-white text-sm truncate">{group.productName}</p>
                  <p className="text-xs text-gray-500">{group.productHandle || group.productId}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <span className="bg-orange-500/10 text-orange-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-orange-500/20">
                  {group.pages.length} {group.pages.length === 1 ? "صفحة" : "صفحات"}
                </span>
                {isOpen ? <ChevronUp className="w-4 h-4 text-gray-600" /> : <ChevronDown className="w-4 h-4 text-gray-600" />}
              </div>
            </button>

            {isOpen && (
              <div className="divide-y divide-white/5 border-t border-white/5">
                {group.pages.map(page => (
                  <div key={page.id} className="px-4 py-3.5 hover:bg-white/3 transition-colors" style={{ background: "transparent" }}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="font-medium text-gray-200 text-sm leading-snug truncate">
                          {page.headline || <span className="text-gray-600 italic">لا يوجد عنوان</span>}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {page.assetKey?.startsWith("templates/product.") && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-400 border border-violet-500/25">
                              Template
                            </span>
                          )}
                          {page.lpModel && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-orange-500/10 text-orange-400 border border-orange-500/20">
                              {page.lpModel}
                            </span>
                          )}
                          <span className="text-xs text-gray-600">{formatDate(page.publishedAt)}</span>
                        </div>
                        <a href={page.pageUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 hover:underline truncate block max-w-sm">
                          {page.assetKey?.startsWith("templates/product.") ? "رابط المنتج" : page.pageUrl}
                        </a>
                        {(() => {
                          const stats = analytics[page.pageUrl];
                          if (ga4Available && stats) {
                            return (
                              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-400 text-[10px] font-medium border border-blue-500/15">
                                  <Users className="w-3 h-3" />
                                  {stats.sessions.toLocaleString("ar-EG")} زيارة
                                </span>
                                <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${
                                  stats.conversionRate >= 3
                                    ? "bg-green-500/10 text-green-400 border-green-500/15"
                                    : stats.conversionRate >= 1
                                      ? "bg-amber-500/10 text-amber-400 border-amber-500/15"
                                      : "bg-white/5 text-gray-500 border-white/10"
                                }`}>
                                  <TrendingUp className="w-3 h-3" />
                                  {stats.conversionRate}% CVR
                                </span>
                                {stats.conversions > 0 && (
                                  <span className="text-[10px] text-gray-600">
                                    {stats.conversions.toLocaleString("ar-EG")} تحويل
                                  </span>
                                )}
                                <span className="text-[10px] text-gray-700 mr-auto">30 يوم</span>
                              </div>
                            );
                          }
                          if (ga4Available && !stats) {
                            return <p className="text-[10px] text-gray-700 pt-0.5">لا توجد بيانات GA4</p>;
                          }
                          if (!ga4Available && analyticsLoading) {
                            return (
                              <div className="flex items-center gap-1 text-[10px] text-gray-700 pt-0.5">
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                جاري تحميل الإحصائيات...
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                        <button
                          onClick={() => void fetchAdsForPage(page)}
                          disabled={adsLoadingPage === page.id}
                          title="توليد نصوص إعلانية من زاوية هذه الصفحة"
                          className={cn(
                            "flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                            adsOpenPage === page.id && adsByPage[page.id]
                              ? "bg-violet-600/20 text-violet-300 border border-violet-500/30"
                              : "text-gray-500 hover:text-violet-400 hover:bg-violet-500/10",
                          )}>
                          {adsLoadingPage === page.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Megaphone className="w-3.5 h-3.5" />}
                          <span>إعلانات</span>
                        </button>
                        <button
                          onClick={() => onEdit(page)}
                          title="تعديل الصفحة بالمحرر البصري"
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-orange-400 hover:bg-orange-500/10 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                          <span>تعديل</span>
                        </button>
                        <button
                          onClick={() => onPreview(page.id, page.headline, page.lpModel)}
                          title="معاينة داخل التطبيق"
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                          <Eye className="w-3.5 h-3.5" />
                          <span>معاينة</span>
                        </button>
                        <a href={page.pageUrl} target="_blank" rel="noopener noreferrer"
                          title="عرض الصفحة"
                          className="p-1.5 rounded-lg text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        {page.adminUrl && (
                          <a href={page.adminUrl} target="_blank" rel="noopener noreferrer"
                            title="إدارة Shopify"
                            className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-white/10 transition-colors">
                            <Settings2 className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          onClick={() => onRegenerate(group.productId, toFrameworkKey(page.lpModel || "Auto"))}
                          title="إعادة التوليد بنفس المنتج"
                          className="p-1.5 rounded-lg text-gray-600 hover:text-orange-400 hover:bg-orange-500/10 transition-colors">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setPendingDelete({ id: page.id, name: page.headline || group.productName })}
                          disabled={deleting === page.id}
                          title="حذف الصفحة من Shopify والسجلات"
                          className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                          {deleting === page.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {adsOpenPage === page.id && (
                      <div className="mt-3">
                        {adsLoadingPage === page.id && !adsByPage[page.id] ? (
                          <div className="flex items-center gap-2 px-3 py-4 rounded-xl border border-violet-500/20 bg-violet-500/5 text-sm text-violet-300">
                            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                            <span>Gemini يقرأ زاوية صفحتك ويكتب الإعلانات...</span>
                          </div>
                        ) : adsByPage[page.id] ? (
                          <AdPanel
                            adCreatives={adsByPage[page.id]}
                            isRefreshing={adsLoadingPage === page.id}
                            onRefresh={() => void refreshAdsForPage(page)}
                          />
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <AlertDialog open={!!pendingDelete} onOpenChange={open => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent dir="rtl" className="max-w-sm bg-[#0f1623] border border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-right text-white">تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription className="text-right text-gray-400">
              هل تريد حذف الصفحة{pendingDelete?.name ? ` "${pendingDelete.name}"` : ""} وإزالتها من Shopify نهائياً؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2 sm:flex-row-reverse">
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="bg-red-600 hover:bg-red-700 text-white border-0">
              حذف
            </AlertDialogAction>
            <AlertDialogCancel className="bg-white/10 hover:bg-white/20 text-white border-0">
              إلغاء
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────
export default function LandingPageGenerator() {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"generate" | "library">("generate");
  const [ga4Available, setGa4Available] = useState(false);

  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [productsError, setProductsError] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productsVersion, setProductsVersion] = useState(0);
  const [productsLoadedVersion, setProductsLoadedVersion] = useState(-1);
  const productsLoading = productsLoadedVersion < productsVersion;
  const [showImportModal, setShowImportModal] = useState(false);

  const [extImportData, setExtImportData] = useState<{
    title: string; description: string; images: string[]; body_html: string;
  } | null>(null);
  const [extImportTitle, setExtImportTitle] = useState("");
  const [extImportPrice, setExtImportPrice] = useState("");
  const [extImportCreating, setExtImportCreating] = useState(false);
  const [extImportError, setExtImportError] = useState("");

  interface ReviewItem { text: string; customerName: string; imageUrl: string; rating: number; }
  const [reviewsToken, setReviewsToken] = useState<string | null>(null);
  const [_realReviewsCount, setRealReviewsCount] = useState(0);
  const [reviewsList, setReviewsList] = useState<ReviewItem[]>([]);
  const [selectedReviewIndices, setSelectedReviewIndices] = useState<Set<number>>(new Set());
  const [reviewsPanelOpen, setReviewsPanelOpen] = useState(false);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  interface ShopifyStorePickerInfo { id: number; domain: string; shopName: string | null; isDefault: boolean; }
  const [availableStores, setAvailableStores] = useState<ShopifyStorePickerInfo[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/shopify/stores")
      .then(r => r.json() as Promise<{ stores?: ShopifyStorePickerInfo[] }>)
      .then(data => {
        const list = data.stores ?? [];
        setAvailableStores(list);
        const def = list.find(s => s.isDefault) ?? list[0];
        if (def) setSelectedStoreId(def.id);
      })
      .catch(() => {});
  }, []);

  const [showShopifyModal, setShowShopifyModal] = useState(false);
  const [addingStore, setAddingStore] = useState(false);
  const [newStoreDomain, setNewStoreDomain] = useState("");
  const [newStoreClientId, setNewStoreClientId] = useState("");
  const [newStoreClientSecret, setNewStoreClientSecret] = useState("");
  const [addStoreLoading, setAddStoreLoading] = useState(false);
  const [addStoreError, setAddStoreError] = useState("");

  // ── Detect return from Shopify OAuth ──────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("shopify_connected")) {
      const shopName = params.get("shop") ?? "Shopify";
      window.history.replaceState({}, "", "/landing-page");
      fetch("/api/shopify/stores")
        .then(r => r.json() as Promise<{ stores?: ShopifyStorePickerInfo[] }>)
        .then(data => {
          const list = data.stores ?? [];
          setAvailableStores(list);
          const def = list.find(s => s.isDefault) ?? list[0];
          if (def) setSelectedStoreId(def.id);
          setProductsVersion(v => v + 1);
          toast({ title: "✅ تم ربط Shopify بنجاح!", description: shopName });
        })
        .catch(() => {});
    } else if (params.has("shopify_error")) {
      const code = params.get("shopify_error") ?? "unknown";
      window.history.replaceState({}, "", "/landing-page");
      const messages: Record<string, string> = {
        session_expired: "انتهت الجلسة — أعد المحاولة",
        hmac_failed: "فشل التحقق من الأمان — تأكد من Client Secret",
        no_token: "لم يُرسل Shopify الـ Token — أعد المحاولة",
        internal: "خطأ داخلي في الخادم — أعد المحاولة",
      };
      const tokenMatch = code.match(/^token_exchange_(\d+)$/);
      const msg = tokenMatch
        ? `فشل استبدال الكود (${tokenMatch[1]}) — تأكد من Client ID و Secret`
        : (messages[code] ?? "فشل ربط Shopify — أعد المحاولة");
      toast({ title: "❌ فشل ربط Shopify", description: msg, variant: "destructive" });
    }
  }, []);

  const handleAddStore = async () => {
    if (!newStoreDomain.trim() || !newStoreClientId.trim() || !newStoreClientSecret.trim()) {
      setAddStoreError("أدخل Domain و Client ID و Client Secret");
      return;
    }
    setAddStoreLoading(true);
    setAddStoreError("");
    try {
      const res = await fetch("/api/shopify/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: newStoreDomain.trim(),
          clientId: newStoreClientId.trim(),
          clientSecret: newStoreClientSecret.trim(),
          isDefault: availableStores.length === 0,
        }),
      });
      const data = await res.json() as { authUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "فشل بدء OAuth");
      window.location.href = data.authUrl!;
    } catch (err) {
      setAddStoreError(err instanceof Error ? err.message : "خطأ غير معروف");
      setAddStoreLoading(false);
    }
  };

  const handleDeleteStore = async (id: number) => {
    await fetch(`/api/shopify/stores/${id}`, { method: "DELETE" }).catch(() => {});
    setAvailableStores(prev => prev.filter(s => s.id !== id));
    if (selectedStoreId === id) {
      const remaining = availableStores.filter(s => s.id !== id);
      setSelectedStoreId(remaining[0]?.id ?? null);
    }
  };

  const handleSetDefaultStore = async (id: number) => {
    await fetch(`/api/shopify/stores/${id}/default`, { method: "PATCH" }).catch(() => {});
    setAvailableStores(prev => prev.map(s => ({ ...s, isDefault: s.id === id })));
    setSelectedStoreId(id);
  };

  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [comparePrice, setComparePrice] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [lpImageUrls, setLpImageUrls] = useState<{id: string; url: string}[]>([
    {id:"img-0",url:""},{id:"img-1",url:""},{id:"img-2",url:""},
  ]);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const fileInputEls = useRef<(HTMLInputElement | null)[]>([]);
  const bulkFileRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [productHandle, setProductHandle] = useState("");
  const [productId, setProductId] = useState("");
  const [productMainImage, setProductMainImage] = useState("");

  const [frameworkKey, setFrameworkKey] = useState<FrameworkKey>("Auto");
  const [styleKey, setStyleKey] = useState<StyleKey>("Auto");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [hasFreeShipping, setHasFreeShipping] = useState(false);
  const [customFocusPoints, setCustomFocusPoints] = useState("");

  const [isABTest, setIsABTest] = useState(false);
  const [abVariants, setAbVariants] = useState<VariantConfig[]>([
    { id: "var-a", frameworkKey: "Auto", styleKey: "Auto" },
    { id: "var-b", frameworkKey: "Auto", styleKey: "Auto" },
  ]);
  const [abResult, setAbResult] = useState<ABResult | null>(null);
  const [activeVariant, setActiveVariant] = useState<number>(0);

  const [adCreatives, setAdCreatives] = useState<AdCreatives | null>(null);
  const [adCreativesLoading, setAdCreativesLoading] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [libEditor, setLibEditor] = useState<{
    html: string; headline: string;
    pageId: number; assetKey: string; suffix: string;
    productHandle: string; productName: string; productId: string; productImage: string;
    storeId: number | null;
  } | null>(null);
  const [_libEditorPublishing, setLibEditorPublishing] = useState(false);

  // ── Publish state — replaced mutation hooks with state booleans ─────────────
  const [publishPending, setPublishPending] = useState(false);
  const [themePending, setThemePending] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState("");
  const [publishedAdminUrl, setPublishedAdminUrl] = useState("");
  const [abPublishedUrls, setAbPublishedUrls] = useState<Array<{ label: string; url: string; adminUrl: string; ok: boolean }> | null>(null);
  const [isPublishingAll, setIsPublishingAll] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [mobilePanel, setMobilePanel] = useState<"form" | "preview">("form");
  const [customSlug, setCustomSlug] = useState("");
  const [publishedPageId, setPublishedPageId] = useState<number | null>(null);
  const [publishedAssetKey, setPublishedAssetKey] = useState("");
  const [publishedSuffix, setPublishedSuffix] = useState("");
  const [publishedThemeUrl, setPublishedThemeUrl] = useState("");
  const [preferredPublish, setPreferredPublish] = useState<"shopify" | "theme-template" | null>(() => {
    try {
      const stored = typeof window !== "undefined" ? localStorage.getItem("lp_preferred_publish") : null;
      if (stored === "shopify" || stored === "theme-template") return stored;
    } catch { }
    return null;
  });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeRefB = useRef<HTMLIFrameElement>(null);
  const iframeRefC = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function doFetch() {
      try {
        const url = selectedStoreId
          ? `/api/shopify/products-simple?storeId=${selectedStoreId}`
          : "/api/shopify/products-simple";
        const res = await fetch(url);
        const data = await res.json() as { products?: ShopifyProduct[]; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.products) {
          setProductsError(data.error || "فشل جلب المنتجات");
        } else {
          setProductsError("");
          setProducts(data.products);
          setSelectedProductId("");
        }
      } catch {
        if (!cancelled) setProductsError("خطأ في الاتصال بالخادم");
      } finally {
        if (!cancelled) setProductsLoadedVersion(productsVersion);
      }
    }
    void doFetch();
    return () => { cancelled = true; };
  }, [productsVersion, selectedStoreId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const importId = params.get("extImportId");

    const tokenFromUrl = params.get("reviewsToken");
    if (tokenFromUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReviewsToken(tokenFromUrl);
      setRealReviewsCount(parseInt(params.get("reviewsCount") || "0", 10) || 1);
    }

    const tokenFromStorage = sessionStorage.getItem("__dg_reviews_token");
    const countFromStorage = parseInt(sessionStorage.getItem("__dg_reviews_count") || "0", 10);
    if (tokenFromStorage && !tokenFromUrl) {
      setReviewsToken(tokenFromStorage);
      setRealReviewsCount(countFromStorage || 1);
    }

    if (!importId) {
      if (tokenFromUrl) window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    window.history.replaceState({}, "", window.location.pathname);

    fetch(`/api/shopify/products/import-data/${importId}`)
      .then(r => r.json())
      .then((data: { success?: boolean; title?: string; description?: string; images?: string[]; body_html?: string }) => {
        if (!data.success || !data.title) return;
        setExtImportData({
          title: data.title,
          description: data.description || "",
          images: data.images || [],
          body_html: data.body_html || "",
        });
        setExtImportTitle(data.title);
        setActiveTab("generate");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!reviewsToken) { setReviewsList([]); setSelectedReviewIndices(new Set()); return; }
    setReviewsLoading(true);
    fetch(`/api/landing-page/reviews/${reviewsToken}`)
      .then(r => r.json())
      .then((data: { success?: boolean; reviews?: ReviewItem[] }) => {
        if (data.success && Array.isArray(data.reviews)) {
          setReviewsList(data.reviews);
          setRealReviewsCount(data.reviews.length);
          setSelectedReviewIndices(new Set(data.reviews.map((_, i) => i)));
          setReviewsPanelOpen(true);
        }
      })
      .catch(() => {})
      .finally(() => setReviewsLoading(false));
  }, [reviewsToken]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ token: string; count: number }>).detail;
      if (detail?.token) {
        setReviewsToken(detail.token);
        setRealReviewsCount(detail.count || 1);
      }
    };
    window.addEventListener("dg_reviews_ready", handler);
    return () => window.removeEventListener("dg_reviews_ready", handler);
  }, []);

  async function handleExtImportCreate() {
    if (!extImportData) return;
    const priceNum = parseFloat(extImportPrice);
    if (!extImportPrice || isNaN(priceNum) || priceNum <= 0) {
      setExtImportError("أدخل السعر بالجنيه المصري");
      return;
    }
    setExtImportCreating(true);
    setExtImportError("");
    try {
      const res = await fetch("/api/shopify/products/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: extImportTitle.trim() || extImportData.title,
          description: extImportData.description,
          bodyHtml: extImportData.body_html,
          price: String(priceNum),
          images: extImportData.images,
          storeId: selectedStoreId ?? undefined,
        }),
      });
      const data = await res.json() as { success?: boolean; product?: ShopifyProduct; error?: string };
      if (!res.ok || !data.success || !data.product) {
        setExtImportError(data.error || "فشل إنشاء المنتج على Shopify");
        return;
      }
      setProducts(prev => [data.product!, ...prev]);
      setSelectedProductId(data.product!.id);
      setExtImportData(null);
      setExtImportPrice("");
      toast({ title: "✅ تم إنشاء المنتج على Shopify", description: data.product!.title });
    } catch {
      setExtImportError("خطأ في الاتصال بالخادم");
    } finally {
      setExtImportCreating(false);
    }
  }

  function handleExtImportSkip() {
    if (!extImportData) return;
    setProductName(extImportData.title);
    if (extImportData.description) setProductDesc(extImportData.description);
    if (extImportData.images.length > 0) {
      setLpImageUrls(extImportData.images.slice(0, 8).map((url, i) => ({ id: `img-ext-${i}`, url })));
    }
    setResult(null);
    setError("");
    setExtImportData(null);
  }

  const [filledForProductId, setFilledForProductId] = useState<string>("");
  const selectedProduct = products.find(p => p.id === selectedProductId) ?? null;
  if (selectedProductId && selectedProductId !== filledForProductId && selectedProduct) {
    setFilledForProductId(selectedProductId);
    setProductName(selectedProduct.title);
    setProductPrice(selectedProduct.price ? String(Math.floor(parseFloat(selectedProduct.price))) : "");
    setComparePrice(selectedProduct.comparePrice ? String(Math.floor(parseFloat(selectedProduct.comparePrice))) : "");
    setProductDesc(selectedProduct.description || "");
    setProductHandle(selectedProduct.handle);
    setProductId(selectedProduct.id);
    setProductMainImage(selectedProduct.image || "");
    const imgs = selectedProduct.images ?? (selectedProduct.image ? [selectedProduct.image] : []);
    setLpImageUrls(imgs.length > 0
      ? imgs.map((url, i) => ({id: `img-prod-${i}`, url}))
      : [{id:"img-0",url:""},{id:"img-1",url:""},{id:"img-2",url:""}]);
    setResult(null);
    setAbPublishedUrls(null);
    setError("");
    setPublishedUrl("");
    setPublishedAdminUrl("");
    setPublishedThemeUrl("");
    setPublishedPageId(null);
    setPublishedAssetKey("");
    setPublishedSuffix("");
    setCustomSlug("");
  }

  const [previewModal, setPreviewModal] = useState<{
    open: boolean;
    headline: string;
    model: string;
    html: string | null;
    loading: boolean;
    error: string;
    isCached: boolean;
  }>({ open: false, headline: "", model: "", html: null, loading: false, error: "", isCached: false });

  const PREVIEW_CACHE_PREFIX = "lp_preview_";

  function ssGet(pageId: number): string | null {
    try { return sessionStorage.getItem(PREVIEW_CACHE_PREFIX + pageId); } catch { return null; }
  }
  function ssSet(pageId: number, html: string) {
    try { sessionStorage.setItem(PREVIEW_CACHE_PREFIX + pageId, html); } catch { }
  }
  function ssClear() {
    try {
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(PREVIEW_CACHE_PREFIX)) keys.push(k);
      }
      keys.forEach(k => sessionStorage.removeItem(k));
    } catch { }
  }

  const previewCacheRef = useRef(new Map<number, string>());

  useEffect(() => {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(PREVIEW_CACHE_PREFIX)) {
          const id = parseInt(k.slice(PREVIEW_CACHE_PREFIX.length), 10);
          const html = sessionStorage.getItem(k);
          if (!isNaN(id) && html) previewCacheRef.current.set(id, html);
        }
      }
    } catch { }
  }, []);

  const clearPreviewCache = useCallback(() => { previewCacheRef.current.clear(); ssClear(); }, []);
  const evictCacheEntry = useCallback((id: number) => {
    previewCacheRef.current.delete(id);
    try { sessionStorage.removeItem(PREVIEW_CACHE_PREFIX + id); } catch { }
  }, []);

  const [autoFullscreen, setAutoFullscreen] = useState<boolean>(() => {
    try { return localStorage.getItem("lp_auto_fullscreen") === "1"; } catch { return false; }
  });

  function toggleAutoFullscreen() {
    setAutoFullscreen(prev => {
      const next = !prev;
      try { localStorage.setItem("lp_auto_fullscreen", next ? "1" : "0"); } catch { }
      return next;
    });
  }

  const warmPreviewCache = useCallback(
    async (pages: Array<{ id: number; headline: string; model: string }>) => {
      const queue = pages.filter(p => !previewCacheRef.current.has(p.id));
      if (queue.length === 0) return;

      const BATCH_SIZE = 20;
      const remaining: number[] = [];

      for (let start = 0; start < queue.length; start += BATCH_SIZE) {
        const chunk = queue.slice(start, start + BATCH_SIZE);
        const idsParam = chunk.map(p => p.id).join(",");
        let batchOk = false;
        try {
          const res = await fetch(`/api/landing-page-records/preview-batch?ids=${idsParam}`);
          if (res.ok) {
            const data = await res.json() as { html?: Record<number, string> };
            if (data.html) {
              for (const [rawId, html] of Object.entries(data.html)) {
                previewCacheRef.current.set(Number(rawId), html);
                ssSet(Number(rawId), html);
              }
              for (const p of chunk) {
                if (!previewCacheRef.current.has(p.id)) remaining.push(p.id);
              }
              batchOk = true;
            }
          }
        } catch { }

        if (!batchOk) {
          for (const p of chunk) remaining.push(p.id);
        }
      }

      if (remaining.length === 0) return;

      async function fetchOne(id: number) {
        if (previewCacheRef.current.has(id)) return;
        try {
          const res = await fetch(`/api/landing-page-records/${id}/html`);
          if (!res.ok) return;
          const data = await res.json() as { html?: string };
          if (data.html) {
            previewCacheRef.current.set(id, data.html);
            ssSet(id, data.html);
          }
        } catch { }
      }

      const CONCURRENCY = 2;
      let idx = 0;
      async function runWorker() {
        while (idx < remaining.length) {
          const id = remaining[idx++];
          await fetchOne(id);
        }
      }

      const workers = Array.from({ length: Math.min(CONCURRENCY, remaining.length) }, runWorker);
      await Promise.all(workers);
    },
    [],
  );

  async function handlePreview(pageId: number, headline: string, model: string) {
    const cached = previewCacheRef.current.get(pageId) ?? ssGet(pageId);
    if (cached) {
      previewCacheRef.current.set(pageId, cached);
      setPreviewModal({ open: true, headline, model, html: cached, loading: false, error: "", isCached: true });
      return;
    }
    setPreviewModal({ open: true, headline, model, html: null, loading: true, error: "", isCached: false });
    try {
      const res = await fetch(`/api/landing-page-records/${pageId}/html`);
      const data = await res.json() as { html?: string; headline?: string; model?: string; error?: string };
      if (!res.ok || !data.html) {
        setPreviewModal(prev => ({ ...prev, loading: false, error: data.error || "فشل جلب معاينة الصفحة" }));
        return;
      }
      previewCacheRef.current.set(pageId, data.html);
      ssSet(pageId, data.html);
      setPreviewModal(prev => ({
        ...prev,
        loading: false,
        html: data.html!,
        headline: data.headline || headline,
        model: data.model || model,
      }));
    } catch {
      setPreviewModal(prev => ({ ...prev, loading: false, error: "خطأ في الاتصال بالخادم" }));
    }
  }

  function handleRegenerate(pid: string, fw: FrameworkKey) {
    setSelectedProductId(pid);
    setFrameworkKey(fw);
    setActiveTab("generate");
  }

  async function handleBulkUpload(files: FileList) {
    if (!files.length) return;
    setBulkUploading(true);
    const arr = Array.from(files);
    for (let i = 0; i < arr.length; i++) {
      setBulkProgress(`${i + 1} / ${arr.length}`);
      try {
        const file = arr[i];
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const res = await fetch("/api/shopify/upload-custom-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
        });
        const data = await res.json() as { url?: string; error?: string };
        if (res.ok && data.url) {
          setLpImageUrls(prev => {
            const emptyIdx = prev.findIndex(item => !item.url.trim());
            if (emptyIdx !== -1) {
              return prev.map((item, idx) => idx === emptyIdx ? { ...item, url: data.url! } : item);
            }
            return [...prev, { id: `img-${Date.now()}-${i}`, url: data.url! }];
          });
        }
      } catch { }
    }
    setBulkUploading(false);
    setBulkProgress("");
    toast({ title: `✓ تم رفع ${arr.length} ${arr.length === 1 ? "صورة" : "صور"}` });
  }

  function handleDragStart(idx: number) { setDragIdx(idx); }
  function handleDragOver(e: React.DragEvent, idx: number) { e.preventDefault(); setOverIdx(idx); }
  function handleDrop(idx: number) {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    setLpImageUrls(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(null);
    setOverIdx(null);
  }

  async function handleImageFileUpload(file: File, slot: number) {
    setUploadingSlot(slot);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/shopify/upload-custom-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) { toast({ title: data.error || "فشل رفع الصورة", variant: "destructive" }); return; }
      setLpImageUrls(prev => prev.map((item, idx) => idx === slot ? {...item, url: data.url!} : item));
      toast({ title: "تم رفع الصورة ✓" });
    } catch {
      toast({ title: "خطأ في رفع الصورة", variant: "destructive" });
    } finally {
      setUploadingSlot(null);
    }
  }

  async function handleRefreshAds() {
    if (!productName.trim()) return;
    setAdCreativesLoading(true);
    try {
      const res = await fetch("/api/landing-page/regenerate-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName,
          currentPrice: productPrice,
          selectedFramework: frameworkKey,
        }),
      });
      const data = await res.json() as { success?: boolean; adCreatives?: AdCreatives; error?: string };
      if (data.adCreatives) {
        setAdCreatives(data.adCreatives);
        toast({ title: "✓ تم تجديد الإعلانات بأفكار جديدة كلياً" });
      } else {
        toast({ title: "فشل تجديد الإعلانات — حاول مجدداً", variant: "destructive" });
      }
    } catch {
      toast({ title: "خطأ في الاتصال بالخادم", variant: "destructive" });
    } finally {
      setAdCreativesLoading(false);
    }
  }

  async function handleGenerate() {
    if (!productName.trim()) { toast({ title: "اسم المنتج مطلوب", variant: "destructive" }); return; }
    setIsGenerating(true);
    setStatusMessage("جاري إعداد المحتوى...");
    setError("");
    setResult(null);
    setAdCreatives(null);
    setAbPublishedUrls(null);
    setPublishedUrl("");
    setPublishedAdminUrl("");
    setPublishedThemeUrl("");
    setPublishedPageId(null);
    setPublishedAssetKey("");
    setPublishedSuffix("");
    setCustomSlug("");

    const imageUrls = lpImageUrls.filter(({url}) => { const t = url.trim(); return t.startsWith("http") || t.startsWith("/api/storage/"); }).map(({url}) => url);

    try {
      const requestBody: LandingPageGenerateRequest = {
        productTitle: productName,
        productPrice,
        comparePrice,
        productDesc,
        imageUrls,
        frameworkKey,
        styleKey,
        ...(referenceUrl.trim() ? { referenceUrl: referenceUrl.trim() } : {}),
        hasFreeShipping,
        ...(customFocusPoints.trim() ? { customFocusPoints: customFocusPoints.trim() } : {}),
        ...(reviewsToken ? { reviewsToken } : {}),
        ...(reviewsToken && selectedReviewIndices.size > 0
          ? { selectedReviewIndices: [...selectedReviewIndices] }
          : {}),
        ...((reviewsList.length > 0) ? {
          inlineReviews: selectedReviewIndices.size > 0
            ? reviewsList.filter((_, i) => selectedReviewIndices.has(i))
            : reviewsList,
        } : {}),
      };
      const res = await fetch("/api/landing-page/generate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        setError(errData.error || "خطأ في الاتصال بالخادم");
        setIsGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6)) as {
              type: string; message?: string; html?: string; headline?: string; model?: string;
            };
            if (parsed.type === "status" && parsed.message) {
              setStatusMessage(parsed.message);
            } else if (parsed.type === "done" && parsed.html) {
              const headline = (parsed as Record<string, string>).headline || productName;
              const model = (parsed as Record<string, string>).model || frameworkKey;
              setResult({ html: parsed.html, headline, model });
              const ac = (parsed as Record<string, unknown>).adCreatives;
              if (ac && typeof ac === "object") setAdCreatives(ac as AdCreatives);
              setIsGenerating(false);
              setMobilePanel("preview");
              if (autoFullscreen) {
                setPreviewModal({ open: true, headline, model, html: parsed.html, loading: false, error: "", isCached: false });
              }
            } else if (parsed.type === "error") {
              setError(parsed.message || "حدث خطأ");
              setIsGenerating(false);
            }
          } catch { }
        }
      }
    } catch {
      setError("خطأ في الاتصال بالخادم");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerateAB() {
    if (!productName.trim()) { toast({ title: "اسم المنتج مطلوب", variant: "destructive" }); return; }
    setIsGenerating(true);
    const n = abVariants.length;
    setStatusMessage(`جاري توليد ${n} نسخ بالتوازي... قد يستغرق 2-3 دقائق`);
    setError("");
    setResult(null);
    setAbResult(null);
    setAdCreatives(null);
    setAbPublishedUrls(null);
    setActiveVariant(0);
    setPublishedUrl("");
    setPublishedAdminUrl("");
    setPublishedThemeUrl("");
    setPublishedPageId(null);
    setPublishedAssetKey("");
    setPublishedSuffix("");
    setCustomSlug("");

    const imageUrls = lpImageUrls.filter(({url}) => { const t = url.trim(); return t.startsWith("http") || t.startsWith("/api/storage/"); }).map(({url}) => url);

    try {
      const res = await fetch("/api/landing-page/generate-ab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productTitle: productName,
          productPrice,
          comparePrice,
          productDesc,
          imageUrls,
          variants: abVariants,
          ...(referenceUrl.trim() ? { referenceUrl: referenceUrl.trim() } : {}),
          hasFreeShipping,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        setError(errData.error || "خطأ في التوليد");
        setIsGenerating(false);
        return;
      }

      const data = await res.json() as {
        success: boolean;
        variants?: Array<{ html?: string; headline?: string; model?: string }>;
        adCreatives?: AdCreatives;
        error?: string;
      };

      if (!data.success || !data.variants || data.variants.length < 2) {
        setError(data.error || "فشل توليد النسخ — حاول مجدداً");
        return;
      }

      setAbResult({
        variants: data.variants.map((v, i) => ({
          html: v.html || "",
          headline: v.headline || productName,
          model: v.model || abVariants[i]?.frameworkKey || "Auto",
        })),
      });
      if (data.adCreatives) setAdCreatives(data.adCreatives);
      setMobilePanel("preview");
    } catch {
      setError("خطأ في الاتصال بالخادم");
    } finally {
      setIsGenerating(false);
    }
  }

  function toggleABTest() {
    setIsABTest(prev => {
      if (!prev) {
        setAbVariants([
          { id: "var-a", frameworkKey, styleKey },
          { id: "var-b", frameworkKey: contrastFw(frameworkKey), styleKey: contrastSt(styleKey) },
        ]);
        setActiveVariant(0);
      }
      return !prev;
    });
  }

  function updateAbVariant(idx: number, field: "frameworkKey" | "styleKey", value: FrameworkKey | StyleKey) {
    setAbVariants(prev => prev.map((v, i) => i === idx ? { ...v, [field]: value } : v));
  }

  function addAbVariant() {
    if (abVariants.length < 3) {
      setAbVariants(prev => [...prev, { id: `var-c-${Date.now()}`, frameworkKey: "Auto", styleKey: "Auto" }]);
    }
  }

  function removeAbVariant(idx: number) {
    if (abVariants.length > 2) {
      setAbVariants(prev => prev.filter((_, i) => i !== idx));
      setActiveVariant(0);
    }
  }

  function adoptVariant(idx: number) {
    if (!abResult) return;
    const v = abResult.variants[idx];
    if (!v) return;
    setResult({ html: v.html, headline: v.headline, model: v.model });
    setAbResult(null);
    toast({ title: `✓ اخترت نسخة ${["A","B","C"][idx] ?? idx + 1} — اضغط نشر` });
  }

  async function handlePublishAllVariants() {
    if (!abResult) return;
    setIsPublishingAll(true);
    setAbPublishedUrls(null);
    const labels = ["A", "B", "C"];
    const results = await Promise.allSettled(
      abResult.variants.map(async (v, i) => {
        const label = labels[i] ?? String(i + 1);
        const body = {
          html: cleanEditorFromHtml(v.html),
          title: `${productName || "صفحة بيع"} — نسخة ${label}`,
          productHandle,
          productName,
          productPrice,
          comparePrice,
          productImage: productMainImage,
          productId,
          headline: v.headline,
          lpModel: v.model,
          adCreatives: abResult.adCreatives ? (abResult.adCreatives as unknown as Record<string, unknown>) : undefined,
          storeId: selectedStoreId ?? undefined,
        };
        const res = await fetch("/api/landing-page/publish-shopify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { success: boolean; pageUrl?: string; adminUrl?: string; error?: string };
        return { label, ok: data.success, url: data.pageUrl ?? "", adminUrl: data.adminUrl ?? "", error: data.error };
      })
    );
    const entries = results.map((r, i) => {
      const label = labels[i] ?? String(i + 1);
      if (r.status === "fulfilled") return r.value;
      return { label, ok: false, url: "", adminUrl: "", error: String(r.reason) };
    });
    setAbPublishedUrls(entries);
    setIsPublishingAll(false);
    const successCount = entries.filter(e => e.ok).length;
    if (successCount === entries.length) {
      toast({ title: `تم نشر ${successCount} صفحات على Shopify! 🎉` });
    } else if (successCount > 0) {
      toast({ title: `تم نشر ${successCount} من ${entries.length} — بعض النسخ فشلت`, variant: "destructive" });
    } else {
      toast({ title: "فشل النشر — تحقق من اتصال Shopify", variant: "destructive" });
    }
  }

  function handleDownloadAB(idx: number) {
    if (!abResult) return;
    const v = abResult.variants[idx];
    if (!v) return;
    const html = cleanEditorFromHtml(v.html);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lp-${productHandle || "landing"}-variant-${["A","B","C"][idx] ?? idx + 1}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleEditorSave(editedHtml: string) {
    const cleanHtml = cleanEditorFromHtml(editedHtml);
    setResult(prev => prev ? { ...prev, html: cleanHtml } : prev);
    setEditorOpen(false);

    if (publishedPageId && publishedAssetKey && publishedSuffix) {
      toast({ title: "⏳ جاري تحديث الصفحة على Shopify..." });
      void (async () => {
        setPublishPending(true);
        try {
          const publishBody: LandingPagePublishShopifyRequest = {
            html: cleanHtml,
            title: productName || "صفحة بيع",
            productHandle,
            productName,
            productPrice,
            comparePrice,
            productImage: productMainImage,
            productId,
            headline: result?.headline ?? "",
            lpModel: result?.model ?? "edited",
            existingPageId: publishedPageId ?? undefined,
            existingAssetKey: publishedAssetKey ?? undefined,
            existingSuffix: publishedSuffix ?? undefined,
            storeId: selectedStoreId ?? undefined,
          };
          const res = await fetch("/api/landing-page/publish-shopify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(publishBody),
          });
          const data = await res.json() as { success: boolean; error?: string };
          if (data.success) {
            toast({ title: "✅ تم تحديث الصفحة على نفس الرابط! 🔄" });
          } else {
            toast({ title: data.error || "فشل التحديث", variant: "destructive" });
          }
        } catch {
          toast({ title: "✓ التعديلات محفوظة محلياً — اضغط نشر للتحديث", variant: "default" });
        } finally {
          setPublishPending(false);
        }
      })();
    } else {
      toast({ title: "✓ تم حفظ التعديلات — اضغط نشر لتحديث Shopify" });
    }
  }

  async function handleLibraryEdit(page: PageRecord) {
    try {
      const res = await fetch(`/api/landing-page-records/${page.id}/html`);
      if (!res.ok) { toast({ title: "تعذّر تحميل HTML للصفحة", variant: "destructive" }); return; }
      const data = await res.json() as { html?: string };
      if (!data.html) { toast({ title: "الصفحة لا تحتوي على HTML محفوظ", variant: "destructive" }); return; }
      setLibEditor({
        html: cleanEditorFromHtml(data.html),
        headline: page.headline,
        pageId: page.id,
        assetKey: page.assetKey,
        suffix: page.suffix,
        productHandle: page.productHandle,
        productName: page.productName,
        productId: page.productId,
        productImage: page.productImage,
        storeId: selectedStoreId,
      });
    } catch {
      toast({ title: "خطأ في الاتصال بالخادم", variant: "destructive" });
    }
  }

  async function handleLibraryEditorSave(editedHtml: string) {
    if (!libEditor) return;
    const cleanHtml = cleanEditorFromHtml(editedHtml);
    const meta = { ...libEditor };
    setLibEditor(null);
    setLibEditorPublishing(true);
    try {
      const publishBody: LandingPagePublishShopifyRequest = {
        html: cleanHtml,
        title: meta.productName || "صفحة بيع",
        productHandle: meta.productHandle,
        productName: meta.productName,
        productImage: meta.productImage,
        productId: meta.productId,
        headline: meta.headline,
        lpModel: "edited",
        existingPageId: meta.pageId,
        existingAssetKey: meta.assetKey || undefined,
        existingSuffix: meta.suffix || undefined,
        storeId: meta.storeId ?? undefined,
      };
      const res = await fetch("/api/landing-page/publish-shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publishBody),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) {
        toast({ title: data.error || "فشل التحديث", variant: "destructive" });
      } else {
        toast({ title: "✓ تم تحديث الصفحة على Shopify! 🔄" });
      }
    } catch {
      toast({ title: "خطأ في الاتصال بالخادم", variant: "destructive" });
    } finally {
      setLibEditorPublishing(false);
    }
  }

  function handleResetPreferredPublish() {
    try { localStorage.removeItem("lp_preferred_publish"); } catch { }
    setPreferredPublish(null);
  }

  function handleDownload() {
    if (!result) return;
    const blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lp-${productHandle || "landing-page"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Publish to Shopify ─────────────────────────────────────────────────────
  async function handlePublish() {
    if (!result) return;
    const isUpdate = !!(publishedPageId && publishedAssetKey && publishedSuffix);
    setPublishPending(true);
    try {
      const publishBody: LandingPagePublishShopifyRequest = {
        html: cleanEditorFromHtml(result.html),
        title: productName || "صفحة بيع",
        productHandle,
        productName,
        productPrice,
        comparePrice,
        productImage: productMainImage,
        productId,
        headline: result.headline,
        lpModel: result.model,
        customSlug: customSlug.trim() || undefined,
        existingPageId: publishedPageId ?? undefined,
        existingAssetKey: publishedAssetKey || undefined,
        existingSuffix: publishedSuffix || undefined,
        adCreatives: adCreatives ? (adCreatives as unknown as Record<string, unknown>) : undefined,
        storeId: selectedStoreId ?? undefined,
      };
      const res = await fetch("/api/landing-page/publish-shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publishBody),
      });
      const data = await res.json() as { success: boolean; pageUrl?: string; adminUrl?: string; pageId?: number; assetKey?: string; suffix?: string; handle?: string; error?: string };
      if (!data.success) { toast({ title: data.error || "فشل النشر", variant: "destructive" }); return; }
      setPublishedUrl(data.pageUrl || "");
      setPublishedAdminUrl(data.adminUrl || "");
      if (data.pageId) setPublishedPageId(data.pageId);
      if (data.assetKey) setPublishedAssetKey(data.assetKey);
      if (data.suffix) setPublishedSuffix(data.suffix);
      if (data.handle && !customSlug.trim()) setCustomSlug(data.handle);
      try { localStorage.setItem("lp_preferred_publish", "shopify"); } catch { }
      setPreferredPublish("shopify");
      toast({ title: isUpdate ? "✓ تم تحديث الصفحة على Shopify! 🔄" : "تم النشر بنجاح! 🎉" });
    } catch {
      toast({ title: "خطأ في الاتصال بالخادم", variant: "destructive" });
    } finally {
      setPublishPending(false);
    }
  }

  // ── Publish as Product Template ────────────────────────────────────────────
  async function handlePublishTheme() {
    if (!result) return;
    setThemePending(true);
    try {
      const res = await fetch("/api/landing-page/publish-theme-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: cleanEditorFromHtml(result.html),
          title: productName || "صفحة بيع",
          productHandle,
          productName,
          productId,
          productImage: productMainImage,
          headline: result.headline,
          lpModel: result.model,
          adCreatives: adCreatives ? (adCreatives as unknown as Record<string, unknown>) : undefined,
          storeId: selectedStoreId ?? undefined,
        }),
      });
      const data = await res.json() as { success: boolean; pageUrl?: string; error?: string };
      if (!data.success) { toast({ title: data.error || "فشل النشر", variant: "destructive" }); return; }
      setPublishedThemeUrl(data.pageUrl || "");
      try { localStorage.setItem("lp_preferred_publish", "theme-template"); } catch { }
      setPreferredPublish("theme-template");
      toast({ title: "تم نشر Template المنتج! 🎉" });
    } catch {
      toast({ title: "خطأ في الاتصال بالخادم", variant: "destructive" });
    } finally {
      setThemePending(false);
    }
  }

  useEffect(() => {
    if (iframeRef.current && result?.html) {
      iframeRef.current.srcdoc = result.html;
    }
  }, [result]);

  useEffect(() => {
    if (!abResult) return;
    const refs = [iframeRef, iframeRefB, iframeRefC];
    abResult.variants.forEach((v, i) => {
      const el = refs[i]?.current;
      if (el) el.srcdoc = v.html;
    });
  }, [abResult]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" className="flex flex-col bg-[#0a0f1e] text-white" style={{ minHeight: "calc(100vh - 56px)" }}>

      {previewModal.open && createPortal(
        <PreviewModal
          headline={previewModal.headline}
          model={previewModal.model}
          html={previewModal.html}
          loading={previewModal.loading}
          error={previewModal.error}
          isCached={previewModal.isCached}
          onClose={() => setPreviewModal(prev => ({ ...prev, open: false }))}
        />,
        document.body,
      )}

      {editorOpen && result && createPortal(
        <EditorModal
          html={result.html}
          headline={result.headline}
          onSave={handleEditorSave}
          onClose={() => setEditorOpen(false)}
          stores={availableStores}
          selectedStoreId={selectedStoreId}
          onStoreChange={setSelectedStoreId}
        />,
        document.body,
      )}

      {libEditor && createPortal(
        <EditorModal
          html={libEditor.html}
          headline={libEditor.headline}
          onSave={handleLibraryEditorSave}
          onClose={() => setLibEditor(null)}
          stores={availableStores}
          selectedStoreId={selectedStoreId}
          onStoreChange={(id) => {
            setSelectedStoreId(id);
            setLibEditor(prev => prev ? { ...prev, storeId: id } : prev);
          }}
        />,
        document.body,
      )}

      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          storeId={selectedStoreId}
          onProductCreated={(p) => {
            setProducts(prev => [p, ...prev]);
            setSelectedProductId(p.id);
            setShowImportModal(false);
          }}
        />
      )}

      {/* ── Shopify Settings Modal ── */}
      {showShopifyModal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) { setShowShopifyModal(false); setAddingStore(false); setAddStoreError(""); } }}>
          <div className="bg-[#0d1425] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-orange-400" />
                ربط متاجر Shopify
              </h3>
              <button
                onClick={() => { setShowShopifyModal(false); setAddingStore(false); setAddStoreError(""); setNewStoreDomain(""); setNewStoreClientId(""); setNewStoreClientSecret(""); }}
                className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded-lg hover:bg-white/5">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Connected stores list */}
            {availableStores.length > 0 && (
              <div className="mb-4 space-y-2">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">المتاجر المرتبطة</p>
                {availableStores.map(s => (
                  <div key={s.id} className="flex items-center gap-2.5 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", s.isDefault ? "bg-green-400" : "bg-gray-600")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate font-medium">{s.shopName ?? s.domain}</p>
                      <p className="text-[10px] text-gray-500 truncate" dir="ltr">{s.domain}</p>
                    </div>
                    {s.isDefault ? (
                      <span className="text-[10px] text-green-400 font-bold px-1.5 py-0.5 bg-green-500/10 rounded border border-green-500/20 whitespace-nowrap">★ افتراضي</span>
                    ) : (
                      <button
                        onClick={() => void handleSetDefaultStore(s.id)}
                        className="text-[10px] text-gray-500 hover:text-orange-400 transition-colors px-1.5 py-0.5 border border-white/10 rounded hover:border-orange-500/30 whitespace-nowrap">
                        تعيين افتراضي
                      </button>
                    )}
                    <button
                      onClick={() => void handleDeleteStore(s.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10 flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add store form */}
            {addingStore ? (
              <div className="space-y-3 border border-white/10 rounded-xl p-4 bg-white/3">
                <p className="text-xs font-bold text-gray-300">بيانات التطبيق على Shopify Partners</p>

                {/* Redirect URI box — must be whitelisted in Shopify Partners */}
                <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 space-y-1.5">
                  <p className="text-[11px] font-bold text-orange-300">⚠️ خطوة ضرورية قبل الربط</p>
                  <p className="text-[10px] text-orange-200/80 leading-relaxed">
                    افتح <strong>Shopify Partners → Apps → اختر التطبيق → Configuration → Allowed redirection URL(s)</strong> وأضف هذا الرابط بالضبط:
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <code className="flex-1 text-[10px] bg-black/30 rounded px-2 py-1.5 text-orange-100 break-all font-mono leading-relaxed" dir="ltr">
                      {window.location.origin}/api/shopify/oauth/callback
                    </code>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/api/shopify/oauth/callback`)}
                      className="flex-shrink-0 p-1.5 rounded bg-orange-500/20 hover:bg-orange-500/40 transition-colors text-orange-300"
                      title="نسخ">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">نطاق المتجر (Store Domain)</label>
                  <input
                    value={newStoreDomain}
                    onChange={e => setNewStoreDomain(e.target.value)}
                    placeholder="my-store.myshopify.com"
                    dir="ltr"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">Client ID</label>
                  <input
                    value={newStoreClientId}
                    onChange={e => setNewStoreClientId(e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    dir="ltr"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">Client Secret</label>
                  <input
                    value={newStoreClientSecret}
                    onChange={e => setNewStoreClientSecret(e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    type="password"
                    dir="ltr"
                    onKeyDown={e => e.key === "Enter" && void handleAddStore()}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 font-mono"
                  />
                  <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
                    من Shopify Partners → Apps → اختر التطبيق → App setup → Client credentials
                  </p>
                </div>

                {addStoreError && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{addStoreError}
                  </p>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => { setAddingStore(false); setAddStoreError(""); setNewStoreDomain(""); setNewStoreClientId(""); setNewStoreClientSecret(""); }}
                    className="flex-1 py-2 rounded-lg text-xs text-gray-400 border border-white/10 hover:bg-white/5 transition-colors">
                    إلغاء
                  </button>
                  <button
                    onClick={() => void handleAddStore()}
                    disabled={addStoreLoading}
                    className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-50 transition-opacity"
                    style={{ background: "linear-gradient(135deg,#f97316,#ea580c)" }}>
                    {addStoreLoading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />جاري التوجيه...</>
                      : <><ShoppingBag className="w-3.5 h-3.5" />ربط عبر Shopify</>}
                  </button>
                </div>

                <div className="rounded-lg bg-blue-500/8 border border-blue-500/20 p-2.5 text-[11px] text-blue-300 leading-relaxed">
                  سيتم تحويلك لـ Shopify للموافقة ثم العودة تلقائياً للتطبيق.
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingStore(true)}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-orange-400 flex items-center justify-center gap-2 border border-dashed border-orange-500/30 hover:bg-orange-500/8 transition-colors">
                <Plus className="w-4 h-4" />
                {availableStores.length === 0 ? "ربط متجر Shopify الآن" : "إضافة متجر آخر"}
              </button>
            )}

            {availableStores.length === 0 && !addingStore && (
              <div className="mt-3 text-center space-y-1">
                <p className="text-xs text-gray-500">تحتاج لتطبيق Shopify مع Client ID + Secret من Shopify Partners.</p>
                <a
                  href="https://partners.shopify.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-orange-400 hover:underline inline-flex items-center gap-1">
                  فتح Shopify Partners Dashboard <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* ── Header ── */}
      <div className="border-b border-white/10 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-5">
          <div>
            <h1 className="text-lg font-bold text-white">صفحات البيع</h1>
            <p className="text-xs text-gray-400 mt-0.5">توليد صفحات هبوط بـ AI جاهزة للنشر على Shopify</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
              <button
                onClick={() => setActiveTab("generate")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  activeTab === "generate"
                    ? "bg-orange-500 text-white shadow-sm"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
              >
                <Sparkles className="w-3.5 h-3.5" />
                توليد
              </button>
              <button
                onClick={() => setActiveTab("library")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all relative",
                  activeTab === "library"
                    ? "bg-orange-500 text-white shadow-sm"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
              >
                <BookOpen className="w-3.5 h-3.5" />
                المكتبة
                {ga4Available && (
                  <span className="flex items-center gap-0.5 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                    GA4
                  </span>
                )}
              </button>
            </div>

            {/* Shopify connect button */}
            <button
              onClick={() => { setShowShopifyModal(true); setAddingStore(availableStores.length === 0); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all",
                availableStores.length > 0
                  ? "border-green-500/30 text-green-400 bg-green-500/8 hover:bg-green-500/15"
                  : "border-orange-500/40 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20"
              )}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              Shopify
              <span className={cn(
                "w-2 h-2 rounded-full flex-shrink-0",
                availableStores.length > 0 ? "bg-green-400" : "bg-orange-400 animate-pulse"
              )} />
            </button>
          </div>
        </div>

        {activeTab === "generate" && result && (
          <div className="flex flex-col gap-2">
            <div style={{ display:"flex", alignItems:"center", gap:"6px", padding:"0 4px" }}>
              <span style={{ fontSize:"10px", color:"#9ca3af", whiteSpace:"nowrap", flexShrink:0 }}>رابط الصفحة:</span>
              <div style={{ display:"flex", alignItems:"center", gap:"2px", flex:1, minWidth:0, background:"#0d1b2a", border:"1px solid rgba(255,255,255,0.2)", borderRadius:"8px", padding:"4px 8px" }}>
                <span style={{ fontSize:"10px", color:"#6b7280", flexShrink:0 }}>pages/</span>
                <input
                  value={customSlug}
                  onChange={e => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  placeholder={`lp-${(productHandle || productName || "product").toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,25) || "product"}-…`}
                  dir="ltr"
                  style={{
                    flex:1, minWidth:0, background:"transparent", border:"none", outline:"none",
                    fontSize:"11px", color:"#f1f5f9", fontFamily:"monospace",
                  }}
                />
                {customSlug && (
                  <button onClick={() => setCustomSlug("")} style={{ color:"#6b7280", flexShrink:0, background:"none", border:"none", cursor:"pointer", padding:0, display:"flex" }}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {publishedPageId && (
                <span style={{ fontSize:"9px", color:"#34d399", fontWeight:700, whiteSpace:"nowrap", flexShrink:0, background:"rgba(52,211,153,0.1)", padding:"2px 6px", borderRadius:"6px" }}>
                  ✓ منشور — سيُحدَّث
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}
              className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10 text-xs gap-1.5">
              <Pencil className="w-3.5 h-3.5" />تعديل
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}
              className="border-white/20 text-white hover:bg-white/10 text-xs gap-1.5">
              <Download className="w-3.5 h-3.5" />تحميل HTML
            </Button>

            {availableStores.length > 1 && (
              <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                <Globe className="w-3 h-3 text-gray-400 shrink-0" />
                <select
                  value={selectedStoreId ?? ""}
                  onChange={e => setSelectedStoreId(Number(e.target.value))}
                  className="bg-transparent text-[11px] text-white appearance-none cursor-pointer focus:outline-none"
                  style={{ colorScheme: "dark" }}>
                  {availableStores.map(s => (
                    <option key={s.id} value={s.id} style={{ background: "#1a2035", color: "#fff" }}>
                      {s.shopName || s.domain}{s.isDefault ? " ★" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {publishedThemeUrl ? (
              <a href={publishedThemeUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)" }}>
                <ExternalLink className="w-3.5 h-3.5" />عرض Template
              </a>
            ) : (
              <div className="relative">
                {preferredPublish === "theme-template" && (
                  <span className="absolute -top-2.5 right-0 text-[9px] text-purple-300 font-semibold whitespace-nowrap">★ مفضل</span>
                )}
                <Button size="sm" onClick={handlePublishTheme} disabled={themePending}
                  className="text-xs gap-1.5 text-white border-0"
                  style={{
                    background: "linear-gradient(135deg,#7c3aed,#6d28d9)",
                    ...(preferredPublish === "theme-template" ? { boxShadow: "0 0 0 2px rgba(167,139,250,0.6)" } : {}),
                  }}>
                  {themePending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />نشر...</> : <><Globe className="w-3.5 h-3.5" />Template المنتج</>}
                </Button>
              </div>
            )}
            {publishedUrl ? (
              <a href={publishedUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                style={{ background: "linear-gradient(135deg,#16a34a,#15803d)" }}>
                <ExternalLink className="w-3.5 h-3.5" />عرض الصفحة
              </a>
            ) : (
              <div className="relative">
                {preferredPublish === "shopify" && (
                  <span className="absolute -top-2.5 right-0 text-[9px] text-orange-300 font-semibold whitespace-nowrap">★ مفضل</span>
                )}
                <Button size="sm" onClick={handlePublish} disabled={publishPending}
                  className="text-xs gap-1.5 text-white border-0"
                  style={{
                    background: "linear-gradient(135deg,#FF6B35,#FF4500)",
                    ...(preferredPublish === "shopify" ? { boxShadow: "0 0 0 2px rgba(251,146,60,0.6)" } : {}),
                  }}>
                  {publishPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />نشر...</> : <><Globe className="w-3.5 h-3.5" />نشر على Shopify</>}
                </Button>
              </div>
            )}
            {preferredPublish && (
              <button onClick={handleResetPreferredPublish}
                className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors whitespace-nowrap underline underline-offset-2">
                مسح المفضل
              </button>
            )}
            </div>
          </div>
        )}
      </div>

      {/* ── Library Tab ── */}
      {activeTab === "library" && (
        <div className="flex flex-col flex-1 overflow-hidden" style={{ height: "calc(100vh - 112px)" }}>
          <LibraryPanel onRegenerate={handleRegenerate} onPreview={handlePreview} onEdit={handleLibraryEdit} onClearPreviewCache={clearPreviewCache} onEvictCacheEntry={evictCacheEntry} onWarmCache={warmPreviewCache} onGa4StatusChange={setGa4Available} />
        </div>
      )}

      {/* ── Generate Tab ── */}
      {activeTab === "generate" && (
        <div className="flex flex-col flex-1 overflow-hidden" style={{ height: "calc(100vh - 112px)" }}>

          <div className="flex md:hidden border-b border-white/10 flex-shrink-0">
            <button
              onClick={() => setMobilePanel("form")}
              className={cn("flex-1 py-2.5 text-xs font-semibold transition-all flex items-center justify-center gap-1.5",
                mobilePanel === "form" ? "bg-orange-500/15 text-orange-400 border-b-2 border-orange-500" : "text-gray-500"
              )}>
              <Settings2 className="w-3.5 h-3.5" />الإعدادات
            </button>
            <button
              onClick={() => setMobilePanel("preview")}
              className={cn("flex-1 py-2.5 text-xs font-semibold transition-all flex items-center justify-center gap-1.5",
                mobilePanel === "preview" ? "bg-orange-500/15 text-orange-400 border-b-2 border-orange-500" : "text-gray-500"
              )}>
              <Monitor className="w-3.5 h-3.5" />المعاينة
              {result && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />}
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden md:flex-row flex-col">

          {/* ════ LEFT PANEL ════ */}
          <div className={cn("md:w-80 md:flex-shrink-0 border-l border-white/10 overflow-y-auto bg-[#0d1425]",
            mobilePanel === "form" ? "flex flex-col flex-1 md:flex-initial" : "hidden md:flex md:flex-col")}
            style={{ scrollbarWidth: "thin", scrollbarColor: "#374151 transparent" }}>
            <div className="p-4 space-y-5">

              {/* Extension Import Panel */}
              {extImportData && (
                <section className="rounded-xl border border-orange-500/40 bg-orange-500/8 p-3 space-y-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base">📦</span>
                    <span className="text-[12px] font-bold text-orange-400">منتج مستورد من الإضافة</span>
                    <button onClick={() => setExtImportData(null)} className="mr-auto text-gray-500 hover:text-gray-300 p-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2.5">
                    {extImportData.images[0] && (
                      <img src={extImportData.images[0]} alt="" className="w-14 h-14 rounded-lg object-cover border border-white/10 flex-shrink-0" />
                    )}
                    <input
                      value={extImportTitle}
                      onChange={e => setExtImportTitle(e.target.value)}
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 min-w-0"
                      placeholder="اسم المنتج"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">السعر بالجنيه (مطلوب لـ Shopify)</label>
                    <input
                      type="number"
                      value={extImportPrice}
                      onChange={e => setExtImportPrice(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && void handleExtImportCreate()}
                      placeholder="مثال: 350"
                      style={{ direction: "ltr" }}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50"
                    />
                  </div>
                  {extImportError && (
                    <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{extImportError}</p>
                  )}
                  <button
                    onClick={() => void handleExtImportCreate()}
                    disabled={extImportCreating}
                    className="w-full py-2 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg,#f97316,#ea580c)" }}>
                    {extImportCreating
                      ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الإنشاء...</>
                      : <><CheckCircle2 className="w-4 h-4" />إضافة على Shopify ثم اعمل اللاندينج</>}
                  </button>
                  <button
                    onClick={handleExtImportSkip}
                    className="w-full text-[11px] text-gray-500 hover:text-gray-300 transition-colors py-0.5 underline underline-offset-2">
                    تخطي — أملأ البيانات يدوياً بدون Shopify
                  </button>
                </section>
              )}

              {/* Store Picker */}
              {availableStores.length > 1 && (
                <section>
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-2">المتجر</span>
                  <div className="relative">
                    <select
                      value={selectedStoreId ?? ""}
                      onChange={e => { setSelectedStoreId(Number(e.target.value)); setSelectedProductId(""); }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:border-orange-500/50"
                      style={{ colorScheme: "dark" }}>
                      {availableStores.map(s => (
                        <option key={s.id} value={s.id} style={{ background: "#1a2035", color: "#fff" }}>
                          {s.shopName || s.domain}{s.isDefault ? " (افتراضي)" : ""}
                        </option>
                      ))}
                    </select>
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 text-xs">▼</span>
                  </div>
                </section>
              )}

              {/* ① Product */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">① المنتج</span>
                  <button
                    onClick={() => setShowImportModal(true)}
                    className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-orange-400 transition-colors"
                  >
                    <Upload className="w-3 h-3" />استيراد من رابط
                  </button>
                </div>

                {/* Reviews badge */}
                {reviewsToken && (
                  <div className="mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25">
                    <span className="text-amber-400 text-[11px] font-bold">⭐ تقييمات حقيقية متصلة</span>
                    {reviewsLoading && <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />}
                    {reviewsList.length > 0 && (
                      <button
                        onClick={() => setReviewsPanelOpen(p => !p)}
                        className="mr-auto text-[10px] text-amber-400 hover:text-amber-300 underline underline-offset-2"
                      >
                        {reviewsPanelOpen ? "إخفاء" : `عرض ${reviewsList.length}`}
                      </button>
                    )}
                    <button onClick={() => setReviewsToken(null)} className="text-amber-600 hover:text-amber-400 p-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Reviews panel */}
                {reviewsPanelOpen && reviewsList.length > 0 && (
                  <div className="mb-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 space-y-2 max-h-48 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-amber-400">اختر التقييمات للاستخدام في الصفحة</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setSelectedReviewIndices(new Set(reviewsList.map((_, i) => i)))}
                          className="text-[9px] text-amber-400 hover:underline">الكل</button>
                        <button onClick={() => setSelectedReviewIndices(new Set())}
                          className="text-[9px] text-gray-500 hover:underline">لا شيء</button>
                      </div>
                    </div>
                    {reviewsList.map((r, i) => (
                      <button key={i} onClick={() => setSelectedReviewIndices(prev => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      })}
                        className={cn(
                          "w-full text-right rounded-lg p-2 border transition-all",
                          selectedReviewIndices.has(i)
                            ? "border-amber-500/50 bg-amber-500/10"
                            : "border-white/8 bg-white/3 opacity-60",
                        )}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {r.imageUrl && <img src={r.imageUrl} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />}
                          <span className="text-[10px] font-semibold text-amber-300">{r.customerName}</span>
                          <span className="text-[9px] text-amber-400">{"★".repeat(r.rating)}</span>
                          <span className={cn("mr-auto w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px] flex-shrink-0",
                            selectedReviewIndices.has(i) ? "bg-amber-500 border-amber-500 text-white" : "border-white/20")}>
                            {selectedReviewIndices.has(i) && "✓"}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-relaxed line-clamp-2">{r.text}</p>
                      </button>
                    ))}
                  </div>
                )}

                {/* Product selector */}
                {productsLoading ? (
                  <div className="flex items-center gap-2 py-3 px-3 rounded-xl bg-white/5 border border-white/10">
                    <Loader2 className="w-4 h-4 text-orange-400 animate-spin flex-shrink-0" />
                    <span className="text-xs text-gray-400">جاري تحميل المنتجات...</span>
                  </div>
                ) : productsError ? (
                  productsError.includes("لم يتم ربط") || productsError.includes("401") ? (
                    <div className="rounded-xl border border-dashed border-orange-500/40 bg-orange-500/5 px-4 py-5 flex flex-col items-center gap-3 text-center">
                      <ShoppingBag className="w-7 h-7 text-orange-400/70" />
                      <div>
                        <p className="text-sm font-semibold text-white">متجر Shopify غير مربوط</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">اربط متجرك لتحميل المنتجات تلقائياً</p>
                      </div>
                      <button
                        onClick={() => { setShowShopifyModal(true); setAddingStore(true); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-opacity"
                        style={{ background: "linear-gradient(135deg,#f97316,#ea580c)" }}>
                        <ShoppingBag className="w-4 h-4" />ربط Shopify الآن
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-xs text-red-400 space-y-1.5">
                        <p className="font-semibold flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{productsError}</p>
                        <p className="text-red-400/70">تحقق من إعدادات Shopify</p>
                      </div>
                      <button onClick={() => setProductsVersion(v => v + 1)}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors">
                        <RefreshCw className="w-3 h-3" />إعادة المحاولة
                      </button>
                    </div>
                  )
                ) : products.length > 0 ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <select
                        value={selectedProductId}
                        onChange={e => setSelectedProductId(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:border-orange-500/50"
                        style={{ colorScheme: "dark" }}>
                        <option value="" style={{ background: "#1a2035" }}>— اختر منتجاً —</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id} style={{ background: "#1a2035", color: "#fff" }}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 text-xs">▼</span>
                    </div>
                    <button onClick={() => setProductsVersion(v => v + 1)} disabled={productsLoading}
                      className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40">
                      <RefreshCw className={cn("w-3 h-3", productsLoading && "animate-spin")} />تحديث القائمة
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 px-3 py-2.5 text-xs text-amber-400">
                    لا توجد منتجات. أضف منتجاً لمتجر Shopify أو أدخل البيانات يدوياً أدناه.
                  </div>
                )}
              </section>

              {/* ② Manual Fields */}
              <section className="space-y-3">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">② البيانات</span>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">اسم المنتج *</label>
                  <input value={productName} onChange={e => setProductName(e.target.value)}
                    placeholder="مثال: كريم إزالة الشعر بالليزر"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] text-gray-400 mb-1 block">السعر (جنيه)</label>
                    <input value={productPrice} onChange={e => setProductPrice(e.target.value)}
                      placeholder="350" type="number" style={{ direction: "ltr" }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] text-gray-400 mb-1 block">سعر قبل الخصم</label>
                    <input value={comparePrice} onChange={e => setComparePrice(e.target.value)}
                      placeholder="699" type="number" style={{ direction: "ltr" }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50" />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">وصف المنتج (اختياري)</label>
                  <textarea value={productDesc} onChange={e => setProductDesc(e.target.value)}
                    rows={3} placeholder="الفوائد، المميزات، المشكلة التي يحلها..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 resize-none" />
                </div>
              </section>

              {/* Images section */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">صور المنتج</span>
                  <label className={cn(
                    "flex items-center gap-1 text-[10px] cursor-pointer transition-colors",
                    bulkUploading ? "text-gray-500 pointer-events-none" : "text-gray-500 hover:text-orange-400"
                  )}>
                    {bulkUploading
                      ? <><Loader2 className="w-3 h-3 animate-spin" />رفع {bulkProgress}...</>
                      : <><Upload className="w-3 h-3" />رفع دفعة</>}
                    <input
                      ref={bulkFileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={e => { if (e.target.files?.length) void handleBulkUpload(e.target.files); }}
                    />
                  </label>
                </div>
                <div className="space-y-2">
                  {lpImageUrls.map((item, idx) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDrop={() => handleDrop(idx)}
                      onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border transition-all",
                        overIdx === idx && dragIdx !== idx
                          ? "border-orange-500/60 bg-orange-500/5"
                          : "border-white/8 bg-white/3",
                        dragIdx === idx && "opacity-40",
                      )}>
                      <div className="p-1.5 text-gray-600 cursor-grab active:cursor-grabbing flex-shrink-0">
                        <GripVertical className="w-3.5 h-3.5" />
                      </div>
                      {item.url ? (
                        <img src={item.url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0 border border-white/10" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center flex-shrink-0">
                          <ImageIcon className="w-4 h-4 text-gray-600" />
                        </div>
                      )}
                      <input
                        value={item.url}
                        onChange={e => setLpImageUrls(prev => prev.map((it, i) => i === idx ? { ...it, url: e.target.value } : it))}
                        placeholder="https://..."
                        dir="ltr"
                        className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs text-white placeholder-gray-600 py-2"
                      />
                      <div className="flex items-center gap-0.5 flex-shrink-0 pr-1">
                        <label className={cn(
                          "p-1.5 rounded cursor-pointer transition-colors",
                          uploadingSlot === idx ? "text-gray-600 pointer-events-none" : "text-gray-500 hover:text-orange-400"
                        )}>
                          {uploadingSlot === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                          <input type="file" accept="image/*" className="hidden"
                            ref={el => { fileInputEls.current[idx] = el; }}
                            onChange={e => { if (e.target.files?.[0]) void handleImageFileUpload(e.target.files[0], idx); }} />
                        </label>
                        <button onClick={() => setLpImageUrls(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 rounded text-gray-600 hover:text-red-400 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => setLpImageUrls(prev => [...prev, { id: `img-${Date.now()}`, url: "" }])}
                    className="w-full py-1.5 rounded-lg border border-dashed border-white/15 text-[11px] text-gray-600 hover:text-gray-400 hover:border-white/25 transition-colors"
                  >
                    + إضافة صورة
                  </button>
                </div>
              </section>

              {/* ③ Framework */}
              <section>
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-2">③ الهيكل</span>
                <div className="flex flex-wrap gap-1.5">
                  {FRAMEWORKS.map(f => (
                    <button
                      key={f.key}
                      onClick={() => setFrameworkKey(f.key)}
                      title={f.sublabel}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all",
                        frameworkKey === f.key
                          ? "bg-orange-500/20 border-orange-500/50 text-orange-300"
                          : "bg-white/3 border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/5",
                      )}
                    >
                      <span>{f.emoji}</span>
                      <span>{f.label}</span>
                    </button>
                  ))}
                </div>
                {frameworkKey !== "Auto" && (
                  <p className="text-[10px] text-gray-600 mt-1.5">
                    {FRAMEWORKS.find(f => f.key === frameworkKey)?.sublabel}
                  </p>
                )}
              </section>

              {/* Style */}
              <section>
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-2">التصميم</span>
                <div className="flex flex-wrap gap-1.5">
                  {STYLES.map(s => (
                    <button
                      key={s.key}
                      onClick={() => setStyleKey(s.key)}
                      title={s.sublabel}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all",
                        styleKey === s.key
                          ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                          : "bg-white/3 border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/5",
                      )}
                    >
                      <span>{s.emoji}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Extra options */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setHasFreeShipping(p => !p)}
                    className={cn(
                      "w-9 h-5 rounded-full transition-colors flex-shrink-0",
                      hasFreeShipping ? "bg-orange-500" : "bg-white/15",
                    )}
                  >
                    <span className={cn(
                      "block w-4 h-4 rounded-full bg-white transition-transform mx-0.5",
                      hasFreeShipping ? "translate-x-4" : "translate-x-0",
                    )} />
                  </button>
                  <span className="text-[11px] text-gray-400">شحن مجاني</span>
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">نقاط تركيز مخصصة (اختياري)</label>
                  <textarea
                    value={customFocusPoints}
                    onChange={e => setCustomFocusPoints(e.target.value)}
                    rows={2}
                    placeholder="مثال: ركّز على السرعة، أبرز التوصيل خلال 48 ساعة..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 resize-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">رابط مرجعي (اختياري)</label>
                  <input
                    value={referenceUrl}
                    onChange={e => setReferenceUrl(e.target.value)}
                    placeholder="https://..."
                    dir="ltr"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50"
                  />
                </div>
              </section>

              {/* A/B Test toggle */}
              <section>
                <button
                  onClick={toggleABTest}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all",
                    isABTest
                      ? "bg-violet-600/20 border-violet-500/50 text-violet-300"
                      : "bg-white/3 border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/5",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-base">🧪</span>
                    <span>A/B Testing — {isABTest ? "مفعّل" : "توليد نسختين"}</span>
                  </span>
                  <span className={cn(
                    "w-7 h-4 rounded-full transition-colors flex-shrink-0",
                    isABTest ? "bg-violet-500" : "bg-white/20",
                  )}>
                    <span className={cn(
                      "block w-3 h-3 rounded-full bg-white transition-transform mt-0.5 mx-0.5",
                      isABTest ? "translate-x-3" : "translate-x-0",
                    )} />
                  </span>
                </button>

                {isABTest && (
                  <div className="mt-3 space-y-2">
                    {abVariants.map((v, i) => (
                      <div key={v.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/3 p-2">
                        <span className="text-[10px] font-black text-violet-400 w-4 flex-shrink-0">{["A","B","C"][i]}</span>
                        <select
                          value={v.frameworkKey}
                          onChange={e => updateAbVariant(i, "frameworkKey", e.target.value as FrameworkKey)}
                          className="flex-1 bg-transparent text-[11px] text-white border-none outline-none cursor-pointer"
                          style={{ colorScheme: "dark" }}>
                          {FRAMEWORKS.map(f => <option key={f.key} value={f.key} style={{ background: "#1a2035" }}>{f.emoji} {f.label}</option>)}
                        </select>
                        <select
                          value={v.styleKey}
                          onChange={e => updateAbVariant(i, "styleKey", e.target.value as StyleKey)}
                          className="flex-1 bg-transparent text-[11px] text-white border-none outline-none cursor-pointer"
                          style={{ colorScheme: "dark" }}>
                          {STYLES.map(s => <option key={s.key} value={s.key} style={{ background: "#1a2035" }}>{s.emoji} {s.label}</option>)}
                        </select>
                        {i >= 2 && (
                          <button onClick={() => removeAbVariant(i)} className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors p-0.5">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    {abVariants.length < 3 && (
                      <button
                        onClick={addAbVariant}
                        className="w-full py-1.5 rounded-xl border border-dashed border-violet-500/20 text-[11px] text-gray-600 hover:text-violet-400 transition-colors"
                      >
                        + إضافة نسخة ثالثة
                      </button>
                    )}
                  </div>
                )}
              </section>

              {/* Generate button */}
              <button onClick={isABTest ? handleGenerateAB : handleGenerate}
                disabled={isGenerating || !productName.trim()}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed text-white"
                style={!isGenerating && productName.trim()
                  ? isABTest
                    ? { background: "linear-gradient(135deg,#7c3aed,#6d28d9)", boxShadow: "0 4px 20px rgba(139,92,246,.35)" }
                    : { background: "linear-gradient(135deg,#FF6B35,#FF4500)", boxShadow: "0 4px 20px rgba(255,107,53,.35)" }
                  : { background: "rgba(255,255,255,0.08)" }
                }>
                {isGenerating
                  ? <><Loader2 className="w-4 h-4 animate-spin" /><span className="truncate">{statusMessage || "جاري التوليد..."}</span></>
                  : isABTest
                    ? <><span className="text-base leading-none">🧪</span><span>توليد {abVariants.length} نسخ مقارنة</span></>
                    : <><Sparkles className="w-4 h-4" /><span>توليد الصفحة</span></>
                }
              </button>

              {autoFullscreen && (!result || isGenerating) && (
                <button
                  onClick={toggleAutoFullscreen}
                  title="انقر لإيقاف الفتح التلقائي بملء الشاشة"
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-orange-400 border border-orange-500/30 bg-orange-500/8 hover:bg-orange-500/15 transition-colors"
                >
                  <Pin className="w-3 h-3" />
                  <span>ملء الشاشة تلقائياً</span>
                  <span className="text-orange-500/60 text-[10px]">— انقر للإيقاف</span>
                </button>
              )}

              {error && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-red-300">{error}</p>
                    <button onClick={handleGenerate} disabled={isGenerating}
                      className="text-[11px] text-red-400 hover:text-red-300 mt-1 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />حاول مجدداً
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ════ RIGHT PANEL — Preview ════ */}
          <div className={cn("flex-1 flex flex-col overflow-hidden bg-[#080c18] min-w-0",
            mobilePanel === "preview" ? "flex" : "hidden md:flex")}>

            {/* Preview toolbar */}
            {result && !isGenerating && (
              <div className="border-b border-white/10 px-4 py-2 flex items-center gap-3 bg-[#0d1425] flex-shrink-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <span className="text-xs text-gray-300 truncate">"{result.headline}"</span>
                  {result.model && result.model !== "Auto" && (
                    <span className="text-[10px] text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-md flex-shrink-0">
                      {result.model}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex items-center gap-0.5 bg-white/5 border border-white/10 rounded-lg p-0.5">
                    {([
                      { key: "mobile",  Icon: Smartphone, label: "موبايل",  w: "390px"  },
                      { key: "tablet",  Icon: Tablet,     label: "تابلت",  w: "768px"  },
                      { key: "desktop", Icon: Monitor,    label: "كمبيوتر", w: "100%"   },
                    ] as const).map(({ key, Icon, label }) => (
                      <button key={key} onClick={() => setPreviewDevice(key)} title={label}
                        className={cn("p-1.5 rounded-md transition-all",
                          previewDevice === key ? "bg-white/15 text-white" : "text-gray-500 hover:text-gray-300"
                        )}>
                        <Icon className="w-3 h-3" />
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setPreviewModal({ open: true, headline: result.headline, model: result.model, html: result.html, loading: false, error: "", isCached: false })}
                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
                    title="ملء الشاشة"
                  >
                    <Maximize2 className="w-3 h-3" />ملء الشاشة
                  </button>
                  <button
                    onClick={toggleAutoFullscreen}
                    title={autoFullscreen ? "إيقاف الفتح التلقائي بملء الشاشة" : "تثبيت: فتح بملء الشاشة تلقائياً عند كل توليد"}
                    className={cn(
                      "flex items-center gap-1 px-1.5 py-1 rounded-md text-xs transition-colors border",
                      autoFullscreen
                        ? "border-orange-500/60 bg-orange-500/10 text-orange-400"
                        : "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20"
                    )}
                  >
                    <Pin className="w-3 h-3" />
                  </button>
                  <button onClick={handleDownload}
                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors">
                    <Download className="w-3 h-3" />HTML
                  </button>
                  {availableStores.length > 1 && (
                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">
                      <Globe className="w-2.5 h-2.5 text-gray-400 shrink-0" />
                      <select
                        value={selectedStoreId ?? ""}
                        onChange={e => setSelectedStoreId(Number(e.target.value))}
                        className="bg-transparent text-[10px] text-white appearance-none cursor-pointer focus:outline-none max-w-[80px]"
                        style={{ colorScheme: "dark" }}>
                        {availableStores.map(s => (
                          <option key={s.id} value={s.id} style={{ background: "#1a2035", color: "#fff" }}>
                            {s.shopName || s.domain}{s.isDefault ? " ★" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {publishedThemeUrl ? (
                    <a href={publishedThemeUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-purple-400 hover:underline flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" />Template
                    </a>
                  ) : (
                    <div className="relative">
                      {preferredPublish === "theme-template" && (
                        <span className="absolute -top-2.5 right-0 text-[8px] text-purple-300 font-semibold whitespace-nowrap">★ مفضل</span>
                      )}
                      <button onClick={handlePublishTheme} disabled={themePending}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                        style={{
                          background: "linear-gradient(135deg,#7c3aed,#6d28d9)",
                          ...(preferredPublish === "theme-template" ? { boxShadow: "0 0 0 2px rgba(167,139,250,0.6)" } : {}),
                        }}>
                        {themePending ? <><Loader2 className="w-3 h-3 animate-spin" />نشر...</> : <><Globe className="w-3 h-3" />Template</>}
                      </button>
                    </div>
                  )}
                  {publishedUrl ? (
                    <div className="flex items-center gap-2">
                      <a href={publishedUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-green-400 hover:underline flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" />عرض
                      </a>
                      {publishedAdminUrl && (
                        <a href={publishedAdminUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />Admin
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="relative">
                      {preferredPublish === "shopify" && (
                        <span className="absolute -top-2.5 right-0 text-[8px] text-orange-300 font-semibold whitespace-nowrap">★ مفضل</span>
                      )}
                      <button onClick={handlePublish} disabled={publishPending}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                        style={{
                          background: "linear-gradient(135deg,#FF6B35,#FF4500)",
                          ...(preferredPublish === "shopify" ? { boxShadow: "0 0 0 2px rgba(251,146,60,0.6)" } : {}),
                        }}>
                        {publishPending ? <><Loader2 className="w-3 h-3 animate-spin" />نشر...</> : <><Globe className="w-3 h-3" />نشر</>}
                      </button>
                    </div>
                  )}
                  {preferredPublish && (
                    <button onClick={handleResetPreferredPublish}
                      className="text-[9px] text-gray-500 hover:text-gray-300 transition-colors whitespace-nowrap underline underline-offset-2 mt-0.5">
                      مسح المفضل
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Preview area */}
            <div className="flex-1 relative overflow-hidden flex flex-col">
              {isGenerating && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-[#080c18]">
                  <div className="w-16 h-16 rounded-full border-2 border-orange-500/20 flex items-center justify-center mb-4"
                    style={isABTest ? { borderColor: "rgba(139,92,246,0.3)" } : {}}>
                    <Loader2 className="w-8 h-8 animate-spin" style={{ color: isABTest ? "#7c3aed" : "#f97316" }} />
                  </div>
                  <p className="text-sm text-gray-300 font-medium">{statusMessage || "Gemini يكتب صفحتك..."}</p>
                  <p className="mt-1 text-xs text-gray-600">{isABTest ? "جاري توليد نسختين بالتوازي..." : "قد يستغرق 30-90 ثانية"}</p>
                </div>
              )}

              {!isGenerating && !result && !abResult && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
                  <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
                    <Sparkles className="w-10 h-10 text-orange-500/50" />
                  </div>
                  <h3 className="text-base font-bold text-gray-400 mb-2">معاينة الصفحة</h3>
                  <p className="text-sm text-gray-600 max-w-xs leading-relaxed">
                    اختر منتجاً أو أدخل البيانات يدوياً، حدد الهيكل والتصميم، ثم اضغط "توليد الصفحة"
                  </p>
                  <div className="mt-6 flex items-center gap-6">
                    {["① المنتج", "② الهيكل", "③ توليد"].map((step, i) => (
                      <div key={step} className="flex flex-col items-center gap-2">
                        <div className="w-9 h-9 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">
                          {i + 1}
                        </div>
                        <span className="text-xs text-gray-600">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Multi-variant Result */}
              {abResult && !isGenerating && (
                <div className="flex flex-col h-full">
                  <div className="flex-shrink-0 border-b border-white/10 bg-[#0d1425]">
                    <div className="px-3 pt-2 pb-1 flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 flex-shrink-0">
                        {abResult.variants.map((v, i) => {
                          const label = (["A","B","C"])[i] ?? String(i + 1);
                          return (
                            <button key={`variant-${label}`} onClick={() => setActiveVariant(i)}
                              className={cn(
                                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all",
                                activeVariant === i
                                  ? "bg-violet-600 text-white shadow-sm"
                                  : "text-gray-400 hover:text-white hover:bg-white/5"
                              )}>
                              <span className="font-black">نسخة {label}</span>
                              {v.model && v.model !== "Auto" && (
                                <span className={cn(
                                  "text-[10px] px-1 py-0.5 rounded font-semibold hidden sm:inline",
                                  activeVariant === i ? "bg-white/20 text-white" : "bg-white/10 text-gray-400"
                                )}>{v.model}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-0.5 bg-white/5 border border-white/10 rounded-lg p-0.5 mx-auto">
                        {([
                          { key: "mobile",  Icon: Smartphone, label: "موبايل"  },
                          { key: "tablet",  Icon: Tablet,     label: "تابلت"  },
                          { key: "desktop", Icon: Monitor,    label: "كمبيوتر" },
                        ] as const).map(({ key, Icon, label }) => (
                          <button key={key} onClick={() => setPreviewDevice(key)} title={label}
                            className={cn("p-1.5 rounded-md transition-all",
                              previewDevice === key ? "bg-white/15 text-white" : "text-gray-500 hover:text-gray-300"
                            )}>
                            <Icon className="w-3 h-3" />
                          </button>
                        ))}
                      </div>
                      <button onClick={() => handleDownloadAB(activeVariant)}
                        className="ml-auto text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors flex-shrink-0">
                        <Download className="w-3 h-3" />HTML
                      </button>
                    </div>
                    <div className="px-3 pb-2 flex items-center gap-2">
                      <button
                        onClick={() => adoptVariant(activeVariant)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-all border border-white/10">
                        <Globe className="w-3 h-3" />نشر {(["A","B","C"])[activeVariant]} فقط
                      </button>
                      <button
                        onClick={handlePublishAllVariants}
                        disabled={isPublishingAll}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)" }}>
                        {isPublishingAll
                          ? <><Loader2 className="w-3 h-3 animate-spin" />جاري النشر...</>
                          : <><Globe className="w-3 h-3" />نشر جميع النسخ على Shopify</>
                        }
                      </button>
                    </div>
                  </div>

                  {abPublishedUrls && (
                    <div className="flex-shrink-0 border-b border-white/10 bg-[#0a1020] px-4 py-2.5 flex flex-wrap items-center gap-3">
                      <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">روابط الإعلانات:</span>
                      {abPublishedUrls.map(entry => (
                        <div key={`published-${entry.label}`} className="flex items-center gap-1.5">
                          <span className={cn(
                            "text-[10px] font-black px-1.5 py-0.5 rounded",
                            entry.ok ? "bg-violet-600/30 text-violet-300" : "bg-red-600/30 text-red-400"
                          )}>نسخة {entry.label}</span>
                          {entry.ok && entry.url ? (
                            <>
                              <a href={entry.url} target="_blank" rel="noopener noreferrer"
                                className="text-[11px] text-blue-400 hover:text-blue-300 font-mono truncate max-w-[200px]">
                                {entry.url.replace("https://", "")}
                              </a>
                              <button onClick={() => { navigator.clipboard.writeText(entry.url).catch(() => {}); toast({ title: `✓ رابط نسخة ${entry.label} تم نسخه` }); }}
                                className="text-gray-500 hover:text-white transition-colors">
                                <Link2 className="w-3 h-3" />
                              </button>
                              <a href={entry.adminUrl} target="_blank" rel="noopener noreferrer"
                                className="text-gray-500 hover:text-gray-300 transition-colors">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </>
                          ) : (
                            <span className="text-[11px] text-red-400">فشل النشر</span>
                          )}
                        </div>
                      ))}
                      <button onClick={() => setAbPublishedUrls(null)} className="mr-auto text-gray-600 hover:text-gray-400 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="flex-1 min-h-0 overflow-auto bg-[#060a14] flex justify-center">
                    <div
                      className="h-full transition-[width] duration-300 relative"
                      style={{
                        width: previewDevice === "mobile" ? "390px" : previewDevice === "tablet" ? "768px" : "100%",
                        minWidth: previewDevice === "desktop" ? "100%" : undefined,
                        boxShadow: previewDevice !== "desktop" ? "0 0 0 1px rgba(255,255,255,0.06), 0 8px 40px rgba(0,0,0,0.6)" : undefined,
                      }}>
                      <iframe ref={iframeRef} className="w-full h-full border-0" title="نسخة A"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                        style={{ display: activeVariant === 0 ? "block" : "none" }} />
                      <iframe ref={iframeRefB} className="w-full h-full border-0" title="نسخة B"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                        style={{ display: activeVariant === 1 ? "block" : "none" }} />
                      {abResult.variants.length > 2 && (
                        <iframe ref={iframeRefC} className="w-full h-full border-0" title="نسخة C"
                          sandbox="allow-scripts allow-same-origin allow-forms"
                          style={{ display: activeVariant === 2 ? "block" : "none" }} />
                      )}
                    </div>
                  </div>
                  {adCreatives && (
                    <AdPanel
                      adCreatives={adCreatives}
                      isRefreshing={adCreativesLoading}
                      onRefresh={handleRefreshAds}
                    />
                  )}
                </div>
              )}

              {/* Single result iframe */}
              {result && !isGenerating && !abResult && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex-1 min-h-0 overflow-auto bg-[#060a14] flex justify-center">
                    <div
                      className="h-full transition-[width] duration-300"
                      style={{
                        width: previewDevice === "mobile" ? "390px" : previewDevice === "tablet" ? "768px" : "100%",
                        minWidth: previewDevice === "desktop" ? "100%" : undefined,
                        boxShadow: previewDevice !== "desktop" ? "0 0 0 1px rgba(255,255,255,0.06), 0 8px 40px rgba(0,0,0,0.6)" : undefined,
                      }}>
                      <iframe ref={iframeRef} className="w-full h-full border-0" title="معاينة صفحة البيع"
                        sandbox="allow-scripts allow-same-origin allow-forms" />
                    </div>
                  </div>
                  {adCreatives && (
                    <AdPanel
                      adCreatives={adCreatives}
                      isRefreshing={adCreativesLoading}
                      onRefresh={handleRefreshAds}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
