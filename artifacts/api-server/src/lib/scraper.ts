import * as cheerio from "cheerio";

export interface ScrapeResult {
  url: string;
  title: string;
  text: string;
  ok: boolean;
  error?: string;
}

const TIMEOUT_MS = 12_000;
const MAX_CHARS   = 2_000;

const JUNK_SELECTORS = [
  "script", "style", "noscript", "iframe", "svg",
  "nav", "header", "footer", "aside",
  "[aria-hidden='true']", ".nav", ".menu", ".footer", ".header",
  ".cookie", ".popup", ".modal", ".overlay",
];

export async function scrapeLandingPage(url: string): Promise<ScrapeResult> {
  let html: string;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AdCopyBot/1.0; +https://replit.com)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ar,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!resp.ok) {
      return { url, title: "", text: "", ok: false, error: `HTTP ${resp.status}` };
    }
    html = await resp.text();
  } catch (err) {
    return { url, title: "", text: "", ok: false, error: String(err) };
  }

  const $ = cheerio.load(html);

  // Strip junk
  $(JUNK_SELECTORS.join(", ")).remove();

  const title = $("title").first().text().trim()
    || $("h1").first().text().trim()
    || "";

  // Collect meaningful text in priority order
  const parts: string[] = [];

  // OG / meta description
  const metaDesc = $('meta[name="description"]').attr("content")
    || $('meta[property="og:description"]').attr("content")
    || "";
  if (metaDesc) parts.push(metaDesc.trim());

  // Headings + paragraphs + list items
  $("h1, h2, h3, p, li, .product-title, .price, [class*='benefit'], [class*='feature'], [class*='desc']")
    .each((_i, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t.length > 15) parts.push(t);
    });

  // Deduplicate consecutive duplicates
  const deduped: string[] = [];
  for (const p of parts) {
    if (deduped[deduped.length - 1] !== p) deduped.push(p);
  }

  let text = deduped.join("\n").slice(0, MAX_CHARS * 3);
  // Trim to MAX_CHARS on word boundary
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    const lastNL = text.lastIndexOf("\n");
    if (lastNL > MAX_CHARS * 0.6) text = text.slice(0, lastNL);
  }

  return { url, title, text: text.trim(), ok: true };
}
