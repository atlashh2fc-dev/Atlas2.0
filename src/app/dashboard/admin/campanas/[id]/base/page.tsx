import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Upload } from "lucide-react";
import { MetricCard, SectionCard, buttonClasses } from "@/components/ui";

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

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Base total"
          value={totalCount.toLocaleString("es-CL")}
          href={`/dashboard/leads?campaign=${id}`}
          hrefLabel="Ver registros"
        />
        <MetricCard
          label="Sin gestionar"
          value={(pending.count ?? 0).toLocaleString("es-CL")}
          hint={`${share(pending.count ?? 0)}% de la base`}
          href={`/dashboard/leads?campaign=${id}&view=disponibles`}
          hrefLabel="Ver disponibles"
          progress={share(pending.count ?? 0)}
        />
        <MetricCard
          label="Gestionados"
          value={(managed.count ?? 0).toLocaleString("es-CL")}
          hint={`${share(managed.count ?? 0)}% de la base`}
          href={`/dashboard/leads?campaign=${id}&view=gestionados`}
          hrefLabel="Ver gestionados"
          tone="good"
          progress={share(managed.count ?? 0)}
        />
        <MetricCard
          label="Con agenda"
          value={(scheduled.count ?? 0).toLocaleString("es-CL")}
          href={`/dashboard/leads?campaign=${id}&view=hoy`}
          hrefLabel="Ver agenda de hoy"
        />
        <MetricCard
          label="Sin teléfono"
          value={(withoutPhone.count ?? 0).toLocaleString("es-CL")}
          hint="No se pueden marcar"
          href={`/dashboard/leads?campaign=${id}&view=bloqueados`}
          hrefLabel="Ver bloqueados"
          tone={(withoutPhone.count ?? 0) > 0 ? "warn" : "good"}
        />
      </div>

      <SectionCard
        title="Cargar más registros"
        description="La carga masiva asigna automáticamente el flujo de gestión de esta campaña."
      >
        <div className="p-4">
          <Link href={`/dashboard/admin/cargas?campaign_id=${id}`} className={buttonClasses()}>
            <Upload size={16} aria-hidden="true" />
            Ir a cargas y listas
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
