import { pgTable, serial, text, boolean, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

export const shopifyConfig = pgTable("shopify_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const shopifyStores = pgTable("shopify_stores", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  accessToken: text("access_token").notNull(),
  shopName: text("shop_name"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const landingPageRecords = pgTable("landing_page_records", {
  id: serial("id").primaryKey(),
  productId: text("product_id").notNull(),
  productName: text("product_name").notNull(),
  productHandle: text("product_handle").notNull().default(""),
  productImage: text("product_image").notNull().default(""),
  pageUrl: text("page_url").notNull(),
  adminUrl: text("admin_url").notNull().default(""),
  suffix: text("suffix").notNull().default(""),
  assetKey: text("asset_key").notNull().default(""),
  headline: text("headline").notNull().default(""),
  lpModel: text("lp_model").notNull().default(""),
  userId: text("user_id").notNull().default(""),
  htmlBody: text("html_body"),
  adCreatives: jsonb("ad_creatives"),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow(),
  storeId: integer("store_id"),
});

export const realReviewsStore = pgTable("real_reviews_store", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  reviews: jsonb("reviews").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
