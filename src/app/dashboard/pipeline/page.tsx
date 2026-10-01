import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, ArrowRight, Briefcase, CalendarClock, CheckCircle2, Clock3, Inbox, Search, SlidersHorizontal, UserPlus } from "lucide-react";

import { asignarNegocio } from "@/app/actions/pipeline";
import { NuevoNegocio } from "@/components/nuevo-negocio";
import { VistaSegmentada } from "@/components/vista-segmentada";
import { moverEtapa } from "@/app/actions/ventas";
import { ActionForm, ActionSubmit, Avatar, Badge, Callout, EmptyState, Input, NavTabs, PageHeader, SectionCard, Select, SubmitButton } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { ZONA_CLINICA } from "@/lib/citas";
import { VENTAS_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { PESTANAS_VENTAS, VISTAS_NEGOCIOS } from "@/lib/ventas-pestanas";
import { createClient } from "@/lib/supabase/server";

/**
 * El pipeline comercial: cada negocio en su etapa, con responsable, monto,
 * origen y próxima acción a la vista. Solo negocios: quien abrió o hizo clic
 * en la campaña de correo es una señal y vive en la bandeja de Prospección,
 * hasta que alguien lo marca interesado. La lista es la otra vista de esta misma pestaña.
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

function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ q?: string; origen?: string; responsable?: string; vencidas?: string }> }) {
  await connection();
  const profile = await requireProfile(["admin", "supervisor"]);
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const voc = VENTAS_POR_EDICION[edicion];
  const mensual = voc.monto === "mensual";
  const { q = "", origen = "", responsable = "", vencidas = "" } = await searchParams;
  const ahora = new Date();

  const supabase = await createClient();
  const [{ data: etapasData }, { data: negociosData, error }, { data: personas }, { data: porContactar }, { data: cambios }] = await Promise.all([
    supabase.from("sales_stages").select("id, key, name, position, probability, is_won, is_lost").eq("active", true).order("position"),
    supabase
      .from("sales_opportunities")
      .select("id, name, status, monthly_amount, one_time_amount, next_action_at, next_action_note, stage_id, company_id, owner_id, source, created_at, updated_at, closed_at, sales_companies(name)")
      .order("next_action_at", { ascending: true, nullsFirst: false })
      .limit(1000),
    supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
    supabase.rpc("bandeja_de_prospeccion", { p_dias: 14 }),
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
  const prospectos = ((porContactar ?? []) as { clic: boolean; respondio: boolean; no_contactar: string | null }[]).filter((p) => !p.no_contactar);
  const calientes = prospectos.filter((p) => p.clic || p.respondio).length;

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
  const origenes = [...new Set(todos.map((negocio) => negocio.source ?? "manual"))];
  const diasEn = (negocio: Negocio) => Math.max(0, Math.floor((ahora.getTime() - new Date(ultimoCambio.get(negocio.id) ?? negocio.created_at).getTime()) / DIA));

  const Tarjeta = ({ negocio }: { negocio: Negocio }) => {
    const vencida = negocio.status === "abierta" && negocio.next_action_at && new Date(negocio.next_action_at) < ahora;
    const responsableNombre = negocio.owner_id ? nombres.get(negocio.owner_id) ?? "—" : null;
    const empresaNombre = primero(negocio.sales_companies)?.name ?? "—";
    const dias = diasEn(negocio);
    return (
      // La tarjeta del negocio, como en HubSpot o Pipedrive: quién es, cuánto
      // vale y a quién le toca. El color solo aparece si la próxima acción venció.
      <article className="rounded-lg border border-border bg-surface-solid p-3 shadow-sm transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md">
        <div className="flex items-start gap-2.5">
          <Avatar name={empresaNombre} shape="square" size="sm" />
          <div className="min-w-0 flex-1">
            <Link href={`/dashboard/ventas/${negocio.id}`} className="block truncate text-[13px] font-medium leading-tight text-foreground hover:text-primary" title={empresaNombre}>
              {empresaNombre}
            </Link>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={negocio.name}>{negocio.name}</p>
          </div>
        </div>

        <p className="mt-2.5 text-[15px] font-semibold tabular-nums tracking-tight text-foreground">
          {monto(negocio) > 0 ? (
            <>
              {pesos.format(monto(negocio))}
              {mensual && <span className="text-xs font-normal text-muted-foreground"> /mes</span>}
            </>
          ) : (
            <span className="text-xs font-normal text-muted-foreground">Monto por definir</span>
          )}
        </p>

        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <ActionForm action={asignarNegocio} success="Negocio asignado a ti" className="flex shrink-0 items-center">
            <input type="hidden" name="oportunidad_id" value={negocio.id} />
            {responsableNombre ? (
              <span title={`Responsable: ${responsableNombre}`} className="inline-flex">
                <Avatar name={responsableNombre} size="xs" />
              </span>
            ) : (
              <ActionSubmit size="sm" variant="ghost" pendingLabel="…">
                <UserPlus size={12} aria-hidden="true" /> Tomar
              </ActionSubmit>
            )}
          </ActionForm>
          <span className="truncate">{ORIGEN[negocio.source ?? "manual"] ?? negocio.source}</span>
          <span className="inline-flex shrink-0 items-center gap-1 tabular-nums" title="Días en esta etapa">
            <Clock3 size={11} aria-hidden="true" />
            {dias === 0 ? "Hoy" : `${dias} d`}
          </span>
          {negocio.next_action_at && (
            <span
              className={`ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums ${vencida ? "font-medium text-danger" : ""}`}
              title={negocio.next_action_note ?? "Próxima acción"}
            >
              {vencida ? <AlertTriangle size={11} aria-hidden="true" /> : <CalendarClock size={11} aria-hidden="true" />}
              {fecha.format(new Date(negocio.next_action_at))}
            </span>
          )}
        </div>

        {negocio.status === "abierta" && (
          <ActionForm action={moverEtapa} success="Negocio movido de etapa" className="mt-2.5 flex items-center gap-1 border-t border-border/70 pt-2.5">
            <input type="hidden" name="oportunidad_id" value={negocio.id} />
            <Select name="etapa" defaultValue={etapas.find((etapa) => etapa.id === negocio.stage_id)?.key ?? ""} aria-label="Mover a etapa" fieldSize="sm" className="min-w-0 flex-1">
              {/* Ganado y Perdido se cierran desde la ficha, con monto y motivo; no por un select. */}
              {etapas.filter((etapa) => !etapa.is_won && !etapa.is_lost).map((etapa) => (
                <option key={etapa.key} value={etapa.key}>{etapa.name}</option>
              ))}
            </Select>
            <ActionSubmit size="sm" variant="ghost" pendingLabel="…" aria-label="Mover a la etapa elegida"><ArrowRight size={13} aria-hidden="true" /></ActionSubmit>
          </ActionForm>
        )}
      </article>
    );
  };

  const montoAbierto = abiertos.reduce((total, negocio) => total + monto(negocio), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={voc.titulo}
        icon={Briefcase}
        description="Cada negocio en su etapa, con lo que vale y a quién le toca."
        meta={
          <>
            <span>{empresa ?? "Tu empresa"}</span>
            <span>
              <span className="font-medium text-foreground tabular-nums">{abiertos.length.toLocaleString("es-CL")}</span> {abiertos.length === 1 ? "negocio abierto" : "negocios abiertos"}
            </span>
            <span>
              <span className="font-medium text-foreground tabular-nums">{pesos.format(montoAbierto)}</span>{mensual ? " /mes" : ""} en juego
            </span>
          </>
        }
        actions={<NuevoNegocio voc={voc} />}
      />
      <NavTabs tabs={PESTANAS_VENTAS} />

      {prospectos.length > 0 && (
        <Link href="/dashboard/ventas/prospeccion" className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-sm transition-colors hover:border-border-strong">
          <span className="inline-flex min-w-0 items-center gap-3 text-foreground">
            <span className="icon-chip size-8 rounded-lg" data-tone="teal" aria-hidden="true">
              <Inbox size={15} />
            </span>
            <span className="min-w-0">
              <span className="block font-medium">
                {prospectos.length} {prospectos.length === 1 ? "persona espera" : "personas esperan"} que les escribas
              </span>
              {calientes > 0 && <span className="block text-xs text-muted-foreground">{calientes} muy {calientes === 1 ? "interesada" : "interesadas"}: hicieron clic o respondieron</span>}
            </span>
          </span>
          <span className="inline-flex flex-shrink-0 items-center gap-1 text-[13px] font-medium text-primary">
            Ver a quién <ArrowRight size={13} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}

      <form action="/dashboard/pipeline" className="flex flex-wrap items-center gap-2">
        <VistaSegmentada etiqueta="Ver negocios como" activa="tablero" opciones={VISTAS_NEGOCIOS} />
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input name="q" defaultValue={q} placeholder="Buscar empresa o negocio" className="pl-8" aria-label="Buscar" />
        </div>
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground hover:text-foreground">
          <input type="checkbox" name="vencidas" value="1" defaultChecked={Boolean(vencidas)} className="accent-primary" /> Solo atrasados
        </label>
        <details className="group relative" open={Boolean(origen || responsable) || undefined}>
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground hover:text-foreground">
            <SlidersHorizontal size={14} aria-hidden="true" />
            Más filtros
            {(origen || responsable) && (
              <span className="rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-foreground">{[origen, responsable].filter(Boolean).length}</span>
            )}
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
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
          </div>
        </details>
        <SubmitButton variant="secondary" size="sm" pendingLabel="…">Buscar</SubmitButton>
        {(q || origen || responsable || vencidas) && (
          <Link href="/dashboard/pipeline" className="text-[13px] font-medium text-muted-foreground hover:text-foreground">Limpiar</Link>
        )}
      </form>

      {error && <Callout tone="danger">No se pudieron leer los negocios. Vuelve a cargar para reintentar.</Callout>}

      {negocios.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={Briefcase}
            title={q || origen || responsable || vencidas ? "Ningún negocio con estos filtros" : "Todavía no hay negocios"}
            description={q || origen || responsable || vencidas ? "Prueba con otra búsqueda o limpia los filtros." : `Crea el primero con "${voc.nuevo}", marca "Interesado" a alguien en Por contactar o espera a que lleguen desde la web.`}
          />
        </SectionCard>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1 pb-2">
          <div className="flex w-max items-start gap-3">
            {etapas.filter((etapa) => !etapa.is_won && !etapa.is_lost).map((etapa) => {
              const propios = abiertos.filter((negocio) => negocio.stage_id === etapa.id);
              const total = propios.reduce((suma, negocio) => suma + monto(negocio), 0);
              return (
                // Carril sin borde, sobre un fondo apenas distinto: las tarjetas
                // blancas son lo que se lee, la columna solo las ordena.
                <section key={etapa.id} aria-label={etapa.name} className="flex w-72 flex-shrink-0 flex-col rounded-xl bg-surface-muted/70">
                  <header className="px-3 pb-2 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="truncate text-[13px] font-semibold text-foreground">{etapa.name}</h2>
                      <span className={`rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums ${propios.length > 0 ? "bg-surface text-foreground shadow-sm" : "bg-surface/60 text-muted-foreground"}`}>
                        {propios.length}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className={total > 0 ? "font-medium tabular-nums text-foreground" : "tabular-nums"}>{pesos.format(total)}</span>
                      {etapa.probability !== null ? ` · ${etapa.probability}% de cierre` : ""}
                    </p>
                  </header>
                  <div className="max-h-[65vh] space-y-2 overflow-y-auto px-2 pb-2">
                    {propios.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border-strong/60 px-3 py-5 text-center text-xs text-muted-foreground">Nada en esta etapa</p>
                    ) : (
                      propios.map((negocio) => <Tarjeta key={negocio.id} negocio={negocio} />)
                    )}
                  </div>
                </section>
              );
            })}

            <section aria-label="Cerrados en los últimos 30 días" className="flex w-72 flex-shrink-0 flex-col rounded-xl bg-surface-muted/40">
              <header className="px-3 pb-2 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    <CheckCircle2 size={14} className="text-muted-foreground" aria-hidden="true" />
                    Cerrados
                  </h2>
                  <span className="rounded-md bg-surface/60 px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted-foreground">{cerradosRecientes.length}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Últimos 30 días</p>
              </header>
              <div className="max-h-[65vh] space-y-2 overflow-y-auto px-2 pb-2">
                {cerradosRecientes.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border-strong/60 px-3 py-5 text-center text-xs text-muted-foreground">Nada cerrado este mes</p>
                ) : (
                  cerradosRecientes.map((negocio) => {
                    const empresaNombre = primero(negocio.sales_companies)?.name ?? "—";
                    return (
                      <Link key={negocio.id} href={`/dashboard/ventas/${negocio.id}`} className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md">
                        <Avatar name={empresaNombre} shape="square" size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-foreground">{empresaNombre}</span>
                          <span className="block truncate text-xs tabular-nums text-muted-foreground">{monto(negocio) > 0 ? pesos.format(monto(negocio)) : negocio.name}</span>
                        </span>
                        <Badge tone={negocio.status === "ganada" ? "success" : "danger"}>{negocio.status === "ganada" ? "Ganado" : "Perdido"}</Badge>
                      </Link>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
