import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/pending")({ component: PendingPage });

export function PendingNotice() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">{t("pending.kicker")}</p>
      <h1 className="mt-2 text-2xl font-medium tracking-tight">{t("pending.title")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">{t("pending.lead")}</p>
      <p className="mt-3 text-sm leading-relaxed text-ink">{t("pending.urgent")}</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link to="/catalog">
          <Button variant="secondary">{t("nav.catalog")}</Button>
        </Link>
        <Link to="/contact">
          <Button>{t("nav.contact")}</Button>
        </Link>
      </div>
    </div>
  );
}

function PendingPage() {
  return (
    <Shell>
      <PendingNotice />
    </Shell>
  );
}
