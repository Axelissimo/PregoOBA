import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { mapProductRow, guessGroup, featuresJson, GROUPS } from "@/lib/catalog-helpers";
import { parseInventoryFile, splitCategory } from "@/lib/excel-parse";
import type { Product } from "@/lib/types";
import seed from "@/data/products.json";
import datasheetFilenames from "@/data/datasheet-filenames.json";

type SeedItem = Product;

function emptyish(value: unknown): boolean {
  if (value == null) return true;
  const s = String(value).trim();
  return s === "" || s === "[]";
}

async function insertSeedProduct(sql: Sql, p: SeedItem) {
  await sql`
    insert into products (
      sku, ean, name_fi, name_en, name_sv, name_no, name_et,
      category_code, category_fi, category_en, category_sv, category_no, category_et,
      product_group, net_price, carton_qty, stock, incoming, reserved, backorder, eta, active,
      image_url, datasheet_url, features_fi, features_en, features_sv, features_no, features_et
    ) values (
      ${p.sku}, ${p.ean}, ${p.nameFi}, ${p.nameEn}, ${p.nameSv}, ${p.nameNo}, ${p.nameEt},
      ${p.categoryCode}, ${p.categoryFi}, ${p.categoryEn}, ${p.categorySv}, ${p.categoryNo}, ${p.categoryEt},
      ${p.group}, ${p.netPrice}, ${p.cartonQty}, ${p.stock}, ${p.incoming}, ${p.reserved}, ${p.backorder},
      ${p.eta}, ${p.active},
      ${p.imageUrl}, ${p.datasheetUrl},
      ${featuresJson(p.featuresFi)}, ${featuresJson(p.featuresEn)}, ${featuresJson(p.featuresSv)},
      ${featuresJson(p.featuresNo)}, ${featuresJson(p.featuresEt)}
    ) on conflict (sku) do nothing
  `;
}

async function restoreCatalogMedia(sql: Sql) {
  const items = seed as SeedItem[];
  const existing = await sql<{
    sku: string;
    image_url: string | null;
    datasheet_url: string | null;
    features_fi: string | null;
  }>`select sku, image_url, datasheet_url, features_fi from products`;
  const bySku = new Map(existing.map((r) => [r.sku, r]));

  for (const p of items) {
    const row = bySku.get(p.sku);
    if (!row) continue;
    const needImage = emptyish(row.image_url) && Boolean(p.imageUrl);
    const needSheet = emptyish(row.datasheet_url) && Boolean(p.datasheetUrl);
    const needFeat = emptyish(row.features_fi) && (p.featuresFi?.length ?? 0) > 0;
    if (!needImage && !needSheet && !needFeat) continue;
    await sql`
      update products set
        image_url = case when ${needImage} then ${p.imageUrl} else image_url end,
        datasheet_url = case when ${needSheet} then ${p.datasheetUrl} else datasheet_url end,
        features_fi = case when ${needFeat} then ${featuresJson(p.featuresFi)} else features_fi end,
        features_en = case when ${needFeat} then ${featuresJson(p.featuresEn)} else features_en end,
        features_sv = case when ${needFeat} then ${featuresJson(p.featuresSv)} else features_sv end,
        features_no = case when ${needFeat} then ${featuresJson(p.featuresNo)} else features_no end,
        features_et = case when ${needFeat} then ${featuresJson(p.featuresEt)} else features_et end
      where sku = ${p.sku}
    `;
  }

  const known = Object.keys(datasheetFilenames as Record<string, string>);
  if (known.length > 0) {
    await sql.query(
      `update products
       set datasheet_url = '/datasheets/' || sku || '.pdf'
       where (datasheet_url is null or btrim(datasheet_url) = '')
         and sku = any($1::text[])`,
      [known],
    );
  }
}

async function seedIfEmpty() {
  const sql = await getSql();
  const items = seed as SeedItem[];
  const existing = await sql<{ sku: string }>`select sku from products`;
  const have = new Set(existing.map((r) => r.sku));
  for (const p of items) {
    if (!have.has(p.sku)) await insertSeedProduct(sql, p);
  }
  await restoreCatalogMedia(sql);
  await sql`update products set name_fi = replace(name_fi, 'HiusTENS', 'Hiusten') where name_fi like ${"%HiusTENS%"}`;
  const validGroups = new Set<string>(GROUPS.map((g) => g.id));
  const all = await sql<{ sku: string; category_code: string; product_group: string }>`
    select sku, category_code, product_group from products
  `;
  const seedBySku = new Map(items.map((p) => [p.sku, p.group]));
  for (const r of all) {
    if (validGroups.has(r.product_group)) continue;
    const next = seedBySku.get(r.sku) ?? guessGroup(r.category_code);
    if (next !== r.product_group) {
      await sql`update products set product_group = ${next} where sku = ${r.sku}`;
    }
  }
}

export const listProducts = createServerFn({ method: "GET" }).handler(async () => {
  await seedIfEmpty();
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select * from products
    where active = true
      and (stock > 0 or (eta is not null and btrim(eta) <> ''))
    order by product_group, category_code, sku
  `;
  const order = new Map<string, number>(GROUPS.map((g, i) => [g.id, i]));
  return rows
    .map(mapProductRow)
    .sort((a, b) => (order.get(a.group) ?? 99) - (order.get(b.group) ?? 99) || a.sku.localeCompare(b.sku));
});

export const getProduct = createServerFn({ method: "GET" })
  .validator((sku: string) => sku)
  .handler(async ({ data: sku }) => {
    await seedIfEmpty();
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      select * from products
      where sku = ${sku}
        and active = true
        and (stock > 0 or (eta is not null and btrim(eta) <> ''))
      limit 1
    `;
    return rows[0] ? mapProductRow(rows[0]) : null;
  });

async function requireAdmin(userId: string) {
  const sql = await getSql();
  const rows = await sql<{ role: string }>`select role from profiles where user_id = ${userId}`;
  if (rows[0]?.role !== "admin") {
    const err = new Error("Forbidden");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}

export const adminListProducts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    await seedIfEmpty();
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`select * from products order by sku`;
    return rows.map(mapProductRow);
  });

export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((p: Product) => p)
  .handler(async ({ context, data: p }) => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    await sql`
      insert into products (
        sku, ean, name_fi, name_en, name_sv, name_no, name_et,
        category_code, category_fi, category_en, category_sv, category_no, category_et,
        product_group, net_price, carton_qty, stock, incoming, reserved, backorder, eta, active, updated_at,
        image_url, datasheet_url, features_fi, features_en, features_sv, features_no, features_et
      ) values (
        ${p.sku}, ${p.ean}, ${p.nameFi}, ${p.nameEn}, ${p.nameSv}, ${p.nameNo}, ${p.nameEt},
        ${p.categoryCode}, ${p.categoryFi}, ${p.categoryEn}, ${p.categorySv}, ${p.categoryNo}, ${p.categoryEt},
        ${p.group}, ${p.netPrice}, ${p.cartonQty}, ${p.stock}, ${p.incoming}, ${p.reserved}, ${p.backorder},
        ${p.eta}, ${p.active}, now(),
        ${p.imageUrl}, ${p.datasheetUrl},
        ${featuresJson(p.featuresFi)}, ${featuresJson(p.featuresEn)}, ${featuresJson(p.featuresSv)},
        ${featuresJson(p.featuresNo)}, ${featuresJson(p.featuresEt)}
      )
      on conflict (sku) do update set
        ean = excluded.ean,
        name_fi = excluded.name_fi,
        name_en = excluded.name_en,
        name_sv = excluded.name_sv,
        name_no = excluded.name_no,
        name_et = excluded.name_et,
        category_code = excluded.category_code,
        category_fi = excluded.category_fi,
        category_en = excluded.category_en,
        category_sv = excluded.category_sv,
        category_no = excluded.category_no,
        category_et = excluded.category_et,
        product_group = excluded.product_group,
        net_price = excluded.net_price,
        carton_qty = excluded.carton_qty,
        stock = excluded.stock,
        incoming = excluded.incoming,
        reserved = excluded.reserved,
        backorder = excluded.backorder,
        eta = excluded.eta,
        active = excluded.active,
        image_url = excluded.image_url,
        datasheet_url = excluded.datasheet_url,
        features_fi = excluded.features_fi,
        features_en = excluded.features_en,
        features_sv = excluded.features_sv,
        features_no = excluded.features_no,
        features_et = excluded.features_et,
        updated_at = now()
    `;
    return { ok: true };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((sku: string) => sku)
  .handler(async ({ context, data: sku }) => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    await sql`delete from products where sku = ${sku}`;
    return { ok: true };
  });

let importAuditReady = false;
async function ensureImportAudit(sql: Sql) {
  if (importAuditReady) return;
  await sql.query(`alter table import_logs add column if not exists actor_email text not null default ''`);
  await sql.query(`alter table import_logs add column if not exists products_deactivated integer not null default 0`);
  await sql.query(`alter table import_logs add column if not exists products_changed integer not null default 0`);
  await sql.query(`alter table import_logs add column if not exists deactivate_missing boolean not null default false`);
  await sql.query(`alter table import_logs add column if not exists details text not null default '{}'`);
  importAuditReady = true;
}

export const importInventory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { filename: string; text: string; deactivateMissing: boolean }) => input)
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    await seedIfEmpty();
    const rows = parseInventoryFile(data.text);
    if (rows.length === 0) throw new Error("No product rows found in file");
    const sql = await getSql();
    await ensureImportAudit(sql);
    const actor =
      (
        await sql<{ email: string }>`select email from profiles where user_id = ${context.userId} limit 1`
      )[0]?.email || "";
    let updated = 0;
    let added = 0;
    const skus: string[] = [];
    const addedDetails: { sku: string; name: string; stock: number; price: number }[] = [];
    const changedDetails: {
      sku: string;
      name: string;
      fields: { field: string; from: string; to: string }[];
    }[] = [];
    const deactivatedDetails: { sku: string; name: string }[] = [];

    type Existing = {
      sku: string;
      name_fi: string;
      net_price: string;
      carton_qty: number;
      stock: number;
      incoming: number;
      reserved: number;
      backorder: number;
      eta: string | null;
      active: boolean;
    };

    for (const r of rows) {
      skus.push(r.sku);
      const cat = splitCategory(r.categoryRaw);
      const group = guessGroup(cat.code);
      const existing = await sql<Existing>`
        select sku, name_fi, net_price::text, carton_qty, stock, incoming, reserved, backorder, eta, active
        from products where upper(sku) = ${r.sku}
      `;
      if (existing.length === 0) {
        added += 1;
        const name = r.nameFi || r.sku;
        if (addedDetails.length < 800) {
          addedDetails.push({ sku: r.sku, name, stock: r.stock, price: r.netPrice });
        }
        const sheetUrl = (datasheetFilenames as Record<string, string>)[r.sku]
          ? `/datasheets/${r.sku}.pdf`
          : null;
        await sql`
          insert into products (
            sku, ean, name_fi, name_en, name_sv, name_no, name_et,
            category_code, category_fi, category_en, category_sv, category_no, category_et,
            product_group, net_price, carton_qty, stock, incoming, reserved, backorder, eta, active, updated_at,
            datasheet_url
          ) values (
            ${r.sku}, ${r.ean}, ${name}, ${name}, ${name}, ${name}, ${name},
            ${cat.code}, ${cat.fi}, ${cat.fi}, ${cat.fi}, ${cat.fi}, ${cat.fi},
            ${group}, ${r.netPrice}, ${r.cartonQty}, ${r.stock}, ${r.incoming}, ${r.reserved}, ${r.backorder},
            ${r.eta}, true, now(),
            ${sheetUrl}
          )
        `;
      } else {
        updated += 1;
        const prev = existing[0];
        const fields: { field: string; from: string; to: string }[] = [];
        const push = (field: string, from: unknown, to: unknown) => {
          if (String(from ?? "") === String(to ?? "")) return;
          fields.push({ field, from: String(from ?? ""), to: String(to ?? "") });
        };
        push("varasto", Number(prev.stock), r.stock);
        push("hinta", Number(prev.net_price), r.netPrice);
        push("myyntierä", Number(prev.carton_qty), r.cartonQty);
        push("tulo", Number(prev.incoming), r.incoming);
        push("varattu", Number(prev.reserved), r.reserved);
        push("jälkitoim.", Number(prev.backorder), r.backorder);
        push("saapuminen", prev.eta ?? "", r.eta ?? "");
        if (fields.length && changedDetails.length < 800) {
          changedDetails.push({ sku: r.sku, name: prev.name_fi || r.sku, fields });
        }
        await sql`
          update products set
            ean = case when ${r.ean} = '' then ean else ${r.ean} end,
            category_code = case when ${cat.code} = '000' then category_code else ${cat.code} end,
            category_fi = case when ${cat.fi} = 'Muut' then category_fi else ${cat.fi} end,
            product_group = ${group},
            net_price = ${r.netPrice},
            carton_qty = ${r.cartonQty},
            stock = ${r.stock},
            incoming = ${r.incoming},
            reserved = ${r.reserved},
            backorder = ${r.backorder},
            eta = ${r.eta},
            active = true,
            updated_at = now()
          where upper(sku) = ${r.sku}
        `;
      }
    }
    if (data.deactivateMissing && skus.length > 0) {
      const keep = new Set(skus);
      const all = await sql<{ sku: string; name_fi: string }>`select sku, name_fi from products where active = true`;
      for (const row of all) {
        if (!keep.has(row.sku)) {
          if (deactivatedDetails.length < 800) {
            deactivatedDetails.push({ sku: row.sku, name: row.name_fi || row.sku });
          }
          await sql`update products set active = false, updated_at = now() where sku = ${row.sku}`;
        }
      }
    }
    const details = JSON.stringify({
      added: addedDetails,
      changed: changedDetails,
      deactivated: deactivatedDetails,
    });
    await sql`
      insert into import_logs (
        user_id, actor_email, filename, products_updated, products_added,
        products_deactivated, products_changed, deactivate_missing, details
      ) values (
        ${context.userId}, ${actor}, ${data.filename}, ${updated}, ${added},
        ${deactivatedDetails.length}, ${changedDetails.length}, ${data.deactivateMissing}, ${details}
      )
    `;
    await restoreCatalogMedia(sql);
    return { updated, added, changed: changedDetails.length, deactivated: deactivatedDetails.length, total: rows.length };
  });

export type ImportLogRow = {
  id: number;
  filename: string;
  products_updated: number;
  products_added: number;
  products_deactivated: number;
  products_changed: number;
  deactivate_missing: boolean;
  details: string;
  created_at: string;
  actor_email: string;
};

export const listImportLogs = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    await ensureImportAudit(sql);
    return sql<ImportLogRow>`
      select
        l.id,
        l.filename,
        l.products_updated,
        l.products_added,
        coalesce(l.products_deactivated, 0) as products_deactivated,
        coalesce(l.products_changed, 0) as products_changed,
        coalesce(l.deactivate_missing, false) as deactivate_missing,
        coalesce(l.details, '{}') as details,
        l.created_at,
        coalesce(nullif(l.actor_email, ''), p.email, l.user_id) as actor_email
      from import_logs l
      left join profiles p on p.user_id = l.user_id
      order by l.id desc
      limit 200
    `;
  });

