import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { setCampaignWorkflow } from "@/app/actions/campaigns";
import { CampaignDashboardSummary } from "@/components/campaign-dashboard-summary";
import type {
  CampaignDashboardSummary as CampaignDashboardSummaryData,
  DialerCampaignConfig,
} from "@/lib/types";
import { Button, Card, Field, SectionCard, Select } from "@/components/ui";

const DASHBOARD_WINDOW_DAYS = 30;

function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function addDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

export default async function CampaignSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", id).single();
  if (!campaign) notFound();

  const to = endOfDay(new Date());
  const from = startOfDay(addDays(to, -(DASHBOARD_WINDOW_DAYS - 1)));
  const previousFrom = startOfDay(addDays(from, -DASHBOARD_WINDOW_DAYS));
  const previousTo = new Date(from.getTime() - 1);

  const [
    { data: summary, error: summaryError },
    { count: leadCount },
    { count: memberCount },
    { data: dialerConfig },
    { data: workflows },
  ] = await Promise.all([
    supabase.rpc("get_campaign_dashboard_summary", {
      p_campaign_id: id,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_previous_from: previousFrom.toISOString(),
      p_previous_to: previousTo.toISOString(),
    }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase.from("campaign_agents").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase.from("dialer_campaign_configs").select("*").eq("campaign_id", id).maybeSingle(),
    // Solo flujos publicados: un borrador no debería quedar operando una campaña.
    supabase.from("workflows").select("id, name").eq("status", "published").order("name"),
  ]);

  const dialer = dialerConfig as DialerCampaignConfig | null;
  const usesSiptel = dialer?.trunk_context === "siptel";
  const base = `/dashboard/admin/campanas/${id}`;

  const setupItems = [
    {
      label: "Flujo de gestión",
      detail: campaign.workflow_id ? "Asignado" : "Asigna el guion que verán los ejecutivos",
      done: Boolean(campaign.workflow_id),
      href: `${base}#flujo`,
    },
    {
      label: "Ejecutivos",
      detail: (memberCount ?? 0) > 0 ? `${memberCount} asignados` : "Asigna al menos un ejecutivo",
      done: (memberCount ?? 0) > 0,
      href: `${base}/ejecutivos`,
    },
    {
      label: "Base de registros",
      detail:
        (leadCount ?? 0) > 0
          ? `${(leadCount ?? 0).toLocaleString("es-CL")} registros`
          : "Carga la base de la campaña",
      done: (leadCount ?? 0) > 0,
      href: `${base}/base`,
    },
    {
      label: "Discador",
      detail: dialer
        ? !usesSiptel
          ? "Revisa la ruta saliente: solo Siptel está habilitado"
          : dialer.is_active
            ? "Configurado y activo"
            : "Configurado, falta iniciarlo"
        : "Configura la cola y el modo de discado",
      done: Boolean(dialer?.is_active && usesSiptel),
      href: `${base}/discado`,
    },
  ];
  const pending = setupItems.filter((item) => !item.done).length;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Preparación de la campaña"
        description="Estos cuatro puntos definen si la campaña puede operar."
        actions={
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              pending === 0 ? "bg-success-bg text-success" : "bg-warning-bg text-warning"
            }`}
          >
            {pending === 0 ? "Lista para operar" : `${pending} pendiente${pending === 1 ? "" : "s"}`}
          </span>
        }
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {setupItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary"
            >
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  item.done ? "bg-success-bg text-success" : "bg-warning-bg text-warning"
                }`}
              >
                {item.done ? "Listo" : "Pendiente"}
              </span>
              <p className="mt-2 text-sm font-medium text-foreground">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
            </Link>
          ))}
        </div>
      </SectionCard>

      <div id="flujo" />
      <SectionCard
        title="Flujo de gestión"
        description="Es el guion que los ejecutivos siguen al atender los registros de esta campaña."
      >
        <form action={setCampaignWorkflow} className="flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="campaign_id" value={id} />
          <Field label="Flujo asignado" className="w-72">
            <Select name="workflow_id" defaultValue={campaign.workflow_id ?? ""}>
              <option value="">Sin flujo asignado</option>
              {(workflows ?? []).map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Guardar</Button>
          <Link
            href={`/dashboard/admin/flujos?campaign_id=${id}`}
            className="pb-2 text-xs font-medium text-primary hover:underline"
          >
            Editar o crear un flujo
          </Link>
        </form>
      </SectionCard>

      {summaryError ? (
        <Card className="text-sm text-danger">No se pudo cargar el resumen: {summaryError.message}</Card>
      ) : (
        <CampaignDashboardSummary summary={summary as CampaignDashboardSummaryData} />
      )}
    </div>
  );
}
