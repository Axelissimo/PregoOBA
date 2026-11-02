import { useState } from "react";
import { ChevronDown, FileDown } from "lucide-react";
import { Button } from "@/components/ui";
import { formatEur } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { Order } from "@/lib/types";

const STATUSES = ["submitted", "confirmed", "processing", "shipped", "cancelled"] as const;

export function OrderList({
  orders,
  admin,
  onStatus,
}: {
  orders: Order[];
  admin?: boolean;
  onStatus?: (id: number, status: string) => void;
}) {
  const { t, lang } = useI18n();
  const [openId, setOpenId] = useState<number | null>(orders[0]?.id ?? null);
  const [busyId, setBusyId] = useState<number | null>(null);

  if (!orders.length) {
    return <p className="text-sm text-muted">{t("orders.empty")}</p>;
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {orders.map((o) => {
        const open = openId === o.id;
        return (
          <li key={o.id}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => setOpenId(open ? null : o.id)}
                aria-expanded={open}
              >
                <ChevronDown className={`size-4 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} />
                <span className="min-w-0">
                  <span className="block font-medium">{o.orderNo}</span>
                  <span className="block truncate text-xs text-muted">
                    {o.createdAt.slice(0, 10)}
                    {admin && o.companyName ? ` · ${o.companyName}` : ""}
                    {o.onBehalf ? ` · ${t("order.onBehalf")}` : ""}
                    {" · "}
                    {t(`orders.status.${o.status}`)}
                    {" · "}
                    {o.items.length} {t("product.pcs")}
                  </span>
                </span>
              </button>
              <p className="tabular-nums text-sm font-medium">{formatEur(o.grandTotal, lang)}</p>
              {admin && onStatus ? (
                <select
                  className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
                  value={o.status}
                  onChange={(e) => onStatus(o.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`orders.status.${s}`)}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busyId === o.id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setBusyId(o.id);
                  void import("@/lib/order-pdf")
                    .then((m) => m.downloadOrderPdf(o))
                    .finally(() => setBusyId(null));
                }}
              >
                <FileDown className="size-4" />
                PDF
              </Button>
            </div>
            {open ? (
              <div className="border-t border-line bg-paper px-4 py-4">
                <p className="text-sm">
                  <span className="font-medium">{o.companyName}</span>
                  {o.email ? <span className="text-muted"> · {o.email}</span> : null}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {o.deliveryName}, {o.deliveryAddress}, {o.deliveryPostal} {o.deliveryCity}, {o.deliveryCountry}
                </p>
                {o.poNumber ? (
                  <p className="mt-1 text-xs text-muted">
                    {t("checkout.po")}: {o.poNumber}
                  </p>
                ) : null}
                {o.onBehalf ? (
                  <p className="mt-2 text-sm font-medium text-accent">
                    {t("order.onBehalf")}
                    {o.placedByName || o.placedByEmail
                      ? ` — ${[o.placedByName, o.placedByEmail].filter(Boolean).join(" · ")}`
                      : ""}
                  </p>
                ) : null}
                {o.notes ? <p className="mt-2 whitespace-pre-wrap text-sm">{o.notes}</p> : null}
                <table className="mt-4 w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th className="py-1">{t("product.sku")}</th>
                      <th className="py-1">{t("catalog.sortName")}</th>
                      <th className="py-1">{t("product.pcs")}</th>
                      <th className="py-1 text-right">{t("product.net")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.items.map((i) => (
                      <tr key={i.id} className="border-t border-line">
                        <td className="py-1.5 font-mono text-xs">{i.sku}</td>
                        <td className="py-1.5">
                          {i.name}
                          {i.preorder ? (
                            <span className="ml-2 text-xs font-semibold uppercase text-accent">{t("order.preorder")}</span>
                          ) : null}
                        </td>
                        <td className="py-1.5 tabular-nums">{i.qty}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatEur(i.lineTotal, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className="mt-3 space-y-0.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("cart.subtotal")}</dt>
                    <dd className="tabular-nums">{formatEur(o.netTotal, lang)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("checkout.vat", { n: o.vatRate })}</dt>
                    <dd className="tabular-nums">{formatEur(o.vatTotal, lang)}</dd>
                  </div>
                  <div className="flex justify-between font-medium">
                    <dt>{t("checkout.total")}</dt>
                    <dd className="tabular-nums">{formatEur(o.grandTotal, lang)}</dd>
                  </div>
                </dl>
                {o.items.some((i) => i.preorder) ? (
                  <p className="mt-3 text-sm text-muted">{t("order.partialShip")}</p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
