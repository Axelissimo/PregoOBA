import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";
import datasheetFilenames from "@/data/datasheet-filenames.json";

const SAFE = /^[A-Za-z0-9._-]{1,80}$/;
const NAMES = datasheetFilenames as Record<string, string>;

const bundled = import.meta.glob("../../../private/datasheets/*.pdf") as Record<
  string,
  () => Promise<{ default: Uint8Array | ArrayBuffer | { default?: Uint8Array } }>
>;

function fileName(raw: string): string | null {
  const base = decodeURIComponent(raw || "").split("/").pop() || "";
  const trimmed = base.trim();
  const sku = trimmed.replace(/\.pdf$/i, "").toUpperCase();
  const name = `${sku}.pdf`;
  if (SAFE.test(name)) return name;
  if (SAFE.test(trimmed)) return trimmed;
  return null;
}

function skuFromName(name: string): string {
  return name.replace(/\.pdf$/i, "").toUpperCase();
}

function downloadName(name: string): string {
  return NAMES[skuFromName(name)] || name;
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_") || "datasheet.pdf";
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function toBuffer(data: unknown): Buffer | null {
  if (data == null) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === "object" && data && "default" in data) {
    return toBuffer((data as { default: unknown }).default);
  }
  return null;
}

function moduleDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

function datasheetRoots(): string[] {
  const cwd = process.cwd();
  const here = moduleDir();
  return [
    join(cwd, "datasheets"),
    join(cwd, "private", "datasheets"),
    join(cwd, "public", "datasheets"),
    join(here, "datasheets"),
    join("/var/task", "datasheets"),
    join("/var/task", "public", "datasheets"),
    join("/var/task", "private", "datasheets"),
  ];
}

async function readFromDisk(name: string): Promise<Buffer | null> {
  const sku = skuFromName(name);
  const wanted = new Set([name, `${sku}.pdf`, name.toLowerCase(), `${sku.toLowerCase()}.pdf`]);
  for (const root of datasheetRoots()) {
    try {
      if (!existsSync(root)) continue;
      const match = readdirSync(root).find((f) => wanted.has(f) || f.toUpperCase() === `${sku}.PDF`);
      if (!match) continue;
      const path = join(root, match);
      if (!path.startsWith(root)) continue;
      return await readFile(path);
    } catch (err) {
      console.error("[datasheet] disk", root, err);
    }
  }
  return null;
}

async function readFromBundle(name: string): Promise<Buffer | null> {
  const sku = skuFromName(name);
  const needle = `/${sku}.pdf`.toLowerCase();
  const key = Object.keys(bundled).find((k) => k.replace(/\\/g, "/").toLowerCase().endsWith(needle));
  if (!key) return null;
  try {
    const mod = await bundled[key]();
    return toBuffer(mod) || toBuffer(mod?.default);
  } catch (err) {
    console.error("[datasheet] bundle", key, err);
    return null;
  }
}

async function readFromPublicUrl(request: Request, name: string): Promise<Buffer | null> {
  try {
    const url = new URL(`/datasheets/${encodeURIComponent(name)}`, request.url);
    const res = await fetch(url, { redirect: "manual" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.includes("pdf") && !type.includes("octet-stream")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8 || buf.subarray(0, 4).toString() !== "%PDF") return null;
    return buf;
  } catch (err) {
    console.error("[datasheet] public url", err);
    return null;
  }
}

async function readPdf(name: string, request: Request): Promise<Buffer | null> {
  return (
    (await readFromDisk(name)) ||
    (await readFromBundle(name)) ||
    (await readFromPublicUrl(request, name))
  );
}

export async function serveDatasheet(request: Request, rawName: string): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId) {
    const login = new URL("/login", request.url);
    login.searchParams.set("redirect", "/catalog");
    return Response.redirect(login.toString(), 302);
  }

  const sql = await getSql();
  const rows = await sql<{ role: string }>`select role from profiles where user_id = ${userId}`;
  const role = rows[0]?.role;
  if (role !== "admin" && role !== "customer") {
    return Response.redirect(new URL("/pending", request.url).toString(), 302);
  }

  const name = fileName(rawName);
  if (!name) return new Response("Tuotekorttia ei löydy", { status: 404 });
  const buf = await readPdf(name, request);
  if (!buf) {
    console.error("[datasheet] missing", name, "cwd=", process.cwd());
    return new Response("Tuotekorttia ei löydy", { status: 404 });
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(downloadName(name)),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
