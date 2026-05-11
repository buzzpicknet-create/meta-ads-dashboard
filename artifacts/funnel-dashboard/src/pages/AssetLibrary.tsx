import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Library, Plus, Trash2, ChevronDown, ChevronUp, Copy, Wand2,
  Link2, FileText, Heading1, FolderOpen, Clock, X, Sparkles, Loader2,
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

interface Product    { id: number; name: string; created_at: string; }
interface Angle      { id: number; name: string; product_id: number; created_at: string; }
interface Asset      { id: number; angle_id: number; type: AssetType; content: string; title: string | null; created_at: string; }
interface HistoryRow { id: number; product_name: string; angle_name: string; generated_prompt: string; created_at: string; }

type AssetType = "LANDING_PAGE" | "PRIMARY_TEXT" | "HEADLINE" | "DRIVE_LINK";

const ASSET_TYPES: { type: AssetType; label: string; icon: React.ReactNode; placeholder: string; multi: boolean }[] = [
  { type: "LANDING_PAGE", label: "صفحة الهبوط",   icon: <Link2      className="h-4 w-4" />, placeholder: "https://example.com/landing",   multi: true },
  { type: "PRIMARY_TEXT", label: "النص الإعلاني", icon: <FileText   className="h-4 w-4" />, placeholder: "اكتب نص الإعلان هنا...",          multi: true },
  { type: "HEADLINE",     label: "العنوان",        icon: <Heading1   className="h-4 w-4" />, placeholder: "عنوان الإعلان",                   multi: true },
  { type: "DRIVE_LINK",   label: "رابط الميديا",   icon: <FolderOpen className="h-4 w-4" />, placeholder: "https://drive.google.com/...",   multi: false },
];

// Multi-select state: angleId → type → Set of asset IDs
type MultiSel = Record<number, Record<AssetType, Set<number>>>;

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

// ── Prompt builder (multi-variant) ────────────────────────────────────────────

function buildVariantPrompts(
  product: string,
  angle: string,
  assets: Asset[],
  sel: Record<AssetType, Set<number>>,
): string[] {
  const get = (type: AssetType) => assets.filter(a => a.type === type && sel[type].has(a.id));

  const lps    = get("LANDING_PAGE");
  const texts  = get("PRIMARY_TEXT");
  const heads  = get("HEADLINE");
  const drives = get("DRIVE_LINK");

  const driveStr = drives[0]?.content ?? "—";

  // Build combinations: LP × text × headline (cap at 9 to avoid spam)
  const combos: { lp: Asset | null; text: Asset | null; head: Asset | null }[] = [];
  const lpList   = lps.length   ? lps   : [null];
  const textList = texts.length ? texts : [null];
  const headList = heads.length ? heads : [null];

  outer:
  for (const lp of lpList) {
    for (const text of textList) {
      for (const head of headList) {
        combos.push({ lp, text, head });
        if (combos.length >= 9) break outer;
      }
    }
  }

  return combos.map((c, i) => {
    const prefix = combos.length > 1 ? `[فارينت ${i + 1}]\n` : "";
    return `${prefix}قم بإنشاء حملة إعلانية جديدة عبر Pipeboard.
- المنتج: ${product}
- الزاوية التسويقية: ${angle}
- رابط صفحة الهبوط: ${c.lp?.content ?? "—"}
- النص الإعلاني: ${c.text?.content ?? "—"}
- العنوان: ${c.head?.content ?? "—"}
- رابط الميديا (درايف): ${driveStr}`;
  });
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
      <Plus className="h-3.5 w-3.5" /> إضافة يدوي
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
          rows={4}
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

// ── Asset Item (checkbox or radio) ─────────────────────────────────────────────

function AssetItem({
  asset,
  angleId,
  type,
  checked,
  multi,
  onToggle,
  onDelete,
}: {
  asset: Asset;
  angleId: number;
  type: AssetType;
  checked: boolean;
  multi: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <label
      className={`group flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors ${
        checked
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/40 hover:bg-muted/50"
      }`}
    >
      <input
        type={multi ? "checkbox" : "radio"}
        name={multi ? undefined : `angle-${angleId}-${type}`}
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 accent-primary shrink-0"
      />
      <div className="flex-1 min-w-0">
        {asset.title && (
          <div className="text-xs font-semibold text-primary mb-0.5">{asset.title}</div>
        )}
        <div className="text-xs text-foreground break-all leading-relaxed line-clamp-4">
          {asset.content}
        </div>
      </div>
      <button
        type="button"
        onClick={e => { e.preventDefault(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </label>
  );
}

// ── Asset Group ────────────────────────────────────────────────────────────────

function AssetGroup({
  angleId, type, assets, selectedIds, onToggle, onDeleted,
}: {
  angleId: number;
  type: AssetType;
  assets: Asset[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onDeleted: (deletedId: number) => void;
}) {
  const { toast } = useToast();
  const typeInfo = ASSET_TYPES.find(t => t.type === type)!;

  async function deleteAsset(id: number) {
    try {
      await apiFetch(`/library/assets/${id}`, { method: "DELETE" });
      onDeleted(id);
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {typeInfo.icon}
        <span>{typeInfo.label}</span>
        {typeInfo.multi && <span className="text-[10px] text-muted-foreground/60">(متعدد)</span>}
        <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1">{assets.length}</Badge>
      </div>
      {assets.map(asset => (
        <AssetItem
          key={asset.id}
          asset={asset}
          angleId={angleId}
          type={type}
          checked={selectedIds.has(asset.id)}
          multi={typeInfo.multi}
          onToggle={() => onToggle(asset.id)}
          onDelete={() => deleteAsset(asset.id)}
        />
      ))}
      <AddAssetForm angleId={angleId} type={type} onSaved={() => onDeleted(-1)} />
    </div>
  );
}

// ── Angle Card ────────────────────────────────────────────────────────────────

function AngleCard({
  angle,
  productName,
  selByType,
  onToggle,
  onDeleted,
  onAssetsChange,
  onGenerate,
}: {
  angle: Angle;
  productName: string;
  selByType: Record<AssetType, Set<number>>;
  onToggle: (type: AssetType, id: number) => void;
  onDeleted: () => void;
  onAssetsChange: () => void;
  onGenerate: (variants: string[]) => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [generating, setGenerating] = useState(false);

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

  async function generateWithAI() {
    const lps = assets.filter(a => a.type === "LANDING_PAGE");
    if (lps.length === 0) {
      toast({ title: "أضف صفحة هبوط أولاً", description: "الـ AI يحتاج رابط اللاندينج لتوليد النصوص.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const result = await apiFetch<{ texts: { content: string; title: string }[]; headlines: { content: string }[] }>(
        `/library/angles/${angle.id}/generate-content`,
        {
          method: "POST",
          body: JSON.stringify({
            productName,
            angleName: angle.name,
            landingPageUrls: lps.map(l => l.content),
          }),
        }
      );
      await refetch();
      onAssetsChange();
      toast({ title: `✅ تم التوليد!`, description: `${result.texts.length} نص و${result.headlines.length} عنوان تمت إضافتهم تلقائياً.` });
    } catch (err) {
      toast({ title: "خطأ في التوليد", description: String(err), variant: "destructive" });
    } finally { setGenerating(false); }
  }

  const assetsByType = (type: AssetType) => assets.filter(a => a.type === type);

  const totalSel = (["LANDING_PAGE", "PRIMARY_TEXT", "HEADLINE", "DRIVE_LINK"] as AssetType[])
    .reduce((sum, t) => sum + selByType[t].size, 0);

  const variantCount = Math.max(
    selByType.LANDING_PAGE.size || 1,
    1
  ) * Math.max(selByType.PRIMARY_TEXT.size || 1, 1) * Math.max(selByType.HEADLINE.size || 1, 1);

  const hasLPs = assets.some(a => a.type === "LANDING_PAGE");
  const hasSel = totalSel > 0;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{angle.name}</div>
          {totalSel > 0 && (
            <div className="text-xs text-primary mt-0.5">
              {totalSel} محدد{variantCount > 1 ? ` — ${Math.min(variantCount, 9)} فارينت` : ""}
            </div>
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
          {/* AI generate bar */}
          <div className="flex items-center gap-2 pt-1">
            <div className="text-xs text-muted-foreground flex-1">
              {hasLPs
                ? "أضف اللاندينج ثم اضغط توليد بالـ AI لاستكمال النصوص والعناوين تلقائياً"
                : "أضف صفحة هبوط أولاً حتى يتمكن الـ AI من توليد النصوص"}
            </div>
            <Button
              size="sm"
              variant={hasLPs ? "default" : "outline"}
              className="h-8 gap-1.5 shrink-0 text-xs"
              onClick={e => { e.stopPropagation(); generateWithAI(); }}
              disabled={generating}
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? "جاري التوليد..." : "✨ توليد بالـ AI"}
            </Button>
          </div>

          {ASSET_TYPES.map(({ type }) => (
            <AssetGroup
              key={type}
              angleId={angle.id}
              type={type}
              assets={assetsByType(type)}
              selectedIds={selByType[type]}
              onToggle={(id) => onToggle(type, id)}
              onDeleted={(deletedId) => {
                if (deletedId >= 0) {
                  // asset was deleted — remove from selection if present
                  // handled by parent via toggling off
                }
                refetch();
                onAssetsChange();
              }}
            />
          ))}

          {hasSel && (
            <div className="flex items-center gap-2 pt-1 border-t border-border/40">
              <div className="text-xs text-muted-foreground flex-1">
                {variantCount > 1
                  ? `سيتم توليد ${Math.min(variantCount, 9)} فارينت (${selByType.LANDING_PAGE.size || 1} LP × ${selByType.PRIMARY_TEXT.size || 1} نص × ${selByType.HEADLINE.size || 1} عنوان)`
                  : "فارينت واحد"}
              </div>
              <Button
                size="sm"
                className="gap-1.5 h-8 shrink-0"
                onClick={() => {
                  const variants = buildVariantPrompts(productName, angle.name, assets, selByType);
                  onGenerate(variants);
                }}
              >
                <Wand2 className="h-4 w-4" />
                توليد أوامر الإطلاق
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Variant Prompt Modal ───────────────────────────────────────────────────────

function VariantModal({
  open,
  onClose,
  variants,
  onCopyAll,
  onCopyOne,
}: {
  open: boolean;
  onClose: () => void;
  variants: string[];
  onCopyAll: (text: string) => void;
  onCopyOne: (text: string) => void;
}) {
  const allText = variants.join("\n\n" + "─".repeat(40) + "\n\n");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl h-[85vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            {variants.length > 1 ? `${variants.length} فارينتات للإطلاق` : "أمر الإطلاق"}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 pb-4">
            {variants.map((v, i) => (
              <div key={i} className="rounded-xl border border-border bg-muted/30 overflow-hidden">
                {variants.length > 1 && (
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
                    <span className="text-xs font-semibold text-primary">فارينت {i + 1}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs gap-1 px-2"
                      onClick={() => onCopyOne(v)}
                    >
                      <Copy className="h-3 w-3" /> نسخ
                    </Button>
                  </div>
                )}
                <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans px-3 py-3 text-foreground">
                  {v}
                </pre>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
          <Button className="gap-2 flex-1" onClick={() => onCopyAll(allText)}>
            <Copy className="h-4 w-4" />
            {variants.length > 1 ? `📋 نسخ الكل (${variants.length} فارينتات)` : "📋 نسخ إلى الحافظة"}
          </Button>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const EMPTY_SEL = (): Record<AssetType, Set<number>> => ({
  LANDING_PAGE: new Set(),
  PRIMARY_TEXT: new Set(),
  HEADLINE:     new Set(),
  DRIVE_LINK:   new Set(),
});

export default function AssetLibrary() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [newProductName, setNewProductName]       = useState("");
  const [newAngleName, setNewAngleName]           = useState("");

  // selections: angleId → type → Set<assetId>
  const [selections, setSelections] = useState<MultiSel>({});
  const [promptModal, setPromptModal]  = useState(false);
  const [promptVariants, setPromptVariants] = useState<string[]>([]);
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

  const getAngleSel = useCallback((angleId: number): Record<AssetType, Set<number>> =>
    selections[angleId] ?? EMPTY_SEL(), [selections]);

  const handleToggle = useCallback((angleId: number, type: AssetType, id: number) => {
    setSelections(prev => {
      const cur = prev[angleId] ?? EMPTY_SEL();
      const typeInfo = ASSET_TYPES.find(t => t.type === type)!;
      let nextSet: Set<number>;
      if (typeInfo.multi) {
        nextSet = new Set(cur[type]);
        if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id);
      } else {
        // radio-style: only one allowed
        nextSet = cur[type].has(id) && cur[type].size === 1 ? new Set() : new Set([id]);
      }
      return { ...prev, [angleId]: { ...cur, [type]: nextSet } };
    });
  }, []);

  // ── Prompt actions ─────────────────────────────────────────────────────────

  function openPromptModal(angle: Angle, variants: string[]) {
    setPromptVariants(variants);
    setActiveAngle(angle);
    setPromptModal(true);
  }

  async function handleCopy(text: string, label = "الأوامر") {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    if (selectedProduct && activeAngle) {
      try {
        await apiFetch("/library/history", {
          method: "POST",
          body: JSON.stringify({
            product_id: selectedProduct.id,
            product_name: selectedProduct.name,
            angle_name: activeAngle.name,
            generated_prompt: text,
          }),
        });
        refetchHistory();
      } catch { /* ignore */ }
    }
    toast({ title: `✅ تم نسخ ${label}!`, description: "الأمر جاهز للصق في المساعد." });
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
            <p className="text-sm text-muted-foreground">
              أضف اللاندينج ← الـ AI يولّد النصوص والعناوين ← اختر للمقارنة ← أطلق
            </p>
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

        {/* Product selector */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">المنتج</div>
          <div className="flex flex-wrap gap-2">
            {products.map(p => (
              <div key={p.id} className="flex items-center">
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

        {/* Angles */}
        {selectedProductId !== null && (
          <div className="space-y-4">
            <form
              className="flex gap-2"
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

            {angles.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm border border-dashed rounded-xl">
                لا توجد زوايا تسويقية بعد — أضف الأولى أعلاه
              </div>
            ) : (
              angles.map(angle => (
                <AngleCard
                  key={angle.id}
                  angle={angle}
                  productName={selectedProduct?.name ?? ""}
                  selByType={getAngleSel(angle.id)}
                  onToggle={(type, id) => handleToggle(angle.id, type, id)}
                  onDeleted={() => { refetchAngles(); qc.invalidateQueries({ queryKey: ["lib-assets", angle.id] }); }}
                  onAssetsChange={() => qc.invalidateQueries({ queryKey: ["lib-assets", angle.id] })}
                  onGenerate={(variants) => openPromptModal(angle, variants)}
                />
              ))
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

      {/* ── Variant Prompt Modal ────────────────────────────────────────────── */}
      <VariantModal
        open={promptModal}
        onClose={() => setPromptModal(false)}
        variants={promptVariants}
        onCopyAll={(text) => handleCopy(text, promptVariants.length > 1 ? `${promptVariants.length} فارينتات` : "الأمر")}
        onCopyOne={(text) => handleCopy(text, "الفارينت")}
      />

      {/* ── History Dialog ───────────────────────────────────────────────────── */}
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
                    <pre className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2 whitespace-pre-wrap font-sans leading-relaxed">
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
