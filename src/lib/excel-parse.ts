export type ImportedRow = {
  sku: string;
  nameFi: string;
  eta: string | null;
  ean: string;
  categoryRaw: string;
  netPrice: number;
  cartonQty: number;
  stock: number;
  incoming: number;
  reserved: number;
  backorder: number;
};

const SKU_RE = /^(P|PB|PA|PS|PM|PE|LA|S)\w+/i;

function normalizeSku(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cellsOfRow(fragment: string): string[] {
  const cells: string[] = [];
  const re = /<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/gi;
  let m: RegExpExecArray | null;
  let col = 0;
  while ((m = re.exec(fragment))) {
    const idx = /ss:Index="(\d+)"/i.exec(m[1]);
    if (idx) {
      const want = Number(idx[1]) - 1;
      while (col < want) {
        cells.push("");
        col += 1;
      }
    }
    const data = /<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(m[2]);
    const raw = data ? decodeEntities(data[1].replace(/<[^>]+>/g, "").trim()) : "";
    cells.push(raw);
    col += 1;
  }
  return cells;
}

function num(v: string | undefined, fallback = 0): number {
  if (v == null || v.trim() === "") return fallback;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function parseXml(text: string): ImportedRow[] {
  const chunks = text.split(/<Row\b[^>]*>/i);
  const rows: ImportedRow[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const cells = cellsOfRow(chunk);
    if (cells.length < 8) continue;
    const sku = normalizeSku(cells[0] || "");
    if (!SKU_RE.test(sku) && !/^[A-Z]{1,4}\d/i.test(sku)) continue;
    if (sku.toLowerCase() === "tuote") continue;
    if (seen.has(sku)) continue;
    seen.add(sku);
    const etaRaw = (cells[2] || "").trim();
    rows.push({
      sku,
      nameFi: (cells[1] || "").trim(),
      eta: etaRaw && etaRaw !== " " ? etaRaw : null,
      ean: (cells[3] || "").trim(),
      categoryRaw: (cells[4] || "").trim(),
      netPrice: num(cells[5]),
      cartonQty: Math.max(1, Math.round(num(cells[6], 1))),
      stock: Math.round(num(cells[7])),
      incoming: Math.round(num(cells[8])),
      reserved: Math.round(num(cells[9])),
      backorder: Math.round(num(cells[10])),
    });
  }
  return rows;
}

function parseCsv(text: string): ImportedRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (line: string) => {
    const cols: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        q = !q;
        continue;
      }
      if ((ch === "," || ch === ";" || ch === "\t") && !q) {
        cols.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iSku = idx(["tuote", "sku", "product"]);
  const iName = idx(["kuvaus", "name", "description"]);
  const iEan = idx(["ean"]);
  const iCat = idx(["alaryhm", "category", "ryhm"]);
  const iPrice = idx(["myyntihinta", "price", "hinta"]);
  const iCarton = idx(["myyntiyks", "carton", "erä"]);
  const iStock = idx(["vapaasaldo", "stock", "saldo"]);
  const iInc = idx(["tilattuna", "incoming"]);
  const iRes = idx(["varaukset", "reserved"]);
  const iBack = idx(["jälkitoim", "jalkitoim", "backorder"]);
  const iEta = idx(["eta", "saapuminen"]);
  if (iSku < 0) return [];
  const rows: ImportedRow[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    const c = split(line);
    const sku = normalizeSku(c[iSku] || "");
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    rows.push({
      sku,
      nameFi: (iName >= 0 ? c[iName] : "") || sku,
      eta: iEta >= 0 ? c[iEta] || null : null,
      ean: iEan >= 0 ? c[iEan] || "" : "",
      categoryRaw: iCat >= 0 ? c[iCat] || "" : "",
      netPrice: num(iPrice >= 0 ? c[iPrice] : "0"),
      cartonQty: Math.max(1, Math.round(num(iCarton >= 0 ? c[iCarton] : "1", 1))),
      stock: Math.round(num(iStock >= 0 ? c[iStock] : "0")),
      incoming: Math.round(num(iInc >= 0 ? c[iInc] : "0")),
      reserved: Math.round(num(iRes >= 0 ? c[iRes] : "0")),
      backorder: Math.round(num(iBack >= 0 ? c[iBack] : "0")),
    });
  }
  return rows;
}

export function parseInventoryFile(text: string): ImportedRow[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("<?xml") || trimmed.includes("ss:Workbook") || trimmed.includes("<Workbook")) {
    return parseXml(text);
  }
  return parseCsv(text);
}

function etaText(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = String(value.getDate()).padStart(2, "0");
    const m = String(value.getMonth() + 1).padStart(2, "0");
    return `${d}.${m}.${value.getFullYear()}`;
  }
  const s = String(value ?? "").trim();
  if (!s || s === "0") return null;
  return s;
}

function rowsFromMatrix(matrix: unknown[][]): ImportedRow[] {
  const asText = matrix.map((row) => (row || []).map((cell) => (cell instanceof Date ? etaText(cell) || "" : String(cell ?? "").trim())));
  let headerAt = -1;
  for (let i = 0; i < Math.min(asText.length, 40); i++) {
    const line = asText[i].join(" | ").toLowerCase();
    if (line.includes("vapaasaldo") || (line.includes("tuote") && (line.includes("hinta") || line.includes("saldo")))) {
      headerAt = i;
      break;
    }
  }
  if (headerAt >= 0) {
    const header = asText[headerAt].map((h) => h.toLowerCase());
    const fake = [header.join(";"), ...asText.slice(headerAt + 1).map((r) => r.map((c) => `"${c.replaceAll('"', "")}"`).join(";"))];
    return parseCsv(fake.join("\n"));
  }
  const rows: ImportedRow[] = [];
  const seen = new Set<string>();
  for (const cells of asText) {
    const sku = normalizeSku(cells[0] || "");
    if (!SKU_RE.test(sku) && !/^[A-Z]{1,4}\d/i.test(sku)) continue;
    if (seen.has(sku)) continue;
    seen.add(sku);
    rows.push({
      sku,
      nameFi: (cells[1] || "").trim(),
      eta: etaText(cells[2]),
      ean: (cells[3] || "").trim(),
      categoryRaw: (cells[4] || "").trim(),
      netPrice: num(cells[5]),
      cartonQty: Math.max(1, Math.round(num(cells[6], 1))),
      stock: Math.round(num(cells[7])),
      incoming: Math.round(num(cells[8])),
      reserved: Math.round(num(cells[9])),
      backorder: Math.round(num(cells[10])),
    });
  }
  return rows;
}

export async function parseInventoryBytes(bytes: Uint8Array): Promise<ImportedRow[]> {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf;
  if (zip || ole) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(bytes, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][];
    const rows = rowsFromMatrix(matrix);
    if (rows.length) return rows;
  }
  const latin = new TextDecoder("iso-8859-15").decode(bytes);
  const utf = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const xml = latin.includes("<Workbook") || latin.includes("ss:Workbook") ? latin : utf;
  return parseInventoryFile(xml);
}

export function splitCategory(raw: string): { code: string; fi: string } {
  const m = raw.match(/^(\d+)\s*[-–]\s*(.+)$/);
  if (m) return { code: m[1], fi: m[2].trim() };
  return { code: raw.slice(0, 8) || "000", fi: raw || "Muut" };
}
