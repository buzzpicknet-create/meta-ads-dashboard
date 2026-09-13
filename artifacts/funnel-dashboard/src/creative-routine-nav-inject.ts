export function installCreativeRoutineNav() {
  const addCreativeRoutineNav = () => {
    const desktopNav = document.querySelector("nav .hidden.sm\\:flex.items-center.gap-1.overflow-x-auto");
    if (desktopNav && !desktopNav.querySelector('[data-creative-routine-nav="desktop"]')) {
      const link = document.createElement("a");
      link.href = "/creative-routine-preview";
      link.dataset.creativeRoutineNav = "desktop";
      link.className = "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground";
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "🎬";
      const label = document.createElement("span");
      label.textContent = "روتين الكريتف";
      link.append(icon, label);
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
      const icon = document.createElement("span");
      icon.className = "text-lg leading-none";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "🎬";
      const label = document.createElement("span");
      label.className = "text-[10px] font-medium leading-tight text-center";
      label.textContent = "روتين الكريتف";
      link.append(icon, label);
      mobileRow.appendChild(link);
    }
  };

  addCreativeRoutineNav();
  const navObserver = new MutationObserver(addCreativeRoutineNav);
  navObserver.observe(document.body, { childList: true, subtree: true });
  return () => navObserver.disconnect();
}
