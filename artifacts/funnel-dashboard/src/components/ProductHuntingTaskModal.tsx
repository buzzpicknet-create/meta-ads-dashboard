import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Loader2, Target, UserRound, X } from "lucide-react";

interface HuntingMedia {
  type: "image" | "video";
  url: string;
  thumbnail_url?: string | null;
}

export interface HuntingTaskProduct {
  id: number;
  title: string | null;
  description: string | null;
  source_url: string;
  supplier_url: string | null;
  target_price_egp: string | number | null;
  cost_price: string | number | null;
  cost_currency: string | null;
  media?: HuntingMedia[] | null;
}

interface Assignee {
  id: number;
  username: string;
  role: string;
}

interface Props {
  product: HuntingTaskProduct;
  onClose: () => void;
  onDone: (message: string) => void;
}

function cairoLocalPlusHours(hours: number) {
  const d = new Date(Date.now() + hours * 60 * 60 * 1000);
  return d.toLocaleString("sv-SE", { timeZone: "Africa/Cairo" }).slice(0, 16).replace(" ", "T");
}

function mediaObjectPath(url: string) {
  const match = url.match(/\/api\/telegram-product-bot\/media\/([^/?#]+)/);
  return match ? `/objects/telegram-product/${decodeURIComponent(match[1])}` : null;
}

export default function ProductHuntingTaskModal({ product, onClose, onDone }: Props) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loadingAssignees, setLoadingAssignees] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [productName, setProductName] = useState("");
  const [offers, setOffers] = useState("");
  const [metric, setMetric] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [finalNotes, setFinalNotes] = useState(product.description || product.title || "");
  const [finalNotesDirty, setFinalNotesDirty] = useState(false);
  const [deadline, setDeadline] = useState(cairoLocalPlusHours(24));
  const [presetHours, setPresetHours] = useState<number | null>(24);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/tasks/assignees", { credentials: "include" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "تعذر تحميل الميديا بايرز");
        if (active) setAssignees((Array.isArray(data) ? data : []).filter((a: Assignee) => a.role === "media_buyer"));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "تعذر تحميل الميديا بايرز");
      } finally {
        if (active) setLoadingAssignees(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const generatedNotes = useMemo(() => [
    (product.description || product.title || "").trim() || null,
    offers.trim() ? `العروض للميديا باير:\n${offers.trim()}` : null,
    product.supplier_url ? `رابط المورد: ${product.supplier_url}` : null,
    extraNotes.trim() ? `تعليمات إضافية:\n${extraNotes.trim()}` : null,
  ].filter(Boolean).join("\n\n"), [product.description, product.title, product.supplier_url, offers, extraNotes]);

  useEffect(() => {
    if (!finalNotesDirty) setFinalNotes(generatedNotes);
  }, [generatedNotes, finalNotesDirty]);

  const selectedNames = useMemo(
    () => assignees.filter(a => selectedIds.includes(a.id)).map(a => a.username),
    [assignees, selectedIds]
  );

  const toggleBuyer = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const presets = [
    { h: 3, label: "٣ ساعات" },
    { h: 12, label: "١٢ ساعة" },
    { h: 24, label: "يوم" },
    { h: 48, label: "يومان" },
    { h: 72, label: "٣ أيام" },
  ];

  async function attachProductMedia(taskId: number) {
    const media = Array.isArray(product.media) ? product.media : [];
    for (let i = 0; i < media.length; i++) {
      const item = media[i];
      const objectPath = mediaObjectPath(item.url);
      if (!objectPath) continue;
      const mimeType = item.type === "video" ? "video/mp4" : "image/jpeg";
      const originalName = `product-hunting-${product.id}-${i + 1}.${item.type === "video" ? "mp4" : "jpg"}`;
      const r = await fetch(`/api/tasks/${taskId}/media`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectPath, originalName, mimeType }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || "تم إنشاء المهمة لكن تعذر إرفاق بعض الميديا");
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!taskTitle.trim() || !deadline) return setError("عنوان المهمة والموعد النهائي مطلوبان");
    if (!selectedIds.length) return setError("اختار ميديا باير واحد على الأقل");

    setSaving(true);
    try {
      for (const buyerId of selectedIds) {
        const buyer = assignees.find(a => a.id === buyerId);
        const r = await fetch("/api/tasks", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: taskTitle.trim(),
            product_name: productName.trim() || null,
            assigned_to_id: buyerId,
            assigned_to_name: buyer?.username || null,
            deadline: new Date(deadline).toISOString(),
            success_metric: metric.trim() || null,
            notes: finalNotes.trim() || null,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `تعذر إنشاء المهمة لـ ${buyer?.username || "الميديا باير"}`);
        await attachProductMedia(Number(data.id));
      }

      onDone(`تم تحويل المنتج إلى ${selectedIds.length} ${selectedIds.length === 1 ? "مهمة" : "مهام"} للميديا بايرز: ${selectedNames.join("، ")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إنشاء المهمة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[160] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={e => { if (e.currentTarget === e.target && !saving) onClose(); }} dir="rtl">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl">
        <div className="sticky top-0 z-10 bg-background border-b border-border px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2"><Target className="h-5 w-5 text-primary" /> تحويل المنتج لمهمة <span className="text-[10px] font-normal text-muted-foreground">v6</span></h2>
            <p className="text-xs text-muted-foreground mt-1">راجع الملاحظات النهائية قبل الإنشاء؛ رابط Telegram لا يرسل للميديا باير.</p>
          </div>
          <button onClick={onClose} disabled={saving} className="h-9 w-9 rounded-lg hover:bg-muted inline-flex items-center justify-center disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-5">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}

          <div className="grid gap-4">
            <label className="grid gap-1.5"><span className="text-sm font-medium">عنوان المهمة *</span><input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="اكتب عنوان المهمة" className="h-10 rounded-xl border border-input bg-background px-3 text-sm" /></label>
            <label className="grid gap-1.5"><span className="text-sm font-medium">اسم المنتج</span><input value={productName} onChange={e => setProductName(e.target.value)} placeholder="اكتب اسم المنتج" className="h-10 rounded-xl border border-input bg-background px-3 text-sm" /></label>
          </div>

          <label className="grid gap-1.5"><span className="text-sm font-medium">العروض للميديا بايرز</span><textarea value={offers} onChange={e => { setOffers(e.target.value); setFinalNotesDirty(false); }} rows={3} placeholder="مثال: 1 قطعة 399ج — 2 قطعة 649ج" className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-y" /></label>

          <div>
            <div className="flex items-center justify-between mb-2"><span className="text-sm font-medium flex items-center gap-1.5"><UserRound className="h-4 w-4" /> الميديا بايرز *</span>{selectedIds.length > 0 && <span className="text-xs text-muted-foreground">تم اختيار {selectedIds.length}</span>}</div>
            <div className="rounded-xl border border-input p-2 grid sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto">
              {loadingAssignees ? <div className="sm:col-span-2 py-5 text-center text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin inline ml-2" /> جاري التحميل...</div> : assignees.map(a => {
                const selected = selectedIds.includes(a.id);
                return <button key={a.id} type="button" onClick={() => toggleBuyer(a.id)} className={`h-10 rounded-lg border px-3 text-sm flex items-center justify-between gap-2 ${selected ? "bg-primary/10 border-primary text-primary" : "border-input hover:bg-muted"}`}><span>{a.username}</span>{selected && <Check className="h-4 w-4" />}</button>;
              })}
            </div>
          </div>

          <label className="grid gap-1.5"><span className="text-sm font-medium">مقياس النجاح</span><input value={metric} onChange={e => setMetric(e.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm" /></label>

          <div>
            <span className="text-sm font-medium flex items-center gap-1.5 mb-2"><Clock3 className="h-4 w-4" /> الموعد النهائي</span>
            <div className="flex flex-wrap gap-2 mb-2">{presets.map(p => <button key={p.h} type="button" onClick={() => { setDeadline(cairoLocalPlusHours(p.h)); setPresetHours(p.h); }} className={`h-8 px-3 rounded-lg border text-xs font-medium ${presetHours === p.h ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-muted"}`}>{p.label}</button>)}</div>
            <input type="datetime-local" value={deadline} onChange={e => { setDeadline(e.target.value); setPresetHours(null); }} className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm" required />
          </div>

          <label className="grid gap-1.5"><span className="text-sm font-medium">تعليمات إضافية</span><textarea value={extraNotes} onChange={e => { setExtraNotes(e.target.value); setFinalNotesDirty(false); }} rows={3} className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-y" /></label>

          <label className="grid gap-1.5 rounded-xl border-2 border-primary/40 bg-primary/5 p-3">
            <span className="text-sm font-bold">الملاحظات النهائية للميديا باير</span>
            <span className="text-xs text-muted-foreground">محتوى Telegram موجود هنا. عدّله واحذف أي سعر أو تفاصيل مش عايزها قبل الإنشاء.</span>
            <textarea value={finalNotes} onChange={e => { setFinalNotes(e.target.value); setFinalNotesDirty(true); }} rows={12} className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-y leading-relaxed" />
            {finalNotesDirty && <button type="button" onClick={() => { setFinalNotes(generatedNotes); setFinalNotesDirty(false); }} className="justify-self-start text-xs text-primary hover:underline">إعادة توليد الملاحظات</button>}
          </label>

          <div className="sticky bottom-0 bg-background border-t border-border pt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="h-10 px-4 rounded-xl border border-input text-sm font-medium disabled:opacity-50">إلغاء</button>
            <button type="submit" disabled={saving || loadingAssignees} className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />} إنشاء المهمة</button>
          </div>
        </form>
      </div>
    </div>
  );
}
