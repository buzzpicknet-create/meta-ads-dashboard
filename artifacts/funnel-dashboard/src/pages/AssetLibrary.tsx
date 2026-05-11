import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Library, Plus, Trash2, ChevronDown, ChevronUp, Copy, Wand2,
  Link2, FileText, Heading1, FolderOpen, Clock, CheckCircle2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product { id: number; name: string; created_at: string; }
interface Angle   { id: number; name: string; product_id: number; created_at: string; }
interface Asset   { id: number; angle_id: number; type: AssetType; content: string; title: string | null; created_at: string; }
interface HistoryRow { id: number; product_name: string; angle_name: string; generated_prompt: string; created_at: string; }

type AssetType = "LANDING_PAGE" | "PRIMARY_TEXT" | "HEADLINE" | "DRIVE_LINK";

const ASSET_TYPES: { type: AssetType; label: string; icon: React.ReactNode; placeholder: string }[] = [
  { type: "LANDING_PAGE",  label: "صفحة الهبوط",   icon: <Link2      className="h-4 w-4" />, placeholder: "https://example.com/landing" },
  { type: "PRIMARY_TEXT",  label: "النص الإعلاني", icon: <FileText   className="h-4 w-4" />, placeholder: "اكتب نص الإعلان هنا..." },
  { type: "HEADLINE",      label: "العنوان",        icon: <Heading1   className="h-4 w-4" />, placeholder: "عنوان الإعلان" },
  { type: "DRIVE_LINK",    label: "رابط الميديا",   icon: <FolderOpen className="h-4 w-4" />, placeholder: "https://drive.google.com/..." },
];

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts,
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
  return r.json() as Promise<T>;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(product: string, angle: string, sel: Record<AssetType, Asset | null>): string {
  return `قم بإنشاء حملة إعلانية جديدة عبر Pipeboard.
- المنتج: ${product}
- الزاوية التسويقية: ${angle}
- رابط صفحة الهبوط: ${sel.LANDING_PAGE?.content ?? "—"}
- النص الإعلاني: ${sel.PRIMARY_TEXT?.content ?? "—"}
- العنوان: ${sel.HEADLINE?.content ?? "—"}
- رابط الميديا (درايف): ${sel.DRIVE_LINK?.content ?? "—"}`;
}

// ── Add Asset Form ─────────────────────────────────────────────────────────────

function AddAssetForm({ angleId, type, onSaved }: { angleId: number; type: AssetType; onSaved: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const typeInfo = ASSET_TYPES.find(t => t.type === type)!;

  async function save() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/library/angles/${angleId}/assets`, {
        method: "POST",
        body: JSON.stringify({ type, content, title }),
      });
      setContent(""); setTitle(""); setOpen(false); onSaved();
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    } finally { setSaving(false); }
  }

  if (!open) return (
    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-primary" onClick={() => setOpen(true)}>
      <Plus className="h-3.5 w-3.5" /> إضافة
    </Button>
  );

  return (
    <div className="mt-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 space-y-2">
      <Input
        dir="rtl"
        placeholder="عنوان اختياري (label)"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="h-8 text-sm"
      />
      {type === "PRIMARY_TEXT" ? (
        <Textarea
          dir="rtl"
          placeholder={typeInfo.placeholder}
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={3}
          className="text-sm resize-none"
        />
      ) : (
        <Input
          dir="rtl"
          placeholder={typeInfo.placeholder}
          value={content}
          onChange={e => setContent(e.target.value)}
          className="h-8 text-sm"
        />
      )}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setOpen(false); setContent(""); setTitle(""); }}>
          إلغاء
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={save} disabled={!content.trim() || saving}>
          حفظ
        </Button>
      </div>
    </div>
  );
}

// ── Asset Group (one type inside an angle) ─────────────────────────────────────

function AssetGroup({
  angleId, type, assets, selected, onSelect, onDeleted,
}: {
  angleId: number;
  type: AssetType;
  assets: Asset[];
  selected: Asset | null;
  onSelect: (a: Asset | null) => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const typeInfo = ASSET_TYPES.find(t => t.type === type)!;

  async function deleteAsset(id: number) {
    try {
      await apiFetch(`/library/assets/${id}`, { method: "DELETE" });
      if (selected?.id === id) onSelect(null);
      onDeleted();
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {typeInfo.icon}
        <span>{typeInfo.label}</span>
        <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1">{assets.length}</Badge>
      </div>

      {assets.map(asset => (
        <label
          key={asset.id}
          className={`group flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors ${
            selected?.id === asset.id
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40 hover:bg-muted/50"
          }`}
        >
          <input
            type="radio"
            name={`angle-${angleId}-${type}`}
            checked={selected?.id === asset.id}
            onChange={() => onSelect(selected?.id === asset.id ? null : asset)}
            className="mt-0.5 accent-primary shrink-0"
          />
          <div className="flex-1 min-w-0">
            {asset.title && (
              <div className="text-xs font-semibold text-primary mb-0.5">{asset.title}</div>
            )}
            <div className="text-xs text-foreground break-all leading-relaxed line-clamp-3">
              {asset.content}
            </div>
          </div>
          {selected?.id === asset.id && (
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          )}
          <button
            type="button"
            onClick={e => { e.preventDefault(); deleteAsset(asset.id); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </label>
      ))}

      <AddAssetForm angleId={angleId} type={type} onSaved={onDeleted} />
    </div>
  );
}

// ── Angle Card ────────────────────────────────────────────────────────────────

function AngleCard({
  angle,
  selections,
  onSelect,
  onDeleted,
  onAssetsChange,
}: {
  angle: Angle;
  selections: Record<AssetType, Asset | null>;
  onSelect: (type: AssetType, asset: Asset | null) => void;
  onDeleted: () => void;
  onAssetsChange: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);

  const { data: assets = [], refetch } = useQuery<Asset[]>({
    queryKey: ["lib-assets", angle.id],
    queryFn: () => apiFetch(`/library/angles/${angle.id}/assets`),
  });

  async function deleteAngle() {
    if (!confirm(`حذف الزاوية "${angle.name}" وكل أصولها؟`)) return;
    try {
      await apiFetch(`/library/angles/${angle.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    }
  }

  const assetsByType = (type: AssetType) => assets.filter(a => a.type === type);
  const totalSelected = ASSET_TYPES.filter(t => selections[t.type] !== null).length;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{angle.name}</div>
          {totalSelected > 0 && (
            <div className="text-xs text-primary mt-0.5">{totalSelected} / 4 محدد</div>
          )}
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); deleteAngle(); }}
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/60">
          {ASSET_TYPES.map(({ type }) => (
            <AssetGroup
              key={type}
              angleId={angle.id}
              type={type}
              assets={assetsByType(type)}
              selected={selections[type]}
              onSelect={asset => onSelect(type, asset)}
              onDeleted={() => { refetch(); onAssetsChange(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AssetLibrary() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [newProductName, setNewProductName] = useState("");
  const [newAngleName, setNewAngleName] = useState("");

  // selections: angleId → type → asset
  const [selections, setSelections] = useState<Record<number, Record<AssetType, Asset | null>>>({});
  const [promptModal, setPromptModal] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [activeAngle, setActiveAngle] = useState<Angle | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: products = [], refetch: refetchProducts } = useQuery<Product[]>({
    queryKey: ["lib-products"],
    queryFn: () => apiFetch("/library/products"),
  });

  const { data: angles = [], refetch: refetchAngles } = useQuery<Angle[]>({
    queryKey: ["lib-angles", selectedProductId],
    queryFn: () => apiFetch(`/library/products/${selectedProductId}/angles`),
    enabled: selectedProductId !== null,
  });

  const { data: history = [], refetch: refetchHistory } = useQuery<HistoryRow[]>({
    queryKey: ["lib-history", selectedProductId],
    queryFn: () => apiFetch(`/library/history${selectedProductId ? `?productId=${selectedProductId}` : ""}`),
    enabled: historyOpen,
  });

  const selectedProduct = products.find(p => p.id === selectedProductId) ?? null;

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createProduct = useMutation({
    mutationFn: (name: string) => apiFetch<Product>("/library/products", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: (p) => { refetchProducts(); setSelectedProductId(p.id); setNewProductName(""); },
    onError: (err) => toast({ title: "خطأ", description: String(err), variant: "destructive" }),
  });

  const deleteProduct = useMutation({
    mutationFn: (id: number) => apiFetch(`/library/products/${id}`, { method: "DELETE" }),
    onSuccess: () => { refetchProducts(); setSelectedProductId(null); },
    onError: (err) => toast({ title: "خطأ", description: String(err), variant: "destructive" }),
  });

  const createAngle = useMutation({
    mutationFn: (name: string) => apiFetch<Angle>(`/library/products/${selectedProductId}/angles`, { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => { refetchAngles(); setNewAngleName(""); },
    onError: (err) => toast({ title: "خطأ", description: String(err), variant: "destructive" }),
  });

  // ── Selection helpers ──────────────────────────────────────────────────────

  const handleSelect = useCallback((angleId: number, type: AssetType, asset: Asset | null) => {
    setSelections(prev => ({
      ...prev,
      [angleId]: { ...(prev[angleId] ?? { LANDING_PAGE: null, PRIMARY_TEXT: null, HEADLINE: null, DRIVE_LINK: null }), [type]: asset },
    }));
  }, []);

  const getAngleSel = (angleId: number): Record<AssetType, Asset | null> =>
    selections[angleId] ?? { LANDING_PAGE: null, PRIMARY_TEXT: null, HEADLINE: null, DRIVE_LINK: null };

  // ── Prompt Generator ───────────────────────────────────────────────────────

  function generatePrompt(angle: Angle) {
    const sel = getAngleSel(angle.id);
    const prompt = buildPrompt(selectedProduct?.name ?? "", angle.name, sel);
    setGeneratedPrompt(prompt);
    setActiveAngle(angle);
    setPromptModal(true);
  }

  async function copyAndSave(prompt: string) {
    try { await navigator.clipboard.writeText(prompt); } catch { /* ignore */ }
    if (selectedProduct && activeAngle) {
      try {
        await apiFetch("/library/history", {
          method: "POST",
          body: JSON.stringify({
            product_id: selectedProduct.id,
            product_name: selectedProduct.name,
            angle_name: activeAngle.name,
            generated_prompt: prompt,
          }),
        });
        refetchHistory();
      } catch { /* ignore history save error */ }
    }
    toast({ title: "✅ تم النسخ!", description: "الأمر جاهز للصق في المساعد أو Pipeboard." });
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Library className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">مكتبة الأصول التسويقية</h1>
            <p className="text-sm text-muted-foreground">منظّمة حسب الزوايا التسويقية — اختر أصلاً واحداً من كل نوع وولّد أمر الإطلاق</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mr-auto gap-1.5"
            onClick={() => { setHistoryOpen(true); refetchHistory(); }}
          >
            <Clock className="h-4 w-4" />
            سجل الإطلاقات
          </Button>
        </div>

        {/* Product selector + creator */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">المنتج</div>
          <div className="flex flex-wrap gap-2">
            {products.map(p => (
              <div key={p.id} className="flex items-center gap-0">
                <button
                  onClick={() => setSelectedProductId(p.id === selectedProductId ? null : p.id)}
                  className={`px-3 py-1.5 rounded-r-lg text-sm font-medium border transition-colors ${
                    p.id === selectedProductId
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:border-primary/50"
                  }`}
                >
                  {p.name}
                </button>
                <button
                  onClick={() => { if (confirm(`حذف "${p.name}"؟`)) deleteProduct.mutate(p.id); }}
                  className={`px-2 py-1.5 rounded-l-lg border-y border-l text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors ${
                    p.id === selectedProductId ? "border-primary/60" : "border-border"
                  }`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={e => { e.preventDefault(); if (newProductName.trim()) createProduct.mutate(newProductName.trim()); }}
          >
            <Input
              placeholder="اسم منتج جديد..."
              value={newProductName}
              onChange={e => setNewProductName(e.target.value)}
              className="h-8 text-sm max-w-xs"
            />
            <Button type="submit" size="sm" className="h-8 gap-1" disabled={!newProductName.trim() || createProduct.isPending}>
              <Plus className="h-4 w-4" /> إضافة منتج
            </Button>
          </form>
        </div>

        {/* Angles + assets */}
        {selectedProductId !== null && (
          <div className="space-y-4">
            {/* Add angle form */}
            <div className="flex gap-2 items-center">
              <form
                className="flex gap-2 flex-1"
                onSubmit={e => { e.preventDefault(); if (newAngleName.trim()) createAngle.mutate(newAngleName.trim()); }}
              >
                <Input
                  placeholder="اسم الزاوية التسويقية (مثال: قبل وبعد، زاوية الخصم...)"
                  value={newAngleName}
                  onChange={e => setNewAngleName(e.target.value)}
                  className="h-8 text-sm"
                />
                <Button type="submit" size="sm" className="h-8 gap-1 shrink-0" disabled={!newAngleName.trim() || createAngle.isPending}>
                  <Plus className="h-4 w-4" /> زاوية جديدة
                </Button>
              </form>
            </div>

            {angles.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm border border-dashed rounded-xl">
                لا توجد زوايا تسويقية بعد — أضف الأولى أعلاه
              </div>
            ) : (
              angles.map(angle => {
                const sel = getAngleSel(angle.id);
                const hasAll = ASSET_TYPES.every(t => sel[t.type] !== null);
                const hasSome = ASSET_TYPES.some(t => sel[t.type] !== null);
                return (
                  <div key={angle.id}>
                    <AngleCard
                      angle={angle}
                      selections={sel}
                      onSelect={(type, asset) => handleSelect(angle.id, type, asset)}
                      onDeleted={() => { refetchAngles(); qc.invalidateQueries({ queryKey: ["lib-assets", angle.id] }); }}
                      onAssetsChange={() => qc.invalidateQueries({ queryKey: ["lib-assets", angle.id] })}
                    />
                    {hasSome && (
                      <div className="flex items-center gap-2 mt-2 px-1">
                        {!hasAll && (
                          <span className="text-xs text-amber-600">
                            اختر {ASSET_TYPES.filter(t => sel[t.type] === null).map(t => t.label).join(" + ")} لتوليد الأمر كاملاً
                          </span>
                        )}
                        <Button
                          size="sm"
                          className="mr-auto gap-1.5 h-8"
                          onClick={() => generatePrompt(angle)}
                        >
                          <Wand2 className="h-4 w-4" />
                          توليد أمر الإطلاق
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {selectedProductId === null && products.length > 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm border border-dashed rounded-xl">
            اختر منتجاً من الأعلى للبدء
          </div>
        )}

        {products.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm border border-dashed rounded-xl">
            ابدأ بإضافة منتجك الأول من الأعلى
          </div>
        )}
      </div>

      {/* ── Prompt Modal ──────────────────────────────────────────────────────── */}
      <Dialog open={promptModal} onOpenChange={setPromptModal}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              أمر الإطلاق
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={generatedPrompt}
              readOnly
              rows={10}
              className="font-mono text-sm leading-relaxed resize-none bg-muted"
              dir="rtl"
            />
            <p className="text-xs text-muted-foreground">
              انسخ هذا الأمر وألصقه في المساعد أو مباشرةً في Pipeboard لإطلاق الحملة.
            </p>
          </div>
          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
            <Button
              className="gap-2 flex-1"
              onClick={() => copyAndSave(generatedPrompt)}
            >
              <Copy className="h-4 w-4" />
              📋 نسخ إلى الحافظة
            </Button>
            <Button variant="outline" onClick={() => setPromptModal(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── History Drawer ────────────────────────────────────────────────────── */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl h-[80vh] flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              سجل الإطلاقات
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            {history.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                لا يوجد سجل بعد — ولّد أمراً وانسخه ليظهر هنا
              </div>
            ) : (
              <div className="space-y-3 pb-4">
                {history.map(row => (
                  <div key={row.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{row.product_name}</div>
                        <div className="text-xs text-muted-foreground">{row.angle_name} · {formatDate(row.created_at)}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 shrink-0"
                        onClick={async () => {
                          try { await navigator.clipboard.writeText(row.generated_prompt); } catch { /* ignore */ }
                          toast({ title: "✅ تم النسخ مجدداً!" });
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        نسخ مجدداً
                      </Button>
                    </div>
                    <pre className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap font-sans leading-relaxed">
                      {row.generated_prompt}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
