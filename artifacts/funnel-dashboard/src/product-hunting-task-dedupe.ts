function dedupeProductHuntingTaskButtons() {
  if (window.location.pathname !== "/product-hunting") return;

  const canonicalButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[data-convert-to-task="1"]'),
  );

  for (const canonical of canonicalButtons) {
    const row = canonical.parentElement;
    if (!row) continue;

    const siblings = Array.from(row.querySelectorAll<HTMLButtonElement>("button"));
    for (const button of siblings) {
      if (button === canonical) continue;
      if (button.dataset.convertToTask === "1") {
        button.remove();
        continue;
      }
      if (button.className.includes("emerald")) button.remove();
    }
  }
}

if (typeof window !== "undefined") {
  const run = () => window.requestAnimationFrame(dedupeProductHuntingTaskButtons);
  run();
  const observer = new MutationObserver(run);
  observer.observe(document.body, { childList: true, subtree: true });
}
