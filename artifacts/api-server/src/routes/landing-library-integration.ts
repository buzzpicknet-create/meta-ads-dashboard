import { Router } from "express";

const router = Router();

type LandingRecord = {
  landingPageId?: number | string | null;
  id?: number | string | null;
  productId?: string | number | null;
  productName?: string | null;
  productHandle?: string | null;
  storeId?: string | number | null;
  storeDomain?: string | null;
  landingPageUrl?: string | null;
  pageUrl?: string | null;
  publishedAt?: string | null;
};

function normalizeDomain(value?: string | null) {
  if (!value) return null;
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.replace(/^www\./, "").toLowerCase();
  }
}

router.get("/creative-routine/landing-pages", async (req, res) => {
  const baseUrl = process.env.LANDING_LIBRARY_API_URL?.trim();
  const token = process.env.LANDING_LIBRARY_TOKEN?.trim();
  if (!baseUrl || !token) {
    return res.status(503).json({ error: "Landing library integration is not configured", data: [] });
  }

  try {
    const url = new URL(baseUrl);
    url.searchParams.set("latestPerProduct", "true");
    if (typeof req.query.productId === "string" && req.query.productId) url.searchParams.set("productId", req.query.productId);
    if (typeof req.query.storeDomain === "string" && req.query.storeDomain) url.searchParams.set("storeDomain", req.query.storeDomain);

    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(502).json({ error: "Landing library upstream request failed", status: upstream.status, data: [] });
    }

    const raw: LandingRecord[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.products)
          ? payload.products.flatMap((p: any) => Array.isArray(p.pages) ? p.pages.map((page: any) => ({ ...page, productId: page.productId ?? p.productId, productName: page.productName ?? p.productName, productHandle: page.productHandle ?? p.productHandle })) : [])
          : [];

    const data = raw.map((row) => ({
      landingPageId: row.landingPageId ?? row.id ?? null,
      productId: row.productId != null ? String(row.productId) : null,
      productName: row.productName ?? null,
      productHandle: row.productHandle ?? null,
      storeId: row.storeId ?? null,
      storeDomain: normalizeDomain(row.storeDomain ?? row.landingPageUrl ?? row.pageUrl),
      landingPageUrl: row.landingPageUrl ?? row.pageUrl ?? null,
      publishedAt: row.publishedAt ?? null,
    })).filter((row) => !!row.landingPageUrl);

    res.json({ data, total: data.length });
  } catch (error) {
    console.error("landing library integration failed", error);
    res.status(502).json({ error: "Landing library integration failed", data: [] });
  }
});

export default router;
