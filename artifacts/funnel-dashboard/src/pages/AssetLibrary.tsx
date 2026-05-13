import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAccounts } from "@/hooks/use-meta";
import { fetchCampaignsForAccount } from "@/lib/meta-api";
import {
  Library, Plus, Trash2, ChevronDown, ChevronUp, Copy, Wand2,
  Link2, FileText, Heading1, FolderOpen, Clock, X, Sparkles, Loader2,
  FlaskConical, Rocket, Pencil, Send, Zap, ArrowLeftRight, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product    { id: number; name: string; created_at: string; }
interface Angle      { id: number; name: string; product_id: number; created_at: string; }
interface Asset      { id: number; angle_id: number; type: AssetType; content: string; title: string | null; created_at: string; }
interface HistoryRow { id: number; product_name: string; angle_name: string; generated_prompt: string; created_at: string; }

type AssetType    = "LANDING_PAGE" | "PRIMARY_TEXT" | "HEADLINE" | "DRIVE_LINK";
type CampaignMode = "TEST" | "SCALE";

interface PixelEntry { id: string; name: string; }
interface PageEntry  { id: string; name: string; }

const PIXELS_KEY    = "launchpad_pixels";
const PIXEL_SEL_KEY = "launchpad_pixel_id";
const PAGES_KEY     = "launchpad_pages";
const PAGE_SEL_KEY  = "launchpad_page_id";

function loadPixels(): PixelEntry[] {
  try { const r = localStorage.getItem(PIXELS_KEY); if (r) return JSON.parse(r); } catch { /* ignore */ }
  return [];
}
function savePixels(list: PixelEntry[]) {
  try { localStorage.setItem(PIXELS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
function loadPages(): PageEntry[] {
  try { const r = localStorage.getItem(PAGES_KEY); if (r) return JSON.parse(r); } catch { /* ignore */ }
  return [];
}
function savePages(list: PageEntry[]) {
  try { localStorage.setItem(PAGES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

const MODE_CONFIG: Record<CampaignMode, {
  emoji: string; label: string; defaultBudget: number;
  limits: Record<AssetType, number>; budgetLabel: string;
}> = {
  TEST: {
    emoji: "🧪", label: "مرحلة الاختبار", defaultBudget: 180,
    limits: { LANDING_PAGE: 1, PRIMARY_TEXT: 2, HEADLINE: 2, DRIVE_LINK: 1 },
    budgetLabel: "ABO — الميزانية على مستوى المجموعة الإعلانية",
  },
  SCALE: {
    emoji: "🚀", label: "مرحلة التوسع", defaultBudget: 300,
    limits: { LANDING_PAGE: 99, PRIMARY_TEXT: 99, HEADLINE: 99, DRIVE_LINK: 1 },
    budgetLabel: "CBO — الميزانية على مستوى الحملة",
  },
};

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

// ── Blueprint Builder ──────────────────────────────────────────────────────────

function buildBlueprint(
  mode: CampaignMode,
  budget: number,
  pixelId: string,
  pageId: string,
  product: string,
  angle: string,
  assets: Asset[],
  sel: Record<AssetType, Set<number>>,
): string {
  const get = (type: AssetType) => assets.filter(a => a.type === type && sel[type].has(a.id));
  const lps    = get("LANDING_PAGE");
  const texts  = get("PRIMARY_TEXT");
  const heads  = get("HEADLINE");
  const drives = get("DRIVE_LINK");

  const today   = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
  const lpUrl   = lps[0]?.content ?? "—";
  const driveUrl = drives[0]?.content ?? "—";
  const textsStr = texts.length
    ? texts.map((t, i) => `  ${i + 1}. ${t.content}`).join("\n")
    : "  — لم يُحدد نص";
  const headsStr = heads.length
    ? heads.map((h, i) => `  ${i + 1}. ${h.content}`).join("\n")
    : "  — لم يُحدد عنوان";

  const pixelLine = pixelId.trim() ? `- Pixel ID: ${pixelId.trim()}` : `- Pixel ID: — (لم يُحدد — أضفه من لوحة التحكم)`;
  const pageLine  = pageId.trim()  ? `- Page ID: ${pageId.trim()}`   : `- Page ID: — (لم يُحدد — أضفه من لوحة التحكم)`;

  if (mode === "TEST") {
    return `[SYSTEM COMMAND: EXECUTE_CAMPAIGN_BLUEPRINT]
قم ببناء حملة (TESTING) عبر Pipeboard باستخدام الإعدادات التالية. نفذ فوراً:

# 1. Campaign Settings
- Objective: SALES (Conversions)
- Event: PURCHASE
- Campaign Name: ${product} - TEST - ${today}
- Budget Optimization: ABO (Adset Level Budget)
- الزاوية التسويقية: ${angle}

# 2. AdSet Settings
- Budget: ${budget} EGP daily
- Targeting: Advantage+ Audience (Broad)
- Placements: Advantage+ Placements
${pixelLine}

# 3. Ad Settings (Multi-Asset Test)
- Media URL: ${driveUrl}
- Destination URL: ${lpUrl}
${pageLine}
- Primary Texts:
${textsStr}
- Headlines:
${headsStr}

بعد تحديد الرابحين، اطلب الموافقة على إنشاء الحملة فوراً بدون جمع بيانات إضافية.
[END_COMMAND]`;
  }

  return `[SYSTEM COMMAND: EXECUTE_CAMPAIGN_BLUEPRINT]
قم ببناء حملة (SCALING) عبر Pipeboard باستخدام الإعدادات التالية. نفذ فوراً:

# 1. Campaign Settings
- Objective: SALES (Conversions)
- Event: PURCHASE
- Campaign Name: ${product} - SCALE - ${today}
- Budget Optimization: CBO (Campaign Budget Optimization)
- Campaign Budget: ${budget} EGP daily
- الزاوية التسويقية: ${angle}

# 2. AdSet Settings
- Adset Name: ASC+ / Broad Scale
- Targeting: Advantage+ Audience (Broad)
- Placements: Advantage+ Placements
${pixelLine}

# 3. Ad Settings (Aggressive Multi-Asset Scaling)
- Media URL (Extract ALL from folder): ${driveUrl}
- Destination URL: ${lpUrl}
${pageLine}
- Primary Texts (Use ALL):
${textsStr}
- Headlines (Use ALL):
${headsStr}
- Enable: Advantage+ Creative Enhancements (MUST BE TRUE)

[END_COMMAND]`;
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

// ── Asset Item ─────────────────────────────────────────────────────────────────

function AssetItem({
  asset, angleId, type, checked, multi, atLimit, onToggle, onDelete,
}: {
  asset: Asset; angleId: number; type: AssetType;
  checked: boolean; multi: boolean; atLimit: boolean;
  onToggle: () => void; onDelete: () => void;
}) {
  const disabled = atLimit && !checked;

  function handleLabelClick(e: React.MouseEvent) {
    // Ignore clicks that bubble up from the delete button
    if ((e.target as HTMLElement).closest("button")) return;
    if (!disabled) onToggle();
  }

  return (
    <div
      role={multi ? "checkbox" : "radio"}
      aria-checked={checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={handleLabelClick}
      onKeyDown={e => { if ((e.key === " " || e.key === "Enter") && !disabled) { e.preventDefault(); onToggle(); } }}
      className={`group flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors select-none ${
        checked
          ? "border-primary bg-primary/5 cursor-pointer"
          : disabled
            ? "border-border bg-muted/30 opacity-40 cursor-not-allowed"
            : "border-border hover:border-primary/40 hover:bg-muted/50 cursor-pointer"
      }`}
    >
      {/* Visual checkbox/radio indicator — purely decorative, state driven by parent div */}
      <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-sm border-2 flex items-center justify-center transition-colors ${
        checked
          ? "bg-primary border-primary"
          : "border-muted-foreground/40 bg-background"
      }`}>
        {checked && (
          <svg className="h-2.5 w-2.5 text-primary-foreground" viewBox="0 0 10 10" fill="none">
            {multi
              ? <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              : <circle cx="5" cy="5" r="2.5" fill="currentColor" />}
          </svg>
        )}
      </div>
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
        onClick={e => { e.stopPropagation(); e.preventDefault(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Asset Group ────────────────────────────────────────────────────────────────

function AssetGroup({
  angleId, type, assets, selectedIds, limit, onToggle, onDeleted,
}: {
  angleId: number; type: AssetType; assets: Asset[];
  selectedIds: Set<number>; limit: number;
  onToggle: (id: number) => void; onDeleted: (deletedId: number) => void;
}) {
  const { toast } = useToast();
  const typeInfo = ASSET_TYPES.find(t => t.type === type)!;
  const atLimit  = typeInfo.multi && selectedIds.size >= limit;

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
        {typeInfo.multi && limit < 99 && (
          <span className="text-[10px] text-muted-foreground/60">(حد أقصى {limit})</span>
        )}
        <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1">{assets.length}</Badge>
        {atLimit && (
          <Badge className="text-[10px] h-4 px-1.5 bg-amber-100 text-amber-700 border-amber-300">الحد الأقصى</Badge>
        )}
      </div>
      {assets.map(asset => (
        <AssetItem
          key={asset.id}
          asset={asset}
          angleId={angleId}
          type={type}
          checked={selectedIds.has(asset.id)}
          multi={typeInfo.multi}
          atLimit={atLimit}
          onToggle={() => onToggle(asset.id)}
          onDelete={() => deleteAsset(asset.id)}
        />
      ))}
      <AddAssetForm angleId={angleId} type={type} onSaved={() => onDeleted(-1)} />
    </div>
  );
}

// ── Angle Card ─────────────────────────────────────────────────────────────────

function AngleCard({
  angle, productName, mode, budget, pixelId, pageId, selByType, onToggle, onDeleted, onAssetsChange, onGenerate,
}: {
  angle: Angle; productName: string; mode: CampaignMode; budget: number; pixelId: string; pageId: string;
  selByType: Record<AssetType, Set<number>>;
  onToggle: (type: AssetType, id: number) => void;
  onDeleted: () => void; onAssetsChange: () => void;
  onGenerate: (blueprint: string) => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [generating, setGenerating] = useState(false);

  const { data: assets = [], refetch } = useQuery<Asset[]>({
    queryKey: ["lib-assets", angle.id],
    queryFn: () => apiFetch(`/library/angles/${angle.id}/assets`),
  });

  const limits = MODE_CONFIG[mode].limits;

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

  function launchBlueprint() {
    const totalSel = (["LANDING_PAGE", "PRIMARY_TEXT", "HEADLINE", "DRIVE_LINK"] as AssetType[])
      .reduce((sum, t) => sum + selByType[t].size, 0);
    if (totalSel === 0) {
      toast({ title: "لم تختر أي أصول", description: "اختر على الأقل صفحة هبوط ونصاً قبل التوليد.", variant: "destructive" });
      return;
    }
    const bp = buildBlueprint(mode, budget, pixelId, pageId, productName, angle.name, assets, selByType);
    onGenerate(bp);
  }

  const assetsByType = (type: AssetType) => assets.filter(a => a.type === type);
  const hasLPs   = assets.some(a => a.type === "LANDING_PAGE");
  const totalSel = (["LANDING_PAGE", "PRIMARY_TEXT", "HEADLINE", "DRIVE_LINK"] as AssetType[])
    .reduce((sum, t) => sum + selByType[t].size, 0);

  const modeColors = mode === "TEST"
    ? "text-blue-600 bg-blue-50 border-blue-200"
    : "text-emerald-600 bg-emerald-50 border-emerald-200";

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
              {totalSel} أصل محدد
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
                ? "اضغط توليد بالـ AI لاستخراج نصوص وعناوين من صفحة الهبوط"
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

          {/* Asset groups */}
          {ASSET_TYPES.map(({ type }) => (
            <AssetGroup
              key={type}
              angleId={angle.id}
              type={type}
              assets={assetsByType(type)}
              selectedIds={selByType[type]}
              limit={limits[type]}
              onToggle={(id) => onToggle(type, id)}
              onDeleted={(deletedId) => {
                void deletedId;
                refetch();
                onAssetsChange();
              }}
            />
          ))}

          {/* Launch blueprint button */}
          <div className={`flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t rounded-lg p-3 ${modeColors} border`}>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold">
                {MODE_CONFIG[mode].emoji} {MODE_CONFIG[mode].label}
              </div>
              <div className="text-xs opacity-75 mt-0.5 truncate">
                ميزانية {budget} EGP · {mode === "TEST" ? "ABO" : "CBO"}
              </div>
            </div>
            <Button
              size="sm"
              className={`gap-1.5 h-8 shrink-0 text-xs ${
                mode === "SCALE"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200 shadow-md"
                  : ""
              }`}
              onClick={e => { e.stopPropagation(); launchBlueprint(); }}
              disabled={totalSel === 0}
            >
              <Wand2 className="h-3.5 w-3.5" />
              🪄 توليد Blueprint الإطلاق
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Blueprint Modal ────────────────────────────────────────────────────────────

function BlueprintModal({
  open, onClose, blueprint, onCopy,
}: {
  open: boolean; onClose: () => void; blueprint: string; onCopy: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    onCopy(blueprint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const isScale = blueprint.includes("SCALING");

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { setCopied(false); } onClose(); }}>
      <DialogContent className="max-w-xl w-[calc(100vw-2rem)] sm:w-full" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isScale
              ? <Rocket className="h-5 w-5 text-emerald-600" />
              : <FlaskConical className="h-5 w-5 text-blue-600" />}
            {isScale ? "🚀 Blueprint التوسع" : "🧪 Blueprint الاختبار"}
          </DialogTitle>
        </DialogHeader>

        <div className={`rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${
          isScale
            ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
            : "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300"
        }`}>
          {isScale
            ? "⚡ وضع التوسع: CBO مع Advantage+ Creative — الـ AI سيطلق الحملة فوراً بعد اللصق"
            : "🧪 وضع الاختبار: ABO مع تعدد الأصول — الـ AI سيطلق الحملة فوراً بعد اللصق"}
        </div>

        <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans bg-muted rounded-xl px-4 py-3 text-foreground max-h-72 overflow-y-auto text-xs">
          {blueprint}
        </pre>

        <Button
          size="lg"
          className={`w-full gap-2 text-base transition-colors ${
            copied
              ? "bg-emerald-600 hover:bg-emerald-700"
              : isScale
                ? "bg-emerald-600 hover:bg-emerald-700"
                : ""
          }`}
          onClick={handleCopy}
        >
          {copied
            ? <>✅ تم النسخ — الصقه في المساعد الآن</>
            : <><Copy className="h-5 w-5" /> 📋 نسخ Blueprint</>}
        </Button>

        <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
          إغلاق
        </Button>
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

// ── Flex Scale sub-component (account → campaign pickers) ─────────────────────

function FlexScaleForm({
  form, upd, onSend,
}: {
  form: QuickForm;
  upd: <K extends keyof QuickForm>(k: K, v: QuickForm[K]) => void;
  onSend: () => void;
}) {
  const { data: accountsData } = useAccounts();
  const accounts = accountsData?.accounts ?? [];

  // 30-day window for campaign discovery
  const now = new Date();
  const since = new Date(now); since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = now.toISOString().slice(0, 10);

  const { data: campaignsData, isFetching: loadingCampaigns } = useQuery({
    queryKey: ["flex-campaigns", form.flexAccountId, sinceStr, untilStr],
    queryFn: () =>
      fetchCampaignsForAccount({
        ad_account_id: form.flexAccountId,
        since: sinceStr,
        until: untilStr,
      }),
    enabled: !!form.flexAccountId,
    staleTime: 5 * 60 * 1000,
  });

  const campaigns = campaignsData?.campaigns ?? [];
  const activeCampaigns = campaigns.filter(c => c.effective_status === "ACTIVE" || c.status === "ACTIVE");
  const allCampaigns = activeCampaigns.length > 0 ? activeCampaigns : campaigns;

  function pickSrc(id: string) {
    const c = allCampaigns.find(x => x.id === id);
    upd("flexSrcId", id);
    upd("flexSrcName", c?.name ?? "");
  }

  const today = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");

  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 p-4 space-y-3 animate-in fade-in duration-150">

      {/* How it works */}
      <div className="rounded-lg bg-violet-100/60 dark:bg-violet-900/20 border border-violet-200/60 dark:border-violet-700/40 p-2.5 text-xs text-violet-800 dark:text-violet-300 leading-relaxed">
        <span className="font-semibold">⚡ كيف يعمل:</span> المساعد يجلب الرابحين من الحملة المصدر ← ينشئ حملة CBO جديدة ← ينقل الإعلانات بـ <span className="font-mono font-medium">flex_mode=true</span> (Meta تختار الفورمات تلقائياً)
      </div>

      {/* Step 1: Account */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white text-[10px] font-bold shrink-0">١</span>
          الحساب الإعلاني
        </label>
        <Select
          value={form.flexAccountId}
          onValueChange={val => {
            upd("flexAccountId", val);
            upd("flexSrcId", ""); upd("flexSrcName", "");
          }}
        >
          <SelectTrigger className="h-9 text-sm" dir="rtl">
            <SelectValue placeholder="اختر الحساب..." />
          </SelectTrigger>
          <SelectContent dir="rtl">
            {accounts.length === 0 && (
              <SelectItem value="__none" disabled>لا توجد حسابات</SelectItem>
            )}
            {accounts.map(acc => (
              <SelectItem key={acc.id} value={acc.id}>
                {acc.name ?? acc.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Step 2: Source campaign — show after account selected */}
      {form.flexAccountId && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white text-[10px] font-bold shrink-0">٢</span>
            الحملة المصدر — المساعد سيجلب رابحيها
          </label>
          <Select
            value={form.flexSrcId}
            onValueChange={pickSrc}
            disabled={loadingCampaigns}
          >
            <SelectTrigger className="h-9 text-sm" dir="rtl">
              {loadingCampaigns
                ? <span className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />جاري تحميل الحملات...</span>
                : <SelectValue placeholder="اختر الحملة المصدر..." />
              }
            </SelectTrigger>
            <SelectContent dir="rtl">
              {allCampaigns.length === 0 && !loadingCampaigns && (
                <SelectItem value="__none" disabled>لا توجد حملات نشطة</SelectItem>
              )}
              {allCampaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="block max-w-[260px] truncate">{c.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Step 3: New campaign details — show after source selected */}
      {form.flexSrcId && (
        <div className="space-y-2.5 rounded-lg border border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 p-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white text-[10px] font-bold shrink-0">٣</span>
            <span className="text-xs font-medium text-violet-800 dark:text-violet-300">إعدادات الحملة CBO الجديدة (ستُنشأ تلقائياً)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1 sm:col-span-1">
              <label className="text-[11px] text-muted-foreground">اسم الحملة الجديدة</label>
              <Input
                dir="rtl"
                placeholder={`Flex Scale - ${today}`}
                value={form.flexNewCampaignName}
                onChange={e => upd("flexNewCampaignName", e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">الميزانية (EGP/يوم)</label>
              <Input
                type="number"
                min={1}
                value={form.flexNewBudget}
                onChange={e => upd("flexNewBudget", e.target.value)}
                className="h-8 text-xs"
                dir="ltr"
              />
            </div>
          </div>
          <div className="text-[10px] text-violet-600 dark:text-violet-400">
            ✓ المساعد سينشئ الحملة بـ Objective: SALES · CBO · Advantage+ Placements
          </div>
        </div>
      )}

      {/* Send */}
      <div className="pt-1 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center border-t border-violet-200 dark:border-violet-800">
        <div className="flex-1 text-xs text-muted-foreground">
          {form.flexSrcName ? <span>المصدر: <span className="font-medium text-foreground">{form.flexSrcName}</span></span> : "اختر الحساب والحملة المصدر للمتابعة"}
        </div>
        <Button
          size="sm"
          className="gap-1.5 h-9 text-xs shrink-0 bg-violet-600 hover:bg-violet-700 text-white"
          onClick={onSend}
          disabled={!form.flexSrcId}
        >
          <Send className="h-3.5 w-3.5" />
          {form.flexStep === 0 ? "١. جيب الرابحين ↗" : form.flexStep === 1 ? "٢. أنشئ الحملة ↗" : form.flexStep === 2 ? "٣. أنشئ الـ AdSet ↗" : "٤. انشر الرابحين ↗"}
        </Button>
      </div>
    </div>
  );
}

// ── Quick Launch Section ───────────────────────────────────────────────────────

type QuickCardType = "TEST" | "SCALE" | "FLEX" | "RETARGETING" | "COSTCAP" | "LOOKALIKE" | "INTERESTS";

interface Angle {
  name: string;
  landing: string;
  texts: [string, string];
  headlines: [string, string];
  generating?: boolean;
}
interface QuickForm {
  product: string; budget: string;
  landingPage: string; driveLink: string;
  texts: string[]; headlines: string[];
  selText: number; selHeadline: number;
  textCount: number; headlineCount: number;
  angles: Angle[];
  flexAccountId: string;
  flexSrcId: string; flexSrcName: string;
  flexNewCampaignName: string; flexNewBudget: string;
  flexStep: number; flexCampaignId: string; flexAdsetId: string;
}
const INIT_ANGLE: Angle = { name: "", landing: "", texts: ["", ""], headlines: ["", ""] };
const INIT_FORM: QuickForm = {
  product: "", budget: "180", landingPage: "", driveLink: "",
  texts: [], headlines: [], selText: 0, selHeadline: 0,
  textCount: 3, headlineCount: 4,
  angles: [{ ...INIT_ANGLE }],
  flexAccountId: "",
  flexSrcId: "", flexSrcName: "",
  flexNewCampaignName: "", flexNewBudget: "200",
  flexStep: 0, flexCampaignId: "", flexAdsetId: "",
};

function QuickLaunchSection() {
  const [, navigate] = useLocation();
  const { toast }    = useToast();
  const [activeCard, setActiveCard] = useState<QuickCardType | null>(null);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState<QuickForm>(INIT_FORM);

  function toggleCard(card: QuickCardType) {
    setActiveCard(prev => {
      if (prev === card) return null;
      setForm(INIT_FORM);
      return card;
    });
  }

  function upd<K extends keyof QuickForm>(k: K, v: QuickForm[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function generateTexts() {
    if (!form.landingPage.trim()) {
      toast({ title: "أضف رابط صفحة الهبوط أولاً", variant: "destructive" }); return;
    }
    setGenerating(true);
    try {
      const r = await fetch(`${API}/library/quick-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productName:   form.product.trim() || "منتج",
          landingPageUrl: form.landingPage.trim(),
          textCount:     form.textCount,
          headlineCount: form.headlineCount,
        }),
      });
      const d = await r.json() as { texts?: {content:string}[]; headlines?: {content:string}[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? "خطأ");
      const texts     = (d.texts     ?? []).map(t => t.content).filter(Boolean);
      const headlines = (d.headlines ?? []).map(h => h.content).filter(Boolean);
      setForm(prev => ({ ...prev, texts, headlines, selText: 0, selHeadline: 0 }));
      toast({ title: "✅ تم التوليد!", description: `${texts.length} نصوص · ${headlines.length} عناوين` });
    } catch (err) {
      toast({ title: "خطأ في التوليد", description: String(err), variant: "destructive" });
    } finally { setGenerating(false); }
  }

  async function generateAngles() {
    const angles = form.angles;
    if (angles.every(a => !a.landing.trim())) {
      toast({ title: "أضف رابط صفحة الهبوط لكل زاوية أولاً", variant: "destructive" }); return;
    }
    setGenerating(true);
    try {
      const updated = await Promise.all(angles.map(async (angle, idx) => {
        if (!angle.landing.trim()) return angle;
        try {
          const r = await fetch(`${API}/library/quick-generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              productName: form.product.trim() || "منتج",
              landingPageUrl: angle.landing.trim(),
              textCount: 2,
              headlineCount: 2,
              angleName: angle.name.trim() || `زاوية ${idx + 1}`,
            }),
          });
          const d = await r.json() as { texts?: {content:string}[]; headlines?: {content:string}[]; error?: string };
          if (!r.ok) throw new Error(d.error ?? "خطأ");
          const texts = (d.texts ?? []).map(t => t.content).filter(Boolean);
          const headlines = (d.headlines ?? []).map(h => h.content).filter(Boolean);
          return {
            ...angle,
            texts: [texts[0] ?? "", texts[1] ?? ""] as [string, string],
            headlines: [headlines[0] ?? "", headlines[1] ?? ""] as [string, string],
          };
        } catch { return angle; }
      }));
      upd("angles", updated);
      toast({ title: "✅ تم توليد النصوص!", description: `${updated.length} زوايا` });
    } catch (err) {
      toast({ title: "خطأ في التوليد", description: String(err), variant: "destructive" });
    } finally { setGenerating(false); }
  }

  function addUtm(url: string, campaignName: string, angleName: string): string {
    if (!url || url === "—") return url;
    try {
      const u = new URL(url);
      u.searchParams.set("utm_source", "facebook");
      u.searchParams.set("utm_medium", "paid");
      u.searchParams.set("utm_campaign", campaignName.replace(/\s+/g, "-"));
      if (angleName) u.searchParams.set("utm_content", angleName.replace(/\s+/g, "-"));
      return u.toString();
    } catch { return url; }
  }

  function buildBlueprintCmd(type: "TEST" | "SCALE") {
    const today = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
    const prod  = form.product.trim() || "منتج";
    const drive = form.driveLink.trim() || "—";
    const campName = type === "TEST" ? `${prod} - TEST - ${today}` : `${prod} - SCALE - ${today}`;

    // Build angles section
    const anglesSection = form.angles.map((a, i) => {
      const lp = addUtm(a.landing.trim() || "—", campName, a.name.trim() || `angle${i+1}`);
      return `## زاوية ${i+1}${a.name ? ` — ${a.name}` : ""}
- AdSet Name: ${a.name.trim() || `angle${i+1}`}
- Video: ${a.name.trim() || `angle${i+1}`} (ابحث في Drive عن ملف باسم "${a.name.trim() || `angle${i+1}`}")
- Destination URL: ${lp}
- Primary Texts:
  1. ${a.texts[0] || "[نص 1]"}
  2. ${a.texts[1] || "[نص 2]"}
- Headlines:
  1. ${a.headlines[0] || "[عنوان 1]"}
  2. ${a.headlines[1] || "[عنوان 2]"}`;
    }).join("\n\n");

    if (type === "TEST") return `[SYSTEM COMMAND: EXECUTE_CAMPAIGN_BLUEPRINT]
قم ببناء حملة (TESTING) فوراً — أنشئ AdSet وإعلان منفصل لكل زاوية:
# 1. Campaign Settings
- Objective: SALES (Conversions) · Event: PURCHASE
- Campaign Name: ${campName}
- Budget Optimization: ABO (Adset Level Budget)
- Media Drive Folder: ${drive}
# 2. الزوايا الإعلانية (كل زاوية = AdSet + إعلان منفصل)
${anglesSection}
# 3. إعدادات عامة
- Targeting: Advantage+ Audience (Broad) — مصر فقط
- Placements: Advantage+ Placements
- Enable: Advantage+ Creative Enhancements (MUST BE TRUE)
[END_COMMAND]`;

    return `[SYSTEM COMMAND: EXECUTE_CAMPAIGN_BLUEPRINT]
قم ببناء حملة (SCALING) فوراً — أنشئ AdSet وإعلان منفصل لكل زاوية:
# 1. Campaign Settings
- Objective: SALES (Conversions) · Event: PURCHASE
- Campaign Name: ${campName}
- Budget Optimization: CBO (Campaign Budget Optimization)
- Campaign Budget: ${form.budget} EGP daily
- Media Drive Folder: ${drive}
# 2. الزوايا الإعلانية (كل زاوية = AdSet + إعلان منفصل)
${anglesSection}
# 3. إعدادات عامة
- Targeting: Advantage+ Audience (Broad) — مصر فقط
- Placements: Advantage+ Placements
- Enable: Advantage+ Creative Enhancements (MUST BE TRUE)
[END_COMMAND]`;
  }

  function buildStrategyCmd(type: "RETARGETING" | "COSTCAP" | "LOOKALIKE" | "INTERESTS") {
    const today = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
    const prod  = form.product.trim() || "منتج";
    const today3 = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
    const campNameStrategy = `${prod} - ${type} - ${today3}`;
    const lp    = addUtm(form.landingPage.trim() || "—", campNameStrategy, "");
    const drive = form.driveLink.trim() || "—";
    const allTexts     = form.texts.length     ? form.texts.map((t,i) => `  ${i+1}. ${t}`).join("\n") : "  [النص الإعلاني]";
    const allHeadlines = form.headlines.length ? form.headlines.map((h,i) => `  ${i+1}. ${h}`).join("\n") : "  [العنوان]";
    // Angles with UTM
    const anglesCmd = form.angles.length > 0 && form.angles[0].landing
      ? form.angles.map((a, i) => `
## زاوية ${i+1}${a.name ? ` — ${a.name}` : ""}
- AdSet Name: ${a.name || `angle${i+1}`}
- Destination URL: ${addUtm(a.landing, campNameStrategy, a.name || `angle${i+1}`)}
- Video: ${a.name || `angle${i+1}`} (ابحث في Drive عن ملف باسم "${a.name || `angle${i+1}`}")
- Primary Texts:
  1. ${a.texts[0] || "[نص 1]"}
  2. ${a.texts[1] || "[نص 2]"}
- Headlines:
  1. ${a.headlines[0] || "[عنوان 1]"}
  2. ${a.headlines[1] || "[عنوان 2]"}`).join("\n")
      : "";

    if (type === "COSTCAP") return `[SYSTEM COMMAND: EXECUTE_CAMPAIGN_BLUEPRINT]
قم ببناء حملة Cost Cap فوراً:
# 1. Campaign Settings
- Objective: OUTCOME_SALES · Event: PURCHASE
- Campaign Name: ${prod} - Cost Cap - ${today}
- Budget Optimization: CBO
- Campaign Budget: ${form.budget} EGP daily
- Bid Strategy: COST_CAP
- Bid Amount (CPA المستهدف): ${form.budget} EGP
# 2. AdSet Settings
- Targeting: Advantage+ Audience (Broad) — مصر فقط residents
- Placements: Advantage+ Placements
# 3. Ad Settings
- Media URL: ${drive}
- Destination URL: ${lp}
- Primary Texts:
${allTexts}
- Headlines:
${allHeadlines}
- Enable: Advantage+ Creative Enhancements
[END_COMMAND]`;

    if (type === "RETARGETING") return `[SYSTEM COMMAND: EXECUTE_CAMPAIGN_BLUEPRINT]
قم ببناء حملة Retargeting فوراً:
# 1. Campaign Settings
- Objective: OUTCOME_SALES · Event: PURCHASE
- Campaign Name: ${prod} - Retargeting - ${today}
- Budget Optimization: ABO
# 2. AdSet Settings
- Budget: ${form.budget} EGP daily
- Targeting:
  INCLUDE: زوار صفحة المنتج آخر 30 يوم (ViewContent على ${lp})
  EXCLUDE: المشترين آخر 30 يوم (Purchase event)
- Placements: Advantage+ Placements
# 3. Ad Settings
- Media URL: ${drive}
- Destination URL: ${lp}
- Primary Texts:
${allTexts}
- Headlines:
${allHeadlines}
- Enable: Advantage+ Creative Enhancements
[END_COMMAND]`;

    if (type === "LOOKALIKE") return `[SYSTEM COMMAND: EXECUTE_CAMPAIGN_BLUEPRINT]
قم ببناء حملة Lookalike فوراً:
# 1. Campaign Settings
- Objective: OUTCOME_SALES · Event: PURCHASE
- Campaign Name: ${prod} - Lookalike - ${today}
- Budget Optimization: CBO
- Campaign Budget: ${form.budget} EGP daily
# 2. AdSet Settings
- Targeting:
  Lookalike Audience 1-3% من المشترين (Purchase events من البيكسل)
  EXCLUDE: المشترين آخر 30 يوم
  الدولة: مصر فقط
- Placements: Advantage+ Placements
# 3. Ad Settings
- Media URL: ${drive}
- Destination URL: ${lp}
- Primary Texts:
${allTexts}
- Headlines:
${allHeadlines}
- Enable: Advantage+ Creative Enhancements
[END_COMMAND]`;

    return `[SYSTEM COMMAND: EXECUTE_CAMPAIGN_BLUEPRINT]
قم ببناء حملة Interests مع Advantage+ فوراً بالخطوات:
الخطوة 1: استخدم search_interests للبحث عن اهتمامات لمنتج "${prod}" — جيب أفضل 5 نتائج مع IDs
الخطوة 2: أنشئ الحملة بالإعدادات:
# Campaign Settings
- Budget Optimization: ABO
# 2. AdSet Settings
- Budget: ${form.budget} EGP daily
- Targeting:
  Advantage+ Audience مفعّل
- Targeting: ضع الـ Interest IDs من الخطوة 1 في flexible_spec داخل targeting
  الدولة: مصر فقط
- Placements: Advantage+ Placements
# 3. Ad Settings
- Media URL: ${drive}
- Destination URL: ${lp}
- Primary Texts:
${allTexts}
- Headlines:
${allHeadlines}
- Enable: Advantage+ Creative Enhancements
الخطوة 3: بعد الإنشاء، استخدم update_adset لتحديث targeting بالـ Interest IDs
[END_COMMAND]`;
  }

  function buildFlexCmd() {
    const srcLabel  = form.flexSrcName ? `"${form.flexSrcName}" (${form.flexSrcId})` : "[الحملة المصدر]";
    const today     = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
    const newName   = form.flexNewCampaignName.trim() || `Flex Scale - ${today}`;
    const newBudget = form.flexNewBudget.trim() || "200";
    if (form.flexStep === 0) return `جيب الـ adsets من الحملة ${srcLabel} وحدد الرابحين خلال آخر 7 أيام. اعرض النتائج فقط.`;
    if (form.flexStep === 1) return `استدعِ create_campaign: الاسم ${newName} - daily_budget ${newBudget} - objective OUTCOME_SALES - status PAUSED. لا تفعل أي شيء آخر.`;
    if (form.flexStep === 2) return `استدعِ create_adset tool call مباشر في حملة ${form.flexCampaignId}: الاسم Flex Adset - بدون budget - targeting مصر residents. لا تفعل أي شيء آخر.`;
    if (form.flexStep === 3) return `استدعِ publish_winners_to_destination: destination_adset_id ${form.flexAdsetId} - source_ad_ids الـ winners - flex_mode true. ليس bulk_action.`;
    return "";
  }
  async function sendToChat(cmd: string, type: "TEST" | "SCALE" | "FLEX") {
    try {
      sessionStorage.setItem("quick_chat_command", cmd);
      if (type === "FLEX") {
        const today = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
        sessionStorage.setItem("flex_state", JSON.stringify({
          step: form.flexStep + 1,
          campaignId: form.flexCampaignId,
          adsetId: form.flexAdsetId,
          srcId: form.flexSrcId,
          newName: form.flexNewCampaignName.trim() || `Flex Scale - ${today}`,
          budget: form.flexNewBudget.trim() || "200",
        }));
      } else {
        sessionStorage.removeItem("flex_state");
      }
    } catch { /* ignore */ }
    // Save to launch history
    try {
      await fetch(`${API}/library/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          product_name: form.product.trim() || "منتج",
          angle_name: `Quick Launch — ${type === "TEST" ? "Blueprint TESTING" : type === "SCALE" ? "Blueprint SCALING" : "Flex Scale"}`,
          generated_prompt: cmd,
        }),
      });
    } catch { /* ignore — non-critical */ }
    navigate("/chat");
  }

  const CARDS: { id: QuickCardType; emoji: string; label: string; hint: string; color: string }[] = [
    { id: "TEST",        emoji: "🧪", label: "Testing",             hint: "ABO · إعلان منفصل لكل نص",          color: "blue"    },
    { id: "SCALE",       emoji: "🚀", label: "Scaling",             hint: "CBO · توسع بـ Advantage+",           color: "emerald" },
    { id: "FLEX",        emoji: "⚡", label: "Flex Scale",          hint: "نقل الرابحين بـ Advantage+",         color: "violet"  },
    { id: "COSTCAP",     emoji: "💰", label: "Cost Cap",            hint: "CPA مستهدف · تحكم في التكلفة",      color: "yellow"  },
    { id: "RETARGETING", emoji: "🎯", label: "Retargeting",         hint: "زوار المنتج غير المشترين",           color: "orange"  },
    { id: "LOOKALIKE",   emoji: "👥", label: "Lookalike",           hint: "جمهور مشابه للمشترين",               color: "pink"    },
    { id: "INTERESTS",   emoji: "✨", label: "Interests Advantage+", hint: "اهتمامات مع Advantage+",            color: "teal"    },
  ];

  const colorMap: Record<string,{border:string;bg:string;activeBorder:string;activeBg:string;badge:string;btn:string}> = {
    blue:    { border:"border-blue-200 dark:border-blue-800",       bg:"bg-blue-50/50 dark:bg-blue-950/20",       activeBorder:"border-blue-500",    activeBg:"bg-blue-50 dark:bg-blue-950/30",    badge:"bg-blue-500",    btn:"bg-blue-600 hover:bg-blue-700 text-white" },
    emerald: { border:"border-emerald-200 dark:border-emerald-800", bg:"bg-emerald-50/50 dark:bg-emerald-950/20", activeBorder:"border-emerald-500", activeBg:"bg-emerald-50 dark:bg-emerald-950/30", badge:"bg-emerald-500", btn:"bg-emerald-600 hover:bg-emerald-700 text-white" },
    violet:  { border:"border-violet-200 dark:border-violet-800",   bg:"bg-violet-50/50 dark:bg-violet-950/20",   activeBorder:"border-violet-500",  activeBg:"bg-violet-50 dark:bg-violet-950/30",  badge:"bg-violet-500",  btn:"bg-violet-600 hover:bg-violet-700 text-white" },
    yellow:  { border:"border-yellow-200 dark:border-yellow-800",   bg:"bg-yellow-50/50 dark:bg-yellow-950/20",   activeBorder:"border-yellow-500",  activeBg:"bg-yellow-50 dark:bg-yellow-950/30",  badge:"bg-yellow-500",  btn:"bg-yellow-600 hover:bg-yellow-700 text-white" },
    orange:  { border:"border-orange-200 dark:border-orange-800",   bg:"bg-orange-50/50 dark:bg-orange-950/20",   activeBorder:"border-orange-500",  activeBg:"bg-orange-50 dark:bg-orange-950/30",  badge:"bg-orange-500",  btn:"bg-orange-600 hover:bg-orange-700 text-white" },
    pink:    { border:"border-pink-200 dark:border-pink-800",       bg:"bg-pink-50/50 dark:bg-pink-950/20",       activeBorder:"border-pink-500",    activeBg:"bg-pink-50 dark:bg-pink-950/30",    badge:"bg-pink-500",    btn:"bg-pink-600 hover:bg-pink-700 text-white" },
    teal:    { border:"border-teal-200 dark:border-teal-800",       bg:"bg-teal-50/50 dark:bg-teal-950/20",       activeBorder:"border-teal-500",    activeBg:"bg-teal-50 dark:bg-teal-950/30",    badge:"bg-teal-500",    btn:"bg-teal-600 hover:bg-teal-700 text-white" },
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">الإطلاق السريع — Quick Launch</span>
        <span className="text-[11px] text-muted-foreground mr-auto">اختر استراتيجية ← عبّي الحقول ← أرسل للمساعد</span>
      </div>

      {/* Card buttons row */}
      <div className="grid grid-cols-3 gap-2">
        {CARDS.map(c => {
          const cl = colorMap[c.color]!;
          const isActive = activeCard === c.id;
          return (
            <button
              key={c.id}
              onClick={() => toggleCard(c.id)}
              className={`rounded-xl border-2 p-3 text-right transition-all ${
                isActive ? `${cl.activeBorder} ${cl.activeBg}` : `${cl.border} ${cl.bg} hover:${cl.activeBorder}`
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-base">{c.emoji}</span>
                {isActive && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cl.badge} text-white font-medium`}>مفتوح</span>}
              </div>
              <div className="font-semibold text-xs text-foreground leading-tight">{c.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{c.hint}</div>
            </button>
          );
        })}
      </div>

      {/* ── Blueprint TEST / SCALE form ── */}
      {(activeCard === "TEST" || activeCard === "SCALE" || activeCard === "COSTCAP" || activeCard === "RETARGETING" || activeCard === "LOOKALIKE" || activeCard === "INTERESTS") && (
        <div className="rounded-xl border border-border bg-background p-4 space-y-3 animate-in fade-in duration-150">
          {/* Row 1: Product + Budget */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">اسم المنتج</label>
              <Input
                placeholder="مثال: كريم الشعر X"
                value={form.product}
                onChange={e => upd("product", e.target.value)}
                className="h-9 text-sm"
                dir="rtl"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">الميزانية (EGP/يوم)</label>
              <Input
                type="number"
                min={1}
                value={form.budget}
                onChange={e => upd("budget", e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          {/* Row 2: Landing Page + Drive — for TEST/SCALE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <FolderOpen className="h-3 w-3" /> رابط الميديا (Drive)
              </label>
              <Input
                placeholder="https://drive.google.com/..."
                value={form.driveLink}
                onChange={e => upd("driveLink", e.target.value)}
                className="h-9 text-sm font-mono text-xs"
                dir="ltr"
              />
            </div>
          </div>

          {/* Angles Section */}
          {(
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <FolderOpen className="h-3 w-3" /> رابط مجلد الميديا (Drive)
              </label>
            </div>
            <Input
              placeholder="https://drive.google.com/drive/folders/..."
              value={form.driveLink}
              onChange={e => upd("driveLink", e.target.value)}
              className="h-9 text-sm font-mono text-xs"
              dir="ltr"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs font-medium text-muted-foreground">الزوايا الإعلانية</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={generateAngles} disabled={generating}
                  className="text-xs text-violet-600 hover:underline flex items-center gap-1 disabled:opacity-50">
                  {generating ? "جاري التوليد..." : "✨ توليد النصوص"}
                </button>
                <button type="button" onClick={() => upd("angles", [...form.angles, { ...INIT_ANGLE }])}
                  className="text-xs text-primary hover:underline flex items-center gap-1">
                  + إضافة زاوية
                </button>
              </div>
            </div>
            {form.angles.map((angle, idx) => (
              <div key={idx} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">زاوية {idx + 1}</span>
                  {form.angles.length > 1 && (
                    <button type="button" onClick={() => upd("angles", form.angles.filter((_, i) => i !== idx))}
                      className="text-xs text-destructive hover:underline">حذف</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="اسم الزاوية (= اسم الفيديو في Drive)"
                    value={angle.name}
                    onChange={e => { const a = [...form.angles]; a[idx] = {...a[idx], name: e.target.value}; upd("angles", a); }}
                    className="h-8 text-xs" dir="rtl" />
                  <Input placeholder="https://buzzpick.net/product"
                    value={angle.landing}
                    onChange={e => { const a = [...form.angles]; a[idx] = {...a[idx], landing: e.target.value}; upd("angles", a); }}
                    className="h-8 text-xs font-mono" dir="ltr" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <textarea placeholder="نص 1" value={angle.texts[0]}
                    onChange={e => { const a = [...form.angles]; a[idx] = {...a[idx], texts: [e.target.value, a[idx].texts[1]]}; upd("angles", a); }}
                    className="h-16 text-xs rounded-md border border-border bg-background p-2 resize-none" dir="rtl" />
                  <textarea placeholder="نص 2" value={angle.texts[1]}
                    onChange={e => { const a = [...form.angles]; a[idx] = {...a[idx], texts: [a[idx].texts[0], e.target.value]}; upd("angles", a); }}
                    className="h-16 text-xs rounded-md border border-border bg-background p-2 resize-none" dir="rtl" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="عنوان 1" value={angle.headlines[0]}
                    onChange={e => { const a = [...form.angles]; a[idx] = {...a[idx], headlines: [e.target.value, a[idx].headlines[1]]}; upd("angles", a); }}
                    className="h-8 text-xs" dir="rtl" />
                  <Input placeholder="عنوان 2" value={angle.headlines[1]}
                    onChange={e => { const a = [...form.angles]; a[idx] = {...a[idx], headlines: [a[idx].headlines[0], e.target.value]}; upd("angles", a); }}
                    className="h-8 text-xs" dir="rtl" />
                </div>
              </div>
            ))}
          </div>
          )}

          {/* AI Generate row with quantity controls */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2.5">
            {/* Quantity row */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground shrink-0">الكمية:</span>
              {/* Text count */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">نصوص</span>
                <div className="flex items-center gap-0">
                  <button
                    type="button"
                    onClick={() => upd("textCount", Math.max(1, form.textCount - 1))}
                    className="h-6 w-6 rounded-r-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted text-xs font-bold transition-colors"
                  >−</button>
                  <span className="h-6 w-7 border-y border-border bg-background text-xs text-center leading-6 font-semibold">{form.textCount}</span>
                  <button
                    type="button"
                    onClick={() => upd("textCount", Math.min(8, form.textCount + 1))}
                    className="h-6 w-6 rounded-l-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted text-xs font-bold transition-colors"
                  >+</button>
                </div>
              </div>
              {/* Headline count */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">عناوين</span>
                <div className="flex items-center gap-0">
                  <button
                    type="button"
                    onClick={() => upd("headlineCount", Math.max(1, form.headlineCount - 1))}
                    className="h-6 w-6 rounded-r-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted text-xs font-bold transition-colors"
                  >−</button>
                  <span className="h-6 w-7 border-y border-border bg-background text-xs text-center leading-6 font-semibold">{form.headlineCount}</span>
                  <button
                    type="button"
                    onClick={() => upd("headlineCount", Math.min(8, form.headlineCount + 1))}
                    className="h-6 w-6 rounded-l-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted text-xs font-bold transition-colors"
                  >+</button>
                </div>
              </div>
              {form.texts.length > 0 && (
                <span className="text-xs text-emerald-600 font-medium mr-auto">✓ {form.texts.length} نصوص · {form.headlines.length} عناوين</span>
              )}
            </div>
            {/* Generate button */}
            <Button
              size="sm"
              variant={form.landingPage.trim() ? "default" : "outline"}
              className="gap-1.5 h-8 text-xs w-full sm:w-auto"
              onClick={generateTexts}
              disabled={generating}
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? `جاري توليد ${form.textCount} نصوص + ${form.headlineCount} عناوين...` : `✨ توليد ${form.textCount} نصوص + ${form.headlineCount} عناوين بالـ AI`}
            </Button>
          </div>

          {/* Texts — all included, numbered list */}
          {form.texts.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" />
                النصوص المولّدة
                <span className="mr-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-medium">
                  كلها ستُدرج في الأمر
                </span>
              </label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {form.texts.map((t, i) => (
                  <div
                    key={i}
                    className="w-full text-right text-xs rounded-lg border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-950/10 p-2.5 leading-relaxed"
                  >
                    <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-500 text-white text-[9px] font-bold ml-1.5 shrink-0 align-middle">{i + 1}</span>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          )}
          {form.texts.length === 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" /> النص الإعلاني (أو ولّد بالـ AI أعلاه)
              </label>
              <Textarea
                dir="rtl"
                placeholder="اكتب النص الإعلاني هنا..."
                value={form.texts[0] ?? ""}
                onChange={e => upd("texts", [e.target.value])}
                rows={3}
                className="text-sm resize-none"
              />
            </div>
          )}

          {/* Headlines — all included as pills */}
          {form.headlines.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Heading1 className="h-3 w-3" />
                العناوين المولّدة
                <span className="mr-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-medium">
                  كلها ستُدرج
                </span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {form.headlines.map((h, i) => (
                  <div
                    key={i}
                    className="text-xs rounded-full px-2.5 py-1 border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/10 text-emerald-800 dark:text-emerald-300 font-medium flex items-center gap-1"
                  >
                    <span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold shrink-0">{i + 1}</span>
                    {h}
                  </div>
                ))}
              </div>
            </div>
          )}
          {form.headlines.length === 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Heading1 className="h-3 w-3" /> العنوان
              </label>
              <Input
                dir="rtl"
                placeholder="عنوان الإعلان (5-7 كلمات)"
                value={form.headlines[0] ?? ""}
                onChange={e => upd("headlines", [e.target.value])}
                className="h-9 text-sm"
              />
            </div>
          )}

          {/* Send button */}
          <div className="pt-1 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center border-t border-border/60">
            <div className="flex-1 min-w-0 text-xs text-muted-foreground">
              {activeCard === "TEST"
                ? `🧪 ${form.texts.length > 0 ? `${form.texts.length} نصوص × ${form.headlines.length} عناوين → إعلانات متعددة` : "سيُبنى أمر Blueprint TESTING"}`
                : `🚀 ${form.texts.length > 0 ? `${form.texts.length} نصوص + ${form.headlines.length} عناوين → SCALE بـ Advantage+` : "سيُبنى أمر Blueprint SCALING"}`}
            </div>
            <Button
              size="sm"
              className="gap-1.5 h-9 text-xs shrink-0 bg-primary hover:bg-primary/90"
              onClick={() => {
                if (activeCard === "TEST" || activeCard === "SCALE") {
                  sendToChat(buildBlueprintCmd(activeCard as "TEST" | "SCALE"), activeCard);
                } else if (activeCard === "COSTCAP" || activeCard === "RETARGETING" || activeCard === "LOOKALIKE" || activeCard === "INTERESTS") {
                  sendToChat(buildStrategyCmd(activeCard as "COSTCAP" | "RETARGETING" | "LOOKALIKE" | "INTERESTS"), activeCard);
                }
              }}
            >
              <Send className="h-3.5 w-3.5" />
              إرسال للمساعد ↗
            </Button>
          </div>
        </div>
      )}

      {/* ── Flex Scale form ── */}
      {activeCard === "FLEX" && (
        <FlexScaleForm form={form} upd={upd} onSend={() => { sendToChat(buildFlexCmd(), "FLEX"); upd("flexStep", (form.flexStep + 1) as QuickForm["flexStep"]); }} />
      )}

    </div>
  );
}

export default function AssetLibrary() {
  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <QuickLaunchSection />
      </div>
    </div>
  );
}
