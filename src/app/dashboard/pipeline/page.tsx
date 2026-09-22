import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { AlertTriangle, ArrowRight, Search } from "lucide-react";

import { asignarNegocio, convertirLeadEnNegocio } from "@/app/actions/pipeline";
import { moverEtapa } from "@/app/actions/ventas";
import { Badge, EmptyState, Input, NavTabs, PageHeader, SectionCard, Select, SubmitButton, buttonClasses } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { ZONA_CLINICA } from "@/lib/citas";
import { VENTAS_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * El pipeline comercial: cada negocio en su etapa, con responsable, monto,
 * origen y próxima acción a la vista, y los prospectos de Atlas Lead en la
 * primera columna esperando convertirse en negocio. Es el puesto de trabajo
 * de quien vende; la lista de siempre queda en la pestaña de al lado.
 */

const DIA = 24 * 60 * 60 * 1000;
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short" });

const ORIGEN: Record<string, string> = { agenda_web: "Web", agente_calificador: "Calificador IA", atlas_lead: "Atlas Lead", manual: "Manual", whatsapp: "WhatsApp", correo: "Correo" };

type Negocio = {
  id: string; name: string; status: string; monthly_amount: number | null; one_time_amount: number | null; next_action_at: string | null; next_action_note: string | null;
  stage_id: string; company_id: string; owner_id: string | null; source: string | null; created_at: string; updated_at: string; closed_at: string | null;
  sales_companies: { name: string } | { name: string }[] | null;
};
type Etapa = { id: string; key: string; name: string; position: number; probability: number | null; is_won: boolean; is_lost: boolean };
type Prospecto = { id: string; full_name: string; email: string | null; phone: string | null; created_at: string; extra: Record<string, unknown> | null; campaigns: { name: string } | { name: string }[] | null };

function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}
function iniciales(nombre: string): string {
  return nombre.split(" ").filter(Boolean).slice(0, 2).map((parte) => parte[0]?.toUpperCase() ?? "").join("");
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ q?: string; origen?: string; responsable?: string; vencidas?: string }> }) {
  noStore();
  const profile = await requireProfile(["admin", "supervisor"]);
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const voc = VENTAS_POR_EDICION[edicion];
  const mensual = voc.monto === "mensual";
  const { q = "", origen = "", responsable = "", vencidas = "" } = await searchParams;
  const ahora = new Date();

  const supabase = await createClient();
  const [{ data: etapasData }, { data: negociosData, error }, { data: personas }, { data: prospectosData }, { data: cambios }] = await Promise.all([
    supabase.from("sales_stages").select("id, key, name, position, probability, is_won, is_lost").eq("active", true).order("position"),
    supabase
      .from("sales_opportunities")
      .select("id, name, status, monthly_amount, one_time_amount, next_action_at, next_action_note, stage_id, company_id, owner_id, source, created_at, updated_at, closed_at, sales_companies(name)")
      .order("next_action_at", { ascending: true, nullsFirst: false })
      .limit(1000),
    supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
    supabase.from("leads").select("id, full_name, email, phone, created_at, extra, campaigns!leads_campaign_id_fkey(name)").order("created_at", { ascending: false }).limit(300),
    supabase.from("sales_activities").select("opportunity_id, occurred_at").eq("kind", "etapa").order("occurred_at", { ascending: false }).limit(3000),
  ]);

  const etapas = (etapasData ?? []) as Etapa[];
  const todos = (negociosData ?? []) as unknown as Negocio[];
  const nombres = new Map((personas ?? []).map((persona) => [persona.id as string, persona.full_name as string]));
  const ultimoCambio = new Map<string, string>();
  for (const cambio of cambios ?? []) {
    const id = cambio.opportunity_id as string;
    if (id && !ultimoCambio.has(id)) ultimoCambio.set(id, cambio.occurred_at as string);
  }
  const { data: leadsConvertidos } = await supabase.from("sales_opportunities").select("lead_id").not("lead_id", "is", null).limit(2000);
  const convertidos = new Set((leadsConvertidos ?? []).map((fila) => fila.lead_id as string));
  const prospectos = ((prospectosData ?? []) as unknown as Prospecto[]).filter((lead) => !convertidos.has(lead.id));

  const termino = q.trim().toLowerCase();
  const negocios = todos.filter((negocio) => {
    if (origen && (negocio.source ?? "manual") !== origen) return false;
    if (responsable === "nadie" && negocio.owner_id) return false;
    if (responsable && responsable !== "nadie" && negocio.owner_id !== responsable) return false;
    if (vencidas && !(negocio.status === "abierta" && negocio.next_action_at && new Date(negocio.next_action_at) < ahora)) return false;
    if (termino) {
      const texto = `${negocio.name} ${primero(negocio.sales_companies)?.name ?? ""}`.toLowerCase();
      if (!texto.includes(termino)) return false;
    }
    return true;
  });
  const monto = (negocio: Negocio) => Number((mensual ? negocio.monthly_amount : negocio.one_time_amount) ?? 0);
  const abiertos = negocios.filter((negocio) => negocio.status === "abierta");
  const hace30 = ahora.getTime() - 30 * DIA;
  const cerradosRecientes = negocios.filter((negocio) => negocio.status !== "abierta" && negocio.closed_at && new Date(negocio.closed_at).getTime() >= hace30);
  const ponderado = abiertos.reduce((total, negocio) => total + monto(negocio) * ((etapas.find((etapa) => etapa.id === negocio.stage_id)?.probability ?? 0) / 100), 0);
  const origenes = [...new Set(todos.map((negocio) => negocio.source ?? "manual"))];
  const diasEn = (negocio: Negocio) => Math.max(0, Math.floor((ahora.getTime() - new Date(ultimoCambio.get(negocio.id) ?? negocio.created_at).getTime()) / DIA));

  const Tarjeta = ({ negocio }: { negocio: Negocio }) => {
    const vencida = negocio.status === "abierta" && negocio.next_action_at && new Date(negocio.next_action_at) < ahora;
    const responsableNombre = negocio.owner_id ? nombres.get(negocio.owner_id) ?? "—" : null;
    return (
      <div className={`rounded-lg border bg-surface p-2.5 text-xs shadow-sm ${vencida ? "border-danger/40" : "border-border"}`}>
        <div className="flex items-start justify-between gap-2">
          <Link href={`/dashboard/ventas/${negocio.id}`} className="min-w-0 font-medium text-foreground hover:text-primary hover:underline">
            <span className="block truncate">{primero(negocio.sales_companies)?.name ?? "—"}</span>
          </Link>
          <span className="flex-shrink-0 tabular-nums text-foreground">{monto(negocio) > 0 ? pesos.format(monto(negocio)) : ""}</span>
        </div>
        <p className="truncate text-muted-foreground">{negocio.name}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Badge tone="neutral">{ORIGEN[negocio.source ?? "manual"] ?? negocio.source}</Badge>
          <span className="text-[11px] text-muted-foreground">{diasEn(negocio)} d en etapa</span>
          {negocio.next_action_at && (
            <span className={`ml-auto inline-flex items-center gap-1 text-[11px] ${vencida ? "text-danger" : "text-muted-foreground"}`}>
              {vencida && <AlertTriangle size={11} aria-hidden="true" />} {fecha.format(new Date(negocio.next_action_at))}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <form action={asignarNegocio} className="flex items-center gap-1">
            <input type="hidden" name="oportunidad_id" value={negocio.id} />
            {responsableNombre ? (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/12 text-[10px] font-semibold text-primary" title={responsableNombre}>{iniciales(responsableNombre)}</span>
            ) : (
              <SubmitButton size="sm" variant="ghost" pendingLabel="…">Tomar</SubmitButton>
            )}
          </form>
          {negocio.status === "abierta" && (
            <form action={moverEtapa} className="ml-auto flex items-center gap-1">
              <input type="hidden" name="oportunidad_id" value={negocio.id} />
              <Select name="etapa" defaultValue={etapas.find((etapa) => etapa.id === negocio.stage_id)?.key ?? ""} aria-label="Mover a etapa" className="h-7 w-32 text-[11px]">
                {etapas.map((etapa) => (
                  <option key={etapa.key} value={etapa.key}>{etapa.name}</option>
                ))}
              </Select>
              <SubmitButton size="sm" variant="ghost" pendingLabel="…" aria-label="Mover"><ArrowRight size={12} aria-hidden="true" /></SubmitButton>
            </form>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipeline"
        description={`${empresa ?? voc.titulo} · ${abiertos.length} ${abiertos.length === 1 ? "negocio abierto" : "negocios abiertos"} · ${pesos.format(abiertos.reduce((total, negocio) => total + monto(negocio), 0))} en juego · ${pesos.format(ponderado)} ponderado por etapa`}
        actions={
          <Link href="/dashboard/ventas" className={buttonClasses()}>{voc.nuevo}</Link>
        }
      />
      <NavTabs tabs={[{ label: "Pipeline", href: "/dashboard/pipeline" }, { label: "Lista", href: "/dashboard/ventas" }, { label: "Respuestas del agente", href: "/dashboard/ventas/respuestas" }]} />

      <form action="/dashboard/pipeline" className="flex flex-wrap items-end gap-2">
        <div className="relative w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input name="q" defaultValue={q} placeholder="Empresa o negocio" className="pl-8" aria-label="Buscar" />
        </div>
        <Select name="origen" defaultValue={origen} aria-label="Origen" className="w-44">
          <option value="">Todos los orígenes</option>
          {origenes.map((valor) => (
            <option key={valor} value={valor}>{ORIGEN[valor] ?? valor}</option>
          ))}
        </Select>
        <Select name="responsable" defaultValue={responsable} aria-label="Responsable" className="w-44">
          <option value="">Cualquier responsable</option>
          <option value="nadie">Sin responsable</option>
          <option value={profile.id}>Míos</option>
          {(personas ?? []).filter((persona) => persona.id !== profile.id).map((persona) => (
            <option key={persona.id as string} value={persona.id as string}>{persona.full_name as string}</option>
          ))}
        </Select>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" name="vencidas" value="1" defaultChecked={Boolean(vencidas)} /> Solo vencidos
        </label>
        <SubmitButton variant="secondary" size="sm" pendingLabel="…">Filtrar</SubmitButton>
        {(q || origen || responsable || vencidas) && (
          <Link href="/dashboard/pipeline" className="text-sm text-primary hover:underline">Limpiar</Link>
        )}
      </form>

      {error && <p className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">No se pudieron leer los negocios. Vuelve a cargar para reintentar.</p>}

      <div className="overflow-x-auto pb-2">
        <div className="flex w-max gap-3">
          <div className="w-64 flex-shrink-0 rounded-xl border border-dashed border-border bg-surface-muted/30">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">Prospectos de Atlas Lead</p>
              <span className="text-xs text-muted-foreground">{prospectos.length}</span>
            </div>
            <div className="max-h-[65vh] space-y-2 overflow-y-auto p-2">
              {prospectos.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">Sin prospectos pendientes.</p>
              ) : (
                prospectos.slice(0, 60).map((lead) => (
                  <div key={lead.id} className="rounded-lg border border-border bg-surface p-2.5 text-xs">
                    <p className="truncate font-medium text-foreground">{String((lead.extra as Record<string, unknown> | null)?.company ?? lead.full_name)}</p>
                    <p className="truncate text-muted-foreground">{lead.full_name} · {lead.email ?? lead.phone ?? "sin contacto"}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{primero(lead.campaigns)?.name ?? "Atlas Lead"} · {fecha.format(new Date(lead.created_at))}</p>
                    <form action={convertirLeadEnNegocio} className="mt-2">
                      <input type="hidden" name="lead_id" value={lead.id} />
                      <SubmitButton size="sm" variant="secondary" pendingLabel="…">Convertir en negocio</SubmitButton>
                    </form>
                  </div>
                ))
              )}
            </div>
          </div>

          {etapas.filter((etapa) => !etapa.is_won && !etapa.is_lost).map((etapa) => {
            const propios = abiertos.filter((negocio) => negocio.stage_id === etapa.id);
            return (
              <div key={etapa.id} className="w-64 flex-shrink-0 rounded-xl border border-border bg-surface">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{etapa.name}</p>
                    <p className="text-[11px] text-muted-foreground">{pesos.format(propios.reduce((total, negocio) => total + monto(negocio), 0))}{etapa.probability !== null ? ` · ${etapa.probability}%` : ""}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{propios.length}</span>
                </div>
                <div className="max-h-[65vh] space-y-2 overflow-y-auto p-2">
                  {propios.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">Nada en esta etapa.</p> : propios.map((negocio) => <Tarjeta key={negocio.id} negocio={negocio} />)}
                </div>
              </div>
            );
          })}

          <div className="w-64 flex-shrink-0 rounded-xl border border-border bg-surface-muted/30">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">Cerrados · 30 días</p>
              <span className="text-xs text-muted-foreground">{cerradosRecientes.length}</span>
            </div>
            <div className="max-h-[65vh] space-y-2 overflow-y-auto p-2">
              {cerradosRecientes.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">Nada cerrado este mes.</p> : cerradosRecientes.map((negocio) => (
                <div key={negocio.id} className="rounded-lg border border-border bg-surface p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/dashboard/ventas/${negocio.id}`} className="truncate font-medium text-foreground hover:text-primary hover:underline">{primero(negocio.sales_companies)?.name ?? "—"}</Link>
                    <Badge tone={negocio.status === "ganada" ? "success" : "danger"}>{negocio.status === "ganada" ? "Ganado" : "Perdido"}</Badge>
                  </div>
                  <p className="text-muted-foreground">{monto(negocio) > 0 ? pesos.format(monto(negocio)) : negocio.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {negocios.length === 0 && prospectos.length === 0 && (
        <SectionCard title="Sin negocios">
          <EmptyState title="Todavía no hay negocios" description={`Crea el primero con "${voc.nuevo}" o espera a que lleguen desde la web.`} />
        </SectionCard>
      )}
    </div>
  );
}
