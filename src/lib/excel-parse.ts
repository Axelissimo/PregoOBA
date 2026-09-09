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

function cellText(fragment: string): string[] {
  const out: string[] = [];
  const re = /<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) {
    const raw = m[1].replace(/<[^>]+>/g, "").trim();
    out.push(decodeEntities(raw));
  }
  return out;
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
    const cells = cellText(chunk);
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

export function splitCategory(raw: string): { code: string; fi: string } {
  const m = raw.match(/^(\d+)\s*[-–]\s*(.+)$/);
  if (m) return { code: m[1], fi: m[2].trim() };
  return { code: raw.slice(0, 8) || "000", fi: raw || "Muut" };
}
