import { createRoot, type Root } from "react-dom/client";
import ProductHuntingTaskModal, { type HuntingTaskProduct } from "./components/ProductHuntingTaskModal";

let modalRoot: Root | null = null;
let cachedItems: HuntingTaskProduct[] = [];
let cacheAt = 0;
let injecting = false;

async function loadItems(force = false) {
  if (!force && cachedItems.length && Date.now() - cacheAt < 5000) return cachedItems;
  const r = await fetch("/api/product-hunting", { credentials: "include" });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "تعذر تحميل منتجات Product Hunting");
  cachedItems = Array.isArray(data.items) ? data.items : [];
  cacheAt = Date.now();
  return cachedItems;
}

function ensureModalHost() {
  let host = document.getElementById("product-hunting-task-modal-root");
  if (!host) {
    host = document.createElement("div");
    host.id = "product-hunting-task-modal-root";
    document.body.appendChild(host);
  }
  if (!modalRoot) modalRoot = createRoot(host);
  return modalRoot;
}

function toast(text: string) {
  const node = document.createElement("div");
  node.textContent = text;
  node.dir = "rtl";
  node.className = "fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[220] rounded-xl bg-foreground text-background px-4 py-2.5 text-sm shadow-xl max-w-[92vw] text-center";
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 4500);
}

function closeModal() {
  modalRoot?.render(<></>);
}

function openModal(product: HuntingTaskProduct) {
  const root = ensureModalHost();
  root.render(
    <ProductHuntingTaskModal
      product={product}
      onClose={closeModal}
      onDone={(message) => {
        closeModal();
        toast(message);
      }}
    />
  );
}

function normalizeHref(value: string) {
  try {
    const u = new URL(value, window.location.origin);
    return u.href.replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

async function injectButtons() {
  if (window.location.pathname !== "/product-hunting" || injecting) return;
  injecting = true;
  try {
    const articles = Array.from(document.querySelectorAll("main article")) as HTMLElement[];
    if (!articles.length) return;
    const items = await loadItems();

    for (const article of articles) {
      if (article.querySelector('[data-convert-to-task="1"]')) continue;
      const sourceLink = article.querySelector('a[title="فتح المصدر"]') as HTMLAnchorElement | null;
      if (!sourceLink) continue;

      const href = normalizeHref(sourceLink.href);
      const product = items.find((item) => normalizeHref(item.source_url) === href);
      if (!product) continue;

      const actionRow = sourceLink.parentElement;
      if (!actionRow) continue;

      const button = document.createElement("button");
      button.type = "button";
      button.dataset.convertToTask = "1";
      button.className = "h-9 px-3 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300 inline-flex items-center justify-center gap-1.5 text-sm font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors whitespace-nowrap";
      button.innerHTML = '<span aria-hidden="true">✓</span><span>تحويل لمهمة</span>';
      button.title = "تحويل المنتج لمهمة في المهام اليومية";
      button.addEventListener("click", () => openModal(product));
      actionRow.insertBefore(button, actionRow.firstChild);
    }
  } catch (error) {
    console.error("product hunting task bridge", error);
  } finally {
    injecting = false;
  }
}

if (typeof window !== "undefined") {
  const start = () => {
    if (window.location.pathname !== "/product-hunting") return;
    injectButtons();
    const observer = new MutationObserver(() => injectButtons());
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
