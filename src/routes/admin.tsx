import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, Fragment } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { OrderList } from "@/components/order-list";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { RedirectToSignIn } from "@/lib/auth/gates";
import {
  adminListProducts,
  deleteProduct,
  importInventory,
  listImportLogs,
  upsertProduct,
} from "@/lib/server/catalog";
import {
  adminListOrders,
  adminOverview,
  ensureProfile,
  listCustomers,
  deleteCustomer,
  saveSettings,
  setCustomerRole,
  setOrderStatus,
  getSettings,
  sendTestEmail,
  submitOrder,
} from "@/lib/server/commerce";
import { GROUPS } from "@/lib/catalog-helpers";
import { formatEur } from "@/lib/utils";
import { downloadCsv, stamp } from "@/lib/csv";
import { useI18n } from "@/lib/i18n";
import type { Order, Product, Profile } from "@/lib/types";

export const Route = createFileRoute("/admin")({ component: AdminPage });

type Tab = "overview" | "products" | "import" | "orders" | "customers" | "settings";

function AdminPage() {
  const { user, isPending } = useCurrentUserState();
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>("overview");
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void ensureProfile({ data: { email: user.primaryEmail, displayName: user.displayName, language: lang } })
      .then((p: Profile) => setRole(p.role))
      .catch(() => setRole(null));
  }, [user, lang]);

  if (isPending) {
    return (
      <Shell>
        <p className="p-10 text-sm text-muted">{t("common.loading")}</p>
      </Shell>
    );
  }
  if (!user) return <RedirectToSignIn />;
  if (role && role !== "admin") {
    return (
      <Shell>
        <p className="p-10 text-sm text-muted">Forbidden</p>
      </Shell>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: t("admin.overview") },
    { id: "products", label: t("admin.products") },
    { id: "import", label: t("admin.import") },
    { id: "orders", label: t("admin.orders") },
    { id: "customers", label: t("admin.customers") },
    { id: "settings", label: t("admin.settings") },
  ];

  return (
    <Shell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-medium tracking-tight">{t("admin.title")}</h1>
        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${tab === tb.id ? "border-ink bg-ink text-paper" : "border-line bg-surface"}`}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <div className="mt-8">
          {tab === "overview" && <Overview />}
          {tab === "products" && <ProductsAdmin />}
          {tab === "import" && <ImportAdmin />}
          {tab === "orders" && <OrdersAdmin />}
          {tab === "customers" && <CustomersAdmin currentUserId={user.id} />}
          {tab === "settings" && <SettingsAdmin />}
        </div>
      </div>
    </Shell>
  );
}

function Overview() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ["admin-overview"], queryFn: () => adminOverview() });
  const d = q.data;
  if (!d) return <p className="text-sm text-muted">{t("common.loading")}</p>;
  const cards = [
    { label: t("admin.products"), value: d.products },
    { label: t("admin.orders"), value: d.orders },
    { label: t("orders.status.submitted"), value: d.open },
    { label: t("admin.customers"), value: d.customers },
    { label: t("stock.low"), value: d.low },
    { label: t("stock.out"), value: d.out },
  ];
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-line bg-surface p-5">
            <p className="text-xs uppercase tracking-wider text-muted">{c.label}</p>
            <p className="mt-2 text-3xl font-medium tabular-nums">{c.value}</p>
          </div>
        ))}
      </div>
      <ExportPanel />
      <h2 className="mt-10 text-lg font-medium">Email</h2>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface text-sm">
        {d.emails.map((e) => (
          <li key={e.id} className="px-4 py-3">
            <p className="font-medium">{e.subject}</p>
            <p className="text-xs text-muted">
              {e.to_address} · {String(e.created_at).slice(0, 16)}
              {e.status ? ` · ${e.status}` : ""}
            </p>
            {e.error ? <p className="mt-1 text-xs text-accent">{e.error}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function emptyProduct(): Product {
  return {
    sku: "",
    ean: "",
    nameFi: "",
    nameEn: "",
    nameSv: "",
    nameNo: "",
    nameEt: "",
    categoryCode: "100",
    categoryFi: "",
    categoryEn: "",
    categorySv: "",
    categoryNo: "",
    categoryEt: "",
    group: "coffee",
    netPrice: 0,
    cartonQty: 1,
    stock: 0,
    incoming: 0,
    reserved: 0,
    backorder: 0,
    eta: null,
    active: true,
    imageUrl: null,
    datasheetUrl: null,
    featuresFi: [],
    featuresEn: [],
    featuresSv: [],
    featuresNo: [],
    featuresEt: [],
  };
}

function ProductsAdmin() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-products"], queryFn: () => adminListProducts() });
  const [term, setTerm] = useState("");
  const [edit, setEdit] = useState<Product | null>(null);
  const products = q.data ?? [];
  const filtered = useMemo(() => {
    const n = term.trim().toLowerCase();
    if (!n) return products;
    return products.filter((p) =>
      `${p.sku} ${p.nameFi} ${p.ean ?? ""} ${(p.featuresFi ?? []).join(" ")}`.toLowerCase().includes(n),
    );
  }, [products, term]);

  const save = useMutation({
    mutationFn: (p: Product) => upsertProduct({ data: p }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-products"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      setEdit(null);
      toast.message(t("account.saved"));
    },
  });
  const del = useMutation({
    mutationFn: (sku: string) => deleteProduct({ data: sku }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-products"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
  });

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <Input className="max-w-sm" placeholder={t("catalog.search")} value={term} onChange={(e) => setTerm(e.target.value)} />
        <Button type="button" onClick={() => setEdit(emptyProduct())}>
          {t("admin.addProduct")}
        </Button>
      </div>
      {edit ? (
        <form
          className="mt-6 grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!edit.sku) return;
            save.mutate(edit);
          }}
        >
          <Field label={t("product.sku")}>
            <Input value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} required />
          </Field>
          <Field label={t("product.ean")}>
            <Input value={edit.ean ?? ""} onChange={(e) => setEdit({ ...edit, ean: e.target.value })} />
          </Field>
          <Field label="FI">
            <Input value={edit.nameFi} onChange={(e) => setEdit({ ...edit, nameFi: e.target.value })} required />
          </Field>
          <Field label="EN">
            <Input value={edit.nameEn} onChange={(e) => setEdit({ ...edit, nameEn: e.target.value })} />
          </Field>
          <Field label={t("product.net")}>
            <Input
              type="number"
              step="0.01"
              value={edit.netPrice}
              onChange={(e) => setEdit({ ...edit, netPrice: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("product.carton")}>
            <Input
              type="number"
              value={edit.cartonQty}
              onChange={(e) => setEdit({ ...edit, cartonQty: Number(e.target.value) })}
            />
          </Field>
          <Field label="Stock">
            <Input type="number" value={edit.stock} onChange={(e) => setEdit({ ...edit, stock: Number(e.target.value) })} />
          </Field>
          <Field label="Incoming">
            <Input
              type="number"
              value={edit.incoming}
              onChange={(e) => setEdit({ ...edit, incoming: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("admin.group")}>
            <select
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm"
              value={edit.group}
              onChange={(e) => setEdit({ ...edit, group: e.target.value })}
            >
              {GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {t(`groups.${g.id}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <Input
              value={edit.categoryFi}
              onChange={(e) => setEdit({ ...edit, categoryFi: e.target.value, categoryEn: e.target.value })}
            />
          </Field>
          <Field label={t("product.image")}>
            <Input
              value={edit.imageUrl ?? ""}
              onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value || null })}
              placeholder="/images/products/SKU.jpg"
            />
          </Field>
          <Field label={t("product.datasheet")}>
            <Input
              value={edit.datasheetUrl ?? ""}
              onChange={(e) => setEdit({ ...edit, datasheetUrl: e.target.value || null })}
              placeholder="/datasheets/SKU.pdf"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label={`${t("product.features")} (FI)`}>
              <Textarea
                value={(edit.featuresFi ?? []).join("\n")}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    featuresFi: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {t("admin.save")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEdit(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : null}
      <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-2xl text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">FI</th>
              <th className="px-3 py-2">{t("product.net")}</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.sku} className="border-t border-line">
                <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                <td className="px-3 py-2">{p.nameFi}</td>
                <td className="px-3 py-2 tabular-nums">{p.netPrice.toFixed(2)}</td>
                <td className="px-3 py-2 tabular-nums">{p.stock}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="mr-3 text-xs underline" onClick={() => setEdit(p)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-xs text-accent underline"
                    onClick={() => {
                      if (confirm(p.sku)) del.mutate(p.sku);
                    }}
                  >
                    {t("admin.remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatAuditTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("fi-FI", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type AuditDetails = {
  added?: { sku: string; name: string; stock: number; price: number }[];
  changed?: { sku: string; name: string; fields: { field: string; from: string; to: string }[] }[];
  deactivated?: { sku: string; name: string }[];
};

function parseDetails(raw: string | undefined): AuditDetails {
  try {
    return JSON.parse(raw || "{}") as AuditDetails;
  } catch {
    return {};
  }
}

function AuditLog({
  entries,
}: {
  entries: {
    id: number;
    filename: string;
    products_updated: number;
    products_added: number;
    products_deactivated?: number;
    products_changed?: number;
    deactivate_missing?: boolean;
    details?: string;
    created_at: string;
    actor_email?: string;
  }[];
}) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <div className="mt-10">
      <h2 className="text-lg font-medium">{t("admin.audit")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("admin.auditLead")}</p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-3xl text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">{t("admin.auditWhen")}</th>
              <th className="px-3 py-2">{t("admin.auditWho")}</th>
              <th className="px-3 py-2">{t("admin.auditFile")}</th>
              <th className="px-3 py-2">{t("admin.auditAdded")}</th>
              <th className="px-3 py-2">{t("admin.auditUpdated")}</th>
              <th className="px-3 py-2">{t("admin.auditOff")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-muted" colSpan={7}>
                  {t("admin.auditEmpty")}
                </td>
              </tr>
            ) : null}
            {entries.map((l) => {
              const details = parseDetails(l.details);
              const open = openId === l.id;
              return (
                <Fragment key={l.id}>
                  <tr className="border-t border-line">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatAuditTime(l.created_at)}</td>
                    <td className="px-3 py-2">{l.actor_email || "—"}</td>
                    <td className="px-3 py-2">{l.filename}</td>
                    <td className="px-3 py-2 tabular-nums">{l.products_added}</td>
                    <td className="px-3 py-2 tabular-nums">{l.products_changed ?? l.products_updated}</td>
                    <td className="px-3 py-2 tabular-nums">{l.products_deactivated ?? 0}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => setOpenId(open ? null : l.id)}
                      >
                        {open ? t("admin.auditClose") : t("admin.auditOpen")}
                      </button>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-t border-line bg-paper/60">
                      <td colSpan={7} className="px-4 py-4 text-xs">
                        <AuditDetailsBlock details={details} emptyLabel={t("admin.auditNoDiff")} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditDetailsBlock({ details, emptyLabel }: { details: AuditDetails; emptyLabel: string }) {
  const added = details.added ?? [];
  const changed = details.changed ?? [];
  const deactivated = details.deactivated ?? [];
  if (!added.length && !changed.length && !deactivated.length) {
    return <p className="text-muted">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-4">
      {added.length ? (
        <div>
          <p className="font-medium">Lisätyt ({added.length})</p>
          <ul className="mt-1 space-y-0.5">
            {added.map((r) => (
              <li key={r.sku}>
                <span className="font-mono">{r.sku}</span> {r.name} · saldo {r.stock} · {r.price} €
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {changed.length ? (
        <div>
          <p className="font-medium">Muuttuneet ({changed.length})</p>
          <ul className="mt-1 space-y-1">
            {changed.map((r) => (
              <li key={r.sku}>
                <span className="font-mono">{r.sku}</span> {r.name}
                <ul className="ml-4 text-muted">
                  {r.fields.map((f) => (
                    <li key={f.field}>
                      {f.field}: {f.from || "—"} → {f.to || "—"}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {deactivated.length ? (
        <div>
          <p className="font-medium">Piilotetut ({deactivated.length})</p>
          <ul className="mt-1 space-y-0.5">
            {deactivated.map((r) => (
              <li key={r.sku}>
                <span className="font-mono">{r.sku}</span> {r.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ImportAdmin() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const logs = useQuery({ queryKey: ["import-logs"], queryFn: () => listImportLogs() });
  const [deactivate, setDeactivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const res = await importInventory({
        data: { filename: file.name, base64: btoa(binary), deactivateMissing: deactivate },
      });
      toast.message(t("admin.imported", { u: res.updated, a: res.added }));
      void qc.invalidateQueries({ queryKey: ["admin-products"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["import-logs"] });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : t("auth.error");
      toast.message(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="max-w-2xl text-sm text-muted">{t("admin.importLead")}</p>
      <a href="/prego-stock-template.xls" className="mt-3 inline-block text-sm underline" download>
        {t("admin.template")}
      </a>
      <label
        className={`mt-6 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 text-sm ${over ? "border-ink bg-paper text-ink" : "border-line bg-surface text-muted"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void onFile(f);
        }}
      >
        {busy ? t("common.loading") : t("admin.drop")}
        <input
          type="file"
          accept=".xls,.xlsx,.csv,.xml,text/xml,application/xml,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
      </label>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} />
        {t("admin.deactivateMissing")}
      </label>
      <AuditLog entries={logs.data ?? []} />
    </div>
  );
}

function BehalfOrder() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ["admin-customers"], queryFn: () => listCustomers() });
  const products = useQuery({ queryKey: ["admin-products"], queryFn: () => adminListProducts() });
  const approved = (customers.data ?? []).filter((c) => c.role === "customer" || c.role === "admin");
  const [userId, setUserId] = useState("");
  const [lines, setLines] = useState<{ sku: string; qty: string }[]>([{ sku: "", qty: "1" }]);
  const [po, setPo] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [ship, setShip] = useState({
    deliveryName: "",
    deliveryAddress: "",
    deliveryPostal: "",
    deliveryCity: "",
    deliveryCountry: "FI",
  });

  function pickCustomer(id: string) {
    setUserId(id);
    const c = approved.find((x) => x.userId === id);
    if (!c) return;
    setShip({
      deliveryName: c.displayName || c.companyName,
      deliveryAddress: c.addressLine,
      deliveryPostal: c.postalCode,
      deliveryCity: c.city,
      deliveryCountry: c.country || "FI",
    });
  }

  async function send() {
    const clean = lines
      .map((l) => ({ sku: l.sku.trim().toUpperCase(), qty: Math.round(Number(l.qty)) }))
      .filter((l) => l.sku && l.qty > 0);
    if (!userId || !clean.length) {
      toast.message(t("auth.error"));
      return;
    }
    setBusy(true);
    try {
      const res = await submitOrder({
        data: {
          onBehalfUserId: userId,
          lines: clean,
          poNumber: po,
          notes,
          reverseCharge: false,
          ...ship,
        },
      });
      toast.message(t("admin.behalfDone", { n: res.orderNo }));
      setLines([{ sku: "", qty: "1" }]);
      setPo("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["admin-orders"] });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : t("auth.error");
      toast.message(msg);
    } finally {
      setBusy(false);
    }
  }

  const known = new Map((products.data ?? []).map((p) => [p.sku.toUpperCase(), p]));

  return (
    <div className="mb-8 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-lg font-medium">{t("admin.behalfTitle")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("admin.behalfLead")}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label={t("admin.behalfCustomer")}>
          <select
            className="h-11 w-full rounded-lg border border-line bg-paper px-3 text-sm"
            value={userId}
            onChange={(e) => pickCustomer(e.target.value)}
          >
            <option value="">—</option>
            {approved.map((c) => (
              <option key={c.userId} value={c.userId}>
                {(c.companyName || c.displayName || c.email) + " · " + c.email}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("checkout.po")}>
          <Input value={po} onChange={(e) => setPo(e.target.value)} />
        </Field>
        <Field label={t("account.name")}>
          <Input value={ship.deliveryName} onChange={(e) => setShip((s) => ({ ...s, deliveryName: e.target.value }))} />
        </Field>
        <Field label={t("account.address")}>
          <Input value={ship.deliveryAddress} onChange={(e) => setShip((s) => ({ ...s, deliveryAddress: e.target.value }))} />
        </Field>
        <Field label={t("account.postal")}>
          <Input value={ship.deliveryPostal} onChange={(e) => setShip((s) => ({ ...s, deliveryPostal: e.target.value }))} />
        </Field>
        <Field label={t("account.city")}>
          <Input value={ship.deliveryCity} onChange={(e) => setShip((s) => ({ ...s, deliveryCity: e.target.value }))} />
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        {lines.map((line, i) => {
          const product = known.get(line.sku.trim().toUpperCase());
          return (
            <div key={i} className="grid grid-cols-[1fr_6rem] gap-2">
              <Input
                placeholder={t("admin.behalfSku")}
                value={line.sku}
                onChange={(e) =>
                  setLines((rows) => rows.map((r, idx) => (idx === i ? { ...r, sku: e.target.value } : r)))
                }
              />
              <Input
                placeholder={t("admin.behalfQty")}
                inputMode="numeric"
                value={line.qty}
                onChange={(e) =>
                  setLines((rows) => rows.map((r, idx) => (idx === i ? { ...r, qty: e.target.value } : r)))
                }
              />
              {product ? (
                <p className="col-span-2 text-xs text-muted">
                  {product.nameFi} · {product.netPrice.toFixed(2)} € · saldo {product.stock}
                </p>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setLines((rows) => [...rows, { sku: "", qty: "1" }])}
        >
          {t("admin.behalfAdd")}
        </button>
      </div>
      <Field label={t("checkout.notes")}>
        <Textarea className="mt-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Button className="mt-4" disabled={busy} onClick={() => void send()}>
        {busy ? t("common.loading") : t("admin.behalfSubmit")}
      </Button>
    </div>
  );
}

function OrdersAdmin() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-orders"], queryFn: () => adminListOrders() });
  const orders = q.data ?? [];
  return (
    <div>
      <BehalfOrder />
      <p className="mb-4 text-sm text-muted">{t("orders.adminLead")}</p>
      <OrderList
        orders={orders}
        admin
        onStatus={(id, status) => {
          void setOrderStatus({ data: { id, status } }).then(() =>
            qc.invalidateQueries({ queryKey: ["admin-orders"] }),
          );
        }}
      />
    </div>
  );
}

function CustomersAdmin({ currentUserId }: { currentUserId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-customers"], queryFn: () => listCustomers() });
  const customers = [...(q.data ?? [])].sort((a, b) => {
    if (a.role === "pending" && b.role !== "pending") return -1;
    if (a.role !== "pending" && b.role === "pending") return 1;
    return a.companyName.localeCompare(b.companyName) || a.email.localeCompare(b.email);
  });
  return (
    <div>
      <p className="mb-4 text-sm text-muted">{t("admin.customersLead")}</p>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-3xl text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">{t("auth.email")}</th>
              <th className="px-3 py-2">{t("account.company")}</th>
              <th className="px-3 py-2">{t("account.vat")}</th>
              <th className="px-3 py-2">{t("account.phone")}</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-muted" colSpan={6}>
                  {t("admin.customersEmpty")}
                </td>
              </tr>
            ) : null}
            {customers.map((c) => (
              <tr key={c.userId} className="border-t border-line">
                <td className="px-3 py-2">
                  {c.email}
                  <span className="block text-xs text-muted">{c.displayName}</span>
                </td>
                <td className="px-3 py-2">{c.companyName || "—"}</td>
                <td className="px-3 py-2">{c.vatNumber || "—"}</td>
                <td className="px-3 py-2">{c.phone || "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
                      value={c.role}
                      onChange={(e) => {
                        const role = e.target.value as Profile["role"];
                        void setCustomerRole({ data: { userId: c.userId, role } })
                          .then((res) => {
                            qc.invalidateQueries({ queryKey: ["admin-customers"] });
                            if (c.role === "pending" && role !== "pending") {
                              toast.message(
                                res.mailed
                                  ? t("admin.approvedMail")
                                  : t("admin.approvedMailFail") + (res.mailError ? " " + res.mailError : ""),
                              );
                            }
                          })
                          .catch((err) => toast.message(err instanceof Error ? err.message : t("auth.error")));
                      }}
                    >
                      <option value="pending">{t("admin.role.pending")}</option>
                      <option value="customer">{t("admin.role.customer")}</option>
                      <option value="admin">{t("admin.role.admin")}</option>
                    </select>
                    {c.role === "pending" ? (
                      <button
                        type="button"
                        className="h-9 rounded-md bg-ink px-3 text-xs font-medium text-paper"
                        onClick={() => {
                          void setCustomerRole({ data: { userId: c.userId, role: "customer" } })
                            .then((res) => {
                              qc.invalidateQueries({ queryKey: ["admin-customers"] });
                              toast.message(
                                res.mailed
                                  ? t("admin.approvedMail")
                                  : t("admin.approvedMailFail") + (res.mailError ? " " + res.mailError : ""),
                              );
                            })
                            .catch((err) => toast.message(err instanceof Error ? err.message : t("auth.error")));
                        }}
                      >
                        {t("admin.approve")}
                      </button>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  {c.userId === currentUserId ? (
                    <span className="text-xs text-muted">{t("admin.you")}</span>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-accent hover:underline"
                      onClick={() => {
                        if (!window.confirm(t("admin.deleteUserConfirm", { n: c.email }))) return;
                        void deleteCustomer({ data: { userId: c.userId } })
                          .then(() => {
                            toast.message(t("admin.deleted"));
                            void qc.invalidateQueries({ queryKey: ["admin-customers"] });
                            void qc.invalidateQueries({ queryKey: ["admin-overview"] });
                          })
                          .catch((err) => toast.message(err instanceof Error ? err.message : t("admin.deleteFail")));
                      }}
                    >
                      {t("admin.remove")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsAdmin() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });
  const [form, setForm] = useState({ orderEmail: "", vatRate: "25.5", companyName: "" });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!q.data || ready) return;
    setForm({
      orderEmail: q.data.order_email ?? "",
      vatRate: q.data.vat_rate ?? "25.5",
      companyName: q.data.company_name ?? "",
    });
    setReady(true);
  }, [q.data, ready]);
  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void saveSettings({ data: form }).then(() => toast.message(t("account.saved")));
      }}
    >
      <Field label={t("admin.orderEmail")}>
        <Input value={form.orderEmail} onChange={(e) => setForm({ ...form, orderEmail: e.target.value })} />
        <p className="mt-1 text-xs text-muted">{t("admin.emailHint")}</p>
      </Field>
      <Field label={t("admin.vatRate")}>
        <Input value={form.vatRate} onChange={(e) => setForm({ ...form, vatRate: e.target.value })} />
      </Field>
      <Field label={t("account.company")}>
        <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
      </Field>
      <Button type="submit">{t("admin.save")}</Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          void saveSettings({ data: form })
            .then(() => sendTestEmail({ data: { to: form.orderEmail } }))
            .then((r) => toast.message(t("admin.emailTestOk", { n: r.to }) + " ← " + r.from))
            .catch((err) => toast.message(err instanceof Error ? err.message : t("admin.emailTestFail")));
        }}
      >
        {t("admin.emailTest")}
      </Button>
    </form>
  );
}

function ExportPanel() {
  const { t } = useI18n();
  const products = useQuery({ queryKey: ["admin-products"], queryFn: () => adminListProducts() });
  const customers = useQuery({ queryKey: ["admin-customers"], queryFn: () => listCustomers() });
  const orders = useQuery({ queryKey: ["admin-orders"], queryFn: () => adminListOrders() });
  return (
    <div className="mt-10 rounded-xl border border-line bg-surface p-5">
      <h2 className="text-lg font-medium">{t("admin.export")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("admin.exportLead")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={!products.data}
          onClick={() => products.data && exportProductsCsv(products.data)}
        >
          {t("admin.exportProducts")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!customers.data}
          onClick={() => customers.data && exportCustomersCsv(customers.data)}
        >
          {t("admin.exportCustomers")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!orders.data}
          onClick={() => orders.data && exportOrdersCsv(orders.data)}
        >
          {t("admin.exportOrders")}
        </Button>
      </div>
    </div>
  );
}

function exportProductsCsv(products: Product[]) {
  downloadCsv(
    `prego-tuotteet-${stamp()}.csv`,
    [
      "Tuote",
      "Kuvaus",
      "EAN",
      "Alaryhmä",
      "Myyntihinta",
      "Myyntiyks",
      "Vapaasaldo",
      "Tilattuna",
      "Varaukset",
      "Jälkitoimitus",
      "ETA",
      "Active",
    ],
    products.map((p) => [
      p.sku,
      p.nameFi,
      p.ean,
      `${p.categoryCode} ${p.categoryFi}`.trim(),
      p.netPrice.toFixed(2).replace(".", ","),
      p.cartonQty,
      p.stock,
      p.incoming,
      p.reserved,
      p.backorder,
      p.eta,
      p.active ? "1" : "0",
    ]),
  );
}

function exportCustomersCsv(customers: Profile[]) {
  downloadCsv(
    `prego-asiakkaat-${stamp()}.csv`,
    ["Email", "Nimi", "Yritys", "Y-tunnus", "Puhelin", "Osoite", "Postinumero", "Kaupunki", "Maa", "Rooli", "Luotu"],
    customers.map((c) => [
      c.email,
      c.displayName,
      c.companyName,
      c.vatNumber,
      c.phone,
      c.addressLine,
      c.postalCode,
      c.city,
      c.country,
      c.role,
      c.createdAt,
    ]),
  );
}

function exportOrdersCsv(orders: Order[]) {
  downloadCsv(
    `prego-tilaukset-${stamp()}.csv`,
    ["Tilausnro", "Pvm", "Tila", "Yritys", "Y-tunnus", "Email", "Veroton", "ALV", "Yhteensä", "Rivit"],
    orders.map((o) => [
      o.orderNo,
      o.createdAt,
      o.status,
      o.companyName,
      o.vatNumber,
      o.email,
      o.netTotal.toFixed(2).replace(".", ","),
      o.vatTotal.toFixed(2).replace(".", ","),
      o.grandTotal.toFixed(2).replace(".", ","),
      o.items.map((i) => `${i.sku}×${i.qty}`).join(" "),
    ]),
  );
}

