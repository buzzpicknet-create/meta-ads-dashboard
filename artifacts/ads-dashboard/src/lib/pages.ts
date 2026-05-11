import {
  LayoutDashboard,
  Video,
  Scissors,
  FileText,
  ShoppingBag,
  Users,
  Trophy,
  Settings,
} from "lucide-react";

export const PAGE_SLUGS = [
  "campaigns",
  "creative",
  "video-studio",
  "audience",
  "landing-page",
  "shopify",
  "winning-products",
  "settings",
] as const;

export type PageSlug = typeof PAGE_SLUGS[number];

export const META_PAGES = [
  { slug: "campaigns" as PageSlug, path: "/campaigns", label: "القرارات", icon: LayoutDashboard },
  { slug: "creative" as PageSlug, path: "/creative", label: "مركز الكريتف", icon: Video },
  { slug: "video-studio" as PageSlug, path: "/video-studio", label: "استوديو الفيديو", icon: Scissors },
  { slug: "audience" as PageSlug, path: "/audience", label: "الجمهور والمنصات", icon: Users },
];

export const GOOGLE_PAGES = [
  { slug: "landing-page" as PageSlug, path: "/landing-page", label: "صفحات البيع", icon: FileText },
  { slug: "shopify" as PageSlug, path: "/shopify", label: "Shopify", icon: ShoppingBag },
  { slug: "winning-products" as PageSlug, path: "/winning-products", label: "منتجات رابحة", icon: Trophy },
];

export const GENERAL_PAGES = [
  { slug: "settings" as PageSlug, path: "/settings", label: "الإعدادات", icon: Settings },
];

export const ALL_PAGES = [...META_PAGES, ...GOOGLE_PAGES, ...GENERAL_PAGES];
