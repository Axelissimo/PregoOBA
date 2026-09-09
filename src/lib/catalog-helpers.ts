import type { Lang } from "./utils";
import type { Product } from "./types";
import datasheetFilenames from "@/data/datasheet-filenames.json";
import { hasArrivalDate } from "./commerce-rules";

export const GROUPS = [
  { id: "coffee", image: "/images/group-coffee.jpg" },
  { id: "kettles", image: "/images/group-kettles.jpg" },
  { id: "food", image: "/images/group-food.jpg" },
  { id: "homecare", image: "/images/group-homecare.jpg" },
  { id: "electronics", image: "/images/group-electronics.jpg" },
  { id: "audio", image: "/images/group-audio.jpg" },
  { id: "health", image: "/images/group-health.jpg" },
  { id: "hair", image: "/images/group-hair.jpg" },
  { id: "shave", image: "/images/group-shave.jpg" },
] as const;

export type ProductGroupId = (typeof GROUPS)[number]["id"];

export function productName(p: Product, lang: Lang): string {
  const map: Record<Lang, string> = {
    fi: p.nameFi,
    en: p.nameEn,
    sv: p.nameSv,
    no: p.nameNo,
    et: p.nameEt,
  };
  return map[lang] || p.nameFi;
}

export function categoryName(p: Product, lang: Lang): string {
  const map: Record<Lang, string> = {
    fi: p.categoryFi,
    en: p.categoryEn,
    sv: p.categorySv,
    no: p.categoryNo,
    et: p.categoryEt,
  };
  return map[lang] || p.categoryFi;
}

export function groupImage(group: string): string {
  return GROUPS.find((g) => g.id === group)?.image ?? "/images/group-food.jpg";
}

export function parseFeatures(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  const raw = value.trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    /* plain text, one feature per line */
  }
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function featuresJson(list: string[] | undefined): string {
  return JSON.stringify(Array.isArray(list) ? list.filter(Boolean) : []);
}

export function productFeatures(p: Product, lang: Lang): string[] {
  const map: Record<Lang, string[]> = {
    fi: p.featuresFi,
    en: p.featuresEn,
    sv: p.featuresSv,
    no: p.featuresNo,
    et: p.featuresEt,
  };
  const local = map[lang] ?? [];
  return local.length ? local : p.featuresFi;
}

export function productImage(p: Product): string {
  return p.imageUrl || groupImage(p.group);
}

export function hasProductPhoto(p: Product): boolean {
  return Boolean(p.imageUrl);
}

export function skuHasDatasheet(sku: string): boolean {
  return Boolean((datasheetFilenames as Record<string, string>)[sku]);
}

export function resolvedDatasheetUrl(sku: string, stored: string | null): string | null {
  if (stored) return stored;
  if (skuHasDatasheet(sku)) return `/datasheets/${sku}.pdf`;
  return null;
}

export function datasheetDownloadName(p: Product): string {
  const original = (datasheetFilenames as Record<string, string>)[p.sku];
  if (original) return original;
  const safe = p.nameFi.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `Prego ${safe} ${p.sku}.pdf`;
}


/** Customer catalog: in stock, or out of stock with a dated Excel ETA (must include a year). */
export function isCustomerVisible(p: { stock: number; eta: string | null; active?: boolean }): boolean {
  if (p.active === false) return false;
  if (p.stock > 0) return true;
  return hasArrivalDate(p.eta);
}

export function mapProductRow(row: Record<string, unknown>): Product {
  const n = (v: unknown) => {
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const strOrNull = (v: unknown) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  };
  return {
    sku: String(row.sku ?? ""),
    ean: row.ean == null || row.ean === "" ? null : String(row.ean),
    nameFi: String(row.name_fi ?? ""),
    nameEn: String(row.name_en ?? ""),
    nameSv: String(row.name_sv ?? ""),
    nameNo: String(row.name_no ?? ""),
    nameEt: String(row.name_et ?? ""),
    categoryCode: String(row.category_code ?? ""),
    categoryFi: String(row.category_fi ?? ""),
    categoryEn: String(row.category_en ?? ""),
    categorySv: String(row.category_sv ?? ""),
    categoryNo: String(row.category_no ?? ""),
    categoryEt: String(row.category_et ?? ""),
    group: String(row.product_group ?? "food"),
    netPrice: n(row.net_price),
    cartonQty: Math.max(1, Math.round(n(row.carton_qty) || 1)),
    stock: Math.round(n(row.stock)),
    incoming: Math.round(n(row.incoming)),
    reserved: Math.round(n(row.reserved)),
    backorder: Math.round(n(row.backorder)),
    eta: row.eta == null || row.eta === "" ? null : String(row.eta),
    active: Boolean(row.active),
    imageUrl: strOrNull(row.image_url),
    datasheetUrl: resolvedDatasheetUrl(String(row.sku ?? ""), strOrNull(row.datasheet_url)),
    featuresFi: parseFeatures(row.features_fi),
    featuresEn: parseFeatures(row.features_en),
    featuresSv: parseFeatures(row.features_sv),
    featuresNo: parseFeatures(row.features_no),
    featuresEt: parseFeatures(row.features_et),
  };
}

export function guessGroup(categoryCode: string): string {
  const c = Number(categoryCode);
  if (c === 100) return "coffee";
  if (c === 101) return "kettles";
  if (c === 102 || c === 103 || c === 104 || c === 106) return "food";
  if (c === 110 || c === 111 || c === 115 || c === 118 || c === 140) return "homecare";
  if (c === 120 || c === 122 || c === 124) return "electronics";
  if (c === 500 || c === 505 || c === 530) return "audio";
  if (c === 150 || c === 151 || c === 152) return "health";
  if (c === 200 || c === 201 || c === 202 || c === 203) return "hair";
  if (c === 205 || c === 206) return "shave";
  return "electronics";
}
