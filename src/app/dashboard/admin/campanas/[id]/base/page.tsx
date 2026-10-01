import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Database, Inbox, PhoneOff, Upload } from "lucide-react";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";

export default async function CampaignBasePage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  /** Conteos con `head: true`: se cuenta en la base, no se traen filas. */
  const baseQuery = () =>
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id);

  const [total, pending, scheduled, withoutPhone, managed] = await Promise.all([
    baseQuery(),
    baseQuery().is("managed_at", null),
    baseQuery().not("next_action_at", "is", null),
    baseQuery().or("phone.is.null,phone.eq."),
    baseQuery().not("managed_at", "is", null),
  ]);

  const totalCount = total.count ?? 0;
  const share = (value: number) => (totalCount > 0 ? Math.round((value / totalCount) * 100) : 0);

  const pendingCount = pending.count ?? 0;
  const managedCount = managed.count ?? 0;
  const withoutPhoneCount = withoutPhone.count ?? 0;

  return (
    <div className="space-y-5">
      <KpiStrip
        title="Base de la campaña"
        meta={
          <Link
            href={`/dashboard/admin/cargas?campaign_id=${id}`}
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <Upload size={13} aria-hidden="true" />
            Cargar más registros
          </Link>
        }
      >
        <KpiStripItem
          label="Base total"
          icon={Database}
          value={totalCount.toLocaleString("es-CL")}
          detail="Ver registros"
          href={`/dashboard/leads?campaign=${id}`}
        />
        <KpiStripItem
          label="Sin gestionar"
          icon={Inbox}
          value={pendingCount.toLocaleString("es-CL")}
          detail={`${share(pendingCount)}% de la base`}
          progress={share(pendingCount)}
          href={`/dashboard/leads?campaign=${id}&view=disponibles`}
        />
        <KpiStripItem
          label="Gestionados"
          icon={CheckCircle2}
          tone="good"
          value={managedCount.toLocaleString("es-CL")}
          detail={`${share(managedCount)}% de la base`}
          progress={share(managedCount)}
          href={`/dashboard/leads?campaign=${id}&view=gestionados`}
        />
        <KpiStripItem
          label="Con agenda"
          icon={CalendarClock}
          value={(scheduled.count ?? 0).toLocaleString("es-CL")}
          detail="Ver agenda de hoy"
          href={`/dashboard/leads?campaign=${id}&view=hoy`}
        />
        <KpiStripItem
          label="Sin teléfono"
          icon={PhoneOff}
          tone={withoutPhoneCount > 0 ? "warn" : "default"}
          value={withoutPhoneCount.toLocaleString("es-CL")}
          detail="No se pueden marcar"
          href={`/dashboard/leads?campaign=${id}&view=bloqueados`}
        />
      </KpiStrip>
      <p className="text-xs text-muted-foreground">
        La carga masiva asigna automáticamente el flujo de gestión de esta campaña.
      </p>
    </div>
  );
}
