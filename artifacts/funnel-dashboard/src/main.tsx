import { createRoot } from "react-dom/client";
import App from "./App";
import CreativeRoutinePreview from "./pages/CreativeRoutinePreview";
import "./index.css";
import "./header-fix.css";

// Configure API base URL
const w = window as unknown as { __API_URL__: string };
w.__API_URL__ = "";

import { setBaseUrl } from "@workspace/api-client-react";
setBaseUrl(w.__API_URL__);

const isCreativeRoutinePreview = window.location.pathname === "/creative-routine-preview";

createRoot(document.getElementById("root")!).render(
  isCreativeRoutinePreview ? <CreativeRoutinePreview /> : <App />,
);

// Keep the creative routine visible inside the existing dashboard navigation.
// This is injected here so it is available immediately without disturbing the
// current App.tsx navigation structure or page-visibility logic.
if (!isCreativeRoutinePreview) {
  const addCreativeRoutineNav = () => {
    const desktopNav = document.querySelector("nav .hidden.sm\\:flex.items-center.gap-1.overflow-x-auto");
    if (desktopNav && !desktopNav.querySelector('[data-creative-routine-nav="desktop"]')) {
      const link = document.createElement("a");
      link.href = "/creative-routine-preview";
      link.dataset.creativeRoutineNav = "desktop";
      link.className = "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground";
      link.innerHTML = '<span aria-hidden="true">🎬</span><span>روتين الكريتف</span>';
      desktopNav.appendChild(link);
    }

    const mobileNavs = Array.from(document.querySelectorAll("nav.sm\\:hidden"));
    const mobileNav = mobileNavs.find((nav) => nav.className.includes("fixed bottom-0"));
    const mobileRow = mobileNav?.querySelector("div.flex.items-center.h-16.px-1.min-w-max");
    if (mobileRow && !mobileRow.querySelector('[data-creative-routine-nav="mobile"]')) {
      const link = document.createElement("a");
      link.href = "/creative-routine-preview";
      link.dataset.creativeRoutineNav = "mobile";
      link.className = "flex flex-col items-center justify-center gap-0.5 w-20 h-full rounded-xl transition-colors text-muted-foreground";
      link.innerHTML = '<span class="text-lg leading-none" aria-hidden="true">🎬</span><span class="text-[10px] font-medium leading-tight text-center">روتين الكريتف</span>';
      mobileRow.appendChild(link);
    }
  };

  addCreativeRoutineNav();
  const navObserver = new MutationObserver(addCreativeRoutineNav);
  navObserver.observe(document.body, { childList: true, subtree: true });
}
