import Link from "next/link";
import { connection } from "next/server";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock3,
  FileText,
  Handshake,
  Inbox,
  MessageCircle,
  Repeat2,
  Search,
  SlidersHorizontal,
  Stethoscope,
  UserPlus,
  XCircle,
} from "lucide-react";
import type { ComponentType } from "react";

import { asignarNegocio } from "@/app/actions/pipeline";
import { NuevoNegocio } from "@/components/nuevo-negocio";
import { Columna, MarcaIA, Tablero, TarjetaConversacion, masReciente, recortar, textoDeMensaje, tiempoRelativo, type Canal, type Tono, type UltimaLinea } from "@/components/pipeline-kit";
import { VistaSegmentada } from "@/components/vista-segmentada";
import { moverEtapa } from "@/app/actions/ventas";
import { ActionForm, ActionSubmit, Avatar, Callout, EmptyState, Input, NavTabs, PageHeader, SectionCard, Select, SubmitButton } from "@/components/ui";
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
 *
 * Cada tarjeta es una conversación, como en Vambe: la última línea de lo que
 * se habló (gestión, WhatsApp o correo, la más reciente) y si la IA fue la
 * última en responder.
 */

const DIA = 24 * 60 * 60 * 1000;
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short" });

const ORIGEN: Record<string, string> = { agenda_web: "Web", agente_calificador: "Calificador IA", atlas_lead: "Atlas Lead", manual: "Manual", whatsapp: "WhatsApp", correo: "Correo" };

type Negocio = {
  id: string; name: string; status: string; monthly_amount: number | null; one_time_amount: number | null; next_action_at: string | null; next_action_note: string | null;
  stage_id: string; company_id: string; owner_id: string | null; source: string | null; created_at: string; updated_at: string; closed_at: string | null;
  lead_id: string | null;
  sales_companies: { name: string } | { name: string }[] | null;
};
type Etapa = { id: string; key: string; name: string; position: number; probability: number | null; is_won: boolean; is_lost: boolean };

/** La última gestión de cada negocio, traída en la misma consulta (una por negocio, por índice). */
type ConActividad = { id: string; sales_activities: { kind: string; subject: string | null; body: string | null; occurred_at: string; agente: string | null }[] | null };
type ConversacionWa = {
  lead_id: string;
  canal: string | null;
  whatsapp_messages: { id: string; direction: string; text_body: string | null; message_type: string | null; created_at: string }[] | null;
  whatsapp_ai_runs: { outbound_message_id: string | null }[] | null;
};

function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

/** Cada etapa con su tono e icono; las que no se conocen toman uno según su posición. */
const ETAPA_VISUAL: Record<string, { tono: Tono; icono: ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }> }> = {
  prospecto: { tono: "slate", icono: CircleDashed },
  contactado: { tono: "blue", icono: MessageCircle },
  reunion: { tono: "violet", icono: CalendarCheck },
  evaluacion: { tono: "teal", icono: Stethoscope },
  propuesta: { tono: "amber", icono: FileText },
  presupuesto_enviado: { tono: "amber", icono: FileText },
  seguimiento: { tono: "indigo", icono: Repeat2 },
  negociacion: { tono: "orange", icono: Handshake },
};
const TONOS_DE_RESPALDO: Tono[] = ["blue", "violet", "amber", "teal", "orange", "indigo", "cyan", "pink"];

const CANAL_DE_ACTIVIDAD: Record<string, Canal> = { llamada: "llamada", correo: "correo", whatsapp: "whatsapp", reunion: "reunion", nota: "nota", tarea: "tarea" };
const PREFIJO_DE_ACTIVIDAD: Record<string, string> = { llamada: "Llamada", reunion: "Reunión", nota: "Nota", tarea: "Tarea", correo: "Equipo", whatsapp: "Equipo" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ q?: string; origen?: string; responsable?: string; vencidas?: string }> }) {
  await connection();
  const profile = await requireProfile(["admin", "supervisor"]);
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const voc = VENTAS_POR_EDICION[edicion];
  const mensual = voc.monto === "mensual";
  const { q = "", origen = "", responsable = "", vencidas = "" } = await searchParams;
  const ahora = new Date();

  const supabase = await createClient();
  const [
    { data: etapasData },
    { data: negociosData, error },
    { data: personas },
    { data: porContactar },
    { data: cambios },
    { data: actividadesData, error: errorActividades },
    { data: whatsappData, error: errorWhatsapp },
    { data: prospeccionWaData },
    { data: correosData },
  ] = await Promise.all([
    supabase.from("sales_stages").select("id, key, name, position, probability, is_won, is_lost").eq("active", true).order("position"),
    supabase
      .from("sales_opportunities")
      .select("id, name, status, monthly_amount, one_time_amount, next_action_at, next_action_note, stage_id, company_id, owner_id, source, created_at, updated_at, closed_at, lead_id, sales_companies(name)")
      .order("next_action_at", { ascending: true, nullsFirst: false })
      .limit(1000),
    supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
    supabase.rpc("bandeja_de_prospeccion", { p_dias: 14 }),
    supabase.from("sales_activities").select("opportunity_id, occurred_at").eq("kind", "etapa").order("occurred_at", { ascending: false }).limit(3000),
    // La última línea de cada tarjeta. Consultas de solo lectura y aparte de la
    // principal: si alguna falla, el tablero se ve igual, solo sin esa línea.
    // La última gestión sale por negocio (índice opportunity_id, occurred_at),
    // con el mismo orden y tope que la consulta de arriba.
    supabase
      .from("sales_opportunities")
      .select("id, sales_activities(kind, subject, body, occurred_at, agente:metadata->>agente)")
      .neq("sales_activities.kind", "etapa")
      .order("next_action_at", { ascending: true, nullsFirst: false })
      .order("occurred_at", { referencedTable: "sales_activities", ascending: false })
      .limit(1, { referencedTable: "sales_activities" })
      .limit(1000),
    // WhatsApp (y sus primos de Meta): el último mensaje de cada conversación
    // y la última respuesta de la IA, para saber si fue ella la que habló.
    supabase
      .from("whatsapp_conversations")
      .select("lead_id, canal, whatsapp_messages(id, direction, text_body, message_type, created_at), whatsapp_ai_runs(outbound_message_id)")
      .order("last_message_at", { ascending: false })
      .order("created_at", { referencedTable: "whatsapp_messages", ascending: false })
      .limit(1, { referencedTable: "whatsapp_messages" })
      .order("started_at", { referencedTable: "whatsapp_ai_runs", ascending: false })
      .limit(1, { referencedTable: "whatsapp_ai_runs" })
      .limit(400),
    // Lo que se habló por WhatsApp cuando era prospecto de la campaña.
    supabase.from("prospeccion_whatsapp").select("lead_id, direction, texto, occurred_at").order("occurred_at", { ascending: false }).limit(800),
    // Correos que llegaron de la empresa del negocio.
    supabase.from("inbound_emails").select("company_id, subject, preview, received_at").not("company_id", "is", null).order("received_at", { ascending: false }).limit(300),
  ]);
  if (errorActividades) console.error("[pipeline] última gestión:", errorActividades.message);
  if (errorWhatsapp) console.error("[pipeline] último WhatsApp:", errorWhatsapp.message);

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

  // Las fuentes de la última línea, cada una indexada por lo que la une al negocio.
  const porActividad = new Map<string, UltimaLinea>();
  for (const fila of (actividadesData ?? []) as unknown as ConActividad[]) {
    const actividad = primero(fila.sales_activities);
    if (!actividad) continue;
    const ia = Boolean(actividad.agente) && (actividad.kind === "correo" || actividad.kind === "whatsapp");
    const conAsunto = ["llamada", "reunion", "nota", "tarea"].includes(actividad.kind) && actividad.subject && actividad.body;
    const texto = conAsunto ? `${actividad.subject}. ${recortar(actividad.body)}` : recortar(actividad.body) || recortar(actividad.subject);
    if (!texto) continue;
    porActividad.set(fila.id, {
      texto: recortar(texto),
      canal: CANAL_DE_ACTIVIDAD[actividad.kind] ?? "nota",
      at: actividad.occurred_at,
      prefijo: ia ? "IA" : PREFIJO_DE_ACTIVIDAD[actividad.kind] ?? null,
      ia,
    });
  }
  const porLead = new Map<string, UltimaLinea>();
  for (const conversacion of (whatsappData ?? []) as unknown as ConversacionWa[]) {
    const mensaje = primero(conversacion.whatsapp_messages);
    if (!mensaje || porLead.has(conversacion.lead_id)) continue;
    const ia = mensaje.direction === "outbound" && primero(conversacion.whatsapp_ai_runs)?.outbound_message_id === mensaje.id;
    const canal: Canal = conversacion.canal === "instagram" ? "instagram" : conversacion.canal === "messenger" ? "messenger" : "whatsapp";
    porLead.set(conversacion.lead_id, {
      texto: textoDeMensaje(mensaje.text_body, mensaje.message_type),
      canal,
      at: mensaje.created_at,
      prefijo: mensaje.direction === "inbound" ? null : ia ? "IA" : "Equipo",
      ia,
    });
  }
  const porLeadProspeccion = new Map<string, UltimaLinea>();
  for (const mensaje of prospeccionWaData ?? []) {
    const lead = mensaje.lead_id as string;
    if (porLeadProspeccion.has(lead) || !mensaje.texto) continue;
    porLeadProspeccion.set(lead, { texto: recortar(mensaje.texto as string), canal: "whatsapp", at: mensaje.occurred_at as string, prefijo: mensaje.direction === "inbound" ? null : "Equipo" });
  }
  const porEmpresa = new Map<string, UltimaLinea>();
  for (const correo of correosData ?? []) {
    const empresaId = correo.company_id as string;
    if (porEmpresa.has(empresaId)) continue;
    const texto = recortar(correo.preview as string | null) || recortar(correo.subject as string | null);
    if (texto) porEmpresa.set(empresaId, { texto, canal: "correo", at: correo.received_at as string });
  }
  const ultimaLinea = (negocio: Negocio): UltimaLinea | null =>
    masReciente(
      porActividad.get(negocio.id),
      negocio.lead_id ? porLead.get(negocio.lead_id) : null,
      negocio.lead_id ? porLeadProspeccion.get(negocio.lead_id) : null,
      porEmpresa.get(negocio.company_id),
    );

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
  const etapasAbiertas = etapas.filter((etapa) => !etapa.is_won && !etapa.is_lost);

  const Tarjeta = ({ negocio }: { negocio: Negocio }) => {
    const vencida = negocio.status === "abierta" && negocio.next_action_at && new Date(negocio.next_action_at) < ahora;
    const responsableNombre = negocio.owner_id ? nombres.get(negocio.owner_id) ?? "—" : null;
    const empresaNombre = primero(negocio.sales_companies)?.name ?? "—";
    const dias = diasEn(negocio);
    const linea = ultimaLinea(negocio);
    // Sin conversación todavía, la línea es lo que toca hacer: algo que leer, no un hueco.
    const lineaVisible: UltimaLinea | null = linea ?? (negocio.next_action_note ? { texto: recortar(negocio.next_action_note), canal: "tarea", at: negocio.updated_at, prefijo: "Próximo paso" } : null);
    const canalOrigen: Canal | null = negocio.source === "whatsapp" ? "whatsapp" : negocio.source === "correo" ? "correo" : null;
    const valor = monto(negocio);
    return (
      // La tarjeta es la conversación: quién es, qué se dijo al último y
      // cuánto vale. Toda la tarjeta abre la ficha; los controles van encima.
      <TarjetaConversacion
        href={`/dashboard/ventas/${negocio.id}`}
        nombre={empresaNombre}
        subtitulo={<span title={negocio.name}>{negocio.name} · {ORIGEN[negocio.source ?? "manual"] ?? negocio.source}</span>}
        canal={linea?.canal ?? canalOrigen}
        hace={tiempoRelativo(linea?.at ?? negocio.updated_at, ahora)}
        linea={lineaVisible}
      >
        {!lineaVisible && <p className="mt-2 text-[12.5px] italic text-muted-foreground/80">Sin mensajes todavía</p>}

        <div className="mt-2.5 flex items-center gap-2">
          <p className="min-w-0 truncate text-[14px] font-semibold tabular-nums tracking-tight text-foreground">
            {valor > 0 ? (
              <>
                {pesos.format(valor)}
                {mensual && <span className="text-xs font-normal text-muted-foreground"> /mes</span>}
              </>
            ) : (
              <span className="text-xs font-normal text-muted-foreground">Monto por definir</span>
            )}
          </p>
          {linea?.ia && <MarcaIA />}
          <span className="ml-auto flex flex-shrink-0 items-center gap-2">
            {negocio.next_action_at && (
              <span
                className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${vencida ? "font-semibold text-danger" : "text-muted-foreground"}`}
                title={`${vencida ? "Atrasado · " : ""}${negocio.next_action_note ?? "Próxima acción"}`}
              >
                {vencida ? <AlertTriangle size={11} aria-hidden="true" /> : <CalendarClock size={11} aria-hidden="true" />}
                {fecha.format(new Date(negocio.next_action_at)).replace(".", "")}
              </span>
            )}
            <ActionForm action={asignarNegocio} success="Negocio asignado a ti" className="relative z-10 flex items-center">
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
          </span>
        </div>

        {negocio.status === "abierta" && (
          <ActionForm action={moverEtapa} success="Negocio movido de etapa" className="relative z-10 mt-2.5 flex items-center gap-1.5 border-t border-border/60 pt-2">
            <input type="hidden" name="oportunidad_id" value={negocio.id} />
            <span className="inline-flex flex-shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground" title="Días en esta etapa">
              <Clock3 size={11} aria-hidden="true" />
              {dias === 0 ? "Hoy" : `${dias} d`}
            </span>
            {/* Mover sin abrir la ficha: un select callado, no una caja más en la tarjeta. */}
            <select
              name="etapa"
              defaultValue={etapas.find((etapa) => etapa.id === negocio.stage_id)?.key ?? ""}
              aria-label="Mover a etapa"
              className="h-8 min-w-0 flex-1 cursor-pointer truncate rounded-md border-0 bg-transparent px-1.5 text-right text-xs text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Ganado y Perdido se cierran desde la ficha, con monto y motivo; no por un select. */}
              {etapasAbiertas.map((etapa) => (
                <option key={etapa.key} value={etapa.key}>{etapa.name}</option>
              ))}
            </select>
            <ActionSubmit size="sm" variant="ghost" pendingLabel="…" aria-label="Mover a la etapa elegida" className="w-8 px-0!"><ArrowRight size={13} aria-hidden="true" /></ActionSubmit>
          </ActionForm>
        )}
      </TarjetaConversacion>
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
        <Tablero>
          {etapasAbiertas.map((etapa, indice) => {
            const propios = abiertos.filter((negocio) => negocio.stage_id === etapa.id);
            const total = propios.reduce((suma, negocio) => suma + monto(negocio), 0);
            const visual = ETAPA_VISUAL[etapa.key] ?? { tono: TONOS_DE_RESPALDO[indice % TONOS_DE_RESPALDO.length], icono: CircleDot };
            return (
              <Columna
                key={etapa.id}
                tono={visual.tono}
                icono={visual.icono}
                titulo={etapa.name}
                conteo={propios.length}
                monto={total > 0 ? `${pesos.format(total)}${mensual ? " /mes" : ""}` : undefined}
                detalle={etapa.probability !== null ? `${etapa.probability}% de cierre` : undefined}
                vacio="Nada en esta etapa"
              >
                {propios.length > 0 ? propios.map((negocio) => <Tarjeta key={negocio.id} negocio={negocio} />) : null}
              </Columna>
            );
          })}

          <Columna tono="green" icono={CheckCircle2} titulo="Cerrados" conteo={cerradosRecientes.length} detalle="Últimos 30 días" vacio="Nada cerrado este mes">
            {cerradosRecientes.length > 0
              ? cerradosRecientes.map((negocio) => {
                  const empresaNombre = primero(negocio.sales_companies)?.name ?? "—";
                  const ganado = negocio.status === "ganada";
                  return (
                    <TarjetaConversacion
                      key={negocio.id}
                      href={`/dashboard/ventas/${negocio.id}`}
                      nombre={empresaNombre}
                      subtitulo={negocio.name}
                      hace={tiempoRelativo(negocio.closed_at, ahora)}
                    >
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold tabular-nums text-foreground">{monto(negocio) > 0 ? pesos.format(monto(negocio)) : "—"}</span>
                        <span className={`inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium ${ganado ? "text-success" : "text-danger"}`}>
                          {ganado ? <CheckCircle2 size={13} aria-hidden="true" /> : <XCircle size={13} aria-hidden="true" />}
                          {ganado ? "Ganado" : "Perdido"}
                        </span>
                      </div>
                    </TarjetaConversacion>
                  );
                })
              : null}
          </Columna>
        </Tablero>
      )}
    </div>
  );
}
